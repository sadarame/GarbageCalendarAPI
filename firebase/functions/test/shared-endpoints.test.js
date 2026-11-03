const test=require('node:test');
const assert=require('node:assert/strict');
const api=require('../lib/index');
test('共有APIは認証なしの要求を全て拒否', async()=>{
 for(const name of ['searchSharedSchedulesV2','getSharedScheduleV2','saveSharedScheduleV2','unpublishSharedScheduleV2','resetUserDataV2']) {
   await assert.rejects(api[name].run({data:{}}), e=>e.code==='unauthenticated');
 }
});
test('不正入力はDBに到達する前にinvalid-argumentで拒否',async()=>{
 for(const name of ['searchSharedSchedulesV2','getSharedScheduleV2','saveSharedScheduleV2']) {
   await assert.rejects(api[name].run({auth:{uid:'test'},data:{}}), e=>e.code==='invalid-argument');
 }
});
