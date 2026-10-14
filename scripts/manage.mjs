import admin from 'firebase-admin';
import {CATEGORY_IDS,CHANNEL,editionOf,parseClipId,selectTop10,selectFinal6} from '../lib/core.mjs';

const operation = process.argv[2] || 'verify';
const accountText = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!accountText) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON ist nicht gesetzt.');
let serviceAccount;
try { serviceAccount = JSON.parse(accountText); }
catch { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON ist kein gültiges JSON.'); }
admin.initializeApp({credential:admin.credential.cert(serviceAccount)});
const db = admin.firestore();
const configRef = db.doc('config/current');
const short = (t) => String(t || '').slice(0,200);
const now = admin.firestore.FieldValue.serverTimestamp();

async function currentConfig() {
  const snap=await configRef.get();
  if (!snap.exists) throw new Error('Keine config/current gefunden. Zuerst seed ausführen.');
  return snap.data();
}
async function token() {
  const id=process.env.TWITCH_CLIENT_ID, secret=process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) throw new Error('TWITCH_CLIENT_ID oder TWITCH_CLIENT_SECRET fehlt.');
  const form=new URLSearchParams({client_id:id,client_secret:secret,grant_type:'client_credentials'});
  const res=await fetch('https://id.twitch.tv/oauth2/token',{method:'POST',body:form});
  const json=await res.json();
  if(!res.ok||!json.access_token) throw new Error('Twitch-Token konnte nicht geladen werden. HTTP '+res.status);
  return {access:json.access_token, id};
}
async function helix(endpoint, params, credentials) {
  const url=new URL('https://api.twitch.tv/helix/'+endpoint);
  for (const [name,value] of Object.entries(params)) url.searchParams.set(name,String(value));
  const res=await fetch(url,{headers:{'Client-Id':credentials.id,Authorization:'Bearer '+credentials.access}});
  if(!res.ok) throw new Error('Twitch API '+endpoint+' HTTP '+res.status+' '+short(await res.text()));
  return (await res.json()).data || [];
}
// Einmalige Bestandsmigration (und idempotente Sicherung bei weiteren verify-Läufen):
// reserviert alle bereits bekannten Clip-IDs der aktiven Edition. Vorher konnten
// derselbe Clip und verschiedene Kategorien mehrfach pending angelegt werden.
async function backfillClaims(config = null) {
  const conf=config || await currentConfig();
  const [subSnap, clipSnap]=await Promise.all([
    db.collection('submissions').where('edition','==',conf.edition).get(),
    db.collection('clips').where('edition','==',conf.edition).get()
  ]);
  const groups=new Map();
  for (const row of subSnap.docs) {
    const s=row.data();
    if (parseClipId(s.url)!==s.clipId || !/^[A-Za-z0-9_-]{3,120}$/.test(s.clipId||'')) continue;
    if (!groups.has(s.clipId)) groups.set(s.clipId,[]);
    groups.get(s.clipId).push({ref:row.ref,id:row.id,...s});
  }
  const clipIds=new Set([...groups.keys()]);
  for (const clip of clipSnap.docs) {
    const id=clip.data().twitchClipId;
    if (typeof id==='string' && /^[A-Za-z0-9_-]{3,120}$/.test(id)) clipIds.add(id);
  }
  let claimsAdded=0, legacyDuplicates=0;
  for(const clipId of clipIds) {
    const entries=(groups.get(clipId)||[]).sort((a,b)=> {
      const priority={verified:0,pending:1,duplicate:2,rejected:3};
      const pa=priority[a.status]??4,pb=priority[b.status]??4;
      return pa-pb || (a.submittedAt?.toMillis?.()||0)-(b.submittedAt?.toMillis?.()||0) || a.id.localeCompare(b.id);
    });
    const preferred=entries[0];
    const claimRef=db.doc(`submissionClaims/${conf.edition}__${clipId}`);
    const result=await db.runTransaction(async tx=>{
      const old=await tx.get(claimRef);
      const oldData=old.exists?old.data():null;
      const originalClaim=oldData && entries.find(row =>
        row.slot===oldData.slot &&
        oldData.claimedAt?.isEqual?.(row.submittedAt)===true
      );
      const selected=originalClaim?.id || preferred?.id || '';
      if(!old.exists){
        tx.create(claimRef,{
          edition:conf.edition, clipId,
          slot:preferred?.slot??-1,claimedAt:now
        });
      }
      let duplicates=0;
      for(const row of entries){
        if(row.id!==selected && row.status==='pending'){
          tx.update(row.ref,{status:'duplicate',duplicateOf:conf.edition+'__'+clipId,checkedAt:now});
          duplicates++;
        }
      }
      return {added:!old.exists,duplicates};
    });
    if(result.added) claimsAdded++;
    legacyDuplicates+=result.duplicates;
  }
  console.log(`Bestehende Clips reserviert: ${claimsAdded} neue Reservierungen, ${legacyDuplicates} alte Mehrfacheinreichungen aussortiert.`);
}

