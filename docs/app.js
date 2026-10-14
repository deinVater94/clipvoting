// Firebase wird erst im echten Betrieb geladen; der deutlich markierte Demo-Modus
// funktioniert so ohne externe SDK-Anfragen.
let initializeApp, getAuth, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut, setPersistence, browserSessionPersistence, browserLocalPersistence, inMemoryPersistence;
let getFirestore, collection, doc, getDoc, getDocs, query, where, limit, setDoc, updateDoc, deleteDoc, serverTimestamp, onSnapshot;
import {firebaseConfig} from './firebase-config.js';
import {CATEGORIES,category} from './categories.js';

const NAV=[['home','⌂','Startseite'],['submit','↥','Clip einreichen'],['swipe','♡','Swipe-Arena'],['top3','★','Top 3'],['clips','▦','Clip-Archiv'],['results','♛','Ergebnisse']];
const PHASE_NAMES={collect:'Clip-Sammlung',swipe:'Swipe-Voting',top3:'Top-3-Voting',counting:'Auswertung',show:'Nikis Awardshow',archived:'Archiviert'};
const DEMO_TITLES=[
 ['Der Lachflash im Stream','Niki kann nicht mehr','Chat löst Lachkrampf aus','Der schlechteste Witz gewinnt','Komplett aus dem Nichts','Lachflash im falschen Moment'],
 ['Der legendäre Brainlag','Chat sagt NEIN','Niki drückt den falschen Knopf','Was war der Plan?','Der 5-IQ-Move','Das Eigentor des Monats'],
 ['Was passiert hier eigentlich?','Die absurdeste Wendung','Der unerklärliche Zufall','Wo kam das denn her?','Der randomste Satz','Chaos in drei Sekunden'],
 ['Niki gegen den Endgegner','Das Mikro hat aufgegeben','Niki.exe wird beendet','Der Rage seines Lebens','Überforderung hoch zehn','Ein letzter Nerv'],
 ['Perfekter Plot-Twist','Besser als Hollywood','Timing auf die Millisekunde','Der unfassbare Treffer','Die große Überraschung','Legendäre Szene']
];
const demoClips=CATEGORIES.flatMap((cat,ci)=>DEMO_TITLES[ci].map((title,i)=>({
  id:`demo-${ci}-${i}`,edition:'DEMO',category:cat.id,status:'approved',title,
  creatorName:'demo_creator_'+(i+1),twitchClipId:'',url:'',thumbnail:'',top10:true,finalist:i<6,
  finalPoints:(6-i)*4,duration:20+i*3,createdAtTwitch:'2026-10-01T12:00:00Z'
})));
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl=s=>{try{const u=new URL(s);return u.protocol==='https:'?u.toString():'';}catch{return '';}};
const niceDate=s=>{try{return new Date(s).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});}catch{return '';}};
function parseClipId(input){try{const url=new URL(input.trim());if(url.protocol!=='https:'||!['clips.twitch.tv','www.twitch.tv','twitch.tv','m.twitch.tv'].includes(url.hostname.toLowerCase()))return null;const p=url.pathname.split('/').filter(Boolean);const id=url.hostname==='clips.twitch.tv'?p[0]:(p.length===3&&p[1]==='clip'?p[2]:null);return /^[A-Za-z0-9_-]{3,120}$/.test(id||'')?id:null;}catch{return null;}}
const isConfigured=!!firebaseConfig.apiKey&&!firebaseConfig.apiKey.startsWith('DEINE_')&&!!firebaseConfig.projectId&&!firebaseConfig.projectId.startsWith('DEIN-');
let auth=null,db=null,unsubscribeRole=null;
if(isConfigured){
  const [fbApp,fbAuth,fbDb] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js')
  ]);
  ({initializeApp}=fbApp);
  ({getAuth,onAuthStateChanged,signInAnonymously,signInWithEmailAndPassword,createUserWithEmailAndPassword,sendPasswordResetEmail,signOut,setPersistence,browserSessionPersistence,browserLocalPersistence,inMemoryPersistence}=fbAuth);
  ({getFirestore,collection,doc,getDoc,getDocs,query,where,limit,setDoc,updateDoc,deleteDoc,serverTimestamp,onSnapshot}=fbDb);
  const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);
  // Anonyme Stimmen bleiben lokal für die Browserkennung gespeichert.
  // Nur Team-Logins erhalten die kürzere Browser-Tab-Persistenz.
}
const state={page:(new URLSearchParams(window.location.search).get('team')==='login'||window.location.hash==='#team-login'?'admin-login':'home'),authReady:!isConfigured,demo:!isConfigured,config:{edition:'DEMO',phase:'collect',prizeLabel:'Shop-Gutschein',prizeAmount:'noch offen'},clips:[],submissions:[],swipes:new Map(),top3:new Map(),winners:[],moderators:[],currentUser:null,isAdmin:false,isOwner:false,permissions:{moderateClips:false,managePhases:false},swipeCategory:'laugh',top3Category:'laugh',filter:'all',picks:[],loading:false,showIndex:0};
const demoVotes=(()=>{try{return JSON.parse(localStorage.getItem('niki_demo_swipes_v3')||'{}');}catch{return {};}})();
state.clips=state.demo?demoClips:[];
const isValidPhase=phase=>['collect','swipe','top3','show','archived'].includes(phase);
function notify(message,error=false){const el=$('#flash');el.textContent=message;el.className=error?'error':'';el.style.display='block';window.clearTimeout(notify.timeout);notify.timeout=window.setTimeout(()=>{el.style.display='none';},7500);}
const canModerate=()=>state.isOwner||state.permissions.moderateClips===true;
const canManagePhases=()=>state.isOwner||state.permissions.managePhases===true;
function canUse(page){if(page==='show')return state.authReady&&state.isOwner;if(page==='admin')return state.authReady&&state.isAdmin;return true;}
function navTo(page){if(!canUse(page))page='home';state.page=page;if(page==='top3')state.picks=[];render();window.scrollTo({top:0,behavior:'smooth'});}
function chip(text){return `<span class="pill">${esc(text)}</span>`;}
function renderNav(){
  const admin=state.authReady&&state.isAdmin;
  const list=[...NAV,...(admin?[...(state.isOwner?[['show','▶','Show-Modus']]:[]),['admin','⚙','Administration']]:[])];
  $('#desktop-nav').innerHTML=list.map(([page,icon,text])=>`<button class="nav ${state.page===page?'active':''}" data-action="go" data-page="${page}"><span>${icon}</span>${esc(text)}</button>`).join('')+(admin?'<button class="nav" data-action="logout"><span>⎋</span> Abmelden</button>':'');
  const mobile=[...NAV.slice(0,4),...(admin?[['admin','⚙','Team'],...(state.isOwner?[['show','▶','Show']]:[])]:[])];
  $('#mobile-nav').innerHTML=mobile.map(([page,icon,text])=>`<button class="${state.page===page?'active':''}" data-action="go" data-page="${page}"><span>${icon}</span>${esc(text)}</button>`).join('')+(admin?'<button data-action="logout">Abmelden</button>':'');
}
function sectionHead(title,note=''){return `<div class="section-bar"><h2>${title}</h2>${note?chip(note):''}</div>`;}
function notice(text,good=false){return `<div class="notice ${good?'good-note':''}">${text}</div>`;}
function categoriesHtml(){return `<div class="category-grid">${CATEGORIES.map(c=>`<button class="category-card" data-action="category-swipe" data-cat="${c.id}"><span class="emoji">${c.icon}</span><strong>${esc(c.title)}</strong><small>${esc(c.subtitle)}</small></button>`).join('')}</div>`;}
function categoryOptions(selected){return CATEGORIES.map(c=>`<option value="${c.id}" ${selected===c.id?'selected':''}>${esc(c.icon+' '+c.title)}</option>`).join('');}
function clipThumb(c,play=true){const img=c.thumbnail&&safeUrl(c.thumbnail)?`<img src="${esc(safeUrl(c.thumbnail))}" loading="lazy" alt="Vorschaubild des Twitch-Clips">`:`<span style="font-size:44px;opacity:.6">${category(c.category).icon}</span>`;return `<div class="thumb">${img}${play&&c.url?'<span class="play">▶</span>':''}</div>`;}
function clipCard(c){return `<article class="clip-card">${clipThumb(c)}<div class="clip-info">${chip(category(c.category).icon+' '+category(c.category).title)}<h3 style="margin-top:13px">${esc(c.title)}</h3><div class="clip-meta">Clip von @${esc(c.creatorName)} · ${niceDate(c.createdAtTwitch)}</div><div class="row"><button class="btn secondary small" data-action="play" data-id="${esc(c.id)}" ${!c.url?'disabled':''}>▶ Clip ansehen</button>${state.isAdmin?`<span class="status ${esc(c.status)}">${esc(c.status)}</span>`:''}</div></div></article>`;}
function phaseHelp(){switch(state.config.phase){case 'collect':return 'Jetzt können Clips eingereicht werden. Das Voting startet später.';case 'swipe':return 'Die erste Abstimmungsrunde läuft: Like oder Weiter!';case 'top3':return 'Wähle aus den Top 10 deine persönlichen drei Favoriten pro Kategorie.';case 'counting':return 'Wir zählen gerade die Stimmen. Gleich geht es weiter.';case 'show':return 'Die 30 Finalisten stehen fest – Niki entscheidet live.';default:return 'Die Edition ist vorbei. Danke fürs Mitmachen!';}}
function home(){let count=state.clips.length;return `<div class="hero"><div class="eyebrow">✦ COMMUNITY X NIKI</div><h1>LEGENDÄRE CLIPS.<br><span>LEGENDÄRE AWARDS.</span></h1><p>Ihr reicht die Clips ein, ihr votet die sechs besten Momente je Kategorie – und Niki kürt live den Gewinner. Fünf Kategorien. Fünf Shop-Gutscheine. Eine Show.</p><div class="row"><button class="btn" data-action="go" data-page="${state.config.phase==='collect'?'submit':state.config.phase==='top3'?'top3':'swipe'}">${state.config.phase==='collect'?'Clip einreichen ↗':state.config.phase==='top3'?'Top 3 wählen ↗':'Jetzt mitmachen ↗'}</button><button class="btn secondary" data-action="go" data-page="clips">Alle Clips ansehen</button></div></div>
  <div class="stats"><div class="stat"><strong>${count}</strong><small>${state.demo?'Demo-Clips':'freigegebene Clips'}</small></div><div class="stat"><strong>05</strong><small>Award-Kategorien</small></div><div class="stat"><strong>30</strong><small>Finalisten · maximal</small></div></div>
  ${state.demo?notice('<strong>Layout-Vorschau:</strong> Firebase ist noch nicht eingerichtet. Die gezeigten Titel sind erfundene Demo-Clips; Stimmen sind nur lokal in deinem Browser gespeichert.'):notice('<strong>Aktuelle Phase:</strong> '+esc(PHASE_NAMES[state.config.phase]||state.config.phase)+' – '+esc(phaseHelp()),true)}
  <section class="section">${sectionHead('Fünf Kategorien','5 AWARDS')}${categoriesHtml()}</section>
  <section class="section">${sectionHead('So läuft\'s ab')}<div class="two-col"><div class="panel"><span class="tag">01 — Die Community</span><h3>Einreichen, swipen, Top 3 wählen.</h3><p>Nur Twitch-Clips von Niki. Die zehn Favoriten pro Kategorie treten in Runde 2 gegeneinander an. Sechs schaffen es in die Show.</p></div><div class="panel"><span class="tag">02 — Der Stream</span><h3>Niki hat das letzte Wort.</h3><p>Er schaut sich die Finalisten an und entscheidet pro Kategorie über genau einen Gewinner. Der ursprüngliche Clip-Ersteller erhält einen Gutschein.</p></div></div></section>
  <section class="section">${sectionHead('Clip-Vorschau','AUS DER COMMUNITY')}<div class="clip-grid">${state.clips.slice(0,3).map(clipCard).join('')||'<div class="empty">Noch keine freigegebenen Clips. Reiche den ersten ein!</div>'}</div></section>`;}
