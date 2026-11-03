import { randomUUID } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { deliver } from "./dispatch";
import { z } from "zod";
import { nextOccurrence, ruleSchema, settingsSchema } from "./schedule";
initializeApp();
const db = getFirestore();
const region = "asia-northeast1";
const subscriptions = db.collection("v2NotificationSubscriptions");

const requestSchema = z.object({
  settings: settingsSchema,
  rules: z.array(ruleSchema).max(100),
  fcmToken: z.string().min(20).max(4096).optional(),
});
// Separate endpoint: published PHP clients never call this API.
export const saveNotificationSettingsV2 = onCall({region, enforceAppCheck: true}, async request => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です。");
  const parsed = requestSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "通知設定または収集ルールが不正です。");
  const {settings, rules, fcmToken} = parsed.data;
  if (settings.enabled && (!fcmToken || !rules.length)) {
    throw new HttpsError("failed-precondition", "通知許可・端末登録・収集ルールを確認してください。");
  }
  const next = nextOccurrence(rules, settings, Date.now());
  const revision = randomUUID();
  await subscriptions.doc(request.auth.uid).set({
    settings, rules, fcmToken: fcmToken ?? null, next, revision,
    nextNotificationAt: next ? Timestamp.fromMillis(next.fireAt) : null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {revision, nextNotificationAt: next?.fireAt ?? null, mode: "server"};
});

export const dispatchGarbageNotificationsV2 = onSchedule({
  schedule: "every 1 minutes", timeZone: "Asia/Tokyo", region,
  timeoutSeconds: 540, maxInstances: 1, retryCount: 3,
}, async () => {
  // Query only due subscriptions, not every user every minute.
  for (let page=0; page<10; page++) {
    const now = Date.now();
    const due = await subscriptions.where("nextNotificationAt", "<=", Timestamp.fromMillis(now))
      .orderBy("nextNotificationAt").limit(200).get();
    if (due.empty) break;
    for (let offset=0; offset<due.docs.length; offset+=20) {
      await Promise.all(due.docs.slice(offset, offset+20).map(doc => deliver(db, message => getMessaging().send(message), doc.id, Date.now())));
    }
  }
});

// Versioned shared schedule APIs. Authentication and App Check apply to reads too.
import { searchShared, getShared, saveShared, unpublishShared, resetUserData } from "./shared";
function sharedEndpoint(action: (uid: string, data: unknown) => Promise<unknown>) {
  return onCall({region, enforceAppCheck: true, maxInstances: 10}, async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です。");
    try {
      return await action(request.auth.uid, request.data);
    } catch (error) {
      if (error instanceof z.ZodError) throw new HttpsError("invalid-argument", "地域または収集ルールが不正です。");
      throw error;
    }
  });
}
export const searchSharedSchedulesV2 = sharedEndpoint((_uid, data) => searchShared(db, data));
export const getSharedScheduleV2 = sharedEndpoint((_uid, data) => getShared(db, data));
export const saveSharedScheduleV2 = sharedEndpoint((uid, data) => saveShared(db, uid, data));
export const unpublishSharedScheduleV2 = sharedEndpoint(uid => unpublishShared(db, uid));

export const resetUserDataV2 = sharedEndpoint(uid => resetUserData(db, uid));

// Admin web uses short-lived Firebase sign-in credentials, independently of mobile App Check.
import { requireAdmin, saveAdminSchedule, listAdminSchedules, listMapMunicipalities, listMapSchedules } from "./admin";
function adminEndpoint(action: (uid: string, data: unknown) => Promise<unknown>) {
  return onCall({region, maxInstances: 3, timeoutSeconds: 300}, async request => {
    requireAdmin(request.auth?.token);
    try { return await action(request.auth!.uid, request.data); }
    catch (error) {
      if (error instanceof z.ZodError) throw new HttpsError("invalid-argument", "入力内容・出典URL・確認日・収集ルールを確認してください。");
      throw error;
    }
  });
}
export const saveAdminScheduleV2 = adminEndpoint((uid, data) => saveAdminSchedule(db, uid, data));
export const listAdminSchedulesV2 = adminEndpoint((_uid, input) => listAdminSchedules(db, input));

import { previewBulk, saveBulk, exportBulk } from "./bulk";
export const previewAdminBulkV2 = adminEndpoint((_uid, data) => previewBulk(db, data));
export const saveAdminBulkV2 = adminEndpoint((uid, data) => saveBulk(db, uid, data));
export const exportAdminBulkV2 = adminEndpoint((_uid, data) => exportBulk(db, data));

import { onRequest } from "firebase-functions/v2/https";
import { createAdminWebHandler } from "./admin-web";
export const regionalAdminWeb = onRequest({region, maxInstances: 3,
  invoker: "public", timeoutSeconds: 300}, createAdminWebHandler({
  previewBulk: input => previewBulk(db, input),
  saveBulk: input => saveBulk(db, "regional-schedule-operator", input),
  exportBulk: input => exportBulk(db, input),
  list: input => listAdminSchedules(db, input),
  mapMunicipalities: input => listMapMunicipalities(db, input),
  mapSchedules: input => listMapSchedules(db, input),
  save: input => saveAdminSchedule(db, "regional-schedule-operator", input),
}));
