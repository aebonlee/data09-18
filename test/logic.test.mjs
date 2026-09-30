// 실행: node test/logic.test.mjs   (의존성 없음)
// 기대값은 모두 손으로 계산한 값입니다. 기준일 2026-09-28(월).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const S0 = L.mergeSettings({ baseDate: '2026-09-28' });

console.log('날짜·수량 읽기');
test('여러 날짜 표기', () => {
  assert.equal(L.parseDate('2026-09-28'), '2026-09-28');
  assert.equal(L.parseDate('2026.9.3'), '2026-09-03');
  assert.equal(L.parseDate('2026/10/05'), '2026-10-05');
  assert.equal(L.parseDate('20261005'), '2026-10-05');
  assert.equal(L.parseDate(46293), '2026-09-28'); // 엑셀 일련번호
  assert.equal(L.parseDate(new Date(2026, 8, 28)), '2026-09-28');
  assert.equal(L.parseDate('2026-02-30'), null);
  assert.equal(L.parseDate('9/29'), null); // 연도 없는 값은 받지 않음
});
test('수량: 쉼표·EA 허용, 음수·문자 거부', () => {
  assert.equal(L.parseQty('1,200'), 1200);
  assert.equal(L.parseQty('300EA'), 300);
  assert.equal(L.parseQty(0), 0);
  assert.equal(L.parseQty('-5'), null);
  assert.equal(L.parseQty('abc'), null);
});

console.log('입고예정일 규칙 (기획서 5.1 — 월~수 +2일, 목·금 다음 월요일)');
test('월→수, 화→목, 수→금', () => {
  assert.equal(L.arrivalDate('2026-09-28', S0), '2026-09-30');
  assert.equal(L.arrivalDate('2026-09-29', S0), '2026-10-01');
  assert.equal(L.arrivalDate('2026-09-30', S0), '2026-10-02');
});
test('목·금 → 다음 월요일', () => {
  assert.equal(L.arrivalDate('2026-10-01', S0), '2026-10-05');
  assert.equal(L.arrivalDate('2026-10-02', S0), '2026-10-05');
});
test('토·일은 규칙 없음(null)', () => {
  assert.equal(L.arrivalDate('2026-10-03', S0), null);
  assert.equal(L.arrivalDate('2026-10-04', S0), null);
});
test('휴일에 걸리면 다음 영업일', () => {
  const s = L.mergeSettings({ holidays: ['2026-10-05'] });
  assert.equal(L.arrivalDate('2026-10-01', s), '2026-10-06');
  const s2 = L.mergeSettings({ holidays: ['2026-10-02'] });
  assert.equal(L.arrivalDate('2026-09-30', s2), '2026-10-05'); // 금 휴일 → 토·일 건너 월
});
test('역산: 목표일까지 입고되는 가장 늦은 선적일', () => {
  assert.equal(L.latestShipFor('2026-10-02', '2026-09-28', S0), '2026-09-30');
  assert.equal(L.latestShipFor('2026-10-13', '2026-09-28', S0), '2026-10-09'); // 화요일 부족분 → 전주 금 선적(월 입고)
  assert.equal(L.latestShipFor('2026-09-28', '2026-09-28', S0), null);
});

