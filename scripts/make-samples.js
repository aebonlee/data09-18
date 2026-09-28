// 예시 데이터 파일 생성: node scripts/make-samples.js
// js/sample-data.js(가상 데이터)를 samples/ 에 xlsx·csv 로 씁니다. 파일 이름에 「예시데이터」가 붙습니다.
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

const out = path.join(__dirname, '..', 'samples');
fs.mkdirSync(out, { recursive: true });
const all = XLSX.utils.book_new();
for (const k of ['orders', 'stock', 'shipments']) {
  const label = L.DATASETS[k].label;
  const aoa = Sample.tables[k];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), label);
  fs.writeFileSync(path.join(out, `예시데이터_${label}.xlsx`), XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
  fs.writeFileSync(path.join(out, `예시데이터_${label}.csv`), L.toCsv(aoa));
  XLSX.utils.book_append_sheet(all, XLSX.utils.aoa_to_sheet(aoa), label);
}
fs.writeFileSync(path.join(out, '예시데이터_통합데이터.xlsx'), XLSX.write(all, { bookType: 'xlsx', type: 'buffer' }));

// 검증: 쓴 파일을 앱과 같은 방식으로 다시 읽어 매핑 오류가 없는지 확인
const back = XLSX.read(fs.readFileSync(path.join(out, '예시데이터_통합데이터.xlsx')), { type: 'buffer', cellDates: true });
for (const k of ['orders', 'stock', 'shipments']) {
  const aoa = XLSX.utils.sheet_to_json(back.Sheets[L.DATASETS[k].label], { header: 1, raw: true, defval: '' });
  const r = L.mapRows(aoa, 0, L.guessMapping(aoa[0], k), k);
  if (r.errors.length || r.rows.length !== Sample.tables[k].length - 1) { console.error(k, r.errors); process.exit(1); }
}
console.log('samples/ 에 예시데이터 파일 7개를 썼습니다');
