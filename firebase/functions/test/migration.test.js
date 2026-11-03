const test=require('node:test');const assert=require('node:assert/strict');
const {makeManifest,validateManifest}=require('../lib/migration');
const candidate={id:'legacy-area-1',legacyGroupId:'1',name:'地区',latitude:35.68,longitude:139.76,cell:'356:1397',status:'pending-review',schemaVersion:2,source:'legacy-snapshot',rules:[{garbageType:'古紙',schedule:'毎月',day:1}]};
test('manifest rejects publication, owner fields and duplicate IDs',()=>{
 for(const input of [[{...candidate,status:'published'}],[{...candidate,ownerUid:'someone'}],[candidate,candidate]]) assert.throws(()=>makeManifest(input,'demo-migration'));
});
test('manifest is reproducible and detects changes to data or destination',()=>{
 const m=makeManifest([candidate],'demo-migration');
 assert.deepEqual(validateManifest(m),m);
 assert.deepEqual(makeManifest([candidate],'demo-migration'),m);
 for(const change of [{...m,project:'other-project'},{...m,collection:'privateUsers'},{...m,sha256:'bad'}]) assert.throws(()=>validateManifest(change));
 const edited=JSON.parse(JSON.stringify(m));edited.documents[0].data.name='変更';assert.throws(()=>validateManifest(edited));
});