console.log('기획안 10장 예시표 (A001~A004, 안전재고 0)');
const ex = L.compute({
  orders: [
    { item: 'A001', dueDate: '2026-10-02', qty: 1000 },
    { item: 'A002', dueDate: '2026-10-08', qty: 800 },
    { item: 'A003', dueDate: '2026-10-07', qty: 1200 },
    { item: 'A004', dueDate: '2026-10-09', qty: 500 }
  ],
  stock: [
    { item: 'A001', current: 300 }, { item: 'A002', current: 500 },
    { item: 'A003', current: 1500 }, { item: 'A004', current: 1000 }
  ],
  shipments: [
    { item: 'A001', shipDate: '2026-09-28', qty: 400 },
    { item: 'A003', shipDate: '2026-10-01', qty: 500 }
  ]
}, { baseDate: '2026-09-28' });
const byItem = r => Object.fromEntries(r.results.map(x => [x.item, x]));
test('예상재고 -300 / -300 / 800 / 500', () => {
  const b = byItem(ex);
  assert.deepEqual(['A001', 'A002', 'A003', 'A004'].map(k => b[k].expected), [-300, -300, 800, 500]);
});
test('부족수량 300 / 300 / 0 / 0', () => {
  const b = byItem(ex);
  assert.deepEqual(['A001', 'A002', 'A003', 'A004'].map(k => b[k].shortage), [300, 300, 0, 0]);
});
test('상태 긴급 / 부족 / 정상 / 과잉 (긴급 7일, 과잉 100%)', () => {
  const b = byItem(ex);
  assert.deepEqual(['A001', 'A002', 'A003', 'A004'].map(k => b[k].status), ['긴급', '부족', '정상', '과잉']);
});
test('A001 선적계획: 9/30(수) 300 → 10/2(금) 입고', () => {
  const p = ex.plans.filter(x => x.item === 'A001');
  assert.equal(p.length, 1);
  assert.deepEqual([p[0].shipDate, p[0].arrival, p[0].qty, p[0].late], ['2026-09-30', '2026-10-02', 300, false]);
});
test('입고 여유 1일이면 A001 은 9/29(화) 선적 (기획안 예시의 선적일)', () => {
  const r = L.compute({ orders: [{ item: 'A001', dueDate: '2026-10-02', qty: 1000 }], stock: [{ item: 'A001', current: 300 }],
    shipments: [{ item: 'A001', shipDate: '2026-09-28', qty: 400 }] }, { baseDate: '2026-09-28', arrivalBuffer: 1 });
  assert.deepEqual([r.plans[0].shipDate, r.plans[0].arrival, r.plans[0].qty], ['2026-09-29', '2026-10-01', 300]);
});
test('긴급·과잉 기준을 비우면 판정 안 함', () => {
  const r = L.compute({ orders: [{ item: 'A001', dueDate: '2026-10-02', qty: 1000 }, { item: 'A004', dueDate: '2026-10-09', qty: 500 }],
    stock: [{ item: 'A001', current: 300 }, { item: 'A004', current: 1000 }], shipments: [] }, { baseDate: '2026-09-28', urgentDays: '', excessRatio: '' });
  const b = byItem(r);
  assert.equal(b.A001.status, '부족');
  assert.equal(b.A004.status, '정상');
});

