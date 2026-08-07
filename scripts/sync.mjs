/* ============================================================
   مزامنة جداول المباريات والنتائج من API-Football إلى Firestore
   يعمل داخل GitHub Action (المفاتيح من Secrets، لا تُكشف).
   ============================================================ */
import admin from 'firebase-admin';
import { readFileSync } from 'node:fs';

const API_KEY = process.env.API_FOOTBALL_KEY;
const SA_RAW  = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!API_KEY || !SA_RAW) {
  console.error('❌ ناقص: API_FOOTBALL_KEY أو FIREBASE_SERVICE_ACCOUNT');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SA_RAW)) });
const db = admin.firestore();

const teams = JSON.parse(readFileSync(new URL('./teams.json', import.meta.url), 'utf8'));

/* دوري التطبيق -> معرّف الدوري في API-Football
   (عدّلها لو احتجت. ACL = دوري أبطال آسيا للنخبة) */
const LEAGUES = { epl: 39, spl: 307, laliga: 140, ucl: 2, acl: 848 };

/* فرق القمة لكل دوري (لمضاعفة ×٢ عند التقاء فريقين منها) */
const BIG = {
  epl: ['أرسنال','مان سيتي','ليفربول','تشيلسي','مان يونايتد','توتنهام'],
  spl: ['الهلال','النصر','الاتحاد','الأهلي'],
  laliga: ['ريال مدريد','برشلونة','أتلتيكو'],
  ucl: [], acl: []
};

const FINISHED = new Set(['FT','AET','PEN']);
const STRIP = new Set(['fc','cf','sc','afc','cd','ud','rcd','club','jeddah','saudi']);
const AR_DIGITS = s => String(s).replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[+d]);

function norm(name){
  const x = String(name || '').toLowerCase()
    .normalize('NFD')             // يفصل العلامات الصوتية عن الحروف
    .replace(/\bal[-\s]/g, ' ')   // إزالة بادئة Al- فقط (لا تمسّ Real وغيرها)
    .replace(/[^a-z0-9]/g, ' ');  // يزيل العلامات والرموز غير اللاتينية
  return x.split(/\s+/).filter(Boolean).filter(t => !STRIP.has(t)).join('');
}
function arTeam(t){
  const hit = teams.norm[norm(t.name)];
  return hit || { ar: t.name, emoji: '⚽' };  // احتياطي: الاسم الإنجليزي
}
function roundAr(roundStr, lgKey){
  const s = roundStr || '';
  if (lgKey === 'ucl' || lgKey === 'acl') {
    if (/round of 16/i.test(s)) return 'دور الـ١٦';
    if (/quarter-?final/i.test(s)) return 'ربع النهائي';
    if (/semi-?final/i.test(s)) return 'نصف النهائي';
    if (/final/i.test(s)) return 'النهائي';
    if (/group/i.test(s)) return 'دور المجموعات';
    if (/league stage/i.test(s)) return 'مرحلة الدوري';
  }
  const m = /(\d+)/.exec(s);
  return m ? 'الجولة ' + AR_DIGITS(m[1]) : (s || '—');
}

function seasonFor(d){
  return (d.getUTCMonth() + 1) >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

async function fetchLeague(lgKey, apiId, season, from, to){
  const url = `https://v3.football.api-sports.io/fixtures?league=${apiId}&season=${season}&from=${from}&to=${to}`;
  const res = await fetch(url, { headers: { 'x-apisports-key': API_KEY } });
  const j = await res.json();
  const errs = j.errors && (Array.isArray(j.errors) ? j.errors.length : Object.keys(j.errors).length);
  if (errs) console.warn(`⚠️  [${lgKey}] API:`, JSON.stringify(j.errors));
  const rows = (j.response || []).map(it => {
    const h = arTeam(it.teams.home), a = arTeam(it.teams.away);
    const finished = FINISHED.has(it.fixture.status.short);
    const big = BIG[lgKey].includes(h.ar) && BIG[lgKey].includes(a.ar);
    return {
      id: 'api_' + it.fixture.id,
      lg: lgKey,
      round: roundAr(it.league.round, lgKey),
      h: h.ar, hc: h.emoji, a: a.ar, ac: a.emoji,
      big,
      kickoff: Date.parse(it.fixture.date),
      status: finished ? 'finished' : 'upcoming',
      resultH: finished ? it.goals.home : null,
      resultA: finished ? it.goals.away : null,
      source: 'api'
    };
  });
  console.log(`✔ [${lgKey}] ${rows.length} مباراة`);
  return rows;
}

async function main(){
  const now = new Date();
  const season = seasonFor(now);
  const fmt = d => d.toISOString().slice(0, 10);
  const from = fmt(new Date(now.getTime() - 4 * 86400000));   // آخر ٤ أيام (للنتائج)
  const to   = fmt(new Date(now.getTime() + 12 * 86400000));  // القادم ١٢ يوماً
  console.log(`الموسم ${season} · من ${from} إلى ${to}`);

  let all = [];
  for (const [lgKey, apiId] of Object.entries(LEAGUES)) {
    try { all = all.concat(await fetchLeague(lgKey, apiId, season, from, to)); }
    catch (e) { console.error(`❌ [${lgKey}]`, e.message); }
  }

  let batch = db.batch(), n = 0;
  for (const fx of all) {
    const { id, ...data } = fx;
    batch.set(db.collection('fixtures').doc(id), data, { merge: true });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  if (n % 400 !== 0) await batch.commit();
  console.log(`✅ تمت مزامنة ${all.length} مباراة إلى Firestore`);
}

main().catch(e => { console.error(e); process.exit(1); });