async function verify() {
  const conf=await currentConfig();
  await backfillClaims(conf); // ältere Einreichungen sofort gegen neue Duplikate schützen
  if (conf.phase !== 'collect') {
    console.log('Verifizierung ausgesetzt: Clip-Sammlung ist geschlossen.');
    return;
  }
  const credentials=await token();
  const users=await helix('users',{login:process.env.TWITCH_CHANNEL_LOGIN || CHANNEL}, credentials);
  const broadcaster=users[0];
  if(!broadcaster) throw new Error('Twitch-Kanal nicht gefunden.');
  const pending=await db.collection('submissions').where('status','==','pending').limit(300).get();
  let approved=0,duplicate=0,rejected=0;
  for(const doc of pending.docs) {
    const s=doc.data();
    const clipId=parseClipId(s.url);
    if(!clipId || clipId!==s.clipId || !CATEGORY_IDS.includes(s.category) || s.edition!==conf.edition) {
      await doc.ref.update({status:'rejected',reason:'Ungültiger Link, Kategorie oder Edition',checkedAt:now}); rejected++;continue;
    }
    const data=await helix('clips',{id:clipId},credentials);
    const clip=data.find(c=>c.id===clipId);
    if(!clip || String(clip.broadcaster_id)!==String(broadcaster.id) || editionOf(clip.created_at)!==conf.edition) {
      await doc.ref.update({status:'rejected',reason:'Clip nicht verfügbar, falscher Kanal oder falscher Monat (UTC)',checkedAt:now}); rejected++;continue;
    }
    const clipRef=db.collection('clips').doc(conf.edition+'__'+clipId);
    const made=await db.runTransaction(async tx=>{
      const old=await tx.get(clipRef);
      if(old.exists) {
        tx.update(doc.ref,{status:'duplicate',duplicateOf:clipRef.id,checkedAt:now});
        return false;
      }
      tx.create(clipRef,{
        id:clipRef.id,twitchClipId:clip.id,edition:conf.edition,category:s.category,status:'approved',
        title:short(clip.title),url:clip.url,thumbnail:clip.thumbnail_url || '',
        creatorId:String(clip.creator_id || ''),creatorName:short(clip.creator_name || 'Unbekannt'),
        broadcasterId:String(clip.broadcaster_id),createdAtTwitch:clip.created_at,
        duration:clip.duration || 0,top10:false,finalist:false,createdAt:now
      });
      tx.update(doc.ref,{status:'verified',clipDocId:clipRef.id,checkedAt:now});
      return true;
    });
    if(made) approved++; else duplicate++;
  }
  console.log(`Prüfung fertig: ${approved} neu automatisch freigegeben, ${duplicate} doppelt, ${rejected} abgelehnt; ${pending.size} geprüft`);
  if (pending.size === 300) console.log('Hinweis: Maximal 300 pro Lauf – nächsten Lauf starten für weitere.');
}
async function runBatchUpdates(rows, project) {
  // Small batches keep well below Firestore's limit and tolerate a large month.
  for(let i=0;i<rows.length;i+=250) {
    const batch=db.batch();
    rows.slice(i,i+250).forEach((item)=>batch.update(item.ref,project(item)));
    await batch.commit();
  }
}
async function getRows(collection,edition) {
  const snap=await db.collection(collection).where('edition','==',edition).get();
  return snap.docs.map(doc=>({...doc.data(),id:doc.id,ref:doc.ref}));
}
async function tallyTop10() {
  let conf=await currentConfig();
  if(!['swipe','counting'].includes(conf.phase) || (conf.phase==='counting' && conf.countingFor!=='top10')) throw new Error('Top10 darf nur aus swipe gestartet/fortgesetzt werden.');
  await configRef.update({phase:'counting',countingFor:'top10'}); // voting is locked before tally
  conf=await currentConfig();
  const clips=await getRows('clips',conf.edition);
  const swipes=await getRows('swipes',conf.edition);
  const ranking=selectTop10(clips,swipes,conf.edition);
  const selected=new Map(Object.values(ranking).flat().map((c)=>[c.id,c]));
  await runBatchUpdates(clips,c=>({top10:selected.has(c.id),finalist:false,swipeLikes:selected.get(c.id)?.likes || 0,swipeImpressions:selected.get(c.id)?.shown || 0}));
  await configRef.update({phase:'top3',countingFor:null,updatedAt:now});
  console.log('Top 10 freigegeben:',Object.fromEntries(CATEGORY_IDS.map(cat=>[cat,ranking[cat].map(c=>c.id)])));
}
async function tallyFinal6() {
  let conf=await currentConfig();
  if(!['top3','counting'].includes(conf.phase) || (conf.phase==='counting' && conf.countingFor!=='final6')) throw new Error('Final6 darf nur aus top3 gestartet/fortgesetzt werden.');
  await configRef.update({phase:'counting',countingFor:'final6'}); // no late votes
  conf=await currentConfig();
  const clips=await getRows('clips',conf.edition);
  const votes=await getRows('top3Votes',conf.edition);
  const ranking=selectFinal6(clips,votes,conf.edition);
  const selected=new Map(Object.values(ranking).flat().map(c=>[c.id,c]));
  await runBatchUpdates(clips,c=>({finalist:selected.has(c.id),finalPoints:selected.get(c.id)?.points || 0}));
  await configRef.update({phase:'show',countingFor:null,updatedAt:now});
  console.log('Final6 freigegeben:',Object.fromEntries(CATEGORY_IDS.map(cat=>[cat,ranking[cat].map(c=>c.id)])));
}
async function seed() {
  const existing=await configRef.get();
  if(existing.exists) { console.log('config/current existiert; wurde nicht überschrieben.');return; }
  const edition=editionOf(new Date().toISOString());
  await configRef.create({edition,phase:'collect',broadcasterLogin:CHANNEL,prizeLabel:'Shop-Gutschein',prizeAmount:'noch offen',updatedAt:now});
  console.log('Edition erstellt:',edition,'; Phase collect');
}
async function grantAdmin() {
  const uid=process.env.ADMIN_UID;
  if(!uid || !/^[A-Za-z0-9_-]{5,160}$/.test(uid)) throw new Error('ADMIN_UID fehlt oder ist ungültig.');
  await admin.auth().getUser(uid); // no arbitrary nonexistent UID
  await db.doc('admins/'+uid).set({role:'admin',grantedAt:now});
  console.log('Admin-Rechte für Firebase-UID erteilt:',uid);
}
const tasks={verify,backfill:backfillClaims,top10:tallyTop10,final6:tallyFinal6,seed,'grant-admin':grantAdmin};
if (!tasks[operation]) throw new Error('Unbekannter Befehl: '+operation);
await tasks[operation]();
