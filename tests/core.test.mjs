import test from 'node:test';
import assert from 'node:assert/strict';
import {parseClipId,wilsonLower,selectTop10,selectFinal6} from '../lib/core.mjs';
test('accepts Twitch clips and blocks lookalike origins',()=>{
  assert.equal(parseClipId('https://clips.twitch.tv/AwkwardHelplessSalamanderSwiftRage'),'AwkwardHelplessSalamanderSwiftRage');
  assert.equal(parseClipId('https://www.twitch.tv/niki8einhalb/clip/Example-Slug?filter=clips'),'Example-Slug');
  assert.equal(parseClipId('https://clips.twitch.tv.evil.com/ClipSlug'),null);
  assert.equal(parseClipId('javascript:alert(1)'),null);
  assert.equal(parseClipId('https://www.twitch.tv/someone_else'),null);
});
test('Wilson lower bound does not overrate one lucky vote',()=>{
  assert.ok(wilsonLower(70,100) > wilsonLower(1,1));
  assert.equal(wilsonLower(0,0),0);
});
test('top10 uses approved clips in the correct category',()=>{
  const clips = Array.from({length:12},(_,i)=>({id:`clip-${i}`,status:'approved',edition:'2026-10',category:'laugh'}));
  clips[0].status='review';
  const votes = [{clipId:'clip-1',edition:'2026-10',choice:'like'}];
  const top = selectTop10(clips,votes,'2026-10');
  assert.equal(top.laugh.length,10);
  assert.ok(!top.laugh.some(c=>c.id==='clip-0'));
  assert.equal(top.laugh[0].id,'clip-1');
});
test('top3 rank awards 3/2/1 to eligible clips only',()=>{
  const clips=['a','b','c','d'].map(id=>({id,edition:'2026-10',status:'approved',category:'iq',top10:true}));
  const rows=[{edition:'2026-10',category:'iq',picks:['b','a','c']},{edition:'2026-10',category:'iq',picks:['b','c','a']}];
  const finalists=selectFinal6(clips,rows,'2026-10').iq;
  assert.equal(finalists[0].id,'b');
  assert.equal(finalists[0].points,6);
  assert.equal(finalists.find(c=>c.id==='d').points,0);
});
