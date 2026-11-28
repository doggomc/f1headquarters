'use strict';
const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const Module=require('node:module');const real=require('discord.js');const original=Module._load;
class FakeClient extends EventEmitter {constructor(){super();this.guilds={cache:new Map()}}login(){return Promise.resolve()}destroy(){}}
Module._load=function(name){if(name==='discord.js')return {...real,Client:FakeClient};return original.apply(this,arguments)};
const bot=require('../bot/discord-bot'),p=require('../bot/polls');const {pollSvg}=require('../bot/poll-image');const {PNG}=require('pngjs');Module._load=original;
const season=require('../bot/schedule-2026.json');
async function main(){
 for(const [input,slug] of [['Qatar fp3','fp3'],['Qatar quali','qualifying'],['Qatar race','race'],['São Paulo fp1','fp1'],['Las Vegas Practice 2','fp2']])assert.equal(p.parsePollSession(input,season)?.session.slug,slug);
 assert.equal(p.parsePollSession('Qatar sprint',season),null);assert.equal(p.parsePollSession('unreal fp1',season),null);
 assert.match(p.question({slug:'fp3',name:'Practice 3'}),/fastest/);assert.match(p.question({slug:'qualifying'}),/pole/);assert.match(p.question({slug:'race'}),/win/);
 const saved=new Map(),readLocalJson=f=>saved.has(f)?JSON.parse(saved.get(f)):null,writeLocalJson=(f,v)=>{saved.set(f,JSON.stringify(v));return true};
 const options={ownerId:'owner',token:'test',siteUrl:'https://freef1-live.vercel.app',fileKey:'/fake/bot',readLocalJson,writeLocalJson,log:()=>{}};
 const inst=bot.start(options);let sent,updates=0;const guild={id:'123456789012345678'},channel={id:'223456789012345678',messages:{fetch:async id=>{if(!sent || id!==sent.id)throw Error('not found');return sent;}},send:async payload=>{sent={id:'323456789012345678',payload,get components(){return this.payload.components.map(x=>x.toJSON())},edit:async function(x){this.payload=x;updates++;},delete:async()=>{}};return sent;}};
 async function fire(interaction){let done;const completed=new Promise(r=>done=r);interaction.reply=async x=>{interaction.answer=x;done()};interaction.deferReply=async()=>{interaction.deferred=true};interaction.editReply=async x=>{interaction.answer=x;done()};inst.client.emit(real.Events.InteractionCreate,interaction);await Promise.race([completed,new Promise((_,reject)=>setTimeout(()=>reject(Error('interaction timeout')),5000))]);return interaction.answer;}
 const base={guild,guildId:guild.id,channel,channelId:channel.id,user:{id:'owner'},isButton:()=>false,isStringSelectMenu:()=>false,isChatInputCommand:()=>true,commandName:'poll',options:{getString:()=> 'Qatar fp3'}};
 try {
  assert.match((await fire({...base,user:{id:'other'}})).content,/Owner-only/);assert(!sent);
  assert.match((await fire({...base})).content,/Poll posted/);let components=sent.payload.components.map(x=>x.toJSON());let menu=components[0].components[0];assert.equal(components.length,1);assert.equal(menu.options.length,22);assert.equal(sent.payload.embeds,undefined);assert.equal(PNG.sync.read(sent.payload.files[0].attachment).width,1100);assert.match(sent.payload.files[0].description,/fastest.*Practice 3/);assert.match(sent.payload.files[0].description,/Total: 0 votes/);
  const choose={guildId:guild.id,channelId:channel.id,message:sent,user:{id:'user1'},isButton:()=>false,isStringSelectMenu:()=>true,isChatInputCommand:()=>false,customId:menu.custom_id,values:['16']};
  assert.match((await fire({...choose})).content,/saved/);assert.match(sent.payload.files[0].description,/Charles Leclerc: 1/);assert.deepEqual(sent.payload.attachments,[]);assert.deepEqual(sent.payload.embeds,[]);
  await fire({...choose,values:['44']});assert.match(sent.payload.files[0].description,/Charles Leclerc: 0/);assert.match(sent.payload.files[0].description,/Lewis Hamilton: 1/);
  await fire({...choose,user:{id:'user2'},values:['44']});assert.match(sent.payload.files[0].description,/Total: 2 votes/);
  const stored=JSON.stringify([...saved.values()]);assert(!stored.includes('user1') && !stored.includes('user2'),'voter ids must not be stored in clear');
  const close={...base,commandName:'pollclose',options:{getString:()=>sent.id}};
  assert.match((await fire({...close,user:{id:'user1'}})).content,/Owner-only/);assert.match((await fire({...close})).content,/Poll closed/);assert(sent.payload.components[0].toJSON().components[0].disabled);assert.match((await fire({...choose})).content,/already closed/);
  assert.match((await fire({...close})).content,/already closed/);
  assert.match((await fire({...base,options:{getString:()=> 'Qatar sprint'}})).content,/not found/);
  const ps=p.createPollStore(options),id=menu.custom_id.split(':').pop();const storedPoll=await ps.locked(guild.id,id,read=>read());assert.equal(storedPoll.closed,true);assert.equal(Object.keys(storedPoll.votes).length,2);
  const remote=new Map(); const upstash=async cmd=>{const [op,k,v,...rest]=cmd;if(op==='SET'){if(rest.includes('NX')&&remote.has(k))return {result:null};remote.set(k,v);return {result:'OK'};}if(op==='GET')return {result:remote.get(k)??null};if(op==='EVAL'){const lock=cmd[3],token=cmd[4];if(remote.get(lock)===token)remote.delete(lock);return {result:1};}throw Error('unexpected command');};
  const r1=p.createPollStore({upstash,redisKey:'test'}),r2=p.createPollStore({upstash,redisKey:'test',pollLockWaitMs:100});let release;const waiting=new Promise(r=>release=r);let acquired;const started=new Promise(r=>acquired=r);
  const pending=r1.locked(guild.id,id,async(read,write)=>{await write({ok:true});acquired();await waiting;});await started;
  await assert.rejects(()=>r2.locked(guild.id,id,()=>{}),/busy/);release();await pending;
  assert.deepEqual(await r2.locked(guild.id,id,read=>read()),{ok:true});
  const bad=p.createPollStore({upstash:async()=>{throw Error('offline')}});await assert.rejects(()=>bad.locked(guild.id,id,()=>{}),/offline/);
  const imagePoll=await ps.locked(guild.id,id,read=>read());const svg=pollSvg(imagePoll);assert(svg.includes('Poll closed'));assert(svg.includes('Lewis Hamilton'));assert(svg.includes('2 votes'));
  assert(updates>=4);
  console.log('Polls: 22 drivers, owner creation/closing, live votes, changes, durable reload and privacy passed');
 }finally{inst.stop()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
