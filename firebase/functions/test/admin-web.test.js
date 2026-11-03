const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createAdminWebHandler} = require('../lib/admin-web');
const {z} = require('zod');
const headers = {origin:'https://garbagecalendar-region-admin.web.app','x-admin-request':'1','content-type':'application/json'};
async function request(path, options={}) {
  const calls=[];
  const handler=createAdminWebHandler({
    mapMunicipalities:async body=>{calls.push(["mapMunicipalities",body]);return {municipalities:[]};},
    mapSchedules:async body=>{calls.push(["mapSchedules",body]);return {items:[],next:null};},
    previewBulk:async body=>{calls.push(['previewBulk',body]);return {results:[]};},
    saveBulk:async body=>{calls.push(['saveBulk',body]);return {results:[],districts:[]};},
    exportBulk:async body=>{calls.push(['exportBulk',body]);return {districts:[]};},
    list:async body=>{calls.push(['list',body]);return {items:[],next:null};},
    save:async body=>{calls.push(['save',body]);if(options.error)throw options.error;return {revision:2};}});
  const req={path,method:options.method || 'GET',body:options.body || {},
    get:name=>({...headers,...options.headers})[name],is:type=>({...headers,...options.headers})['content-type']===type};
  const res={statusCode:200,headers:{},set(key,value){if(typeof key==='object')Object.assign(this.headers,key);else this.headers[key]=value;return this;},
    status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},
    type(type){this.headers['Content-Type']=type;return this;},send(body){this.body=body;return this;},end(){return this;}};
  await handler(req,res);return {...res,calls};
}
test('pages and assets are available without authentication',async()=>{
  for(const path of ['/','/index.html','/app.js','/style.css','/map','/map.html','/map.js','/map.css','/vendor/leaflet.js','/vendor/leaflet.css']) {
    const res=await request(path);
    assert.equal(res.statusCode,200);
    assert.equal(res.headers['WWW-Authenticate'],undefined);
    assert.equal(res.headers['Cache-Control'],'private, no-store');
  }
});
test('public page has no token form and assets are served from allowlist',async()=>{
  const res=await request('/');assert.equal(res.statusCode,200);
  assert.doesNotMatch(res.body.toString(),/loginForm|一時ログイントークン/);
  assert.equal((await request('/../admin-web.js')).statusCode,404);
  assert.equal((await request('/constructor')).statusCode,404);
});
test('CSRF, foreign origins, non-JSON and GET cannot write',async()=>{
  for(const override of [{origin:undefined},{origin:'https://attacker.example'},{'x-admin-request':undefined},{'content-type':'text/plain'}]) {
    const res=await request('/api/saveAdminScheduleV2',{method:'POST',headers:override});
    assert.equal(res.statusCode,403);assert.deepEqual(res.calls,[]);
  }
  assert.equal((await request('/api/saveAdminScheduleV2')).statusCode,405);
});
test('APIs without credentials delegate to validated shared operations and preserve errors',async()=>{
  let res=await request('/api/listAdminSchedulesV2',{method:'POST'});assert.deepEqual(res.body,{items:[],next:null});
  res=await request('/api/saveAdminScheduleV2',{method:'POST',body:{expectedRevision:1}});
  assert.deepEqual(res.calls,[['save',{expectedRevision:1}]]);assert.equal(res.body.revision,2);
  assert.equal((await request('/api/saveAdminScheduleV2',{method:'POST',error:{code:'aborted',message:'conflict'}})).statusCode,409);
  assert.equal((await request('/api/saveAdminScheduleV2',{method:'POST',error:new z.ZodError([])})).statusCode,400);
});

test('bulk HTTP routes keep same-origin JSON and POST guards',async()=>{
 for(const [name,action] of [['previewAdminBulkV2','previewBulk'],['saveAdminBulkV2','saveBulk'],['exportAdminBulkV2','exportBulk']]) {
  const path='/api/'+name;
  const ok=await request(path,{method:'POST',body:{test:true}});assert.deepEqual(ok.calls,[[action,{test:true}]]);
  assert.equal((await request(path)).statusCode,405);
  for(const headers of [{origin:'https://attacker.example'},{'x-admin-request':undefined},{'content-type':'text/plain'}]) {
   const blocked=await request(path,{method:'POST',headers});assert.equal(blocked.statusCode,403);assert.deepEqual(blocked.calls,[]);
  }
 }
});

 test('map and editor retain strict policies without external map tiles',async()=>{
  const map=await request('/map');
  assert.doesNotMatch(map.headers['Content-Security-Policy'],/unsafe-inline|openstreetmap/);
  const editor=await request('/');
  assert.doesNotMatch(editor.headers['Content-Security-Policy'],/unsafe-inline|openstreetmap/);
 });

test('map read routes preserve same-origin guards',async()=>{
 for(const [route,action] of [['listMapMunicipalities','mapMunicipalities'],['listMapSchedules','mapSchedules']]) {
  const body={prefecture:'埼玉県',municipality:'草加市'};
  assert.deepEqual((await request('/api/'+route,{method:'POST',body})).calls,[[action,body]]);
  assert.equal((await request('/api/'+route,{method:'POST',headers:{origin:'https://other.example'}})).statusCode,403);
 }
});
