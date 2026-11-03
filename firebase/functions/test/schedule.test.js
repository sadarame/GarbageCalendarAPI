const test = require('node:test');
const assert = require('node:assert/strict');
const {ruleSchema,settingsSchema,matches,nextOccurrence}=require('../lib/schedule');
const base={garbageType:'燃えるゴミ'};
const settings={enabled:true,previousDay:false,hour:7,minute:15,timeZone:'Asia/Tokyo'};
const rule={...base,schedule:'毎週',yobi:'火曜日'};
test('前日指定は月曜20時、日本時間で計算',()=>{
 const next=nextOccurrence([rule],{...settings,previousDay:true,hour:20,minute:0},Date.parse('2026-10-04T00:00:00+09:00'));
 assert.equal(next.collectionDate,'2026-10-06');
 assert.equal(new Date(next.fireAt).toISOString(),'2026-10-05T11:00:00.000Z');
});
test('OFFなら送信対象なし',()=>assert.equal(nextOccurrence([rule],{...settings,enabled:false},Date.now()),null));
test('同日の複数種をまとめ、重複ルールを重複通知しない',()=>{
 const next=nextOccurrence([rule,rule,{...rule,garbageType:'古紙'}],settings,Date.parse('2026-10-05T00:00:00+09:00'));
 assert.equal(next.types.length,2);
});
test('月末31日は存在しない月を飛ばす',()=>{
 const next=nextOccurrence([{...base,schedule:'毎月',day:31}],settings,Date.parse('2026-01-31T08:00:00+09:00'));
 assert.equal(next.collectionDate,'2026-03-31');
});
test('元旦収集の前日は前年末',()=>{
 const next=nextOccurrence([{...base,schedule:'毎月',day:1}],{...settings,previousDay:true},Date.parse('2025-12-30T00:00:00+09:00'));
 assert.equal(new Date(next.fireAt).toISOString(),'2025-12-30T22:15:00.000Z');
 assert.equal(next.collectionDate,'2026-01-01');
});
test('第5日曜日は月をはみ出さない',()=>{
 const r={...base,schedule:'第○曜日',yobi:'日曜日',weekOfMonth:'第五'};
 assert.equal(matches(r,'2026-02-01'),false);
 assert.equal(matches(r,'2026-03-29'),true);
});
test('隔週は開始日・曜日・週数で計算し年越し対応',()=>{
 const r={...base,schedule:'隔週',yobi:'水曜日',strDate:'2025-12-29',freqWeek:'二週に一回'};
 assert.equal(matches(r,'2025-12-24'),false);
 assert.equal(matches(r,'2025-12-31'),true);
 assert.equal(matches(r,'2026-01-07'),false);
 assert.equal(matches(r,'2026-01-14'),true);
});
test('送信済み時刻より後の予定へ進む',()=>{
 const first=nextOccurrence([rule],settings,Date.parse('2026-10-05T00:00:00+09:00'));
 const second=nextOccurrence([rule],settings,first.fireAt);
 assert.equal(second.fireAt-first.fireAt,7*86400000);
});
test('日付・時刻・ルールの不正入力を拒否',()=>{
 assert.equal(ruleSchema.safeParse({...base,schedule:'隔週',yobi:'月曜日',strDate:'2026-02-30',freqWeek:'二週に一回'}).success,false);
 assert.equal(settingsSchema.safeParse({...settings,hour:24}).success,false);
 assert.equal(ruleSchema.safeParse({...base,schedule:'毎週',yobi:'Monday'}).success,false);
});

test('例外日：通常の収集を休止し、振替先に追加する',()=>{
 const changed={...rule,excludedDates:['2026-10-06'],additionalDates:['2026-10-07']};
 assert.equal(matches(changed,'2026-10-06'),false);
 assert.equal(matches(changed,'2026-10-07'),true);
 assert.equal(matches(changed,'2026-10-13'),true);
 const next=nextOccurrence([changed],{...settings,previousDay:true,hour:20,minute:0},Date.parse('2026-10-05T00:00:00+09:00'));
 assert.equal(next.collectionDate,'2026-10-07');
 assert.equal(new Date(next.fireAt).toISOString(),'2026-10-06T11:00:00.000Z');
});
test('例外日は休止優先、不正日・過剰件数を拒否',()=>{
 assert.equal(matches({...rule,excludedDates:['2026-10-06'],additionalDates:['2026-10-06']},'2026-10-06'),false);
 assert.equal(ruleSchema.safeParse({...rule,additionalDates:['2026-02-30']}).success,false);
 assert.equal(ruleSchema.safeParse({...rule,excludedDates:Array(101).fill('2026-10-06')}).success,false);
});
