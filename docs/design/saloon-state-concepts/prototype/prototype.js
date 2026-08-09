const ASSET = '../';

// Rects are pixels in the generated source boards. Hotspots are normalized to the crop.
const screens = {
  landing: { image:'01-landing.png', rect:[0,0,1672,941], title:'Choose a path', note:'Pick a complete walkthrough.', hotspots:[
    { id:'friend', label:'Play together', box:[.225,.70,.155,.095], to:'source-selector' },
    { id:'solo', label:'Play solo', box:[.425,.70,.155,.095], to:'solo-ready' },
    { id:'join', label:'Join game', box:[.625,.70,.155,.095], to:'join-form' }
  ]},
  'source-selector': { image:'13-hosted-library.png', rect:[1024,512,512,512], title:'Choose a game source', note:'Hosted games are always ready; local files are optional.', hotspots:[
    {id:'hosted',label:'Hosted library',box:[.12,.28,.38,.48],to:'hosted-library'},
    {id:'local',label:'My local files',box:[.53,.28,.38,.48],to:'host-ready'}
  ]},
  'hosted-library': { image:'13-hosted-library.png', rect:[0,0,512,512], title:'Pick a hosted game', note:'Search, filter, favorite, or choose from games QuarterLink is authorized to provide.', hotspots:[
    {id:'sundered',label:'Sundered Skies',box:[.35,.35,.30,.26],to:'hosted-detail'},
    {id:'empty',label:'Empty search state',box:[.08,.20,.84,.08],to:'hosted-empty'},
    {id:'unavailable',label:'Unavailable game',box:[.07,.35,.27,.26],to:'hosted-unavailable'}
  ]},
  'hosted-detail': { image:'13-hosted-library.png', rect:[512,0,512,512], title:'Hosted game details', note:'This licensed title is always ready for a one- or two-player room.', hotspots:[
    {id:'open-room',label:'Open room with this game',box:[.20,.72,.62,.11],to:'persistent-room'},
    {id:'back',label:'Back to library',box:[.06,.73,.12,.10],to:'hosted-library'}
  ]},
  'persistent-room': { image:'13-hosted-library.png', rect:[1024,0,512,512], title:'Your persistent room', note:'Your hosted shelf stays available; invite a friend whenever you want.', hotspots:[
    {id:'invite',label:'Invite a friend',box:[.67,.18,.27,.10],to:'lobby-ready'},
    {id:'change',label:'Change game',box:[.07,.60,.24,.09],to:'hosted-library'}
  ]},
  'hosted-empty': { image:'13-hosted-library.png', rect:[0,512,512,512], title:'No games found', note:'Reset the search without losing the room or library.', hotspots:[{id:'reset',label:'Reset search',box:[.34,.65,.31,.10],to:'hosted-library'}]},
  'hosted-unavailable': { image:'13-hosted-library.png', rect:[512,512,512,512], title:'Temporarily unavailable', note:'Maintenance is explicit and another hosted game remains one click away.', hotspots:[{id:'another',label:'Pick another game',box:[.49,.61,.42,.10],to:'hosted-library'}]},
  'solo-ready': { image:'02-solo-setup.png', rect:[768,0,384,500], title:'Solo setup', note:'The free test game is ready.', hotspots:[{id:'start',label:'Continue',box:[.30,.80,.55,.10],to:'solo-loading'}]},
  'solo-loading': { image:'08-loading.png', rect:[388,510,374,490], title:'Solo loading', note:'No room or network is created.', auto:'solo-game', delay:1500, hotspots:[{id:'skip',label:'Skip loader',box:[0,0,1,1],to:'solo-game'}]},
  'solo-game': { image:'09-gameplay.png', rect:[0,0,836,470], title:'Solo gameplay', note:'Local game. Open the menu or finish the path.', hotspots:[{id:'menu',label:'Game menu',box:[.82,.03,.11,.10],to:'solo-menu'},{id:'home',label:'End run',box:[.03,.03,.12,.10],to:'solo-end'}]},
  'solo-menu': { image:'10-menus-diagnostics.png', rect:[324,0,324,870], title:'Game menu', note:'Solo mode omits connection diagnostics in the real product.', hotspots:[{id:'end',label:'End session',box:[.13,.68,.75,.09],to:'solo-end'},{id:'close',label:'Close menu',box:[.12,.82,.76,.08],to:'solo-game'}]},
  'solo-end': { image:'12-confirmations-mobile.png', rect:[463,175,178,190], title:'End solo run?', note:'Confirm to return to the prototype landing.', hotspots:[{id:'cancel',label:'Cancel',box:[.08,.74,.39,.18],to:'solo-game'},{id:'confirm',label:'End run',box:[.52,.74,.40,.18],to:'landing'}]},
  'host-ready': { image:'03-host-setup.png', rect:[38,505,470,330], title:'Host setup', note:'Name and source are valid.', hotspots:[{id:'create',label:'Create private room',box:[.09,.66,.82,.13],to:'lobby-wait'}]},
  'lobby-wait': { image:'05-host-lobby.png', rect:[310,54,300,425], title:'Host lobby', note:'Copy the single-use invite link.', hotspots:[{id:'copy',label:'Copy invite link',box:[.14,.72,.76,.10],to:'lobby-ready'}]},
  'lobby-ready': { image:'05-host-lobby.png', rect:[610,488,305,440], title:'Both players ready', note:'Every readiness check has cleared.', hotspots:[{id:'start',label:'Start the run',box:[.14,.72,.73,.10],to:'friend-loading'}]},
  'friend-loading': { image:'08-loading.png', rect:[388,0,374,500], title:'Opening the arcade', note:'Connection is established; emulator is starting.', auto:'friend-game', delay:1500, hotspots:[{id:'skip',label:'Skip loader',box:[0,0,1,1],to:'friend-game'}]},
  'friend-game': { image:'09-gameplay.png', rect:[0,470,836,471], title:'Friend gameplay', note:'Measured connection quality is now visible.', hotspots:[{id:'details',label:'Connection details',box:[.20,.02,.26,.11],to:'diagnostics'},{id:'menu',label:'Game menu',box:[.82,.03,.11,.10],to:'friend-menu'}]},
  'friend-menu': { image:'10-menus-diagnostics.png', rect:[324,0,324,870], title:'Game menu', note:'Open diagnostics or end the room.', hotspots:[{id:'details',label:'Connection details',box:[.12,.48,.76,.09],to:'diagnostics'},{id:'end',label:'End session',box:[.12,.68,.76,.09],to:'friend-end'},{id:'close',label:'Close menu',box:[.12,.82,.76,.08],to:'friend-game'}]},
  diagnostics: { image:'10-menus-diagnostics.png', rect:[972,0,324,870], title:'Connection details', note:'Network RTT is not total input-to-screen latency.', hotspots:[{id:'back',label:'Back to game',box:[.05,.15,.16,.09],to:'friend-game'}]},
  'friend-end': { image:'12-confirmations-mobile.png', rect:[278,175,178,190], title:'End friend session?', note:'The room and invite will stop working.', hotspots:[{id:'cancel',label:'Cancel',box:[.08,.74,.39,.18],to:'friend-game'},{id:'confirm',label:'End session',box:[.52,.74,.40,.18],to:'landing'}]},
  'join-form': { image:'04-join.png', rect:[418,0,418,418], title:'Join with an invite', note:'A complete link, including its # fragment, is required.', hotspots:[{id:'join',label:'Join game',box:[.27,.60,.52,.10],to:'guest-lobby'},{id:'error',label:'See invalid invite',box:[.27,.73,.52,.08],to:'join-error'}]},
  'join-error': { image:'04-join.png', rect:[836,418,418,418], title:'Invite unavailable', note:'Invalid, expired, full, and network failures share this recovery family.', hotspots:[{id:'retry',label:'Try again',box:[.23,.68,.58,.11],to:'join-form'}]},
  'guest-lobby': { image:'06-guest-lobby.png', rect:[710,0,355,805], title:'Guest ready', note:'Player 2 waits for the host to start.', hotspots:[{id:'home',label:'Back to landing',box:[.04,.90,.92,.07],to:'landing'}]}
};

