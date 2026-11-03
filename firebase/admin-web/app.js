const $ = s => document.querySelector(s);
const editor = $('#editor'), rules = $('#rules');
const iconImages = {"燃えるゴミ": "/icons/0.png", "燃えないゴミ": "/icons/1.png", "プラスチック": "/icons/2.png", "ビン・カン": "/icons/3.png", "ペットボトル": "/icons/4.png", "古紙": "/icons/5.png", "ダンボール": "/icons/6.png", "資源ゴミ": "/icons/7.png", "粗大ごみ": "/icons/8.png", "危険・有害": "/icons/9.png", "繊維": "/icons/10.png"};
const weekdays = ['日曜日','月曜日','火曜日','水曜日','木曜日','金曜日','土曜日'];
let bulkValid = false;
let originalValue = {};
let api, revision = 0, identity = null, districtId = null, items = [], next = null, pending, dirty = false;
const message = text => { $('#message').textContent = text; };
const today = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Tokyo'}).format(new Date());
editor.elements.checkedOn.max = today;
editor.elements.checkedOn.value = today;
function select(name, values, value) {
 const element = document.createElement('select'); element.name = name;
 values.forEach(v => element.add(new Option(v,v))); if(value) element.value = value; return element;
}
function input(name, type, value = '') {
 const element = document.createElement('input'); element.name = name; element.type = type; element.value = value; return element;
}
function label(text, element, parent) {
 const node = document.createElement('label'); node.append(text,element); parent.append(node); return element;
}
function addRule(value = {}) {
 if (rules.children.length >= 100) return message('収集ルールは100件までです。');
 const box = document.createElement('section'); box.className = 'rule'; box.originalRule=value;
 const title = document.createElement('div'); title.className = 'section-title';
 const caption = document.createElement('b'); caption.textContent = '収集ルール';
 const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '削除'; remove.setAttribute('aria-label','この収集ルールを削除');
 remove.onclick = () => { box.remove(); dirty = true; }; title.append(caption,remove); box.append(title);
 const type = label('ごみの種類',input('garbageType','text',value.garbageType),box); type.required=true; type.maxLength=80; type.placeholder='燃やすごみ、資源ごみ など';
 const icon = label('表示アイコン',select('iconType',['','燃えるゴミ','燃えないゴミ','プラスチック','ビン・カン','ペットボトル','古紙','ダンボール','資源ゴミ','粗大ごみ','危険・有害','繊維','資源（共通）'],value.iconType),box);
 icon.options[0].textContent='種類名から自動';
 const preview=document.createElement('div');preview.className='icon-preview';box.append(preview);
 const renderIcon=()=>{
  preview.replaceChildren();
  if(iconImages[icon.value]) {const image=document.createElement('img');image.src=iconImages[icon.value];image.alt=icon.value;image.width=44;image.height=44;preview.append(image);}
  const text=document.createElement('span');text.textContent=icon.value==='資源（共通）'?'♻ 資源の共通アイコン':icon.value || 'ごみの種類名に応じてアプリが選びます';preview.append(text);
 };icon.onchange=renderIcon;renderIcon();
 const schedule = label('収集頻度' ,select('schedule',['毎週','毎月','第○曜日','隔週','指定日のみ'],value.schedule),box);
 const details = document.createElement('div'); details.className='grid'; box.append(details);
 const render = () => {
  details.replaceChildren();
  if(schedule.value === '指定日のみ') label('指定日（カンマ区切り）',input('specificDates','text',(value.specificDates||[]).join(', ')),details);
  if(!['毎月','指定日のみ'].includes(schedule.value)) label('曜日',select('yobi',weekdays,value.yobi || '月曜日'),details);
  if(schedule.value === '毎月') { const day = label('毎月の日付',input('day','number',value.day || 1),details); day.min=1;day.max=31;day.required=true; }
  if(schedule.value === '第○曜日') label('第何週',select('weekOfMonth',['第一','第二','第三','第四','第五'],value.weekOfMonth),details);
  if(schedule.value === '隔週') { label('間隔',select('freqWeek',['二週に一回','三週に一回','四週に一回'],value.freqWeek),details); label('開始日（基準日）',input('strDate','date',value.strDate),details).required=true; }
 }; schedule.onchange=render; render();
 for(const [name,text] of [['excludedDates','収集しない日'],['additionalDates','追加で収集する日']]) {
  const node=label(text,input(name,'text',(value[name]||[]).join(', ')),box);node.placeholder='2026-12-31, 2027-01-01（カンマ区切り）';
 }
 rules.append(box);
}
function dates(value) {
 const result = value.split(/[,、\s]+/).filter(Boolean);
 if(result.length > 100) throw new Error('例外日は各100件までです。');
 if(result.some(day => !/^\d{4}-\d{2}-\d{2}$/.test(day) || isNaN(Date.parse(day)) || new Date(day).toISOString().slice(0,10)!==day)) throw new Error('例外日は YYYY-MM-DD の実在する日付をカンマで区切って入力してください。');
 return [...new Set(result)];
}
function collect(status, validate = true) {
 const value = Object.fromEntries(['prefecture','municipality','district','name','latitude','longitude','sourceUrl','checkedOn','notes','validFrom','validTo'].map(k=>[k,editor.elements[k].value.trim()]));
 if(!value.validFrom) delete value.validFrom; if(!value.validTo) delete value.validTo;
 value.latitude = Number(value.latitude); value.longitude = Number(value.longitude);
 if(districtId) value.districtId=districtId;
 value.status = status; if(districtId)value.expectedRevision = revision;
 if(validate && !/^https?:\/\//.test(value.sourceUrl)) throw new Error('出典URLは http または https のURLを入力してください。');
 value.rules = [...rules.children].map(box => {
  const r = Object.fromEntries([...box.querySelectorAll('input,select')].map(el=>[el.name,el.value.trim()]));
  for(const key of ['validFrom','validTo']) if(box.originalRule?.[key]) r[key]=box.originalRule[key];
  if(r.day) r.day = Number(r.day);
  if(!r.iconType) delete r.iconType;
  if(r.specificDates!==undefined) r.specificDates=dates(r.specificDates);
  r.excludedDates=dates(r.excludedDates);r.additionalDates=dates(r.additionalDates);
  if(r.excludedDates.some(d=>r.additionalDates.includes(d))) throw new Error('同じ日を「収集しない日」と「追加日」の両方に指定できません。');
  return r;
 });
 if(!value.rules.length) throw new Error('収集ルールを1件以上追加してください。');
 if(identity && identity !== JSON.stringify([value.prefecture,value.municipality,value.district])) throw new Error('既存地域の都道府県・市区町村・対象地区は変更できません。別の地域は「新しい地域」から登録してください。');
 return value;
}
function fill(value={}) {
 originalValue=structuredClone(value);
 for(const key of ['prefecture','municipality','district','name','latitude','longitude','sourceUrl','checkedOn','notes','validFrom','validTo']) editor.elements[key].value=value[key] ?? (key==='checkedOn'?today:'');
 rules.replaceChildren(); (value.rules?.length?value.rules:[{}]).forEach(addRule);
 districtId=value.districtId || value.id || null;
 revision=value.revision || 0;
 identity=revision?JSON.stringify([value.prefecture,value.municipality,value.district]):null;
 for (const key of ['prefecture','municipality','district']) editor.elements[key].readOnly = !!identity;
 document.querySelectorAll('.record').forEach(node=>node.setAttribute('aria-current',String(node.dataset.id===districtId)));
 $('#state').textContent = revision ? (value.status==='published'?'公開中':'下書き') : '新規作成'; dirty=false;
}
function renderRecords() {
 const target=$('#records'), scroll=target.scrollTop, pageY=window.scrollY;target.replaceChildren();const term=$('#search').value.trim();
 const filtered=items.filter(v=>[v.name,v.prefecture,v.municipality,v.district].join(' ').includes(term));
 for(const item of filtered) {
  const button=document.createElement('button');button.type='button';button.className='record';button.textContent=item.name;button.dataset.id=item.id;button.setAttribute('aria-current',String(item.id===districtId));
  const sub=document.createElement('small');sub.textContent=`${item.status==='published'?'● 公開中':'○ 下書き'} · ${item.checkedOn}`;button.append(sub);
  button.onclick=()=>{if(!dirty || confirm('未保存の入力を破棄して地域を開きますか？'))fill(item);};target.append(button);
 }
 if(!filtered.length) target.textContent='該当する地域はありません。'; $('#more').hidden=!next;target.scrollTop=scroll;window.scrollTo({top:pageY,behavior:'instant'});
}
let loading = false;
let loadedArea = null;
async function load(more=false) {
 if(loading)return;
 const area={prefecture:$('#list-prefecture').value.trim(),municipality:$('#list-municipality').value.trim()};
 if(!area.prefecture || !area.municipality){$('#list-status').textContent='都道府県と市区町村を入力してください。';return;}
 if(more && JSON.stringify(area)!==JSON.stringify(loadedArea))more=false;
 loading=true;
 try {
  const result=await api('listAdminSchedulesV2',{...area,...(more && next?{after:next}:{})});
  items=more?[...items,...result.items]:result.items;next=result.next;loadedArea=area;renderRecords();
  $('#list-status').textContent=`${area.prefecture} ${area.municipality}：${items.length}地区を表示${next?'（続きがあります）':''}。`;
 } catch(error){message('一覧取得に失敗しました：'+error.message);}
 finally{loading=false;}
}
function updateRecords(saved) {
 for(const value of saved) {
  const item={...value,id:value.id || value.districtId};
  const index=items.findIndex(v=>v.id===item.id);
  if(index<0)items.push(item);else items[index]=item;
  if(districtId===item.id && !dirty)fill(item);
 }
 renderRecords();
}
function busy(value){for(const node of document.querySelectorAll('button'))node.disabled=value;for(const node of document.querySelectorAll('#bulk-input,#bulk-file'))node.disabled=value;if(!value){$('#bulk-save').disabled=!bulkValid;$('#bulk-publish').disabled=!bulkValid;}}
async function save(value) {
 busy(true);
 try {
  const patch={...value};
  if(districtId)for(const key of Object.keys(patch))if(!['districtId','expectedRevision','status'].includes(key) && JSON.stringify(patch[key])===JSON.stringify(originalValue[key]))delete patch[key];
  const result=await api('saveAdminScheduleV2',patch);
  const saved=result.district || {...originalValue,...value,id:result.id,revision:result.revision};fill(saved);
  message(value.status==='published'?'公開しました。アプリの近隣検索に表示されます。':'下書きを保存しました。アプリには表示されません。');
  $('#confirmation').close();updateRecords([saved]);
 } catch(error){message('保存できませんでした：'+error.message);$('#confirmation').close();}
 finally{busy(false);}
}
editor.addEventListener('input',()=>dirty=true);
editor.addEventListener('change',()=>dirty=true);
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
$('#add').onclick=()=>{addRule();dirty=true;};
$('#new').onclick=()=>{if(!dirty || confirm('未保存の入力を破棄して新しく作成しますか？'))fill();};
$('#reload').onclick=()=>load();$('#more').onclick=()=>load(true);$('#search').oninput=renderRecords;
editor.onsubmit=event=>{
 event.preventDefault();
 try {
  const value=collect(event.submitter?.dataset.status || 'draft');
  if(value.status==='draft') return save(value);
  pending=value;const summary=$('#summary');summary.replaceChildren();
  const title=document.createElement('b');title.textContent=value.name;summary.append(title);
  const region=document.createElement('p');region.textContent=`${value.prefecture} ${value.municipality} ${value.district} / 緯度 ${value.latitude}・経度 ${value.longitude}`;summary.append(region);
  const list=document.createElement('ul');for(const r of value.rules){const item=document.createElement('li');item.textContent=[r.garbageType,`アイコン：${r.iconType || '種類名から自動'}`,r.schedule,r.weekOfMonth,r.yobi,r.day?`${r.day}日`:'',r.freqWeek,r.specificDates?.join('、'),r.strDate?`基準日 ${r.strDate}`:'',r.excludedDates.length?`休止 ${r.excludedDates.join('、')}`:'',r.additionalDates.length?`追加 ${r.additionalDates.join('、')}`:''].filter(Boolean).join(' / ');list.append(item);}summary.append(list);
  const source=document.createElement('a');source.href=value.sourceUrl;source.textContent=value.sourceUrl;source.target='_blank';source.rel='noopener noreferrer';summary.append(source);
  const checked=document.createElement('p');checked.textContent=`確認日：${value.checkedOn}`;summary.append(checked);$('#confirmation').showModal();
 }catch(error){message(error.message);}
};
$('#cancel').onclick=()=>$('#confirmation').close();$('#publish').onclick=()=>save(pending);
$('#local').onclick=()=>{try{localStorage.setItem('regional-schedule-draft',JSON.stringify({...collect('draft',false),revision}));dirty=false;message('この端末に保存しました。サーバーには未登録です。');}catch(error){message('端末への保存に失敗しました：'+error.message);}};
$('#restore').onclick=()=>{try{const value=JSON.parse(localStorage.getItem('regional-schedule-draft'));if(!value)return message('この端末には下書きがありません。');if(!dirty||confirm('入力を端末の下書きに置き換えますか？')){fill(value);dirty=true;message('端末の下書きを復元しました。');}}catch{message('下書きを復元できませんでした。');}};
fill();
// Send JSON requests to the same-origin management API.
api=async(name,data)=>{
 const response=await fetch('/api/'+name,{method:'POST',credentials:'omit',
  headers:{'Content-Type':'application/json','X-Admin-Request':'1'},body:JSON.stringify(data)});
 const result=await response.json();
 if(!response.ok)throw new Error(result.error || '接続できませんでした。入力内容はこの画面に残っています。');
 return result;
};
$('#list-status').textContent='対象の市区町村を指定して表示できます。';

let bulkPlan = [], bulkOutcome = null;
const bulkMessage = text => $('#bulk-message').textContent = text;
function downloadJSON(value,name) {
 const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function invalidateBulk(){bulkValid=false;bulkPlan=[];$('#bulk-publish').disabled=true;$('#bulk-save').disabled=true;bulkMessage('入力を変更しました。保存前に検証してください。');}
$('#bulk-input').oninput=invalidateBulk;
$('#bulk-file').onchange=async()=>{const f=$('#bulk-file').files[0];if(!f)return;if(f.size>2000000)return bulkMessage('JSONは2MB以内にしてください。');$('#bulk-input').value=await f.text();invalidateBulk();};
function renderBulk(rows,preview) {
 const target=$('#bulk-results');target.replaceChildren();
 for(const row of rows) {
  const section=document.createElement('section');section.className='rule';
  const title=document.createElement('label');
  if(preview && row.result!=='error') {const check=document.createElement('input');check.type='checkbox';check.checked=true;check.dataset.index=row.inputIndex;title.append(check);}
  title.append(`${row.inputIndex+1}. ${row.name || row.districtId || '地区'} — ${row.result} / ${row.savedStatus || ''}`);section.append(title);
  const detail=document.createElement('details'),caption=document.createElement('summary');caption.textContent='項目・ルール数・品目別日付差分／エラーを確認';detail.append(caption);
  const pre=document.createElement('pre');pre.textContent=JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k])=>!['input','baseFingerprint','inputFingerprint'].includes(k))),null,2);detail.append(pre);section.append(detail);target.append(section);
 }
}
async function previewBulkUI(payload) {
 busy(true);try {const data=await api('previewAdminBulkV2',payload);bulkPlan=data.results;bulkValid=bulkPlan.some(r=>r.result!=='error');renderBulk(bulkPlan,true);bulkMessage('検証完了。差分を確認し、保存する地区を選択してください。形式検証は公式情報の正しさや公開承認を保証しません。');}
 catch(e){bulkValid=false;bulkPlan=[];bulkMessage(e.message);}finally{busy(false);$('#bulk-save').disabled=!bulkPlan.some(r=>r.result!=='error');$('#bulk-publish').disabled=!bulkPlan.some(r=>r.result!=='error'&&r.expectedDatesMatch!==false);$('#bulk-download').disabled=!bulkOutcome;$('#bulk-saved').disabled=!bulkOutcome;$('#bulk-retry').disabled=!bulkOutcome?.results.some(r=>['error','conflict'].includes(r.result));}
}
$('#bulk-preview').onclick=()=>{try{return previewBulkUI(JSON.parse($('#bulk-input').value));}catch(e){invalidateBulk();bulkMessage('JSONの構文を確認してください：'+e.message);}};
function selectedEntries(){
 const selected=[...$('#bulk-results').querySelectorAll('input:checked')].map(c=>Number(c.dataset.index));
 return bulkPlan.filter(r=>r.result!=='error'&&selected.includes(r.inputIndex));
}
async function commitBulk(entries,publish=false){
 if(!bulkValid)return bulkMessage('再検証してから操作してください。');
 if(!entries.length)return bulkMessage('地区を選択してください。');
 bulkValid=false;
 busy(true);try{bulkOutcome=await api('saveAdminBulkV2',{entries,...(publish?{publish:true}:{})});bulkOutcome.results.push(...bulkPlan.filter(r=>r.result==='error').map(({input,...row})=>row));bulkOutcome.results.sort((a,b)=>a.inputIndex-b.inputIndex);updateRecords(bulkOutcome.districts);renderBulk(bulkOutcome.results,false);bulkMessage('一括処理が完了しました。結果とDBから読み直したJSONをダウンロードできます。各地区の公開状態・エラーを確認してください。');}
 catch(e){bulkMessage('結果を取得できませんでした。再検証して保存状態を確認してください：'+e.message);}
 finally{busy(false);$('#bulk-save').disabled=true;$('#bulk-publish').disabled=true;$('#bulk-download').disabled=!bulkOutcome;$('#bulk-saved').disabled=!bulkOutcome;$('#bulk-retry').disabled=!bulkOutcome?.results.some(r=>['error','conflict'].includes(r.result));}
};
let pendingBulk=[];
$('#bulk-save').onclick=()=>commitBulk(selectedEntries());
$('#bulk-publish').onclick=()=>{
 pendingBulk=selectedEntries();
 if(!pendingBulk.length)return bulkMessage('公開する地区を選択してください。');
 if(pendingBulk.some(r=>r.expectedDatesMatch===false))return bulkMessage('公式日付と一致しない地区があります。修正して再検証してください。');
 const target=$('#bulk-summary');target.replaceChildren();
 for(const row of pendingBulk){
  const section=document.createElement('section');
  const title=document.createElement('h3');title.textContent=row.name;section.append(title);
  const pre=document.createElement('pre');pre.textContent=JSON.stringify({...row.previewValue,status:'published'},null,2);section.append(pre);target.append(section);
 }
 $('#bulk-confirm-count').textContent=`選択した${pendingBulk.length}地区を公開します。対象地区・収集ルール・例外日・有効期間・出典・確認日を確認してください。`;
 $('#bulk-confirmation').showModal();
};
$('#bulk-cancel').onclick=()=>$('#bulk-confirmation').close();
$('#bulk-confirm-publish').onclick=()=>{const entries=pendingBulk;pendingBulk=[];$('#bulk-confirmation').close();return commitBulk(entries,true);};
$('#bulk-download').onclick=()=>bulkOutcome&&downloadJSON(bulkOutcome,'bulk-results.json');
$('#bulk-saved').onclick=()=>bulkOutcome&&downloadJSON({districts:bulkOutcome.districts},'saved-districts.json');
$('#bulk-retry').onclick=()=>{const failed=bulkOutcome.results.filter(r=>['error','conflict'].includes(r.result)).map(r=>r.inputIndex);const input=bulkPlan.filter(r=>failed.includes(r.inputIndex)).map(r=>r.input);$('#bulk-input').value=JSON.stringify(input,null,2);return previewBulkUI(input);};
// Explicit manual backup: each page is read once, never part of registration.
let exporting=false;
$('#bulk-export').onclick=async()=>{
 if(exporting || !confirm('全地区を取得してバックアップします。通信量が増えます。実行しますか？'))return;
 exporting=true;busy(true);
 try{
  const districts=[],seen=new Set();let cursor=null;
  do{
   const page=await api('listAdminSchedulesV2',{backup:true,...(cursor?{after:cursor}:{})});
   for(const {id,...row} of page.items){if(seen.has(id))throw new Error('地区が重複しています。');seen.add(id);districts.push({...row,districtId:id});}
   if(page.next && (page.next===cursor || page.next!==page.items.at(-1)?.id))throw new Error('取得位置が不正です。');
   cursor=page.next;
  }while(cursor);
  downloadJSON({districts},'districts.json');bulkMessage(`${districts.length}地区をバックアップしました。取得中の変更は混在する場合があります。`);
 }catch(e){bulkMessage(e.message);}finally{exporting=false;busy(false);}
};
