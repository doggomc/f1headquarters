'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freef1-manager-'));
  const logs = path.join(dir, 'remote.log');
  const stub = path.join(dir, 'fetch-stub.cjs');
  fs.writeFileSync(stub, `const fs=require('fs');const original=global.fetch;global.fetch=async (input,init)=>{const url=String(input);if(url.startsWith('https://')){await new Promise(r=>setTimeout(r,30));fs.appendFileSync(process.env.MANAGER_FETCH_LOG,url+'\\n');if(url.includes('/admin/peaks'))return new Response(JSON.stringify({current:{total:4,pages:{home:3,cockpit:1,'secret-source':9},streams:[{label:'SECRET_SOURCE'}]}}),{status:200});if(url.includes('/api/stream/auto'))return new Response(JSON.stringify({streams:[{label:'Test F1',provider:'weelo',url:'https://example.com',tag:'Weelo'}],updatedAt:1,window:{active:true}}),{status:200});return new Response('',{status:200});}return original(input,init);};`);
  const store = new Map(); let storageOnline = true;
  const redis = http.createServer((req,res) => { let data=''; req.on('data',x=>data+=x); req.on('end',()=>{
    if (!storageOnline) { res.writeHead(503); return res.end(); }
    const run = ([op,key,value,mode]) => { if(op==='GET')return {result:store.get(key)||null}; if(op==='SET'){if(mode==='NX'&&store.has(key))return {result:null};store.set(key,value);return {result:'OK'};} if(op==='DEL'){store.delete(key);return {result:1};}return {result:null};};
    const input=JSON.parse(data);res.setHeader('content-type','application/json');res.end(JSON.stringify(Array.isArray(input[0])?input.map(run):run(input)));
  });});
  redis.listen(0,'127.0.0.1'); await once(redis,'listening');
  const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
  const base=`http://127.0.0.1:${port}`; let child;
  async function start() {
    child=spawn(process.execPath,['-r',stub,'server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,NODE_ENV:'test',PORT:String(port),DATA_DIR:path.join(dir,'data'),CONTROL_ROLE:'headquarters',HQ_INITIALIZE:'true',HQ_PUSH_SECRET:'test-shared-secret',HQ_UPSTASH_REDIS_REST_URL:`http://127.0.0.1:${redis.address().port}`,HQ_UPSTASH_REDIS_REST_TOKEN:'test',ADMIN_USER:'owner',ADMIN_PASS:'owner-pass',ADMIN_SECRET:'test-cookie-secret',MANAGER_FETCH_LOG:logs,DISCORD_BOT_TOKEN:''},stdio:'ignore'});
    for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok)return;}catch{}await sleep(50);} throw Error('HQ startup failed');
  }
  async function stop(){if(child?.exitCode===null){child.kill();await once(child,'exit');}}
  async function login(username,password){const res=await fetch(base+'/admin/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});const cookie=(res.headers.get('set-cookie')||'').split(',').map(x=>x.trim().split(';')[0]).join('; ');return {res,cookie};}
  const post=(path,cookie,body)=>fetch(base+'/admin/api'+path,{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify(body)});
  const get=(path,cookie)=>fetch(base+'/admin/api'+path,{headers:{cookie}});
  try {
    await start();
    const owner=await login('owner','owner-pass');assert.equal(owner.res.status,200);
    const manager=await login('Manager','Manager');assert.equal(manager.res.status,200);assert.equal((await manager.res.json()).role,'manager');
    assert.equal((await (await get('/status',manager.cookie)).json()).role,'manager');
    for (const path of ['/config','/headquarters','/viewer-peaks','/manager-access']) assert.equal((await get(path,manager.cookie)).status,401,`${path} denied`);
    for (const path of ['/manager-access','/maintenance','/stream/auto','/reset-all','/headquarters/sync']) assert.equal((await post(path,manager.cookie,{enabled:false,active:true})).status,401,`${path} denied`);
    assert.equal((await post('/stream/auto',owner.cookie,{enabled:true})).status,200);
    const [first,second]=await Promise.all([get('/manager/snapshot',manager.cookie),get('/manager/snapshot',manager.cookie)]);
    assert.equal(first.status,200);assert.equal(second.status,200);const snapshot=await first.json();assert.equal(snapshot.audience[0].current.total,4);assert.equal(snapshot.audience[0].current.pages.home,3,'home audience preserved');assert.equal(snapshot.services.length,4);assert(!('automatic' in snapshot) && !('manual' in snapshot) && !('autoStreams' in snapshot),'manager API returns no source lists'); assert(!JSON.stringify(snapshot).includes('SECRET_SOURCE') && !JSON.stringify(snapshot).includes('secret-source'),'counter context is allowlisted');
    const calls=fs.readFileSync(logs,'utf8').trim().split('\n');assert.equal(calls.length,6,'two counter and four health requests, coalesced'); assert(!calls.some(url=>url.includes('/api/stream/auto')),'never fetches source lists');
    assert.equal((await get('/manager/snapshot',manager.cookie)).status,200);assert.equal(fs.readFileSync(logs,'utf8').trim().split('\n').length,12,'subsequent refresh requests fresh data');
    for (let i=0;i<3;i++) assert.equal((await get('/manager/snapshot',manager.cookie)).status,200);
    const limited=await get('/manager/snapshot',manager.cookie); assert.equal(limited.status,429,'excessive refreshes are bounded'); assert(limited.headers.get('retry-after'));
    assert.equal((await post('/manager-access',owner.cookie,{enabled:false})).status,200);
    assert.equal((await get('/manager/snapshot',manager.cookie)).status,401,'disabled session revoked');
    assert.equal((await login('Manager','Manager')).res.status,401,'disabled login rejected');
    await stop(); await start(); const owner2=await login('owner','owner-pass');assert.equal((await login('Manager','Manager')).res.status,401,'disabled flag survives restart');
    assert.equal((await post('/manager-access',owner2.cookie,{enabled:true})).status,200);
    assert.equal((await get('/manager/snapshot',manager.cookie)).status,401,'old cookie remains revoked after re-enable');
    const fresh=await login('Manager','Manager');assert.equal(fresh.res.status,200);
    storageOnline=false;assert.equal((await post('/manager-access',owner2.cookie,{enabled:false})).status,503,'failed write does not falsely report success');
    assert.equal((await get('/manager/snapshot',fresh.cookie)).status,401,'uncertain storage write fails closed');
    console.log('Manager: read-only isolation, fresh snapshots, coalescing, persistence and revocation passed');
  } finally {await stop();await new Promise(r=>redis.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
