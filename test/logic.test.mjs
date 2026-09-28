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

console.log(`\n${passed}개 통과`);
