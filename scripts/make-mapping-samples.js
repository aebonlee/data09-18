// 품번 매핑표·ERP 업로드 양식·매입단가표·품번별 납품처 예시 파일 만들기: node scripts/make-mapping-samples.js
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

// 4) 매입단가표 — 품목코드 | 품목명 | 생산처 | 매입단가 (+ 읽지 않는 판매단가 열), 가상 품번·가상 생산처·가상 단가 (기획서 11.12)
const pw = XLSX.utils.book_new();
for (const [nm, aoa] of Object.entries(S.BUY_PRICE_TABLE)) XLSX.utils.book_append_sheet(pw, XLSX.utils.aoa_to_sheet(aoa), nm);
const p4 = path.join(out, '매입단가표_예시.xlsx');
fs.writeFileSync(p4, XLSX.write(pw, { bookType: 'xlsx', type: 'buffer' }));
// 5) 품번별 납품처표 — 품목코드 | … | 납품처 코드 | 납품처명 | 담당자, 가상 코드·가상 담당자
const aw = XLSX.utils.book_new();
for (const [nm, aoa] of Object.entries(S.ITEM_PARTIES)) XLSX.utils.book_append_sheet(aw, XLSX.utils.aoa_to_sheet(aoa), nm);
const p5 = path.join(out, '품번별납품처_예시.xlsx');
fs.writeFileSync(p5, XLSX.write(aw, { bookType: 'xlsx', type: 'buffer' }));

// 다시 읽어 확인
const a = M.merge(null, M.parseBook(read(p1), path.basename(p1)));
const b = M.merge(null, M.parseBook(read(p2), path.basename(p2)));
const t = U.readTemplate(read(p3));
const ok = a.groups.doosan && a.groups.bobcat && b.groups.bobcat && !b.groups.doosan
  && JSON.stringify(a.groups.bobcat.map) === JSON.stringify(b.groups.bobcat.map)
  && t.sheet === '웹자료올리기' && JSON.stringify(t.headers) === JSON.stringify(U.DEFAULT_HEADERS);
const Pr = require('../js/price.js');
const pt = Pr.parseBook(read(p4));
const pa = U.parseItemParties(read(p5));
if (!ok || pt.stats.pairs !== Pr.parseBook(S.priceBook()).stats.pairs || JSON.stringify(pa.map) !== JSON.stringify(U.parseItemParties(S.partiesBook()).map)) { console.error('다시 읽은 결과가 예시와 다릅니다'); process.exit(1); }
console.log('samples/품번매핑_업로드양식/ 에 5개를 썼습니다 — 매입단가표 ' + pt.stats.pairs + '개 · 품번별 납품처 ' + pa.stats.set + '개 · 건기엔진 ' + a.groups.doosan.stats.pairs + '개 · 밥캣 ' + a.groups.bobcat.stats.pairs + '개(충돌 ' + a.groups.bobcat.stats.conflicts + ') · 양식 ' + t.headers.length + '열');
