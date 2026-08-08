/* أداة إدارية: حذف الحسابات القديمة (بدون اسم مستخدم) وبياناتها.
   تُبقي فقط الحسابات المسجّلة (التي لها username). تعمل عبر GitHub Action يدوياً. */
import admin from 'firebase-admin';

const SA = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!SA) { console.error('❌ ناقص FIREBASE_SERVICE_ACCOUNT'); process.exit(1); }
function parseSA(raw){
  let t = String(raw).trim(); if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  const tries = [t, '{'+t, t+'}', '{'+t+'}'];
  for (const s of tries) { try { return JSON.parse(s); } catch (e) {} }
  return null;
}
const sa = parseSA(SA);
if (!sa) { console.error('❌ SA غير صالح'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore(), auth = admin.auth();

(async () => {
  const snap = await db.collection('players').get();
  let kept = 0, deleted = 0;
  for (const d of snap.docs) {
    const uid = d.id, data = d.data();
    if (data.username) { console.log('✔ إبقاء:', data.name, '(' + data.username + ')'); kept++; continue; }
    // حذف توقعات هذا اللاعب
    const preds = await db.collection('predictions').where('uid', '==', uid).get();
    for (const p of preds.docs) await p.ref.delete();
    const picks = await db.collection('scorerPicks').get();
    for (const pk of picks.docs) { if (pk.id.startsWith(uid + '__')) await pk.ref.delete(); }
    await db.collection('fcmTokens').doc(uid).delete().catch(() => {});
    await d.ref.delete();
    try { await auth.deleteUser(uid); } catch (e) {}
    console.log('🗑️ حُذف:', data.name || uid);
    deleted++;
  }
  console.log(`تم — أُبقي ${kept}، حُذف ${deleted}`);
})().catch(e => { console.error(e); process.exit(1); });
