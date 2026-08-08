/* أداة إدارية مؤقتة: حذف الحسابات القديمة (بدون username) + التوقعات اليتيمة. */
import admin from 'firebase-admin';
const SA = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!SA) { console.error('❌ ناقص FIREBASE_SERVICE_ACCOUNT'); process.exit(1); }
function parseSA(raw){ let t=String(raw).trim(); if(t.charCodeAt(0)===0xFEFF)t=t.slice(1); for(const s of [t,'{'+t,t+'}','{'+t+'}']){try{return JSON.parse(s);}catch(e){}} return null; }
admin.initializeApp({ credential: admin.credential.cert(parseSA(SA)) });
const db = admin.firestore(), auth = admin.auth();

(async () => {
  // 1) احذف اللاعبين بدون username + حساباتهم
  const players = await db.collection('players').get();
  const validUids = new Set();
  let delPlayers = 0;
  for (const d of players.docs) {
    if (d.data().username) { validUids.add(d.id); continue; }
    await d.ref.delete(); try { await auth.deleteUser(d.id); } catch (e) {}
    delPlayers++; console.log('🗑️ لاعب:', d.data().name || d.id);
  }
  // 2) احذف التوقعات اليتيمة (uid ليس ضمن لاعب صالح)
  const preds = await db.collection('predictions').get();
  let delPreds = 0;
  for (const p of preds.docs) { if (!validUids.has(p.data().uid)) { await p.ref.delete(); delPreds++; } }
  // 3) رموز إشعارات يتيمة
  const toks = await db.collection('fcmTokens').get();
  let delToks = 0;
  for (const t of toks.docs) { if (!validUids.has(t.id)) { await t.ref.delete(); delToks++; } }
  console.log(`تم — لاعبون محذوفون: ${delPlayers} · توقعات يتيمة: ${delPreds} · رموز: ${delToks} · باقٍ: ${validUids.size}`);
})().catch(e => { console.error(e); process.exit(1); });
