/**
 * Eindeutige Clip-Reservierung je Edition.
 * Beide Dokumente entstehen atomar; die passenden Firestore Security Rules
 * verlangen, dass sie zusammen geschrieben werden.
 * Keine Zugangsdaten und kein eigenständiger Firebase-Import in dieser Datei.
 */
export async function reserveClipSubmission({db,doc,runTransaction,serverTimestamp,edition,clipId,category,url,uid}) {
  const claimRef = doc(db, 'submissionClaims', `${edition}__${clipId}`);
  const slotRefs = Array.from({length:5}, (_,slot) => doc(db,'submissions',`${edition}__${uid}__${slot}`));
  return runTransaction(db,async (tx) => {
    // Firestore-Transaktionen lesen VOR dem Schreiben und werden bei Konflikten
    // automatisch wiederholt; so können zwei Nutzer denselben Clip nicht reservieren.
    const [claimSnap, ...slotSnaps] = await Promise.all([
      tx.get(claimRef), ...slotRefs.map(ref=>tx.get(ref))
    ]);
    if (claimSnap.exists()) {
      throw new Error('Dieser Twitch-Clip wurde für diese Edition bereits eingereicht. Wähle bitte einen anderen Clip.');
    }
    const slot = slotSnaps.findIndex(snap=>!snap.exists());
    if(slot === -1) {
      throw new Error('Du hast die fünf Einreichungen für diese Edition bereits genutzt.');
    }
    const submissionRef=slotRefs[slot];
    tx.set(submissionRef,{
      edition,clipId,category,url,submitterUid:uid,slot,status:'pending',submittedAt:serverTimestamp()
    });
    tx.set(claimRef,{
      edition,clipId,slot,claimedAt:serverTimestamp()
    });
    return {slot,submissionId:submissionRef.id};
  });
}
