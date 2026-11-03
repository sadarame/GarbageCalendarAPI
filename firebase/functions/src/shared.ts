import { randomUUID } from "node:crypto";
import { Firestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { ruleSchema } from "./schedule";
import { legacyAreaMetadata } from "./legacyAreaMetadata";

// Japan only. 0.1-degree cells cover a 5 km circle with the surrounding 3x3 cells.
export const pointSchema = z.object({latitude: z.number().min(20).max(46), longitude: z.number().min(122).max(154)});
export const searchSchema = pointSchema.extend({radiusKm: z.number().min(0.5).max(5).default(5)});
export const idSchema = z.object({id: z.string().regex(/^[A-Za-z0-9_-]{1,180}$/)});
export const shareSchema = pointSchema.extend({
  name: z.string().trim().min(1).max(80),
  rules: z.array(ruleSchema).min(1).max(100),
});
export const collectionName = "v2SharedSchedules";
export function cell(latitude: number, longitude: number): string {
  return `${Math.floor(latitude * 10)}:${Math.floor(longitude * 10)}`;
}
export function cells(latitude: number, longitude: number): string[] {
  const a = Math.floor(latitude * 10), b = Math.floor(longitude * 10);
  return [-1,0,1].flatMap(x => [-1,0,1].map(y => `${a+x}:${b+y}`));
}
export function distanceKm(a: number, b: number, c: number, d: number): number {
  const rad = Math.PI / 180;
  const h = Math.sin((c-a)*rad/2)**2 + Math.cos(a*rad)*Math.cos(c*rad)*Math.sin((d-b)*rad/2)**2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function publicSummary(id: string, data: FirebaseFirestore.DocumentData) {
  const legacy = data.source === "legacy-snapshot" ? legacyAreaMetadata[id] : undefined;
  // Public categories describe the registration route: master or ordinary user.
  // Keep legacy metadata intact, but treat every non-master record as community.
  const isMaster = data.source === "admin" || legacy?.registrationSource === "admin";
  const registrationSource = isMaster ? "admin" : "community";
  const count = data.usageCount;
  const usageCount = Number.isSafeInteger(count) && count >= 0 ? String(count) : "0";
  return {No: id, garbageGroupId: id, garbageInfoName: data.name,
    // Legacy flags are not evidence of official verification.
    officialFlag: "0", registrationSource, usageCount,
    legacyUsageCount: legacy ? String(legacy.legacyUsageCount) : undefined, latitude: String(data.latitude), longitude: String(data.longitude)};
}
export async function searchShared(db: Firestore, input: unknown) {
  const query = searchSchema.parse(input);
  // Bounded reads; report truncation rather than claiming a complete nearest list.
  const snapshot = await db.collection(collectionName).where("status", "==", "published")
    .where("cell", "in", cells(query.latitude, query.longitude)).limit(501).get();
  const ranked = snapshot.docs.slice(0,500).map(doc => ({id: doc.id, data: doc.data()}))
    .filter(item => shareSchema.safeParse(item.data).success)
    .map(item => ({...item, distance: distanceKm(query.latitude, query.longitude, item.data.latitude, item.data.longitude)}))
    .filter(item => item.distance <= query.radiusKm)
    .sort((a,b) => a.distance-b.distance || a.id.localeCompare(b.id));
  const result = await Promise.all(ranked.slice(0,50).map(async item => {
    const count = await db.collection("v2SharedUsageCounts").doc(item.data.usageKey ?? item.id).get();
    return publicSummary(item.id, {...item.data, usageCount: count.data()?.count ?? 0});
  }));
  return {result,
    truncated: snapshot.size > 500 || ranked.length > 50};
}
export function publicSourceUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2000) return undefined;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !!url.hostname ? value : undefined;
  } catch { return undefined; }
}
export async function getShared(db: Firestore, input: unknown) {
  const {id} = idSchema.parse(input);
  const doc = await db.collection(collectionName).doc(id).get();
  const data = doc.data();
  if (!data || data.status !== "published") throw new HttpsError("not-found", "公開中の収集情報がありません。");
  const parsed = shareSchema.safeParse(data);
  if (!parsed.success) throw new HttpsError("failed-precondition", "収集情報を確認中です。");
  return {id, name: parsed.data.name, sourceUrl: publicSourceUrl(data.sourceUrl), rules: parsed.data.rules.map(rule => ({...rule,
    ...(data.validFrom ? {validFrom: [data.validFrom, rule.validFrom].filter(Boolean).sort().at(-1)} : {}),
    ...(data.validTo ? {validTo: [data.validTo, rule.validTo].filter(Boolean).sort()[0]} : {})}))};
}
// All reads precede writes. One selection per Firebase UID makes retries idempotent.
async function prepareUsage(db: Firestore, tx: FirebaseFirestore.Transaction, uid: string, key: string | null) {
  const selection = db.collection("v2SharedUsageSelections").doc(uid);
  const previous = (await tx.get(selection)).data()?.key as string | undefined;
  const oldRef = previous ? db.collection("v2SharedUsageCounts").doc(previous) : null;
  const newRef = key ? db.collection("v2SharedUsageCounts").doc(key) : null;
  const oldCount = oldRef ? (await tx.get(oldRef)).data()?.count ?? 0 : 0;
  const newCount = newRef ? (await tx.get(newRef)).data()?.count ?? 0 : 0;
  return () => {
    if (previous === key || (!previous && !key)) return;
    if (oldRef) tx.set(oldRef, {count: Math.max(0, oldCount - 1)});
    if (newRef) tx.set(newRef, {count: newCount + 1});
    if (key) tx.set(selection, {key});
    else tx.delete(selection);
  };
}
// One contribution per authenticated user; legacy IDs never confer ownership.
export async function saveShared(db: Firestore, uid: string, input: unknown) {
  const value = shareSchema.parse(input);
  const {selectedScheduleId} = z.object({selectedScheduleId: idSchema.shape.id.optional()}).parse(input);
  const latitude = Math.round(value.latitude*100)/100;
  const longitude = Math.round(value.longitude*100)/100;
  const ref = db.collection(collectionName).doc(`user-${uid}`);
  await db.runTransaction(async transaction => {
    const existing = await transaction.get(ref);
    if (existing.exists && existing.data()?.ownerUid !== uid) {
      throw new HttpsError("permission-denied", "この情報は更新できません。");
    }
    const usageKey = existing.data()?.usageKey ?? (existing.exists ? ref.id : randomUUID());
    let selectedKey = usageKey;
    if (selectedScheduleId && selectedScheduleId !== ref.id) {
      const selected = (await transaction.get(db.collection(collectionName).doc(selectedScheduleId))).data();
      if (!selected || selected.status !== "published" || !shareSchema.safeParse(selected).success) {
        throw new HttpsError("not-found", "選択した収集情報がありません。再検索してください。");
      }
      selectedKey = selected.usageKey ?? selectedScheduleId;
    }
    const applyUsage = await prepareUsage(db, transaction, uid, selectedKey);
    transaction.set(ref, {...value, latitude, longitude, cell: cell(latitude, longitude), usageKey,
      ownerUid: uid, status: "published", schemaVersion: 2, source: "community",
      updatedAt: FieldValue.serverTimestamp()});
    applyUsage();
  });
  return {id: ref.id};
}
export async function unpublishShared(db: Firestore, uid: string) {
  const ref = db.collection(collectionName).doc(`user-${uid}`);
  await db.runTransaction(async transaction => {
    const existing = await transaction.get(ref);
    if (!existing.exists) return;
    if (existing.data()?.ownerUid !== uid) throw new HttpsError("permission-denied", "この情報は更新できません。");
    transaction.update(ref, {status: "withdrawn", updatedAt: FieldValue.serverTimestamp()});
  });
  return {withdrawn: true};
}

// Retain community schedules under an independent ID, without the former owner.
// The original document is removed in the same transaction: retries cannot duplicate it.
export async function resetUserData(db: Firestore, uid: string) {
  const owned = db.collection(collectionName).doc(`user-${uid}`);
  const retained = db.collection(collectionName).doc();
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(owned);
    const data = snapshot.data();
    if (data && data.ownerUid !== uid) {
      throw new HttpsError("permission-denied", "ユーザー情報を確認できませんでした。");
    }
    const applyUsage = await prepareUsage(db, tx, uid, null);
    if (data) {
      const {ownerUid: _ownerUid, ...communityData} = data;
      tx.create(retained, {...communityData, usageKey: data.usageKey ?? owned.id});
      tx.delete(owned);
    }
    applyUsage();
    tx.delete(db.collection("v2NotificationSubscriptions").doc(uid));
  });
  // Delivery history also contains the user's ID; remove it in bounded batches.
  for (;;) {
    const history = await db.collection("v2NotificationDeliveries").where("uid", "==", uid).limit(400).get();
    if (history.empty) break;
    const batch = db.batch();
    for (const doc of history.docs) batch.delete(doc.ref);
    await batch.commit();
  }
  return {reset: true};
}
