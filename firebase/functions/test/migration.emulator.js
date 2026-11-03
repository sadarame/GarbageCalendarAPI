const test=require('node:test');const assert=require('node:assert/strict');
if(!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Emulator required');
const {initializeApp,deleteApp}=require('firebase-admin/app');const {getFirestore}=require('firebase-admin/firestore');
const {makeManifest,applyManifest}=require('../lib/migration');
const app=initializeApp({projectId:'demo-garbage-notifications'});const db=getFirestore(app);
const candidate={id:'legacy-area-900001',legacyGroupId:'1',name:'移行試験',latitude:35.68,longitude:139.76,cell:'356:1397',status:'pending-review',schemaVersion:2,source:'legacy-snapshot',rules:[{garbageType:'古紙',schedule:'毎月',day:1}]};
test('import is unpublished, resumable, and rollback preserves edited/published records',async()=>{
 const m=makeManifest([candidate,{...candidate,id:'legacy-area-900002'}],'demo-garbage-notifications');
 assert.equal((await applyManifest(db,m,'import','demo-garbage-notifications')).created,2);
 assert.equal((await applyManifest(db,m,'import','demo-garbage-notifications')).unchanged,2);
 const ref=db.collection(m.collection).doc(candidate.id);
 assert.equal((await ref.get()).data().status,'pending-review');
 await ref.update({status:'published'});
 const result=await applyManifest(db,m,'rollback','demo-garbage-notifications');assert.equal(result.removed,1);assert.deepEqual(result.conflicts,[candidate.id]);
 assert.equal((await ref.get()).data().status,'published');
 await ref.delete();
 assert.equal((await applyManifest(db,m,'rollback','demo-garbage-notifications')).unchanged,2);
});
test('migration refuses a different project',async()=>{
 await assert.rejects(applyManifest(db,makeManifest([candidate],'demo-wrong-project'),'import','demo-garbage-notifications'),/Project mismatch/);
});
test.after(async()=>{await db.terminate();await deleteApp(app);});