console.log('예시 데이터 전체 (sample-data.js)');
function loadSample(settings) {
  const data = {};
  for (const k of ['orders', 'stock', 'shipments']) {
    const aoa = Sample.tables[k];
    const hr = L.findHeaderRow(aoa);
    const m = L.guessMapping(aoa[hr], k);
    const out = L.mapRows(aoa, hr, m, k);
    assert.equal(out.errors.length, 0, k + ' 매핑 오류 ' + JSON.stringify(out.errors));
    data[k] = out.rows;
  }
  return L.compute(data, Object.assign({ baseDate: Sample.BASE }, settings || {}));
}
const R = loadSample();
const B = byItem(R);
test('기획안 열 이름이 자동 매핑됨', () => {
  const m = L.guessMapping(Sample.tables.shipments[0], 'shipments');
  assert.deepEqual(m, { item: 0, name: 1, shipDate: 2, qty: 3, fileArrival: 4 });
  const o = L.guessMapping(['부품번호', 'Due Date', '주문수량'], 'orders');
  assert.deepEqual(o, { item: 0, dueDate: 1, qty: 2 });
});
test('필수 열이 매핑 안 되면 unmapped 오류', () => {
  const out = L.mapRows([['품번', '수량'], ['A1', 3]], 0, { item: 0, qty: 1 }, 'orders');
  assert.deepEqual(out.errors, [{ row: 0, field: 'dueDate', code: 'unmapped' }]);
});
test('잘못된 수량 행은 빠지고 행 번호로 보고', () => {
  const out = L.mapRows([['품번', '납기일', '수량'], ['A1', '2026-10-01', 'x'], ['A2', '2026-10-01', 5]], 0, { item: 0, dueDate: 1, qty: 2 }, 'orders');
  assert.equal(out.rows.length, 1);
  assert.deepEqual(out.errors, [{ row: 2, field: 'qty', code: 'bad_value', value: 'x' }]);
});
test('화요일에 처음 부족 (A005): 10/13(화) 100 부족 → 10/9(금) 선적, 10/12(월) 입고', () => {
  assert.deepEqual([B.A005.firstShort, B.A005.shortage, B.A005.status], ['2026-10-13', 100, '부족']);
  const p = R.plans.find(x => x.item === 'A005');
  assert.deepEqual([p.shipDate, p.arrival, p.qty], ['2026-10-09', '2026-10-12', 100]);
});
test('입고가 늦어 생기는 부족 (A006): 합계는 +200 이지만 9/30 에 -200 → 주의', () => {
  assert.deepEqual([B.A006.balance, B.A006.shortage, B.A006.firstShort, B.A006.status], [200, 200, '2026-09-30', '주의']);
  const p = R.plans.find(x => x.item === 'A006');
  assert.deepEqual([p.shipDate, p.arrival, p.qty], ['2026-09-28', '2026-09-30', 200]);
});
test('안전재고 파일 값 반영 (A007): 예상재고 70, 과부족 -30, 8일 뒤 → 부족', () => {
  assert.deepEqual([B.A007.safety, B.A007.expected, B.A007.balance, B.A007.shortage, B.A007.status], [100, 70, -30, 30, '부족']);
  assert.equal(loadSample({ urgentDays: 8 }).results.find(x => x.item === 'A007').status, '긴급');
});
test('토요일 선적 (A009) 은 규칙 없음 경고 후 계산에서 제외', () => {
  assert.equal(B.A009.inSum, 0);
  assert.equal(B.A009.balance, -50);
  assert.ok(R.warnings.some(w => w.code === 'no_rule' && w.item === 'A009'));
});
test('기준일 전 납기 (A010): 기준일에 빼고, 제때 입고 불가 표시', () => {
  assert.deepEqual([B.A010.status, B.A010.shortage, B.A010.firstShort], ['긴급', 70, '2026-09-28']);
  assert.ok(B.A010.flags.includes('overdue_orders'));
  const p = R.plans.find(x => x.item === 'A010');
  assert.deepEqual([p.shipDate, p.arrival, p.late], ['2026-09-28', '2026-09-30', true]);
});
test('파일 입고일과 규칙 계산이 다르면 표시 (A011), 계산은 규칙 값', () => {
  const s = R.shipments.find(x => x.item === 'A011');
  assert.deepEqual([s.calcArrival, s.fileArrival, s.arrival], ['2026-10-08', '2026-10-09', '2026-10-08']);
  assert.ok(s.issues.includes('mismatch'));
});
test('재고현황에 없는 품번 (A013) 표시, 수주 없는 품번 (A012) 과잉', () => {
  assert.ok(B.A013.flags.includes('no_stock_row'));
  assert.equal(B.A013.status, '부족');
  assert.equal(B.A012.status, '과잉');
});
test('가용재고 기준으로 바꾸면 A002 예상재고 -350', () => {
  assert.equal(loadSample({ stockField: 'available' }).results.find(x => x.item === 'A002').expected, -350);
});
test('정렬: 긴급 → 부족 → 주의 → 과잉 → 정상', () => {
  assert.deepEqual(R.results.map(x => x.status).filter((s, i, a) => a.indexOf(s) === i), ['긴급', '부족', '주의', '과잉', '정상']);
});

console.log('Dashboard (기획안 11장)');
const K = L.dashboard(R, R.plans);
test('품번 13 · 수주 5,850 · 현재고 4,500 · 입고예정 2,450', () => {
  assert.deepEqual([K.items, K.orderSum, K.stock, K.inSum], [13, 5850, 4500, 2450]);
});
test('부족 품번 7 · 부족수량 950 · 긴급 A010, A001', () => {
  assert.deepEqual([K.shortItems, K.shortage], [7, 950]);
  assert.deepEqual(K.urgentItems.slice().sort(), ['A001', 'A010']);
});
test('상태별 개수', () => {
  assert.deepEqual(K.byStatus, { '정상': 3, '부족': 5, '주의': 1, '과잉': 2, '긴급': 2 });
});
test('금주(9/28~10/4) 제안 선적 600 · 확정 선적예정 2,250', () => {
  assert.deepEqual([K.weekShipPlanned, K.weekShipConfirmed], [600, 2250]);
  assert.equal(K.weeks[0].week, '2026-09-28');
});

