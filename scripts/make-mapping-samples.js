// 품번 매핑표·ERP 업로드 양식 예시 파일 만들기: node scripts/make-mapping-samples.js
// js/intake-sample.js 의 MAPPING·TEMPLATE_HEAD(가상 품번, 일반 열 이름)를 samples/품번매핑_업로드양식/ 에 씁니다.
// 실제 매핑표·양식은 회사 자료라 리포에 넣지 않습니다. 끝에 쓴 파일을 도구와 같은 함수로 다시 읽어 확인합니다.
globalThis.window = globalThis;
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const S = require('../js/intake-sample.js');
const M = require('../js/mapping.js');
const U = require('../js/upload.js');

const out = path.join(__dirname, '..', 'samples', '품번매핑_업로드양식');
fs.mkdirSync(out, { recursive: true });
const read = (p) => {
  const buf = fs.readFileSync(p);
  const wb = /\.csv$/.test(p) ? XLSX.read(buf.toString('utf8').replace(/^﻿/, ''), { type: 'string', raw: true }) : XLSX.read(buf, { type: 'buffer' });
  const sheets = {};
  wb.SheetNames.forEach((n) => { sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }); });
  return { names: wb.SheetNames, sheets };
};

// 1) 매핑표 — 실제와 같은 두 시트
const wb = XLSX.utils.book_new();
for (const [nm, aoa] of Object.entries(S.MAPPING)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), nm);
const p1 = path.join(out, '품번매핑_예시.xlsx');
fs.writeFileSync(p1, XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
// 2) CSV(시트 하나) — 파일 이름의 「밥캣」으로 묶음을 알아봄
const p2 = path.join(out, '품번매핑_밥캣_예시.csv');
fs.writeFileSync(p2, '﻿' + S.MAPPING['밥캣품목코드'].map((r) => r.join(',')).join('\r\n') + '\r\n');
// 3) 업로드 양식 — 머리행만
const tw = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(tw, XLSX.utils.aoa_to_sheet([S.TEMPLATE_HEAD]), '웹자료올리기');
const p3 = path.join(out, '업로드양식_예시.xlsx');
fs.writeFileSync(p3, XLSX.write(tw, { bookType: 'xlsx', type: 'buffer' }));

// 다시 읽어 확인
const a = M.merge(null, M.parseBook(read(p1), path.basename(p1)));
const b = M.merge(null, M.parseBook(read(p2), path.basename(p2)));
const t = U.readTemplate(read(p3));
const ok = a.groups.doosan && a.groups.bobcat && b.groups.bobcat && !b.groups.doosan
  && JSON.stringify(a.groups.bobcat.map) === JSON.stringify(b.groups.bobcat.map)
  && t.sheet === '웹자료올리기' && JSON.stringify(t.headers) === JSON.stringify(U.DEFAULT_HEADERS);
if (!ok) { console.error('다시 읽은 결과가 예시와 다릅니다'); process.exit(1); }
console.log('samples/품번매핑_업로드양식/ 에 3개를 썼습니다 — 건기엔진 ' + a.groups.doosan.stats.pairs + '개 · 밥캣 ' + a.groups.bobcat.stats.pairs + '개(충돌 ' + a.groups.bobcat.stats.conflicts + ') · 양식 ' + t.headers.length + '열');
