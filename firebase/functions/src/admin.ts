import { createHash } from "node:crypto";
import { FieldValue, Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { civilDay } from "./schedule";
import { cell, collectionName, shareSchema, idSchema } from "./shared";

export const adminSchema = shareSchema.extend({
  validFrom: civilDay.optional(),
  validTo: civilDay.optional(),
  prefecture: z.string().trim().min(1).max(20),
  municipality: z.string().trim().min(1).max(80),
  district: z.string().trim().min(1).max(120),
  sourceUrl: z.string().url().max(2000).refine(v => /^https?:\/\//.test(v)),
  checkedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
    const d = new Date(v + "T00:00:00Z");
    return !isNaN(+d) && d.toISOString().slice(0,10) === v && v <= new Date(Date.now() + 9*3600000).toISOString().slice(0,10);
  }),
  notes: z.string().max(4000).default(""),
  status: z.enum(["draft", "published"]),
});
export function requireAdmin(token: Record<string, unknown> | undefined) {
  if (token?.scheduleAdmin !== true) throw new HttpsError("permission-denied", "登録管理者のログインが必要です。");
}
export function adminId(value: {prefecture: string; municipality: string; district: string}) {
  return "admin-" + createHash("sha256").update(JSON.stringify([value.prefecture, value.municipality, value.district])).digest("hex").slice(0,32);
}
export async function saveAdminSchedule(db: Firestore, uid: string, input: unknown) {
  const {expectedRevision, districtId, ...raw} = z.object({districtId: idSchema.shape.id.optional(), expectedRevision: z.number().int().min(0).optional()}).passthrough().parse(input);
  const candidateId = districtId ?? adminId(adminSchema.pick({prefecture: true, municipality: true, district: true}).parse(raw));
  const saved = await db.runTransaction(async tx => {
    let id = candidateId;
    if (!districtId) {
      const identity = adminSchema.pick({prefecture: true, municipality: true, district: true}).parse(raw);
      const matches = await tx.get(db.collection(collectionName).where("source", "==", "admin")
        .where("prefecture", "==", identity.prefecture).where("municipality", "==", identity.municipality)
        .where("district", "==", identity.district).limit(3));
      if (matches.size > 1) throw new HttpsError("aborted", "同じ地区が複数あります。地区IDを指定してください。");
      if (matches.size === 1) id = matches.docs[0].id;
    }
    const ref = db.collection(collectionName).doc(id);
    const doc = await tx.get(ref);
    const current = doc.data();
    if (expectedRevision !== undefined && (current?.revision ?? 0) !== expectedRevision) throw new HttpsError("aborted", "同じ地域が登録・更新されています。一覧から読み直してください。");
    if (districtId && !current) throw new HttpsError("not-found", "指定地区がありません。");
    const value = adminSchema.parse({...current, ...raw});
    if (value.validFrom && value.validTo && value.validFrom > value.validTo) throw new HttpsError("invalid-argument", "有効期間を確認してください。");
    if (current && ["prefecture", "municipality", "district"].some(key => current[key] !== (value as any)[key])) throw new HttpsError("aborted", "地区の改名は一括取込で差分を確認してください。");
    if (current && current.source !== "admin") throw new HttpsError("permission-denied", "更新できない地域です。");
    const next = (current?.revision ?? 0) + 1;
    const latitude = Math.round(value.latitude*100)/100;
    const longitude = Math.round(value.longitude*100)/100;
    tx.set(ref, {...value, latitude, longitude, cell: cell(latitude, longitude), source: "admin", schemaVersion: 2,
      revision: next, updatedBy: uid, updatedAt: FieldValue.serverTimestamp()}, {merge: true});
    return {...current, ...value, latitude, longitude, id, revision: next};
  });
  return {id: saved.id, revision: saved.revision, district: saved};
}

export async function listAdminSchedules(db: Firestore, input: unknown) {
  const {after, prefecture, municipality, backup} = z.object({
    after: z.string().regex(/^admin-[a-f0-9]{32}$/).optional(),
    prefecture: z.string().trim().min(1).max(20).optional(),
    municipality: z.string().trim().min(1).max(80).optional(),
    backup: z.literal(true).optional(),
  }).parse(input);
  if (!backup && (!prefecture || !municipality)) throw new HttpsError("invalid-argument", "都道府県と市区町村を指定してください。");
  let query = db.collection("v2SharedSchedules").where("source", "==", "admin").orderBy("__name__").limit(51);
  if (!backup) query = query.where("prefecture", "==", prefecture!).where("municipality", "==", municipality!);
  if (after) query = query.startAfter(after);
  const snapshot = await query.get();
  return {items: snapshot.docs.slice(0,50).map(doc => ({...doc.data(), id: doc.id})),
    next: snapshot.size > 50 ? snapshot.docs[49].id : null};
}

const mapAreaSchema = z.object({
  prefecture: z.string().trim().min(1).max(20),
  municipality: z.string().trim().min(1).max(80),
  after: z.string().regex(/^admin-[a-f0-9]{32}$/).optional(),
});

// Read only municipality names within the selected prefecture, never nationwide schedules.
export async function listMapMunicipalities(db: Firestore, input: unknown) {
  const {prefecture} = mapAreaSchema.pick({prefecture: true}).parse(input);
  const snapshot = await db.collection(collectionName).where("source", "==", "admin")
    .where("prefecture", "==", prefecture).select("municipality").get();
  const municipalities = [...new Set(snapshot.docs.map(doc => doc.data().municipality)
    .filter((name): name is string => typeof name === "string" && name.length > 0))]
    .sort((a, b) => a.localeCompare(b, "ja"));
  return {municipalities};
}

export async function listMapSchedules(db: Firestore, input: unknown) {
  const {prefecture, municipality, after} = mapAreaSchema.parse(input);
  let query = db.collection(collectionName).where("source", "==", "admin")
    .where("prefecture", "==", prefecture).where("municipality", "==", municipality)
    .orderBy("__name__").select("prefecture", "municipality", "district", "name", "latitude", "longitude", "status", "checkedOn")
    .limit(201);
  if (after) query = query.startAfter(after);
  const snapshot = await query.get();
  return {items: snapshot.docs.slice(0, 200).map(doc => ({...doc.data(), id: doc.id})),
    next: snapshot.size > 200 ? snapshot.docs[199].id : null};
}
