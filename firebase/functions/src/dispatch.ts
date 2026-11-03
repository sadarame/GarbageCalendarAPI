import { createHash } from "node:crypto";
import { Firestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { Message } from "firebase-admin/messaging";
import { logger } from "firebase-functions";
import { Rule, Settings, Occurrence, nextOccurrence } from "./schedule";
interface Subscription {
  revision: string;
  settings: Settings;
  rules: Rule[];
  fcmToken: string | null;
  next: Occurrence | null;
  nextNotificationAt?: Timestamp | null;
}

// A transaction consumes a due occurrence once, before the external FCM side effect.
// FCM cannot participate in Firestore transactions. Ambiguous sends are NOT blindly
// retried: that could alert the same user twice. Delivery failures need monitoring.
export async function deliver(db: Firestore, send: (message: Message) => Promise<string>, uid: string, now: number) {
  const subscriptions = db.collection("v2NotificationSubscriptions");
  const deliveries = db.collection("v2NotificationDeliveries");
  const ref = subscriptions.doc(uid);
  const claimed = await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return null;
    const value = snapshot.data() as Subscription;
    if (!value.settings.enabled || !value.next || value.next.fireAt > now || !value.fcmToken) return null;
    if (value.nextNotificationAt && value.nextNotificationAt.toMillis() > now) return null;
    const current = value.next;
    const deliveryId = createHash("sha256").update(uid + ":" + current.collectionDate).digest("hex");
    const deliveryRef = deliveries.doc(deliveryId);
    const previous = await tx.get(deliveryRef);
    const next = nextOccurrence(value.rules, value.settings, Math.max(now, current.fireAt));
    tx.update(ref, {next, nextNotificationAt: next ? Timestamp.fromMillis(next.fireAt) : null});
    const prior = previous.data();
    // Only an explicit APNs authentication rejection proves this send was not accepted.
    // Never retry accepted, in-flight, expired, or ambiguous delivery outcomes.
    const retryable = prior?.code === "messaging/third-party-auth-error" &&
      (prior.status === "retryable-auth-error" || prior.status === "failed-or-uncertain");
    if (previous.exists && !retryable) return null;
    const expired = now-current.fireAt > 15*60000;
    const attempt = {
      uid, revision: value.revision, collectionDate: current.collectionDate,
      scheduledAt: Timestamp.fromMillis(current.fireAt),
      status: expired ? "expired" : "sending", createdAt: FieldValue.serverTimestamp(),
      attempts: (prior?.attempts ?? (previous.exists ? 1 : 0)) + (expired ? 0 : 1),
    };
    if (previous.exists) {
      tx.update(deliveryRef, {...attempt, createdAt: prior!.createdAt,
        code: FieldValue.delete(), finishedAt: FieldValue.delete()});
    } else {
      tx.create(deliveryRef, attempt);
    }
    return expired ? null : {value, current, deliveryRef, deliveryId};
  });
  if (!claimed) return;
  const {value, current, deliveryRef, deliveryId} = claimed;
  // Cancel stale settings before dispatch. A push already handed to APNs cannot be recalled.
  const latest = (await ref.get()).data() as Subscription | undefined;
  if (!latest?.settings.enabled || latest.revision !== value.revision) {
    await deliveryRef.update({status: "cancelled"});
    return;
  }
  try {
    const messageId = await send({
      token: value.fcmToken!,
      notification: {
        title: value.settings.previousDay ? "明日はゴミの日" : "今日はゴミの日",
        body: current.types.join("・") + (value.settings.previousDay ? "の準備をお忘れなく。" : "を出す日です。"),
      },
      data: {notificationId: deliveryId, collectionDate: current.collectionDate},
      apns: {
        headers: {
          "apns-push-type": "alert", "apns-priority": "10",
          "apns-expiration": String(Math.floor((current.fireAt+15*60000)/1000)),
          "apns-collapse-id": deliveryId,
        },
        payload: {aps: {sound: "default"}},
      },
    });
    await deliveryRef.update({status: "accepted-by-fcm", messageId, finishedAt: FieldValue.serverTimestamp()});
  } catch (error) {
    const code = (error as {code?: string}).code ?? "unknown";
    if (code === "messaging/third-party-auth-error") {
      await db.runTransaction(async tx => {
        const fresh = await tx.get(ref);
        tx.update(deliveryRef, {status: "retryable-auth-error", code,
          lastAuthFailureAt: FieldValue.serverTimestamp(), finishedAt: FieldValue.serverTimestamp()});
        // A changed setting or OFF must win over an older failed request.
        if (fresh.data()?.revision === value.revision && fresh.data()?.settings.enabled) {
          tx.update(ref, {next: current,
            nextNotificationAt: Timestamp.fromMillis(now + 60_000)});
        }
      });
    } else {
      await deliveryRef.update({status: "failed-or-uncertain", code, finishedAt: FieldValue.serverTimestamp()});
    }
    logger.error("Notification dispatch failed; inspect delivery ledger", {deliveryId, code});
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
      await db.runTransaction(async tx => {
        const fresh = await tx.get(ref);
        if (fresh.data()?.revision === value.revision) {
          tx.update(ref, {fcmToken: null, next: null, nextNotificationAt: null, disabledReason: "invalid-token"});
        }
      });
    }
  }
}