function submitPage(){const open=state.config.phase==='collect'||state.demo;return `<div class="page-head"><div class="eyebrow">DEIN MOMENT FÜR DIE SHOW</div><h1>CLIP EINREICHEN.</h1><p>Du hast einen legendären Niki-Moment gefunden? Schick uns den Twitch-Clip-Link und wähle eine Award-Kategorie. Eine Anmeldung ist dafür nicht nötig.</p></div><div class="two-col"><div class="panel"><h2>Einreichung</h2>${state.demo?notice('Demo-Modus: Formular ist sichtbar, sendet aber keine Daten.'):''}${!open?notice('Die Einreichungsphase ist beendet. Neue Clips können erst in der nächsten Edition eingereicht werden.'):''}<form id="submit-form" class="stack"><div class="field"><label for="clip-url">Twitch-Clip-Link</label><input class="input" id="clip-url" name="url" type="url" required placeholder="https://clips.twitch.tv/DeinClip" maxlength="350" ${!open?'disabled':''}><small>Nur öffentlich verfügbare Clips von twitch.tv/niki8einhalb. Die Prüfung erfolgt über die Twitch-API.</small></div><div class="field"><label for="submit-cat">Kategorie</label><select class="select" id="submit-cat" name="category" ${!open?'disabled':''}>${categoryOptions('laugh')}</select></div><div class="field"><button class="btn" ${!open?'disabled':''}>↥ Clip zur Prüfung einreichen</button><small>Maximal fünf Einreichungen pro anonymer Firebase-ID und Edition. Nach einer erfolgreichen Twitch-Prüfung wird der Clip automatisch freigegeben.</small></div></form></div><div class="panel"><h3>Wichtig zu wissen</h3><p>Der Gutschein geht an den <strong>ursprünglichen Twitch-Clip-Ersteller</strong>, nicht an denjenigen, der den Clip-Link einreicht.</p><p>Gültige Twitch-Clips werden automatisch freigeschaltet; Moderatoren können sie nachträglich ausblenden. Doppelte Links werden zusammengeführt. Die Clips müssen aus der aktuellen Edition stammen (UTC-Monat).</p><p>Wir laden keine Videodateien hoch. Die Videos bleiben auf Twitch und werden dort abgespielt.</p></div></div>`;}
function orderedClips(cat){let items=state.clips.filter(c=>c.category===cat&&c.status==='approved');const key=(s)=>{let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};const seed=state.currentUser?.uid||'demo-'+(localStorage.getItem('niki_demo_seed')||'preview');return items.sort((a,b)=>key(seed+':'+a.id)-key(seed+':'+b.id));}
function getSeen(c){return state.demo?demoVotes[c.id]:state.swipes.get(c.id)?.choice;}
function swipePage(){const cat=state.swipeCategory,clips=orderedClips(cat);const unseen=clips.filter(c=>!getSeen(c));const current=unseen[0];const done=clips.length-unseen.length;const allowed=state.config.phase==='swipe'||state.demo;return `<div class="page-head"><div class="eyebrow">VOTING · RUNDE 1</div><h1>SWIPE & LIKE.</h1><p>Schau dir die Clips an und entscheide: ❤️ Like oder ✕ Weiter. Die Reihenfolge ist pro Besucherkonto durchmischt. Die Likes bleiben bis zum Ende der Runde verborgen.</p></div><div class="row" style="margin-bottom:22px"><select class="select" id="swipe-category" style="max-width:350px" aria-label="Kategorie für Swipe-Voting">${categoryOptions(cat)}</select>${chip(done+' / '+clips.length+' bewertet')}</div>${!allowed?notice('Die Swipe-Runde ist derzeit nicht geöffnet. '+esc(phaseHelp())):''}${!clips.length?'<div class="empty">In dieser Kategorie gibt es noch keine geprüften Clips.</div>':!current?`<div class="empty"><div class="icon">🎉</div><h2>Alle Clips durch!</h2><p>Du hast diese Kategorie vollständig bewertet. Danke fürs Mitmachen!</p><button class="btn secondary" data-action="category-swipe" data-cat="${CATEGORIES[(CATEGORIES.findIndex(c=>c.id===cat)+1)%5].id}">Nächste Kategorie →</button></div>`:`<article class="panel card-swipe"><div class="swipe-head">${chip(category(cat).icon+' '+category(cat).title)}<span class="status">${done+1} / ${clips.length}</span></div><button class="swipe-media" data-action="play" data-id="${esc(current.id)}" ${!current.url?'disabled':''} aria-label="Clip abspielen">${current.thumbnail&&safeUrl(current.thumbnail)?`<img src="${esc(safeUrl(current.thumbnail))}" alt="Twitch-Clip-Vorschau">`:`<span style="font-size:64px">${category(cat).icon}</span>`}<div class="swipe-overlay"><span class="bigplay">${current.url?'▶':'🎭'}</span></div></button><div class="swipe-title"><h2>${esc(current.title)}</h2><p>Clip von <strong>@${esc(current.creatorName)}</strong></p></div><div class="swipe-actions"><button class="btn secondary" data-action="swipe" data-id="${esc(current.id)}" data-choice="skip" ${!allowed?'disabled':''}>✕ Weiter</button><button class="btn good" data-action="swipe" data-id="${esc(current.id)}" data-choice="like" ${!allowed?'disabled':''}>♥ LIKE</button></div><div class="meter"><div style="width:${clips.length?100*done/clips.length:0}%"></div></div></article>`}<p style="font-size:12px;text-align:center">Keine öffentlichen Live-Ranglisten während des Votings. Ein Clip kann pro anonymer Nutzerkennung nur einmal gewertet werden.</p>`;}
function top3Page(){const cat=state.top3Category,candidates=state.clips.filter(c=>c.category===cat&&c.top10&&c.status==='approved').sort((a,b)=>a.title.localeCompare(b.title));const saved=state.top3.get(cat);const allowed=state.demo||state.config.phase==='top3';return `<div class="page-head"><div class="eyebrow">VOTING · RUNDE 2</div><h1>DEINE TOP 3.</h1><p>Aus den Top 10 pro Kategorie entscheidest du dich für die besten drei Clips. Platz 1 bekommt 3 Punkte, Platz 2 bekommt 2 und Platz 3 bekommt 1 Punkt.</p></div><div class="row" style="margin-bottom:22px"><select class="select" id="top3-category" style="max-width:350px" aria-label="Kategorie fürs Top-3-Voting">${categoryOptions(cat)}</select>${chip(candidates.length+' Kandidaten')}</div>${!allowed?notice('Die Top-3-Runde ist gerade nicht geöffnet. '+esc(phaseHelp())):''}${saved?notice('<strong>Deine Auswahl ist gespeichert.</strong> Aus Fairnessgründen kann diese Top-3-Abgabe nicht mehr verändert werden.',true):''}<div class="panel"><h3>Deine Platzierungen</h3><div class="ranking-picks">${Array.from({length:3},(_,i)=>{const id=(saved?.picks||state.picks)[i];const clip=candidates.find(c=>c.id===id);return `<div class="ranking-slot"><b>${i+1}. Platz</b><span>${clip?esc(clip.title):'Noch offen'}</span>${!saved&&clip?`<button class="btn small secondary" data-action="unpick" data-index="${i}">Entfernen</button>`:''}</div>`;}).join('')}</div><div class="slim-list">${candidates.length?candidates.map(c=>`<div class="listrow"><span style="font-size:22px">${category(cat).icon}</span><div class="grow"><strong>${esc(c.title)}</strong><small>@${esc(c.creatorName)}</small></div><button class="btn small secondary" data-action="play" data-id="${esc(c.id)}" ${!c.url?'disabled':''}>▶</button><button class="btn small" data-action="pick" data-id="${esc(c.id)}" ${saved||state.picks.includes(c.id)||state.picks.length>=3||!allowed?'disabled':''}>+ Wählen</button></div>`).join(''):'<div class="empty">Die Top 10 stehen noch nicht fest. Nach der Swipe-Auswertung erscheinen sie hier.</div>'}</div><div class="row" style="margin-top:23px"><button class="btn good" data-action="save-top3" ${saved||state.picks.length!==3||candidates.length<3||!allowed?'disabled':''}>★ Top 3 verbindlich abgeben</button><span class="status">${saved?'Bereits abgegeben':state.picks.length+' von 3 gewählt'}</span></div></div>`;}
function clipsPage(){const selected=state.filter,filtered=state.clips.filter(c=>selected==='all'||c.category===selected);return `<div class="page-head"><div class="eyebrow">CLIP-BIBLIOTHEK</div><h1>ALLE CLIPS.</h1><p>Hier findest du alle automatisch geprüften und freigegebenen Clips der aktuellen Edition.</p></div><div class="row" style="margin-bottom:24px"><select class="select" id="clip-filter" style="max-width:350px" aria-label="Clips nach Kategorie filtern"><option value="all">Alle Kategorien</option>${categoryOptions(selected)}</select>${chip(filtered.length+' Clips')}</div><div class="clip-grid">${filtered.map(clipCard).join('')||'<div class="empty">Hier gibt es noch keine freigegebenen Clips.</div>'}</div>`;}
function resultsPage(){const ready=['show','archived'].includes(state.config.phase)||state.demo;return `<div class="page-head"><div class="eyebrow">ROAD TO NIKI</div><h1>FINALISTEN.</h1><p>Die Community wählt sechs Clips pro Kategorie. Niki wählt daraus live den Award-Gewinner.</p></div>${!ready?notice('Die Rangliste bleibt bis zum Ende der Top-3-Abstimmung verborgen.'):''}${CATEGORIES.map(cat=>{const list=state.clips.filter(c=>c.category===cat.id&&(state.demo?c.finalist:ready&&c.finalist)).sort((a,b)=>(b.finalPoints||0)-(a.finalPoints||0));return `<section class="section panel">${sectionHead(cat.icon+' '+esc(cat.title),'TOP '+list.length)}${state.config.phase==='archived'&&state.winners.some(w=>w.category===cat.id&&w.edition===state.config.edition)?`<div class="notice good-note">🏆 Nikis Gewinner: <strong>${esc(state.clips.find(c=>c.id===state.winners.find(w=>w.category===cat.id&&w.edition===state.config.edition).clipId)?.title||'Clip nicht gefunden')}</strong></div>`:''}${list.length?`<div class="slim-list">${list.map((c,i)=>`<div class="listrow"><span style="font-size:22px;width:35px">${i+1}.</span><div class="grow"><strong>${esc(c.title)}</strong><small>Original-Clip von @${esc(c.creatorName)}</small></div>${ready?`<span class="status">${c.finalPoints||0} Pkt.</span>`:''}<button class="btn secondary small" data-action="play" data-id="${esc(c.id)}" ${!c.url?'disabled':''}>▶</button></div>`).join('')}</div>`:'<p>Die Finalisten stehen noch nicht fest.</p>'}</section>`;}).join('')}`;}
function adminLoginPage(){return `<div class="page-head"><div class="eyebrow">GESCHÜTZTER BEREICH</div><h1>TEAM-ZUGANG.</h1><p>Dieser Bereich ist nur für freigeschaltete Accounts. Die Admin-Funktionen sind zusätzlich durch Firestore-Regeln geschützt.</p></div><div class="panel" style="max-width:520px">${state.isAdmin?notice('Du bist im Team angemeldet.',true):''}${state.demo?notice('Im Demo-Modus ist noch kein Login verfügbar. Firebase zuerst einrichten.'):''}<form id="login-form" class="stack"><div class="field"><label for="admin-email">E-Mail des freigeschalteten Team-Kontos</label><input class="input" id="admin-email" type="email" autocomplete="username" required ${state.demo?'disabled':''}></div><div class="field"><label for="admin-password">Passwort</label><input class="input" id="admin-password" type="password" autocomplete="current-password" required ${state.demo?'disabled':''}></div><button class="btn" ${state.demo?'disabled':''}>Sicher anmelden</button></form><p style="font-size:12px">Für den MVP nutzt Niki Firebase E-Mail/Passwort statt Twitch-Login. Nur von Niki freigeschaltete Accounts erhalten Teamrechte.</p></div>`;}
function showPage(){if(!state.isOwner)return adminLoginPage();const finalists=state.clips.filter(c=>c.finalist&&c.status==='approved').sort((a,b)=>CATEGORIES.findIndex(x=>x.id===a.category)-CATEGORIES.findIndex(x=>x.id===b.category)||(b.finalPoints||0)-(a.finalPoints||0));if(!finalists.length)return `<div class="page-head"><h1>SHOW-MODUS.</h1></div><div class="empty">Noch keine Finalisten. Starte nach der Top-3-Runde in GitHub Actions den Workflow „final6“.</div>`;const c=finalists[state.showIndex%finalists.length];const winner=state.winners.find(w=>w.category===c.category&&w.edition===state.config.edition);return `<div class="page-head"><div class="eyebrow">NUR FÜR DAS TEAM</div><h1>SHOW-MODUS.</h1><p>Präsentiere die Community-Finalisten und bestimme deinen Gewinner pro Kategorie.</p></div><div class="show-preview"><div class="row" style="justify-content:space-between">${chip(category(c.category).icon+' '+category(c.category).title)}<span class="status">Finalist ${state.showIndex%finalists.length+1} / ${finalists.length}</span></div><div style="margin:15px 0">${clipThumb(c)}</div><h2>${esc(c.title)}</h2><p>Originaler Twitch-Clip von <strong>@${esc(c.creatorName)}</strong> · ${c.finalPoints||0} Community-Punkte.</p><div class="row"><button class="btn secondary" data-action="play" data-id="${esc(c.id)}" ${!c.url?'disabled':''}>▶ Twitch-Clip öffnen</button><button class="btn gold" data-action="winner" data-id="${esc(c.id)}">★ Zum Kategoriesieger küren</button></div><p>${winner?`Aktueller Sieger dieser Kategorie: <strong>${esc(state.clips.find(x=>x.id===winner.clipId)?.title||winner.clipId)}</strong>`:'Noch kein Sieger für diese Kategorie gewählt.'}</p><div class="row" style="justify-content:space-between;margin-top:25px"><button class="btn secondary" data-action="show-prev">← Zurück</button><button class="btn" data-action="show-next">Nächster Clip →</button></div></div>`;}
function moderatorSection(){
  if(!state.isOwner)return '';
  return `<section class="section panel">${sectionHead('Moderator-Logins & Rechte','NUR NIKI')}
  <p>Lege einen Firebase-E-Mail-Account an. Der Moderator bekommt eine E-Mail zur Passwort-Einrichtung. Nur Niki kann Rollen vergeben oder entziehen.</p>
  <form id="moderator-form" class="stack" style="max-width:640px">
    <div class="field"><label for="mod-email">E-Mail-Adresse des neuen Moderators</label>
      <input id="mod-email" class="input" type="email" autocomplete="off" required maxlength="254" placeholder="mod@beispiel.de"></div>
    <label><input type="checkbox" id="mod-clips" checked> Clips moderieren und Kategorien korrigieren</label>
    <label><input type="checkbox" id="mod-phases"> Votingphasen verwalten (erweitertes Recht)</label>
    <button class="btn" type="submit">+ Moderator-Login erstellen und Passwort-E-Mail senden</button>
  </form>
  <div class="slim-list" style="margin-top:22px">${state.moderators.length?state.moderators.map(m=>`
    <div class="listrow" style="align-items:flex-start;flex-wrap:wrap">
      <div class="grow"><strong>${esc(m.email)}</strong><small>UID: ${esc(m.uid)}</small></div>
      <label><input type="checkbox" data-action="mod-right" data-id="${esc(m.uid)}" data-permission="moderateClips" ${m.permissions?.moderateClips?'checked':''}> Clips</label>
      <label><input type="checkbox" data-action="mod-right" data-id="${esc(m.uid)}" data-permission="managePhases" ${m.permissions?.managePhases?'checked':''}> Phasen</label>
      <button class="btn small secondary" data-action="mod-reset" data-id="${esc(m.uid)}">Passwort-Mail</button>
      <button class="btn small danger" data-action="mod-revoke" data-id="${esc(m.uid)}">Zugriff entziehen</button>
    </div>`).join(''):'<p>Noch keine Moderatoren angelegt.</p>'}</div>
  <p style="font-size:12px">„Zugriff entziehen“ löscht die Berechtigung, nicht das Firebase-Benutzerkonto. Rechte werden in Firestore geprüft, nicht nur per ausgeblendetem Button.</p>
  </section>`;
}
function adminPage(){
  if(!state.isAdmin)return adminLoginPage();
  const phaseControls=canManagePhases()?`<div class="row"><button class="btn small" data-action="phase" data-phase="collect">Sammlung öffnen</button><button class="btn small gold" data-action="phase" data-phase="swipe">Swipe-Voting starten</button><button class="btn small secondary" data-action="phase" data-phase="archived">Edition archivieren</button></div><p style="font-size:12px">Top 10 und Finalisten werden sicher durch GitHub Actions ausgezählt.</p>`:'';
  const moderation=canModerate()?`<section class="section panel">${sectionHead('Clips moderieren','AUTOMATISCH FREIGEGEBEN')}
    <p>Gültige Niki-Twitch-Clips erscheinen automatisch. Hier kannst du Clips sperren und während der Sammelphase die Kategorie korrigieren.</p>
    <div class="slim-list">${state.submissions.length?state.submissions.map(c=>`<div class="listrow">
      <div class="grow"><strong>${esc(c.title)}</strong><small>${esc(category(c.category).title)} · @${esc(c.creatorName)} · ${esc(c.status)}</small></div>
      <button class="btn small secondary" data-action="play" data-id="${esc(c.id)}">▶</button>
      <select class="select" data-action="admin-category" data-id="${esc(c.id)}" ${state.config.phase!=='collect'?'disabled':''} style="max-width:145px" aria-label="Kategorie ändern">${categoryOptions(c.category)}</select>
      ${c.status!=='approved'&&state.config.phase==='collect'?`<button class="btn small good" data-action="moderate" data-id="${esc(c.id)}" data-status="approved">✓ Freigeben</button>`:''}
      ${c.status!=='rejected'?`<button class="btn small danger" data-action="moderate" data-id="${esc(c.id)}" data-status="rejected">✕ Sperren</button>`:''}
    </div>`).join(''):'<p>Noch keine Clips importiert.</p>'}</div>
  </section>`:'';
  const prizes=state.isOwner?`<section class="section panel">${sectionHead('Gutscheine & Kontakt','NUR NIKI')}
    <div class="slim-list">${CATEGORIES.map(cat=>{const w=state.winners.find(x=>x.category===cat.id&&x.edition===state.config.edition);const c=w&&state.clips.find(x=>x.id===w.clipId);return `<div class="listrow"><div class="grow"><strong>${esc(cat.icon+' '+cat.title)}</strong><small>${c?'@'+esc(c.creatorName)+' · '+esc(c.title):'Noch kein Gewinner gewählt'}</small></div>${w?`<select class="select" data-action="contact" data-cat="${cat.id}" aria-label="Kontaktstatus ${esc(cat.title)}" style="max-width:205px">${['offen','angeschrieben','gutschein übergeben','kontakt nicht möglich'].map(v=>`<option value="${v}" ${w.contactStatus===v?'selected':''}>${v}</option>`).join('')}</select>`:chip('Offen')}</div>`;}).join('')}</div><p style="font-size:12px">Niki versendet Gutscheine weiterhin manuell über Twitch.</p></section>`:'';
  return `<div class="page-head"><div class="eyebrow">NIKI-TEAM</div><h1>${state.isOwner?'ADMIN-DASHBOARD':'MODERATION'}.</h1><p>${state.isOwner?'Du steuerst die Awardshow und die Teamrechte.':'Hier siehst du ausschließlich die für dich freigegebenen Funktionen.'}</p></div>
    <div class="panel"><div class="row" style="justify-content:space-between"><div><h3>Edition ${esc(state.config.edition)}</h3><p>Phase: <strong>${esc(PHASE_NAMES[state.config.phase])}</strong> · ${state.isOwner?'Eigentümer':'Moderator'}</p></div><div class="row"><button class="btn small secondary" data-action="refresh">↻ Aktualisieren</button><button class="btn small danger" data-action="logout">Abmelden</button></div></div>${phaseControls}</div>
    ${moderation}${prizes}${moderatorSection()}`;
}
function render(){
  if(['show','admin'].includes(state.page)&&!canUse(state.page))state.page='home';
  renderNav();
  $('#edition-chip').textContent=state.demo?'DEMO / VORSCHAU':state.config.edition+' EDITION';
  const status=$('#status-chip');
  status.textContent=state.demo?'DEMO-MODUS':(state.authReady&&state.isAdmin?'Team: '+(state.currentUser?.email||'Team'):PHASE_NAMES[state.config.phase]||'Bereit');
  status.className='chip'+(state.demo?' warn':'');
  const pages={home,submit:submitPage,swipe:swipePage,top3:top3Page,clips:clipsPage,results:resultsPage,'admin-login':adminLoginPage,admin:adminPage,show:showPage};
  $('#view').innerHTML=(pages[state.page]||home)();
}
function findClip(id){return [...state.clips,...state.submissions].find(c=>c.id===id);}
function play(id){const c=findClip(id);if(!c||!c.url)return;const dlg=$('#player-dialog'),body=$('#player-body'),parent=window.location.hostname||'localhost';const url=`https://clips.twitch.tv/embed?clip=${encodeURIComponent(c.twitchClipId)}&parent=${encodeURIComponent(parent)}&autoplay=false`;body.innerHTML=`<iframe title="Twitch-Clip: ${esc(c.title)}" src="${esc(url)}" allow="autoplay; fullscreen" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe><div class="row" style="margin:10px 0"><a class="btn secondary small" target="_blank" rel="noreferrer noopener" href="${esc(safeUrl(c.url))}">Auf Twitch ansehen ↗</a></div>`;dlg.showModal();}
async function loadAll(){if(state.demo){render();return;}const snap=await getDoc(doc(db,'config','current'));if(!snap.exists())throw new Error('Edition fehlt: GitHub-Action „seed“ ausführen.');state.config=snap.data();const clipsQuery=canModerate()?query(collection(db,'clips'),limit(500)):query(collection(db,'clips'),where('status','==','approved'),limit(500));const all=(await getDocs(clipsQuery)).docs.map(x=>({id:x.id,...x.data()}));state.clips=all.filter(c=>c.edition===state.config.edition&&c.status==='approved');if(state.isAdmin){state.submissions=canModerate()?all.filter(c=>c.edition===state.config.edition&&['review','approved','rejected'].includes(c.status)).sort((a,b)=>String(b.createdAtTwitch||'').localeCompare(String(a.createdAtTwitch||''))).slice(0,120):[];state.winners=state.isOwner?(await getDocs(query(collection(db,'winners'),limit(100)))).docs.map(x=>({id:x.id,...x.data()})):[];state.moderators=state.isOwner?(await getDocs(query(collection(db,'admins'),limit(100)))).docs.map(x=>({uid:x.id,...x.data()})).filter(x=>x.role==='moderator'):[];}else{state.submissions=[];state.moderators=[];state.winners=state.config.phase==='archived'?(await getDocs(query(collection(db,'winners'),limit(100)))).docs.map(x=>({id:x.id,...x.data()})):[];}
  if(state.currentUser){const uid=state.currentUser.uid;const swipeDocs=await getDocs(query(collection(db,'swipes'),where('uid','==',uid),limit(1500)));state.swipes=new Map(swipeDocs.docs.map(d=>[d.data().clipId,d.data()]).filter(([,v])=>v.edition===state.config.edition));const top3Docs=await getDocs(query(collection(db,'top3Votes'),where('uid','==',uid),limit(100)));state.top3=new Map(top3Docs.docs.map(d=>[d.data().category,d.data()]).filter(([,v])=>v.edition===state.config.edition));}render();}