console.log('선적계획 수정·AI·내보내기');
test('사용자 수정: 선적일을 목요일로 바꾸면 입고 다음 월요일, 필요일보다 늦음', () => {
  const p = R.plans.find(x => x.item === 'A001');
  const e = L.applyPlanEdits(R.plans, { [p.id]: { shipDate: '2026-10-01', qty: '350' } }, R.settings).find(x => x.id === p.id);
  assert.deepEqual([e.arrival, e.qty, e.late, e.edited], ['2026-10-05', 350, true, true]);
});
test('AI 질문문: 부족·긴급·주의 품번만, 고객사·품명 기본 제외', () => {
  const t = L.buildAiPrompt(R, R.plans);
  assert.ok(t.includes('A005 | 부족 | 2026-10-13'));
  assert.ok(!t.includes('A003 |'));
  assert.ok(!t.includes('예시고객사'));
  assert.ok(!t.includes('예시 하네스'));
  assert.ok(L.buildAiPrompt(R, R.plans, { includeName: true }).includes('예시 하네스 A005'));
});
test('AI 답 붙여넣기: 형식 줄만 읽고 우선순위 순 정렬', () => {
  const a = L.parseAiAnswer('품번 | 우선순위 | 의견\n|---|---|---|\nA005 | 2 | 화요일 부족\n- **A010** | 1 | 즉시 선적\n엉뚱한 줄\nZZZ | 3 | 모르는 품번', R.results.map(x => x.item));
  assert.deepEqual(a.rows.map(x => [x.item, x.priority, x.comment]), [['A010', 1, '즉시 선적'], ['A005', 2, '화요일 부족']]);
  assert.equal(a.skipped.length, 2);
});
test('내보내기 시트 5개, 선적계획 행 = 계획 수 + 머리행', () => {
  const s = L.exportSheets(R, R.plans, []);
  assert.deepEqual(Object.keys(s), ['과부족현황', '선적계획', '부족품번', '일자별예상재고', '입고예정계산']);
  assert.equal(s['선적계획'].length, R.plans.length + 1);
});
test('통합 데이터 파일을 다시 읽으면 같은 결과 (표준 열 이름 자동 매핑)', () => {
  const data = {};
  for (const k of ['orders', 'stock', 'shipments']) {
    const aoa = Sample.tables[k]; const out = L.mapRows(aoa, 0, L.guessMapping(aoa[0], k), k); data[k] = out.rows;
  }
  const sheets = L.dataSheets(data);
  const back = {};
  const key = { '수주현황': 'orders', '재고현황': 'stock', '선적예정': 'shipments' };
  for (const [n, aoa] of Object.entries(sheets)) back[key[n]] = L.mapRows(aoa, 0, L.guessMapping(aoa[0], key[n]), key[n]).rows;
  assert.deepEqual(back, data);
});

// ── 수주 취합 (기획서 11장) ─────────────────────────────
const I = require('../js/intake.js');
const IS = require('../js/intake-sample.js');
const XLSX = require('../vendor/xlsx.full.min.js');
const NOW = new Date(2026, 8, 29);
const RS = I.process(IS.asInput(), {}, NOW);
const rowsOf = (res, re) => res.rows.filter((r) => re.test(r.source));
const repOf = (res, re) => res.files.find((f) => re.test(f.file));

