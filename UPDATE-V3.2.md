# V3.1 → V3.2 in 5 Schritten

**Achtung: zuerst die bestehende Owner-Rolle migrieren!** In Firestore unter `admins/{NIKIS_FIREBASE_UID}` den Wert von `role: "admin"` auf `role: "owner"` ändern. Sonst funktioniert Nikis Admin-Login nach dem Update nicht mehr. Die anderen Admin-Konten mit der alten Rolle `admin` verlieren ihren Zugriff und können bei Bedarf durch Niki als Moderatoren neu angelegt werden.

1. `docs/app.js` im öffentlichen GitHub-Repository durch die neue Datei ersetzen. **Deine konfigurierte `docs/firebase-config.js` unverändert lassen.**
2. `scripts/manage.mjs` ersetzen; damit werden erfolgreich geprüfte Clips automatisch freigeschaltet.
3. Firebase → Firestore Database → Rules: gesamten Inhalt von `firestore.rules` einsetzen und veröffentlichen.
4. Website neu laden und über `?team=login` mit Nikis Owner-Account anmelden. Unter **Administration → Moderator-Logins & Rechte** einen Testmoderator anlegen und die Passwort-Mail prüfen.
5. GitHub Actions → `verify` ausführen, **sobald** die Twitch-App-Secrets eingerichtet sind, und einen Testclip prüfen. Bis zu diesem Zeitpunkt bleiben alle Einreichungen `pending`.

**Nicht live gegen dein Firebase-Projekt getestet.** Starte mit einem Testaccount und überprüfe, dass Besucher, Moderatoren und Owner exakt die vorgesehenen Rechte haben. Für Preisvergabe ist weiterhin zusätzlicher Voting-Manipulationsschutz nötig.
