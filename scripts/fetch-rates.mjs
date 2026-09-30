// 서울외국환중개(SMBS) 월평균 매매기준율 받기 — node scripts/fetch-rates.mjs   (의존성 없음, Node 18 이상)
//
// 무엇: www.smbs.biz 「월평균 매매기준율」 화면(MonAvgStdExRate.jsp)에 폼을 보내 최근 24개월 값을 받아
//       data/rates.json(기계용)과 data/rates.js(도구가 <script> 로 읽음 — 파일로 연 index.html 에서도 동작)를 씁니다.
// 왜 서버에서: 브라우저에서 smbs.biz 를 바로 부르면 CORS 로 막힙니다(응답에 Access-Control-Allow-Origin 이 없음).
//       그래서 GitHub Actions(.github/workflows/rates.yml)가 매일 이 스크립트를 돌려 같은 저장소에 넣어 둡니다.
// China(RMB): SMBS 는 CNY 를 2016-01-01 부터 고시하지 않고(화면 공지), 원·위안 직거래 시장의 「위안 (CNH)」을 냅니다.
//       도구의 China(RMB) = CNY 칸에는 이 CNH 월평균을 넣습니다.
// 끝나지 않은 달(이번 달)은 SMBS 가 월평균을 내지 않아 들어가지 않습니다.
// 값이 바뀌었을 때만 파일을 새로 씁니다(바뀐 게 없으면 「변경 없음」, Actions 는 커밋하지 않음).
// 한 통화를 받지 못하면 그 통화는 지난 값을 그대로 두고, 모두 실패하면 종료 코드 1.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_JSON = path.join(ROOT, 'data', 'rates.json');
const OUT_JS = path.join(ROOT, 'data', 'rates.js');
const URL_ = 'http://www.smbs.biz/ExRate/MonAvgStdExRate.jsp';
const MONTHS = 24;
// 도구의 통화 칸 ← SMBS 통화 코드 · 고시 단위
const WANT = [
  { cur: 'CNY', smbs: 'CNH', unit: 1 },
  { cur: 'USD', smbs: 'USD', unit: 1 },
  { cur: 'JPY', smbs: 'JPY', unit: 100 },
  { cur: 'EUR', smbs: 'EUR', unit: 1 }
];

const pad = (n) => String(n).padStart(2, '0');
function range(now = new Date()) {
  // 끝 = 지난달(끝난 달), 시작 = 그보다 MONTHS-1 달 앞
  const kst = new Date(now.getTime() + 9 * 3600e3);
  let y = kst.getUTCFullYear(), m = kst.getUTCMonth(); // m = 지난달(0부터 세면 이번 달 - 1 + 1)
  if (m === 0) { y -= 1; m = 12; }
  const end = { y, m };
  let sy = y, sm = m - (MONTHS - 1);
  while (sm < 1) { sm += 12; sy -= 1; }
  return { start: { y: sy, m: sm }, end };
}
/** 화면의 「사이트보안」 글자(d1~d5('%_Z32%_Z30…'))를 풉니다 — SMBS 의 common.js 와 같은 방법(%_X, %u_X 의 X 를 빼고 unescape) */
const decode = (s) => unescape(s.replace(/_[A-Z]/g, ''));
export function parseTable(html) {
  const i = html.indexOf('월평균 매매기준율 결과 표');
  if (i < 0) throw new Error('결과 표를 찾지 못했습니다(화면 구조가 바뀌었을 수 있음)');
  const seg = html.slice(i, html.indexOf('</table>', i));
  const tok = [...seg.matchAll(/d\d\(\s*'([^']*)'\s*\)/g)].map((m) => decode(m[1]).trim());
  const rows = [];
  for (let k = 0; k + 3 < tok.length; k++) {
    if (/^\d{4}$/.test(tok[k]) && /^\d{2}$/.test(tok[k + 1]) && /^[\d,]+\.\d+$/.test(tok[k + 3])) {
      rows.push({ month: tok[k] + '-' + tok[k + 1], name: tok[k + 2], value: Number(tok[k + 3].replace(/,/g, '')) });
      k += 3;
    }
  }
  return rows;
}
async function fetchOne(w, r) {
  const body = new URLSearchParams({
    tongwha_code: w.smbs, StrSch_sYear: String(r.start.y), StrSch_sMonth: pad(r.start.m), StrSch_sDay: '01',
    StrSch_eYear: String(r.end.y), StrSch_eMonth: pad(r.end.m), StrSch_eDay: '01'
  });
  const res = await fetch(URL_, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'data09-18 rates bot (github.com/aebonlee/data09-18)' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const html = new TextDecoder('euc-kr').decode(new Uint8Array(await res.arrayBuffer()));
  const rows = parseTable(html);
  if (!rows.length) throw new Error('값이 없습니다');
  const code = new RegExp('\\(' + w.smbs + '\\)');
  const bad = rows.filter((x) => !code.test(x.name));
  if (bad.length) throw new Error('다른 통화가 섞였습니다: ' + bad[0].name);
  if (w.unit === 100 && !rows.every((x) => /\(100\)/.test(x.name))) throw new Error('엔화 단위(100)를 확인하지 못했습니다');
  const months = {};
  rows.forEach((x) => { if (x.value > 0) months[x.month] = x.value; });
  return { label: rows[rows.length - 1].name, months };
}

async function main() {
  const old = fs.existsSync(OUT_JSON) ? JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')) : { currencies: {} };
  const r = range();
  const cur = {};
  let ok = 0;
  for (const w of WANT) {
    const prev = (old.currencies || {})[w.cur];
    try {
      const got = await fetchOne(w, r);
      cur[w.cur] = { smbsCode: w.smbs, label: got.label, unit: w.unit, months: Object.assign({}, prev ? prev.months : {}, got.months) };
      ok++;
      const last = Object.keys(got.months).sort().pop();
      console.log(`${w.cur}(${w.smbs}) ${Object.keys(got.months).length}개월 — 마지막 ${last} = ${got.months[last]}`);
    } catch (e) {
      console.error(`${w.cur}(${w.smbs}) 받지 못함: ${e.message}` + (prev ? ' — 지난 값을 그대로 둡니다' : ''));
      if (prev) cur[w.cur] = prev;
    }
  }
  if (!ok) { console.error('모든 통화를 받지 못했습니다'); process.exit(1); }
  // 달 순서로 정렬(파일 비교가 흔들리지 않게)
  Object.values(cur).forEach((c) => { c.months = Object.fromEntries(Object.entries(c.months).sort(([a], [b]) => a.localeCompare(b))); });
  if (JSON.stringify(cur) === JSON.stringify(old.currencies)) { console.log('변경 없음 — 파일을 쓰지 않습니다'); return; }
  const out = {
    source: '서울외국환중개 월평균 매매기준율',
    sourceUrl: URL_,
    fetchedAt: new Date().toISOString(),
    note: '외화 1단위당 원(엔화는 100엔당). 끝난 달만 들어 있습니다. China(RMB) = CNY 칸은 SMBS 의 「위안 (CNH)」(원·위안 직거래 시장) 월평균입니다 — SMBS 는 CNY 를 2016-01-01 부터 고시하지 않습니다.',
    currencies: cur
  };
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + '\n');
  fs.writeFileSync(OUT_JS, '/* 자동 생성 — scripts/fetch-rates.mjs (손으로 고치지 마세요). 도구가 <script> 로 읽습니다. */\nwindow.SPRates = ' + JSON.stringify(out, null, 2) + ';\n');
  console.log('썼습니다: data/rates.json · data/rates.js');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