console.log('수주 취합 — 파일 판별');
test('파일 이름으로 종류·구분·공장 판별 (요청 16개 파일 이름 모양)', () => {
  const c = (n) => { const x = I.classify(n); return [x.type, x.group, x.plant].join('/'); };
  assert.equal(c('2026.09.29_납품예정 군산건기(예정신고전).xlsx'), 'plan/건기/군산');
  assert.equal(c('2026.09.29_납품예정 인천엔진.xlsx'), 'plan/엔진/인천');
  assert.equal(c('2026.09.29_납품예정 안산AM.xlsx'), 'plan/AM/안산');
  assert.equal(c('2026.09.29_납품예정CKD건기.xlsx'), 'plan/CKD/');
  assert.equal(c('2026.09.29_누적결품 군산엔진.xlsx'), 'short/엔진/군산');
  assert.equal(c('2026.09.29_직송 인천건기.xlsx'), 'direct/건기/인천');
  assert.equal(c('26.09.29_누적결품 밥캣.xls'), 'bobcatShort/밥캣/');
  assert.equal(c('3_26.09.29_납품예정 밥캣 직송.xls'), 'bobcatDirect/밥캣/');
  assert.equal(c('4_26.09.29_납품예정 밥캣 일반.xls'), 'bobcatPlan/밥캣/');
  assert.equal(c('7_선적계획(품목코드,미판매수량,변경선적요청일).xlsx'), 'shipplan//');
  assert.equal(c('창고별재고현황_2026.09.29(품목코드,합계).xlsx'), 'stock//');
  assert.equal(c('고객사A.xlsx'), 'po?//');
  assert.equal(c('고객사F.PDF'), 'pdf//');
  assert.equal(c('2026.09.29_납품예정 인천.xlsx'), 'unknown//인천'); // 건기·엔진을 모름
  assert.equal(I.fileDate('26.09.29_누적결품 밥캣.xls'), '2026-09-29');
  assert.equal(I.fileDate('2026.09.29_직송 인천엔진.xlsx'), '2026-09-29');
  assert.equal(I.fileDate('고객사A.xlsx'), null);
});
test('발주서 양식은 머리행으로 판별 — 목록형 A·B·C, 서식형 D, 모르는 파일은 ★확인 필요', () => {
  const t = (re) => repOf(RS, re).typeLabel;
  assert.match(t(/고객사A_/), /목록형 A/); assert.match(t(/고객사G_/), /목록형 A/);
  assert.match(t(/고객사B_/), /목록형 B/); assert.match(t(/고객사C_/), /목록형 C/);
  assert.match(t(/고객사D_/), /서식형 D/); assert.match(t(/고객사E_/), /서식형 D/);
  assert.equal(repOf(RS, /고객사F_/).typeLabel, '발주서(PDF)');
  assert.ok(RS.checks.some((c) => /회의메모/.test(c.file) && c.reason === '종류를 판별하지 못한 파일'));
  assert.equal(rowsOf(RS, /고객사A_/)[0].customer, '고객사A_발주서'); // 고객사 = 파일 이름
});
test('같은 파일이 두 번(번호 붙은 사본) 들어오면 한 번만 반영하고 알림', () => {
  const inp = IS.asInput(); const dup = Object.assign({}, inp[0], { name: '0_' + inp[0].name });
  const r = I.process(inp.concat([dup]), {}, NOW);
  assert.equal(r.rows.length, RS.rows.length);
  assert.ok(r.checks.some((c) => c.reason === '같은 파일이 두 번 들어옴'));
});

