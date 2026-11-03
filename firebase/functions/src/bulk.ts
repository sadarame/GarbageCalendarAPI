import {createHash} from "node:crypto";
import {Firestore, FieldValue} from "firebase-admin/firestore";
import {z} from "zod";
import {adminId, adminSchema} from "./admin";
import {cell, collectionName, idSchema} from "./shared";
import {civilDay, matches, ruleSchema} from "./schedule";

type Data = Record<string, any>;
const fields = Object.keys(adminSchema.shape);
const evidence = ['uiListText','checkedAtISO','publicationEligible','registrationEligible'];
const metadata = ['districtId','id','revision','source','schemaVersion','cell','updatedBy','updatedAt','usageKey','usageCount'];
function stable(v: any): string {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
export const fingerprint = (v: any) => createHash('sha256').update(stable(v ?? null)).digest('hex');
function fail(fieldPath: string, code: string, message: string): never { throw {issues:[{fieldPath,code,message}]}; }
function errors(e: any) { return e.issues?.map((i: any)=>({fieldPath:i.fieldPath ?? i.path?.join('.') ?? '',code:i.code,message:i.message})) ?? [{fieldPath:'',code:'SAVE_FAILED',message:'処理に失敗しました。再検証して再試行してください。'}]; }
export function normalize(raw: Data, current?: Data) {
  for (const key of Object.keys(raw)) if (![...fields,...metadata,...evidence,'expectedDatesByGarbageType'].includes(key)) fail(key,'UNKNOWN_FIELD','未対応の項目です。仕様書は取り込めません。');
  const patch: Data = {};
  for (const key of fields) if (key !== 'status' && Object.hasOwn(raw,key)) patch[key]=raw[key];
  for (const key of ['latitude','longitude']) if (typeof patch[key] === 'string' && patch[key].trim()) patch[key]=Number(patch[key]);
  if (patch.rules !== undefined) {
    if (!Array.isArray(patch.rules)) fail('rules','INVALID_TYPE','ルールは配列で指定してください。');
    patch.rules=patch.rules.map((r: Data, i: number)=>{
      if (!r || typeof r !== 'object' || Array.isArray(r)) fail(`rules.${i}`,'INVALID_TYPE','ルールはオブジェクトです。');
      const rule = {...r};
      const variant = ruleSchema.options.find(v=>v.shape.schedule.value === rule.schedule);
      if (!variant) fail(`rules.${i}.schedule`,'UNSUPPORTED_SCHEDULE','未対応の周期です。');
      for (const key of Object.keys(rule)) if (!(key in variant.shape)) fail(`rules.${i}.${key}`,'UNKNOWN_FIELD','この周期では未対応の項目です。');
      for (const key of ['excludedDates','additionalDates']) if (typeof rule[key] === 'string') rule[key]=rule[key].split(',').map((s: string)=>s.trim()).filter(Boolean);
      return rule;
    });
  }
  const value = adminSchema.parse({...current,...patch,status:current?.status ?? 'draft'});
  if (value.validFrom && value.validTo && value.validFrom > value.validTo) fail('validTo','INVALID_PERIOD','有効期間の終了は開始以降です。');
  value.latitude=Math.round(value.latitude*100)/100; value.longitude=Math.round(value.longitude*100)/100;
  value.rules.forEach((r,i)=>{
    const from=[value.validFrom,r.validFrom].filter(Boolean).sort().at(-1);
    const to=[value.validTo,r.validTo].filter(Boolean).sort()[0];
    if(from && to && from>to) fail(`rules.${i}`,'INVALID_PERIOD','有効期間が重なりません。');
    if(r.excludedDates?.some(d=>r.additionalDates?.includes(d))) fail(`rules.${i}`,'AMBIGUOUS_DATE','追加日と除外日が重複しています。');
    if(r.schedule==='指定日のみ' && (r.excludedDates?.length || r.additionalDates?.length)) fail(`rules.${i}`,'AMBIGUOUS_DATE','指定日のみでは追加日・除外日を指定できません。');
    for(const d of [...r.excludedDates ?? [],...r.additionalDates ?? [],...(r.schedule==='指定日のみ'?r.specificDates:[])]) if(from && d<from || to && d>to) fail(`rules.${i}`,'OUTSIDE_PERIOD',`${d} は有効期間外です。`);
  });
  return value;
}
function dateSets(value: Data | undefined, from: string, to: string) {
  const sets: Record<string,string[]> = {};
  if(!value) return sets;
  for(const r of value.rules ?? []) sets[r.garbageType] ??= [];
  for(let t=Date.parse(from);t<=Date.parse(to);t+=86400000) {
    const d=new Date(t).toISOString().slice(0,10);
    if(value.validFrom && d<value.validFrom || value.validTo && d>value.validTo) continue;
    for(const type of new Set<string>((value.rules ?? []).filter((r:any)=>matches(r,d)).map((r:any)=>r.garbageType))) sets[type].push(d);
  }
  return sets;
}
function comparison(raw: Data, before: Data | undefined, after: Data) {
  const from=[before?.validFrom,after.validFrom].filter(Boolean).sort()[0] ?? new Date().toISOString().slice(0,10);
  const to=[before?.validTo,after.validTo].filter(Boolean).sort().at(-1) ?? new Date(Date.parse(from)+365*86400000).toISOString().slice(0,10);
  if(Date.parse(to)-Date.parse(from)>3660*86400000) fail('validTo','PERIOD_TOO_LONG','比較期間は10年以内で指定してください。');
  const previous=dateSets(before,from,to), next=dateSets(after,from,to);
  let expected: Record<string, string[]> | undefined;
  if(raw.expectedDatesByGarbageType!==undefined) {
    if(!after.validFrom || !after.validTo) fail('expectedDatesByGarbageType','PERIOD_REQUIRED','公式日付比較には有効期間の両端が必要です。');
    expected=z.record(z.array(civilDay).max(3660)).parse(raw.expectedDatesByGarbageType);
  }
  const changes=Object.keys(after).filter(k=>fingerprint(before?.[k])!==fingerprint(after[k])).map(k=>({field:k,before:before?.[k] ?? null,after:after[k]}));
  const calendar=Array.from(new Set([...Object.keys(previous),...Object.keys(next),...Object.keys(expected ?? {})])).map(type=>({garbageType:type,
    removedDates:(previous[type]??[]).filter(d=>!next[type]?.includes(d)),addedDates:(next[type]??[]).filter(d=>!previous[type]?.includes(d)),
    ...(expected?{missingDates:(expected[type]??[]).filter(d=>!next[type]?.includes(d)),extraDates:(next[type]??[]).filter(d=>!expected![type]?.includes(d))}:{})}));
  return {changes,calendar,comparisonPeriod:{from,to},beforeRuleCount:before?.rules?.length ?? 0,afterRuleCount:after.rules.length,
    expectedDatesMatch:expected ? calendar.every(c=>!c.missingDates?.length && !c.extraDates?.length) : null};
}
function records(input: unknown): Data[] {
  const payload=Array.isArray(input)?input:z.object({districts:z.array(z.unknown())}).strict().parse(input).districts;
  return z.array(z.record(z.unknown())).min(1).max(100).parse(payload);
}
// Bound concurrent Firestore work while retaining per-district failure handling.
async function forEachBounded<T>(rows: T[], action: (row: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({length: Math.min(4, rows.length)}, async () => {
    while (next < rows.length) {const index = next++; await action(rows[index], index);}
  }));
}
async function resolve(db: Firestore, raw: Data, tx?: FirebaseFirestore.Transaction) {
  const collection=db.collection(collectionName);
  const read = (q:any):Promise<any> => tx ? tx.get(q) : q.get();
  let id=raw.districtId ?? raw.id;
  if(raw.id && raw.districtId && raw.id!==raw.districtId) fail('districtId','ID_MISMATCH','IDが一致しません。');
  let current: Data | undefined;
  if(id!==undefined) {
    idSchema.parse({id}); current=(await read(collection.doc(id))).data();
    if(!current) fail('districtId','NOT_FOUND','指定IDは存在しません。');
    if(current.source!=='admin') fail('districtId','NOT_ADMIN','管理者登録の地区のみ更新できます。');
  }
  const identity={prefecture:raw.prefecture ?? current?.prefecture,municipality:raw.municipality ?? current?.municipality,district:raw.district ?? current?.district};
  for(const k of ['prefecture','municipality','district'] as const) if(typeof identity[k]!=='string' || !identity[k] || identity[k]!==identity[k].trim()) fail(k,'EXACT_IDENTITY_REQUIRED','照合項目は前後の空白を含めず、完全一致で指定してください。');
  if (id && current && ['prefecture','municipality','district'].every(k=>identity[k as keyof typeof identity]===current![k])) return {id:id as string,current};
  const found=await read(collection.where('source','==','admin').where('prefecture','==',identity.prefecture).where('municipality','==',identity.municipality).where('district','==',identity.district).limit(3));
  if(found.docs.length>1 || id && found.docs.some((d:any)=>d.id!==id)) fail('districtId','AMBIGUOUS_IDENTITY','地区名が複数IDと一致します。');
  if(!id && found.docs.length) {id=found.docs[0].id;current=found.docs[0].data();}
  if(!id) {id=adminId(identity as any);const occupied=(await read(collection.doc(id))).data();if(occupied) fail('districtId','ID_COLLISION','既存IDが別の地区に使われています。');}
  return {id:id as string,current};
}
export async function previewBulk(db: Firestore, input: unknown) {
  const rows=records(input), results: Data[]=[];
  await forEachBounded(rows, async (raw,inputIndex) => {
    try {
      const {id,current}=await resolve(db,raw);const value=normalize(raw,current);
      const diff=comparison(raw,current,value);
      results.push({inputIndex,districtId:id,name:value.name,result:current?(diff.changes.length?'updated':'unchanged'):'created',errors:[],
        savedStatus:value.status,revision:current?.revision ?? 0,baseFingerprint:fingerprint(current),inputFingerprint:fingerprint(raw),...diff,
        previewValue:value,warnings:['一括保存では状態を保持します。公開には確認画面での操作が必要です。',...evidence.filter(k=>k in raw).map(k=>`${k} は参考情報として表示のみ。保存・公開承認には使用しません。`)],input:raw});
    } catch(e) {results.push({inputIndex,result:'error',errors:errors(e),input:raw});}
  });
  results.sort((a,b)=>a.inputIndex-b.inputIndex);
  for(const r of results) if(r.districtId && results.filter(x=>x.districtId===r.districtId).length>1) {r.result='error';r.errors=[{fieldPath:'districtId',code:'DUPLICATE_DISTRICT',message:'同一ファイル内で地区が重複しています。'}];}
  return {results};
}
export async function saveBulk(db: Firestore, uid: string, input: unknown) {
  const {entries,publish}=z.object({publish:z.literal(true).optional(),entries:z.array(z.object({input:z.record(z.unknown()),districtId:idSchema.shape.id,baseFingerprint:z.string().length(64),inputFingerprint:z.string().length(64),inputIndex:z.number().int().min(0)})).min(1).max(100)}).parse(input);
  const results: Data[]=[];const districts:Data[]=[];
  await forEachBounded(entries, async entry => {
    try {
      if(entries.filter(x=>x.districtId===entry.districtId).length>1) fail('districtId','DUPLICATE_DISTRICT','同一地区を複数回保存できません。');
      if(fingerprint(entry.input)!==entry.inputFingerprint) fail('','PREVIEW_CHANGED','入力が変更されました。再検証してください。');
      const outcome=await db.runTransaction(async tx=>{
        const {id,current}=await resolve(db,entry.input,tx);
        if(id!==entry.districtId || fingerprint(current)!==entry.baseFingerprint) return {result:'conflict',errors:[{fieldPath:'revision',code:'CONFLICT',message:'検証後に変更されています。再検証してください。'}]};
        const value=normalize(entry.input,current);
        if(publish) value.status='published';
        const diff=comparison(entry.input,current,value);
        // Exact expected-date mismatches must be reviewed before applying to published data.
        if(diff.expectedDatesMatch===false) fail('expectedDatesByGarbageType','CALENDAR_MISMATCH','公式日付と一致しません。差分を修正して再検証してください。');
        const result=current?(diff.changes.length?'updated':'unchanged'):'created';
        if(result!=='unchanged') tx.set(db.collection(collectionName).doc(id),{...value,source:'admin',schemaVersion:2,cell:cell(value.latitude,value.longitude),revision:(current?.revision ?? 0)+1,updatedBy:uid,updatedAt:FieldValue.serverTimestamp()},{merge:true});
        return {result,errors:[],expected:value};
      });
      const {expected, ...publicOutcome}=outcome;
      const row:Data={inputIndex:entry.inputIndex,districtId:entry.districtId,...publicOutcome};
      if(outcome.result!=='conflict') {
        const saved=(await db.collection(collectionName).doc(entry.districtId).get()).data();
        if(!saved) fail('districtId','READBACK_FAILED','保存後の読戻しに失敗しました。');
        const wanted=expected!;
        row.readbackMatches=fields.every(k=>fingerprint(saved[k])===fingerprint((wanted as Data)[k]));
        row.savedStatus=saved.status;row.revision=saved.revision;row.name=saved.name;
        districts.push({...saved,districtId:entry.districtId});
      }
      results.push(row);
    } catch(e) {results.push({inputIndex:entry.inputIndex,districtId:entry.districtId,result:'error',errors:errors(e)});}
  });
  results.sort((a,b)=>a.inputIndex-b.inputIndex);
  const order=new Map(entries.map((e,i)=>[e.districtId,i]));
  districts.sort((a,b)=>order.get(a.districtId)!-order.get(b.districtId)!);
  return {results,districts};
}
export async function exportBulk(db: Firestore, input:unknown) {
  const {ids}=z.object({ids:z.array(idSchema.shape.id).min(1).max(100)}).parse(input);
  const districts=[];
  for(const id of [...new Set(ids)]) {const data=(await db.collection(collectionName).doc(id).get()).data();if(!data || data.source!=='admin') fail('ids','NOT_ADMIN','管理者登録の地区が見つかりません。');districts.push({...data,districtId:id});}
  return {districts};
}