async function withError(fn){try{await fn();}catch(e){console.error(e);notify((e?.code==='permission-denied'?'Nicht erlaubt: Bitte Anmeldung, Phase oder Firestore-Regeln prüfen.':e?.message||'Ein Fehler ist aufgetreten.'),true);} }
async function submit(e){e.preventDefault();const url=$('#clip-url').value.trim(),clipId=parseClipId(url),cat=$('#submit-cat').value;if(!clipId){notify('Bitte einen gültigen Twitch-Clip-Link eingeben.',true);return;}if(state.demo){notify('Vorschau: Es wurden keine Daten gesendet. Richte Firebase ein.',true);return;}if(state.config.phase!=='collect')return notify('Einreichungsphase ist geschlossen.',true);const uid=state.currentUser?.uid;if(!uid)return notify('Anonyme Anmeldung läuft noch. Bitte erneut versuchen.',true);for(let slot=0;slot<5;slot++){const id=state.config.edition+'__'+uid+'__'+slot;const d=doc(db,'submissions',id);if((await getDoc(d)).exists())continue;await setDoc(d,{edition:state.config.edition,clipId,category:cat,url,submitterUid:uid,slot,status:'pending',submittedAt:serverTimestamp()});$('#submit-form').reset();notify('Einreichung gespeichert! Der Twitch-Link wird im nächsten Prüf-Lauf kontrolliert.');return;}notify('Du hast die fünf Einreichungen für diese Edition bereits genutzt.',true);}
async function swipe(id,choice){if(state.config.phase!=='swipe'&&!state.demo)return;if(getSeen({id}))return;if(state.demo){demoVotes[id]=choice;localStorage.setItem('niki_demo_swipes_v3',JSON.stringify(demoVotes));render();return;}const c=findClip(id),uid=state.currentUser?.uid;if(!c||!uid)return;await setDoc(doc(db,'swipes',state.config.edition+'__'+uid+'__'+id),{uid,edition:state.config.edition,clipId:id,category:c.category,choice,createdAt:serverTimestamp()});state.swipes.set(id,{choice});render();}
async function saveTop3(){const picks=[...state.picks],cat=state.top3Category;if(state.top3.has(cat))return;if(new Set(picks).size!==3||picks.length!==3)return;if(state.demo){state.top3.set(cat,{picks});notify('Deine Demo-Top-3 wurde nur lokal vorgemerkt.');render();return;}if(state.config.phase!=='top3')return;const uid=state.currentUser?.uid;if(!uid)return;await setDoc(doc(db,'top3Votes',state.config.edition+'__'+cat+'__'+uid),{uid,edition:state.config.edition,category:cat,picks,createdAt:serverTimestamp()});state.top3.set(cat,{picks});notify('Top 3 gespeichert! Danke für deine Stimme.',false);render();}
async function adminChange(id,values){
  if(!state.isAdmin||!canModerate())throw new Error('Keine Berechtigung zur Clip-Moderation.');
  if(Object.hasOwn(values,'category')&&state.config.phase!=='collect')throw new Error('Kategorien können nur während der Sammlung geändert werden.');
  if(values.status==='approved'&&state.config.phase!=='collect')throw new Error('Freigabe nur während der Sammlung.');
  if(!['rejected','approved',undefined].includes(values.status))throw new Error('Ungültiger Status.');
  await updateDoc(doc(db,'clips',id),values);
  await loadAll();
}
async function updatePhase(phase){if(!canManagePhases()||!['collect','swipe','archived'].includes(phase))return;const yes=confirm(`Phase wirklich auf „${PHASE_NAMES[phase]}“ setzen?`);if(!yes)return;await updateDoc(doc(db,'config','current'),{phase,updatedAt:serverTimestamp()});await loadAll();notify('Phase aktualisiert.');}
async function chooseWinner(id){const c=findClip(id);if(!state.isOwner||!c?.finalist||!['show','archived'].includes(state.config.phase))return notify('Nur Finalisten dürfen gewinnen.',true);if(!confirm(`„${c.title}“ zum Sieger von „${category(c.category).title}“ küren?`))return;const ref=doc(db,'winners',state.config.edition+'__'+c.category);const existing=state.winners.find(w=>w.category===c.category);await setDoc(ref,{edition:state.config.edition,category:c.category,clipId:c.id,creatorId:c.creatorId||'',creatorName:c.creatorName,contactStatus:existing?.clipId===id?existing.contactStatus:'offen',selectedAt:serverTimestamp()});await loadAll();notify('Kategoriesieger gespeichert. Gutschein wird manuell verschickt.');}
async function updateContact(cat,status){if(!state.isOwner)return;await updateDoc(doc(db,'winners',state.config.edition+'__'+cat),{contactStatus:status});await loadAll();notify('Kontaktstatus gespeichert.');}
function freshRandomPassword(){
  const bytes=new Uint8Array(32);window.crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')+'Aa9!';
}
async function createModerator(e){
  e.preventDefault();
  if(!state.isOwner)throw new Error('Nur Niki darf Moderator-Logins erstellen.');
  const email=$('#mod-email').value.trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Ungültige E-Mail-Adresse.');
  const permissions={moderateClips:$('#mod-clips').checked,managePhases:$('#mod-phases').checked};
  if(!confirm(`Moderator-Konto für ${email} mit den ausgewählten Rechten erstellen?`))return;
  // Zweite Firebase-App: Niki bleibt im primären Auth-Konto angemeldet.
  const {initializeApp:secondaryInit,deleteApp}=await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js');
  const secondaryApp=secondaryInit(firebaseConfig,'niki-mod-creator');
  const secondaryAuth=getAuth(secondaryApp);
  let createdUser=null;let resetSent=false;
  try{
    await setPersistence(secondaryAuth,inMemoryPersistence);
    const result=await createUserWithEmailAndPassword(secondaryAuth,email,freshRandomPassword());
    createdUser=result.user;
    await setDoc(doc(db,'admins',createdUser.uid),{
      role:'moderator',email,permissions,createdBy:state.currentUser.uid,createdAt:serverTimestamp()
    });
    try{await sendPasswordResetEmail(secondaryAuth,email);resetSent=true;}catch(err){console.warn('Passwort-Einladungsmail fehlgeschlagen',err);}
  }finally{
    try{await signOut(secondaryAuth);}catch{}
    await deleteApp(secondaryApp);
  }
  await loadAll();
  if(!createdUser)return;
  $('#mod-email').value='';
  notify(resetSent?`Moderator-Konto für ${email} erstellt. Eine E-Mail zum Festlegen des Passworts wurde angefordert.`:
    `Moderator-Konto für ${email} erstellt, aber die Passwort-E-Mail ging nicht raus. Bitte im Team-Bereich erneut senden.`,!resetSent);
}
async function updateModerator(uid,field,value){
  if(!state.isOwner)throw new Error('Nur Niki darf Moderatoren verwalten.');
  const m=state.moderators.find(x=>x.uid===uid);
  if(!m||!['moderateClips','managePhases'].includes(field))throw new Error('Moderator oder Recht ungültig.');
  await updateDoc(doc(db,'admins',uid),{['permissions.'+field]:value});
  await loadAll();notify('Moderatorrechte gespeichert.');
}
async function revokeModerator(uid){
  if(!state.isOwner)return;
  const m=state.moderators.find(x=>x.uid===uid);
  if(!m||!confirm(`Zugriff für ${m.email} entziehen? Das Firebase-Konto bleibt bestehen.`))return;
  await deleteDoc(doc(db,'admins',uid));
  await loadAll();notify('Moderatorzugriff entzogen.');
}
async function resetModeratorPassword(uid){
  if(!state.isOwner)return;
  const m=state.moderators.find(x=>x.uid===uid);
  if(!m)return;
  await sendPasswordResetEmail(auth,m.email);
  notify('Passwort-Einrichtungslink für '+m.email+' angefordert.');
}
async function authLogin(e){
  e.preventDefault();if(!auth)return;
  const email=$('#admin-email').value.trim(),pw=$('#admin-password').value;
  // Login gilt nur bis zum Schließen des Tabs; andere, anonyme Nutzer bleiben LOCAL.
  try{await setPersistence(auth,browserSessionPersistence);}
  catch{await setPersistence(auth,inMemoryPersistence);}
  const result=await signInWithEmailAndPassword(auth,email,pw);
  // Nur ein bestätigter Passwort-Account MIT expliziter Rolle in Firestore ist Admin.
  const adminDoc=await getDoc(doc(db,'admins',result.user.uid));
  if(result.user.isAnonymous||!result.user.providerData.some(p=>p.providerId==='password')||!adminDoc.exists()||!['owner','moderator'].includes(adminDoc.data()?.role)){
    await signOut(auth);
    notify('Dieses Firebase-Konto hat keine Adminberechtigung.',true);
    return;
  }
  notify('Team-Anmeldung erfolgreich.');
}
async function logout(){
  if(!auth)return;
  state.isAdmin=false;state.isOwner=false;state.permissions={moderateClips:false,managePhases:false};state.currentUser=null;state.authReady=false;
  state.submissions=[];state.winners=[];state.moderators=[];state.swipes=new Map();state.top3=new Map();
  state.page='home';render();
  await signOut(auth);
  notify('Du wurdest abgemeldet.');
}

