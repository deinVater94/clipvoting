export const CATEGORY_IDS = ['laugh','iq','random','rage','cinema'];
export const PHASES = ['collect','swipe','top3','show','archived'];
export const CHANNEL = 'niki8einhalb';
export function parseClipId(input) {
  try {
    const url = new URL(String(input).trim());
    if (url.protocol !== 'https:' || !['clips.twitch.tv','www.twitch.tv','twitch.tv','m.twitch.tv'].includes(url.hostname.toLowerCase())) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.hostname.toLowerCase() === 'clips.twitch.tv') {
      const slug = parts[0];
      return slug && /^[A-Za-z0-9_-]{3,120}$/.test(slug) ? slug : null;
    }
    if (parts.length === 3 && parts[1]?.toLowerCase() === 'clip') {
      const slug = parts[2];
      return slug && /^[A-Za-z0-9_-]{3,120}$/.test(slug) ? slug : null;
    }
  } catch {}
  return null;
}
export function editionOf(iso) { return String(iso).slice(0,7); }
export function wilsonLower(likes, impressions, z=1.96) {
  if (impressions <= 0) return 0;
  const n = impressions, phat = likes / n, z2 = z * z;
  return (phat + z2/(2*n) - z*Math.sqrt((phat*(1-phat)+z2/(4*n))/n)) / (1+z2/n);
}
export function selectTop10(clips, swipeVotes, edition) {
  const votesByClip = new Map();
  for (const vote of swipeVotes) {
    if (vote.edition !== edition || !['like','skip'].includes(vote.choice)) continue;
    const tally = votesByClip.get(vote.clipId) || { shown:0, likes:0 };
    tally.shown += 1;
    tally.likes += Number(vote.choice === 'like');
    votesByClip.set(vote.clipId,tally);
  }
  const result = {};
  for (const cat of CATEGORY_IDS) {
    result[cat] = clips.filter(c=>c.edition===edition&&c.status==='approved'&&c.category===cat).map(c=>{
      const v = votesByClip.get(c.id) || { shown:0, likes:0 };
      return {...c, shown:v.shown, likes:v.likes, score:wilsonLower(v.likes,v.shown)};
    }).sort((a,b)=>b.score-a.score || b.likes-a.likes || b.shown-a.shown || a.id.localeCompare(b.id)).slice(0,10);
  }
  return result;
}
export function selectFinal6(clips, top3Votes, edition) {
  const eligible = new Set(clips.filter(c=>c.edition===edition&&c.status==='approved'&&c.top10).map(c=>c.id));
  const result = {};
  for (const cat of CATEGORY_IDS) {
    const tally = new Map();
    for (const vote of top3Votes) {
      if (vote.edition !== edition || vote.category !== cat || !Array.isArray(vote.picks) || vote.picks.length!==3 || new Set(vote.picks).size!==3 || !vote.picks.every(id=>eligible.has(id))) continue;
      vote.picks.forEach((id,rank)=>tally.set(id,(tally.get(id)||0)+3-rank));
    }
    result[cat] = clips.filter(c=>c.edition===edition&&c.status==='approved'&&c.category===cat&&c.top10)
      .map(c=>({...c,points:tally.get(c.id)||0})).sort((a,b)=>b.points-a.points || a.id.localeCompare(b.id)).slice(0,6);
  }
  return result;
}