console.log('수주 취합 — 규칙');
test('누적결품: 음수 = 결품, 양수로 바꿔 날짜별 늘어난 만큼 한 줄씩 / single 은 최대 결품 한 줄', () => {
  const s = [3, -1, -1, -4, -2, -6].map((v, i) => ({ date: '2026-10-0' + (i + 1), v }));
  assert.deepEqual(I.shortageSteps(s, 'increment').map((x) => [x.date, x.qty]), [['2026-10-02', 1], ['2026-10-04', 3], ['2026-10-06', 2]]);
  assert.deepEqual(I.shortageSteps(s, 'single').map((x) => [x.date, x.qty]), [['2026-10-02', 6]]);
  assert.deepEqual(I.shortageSteps([{ date: '2026-10-01', v: 5 }, { date: '2026-10-02', v: 0 }], 'increment'), []);
});
test('엔진 결품: 납기 = 결품일 − 2일, 수량 양수, 발주일 = 작성일자(파일 이름 날짜)', () => {
  const e = rowsOf(RS, /누적결품 인천엔진/).filter((r) => r.item === 'SMP-E301');
  // 누적: 10/05 −2, 10/08 −5, 10/29 −9 → 2, 3, 4
  assert.deepEqual(e.map((r) => [r.shortDate, r.due, r.qty]), [['2026-10-05', '2026-10-03', 2], ['2026-10-08', '2026-10-06', 3], ['2026-10-29', '2026-10-27', 4]]);
  assert.ok(e.every((r) => r.qty > 0 && r.orderDate === '2026-09-29'));
  const r3 = I.process(IS.asInput(), { engineShortOffset: 3 }, NOW);
  assert.equal(rowsOf(r3, /누적결품 인천엔진/)[0].due, '2026-10-02');
});
test('누적결품 월 칸(11·12·01…): 일별 칸과 같은 달이면 마지막 다음날, 아니면 그 달 첫날 · 끄면 빠짐', () => {
  const d = I.shortDateCols(['품목코드', '2026/11/22', '2026/11/23', '11', '12', '01'], true).cols.map((c) => c.date);
  assert.deepEqual(d, ['2026-11-22', '2026-11-23', '2026-11-24', '2026-12-01', '2027-01-01']);
  const e5 = rowsOf(RS, /누적결품 인천엔진/).filter((r) => r.item === 'SMP-E305');
  assert.deepEqual(e5.map((r) => [r.shortDate, r.qty]), [['2026-12-01', 3], ['2027-02-01', 4]]);
  assert.equal(rowsOf(I.process(IS.asInput(), { monthBuckets: false }, NOW), /누적결품 인천엔진/).filter((r) => r.item === 'SMP-E305').length, 0);
});
test('건기는 납품예정만 — 건기 누적결품은 참고자료로 수집 안 함', () => {
  assert.equal(rowsOf(RS, /누적결품 인천건기|누적결품 군산건기/).length, 0);
  assert.equal(repOf(RS, /누적결품 인천건기/).excluded['참고자료(건기 누적결품 — 요청 ①)'], 2);
  assert.equal(rowsOf(RS, /납품예정 인천건기/).filter((r) => r.note === 'Mass PO').length, 2); // 건기는 Mass PO 도 넣음
});
test('엔진 납품예정: V열 오더유형 Mass PO 제외', () => {
  const rep = repOf(RS, /납품예정 인천엔진/);
  assert.equal(rep.excluded['오더유형 Mass PO(요청 ② — 엔진 납품예정 제외)'], 2);
  assert.ok(rowsOf(RS, /납품예정 (인천|군산)엔진/).every((r) => !/Mass PO/i.test(r.note)));
  assert.equal(repOf(RS, /납품예정 군산엔진/).collected, 0);
});
test('엔진 결품·납품예정 같은 품번: 기본 결품 우선(납품예정 행 뺌), 합산으로 바꾸면 둘 다', () => {
  assert.equal(rowsOf(RS, /납품예정 인천엔진/).filter((r) => r.item === 'SMP-E301').length, 0);
  assert.equal(repOf(RS, /납품예정 인천엔진/).excluded['같은 공장 누적결품에 같은 품번 — 결품 우선'], 1);
  const sum = I.process(IS.asInput(), { engineMode: 'sum' }, NOW);
  assert.equal(rowsOf(sum, /납품예정 인천엔진/).filter((r) => r.item === 'SMP-E301').length, 1);
});
test('선적계획: 품목코드 끝 (CI) 삭제, 미판매수량 → 선적수량, 변경선적요청일 → 선적일(비면 납기일자 + ★)', () => {
  assert.deepEqual(RS.shipments.map((s) => [s.item, s.qty, s.shipDate]), [['SMP-E301', 12, '2026-10-01'], ['SMP-C101', 10, '2026-10-06'], ['SMP-B703', 600, '2026-10-05']]);
  assert.ok(RS.checks.some((c) => c.reason === '변경선적요청일이 비어 납기일자를 씀'));
  assert.equal(repOf(RS, /선적계획/).excluded['소계·합계·출력시각 행'], 3);
});
test('밥캣: 원납기를 [기준일 ~ 결품 마지막 날짜]로 조임, 결품(위블록) 품번과 겹치는 일반 행 제외', () => {
  assert.equal(I.clampDue('2026-09-07', '2026-09-29', '2026-10-22'), '2026-09-29');
  assert.equal(I.clampDue('2026-11-17', '2026-09-29', '2026-10-22'), '2026-10-22');
  assert.equal(I.clampDue('2026-10-13', '2026-09-29', '2026-10-22'), '2026-10-13');
  assert.equal(I.clampDue('2026-11-17', '2026-09-29', null), '2026-11-17'); // 결품 파일 없으면 위쪽 조임 안 함
  const b = rowsOf(RS, /밥캣 일반/);
  assert.deepEqual(b.map((r) => [r.item, r.originalDue, r.due]), [['SMP-B703', '2026-09-07', '2026-09-29'], ['SMP-B704', '2026-10-13', '2026-10-13'], ['SMP-B705', '2026-11-17', '2026-10-22']]);
  assert.equal(repOf(RS, /밥캣 일반/).excluded['누적결품(위블록) 품번과 겹침 — 결품 값 우선(매크로 규칙)'], 1);
  assert.equal(RS.lastBobcatDate, '2026-10-22');
});
test('직송(확정 2026-09-30): 기본으로 납품예정과 같이 넣음(엔진 직송은 Mass PO 라 빠짐), 끄면 빠짐', () => {
  assert.deepEqual(rowsOf(RS, /직송/).map((r) => r.item).sort(), ['SMP-B706', 'SMP-C105']);
  assert.equal(repOf(RS, /직송 인천엔진/).excluded['오더유형 Mass PO(요청 ② — 엔진 납품예정 제외)'], 1);
  const off = I.process(IS.asInput(), { collectDirect: false }, NOW);
  assert.equal(rowsOf(off, /직송/).length, 0);
});
test('밥캣 결품(확정 2026-09-30): 납기 = 결품일 − 2일, 0 으로 바꾸면 결품일 그대로', () => {
  const b = rowsOf(RS, /누적결품 밥캣/);
  assert.deepEqual(b.map((r) => [r.item, r.shortDate, r.due]), [['SMP-B702', '2026-10-01', '2026-09-29'], ['SMP-B701', '2026-10-06', '2026-10-04'], ['SMP-B701', '2026-10-08', '2026-10-06']]);
  const z = I.process(IS.asInput(), { bobcatShortOffset: 0 }, NOW);
  assert.ok(rowsOf(z, /누적결품 밥캣/).every((r) => r.due === r.shortDate));
});
test('재고 품번의 「완제품」(확정 2026-09-30): 떼지 않고 그대로, ★확인 없이 정확히 같은 품번끼리만 맞춤', () => {
  assert.ok(RS.stock.some((x) => x.item === 'SMP-C103-완제품'));
  assert.ok(!RS.stock.some((x) => x.item === 'SMP-C103'));
  assert.ok(!RS.checks.some((c) => /한글/.test(c.reason)));
  assert.ok(I.isFinishedCode('ABC-1[완제품]') && I.isFinishedCode('완제품ABC') && !I.isFinishedCode('ABC-1'));
  const res = L.compute({ orders: [{ item: 'SMP-C103', name: '', customer: '', orderDate: null, dueDate: '2026-10-02', qty: 3 }], stock: RS.stock, shipments: [] }, { baseDate: '2026-09-29' });
  assert.equal(res.results.find((r) => r.item === 'SMP-C103').stock, 0); // 완제품 품번 재고와 합치지 않음
});
test('저장된 예전 설정(판 없음)은 이번에 확정된 칸만 새 기본값으로, 나머지 설정은 유지', () => {
  const up = I.upgradeOptions({ collectDirect: false, bobcatShortOffset: 0, engineMode: 'sum', poAllSheets: true, monthBuckets: false, portalCustomer: '우리 고객' });
  assert.deepEqual([up.collectDirect, up.bobcatShortOffset, up.engineMode, up.poAllSheets, up.monthBuckets, up.portalCustomer], [true, 2, 'override', false, false, '우리 고객']);
  const keep = I.upgradeOptions(Object.assign(I.defaultOptions(), { collectDirect: false }));
  assert.equal(keep.collectDirect, false); // 새 판에서 사용자가 끈 것은 그대로
});
test('발주서: 목록형은 잔량 열, 서식형은 납기일 칸·날짜별 칸, 가장 늦은 시트만(설정으로 전부)', () => {
  assert.deepEqual(rowsOf(RS, /고객사A_/).map((r) => [r.item, r.qty, r.due, r.orderDate]), [['SMP-P801', 20, '2026-10-02', '2026-09-14'], ['SMP-P802', 40, '2026-10-12', '2026-09-24']]);
  assert.deepEqual(rowsOf(RS, /고객사B_/).map((r) => r.qty), [1, 3]); // 납품 가능 수량 = 수주 − 생성
  assert.deepEqual(rowsOf(RS, /고객사D_/).map((r) => [r.item, r.qty, r.due]), [['SMP-P831', 200, '2026-10-09'], ['SMP-P832', 50, '2026-10-09']]);
  assert.deepEqual(rowsOf(RS, /고객사E_/).map((r) => [r.item, r.qty, r.due]), [['SMP-P841', 130, '2026-10-10'], ['SMP-P841', 40, '2026-10-24'], ['SMP-P842', 24, '2026-10-24']]);
  assert.ok(RS.checks.some((c) => /고객사E_/.test(c.file) && c.reason === '날짜로 읽지 못한 수량 칸 머리'));
  assert.ok(RS.checks.some((c) => /고객사E_/.test(c.file) && /음수/.test(c.reason)));
  assert.equal(rowsOf(I.process(IS.asInput(), { poAllSheets: true }, NOW), /고객사E_/).length, 4);
});
test('PDF 발주서: 한 글자씩 흩어진 머리·두 줄로 나뉜 품목코드를 이어 읽음', () => {
  const p = I.parsePdfOrder(IS.PDF_ITEMS);
  assert.equal(p.orderDate, '2026-09-10'); assert.equal(p.due, '2026-10-08');
  assert.deepEqual(p.lines.map((l) => [l.item, l.qty]), [['SMP-PDF-0001', 120], ['SMP-D002', 40]]);
  assert.deepEqual(I.parsePdfOrder([{ x: 1, y: 1, str: '안내문' }]).problems, ['「품목코드」 머리를 찾지 못했습니다']);
});
test('빠뜨리지 않기: 파일마다 읽은 행 = 수집 + 규칙 제외 + ★확인 필요 (누적결품은 줄이 늘어 제외)', () => {
  RS.files.filter((f) => !/누적결품/.test(f.file)).forEach((f) => {
    const ck = RS.checks.filter((c) => c.file === f.file && c.row !== '' && !/머리|파일/.test(c.reason) && !/납기일자를 씀|한글/.test(c.reason)).length;
    const multi = /고객사E_/.test(f.file) ? 1 : 0; // P841 한 행이 날짜 두 칸으로 두 줄
    assert.equal(f.collected + I.excludedCount(f) + ck, f.read + multi, f.file);
  });
  assert.equal(RS.rows.length, 40); assert.equal(RS.checks.length, 5);
});

