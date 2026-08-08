/* ============================================================
   إرسال الإشعارات المعلّقة في طابور Firestore عبر FCM
   يعمل داخل GitHub Action (كل ٥ دقائق). السرّ: FIREBASE_SERVICE_ACCOUNT
   ============================================================ */
import admin from 'firebase-admin';

const SA = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!SA) { console.error('❌ ناقص: FIREBASE_SERVICE_ACCOUNT'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SA)) });
const db = admin.firestore();
const messaging = admin.messaging();

async function main(){
  const snap = await db.collection('notifications').where('sent', '==', false).get();
  if (snap.empty) { console.log('لا إشعارات في الطابور.'); return; }

  const tokSnap = await db.collection('fcmTokens').get();
  const tokenDocs = tokSnap.docs.map(d => ({ id: d.id, token: d.data().token })).filter(t => t.token);
  console.log(`إشعارات معلّقة: ${snap.size} · أجهزة مسجّلة: ${tokenDocs.length}`);

  for (const nDoc of snap.docs) {
    const n = nDoc.data();
    if (!tokenDocs.length) { await nDoc.ref.update({ sent: true, delivered: 0, sentAt: Date.now() }); continue; }

    const data = { title: String(n.title || ''), body: String(n.body || ''), link: String(n.link || '') };
    let delivered = 0; const invalid = [];

    for (let i = 0; i < tokenDocs.length; i += 500) {
      const chunk = tokenDocs.slice(i, i + 500);
      const res = await messaging.sendEachForMulticast({
        tokens: chunk.map(t => t.token),
        data,
        android: { priority: 'high' },
        webpush: { headers: { Urgency: 'high', TTL: '86400' } }
      });
      res.responses.forEach((r, idx) => {
        if (r.success) delivered++;
        else {
          const code = (r.error && r.error.code) || '';
          if (code.includes('registration-token-not-registered') || code.includes('invalid-argument') || code.includes('mismatched-credential'))
            invalid.push(chunk[idx].id);
        }
      });
    }

    for (const id of invalid) { try { await db.collection('fcmTokens').doc(id).delete(); } catch (e) {} }
    await nDoc.ref.update({ sent: true, delivered, sentAt: Date.now() });
    console.log(`✔ "${data.title}" → ${delivered} جهاز${invalid.length ? ` (حُذف ${invalid.length} رمز منتهٍ)` : ''}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