const paths = {
  solo: ['landing','solo-ready','solo-loading','solo-game','solo-menu','solo-end'],
  friends: ['landing','source-selector','hosted-library','hosted-detail','persistent-room','lobby-ready','friend-loading','friend-game','diagnostics','friend-end']
};

let current = 'landing'; let history = []; let timer = null; let activePath = null; let walkthrough = false;
const stage = document.querySelector('#stage'); const art = document.querySelector('#art'); const hotspotLayer = document.querySelector('#hotspots');
const title = document.querySelector('#path-title'); const note = document.querySelector('#screen-note'); const steps = document.querySelector('#path-steps'); const bbox = document.querySelector('#bbox-readout'); const tap = document.querySelector('#tap');

function render(id, push=true) {
  clearTimeout(timer); if (push && id !== current) history.push(current); current=id; const s=screens[id];
  art.classList.add('enter');
  const img=new Image(); img.src=ASSET+s.image; img.alt='';
  img.onload=()=>{ const [x,y,w,h]=s.rect; const sw=stage.clientWidth, sh=stage.clientHeight; const scale=Math.max(sw/w,sh/h); img.style.width=`${img.naturalWidth*scale}px`; img.style.height=`${img.naturalHeight*scale}px`; img.style.left=`${(sw-w*scale)/2-x*scale}px`; img.style.top=`${(sh-h*scale)/2-y*scale}px`; art.replaceChildren(img); requestAnimationFrame(()=>art.classList.remove('enter')); };
  hotspotLayer.replaceChildren(); s.hotspots.forEach(h=>{const b=document.createElement('button');b.className='hotspot';b.dataset.label=h.label;b.setAttribute('aria-label',h.label);const [x,y,w,hg]=h.box;Object.assign(b.style,{left:`${x*100}%`,top:`${y*100}%`,width:`${w*100}%`,height:`${hg*100}%`});b.onmouseenter=()=>showBox(h);b.onfocus=()=>showBox(h);b.onclick=e=>{tap.style.left=`${e.clientX-stage.getBoundingClientRect().left}px`;tap.style.top=`${e.clientY-stage.getBoundingClientRect().top}px`;tap.classList.remove('play');void tap.offsetWidth;tap.classList.add('play');render(h.to);};hotspotLayer.append(b);});
  title.textContent=s.title; note.textContent=s.note; renderSteps(); bbox.textContent=`screen: ${id}\nsource: ${s.image}\ncrop: [${s.rect.join(', ')}]`;
  if (s.auto) timer=setTimeout(()=>render(s.auto),s.delay);
}
function showBox(h){bbox.textContent=`screen: ${current}\nhotspot: ${h.id}\nnormalized: [${h.box.join(', ')}]\ntarget: ${h.to}`;}
function renderSteps(){const list=activePath?paths[activePath]:[];steps.replaceChildren(...list.map(id=>{const li=document.createElement('li');li.textContent=screens[id].title;const ci=list.indexOf(current),i=list.indexOf(id);if(i<ci)li.className='done';if(i===ci)li.className='current';return li;}));}
function beginPath(name){activePath=name;walkthrough=true;history=[];render(paths[name][0],false);setTimeout(()=>advanceWalkthrough(),700);}
function advanceWalkthrough(){if(!walkthrough||!activePath)return;const list=paths[activePath],i=list.indexOf(current);if(i<0||i===list.length-1){walkthrough=false;return;}const primary=screens[current].hotspots.find(h=>h.to===list[i+1]);if(!primary){walkthrough=false;return;}const [x,y,w,h]=primary.box;tap.style.left=`${(x+w/2)*100}%`;tap.style.top=`${(y+h/2)*100}%`;tap.classList.remove('play');void tap.offsetWidth;tap.classList.add('play');setTimeout(()=>{render(primary.to);setTimeout(advanceWalkthrough,screens[primary.to].auto?1900:1100);},450);}
document.addEventListener('click',e=>{const c=e.target.closest('[data-command]');if(!c)return;const cmd=c.dataset.command;if(cmd==='path')beginPath(c.dataset.path);if(cmd==='toggle-hotspots'){stage.classList.toggle('show-hotspots');c.setAttribute('aria-pressed',String(stage.classList.contains('show-hotspots')));}if(cmd==='back'&&history.length)render(history.pop(),false);if(cmd==='restart'){walkthrough=false;history=[];activePath=null;render('landing',false);}});
window.addEventListener('resize',()=>render(current,false));
render('landing',false);