console.log('수주 취합 — 파일 읽기·넘기기');
test('포털 xlsx 의 「<si >」: 그냥 읽으면 글자 칸이 비고, fixZip 을 거치면 머리행이 보임', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['품목코드', '납품잔량'], ['SMP-1', 3]]), 'sheet1');
  const cfb = XLSX.CFB.read(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer', bookSST: true }), { type: 'buffer' });
  cfb.FileIndex.forEach((fi) => { if (/sharedStrings/.test(fi.name)) { fi.content = Buffer.from(Buffer.from(fi.content).toString().replace(/<si>/g, '<si >')); fi.size = fi.content.length; } });
  const bad = new Uint8Array(XLSX.CFB.write(cfb, { type: 'buffer', fileType: 'zip' }));
  const read = (u8) => XLSX.utils.sheet_to_json(XLSX.read(u8, { type: 'array' }).Sheets.sheet1, { header: 1, defval: '' });
  assert.deepEqual(read(bad)[0], ['', '']);
  assert.deepEqual(read(I.fixZip(bad, XLSX))[0], ['품목코드', '납품잔량']);
  const good = new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
  assert.equal(I.fixZip(good, XLSX), good); // 고칠 것이 없으면 그대로
});
test('「이 수주로 선적계획 계산」: 통합 표 → 입력 ① 수주현황 표준 열로 자동 매핑, 재고·선적예정도 넘겨 계산', () => {
  const aoa = I.ordersAoa(RS.rows);
  const m = L.guessMapping(aoa[0], 'orders');
  assert.deepEqual(Object.keys(m).sort(), ['customer', 'dueDate', 'item', 'name', 'orderDate', 'qty']);
  const orders = L.mapRows(aoa, 0, m, 'orders');
  assert.equal(orders.errors.length, 0); assert.equal(orders.rows.length, RS.rows.length);
  const res = L.compute({ orders: orders.rows, stock: RS.stock, shipments: RS.shipments }, { baseDate: RS.base });
  const e301 = res.results.find((r) => r.item === 'SMP-E301');
  assert.equal(e301.orderSum, 9); assert.equal(e301.stock, 2); assert.equal(e301.inSum, 12); // 선적 10/01(목) → 10/05 입고
  const sheets = I.exportSheets(RS);
  assert.deepEqual(Object.keys(sheets), ['통합수주', '파일별집계', '★확인필요', '수주현황', '재고현황', '선적예정']);
  assert.equal(sheets['통합수주'].length, RS.rows.length + 1);
});

console.log(`\n${passed}개 통과`);
