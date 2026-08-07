/* ============================================================
   مزامنة المباريات والنتائج من football-data.org إلى Firestore
   - الدوريات: الإنجليزي (PL) · الإسباني (PD) · أبطال أوروبا (CL)
   - الكتابة عبر Firestore REST بمفتاح الويب العام (قواعد مفتوحة) — لا يحتاج Service Account
   - السرّ الوحيد: FOOTBALL_DATA_TOKEN
   ============================================================ */
import { readFileSync } from 'node:fs';

const FD_TOKEN = process.env.FOOTBALL_DATA_TOKEN;
if (!FD_TOKEN) { console.error('❌ ناقص: FOOTBALL_DATA_TOKEN'); process.exit(1); }

const PROJECT_ID = 'fantsys';
const FIRESTORE_KEY = 'AIzaSyBHJ8WjFEl71NMonIHa7KY6nRXZEves4nM'; // مفتاح ويب عام (آمن)

const COMP = { PL: 'epl', PD: 'laliga', CL: 'ucl' };   // كود المسابقة -> دوري التطبيق
const BIG = {
  epl: ['أرسنال','مان سيتي','ليفربول','تشيلسي','مان يونايتد','توتنهام'],
  laliga: ['ريال مدريد','برشلونة','أتلتيكو'],
  ucl: []
};

const teams = JSON.parse(readFileSync(new URL('./teams.json', import.meta.url), 'utf8'));
const AR = s => String(s).replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[+d]);
const arTeam = t => teams.tla[t.tla] || { ar: t.shortName || t.name, emoji: '⚽' };

function roundAr(m, lg){
  if (lg === 'ucl') {
    const stg = { LAST_16:'دور الـ١٦', QUARTER_FINALS:'ربع النهائي', SEMI_FINALS:'نصف النهائي',
                  FINAL:'النهائي', LEAGUE_STAGE:'مرحلة الدوري', GROUP_STAGE:'دور المجموعات',
                  PLAYOFFS:'الملحق', LAST_8:'ربع النهائي', LAST_4:'نصف النهائي' }[m.stage];
    if (stg) return stg;
  }
  return m.matchday ? 'الجولة ' + AR(m.matchday) : '—';
}

const FINISHED = new Set(['FINISHED','AWARDED']);

async function fetchComp(code){
  const from = new Date(Date.now() - 5*86400000).toISOString().slice(0,10);   // آخر ٥ أيام (نتائج)
  const to   = new Date(Date.now() + 90*86400000).toISOString().slice(0,10);  // القادم ٣ أشهر (~٩ جولات المؤكّدة)
  const res = await fetch(`https://api.football-data.org/v4/competitions/${code}/matches?dateFrom=${from}&dateTo=${to}`,
    { headers: { 'X-Auth-Token': FD_TOKEN } });
  if (!res.ok) { console.warn(`⚠️  [${code}] HTTP ${res.status}`); return []; }
  const j = await res.json();
  const lg = COMP[code];
  const rows = (j.matches || []).map(m => {
    const h = arTeam(m.homeTeam), a = arTeam(m.awayTeam);
    const finished = FINISHED.has(m.status);
    return {
      id: 'fd_' + m.id,
      lg,
      round: roundAr(m, lg),
      h: h.ar, hc: h.emoji, a: a.ar, ac: a.emoji,
      big: !!(BIG[lg].includes(h.ar) && BIG[lg].includes(a.ar)),
      kickoff: Date.parse(m.utcDate),
      status: finished ? 'finished' : 'upcoming',
      resultH: finished ? (m.score?.fullTime?.home ?? null) : null,
      resultA: finished ? (m.score?.fullTime?.away ?? null) : null,
      source: 'football-data'
    };
  });
  console.log(`✔ [${code} → ${lg}] ${rows.length} مباراة`);
  return rows;
}

/* ===== Firestore REST ===== */
function fsValue(v){
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
function toFields(o){ const f = {}; for (const k of Object.keys(o)) f[k] = fsValue(o[k]); return f; }

// تسجيل دخول مجهول للحصول على رمز يوافق قواعد Firestore المشدّدة
async function signInAnon(){
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIRESTORE_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const j = await res.json();
  if (!j.idToken) throw new Error('فشل الدخول المجهول — فعّل Anonymous في Firebase Authentication. ' + JSON.stringify(j.error || j).slice(0,200));
  return j.idToken;
}

async function commit(fixtures, idToken){
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`;
  for (let i = 0; i < fixtures.length; i += 400) {
    const chunk = fixtures.slice(i, i + 400);
    const writes = chunk.map(fx => {
      const { id, ...data } = fx;
      return { update: { name: `projects/${PROJECT_ID}/databases/(default)/documents/fixtures/${id}`, fields: toFields(data) } };
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
      body: JSON.stringify({ writes })
    });
    if (!res.ok) { console.error('❌ Firestore commit فشل:', res.status, (await res.text()).slice(0,300)); process.exit(1); }
  }
}

async function main(){
  let all = [];
  for (const code of Object.keys(COMP)) {
    try { all = all.concat(await fetchComp(code)); }
    catch (e) { console.error(`❌ [${code}]`, e.message); }
  }
  if (!all.length) { console.log('لا مباريات في النافذة الزمنية.'); return; }
  const idToken = await signInAnon();
  await commit(all, idToken);
  console.log(`✅ تمت مزامنة ${all.length} مباراة إلى Firestore`);
}
main().catch(e => { console.error(e); process.exit(1); });