document.addEventListener('click',e=>{const el=e.target.closest('[data-action]');if(!el)return;const {action,page,id,choice,cat,index,phase,status}=el.dataset;withError(async()=>{if(action==='go')navTo(page);if(action==='category-swipe'){state.swipeCategory=cat;navTo('swipe');}if(action==='play')play(id);if(action==='swipe')await swipe(id,choice);if(action==='pick'&&!state.picks.includes(id)&&state.picks.length<3){state.picks.push(id);render();}if(action==='unpick'){state.picks.splice(Number(index),1);render();}if(action==='save-top3')await saveTop3();if(action==='moderate')await adminChange(id,{status});if(action==='phase')await updatePhase(phase);if(action==='refresh')await loadAll();if(action==='winner')await chooseWinner(id);if(action==='show-next'){state.showIndex++;render();}if(action==='show-prev'){state.showIndex=Math.max(0,state.showIndex-1);render();}if(action==='mod-revoke')await revokeModerator(id);if(action==='mod-reset')await resetModeratorPassword(id);if(action==='logout')await logout();});});
document.addEventListener('change',e=>{const t=e.target;withError(async()=>{if(t.id==='swipe-category'){state.swipeCategory=t.value;render();}if(t.id==='top3-category'){state.top3Category=t.value;state.picks=[];render();}if(t.id==='clip-filter'){state.filter=t.value;render();}if(t.dataset.action==='admin-category')await adminChange(t.dataset.id,{category:t.value,top10:false,finalist:false});if(t.dataset.action==='contact')await updateContact(t.dataset.cat,t.value);if(t.dataset.action==='mod-right')await updateModerator(t.dataset.id,t.dataset.permission,t.checked);});});
document.addEventListener('submit',e=>{if(e.target.id==='submit-form')withError(()=>submit(e));if(e.target.id==='login-form')withError(()=>authLogin(e));if(e.target.id==='moderator-form')withError(()=>createModerator(e));});
$('#player-close').addEventListener('click',()=>$('#player-dialog').close());$('#player-dialog').addEventListener('close',()=>{$('#player-body').innerHTML='';});$('#info-btn').addEventListener('click',()=>$('#info-dialog').showModal());$('#info-close').addEventListener('click',()=>$('#info-dialog').close());
if(state.demo){render();}else{
  onAuthStateChanged(auth,async user=>{
    if(unsubscribeRole){unsubscribeRole();unsubscribeRole=null;}
    // Sicherheit: Privilegierte Inhalte beim Auth-Wechsel immer SOFORT löschen.
    state.isAdmin=false;state.isOwner=false;state.permissions={moderateClips:false,managePhases:false};state.currentUser=null;state.authReady=false;
    state.submissions=[];state.winners=[];state.moderators=[];state.swipes=new Map();state.top3=new Map();
    if(!user){
      state.clips=[];render();
      try{
        await setPersistence(auth,browserLocalPersistence);
        await signInAnonymously(auth);
      }catch(e){notify('Firebase Auth: Anonymes Anmelden einschalten. '+e.message,true);}
      return;
    }
    state.currentUser=user;
    try{
      // Anonyme Nutzer erhalten selbst bei versehentlich angelegtem Admin-Dokument keine Rechte.
      if(!user.isAnonymous && user.providerData.some(p=>p.providerId==='password')){
        // Migriert auch zuvor lokal gespeicherte Admin-Sessions auf Tab-Persistenz.
        try{await setPersistence(auth,browserSessionPersistence);}
        catch{await setPersistence(auth,inMemoryPersistence);}
        const record=await getDoc(doc(db,'admins',user.uid));
        if(auth.currentUser?.uid!==user.uid)return;
        const data=record.exists()?record.data():null;state.isOwner=data?.role==='owner';state.isAdmin=state.isOwner||data?.role==='moderator';state.permissions=state.isOwner?{moderateClips:true,managePhases:true}:{moderateClips:data?.permissions?.moderateClips===true,managePhases:data?.permissions?.managePhases===true};
      }
      state.authReady=true;
      await loadAll();
      if(auth.currentUser?.uid!==user.uid)return;
      if(state.isAdmin){
        // Rechteänderungen und Entzug werden im offenen Tab unmittelbar übernommen.
        unsubscribeRole=onSnapshot(doc(db,'admins',user.uid),snap=>{
          if(auth.currentUser?.uid!==user.uid)return;
          const rec=snap.exists()?snap.data():null;
          const owner=rec?.role==='owner';
          const team=owner||rec?.role==='moderator';
          const perms=owner?{moderateClips:true,managePhases:true}:{moderateClips:rec?.permissions?.moderateClips===true,managePhases:rec?.permissions?.managePhases===true};
          if(owner!==state.isOwner||team!==state.isAdmin||perms.moderateClips!==state.permissions.moderateClips||perms.managePhases!==state.permissions.managePhases){
            state.isOwner=owner;state.isAdmin=team;state.permissions=perms;
            state.submissions=[];state.winners=[];state.moderators=[];
            if(!canUse(state.page))state.page='home';
            withError(()=>loadAll());
            if(!team)notify('Deine Teamberechtigung wurde entzogen.');
          }
        },e=>{console.warn('Teamrechte konnten nicht live aktualisiert werden',e);});
      }
      if(state.isAdmin&&state.page==='admin-login')navTo('admin');
      else if(!canUse(state.page))navTo('home');
    }catch(e){
      if(auth.currentUser?.uid!==user.uid)return;
      state.isAdmin=false;state.isOwner=false;state.permissions={moderateClips:false,managePhases:false};state.authReady=true;
      state.submissions=[];state.winners=[];
      console.error(e);notify('Firebase noch nicht bereit: '+e.message,true);render();
    }
  });
}
