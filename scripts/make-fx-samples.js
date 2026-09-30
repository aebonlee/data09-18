// 환율 예시 파일 만들기: node scripts/make-fx-samples.js   (기획서 11.15)
// samples/환율/ 에 씁니다.
//   환율기준_양식.xlsx                       — 「환율기준」 빈 양식 + 「예시」 시트(data/rates.json 의 서울외국환중개 실제 월평균 값) + 「안내」
//   환율기준_서울외국환중개_복사형식_예시.csv — 서울외국환중개 월평균 화면을 복사한 모양(날짜 | 통화명 | 월평균 매매기준율)
//   매입단가표_통화칸_예시.xlsx               — 「통화」 칸이 있는 매입단가표(가상 품번·가상 단가, 일부 China(RMB))
// 끝에 쓴 파일을 도구와 같은 함수로 다시 읽어 값이 그대로인지 확인합니다.
globalThis.window = globalThis;
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const Fx = require('../js/fx.js');
const Pr = require('../js/price.js');

const out = path.join(__dirname, '..', 'samples', '환율');
fs.mkdirSync(out, { recursive: true });
const rates = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'rates.json'), 'utf8'));
const last3 = (c) => Object.keys(rates.currencies[c].months).sort().slice(-3);

// 1. 회사 양식
const example = [['연월', '통화', '환율(원)', '단위', '비고(출처)']];
for (const c of ['CNY', 'USD', 'JPY']) {
  for (const m of last3(c)) example.push([m, c === 'CNY' ? 'China(RMB)' : c, rates.currencies[c].months[m], rates.currencies[c].unit, '예시 — 서울외국환중개 월평균 매매기준율' + (c === 'CNY' ? '(위안 CNH)' : '')]);
}
const guide = [['환율 기준 파일 안내'],
  ['한 줄에 한 달 · 한 통화입니다. 「연월」은 2026-08 · 2026.08 · 2026년 8월 모두 읽습니다.'],
  ['「통화」는 China(RMB) · RMB · CNY · 위안 을 모두 위안으로 읽습니다. USD · JPY · EUR 도 됩니다.'],
  ['「환율(원)」은 외화 1단위당 원입니다. 엔화는 100엔당 값이 기본이며, 1엔당 값을 적으려면 「단위」 칸에 1 을 적습니다.'],
  ['도구는 줄마다 납기월의 전월(설정으로 당월) 환율을 찾습니다. 예: 납기 2026-10 → 2026-09 줄.'],
  ['「예시」 시트는 서울외국환중개 월평균 값을 옮긴 것입니다. 회사 기준 값으로 「환율기준」 시트를 채워 넣어 주세요.']];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(Fx.templateAoa()), '환율기준');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(example), '예시');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(guide), '안내');
fs.writeFileSync(path.join(out, '환율기준_양식.xlsx'), XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));

// 2. 서울외국환중개 복사 형식(CSV)
const smbs = [['날짜', '통화명', '월평균 매매기준율']];
for (const c of ['CNY', 'JPY']) for (const m of last3(c)) smbs.push([m.replace('-', '.'), rates.currencies[c].label, rates.currencies[c].months[m].toFixed(2)]);
fs.writeFileSync(path.join(out, '환율기준_서울외국환중개_복사형식_예시.csv'), '﻿' + smbs.map((r) => r.join(',')).join('\r\n') + '\r\n');

// 3. 통화 칸이 있는 매입단가표(가상)
const buy = [['품목코드', '품목명', '생산처', '매입단가', '통화', '비고'],
  ['SMP-C101', '예시 하네스', '생산처A(가상)', 45.5, 'China(RMB)', '가상 단가'],
  ['SMP-C102', '예시 하네스', '생산처A(가상)', 36, 'RMB', ''],
  ['CH-E305', '예시 하네스', '생산처B(가상)', 15000, 'KRW', '원화'],
  ['SMP-E301', '예시 하네스', '생산처A(가상)', '29.8 RMB', '', '값에 통화를 붙여 적은 줄'],
  ['CH-K601', '예시 하네스', '생산처B(가상)', 800, '', '통화 빈칸 — 화면에서 고른 통화'],
  ['SMP-A502', '예시 하네스', '생산처A(가상)', 1.2, 'USD', '']];
const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(buy), '매입단가표');
fs.writeFileSync(path.join(out, '매입단가표_통화칸_예시.xlsx'), XLSX.write(wb2, { bookType: 'xlsx', type: 'buffer' }));

// 다시 읽어 확인
function book(file) {
  const w = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: true });
  const sheets = {};
  w.SheetNames.forEach((nm) => { sheets[nm] = XLSX.utils.sheet_to_json(w.Sheets[nm], { header: 1, raw: true, defval: '' }); });
  return { names: w.SheetNames, sheets };
}
const a = Fx.parseRateBook(book(path.join(out, '환율기준_양식.xlsx')), '환율기준_양식.xlsx');
const b = Fx.parseRateBook(Fx.textBook(fs.readFileSync(path.join(out, '환율기준_서울외국환중개_복사형식_예시.csv'), 'utf8').replace(/^﻿/, '')), 'csv');
const c = Pr.parseBook(book(path.join(out, '매입단가표_통화칸_예시.xlsx')));
const lastCny = last3('CNY')[2];
const ok = a.stats.pairs === 9 && a.rates['CNY|' + lastCny].raw === rates.currencies.CNY.months[lastCny]
  && b.stats.pairs === 6 && b.rates['JPY|' + lastCny].unit === 100
  && c.stats.pairs === 6 && c.map['SMP-C101'].cur === 'CNY' && c.map['SMP-E301'].cur === 'CNY' && c.map['SMP-A502'].cur === 'USD' && !c.map['CH-E305'].cur && !c.map['CH-K601'].cur;
console.log('양식 예시', a.stats.pairs, '· 복사 형식', b.stats.pairs, '· 매입단가표', c.stats.pairs, ok ? '— 다시 읽기 일치' : '— 불일치');
if (!ok) process.exit(1);
