'use strict';
const crypto = require('node:crypto');
const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { NAMES } = require('./grid-image');
const { renderPollImage } = require('./poll-image');
const LABELS = {fp1:'Practice 1',fp2:'Practice 2',fp3:'Practice 3',qualifying:'Qualifying',race:'Race',sprint:'Sprint','sprint-qualifying':'Sprint Qualifying'};
function parsePollSession(input, season) {
  let text=String(input || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  let slug='';
  const rules=[['sprint-qualifying',/\b(?:sprint\s+(?:qualifying|shootout)|sprint\s+quali)\b/],['fp1',/\b(?:fp\s*1|(?:free\s+)?practice\s*1)\b/],['fp2',/\b(?:fp\s*2|(?:free\s+)?practice\s*2)\b/],['fp3',/\b(?:fp\s*3|(?:free\s+)?practice\s*3)\b/],['qualifying',/\b(?:qualifying|quali|pole)\b/],['sprint',/\bsprint(?:\s+race)?\b/],['race',/\b(?:race|grand\s+prix\s+race)\b/]];
  for(const [key,re] of rules) {const match=text.match(re); if(match){slug=key;text=text.replace(re,' ').replace(/\s+/g,' ').trim();break;}}
  if(!slug || !text) return null;
  text=text.replace(/\b(?:grand prix|gp|2026|round)\b/g,' ').replace(/\s+/g,' ').trim();
  const matches=season.filter(e=>{
    const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
    const aliases=[e.slug,e.name,e.locality,e.country,`round ${e.round}`].map(norm);
    return aliases.some(a=>a===text || a===`${text} grand prix` || (text.length>=4 && a.startsWith(`${text} `)));
  });
  if(matches.length!==1) return null;
  const event=matches[0], session=event.sessions.find(s=>s.slug===slug);
  return session ? {event,session} : null;
}
function question(session) {
  if(/^fp[123]$/.test(session.slug)) return `Who will be fastest in ${session.name}?`;
  if(session.slug==='qualifying') return 'Who will take pole position?';
  if(session.slug==='sprint-qualifying') return 'Who will take sprint pole?';
  if(session.slug==='sprint') return 'Who will win the sprint?';
  return 'Who will win the race?';
}
function createPoll({guildId,channelId,event,session,drivers}) {
  return {id:crypto.randomBytes(12).toString('hex'),guildId:String(guildId),channelId:String(channelId),messageId:'',event:String(event.name).slice(0,100),session:String(session.name).slice(0,80),question:question(session),drivers:drivers.map(d=>({id:String(d.num),name:NAMES[d.code] || d.code,team:d.team})),votes:{},closed:false,createdAt:Date.now()};
}
function payload(poll) {
  const counts=Object.create(null);for(const id of Object.values(poll.votes || {})) counts[id]=(counts[id]||0)+1;
  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  const select = new StringSelectMenuBuilder().setCustomId(`freef1:poll:${poll.id}`).setPlaceholder(poll.closed?'Voting is closed':'Choose a driver · you can change your vote').setMinValues(1).setMaxValues(1).setDisabled(poll.closed).addOptions(poll.drivers.map(d=>({label:`${d.name} · ${d.team}`.slice(0,100),value:d.id})));
  const description = `${poll.question} ${poll.event}, ${poll.session}. ${poll.closed?'Voting closed.':'Voting open.'} ${poll.drivers.map(d=>`${d.name}: ${counts[d.id]||0}`).join('; ')}. Total: ${total} votes.`.slice(0,1024);
  return {files:[{attachment:renderPollImage(poll),name:'freef1-poll.png',description}],components:[new ActionRowBuilder().addComponents(select)],allowedMentions:{parse:[]}};
}
function createPollStore({upstash,redisKey='freef1:discordbot:v1',fileKey,readLocalJson,writeLocalJson,pollLockWaitMs=5000}) {
  const active=new Set(), localFile=fileKey ? `${fileKey}.polls.json` : '';
  const key=(guild,id)=>`${redisKey}:poll:v1:${guild}:${id}`;
  async function locked(guild,id,fn) {
    const k=key(guild,id), lock=k+':lock', token=crypto.randomBytes(16).toString('hex');
    const deadline=Date.now()+Math.max(0,Math.min(10000,pollLockWaitMs));
    while(active.has(k)) { if(Date.now()>=deadline) throw Error('This poll is busy; please try again.'); await new Promise(resolve=>setTimeout(resolve,100)); }
    active.add(k);let claimed=false;
    try {
      if(upstash){
        while(true){const reply=await upstash(['SET',lock,token,'NX','EX','30']);if(reply?.result==='OK'){claimed=true;break;}if(Date.now()>=deadline)throw Error('This poll is busy; please try again.');await new Promise(resolve=>setTimeout(resolve,100));}
      }
      const read=async()=>{if(upstash){const r=await upstash(['GET',k]);if(r?.result==null)return null;return JSON.parse(r.result);}if(!localFile||!readLocalJson)throw Error('Poll storage is not configured');return (readLocalJson(localFile)||{})[k]||null;};
      const write=async p=>{if(upstash){const r=await upstash(['SET',k,JSON.stringify(p)]);if(r?.result!=='OK')throw Error('Poll storage did not confirm the save');}else{if(!localFile||!writeLocalJson)throw Error('Poll storage is not configured');const all=readLocalJson(localFile)||{};all[k]=p;if(writeLocalJson(localFile,all)===false)throw Error('Poll storage did not confirm the save');}};
      return await fn(read,write);
    } finally {
      if(claimed) try{await upstash(['EVAL',"if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",'1',lock,token]);}catch(_){}
      active.delete(k);
    }
  }
  return {locked};
}
function voterKey(poll,userId) {return crypto.createHash('sha256').update(`${poll.id}:${poll.guildId}:${userId}`).digest('hex');}
module.exports={parsePollSession,question,createPoll,payload,createPollStore,voterKey};
