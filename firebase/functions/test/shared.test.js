const test = require('node:test');
const assert = require('node:assert/strict');
const {cell,cells,distanceKm,searchSchema,shareSchema,idSchema} = require('../lib/shared');
test('国内座標・距離・文書IDの検証',()=>{
  for (const point of [{latitude:NaN,longitude:139},{latitude:0,longitude:0},{latitude:35,longitude:Infinity}]) assert.equal(searchSchema.safeParse(point).success,false);
  assert.equal(searchSchema.safeParse({latitude:35,longitude:139,radiusKm:6}).success,false);
  assert.equal(idSchema.safeParse({id:'../private/uid'}).success,false);
});
test('5km以内の点がセル境界・国内南北端で検索対象になる',()=>{
  for (const latitude of [20,20.09999,35.69999,35.7,45.99999,46]) {
    for (const longitude of [122,139.69999,139.7,154]) {
      const covered = cells(latitude,longitude);
      for (let angle=0;angle<360;angle+=5) {
        const a=latitude+4.99/111.195*Math.cos(angle*Math.PI/180);
        const b=longitude+4.99/(111.195*Math.cos(latitude*Math.PI/180))*Math.sin(angle*Math.PI/180);
        assert.ok(covered.includes(cell(a,b)));
      }
    }
  }
});
test('距離計算は同一点・東西・南北を区別する',()=>{
  assert.equal(distanceKm(35,139,35,139),0);
  assert.ok(distanceKm(35,139,35.01,139)>1.1);
  assert.ok(distanceKm(35,139,35,139.01)<1);
});
test('共有データは空ルールと不正日を拒否し管理フィールドを除去',()=>{
  const base={name:'地区',latitude:35,longitude:139};
  assert.equal(shareSchema.safeParse({...base,rules:[]}).success,false);
  assert.equal(shareSchema.safeParse({...base,rules:[{garbageType:'ごみ',schedule:'隔週',yobi:'月曜日',freqWeek:'二週に一回',strDate:'2026-02-30'}]}).success,false);
  const parsed=shareSchema.parse({...base,rules:[{garbageType:'ごみ',schedule:'毎週',yobi:'月曜日'}],ownerUid:'victim',status:'published',officialFlag:1,source:'admin',usageCount:999,registrationSource:'admin'});
  assert.equal(parsed.ownerUid,undefined);
  assert.equal(parsed.officialFlag,undefined);
  assert.equal(parsed.source,undefined);
  assert.equal(parsed.usageCount,undefined);
  assert.equal(parsed.registrationSource,undefined);
});
test('登録経路をマスタ登録とユーザー登録の2種類で返す',()=>{
  const {publicSummary}=require('../lib/shared');
  const {legacyAreaMetadata}=require('../lib/legacyAreaMetadata');
  for(const [id,meta] of Object.entries(legacyAreaMetadata)) {
    const result=publicSummary(id,{source:'legacy-snapshot'});
    assert.equal(result.registrationSource,meta.registrationSource === 'admin' ? 'admin' : 'community');
    assert.equal(result.legacyUsageCount,String(meta.legacyUsageCount));
    assert.equal(result.officialFlag,'0');
    assert.equal(result.usageCount,'0');
    assert.equal(publicSummary(id,{source:'community'}).registrationSource,'community');
  }
  assert.equal(publicSummary('new-master',{source:'admin'}).registrationSource,'admin');
  assert.equal(publicSummary('unknown',{}).registrationSource,'community');
  assert.equal(publicSummary('missing-legacy',{source:'legacy-snapshot'}).registrationSource,'community');
  assert.equal(publicSummary('user-new',{source:'community',registrationSource:'admin',officialFlag:1}).registrationSource,'community');
  assert.equal(publicSummary('user-new',{source:'community',usageCount:-1}).usageCount,'0');
  assert.equal(publicSummary('user-new',{source:'community',usageCount:3}).usageCount,'3');
});
test('ユーザーの保存ではマスタ登録を指定してもユーザー登録になる',async()=>{
  const {saveShared,publicSummary}=require('../lib/shared');
  let stored;
  const db={collection:()=>({doc:id=>({id})}),runTransaction:async fn=>fn({
    get:async()=>({exists:false,data:()=>undefined}),set:(_ref,data)=>{if(data.source) stored=data;}
  })};
  const saved=await saveShared(db,'ordinary-user',{
    name:'ユーザーの地区',latitude:35,longitude:139,
    rules:[{garbageType:'燃えるゴミ',schedule:'毎週',yobi:'月曜日'}],
    source:'admin',registrationSource:'admin',officialFlag:1
  });
  assert.equal(stored.source,'community');
  assert.equal(publicSummary(saved.id,stored).registrationSource,'community');
});
test('公開収集情報の出典を返し、未登録・不正URLではリンクを返さない', async () => {
  const {getShared}=require('../lib/shared');
  for (const sourceUrl of ['https://example.jp/calendar.pdf','http://example.jp/gomi',undefined,'','javascript:alert(1)','file:///tmp/example','invalid']) {
    const data={name:'地区',status:'published',latitude:35,longitude:139,
      rules:[{garbageType:'燃えるゴミ',schedule:'毎週',yobi:'月曜日'}],sourceUrl};
    const db={collection:()=>({doc:()=>({get:async()=>({data:()=>data})})})};
    const result=await getShared(db,{id:'district'});
    assert.equal(result.sourceUrl,sourceUrl?.startsWith('http') ? sourceUrl : undefined);
    assert.equal(result.rules.length,1);
    assert.equal(result.name,'地区');
  }
});
