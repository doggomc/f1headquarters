'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {Resvg}=require('@resvg/resvg-js');const {PNG}=require('pngjs');
const {LOGOS}=require('./grid-image');
const COLORS={Ferrari:'#dc0000',Mercedes:'#00d2be',Mclaren:'#ff8000','Red Bull':'#0600ef','Aston Martin':'#006f62',Williams:'#005aff',Haas:'#e6e6e6',Audi:'#e62213','Racing Bulls':'#6692ff',Alpine:'#ff0080',Cadillac:'#b4a07a'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function pollSvg(poll) {
  const counts=Object.create(null);for(const choice of Object.values(poll.votes||{}))counts[choice]=(counts[choice]||0)+1;
  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  const groups=[];for(const d of poll.drivers){let group=groups.find(g=>g.team===d.team);if(!group){group={team:d.team,drivers:[]};groups.push(group);}group.drivers.push(d);}
  const height=350+groups.length*92+148;
  const rows=groups.map((g,i)=>{
    const y=350+i*92,slug=LOGOS[g.team],file=slug&&path.join(__dirname,'..','assets','team-logos',slug+'.png');
    const logo=file&&fs.existsSync(file)?`<image x="147" y="${y+7}" width="61" height="68" href="data:image/png;base64,${fs.readFileSync(file).toString('base64')}"/>`:'';
    const drivers=g.drivers.slice(0,2).map((d,j)=>{const x=410+j*277, count=counts[d.id]||0;return `<text x="${x}" y="${y+38}" fill="#f1f2f5" font-family="DejaVu Sans" font-size="16" font-weight="700">${esc(d.name)}</text><text x="${x}" y="${y+61}" fill="#aeb4bf" font-family="DejaVu Sans" font-size="13" font-weight="700">${esc(d.id)} · ${count} ${count===1?'vote':'votes'}</text>`;}).join('');
    return `<rect x="130" y="${y}" width="840" height="82" rx="14" fill="#212227" stroke="#ffffff" stroke-opacity=".09"/><rect x="130" y="${y+14}" width="5" height="54" rx="2.5" fill="${COLORS[g.team]||'#8c929e'}"/>${logo}<text x="218" y="${y+49}" fill="#fff" font-family="DejaVu Sans" font-size="19" font-weight="700">${esc(g.team==='Mclaren'?'McLaren':g.team)}</text>${drivers}`;
  }).join('');
  const footer=height-72;const title=esc(String(poll.question).slice(0,65));const titleSize=String(poll.question).length > 35 ? 35 : 45;const event=esc(String(poll.event).slice(0,42)),session=esc(String(poll.session).slice(0,32));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="${height}" viewBox="0 0 1100 ${height}"><defs><radialGradient id="bg" cx="50%" cy="0%" r="85%"><stop stop-color="#1b1e24"/><stop offset=".65" stop-color="#0e0f12"/><stop offset="1" stop-color="#0b0c0f"/></radialGradient><radialGradient id="card" cx="50%" cy="0%" r="80%"><stop stop-color="#212329"/><stop offset=".72" stop-color="#18191d"/><stop offset="1" stop-color="#18191d"/></radialGradient><clipPath id="clip"><rect width="1100" height="${height}" rx="26"/></clipPath></defs><g clip-path="url(#clip)"><rect width="1100" height="${height}" fill="url(#bg)"/><rect x="80" y="55" width="940" height="${height-110}" rx="24" fill="url(#card)" stroke="#fff" stroke-opacity=".12"/>
  <text x="130" y="140" fill="#fff" font-family="Archivo" font-size="${titleSize}" font-weight="700">${title}</text><text x="132" y="186" fill="#e4e5e9" font-family="DejaVu Sans" font-size="22" font-weight="700">${event} · ${session}</text><text x="132" y="222" fill="#a9abaf" font-family="DejaVu Sans" font-size="16" font-weight="700">${poll.closed?'Final results':'Choose a driver using the selector below.'}</text><rect x="130" y="250" width="190" height="38" rx="19" fill="${poll.closed?'#8c929e':'#22c55e'}" fill-opacity=".12" stroke="${poll.closed?'#8c929e':'#22c55e'}" stroke-opacity=".35"/><circle cx="151" cy="269" r="5" fill="${poll.closed?'#aeb4bf':'#4ade80'}"/><text x="166" y="275" fill="${poll.closed?'#cbd0d8':'#86efac'}" font-family="DejaVu Sans" font-size="14" font-weight="700">${poll.closed?'Poll closed':'Voting open'}</text><text x="970" y="277" text-anchor="end" fill="#e4e5e9" font-family="DejaVu Sans" font-size="17" font-weight="700">${total} ${total===1?'vote':'votes'}</text><path d="M130 320H970" stroke="#fff" stroke-opacity=".09"/>${rows}<path d="M130 ${height-126}H970" stroke="#fff" stroke-opacity=".08"/><rect x="130" y="${footer-36}" width="28" height="28" rx="8" fill="#d70600"/><svg x="136" y="${footer-30}" width="16" height="16" viewBox="0 0 24 24"><path d="M2 17.5L7.5 6.5h5.2l-2 4h4.6l-1.6 3.2H8.9l-1.7 3.8H2z" fill="#fff"/><path d="M14.5 6.5H22l-1.7 3.4h-7.5l1.7-3.4z" fill="#fff" opacity=".72"/></svg><text x="170" y="${footer-16}" fill="#dddfe4" font-family="Archivo" font-size="19" font-weight="700">FreeF1</text><text x="970" y="${footer-17}" text-anchor="end" fill="#a9abaf" font-family="DejaVu Sans" font-size="13" font-weight="700">${poll.closed?'Voting has ended':'You can change your vote while voting is open'}</text></g></svg>`;
}
function renderPollImage(poll) {
  const fonts=['DejaVuSans-Bold.ttf','Archivo-Bold.ttf'].map(f=>path.join(__dirname,'..','assets','fonts',f));
  const raw=new Resvg(pollSvg(poll),{font:{fontFiles:fonts,loadSystemFonts:false,defaultFontFamily:'DejaVu Sans'}}).render().asPng();
  return PNG.sync.write(PNG.sync.read(raw),{filterType:-1,deflateLevel:9,deflateStrategy:zlib.constants.Z_DEFAULT_STRATEGY});
}
module.exports={pollSvg,renderPollImage};
