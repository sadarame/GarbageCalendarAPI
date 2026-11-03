import { createHash } from "node:crypto";
import { Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { shareSchema, cell, collectionName } from "./shared";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
const candidateSchema = shareSchema.extend({
  id: z.string().regex(/^legacy-area-\d+$/), legacyGroupId: z.string().regex(/^\d+$/),
  status: z.literal('pending-review'), schemaVersion: z.literal(2),
  source: z.literal('legacy-snapshot'), cell: z.string(),
}).strict();
export function makeManifest(input: unknown, project: string) {
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(project)) throw Error('Invalid project ID');
  const candidates = z.array(candidateSchema).min(1).parse(input);
  if (new Set(candidates.map(c=>c.id)).size !== candidates.length) throw Error('Duplicate document IDs');
  for (const c of candidates) {
    if (c.cell !== cell(c.latitude,c.longitude)) throw Error('Incorrect search cell');
  }
  const batch = 'snapshot-' + digest(candidates).slice(0,24);
  const documents = candidates.map(({id,...data})=>({id,data:{...data,migrationBatch:batch}}));
  const body = {version:1,project,batch,collection:collectionName,documents};
  return {...body,sha256:digest(body)};
}
export type Manifest = ReturnType<typeof makeManifest>;
export function validateManifest(value: unknown): Manifest {
  const m = value as Manifest;
  if (!m || !Array.isArray(m.documents)) throw Error('Invalid manifest');
  const candidates = m.documents.map(({id,data})=>{
    const {migrationBatch,...candidate}=data;
    if (migrationBatch !== m.batch) throw Error('Batch mismatch');
    return {id,...candidate};
  });
  const rebuilt = makeManifest(candidates,m.project);
  if (canonical(rebuilt) !== canonical(m)) throw Error('Manifest checksum or content mismatch');
  return rebuilt;
}
// Each transaction can be retried. Existing or edited documents are never overwritten.
export async function applyManifest(db: Firestore, manifest: Manifest, operation: 'import'|'rollback', targetProject: string) {
  const m = validateManifest(manifest);
  if (targetProject !== m.project) throw Error('Project mismatch');
  const result = {created:0,removed:0,unchanged:0,conflicts:[] as string[]};
  for (const item of m.documents) {
    const ref=db.collection(m.collection).doc(item.id);
    const outcome=await db.runTransaction(async tx=>{
      const existing=await tx.get(ref);
      if (operation==='import') {
        if (!existing.exists) {tx.create(ref,item.data);return 'created';}
        return canonical(existing.data())===canonical(item.data) ? 'unchanged' : 'conflict';
      }
      if (!existing.exists) return 'unchanged';
      // Publishing or any subsequent edit causes a conflict; do not destroy it.
      if (canonical(existing.data())!==canonical(item.data)) return 'conflict';
      tx.delete(ref);return 'removed';
    });
    if (outcome==='conflict') result.conflicts.push(item.id);
    else result[outcome]++;
  }
  return result;
}
