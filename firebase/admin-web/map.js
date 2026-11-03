'use strict';
const $ = selector => document.querySelector(selector);
const svg=$('#japan-svg');
function japan(){svg.setAttribute('viewBox','0 0 950 960');}
function highlight(){
 const name=$('#prefecture').value;
 document.querySelectorAll('.pref-region').forEach(node=>node.setAttribute('aria-pressed',String(node.dataset.prefecture===name)));
 $('#map-selection').textContent=name||'都道府県を選んでください';
 $('#fit').disabled=!name;
}
let items=[],filtered=[],selected=null,loading=false,loadedArea=null,requestVersion=0,controller=null;
const address = item => [item.prefecture,item.municipality,item.district].filter(Boolean).join(' ');
const normalize = text => text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,'');
function element(tag,text,className){const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;}
function popup(group){const box=element('div','','popup-list');for(const item of group){const row=element('div','','popup-row');row.append(element('strong',item.name||address(item),'popup-title'),element('p',address(item)),element('p',`${item.status==='published'?'公開中':'下書き'} · 情報確認日 ${item.checkedOn||'未登録'}`));box.append(row);}return box;}
function render(){
 const term=normalize($('#search').value),pref=$('#prefecture').value,status=$('#status').value;
 filtered=items.filter(item=>(!term||normalize(address(item)+' '+(item.name||'')).includes(term))&&(!pref||item.prefecture===pref)&&(!status||item.status===status));
 const visible=filtered;highlight();
 $('#count').textContent=loadedArea ? `${visible.length.toLocaleString()} 件 / 選択地域 ${items.length.toLocaleString()} 件` : '地域を選択してください';
 const records=$('#records');records.replaceChildren();
 if(!visible.length)records.append(element('p',items.length?'該当する住所がありません。検索条件を変えてお試しください。':(loadedArea?'この市区町村には登録済みの地区がありません。':'都道府県・市区町村を選び「この地域を表示」を押してください。'),'empty'));
 for(const item of visible){const button=element('button','','record');button.setAttribute('aria-current',String(selected===item.id));button.append(element('span',item.status==='published'?'公開中':'下書き',`badge ${item.status==='published'?'':'draft'}`),element('strong',item.name||item.district||'名称未設定'),element('small',address(item)),element('small',`確認日 ${item.checkedOn||'未登録'}　詳細を見る`));button.onclick=()=>{selected=item.id;render();$('#area-detail').replaceChildren(popup([item]));};records.append(button);}
}

const prefectures='北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県'.split(' ');
$('#prefecture').append(...prefectures.map(p=>new Option(p,p)));
function cancelAndClear(){
 requestVersion++;controller?.abort();controller=null;loading=false;loadedArea=null;items=[];selected=null;$('#area-detail').replaceChildren();
 for(const id of ['total','published','draft-count'])$('#'+id).textContent='—';
 $('#reload').disabled=true;$('#load-area').disabled=!$('#municipality').value;
 $('#message').textContent='';$('#search').value='';render();
}
async function api(name,body,signal){
 const response=await fetch('/api/'+name,{method:'POST',headers:{'Content-Type':'application/json','x-admin-request':'1'},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
 if(!response.ok)throw new Error('取得に失敗しました');return response.json();
}
const municipalityCache=new Map();
async function choosePrefecture(){
 $('#municipality').replaceChildren(new Option('先に都道府県を選択',''));$('#municipality').disabled=true;cancelAndClear();
 const prefecture=$('#prefecture').value;if(!prefecture)return;
 const version=requestVersion;controller=new AbortController();$('#message').textContent='市区町村の候補を取得中…';
 try{
  const data=municipalityCache.get(prefecture)||await api('listMapMunicipalities',{prefecture},controller.signal);
  if(version!==requestVersion)return;
  if(!Array.isArray(data.municipalities))throw new Error('不正な候補');
  municipalityCache.set(prefecture,data);
  $('#municipality').replaceChildren(new Option(data.municipalities.length?'市区町村を選択':'登録済みの市区町村はありません',''),...data.municipalities.map(name=>new Option(name,name)));
  $('#municipality').disabled=!data.municipalities.length;$('#message').textContent=data.municipalities.length?'':'この都道府県には登録済みの地区がありません。';
 }catch(error){if(version!==requestVersion)return;$('#message').textContent='候補を取得できませんでした。「候補を再取得」で再試行してください。';$('#load-area').textContent='候補を再取得';$('#load-area').disabled=false;}
}
async function load(){
 const prefecture=$('#prefecture').value,municipality=$('#municipality').value;
 if(!prefecture||!municipality||loading)return;
 cancelAndClear();const version=requestVersion;controller=new AbortController();loading=true;
 $('#load-area').disabled=true;$('#message').textContent=`${prefecture} ${municipality} を読み込み中…`;
 try{
  const loaded=[];let cursor=null;const seen=new Set();
  do{
   const data=await api('listMapSchedules',{prefecture,municipality,...(cursor?{after:cursor}:{})},controller.signal);
   if(version!==requestVersion)return;
   if(!Array.isArray(data.items))throw new Error('不正なデータ');
   loaded.push(...data.items);cursor=data.next;if(cursor&&seen.has(cursor))throw new Error('ページ取得に失敗');seen.add(cursor);
   $('#message').textContent=`${municipality} の${loaded.length}件を読み込み中…`;
  }while(cursor);
  items=loaded;loadedArea={prefecture,municipality};
  $('#total').textContent=items.length.toLocaleString();$('#published').textContent=items.filter(i=>i.status==='published').length.toLocaleString();$('#draft-count').textContent=items.filter(i=>i.status!=='published').length.toLocaleString();
  $('#message').textContent='';render();
 }catch(error){if(version!==requestVersion)return;$('#message').textContent='取得に失敗しました。「この地域を表示」で再試行してください。';}
 finally{if(version===requestVersion){loading=false;$('#load-area').disabled=false;$('#reload').disabled=!loadedArea;}}
}
$('#prefecture').onchange=()=>{$('#load-area').textContent='この地域を表示';choosePrefecture();};
$('#municipality').onchange=cancelAndClear;
$('#load-area').onclick=()=>{if($('#load-area').textContent==='候補を再取得'){$('#load-area').textContent='この地域を表示';choosePrefecture();}else load();};
for(const id of ['search','status'])$('#'+id).addEventListener(id==='search'?'input':'change',()=>{$('#area-detail').replaceChildren();render();});
$('#reload').onclick=load;$('#japan').onclick=japan;
$('#fit').onclick=()=>{
 const node=[...document.querySelectorAll('.pref-region')].find(n=>n.dataset.prefecture===$('#prefecture').value);
 if(!node)return;const b=node.querySelector('path').getBBox(),padding=30;
 svg.setAttribute('viewBox',`${b.x-padding} ${b.y-padding} ${b.width+padding*2} ${b.height+padding*2}`);
};
for(const node of document.querySelectorAll('.pref-region')){
 const select=()=>{$('#prefecture').value=node.dataset.prefecture;$('#prefecture').onchange();};
 node.addEventListener('click',select);node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}});
}
render();
