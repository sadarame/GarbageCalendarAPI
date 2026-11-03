const test=require('node:test');
const assert=require('node:assert/strict');
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required; never run against production');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore,Timestamp}=require('firebase-admin/firestore');
const {deliver}=require('../lib/dispatch');
const {nextOccurrence}=require('../lib/schedule');
const app=initializeApp({projectId:'demo-garbage-notifications'});
const db=getFirestore(app);
const settings={enabled:true,previousDay:false,hour:7,minute:0,timeZone:'Asia/Tokyo'};
const rules=[{garbageType:'燃えるゴミ',schedule:'毎週',yobi:'火曜日'}];
const next=nextOccurrence(rules,settings,Date.parse('2026-10-05T00:00:00+09:00'));
async function seed(id,override={}) {
 await db.collection('v2NotificationSubscriptions').doc(id).set({revision:'r1',settings,rules,fcmToken:'fake-token-no-real-push',next,nextNotificationAt:Timestamp.fromMillis(next.fireAt),...override});
}
test('重複実行でもFCMへの送信試行は1回',async()=>{
 await seed('concurrent');let sends=0;
 const send=async()=>{sends++;return 'fake-message-id';};
 await Promise.all([deliver(db,send,'concurrent',next.fireAt+1000),deliver(db,send,'concurrent',next.fireAt+1000)]);
 assert.equal(sends,1);
 assert.ok((await db.collection('v2NotificationSubscriptions').doc('concurrent').get()).data().next.fireAt>next.fireAt);
});
test('OFFは送信しない',async()=>{
 await seed('disabled',{settings:{...settings,enabled:false}});
 await deliver(db,async()=>{throw new Error('must not send');},'disabled',next.fireAt+1000);
 const q=await db.collection('v2NotificationDeliveries').where('uid','==','disabled').get();assert.equal(q.size,0);
});
test('15分以上遅れた通知は送らない',async()=>{
 await seed('expired');let sends=0;
 await deliver(db,async()=>{sends++;return 'no';},'expired',next.fireAt+16*60000);
 assert.equal(sends,0);
 const q=await db.collection('v2NotificationDeliveries').where('uid','==','expired').get();assert.equal(q.docs[0].data().status,'expired');
});
test('FCM結果が不明でも自動再送で重複させない',async()=>{
 await seed('uncertain');let sends=0;
 const send=async()=>{sends++;throw Object.assign(new Error('timeout'),{code:'messaging/unknown-error'});};
 await deliver(db,send,'uncertain',next.fireAt+1000);
 await deliver(db,send,'uncertain',next.fireAt+2000);
 assert.equal(sends,1);
 const q=await db.collection('v2NotificationDeliveries').where('uid','==','uncertain').get();assert.equal(q.docs[0].data().status,'failed-or-uncertain');
});
test.after(async()=>{await db.terminate();await deleteApp(app);});

test('認証拒否は1分後に再試行し、復旧後は一度だけ送る',async()=>{
 await seed('auth-recovery');let sends=0;
 const send=async()=>{sends++;if(sends===1)throw Object.assign(new Error('APNs'),{code:'messaging/third-party-auth-error'});return 'recovered';};
 await deliver(db,send,'auth-recovery',next.fireAt+1000);
 await deliver(db,send,'auth-recovery',next.fireAt+2000);assert.equal(sends,1);
 await Promise.all([deliver(db,send,'auth-recovery',next.fireAt+61000),deliver(db,send,'auth-recovery',next.fireAt+61000)]);
 assert.equal(sends,2);
 const q=await db.collection('v2NotificationDeliveries').where('uid','==','auth-recovery').get();
 assert.equal(q.docs[0].data().status,'accepted-by-fcm');assert.equal(q.docs[0].data().attempts,2);assert.equal(q.docs[0].data().code,undefined);
});
test('認証拒否が続いても15分を過ぎた通知は再送しない',async()=>{
 await seed('auth-expired');let sends=0;
 const send=async()=>{sends++;throw Object.assign(new Error('APNs'),{code:'messaging/third-party-auth-error'});};
 await deliver(db,send,'auth-expired',next.fireAt+1000);
 await deliver(db,send,'auth-expired',next.fireAt+16*60000);assert.equal(sends,1);
 const q=await db.collection('v2NotificationDeliveries').where('uid','==','auth-expired').get();assert.equal(q.docs[0].data().status,'expired');
});
test('認証拒否中のOFF・設定変更を古い送信が巻き戻さない',async()=>{
 for(const enabled of [true,false]) {
  const uid='auth-change-'+enabled;await seed(uid);const ref=db.collection('v2NotificationSubscriptions').doc(uid);
  await deliver(db,async()=>{
   await ref.update({revision:'r2',settings:{...settings,enabled},next:null,nextNotificationAt:null});
   throw Object.assign(new Error('APNs'),{code:'messaging/third-party-auth-error'});
  },uid,next.fireAt+1000);
  assert.equal((await ref.get()).data().next,null);assert.equal((await ref.get()).data().revision,'r2');
 }
});
test('過去の認証拒否も時刻を設定し直したら再送できる',async()=>{
 const uid='legacy-auth';await seed(uid);const {createHash}=require('node:crypto');
 const id=createHash('sha256').update(uid+':'+next.collectionDate).digest('hex');
 await db.collection('v2NotificationDeliveries').doc(id).set({uid,collectionDate:next.collectionDate,status:'failed-or-uncertain',code:'messaging/third-party-auth-error',createdAt:Timestamp.fromMillis(next.fireAt-60000)});
 let sends=0;await deliver(db,async()=>{sends++;return 'recovered';},uid,next.fireAt+1000);assert.equal(sends,1);
});
