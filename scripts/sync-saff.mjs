/* ============================================================
   مزامنة الدوري السعودي (روشن) من موقع الاتحاد saff.com.sa
   يسحب الجدول (٣٤ جولة) + النتائج عند توفّرها، ويكتب في Firestore
   عبر REST بعد دخول مجهول (لا يحتاج أسراراً).
   ============================================================ */
const PROJECT = 'fantsys';
const KEY = 'AIzaSyBHJ8WjFEl71NMonIHa7KY6nRXZEves4nM';
const CHAMP_ID = 415;          // روشن ٢٦/٢٧
const WEEKS = 34;
const SCORE_HOME_FIRST = true; // لو انعكست النتائج بعد أول مباراة، اجعلها false

const EMOJI = {
  'الهلال':'🔵','النصر':'🟡','الاتحاد':'🟡','الأهلي':'🟢','الشباب':'⚪','الاتفاق':'🔴',
  'التعاون':'🔴','الفتح':'🔵','القادسية':'🟡','الفيحاء':'🟢','الرياض':'⚪','الخليج':'🔵',
  'الحزم':'🟢','الخلود':'🟢','نيوم':'🔵','أبها':'🟣','الدرعية':'🟢','الفيصلي':'🟡',
  'ضمك':'🔵','الأخدود':'🟡','الوحدة':'🔴','النجمة':'⚪'
};
const BIG = ['الهلال','النصر','الاتحاد','الأهلي'];
const arDigits = s => String(s).replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[+d]);

async function fetchWeek(w){
  const url = `https://www.saff.com.sa/championship.php?id=${CHAMP_ID}&round=0&week=${w}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const buf = Buffer.from(await res.arrayBuffer());
  return new TextDecoder('windows-1256').decode(buf);
}

function parseWeek(html, round){
  const s = html.indexOf('table-striped'); if (s < 0) return [];
  const tb = html.indexOf('<tbody', s), te = html.indexOf('</tbody>', tb);
  const body = html.slice(tb, te + 8);
  const rows = body.match(/<tr[\s\S]*?<\/tr>/g) || [];
  let curDate = null; const out = [];
  for (const r of rows) {
    const dm = r.match(/calendar_date=([0-9-]+)/); if (dm) curDate = dm[1];
    const time = (r.match(/fixture_td_1_\d+[^>]*>\s*([0-9]{1,2}:[0-9]{2})/) || [])[1];
    const fid = (r.match(/fixture_td_1_(\d+)/) || [])[1];
    const teams = []; const tre = /<a href='team\.php\?id=\d+'[^>]*>([\s\S]*?)<\/a>/g; let m;
    while ((m = tre.exec(r))) { const nm = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); if (nm) teams.push(nm); }
    const scoreCell = (r.match(/fixture_td_3_\d+[^>]*>([\s\S]*?)<\/td>/) || [])[1] || '';
    const sc = scoreCell.replace(/<[^>]+>/g, '').match(/(\d+)\s*[-–]\s*(\d+)/);
    if (time && teams.length >= 2 && curDate) {
      out.push({
        round, fid, date: curDate, time, home: teams[0], away: teams[1],
        scoreH: sc ? +(SCORE_HOME_FIRST ? sc[1] : sc[2]) : null,
        scoreA: sc ? +(SCORE_HOME_FIRST ? sc[2] : sc[1]) : null
      });
    }
  }
  return out;
}

function fsVal(v){
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
const toFields = o => { const f = {}; for (const k in o) f[k] = fsVal(o[k]); return f; };

async function anon(){
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"returnSecureToken":true}' });
  const j = await r.json(); if (!j.idToken) throw new Error('anon sign-in failed'); return j.idToken;
}

async function main(){
  const all = [];
  for (let w = 1; w <= WEEKS; w++) {
    try { all.push(...parseWeek(await fetchWeek(w), w)); }
    catch (e) { console.error('week', w, 'failed:', e.message); }
    await new Promise(r => setTimeout(r, 150));
  }
  const fixtures = all.map(x => {
    const kickoff = Date.parse(`${x.date}T${x.time}:00+03:00`);
    const finished = x.scoreH !== null;
    return {
      id: 'saff_' + (x.fid || (x.round + '_' + x.home + '_' + x.away)),
      lg: 'spl', round: 'الجولة ' + arDigits(x.round),
      h: x.home, hc: EMOJI[x.home] || '⚽', a: x.away, ac: EMOJI[x.away] || '⚽',
      big: BIG.includes(x.home) && BIG.includes(x.away),
      kickoff, status: finished ? 'finished' : 'upcoming',
      resultH: finished ? x.scoreH : null, resultA: finished ? x.scoreA : null, source: 'saff'
    };
  }).filter(f => Number.isFinite(f.kickoff));

  if (!fixtures.length) { console.log('لا مباريات.'); return; }
  const idToken = await anon();
  const H = { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' };
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:commit`;
  let ok = 0;
  for (let i = 0; i < fixtures.length; i += 200) {
    const chunk = fixtures.slice(i, i + 200);
    const writes = chunk.map(fx => { const { id, ...data } = fx; return { update: { name: `projects/${PROJECT}/databases/(default)/documents/fixtures/${id}`, fields: toFields(data) } }; });
    const res = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify({ writes }) });
    if (res.ok) ok += chunk.length; else { console.error('commit فشل:', res.status, (await res.text()).slice(0, 300)); process.exit(1); }
  }
  const done = fixtures.filter(f => f.status === 'finished').length;
  console.log(`✅ السعودي: ${ok} مباراة (${done} منتهية بنتيجة)`);
}
main().catch(e => { console.error(e); process.exit(1); });
