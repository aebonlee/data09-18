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

console.log('품번 매핑표 (고객사 품번 → 천일품번, 기획서 11.10)');
const M = require('../js/mapping.js');
const U = require('../js/upload.js');
const MAP = M.merge(null, M.parseBook(IS.mappingBook(), '품번매핑_예시.xlsx'), '품번매핑_예시.xlsx', 't');
const MI = M.apply(RS.rows, MAP, {});
const rowOf = (item) => MI.rows.find((r) => r.item === item);
test('매핑표 읽기: 시트 이름으로 두 묶음, 읽은 행·고유 품번·같은 줄 반복·빈 칸·충돌을 셈', () => {
  assert.deepEqual(Object.keys(MAP.groups).sort(), ['bobcat', 'doosan']);
  assert.deepEqual(MAP.groups.doosan.stats, { rows: 18, pairs: 17, blank: 0, dupSame: 1, conflicts: 0, same: 14, manyToOne: 0 });
  assert.deepEqual(MAP.groups.bobcat.stats, { rows: 8, pairs: 5, blank: 1, dupSame: 1, conflicts: 1, same: 3, manyToOne: 0 });
  assert.deepEqual(MAP.groups.bobcat.conflicts['SMP-B705'], ['CH-B705', 'CH-B705-A']);
  assert.equal(MAP.groups.bobcat.map['SMP-B705'], 'CH-B705'); // 충돌이면 위쪽 행 값
});
test('매핑표 CSV(시트 하나): 파일 이름으로 묶음, 넣은 묶음만 바뀌고 다른 묶음은 그대로 · 묶음을 모르면 알림', () => {
  const csv = { names: ['Sheet1'], sheets: { Sheet1: [['고객사', '천일품번'], ['smp-b701 ', 'CH-NEW']] } };
  const m2 = M.merge(MAP, M.parseBook(csv, '품번매핑_밥캣.csv'), '품번매핑_밥캣.csv');
  assert.equal(m2.groups.bobcat.map['SMP-B701'], 'CH-NEW'); // 소문자·공백 차이는 흡수
  assert.equal(m2.groups.doosan, MAP.groups.doosan);
  const bad = M.parseBook(csv, '매핑.csv');
  assert.equal(Object.keys(bad.groups).length, 0);
  assert.match(bad.problems[0], /건기·엔진인지 밥캣인지/);
  const byCol = M.parseBook({ names: ['s'], sheets: { s: [['구분', '고객사', '천일품번'], ['밥캣', 'Q1', 'C1'], ['건기', 'Q1', 'C2']] } }, 'x.csv');
  assert.equal(byCol.groups.bobcat.map.Q1, 'C1'); assert.equal(byCol.groups.doosan.map.Q1, 'C2'); // 묶음이 다르면 충돌 아님
});
test('매핑 적용: 천일품번 칸, 건기·엔진·AM·CKD 는 건기엔진 시트 · 밥캣은 밥캣 시트 · 발주서는 대상 아님', () => {
  assert.equal(rowOf('SMP-C103').company, 'SMP-C103-완제품');
  assert.equal(rowOf('SMP-E305').company, 'CH-E305');
  assert.equal(rowOf('SMP-K601').company, 'CH-K601'); // CKD
  assert.equal(rowOf('SMP-B704').company, 'CH-B704');
  assert.equal(rowOf('SMP-P801').mapStatus, 'none'); assert.equal(rowOf('SMP-P801').company, 'SMP-P801');
  assert.equal(MI.rows.length, RS.rows.length); assert.equal(RS.rows[0].company, undefined); // 원본 행은 그대로
});
test('매핑 없음: 품번마다 ★확인 필요 한 줄 + 개수, 기본은 고객사 품번 그대로 계산 · drop 이면 선적계획에서 뺌', () => {
  const miss = MI.checks.filter((c) => c.kind === 'unmapped');
  assert.deepEqual(miss.map((c) => c.item).sort(), ['SMP-A502', 'SMP-B706']);
  assert.equal(MI.stats.unmappedItems, 2);
  assert.equal(MI.stats.unmapped, MI.rows.filter((r) => r.mapStatus === 'unmapped').length);
  assert.equal(rowOf('SMP-A502').company, 'SMP-A502');
  assert.equal(M.planRows(MI.rows, { unmapped: 'keep' }).length, MI.rows.length);
  assert.equal(M.planRows(MI.rows, { unmapped: 'drop' }).length, MI.rows.length - MI.stats.unmapped);
  assert.equal(M.apply(RS.rows, null).checks.length, 0); // 매핑표가 없으면 알림 없이 그대로
});
test('매핑 충돌 경고: 같은 고객사 품번 → 서로 다른 천일품번이면 ★확인 필요 「매핑 충돌」(위쪽 값으로 계산)', () => {
  const c = MI.checks.filter((x) => x.kind === 'conflict');
  assert.equal(c.length, 1); assert.equal(c[0].item, 'SMP-B705');
  assert.match(c[0].detail, /CH-B705 \/ CH-B705-A/);
  assert.equal(rowOf('SMP-B705').mapStatus, 'conflict'); assert.equal(rowOf('SMP-B705').company, 'CH-B705');
});
test('재고 맞추기는 천일품번으로: C103 은 매핑 후에야 재고 「SMP-C103-완제품」 4 와 맞음', () => {
  const run = (rows) => {
    const aoa = I.ordersAoa(rows), m = L.guessMapping(aoa[0], 'orders');
    return L.compute({ orders: L.mapRows(aoa, 0, m, 'orders').rows, stock: RS.stock, shipments: RS.shipments }, { baseDate: RS.base });
  };
  const before = run(RS.rows), after = run(MI.rows);
  assert.equal(before.results.find((r) => r.item === 'SMP-C103').stock, 0);
  const c = after.results.find((r) => r.item === 'SMP-C103-완제품');
  assert.equal(c.stock, 4); assert.equal(c.orderSum, rowOf('SMP-C103').qty);
  assert.equal(I.ordersAoa(MI.rows)[0][8], '고객사 품목코드');
  assert.equal(I.exportSheets({ rows: MI.rows, files: RS.files, checks: MI.checks })['통합수주'][0][4], '천일품번');
});

console.log('ERP 업로드 양식 내보내기');
const TODAY = '2026-09-30';
test('내장 양식 = 수강생 양식 머리행 17열 순서 그대로, 시트 「웹자료올리기」 (단가 열 더하기를 끄면)', () => {
  const out = U.build(MI.rows, null, { priceCol: 'none' }, { today: TODAY, base: RS.base });
  assert.equal(out.sheet, '웹자료올리기');
  assert.deepEqual(out.aoa[0], ['일자', '순번', '추가문자형식1', '납품처 코드', '납품처명', '담당자', '납기일자', '품목코드(상단)', '작업지시No.', '품목코드', '품목명', 'BOM버전', '규격', '수량', '창고', '적요', '하위반제품수']);
  assert.deepEqual(U.readTemplate({ names: ['웹자료올리기'], sheets: { '웹자료올리기': [IS.TEMPLATE_HEAD] } }).headers, out.aoa[0]);
});
test('값(2026-09-30 확정): 일자 = 등록일자(오늘) 20260930, 순번 1…N, 품목코드(상단) = 품목코드, 매핑 없는 품번은 고객사 원품번 그대로', () => {
  const out = U.build(MI.rows, null, {}, { today: TODAY, base: RS.base });
  assert.equal(out.count, MI.rows.length); assert.equal(out.skipped.unmapped, 0);
  const H = out.aoa[0], col = (n) => H.indexOf(n), body = out.aoa.slice(1);
  assert.ok(body.every((r, i) => r[col('일자')] === '20260930' && r[col('순번')] === i + 1));
  assert.ok(body.every((r) => r[col('품목코드(상단)')] === r[col('품목코드')] && r[col('품목코드')] !== ''));
  const c103 = body.find((r) => r[col('품목코드')] === 'SMP-C103-완제품');
  const src = rowOf('SMP-C103');
  assert.equal(c103[col('수량')], src.qty); assert.equal(c103[col('납기일자')], src.due.replace(/-/g, ''));
  assert.ok(body.some((r) => r[col('품목코드')] === 'SMP-A502'));                  // 매핑 없음 → 고객사 원품번
  assert.equal(c103[col('납품처 코드')], ''); assert.equal(c103[col('작업지시No.')], ''); // 수기입력 전·채울 수 없는 열은 빈칸
  assert.equal(out.noParty, out.count);
  assert.equal(U.build(MI.rows, null, { unmapped: 'skip' }, { today: TODAY }).count, MI.rows.length - MI.stats.unmapped);
});
test('저장된 옛 설정: 판 1 → 두 번째 답변 확정값, 판 2 → 단가 열 없음·비우기 확정 열의 고정값 지움, 사용자가 바꾼 뒤 판 값은 유지', () => {
  const old = U.upgradeOptions({ dateFormat: 'dash', topItem: 'blank', unmapped: 'skip', seqMode: 'party', priceCol: 'add', parties: { a: { code: 'P1' } }, fixed: { '창고': 'W1', '없는열': 'Z' } });
  assert.deepEqual([old.v, old.dateMode, old.dateFormat, old.seqMode, old.topItem, old.unmapped, old.priceCol], [3, 'today', 'compact', 'row', 'same', 'keep', 'none']);
  assert.deepEqual([old.parties.a.code, old.fixed['창고'], old.fixed['없는열']], ['P1', undefined, 'Z']); // 창고는 「비움」 확정 열
  const v2 = U.upgradeOptions({ v: 2, dateFormat: 'dash', priceCol: 'add', fixed: { '적요': 'x', 'BOM버전': '1', '작업지시No.': 'W' }, itemParties: { K: { code: 'C1' } } });
  assert.deepEqual([v2.dateFormat, v2.priceCol, Object.keys(v2.fixed).length, v2.itemParties.K.code], ['dash', 'none', 0, 'C1']);
  const v3 = U.upgradeOptions({ v: 3, priceCol: 'add', fixed: { '창고': 'W2' } });     // 판 3 에서 사용자가 다시 켠 값은 그대로
  assert.deepEqual([v3.priceCol, v3.fixed['창고']], ['add', 'W2']);
  assert.deepEqual(U.upgradeOptions(null).itemParties, {});
  assert.equal(U.defaultOptions().priceCol, 'none');
});
test('세 번째 답변(2026-09-30): 기본 내보내기 = 기존 17열 그대로(단가 열 없음), 모르는 7열은 모두 빈칸, 17열 중 단가·금액 열은 없음', () => {
  const out = U.build(MI.rows, null, {}, { today: TODAY, base: RS.base });
  assert.equal(out.aoa[0].length, 17); assert.deepEqual(out.added, []); assert.equal(out.noPrice, 0);
  assert.deepEqual(out.aoa[0], U.DEFAULT_HEADERS);
  assert.deepEqual(U.DEFAULT_HEADERS.filter((x) => ['price', 'amount', 'sale', 'saleAmount'].includes(U.fieldOf(x))), []);
  assert.deepEqual(U.BLANK_COLS.slice().sort(), ['BOM버전', '규격', '작업지시No.', '적요', '창고', '추가문자형식1', '하위반제품수'].sort());
  assert.ok(U.BLANK_COLS.every((c) => out.blankCols.includes(c)));
  assert.deepEqual(out.unknown.slice().sort(), U.BLANK_COLS.slice().sort());                 // 자동으로 채우지 않는 열 = 비우기로 확정된 7열
  assert.ok(U.isBlankCol('작업지시 No') && !U.isBlankCol('품목코드'));
});
test('사용자 양식이면 그 열 순서를 따름 · 납품처표·고정값·일자(발주일)·순번(납품처별)·날짜 모양 설정', () => {
  const tpl = U.readTemplate({ names: ['기타', '웹자료올리기'], sheets: { '기타': [['x']], '웹자료올리기': [['안내문'], ['수량', '품목코드', '창고', '일자', '순번', '납품처 코드', '없는열']] } });
  assert.equal(tpl.sheet, '웹자료올리기'); assert.equal(tpl.headerRow, 1);
  const rows = MI.rows.filter((r) => r.group === '엔진' || r.group === '밥캣');
  const eng = rows.find((r) => r.group === '엔진'), key = U.partyKey(eng);
  const parties = {}; U.partyKeys(rows).forEach((k, i) => { parties[k] = { code: k === key ? 'D-01' : 'P' + i }; });
  assert.ok(U.partyKeys(rows).length >= 3);
  const out = U.build(rows, tpl, { dateMode: 'order', dateFormat: 'compact', seqMode: 'party', unmapped: 'keep', parties, fixed: { '창고': 'W1' }, priceCol: 'none' }, { today: TODAY });
  assert.deepEqual(out.aoa[0], ['수량', '품목코드', '창고', '일자', '순번', '납품처 코드', '없는열']);
  assert.deepEqual(out.unknown, ['창고', '없는열']);
  const body = out.aoa.slice(1);
  assert.ok(body.every((r) => r[2] === 'W1' && r[6] === '' && /^\d{8}$/.test(r[3])));
  const engRow = body.find((r) => r[5] === 'D-01');
  assert.equal(engRow[3], eng.orderDate.replace(/-/g, ''));
  // 같은 일자·납품처 → 같은 순번, 다르면 다른 순번
  const seqByKey = {};
  body.forEach((r, i) => { const k = r[3] + '|' + r[5]; (seqByKey[k] = seqByKey[k] || new Set()).add(r[4]); });
  assert.ok(Object.values(seqByKey).every((s) => s.size === 1));
  assert.equal(new Set(body.map((r) => r[4])).size, Object.keys(seqByKey).length); // 전표마다 다른 순번
});

test('품번별 납품처(수기입력·기억): 천일품번 → 고객사 품번 순으로 찾고, 칸이 비면 묶음 기본값 → 기본 담당자', () => {
  const pp = U.parseItemParties(IS.partiesBook());
  assert.deepEqual(pp.stats, { rows: 5, set: 5, blank: 0 });
  const ip = U.mergeItemParties(pp.map, { 'SMP-B705': { code: 'B-99' } });   // 매핑 전 고객사 품번으로 적은 값
  const a502 = rowOf('SMP-A502'), gk = U.partyKey(a502);
  const o = U.mergeOptions({ itemParties: ip, parties: { [gk]: { code: 'G-1', manager: '묶음담당' } }, manager: '기본담당' });
  assert.deepEqual(U.partyOf(rowOf('SMP-E305'), o), { code: 'D-200', name: '예시 납품처 군산', manager: '담당자B' });   // 천일품번 CH-E305
  assert.deepEqual(U.partyOf(rowOf('SMP-B705'), o), { code: 'B-99', name: '', manager: '기본담당' });                  // 고객사 품번으로 찾음
  assert.deepEqual(U.partyOf(a502, o), { code: 'D-300', name: '예시 납품처 안산', manager: '묶음담당' });              // 칸마다 따로 채움
  const out = U.build(MI.rows, null, o, { today: TODAY }), H = out.aoa[0], body = out.aoa.slice(1);
  const e305 = body.filter((r) => r[H.indexOf('품목코드')] === 'CH-E305');
  assert.ok(e305.length === 2 && e305.every((r) => r[H.indexOf('납품처 코드')] === 'D-200' && r[H.indexOf('담당자')] === '담당자B'));
  assert.equal(out.noParty, body.filter((r) => r[H.indexOf('납품처 코드')] === '').length);
});
test('품번별 납품처표 Excel 왕복: 내려받은 표를 다시 읽으면 같은 값 · 빈 칸은 기존 값을 지우지 않음 · 목록은 품목코드마다 한 줄', () => {
  const items = U.itemList(MI.rows);
  assert.equal(items.length, new Set(MI.rows.map((r) => r.company)).size);
  assert.equal(items.find((e) => e.code === 'CH-E305').rows, 2);
  const ip = U.parseItemParties(IS.partiesBook()).map;
  const aoa = U.itemPartiesAoa(items, Object.assign({}, ip, { 'OLD-1': { code: 'Z' } }));
  assert.deepEqual(aoa[0], U.PARTY_HEAD);
  assert.equal(aoa.length, items.length + 2);                                    // 이번 수주에 없는 기억 값도 함께
  const back = U.parseItemParties({ names: ['s'], sheets: { s: aoa } });
  assert.deepEqual(back.map, Object.assign({}, ip, { 'OLD-1': { code: 'Z' } }));
  const kept = U.mergeItemParties(ip, U.parseItemParties({ names: ['s'], sheets: { s: [['품목코드', '납품처 코드', '담당자'], ['CH-E305', '', '새담당']] } }).map);
  assert.deepEqual(kept['CH-E305'], { code: 'D-200', name: '예시 납품처 군산', manager: '새담당' });
  assert.match(U.parseItemParties({ names: ['s'], sheets: { s: [['품목코드', '수량'], ['a', 1]] } }).problems[0], /납품처/);
});
test('매핑 충돌 목록: 정확한 고객사 품번 · 천일품번 후보와 매핑표 행 번호 · 이번 수주 행 수', () => {
  const at = MAP.groups.bobcat.conflictAt['SMP-B705'];
  assert.deepEqual(at, [{ value: 'CH-B705', rows: [6], sheet: '밥캣품목코드' }, { value: 'CH-B705-A', rows: [9], sheet: '밥캣품목코드' }]);
  const cl = M.conflictList(MAP, RS.rows);
  assert.equal(cl.length, 1);
  assert.deepEqual([cl[0].item, cl[0].used, cl[0].chosen, cl[0].orders.rows], ['SMP-B705', 'CH-B705', '', 1]);
  assert.match(M.conflictAoa(cl)[1][2], /CH-B705 \(밥캣품목코드 6행\) \/ CH-B705-A \(밥캣품목코드 9행\)/);
});
test('매핑 충돌에서 값 고르기: 고른 값으로 계산(충돌 표시 없음) · 매핑표를 다시 넣어도 유지 · 후보가 아니면 버림', () => {
  const m2 = M.choose(MAP, 'bobcat', 'smp-b705', 'CH-B705-A');
  const r = M.apply(RS.rows, m2, {}), b = r.rows.find((x) => x.item === 'SMP-B705');
  assert.deepEqual([b.company, b.mapStatus, b.mapChosen, r.stats.resolved, r.stats.conflict], ['CH-B705-A', 'mapped', true, 1, 0]);
  assert.equal(r.checks.filter((c) => c.kind === 'conflict').length, 0);
  assert.equal(M.merge(m2, M.parseBook(IS.mappingBook(), 'x'), 'x').chosen['bobcat|SMP-B705'], 'CH-B705-A');
  const fixed = { names: ['밥캣품목코드'], sheets: { '밥캣품목코드': [['고객사', '천일품번'], ['SMP-B705', 'CH-B705']] } };
  assert.deepEqual(M.merge(m2, M.parseBook(fixed, 'y'), 'y').chosen, {});          // 충돌이 없어지면 고른 값도 버림
  assert.deepEqual(M.choose(MAP, 'bobcat', 'SMP-B705', 'NOT-A-CANDIDATE').chosen, {});
  assert.equal(M.choose(m2, 'bobcat', 'SMP-B705', '').chosen['bobcat|SMP-B705'], undefined);
});

console.log('판매단가(고객 발주, 참고)·매입단가(생산처 발주) — 기획서 11.11 · 11.12');
const P = require('../js/price.js');
const itemRows = (res, item, re) => res.rows.filter((r) => r.item === item && (!re || re.test(r.source)));
test('원본 단가 칸: 포털 발주단가 · AM · 밥캣(글자 「1,234,567」) · 발주서 A(글자)·B·C(가격단위로 나눔)·서식형 단가 · PDF 단가', () => {
  const p = (item, re) => itemRows(RS, item, re).map((r) => [r.price, r.priceSrc]);
  assert.deepEqual(p('SMP-C101'), [[12000, '원본']]);
  assert.deepEqual(p('SMP-A501'), [[2500, '원본']]);
  assert.deepEqual(p('SMP-B705'), [[1234567, '원본']]);
  assert.deepEqual(p('SMP-B706'), [[6400, '원본']]);      // 밥캣 직송
  assert.deepEqual(p('SMP-P801'), [[15000, '원본']]);      // 목록형 A — 단가가 글자
  assert.deepEqual(p('SMP-P811'), [[42000, '원본']]);      // 목록형 B
  assert.deepEqual(p('SMP-P822'), [[1500, '원본']]);       // 목록형 C 발주단가 150,000 ÷ 가격단위 100
  assert.deepEqual(p('SMP-P831'), [[2800, '원본']]);       // 서식형 D 단가 칸
  assert.deepEqual(p('SMP-PDF-0001'), [[1000, '원본']]);   // PDF 단가
  assert.deepEqual(p('SMP-D002'), [[2000, '원본']]);
});
test('단가 칸이 없는 양식: 군산건기(예정신고전)·서식형 날짜별·목록형 B 빈 단가 → 단가 없음(null)', () => {
  assert.ok(itemRows(RS, 'SMP-G201').every((r) => r.price === null && r.priceSrc === undefined));
  assert.ok(itemRows(RS, 'SMP-P841').every((r) => r.price === null));
  assert.equal(itemRows(RS, 'SMP-P812')[0].price, null);
});
test('누적결품 줄: 같은 고객사·같은 품번의 다른 파일 단가가 하나면 채움(원본(같은 품번)), 둘 이상이면 비움 · 끄면 비움', () => {
  assert.ok(itemRows(RS, 'SMP-E401', /누적결품/).every((r) => r.price === 5000 && r.priceSrc === '원본(같은 품번)'));
  assert.ok(itemRows(RS, 'SMP-B701', /누적결품/).every((r) => r.price === 11000));   // 밥캣 일반의 겹쳐 뺀 행 단가
  const e301 = itemRows(RS, 'SMP-E301', /누적결품/);
  assert.ok(e301.length === 3 && e301.every((r) => r.price === null && /2가지/.test(r.priceNote)));  // 8,000 과 8,200
  assert.equal(RS.priceInfo.multiItems, 1);
  const off = I.process(IS.asInput(), { borrowPrice: false }, NOW);
  assert.ok(itemRows(off, 'SMP-E401', /누적결품/).every((r) => r.price === null));
});
const PT = P.parseBook(IS.priceBook());
test('매입단가표 읽기: 품목코드 | 매입단가 | 생산처, 「판매단가」 열은 읽지 않음, 같은 품목 두 값은 위쪽 값 + 충돌', () => {
  assert.deepEqual(PT.stats, { rows: 18, pairs: 16, blank: 1, bad: 0, dupSame: 0, conflicts: 1, makers: 3 });
  assert.deepEqual([PT.map['SMP-C101'].price, PT.map['SMP-C101'].maker], [9000, '생산처A(가상)']);   // 판매단가 12,000 이 아님
  assert.deepEqual(PT.map['SMP-C105'], { price: 500, maker: '생산처A(가상)', row: 16, sheet: '매입단가표' });
  assert.deepEqual(PT.conflicts['SMP-C105'].map((x) => [x.price, x.row]), [[500, 16], [520, 17]]);
  const both = P.parseBook({ names: ['s'], sheets: { s: [['품번', '단가', '매입단가'], ['q1', 100, 70]] } });
  assert.equal(both.map.Q1.price, 70);                                              // 「매입단가」가 「단가」보다 우선
  assert.match(P.parseBook({ names: ['s'], sheets: { s: [['품목코드', '판매단가'], ['a', 1]] } }).problems[0], /판매단가.*매입단가/);
  assert.match(P.parseBook({ names: ['s'], sheets: { s: [['품번', '수량'], ['a', 1]] } }).problems[0], /매입단가/);
});
test('매입단가 붙이기: 매입단가표(천일품번 → 고객사 품번) → 직접입력, 판매단가(고객 발주)는 원본 그대로, 매입금액 = 수량 × 매입단가', () => {
  const man = {}; man[P.buyKey(rowOf('SMP-G202'))] = '3,300'; man['SMP-C101'] = 1;   // C101 은 단가표에 있어 직접입력을 쓰지 않음
  const R = P.apply(MI.rows, PT, man), get = (item) => R.rows.filter((r) => r.item === item);
  const k = get('SMP-K601')[0];
  assert.deepEqual([k.price, k.buyPrice, k.buySrc, k.maker, k.buyAmount, k.saleAmount], [1200, 800, '단가표', '생산처B(가상)', 400000, 600000]);
  assert.ok(get('SMP-E305').every((r) => r.buyPrice === 15000 && r.price === null));      // 천일품번 CH-E305 로 찾음, 판매단가 없음
  assert.equal(get('SMP-A502')[0].buyPrice, 1800);                                        // 매핑 없음 → 고객사 원품번으로 찾음
  assert.equal(get('SMP-C103')[0].buyPrice, 21000);                                       // 천일품번 SMP-C103-완제품
  assert.deepEqual([get('SMP-G202')[0].buyPrice, get('SMP-G202')[0].buySrc], [3300, '직접입력']);
  assert.deepEqual([get('SMP-C101')[0].buyPrice, get('SMP-C101')[0].price], [9000, 12000]); // 단가표가 직접입력보다 우선, 판매단가는 그대로
  assert.equal(get('SMP-D002')[0].maker, '');
  assert.equal(get('SMP-B705')[0].buyPrice, null);
  assert.deepEqual([R.stats.buyHas, R.stats.buyNone, R.stats.buyNoneItems, R.stats.buyBySrc['단가표'], R.stats.buyBySrc['직접입력']], [24, 16, 16, 23, 1]);
  assert.deepEqual([R.stats.manualCount, R.stats.manualShadowed], [2, 1]);
  assert.equal(R.stats.saleHas + R.stats.saleNone, MI.rows.length);
  assert.equal(R.stats.saleNone, RS.rows.filter((r) => r.price == null).length);
  assert.equal(R.stats.buyAmount, R.rows.reduce((s, r) => s + (r.buyAmount || 0), 0));
  assert.equal(R.missing.length, 16); assert.ok(R.missing.every((m) => m.rows >= 1 && m.item));
  const none = P.apply(MI.rows, null, {});
  assert.equal(none.stats.buyNone, MI.rows.length);
  assert.equal(none.stats.bySource['2026.09.29_납품예정 군산건기(예정신고전).xlsx'].saleNone, 4);
  assert.equal(P.sourceDisagreements(RS.rows), 0);
});
test('판매 − 매입: 둘 다 있는 줄만 · 매입이 더 비싸면 음수로 셈', () => {
  const R = P.apply(MI.rows, PT, {}), get = (item) => R.rows.find((r) => r.item === item);
  assert.deepEqual([get('SMP-K601').margin, get('SMP-K601').marginAmount], [400, 200000]);
  assert.equal(get('SMP-P801').margin, -1000);
  assert.equal(get('SMP-G201').margin, null);                                             // 판매단가 없음
  assert.deepEqual([R.stats.both, R.stats.negative, R.stats.negativeItems], [12, 1, 1]);
  assert.equal(R.stats.marginAmount, R.rows.reduce((s, r) => s + (r.marginAmount || 0), 0));
  assert.deepEqual(P.templateAoa(R.missing)[0], ['품목코드', '품목명', '생산처', '매입단가']);
  const back = P.parseBook({ names: ['t'], sheets: { t: P.templateAoa(R.missing).map((r, i) => (i ? [r[0], r[1], '생산처Z', 100] : r)) } });
  assert.equal(P.apply(MI.rows, back, {}).stats.buyHas, R.stats.buyNone);                  // 채운 양식을 다시 넣으면 빈 품목이 모두 찾아짐
});
test('내보내기: 통합수주에 판매단가(고객 발주)·매입단가(생산처 발주)·생산처·출처, 판매−매입은 켤 때만, 수주현황 끝에 두 단가', () => {
  const R = P.apply(MI.rows, PT, {});
  const sh = I.exportSheets({ rows: R.rows, files: RS.files, checks: [] });
  const H = sh['통합수주'][0];
  assert.deepEqual(H.slice(7, 15), ['수량', '판매단가(고객 발주)', '판매금액', '판매단가 출처', '매입단가(생산처 발주)', '매입금액', '생산처', '매입단가 출처']);
  assert.equal(H.indexOf('판매−매입(단가)'), -1);
  const k601 = sh['통합수주'].find((r) => r[3] === 'SMP-K601');
  assert.deepEqual(k601.slice(7, 15), [500, 1200, 600000, '원본', 800, 400000, '생산처B(가상)', '단가표']);
  const b = sh['통합수주'].find((r) => r[3] === 'SMP-B703');
  assert.equal(b[H.indexOf('매입단가 출처')], '매입단가 없음');
  const m = I.exportSheets({ rows: R.rows, files: RS.files, checks: [] }, { margin: true })['통합수주'];
  assert.deepEqual(m[0].slice(15, 17), ['판매−매입(단가)', '판매−매입(금액)']);
  assert.deepEqual(m.find((r) => r[3] === 'SMP-K601').slice(15, 17), [400, 200000]);
  assert.equal(m[0].length, m[1].length);
  const FH = sh['파일별집계'][0], am = sh['파일별집계'].find((r) => /안산AM/.test(r[0]));
  assert.deepEqual([am[FH.indexOf('판매단가 있음')], am[FH.indexOf('판매단가 없음')]], [2, 0]);
  const O = I.ordersAoa(R.rows);
  assert.deepEqual(O[0].slice(-4), ['판매단가(고객 발주)', '판매금액', '매입단가(생산처 발주)', '매입금액']);
  assert.deepEqual(L.guessMapping(O[0], 'orders'), L.guessMapping(I.ordersAoa(MI.rows)[0].slice(0, 12), 'orders')); // 단가 열이 자동 매핑을 흔들지 않음
});
test('업로드 양식의 단가 = 매입단가: 단가 열이 없으면 「수량」 뒤에 「단가」, 양식에 매입단가·금액·판매단가·생산처 열이 있으면 그 열에', () => {
  const R = P.apply(MI.rows, PT, {});
  const out = U.build(R.rows, null, { priceCol: 'add' }, { today: TODAY });   // 선택으로 남겨 둔 「단가 열 더하기」
  const H = out.aoa[0];
  assert.equal(H.length, 18); assert.equal(H[H.indexOf('수량') + 1], '단가'); assert.deepEqual(out.added, ['단가']);
  const body = out.aoa.slice(1), k = body.find((r) => r[H.indexOf('품목코드')] === 'CH-K601');
  assert.equal(k[H.indexOf('단가')], 800);                                                // 판매단가 1,200 이 아님
  assert.equal(body.filter((r) => r[H.indexOf('단가')] === '').length, R.stats.buyNone); assert.equal(out.noPrice, R.stats.buyNone);
  const own = U.build(R.rows, { sheet: 's', headers: ['품목코드', '수량', '매입단가', '금액', '판매단가', '생산처'] }, {}, { today: TODAY });
  assert.deepEqual(own.added, []);
  assert.deepEqual(own.aoa.find((r) => r[0] === 'CH-K601'), ['CH-K601', 500, 800, 400000, 1200, '생산처B(가상)']);
  assert.deepEqual(U.build(R.rows, { sheet: 's', headers: ['품목코드', '발주단가'] }, {}, { today: TODAY }).aoa.find((r) => r[0] === 'CH-K601'), ['CH-K601', 800]); // 발주단가 = 당사 → 생산처
  assert.deepEqual(U.build(R.rows, { sheet: 's', headers: ['품목코드', '규격'] }, { priceCol: 'add' }, { today: TODAY }).aoa[0], ['품목코드', '규격', '단가']); // 수량 열이 없으면 맨 끝
  assert.deepEqual(U.build(R.rows, { sheet: 's', headers: ['품목코드', '규격'] }, {}, { today: TODAY }).aoa[0], ['품목코드', '규격']);          // 기본은 더하지 않음
});

console.log('매입단가표는 천일품번 기준 · 월별 수주 vs 매입 — 기획서 11.13');
test('매입단가표는 천일품번으로만 찾음: 매핑된 행은 고객사 품번이 표에 있어도 쓰지 않고, 매핑 없는 행은 원품번으로 찾음', () => {
  const t = { map: { X1: { price: 5, maker: '' }, 'CH-Y1': { price: 7, maker: '' }, Z1: { price: 9, maker: '' } } };
  const rows = [{ item: 'X1', customerItem: 'X1', company: 'CH-X1', mapStatus: 'mapped', qty: 2 },
    { item: 'Y1', customerItem: 'Y1', company: 'CH-Y1', mapStatus: 'mapped', qty: 2 },
    { item: 'Z1', company: 'Z1', mapStatus: 'unmapped', qty: 2 }];
  assert.deepEqual(P.apply(rows, t, {}).rows.map((r) => r.buyPrice), [null, 7, 9]);
});
const MO = require('../js/monthly.js');
// 손으로 계산한 작은 표: 10월 3줄(둘 다 · 매입 없음 · 판매 없음), 11월 1줄, 납기 없는 줄 1
const MR = [
  { customer: '가', group: '엔진', company: 'A', item: 'a', qty: 10, price: 100, buyPrice: 70, due: '2026-10-05', orderDate: '2026-09-20', name: '품A' },
  { customer: '가', group: '엔진', company: 'B', item: 'b', qty: 5, price: 200, buyPrice: null, due: '2026-10-20', orderDate: '2026-09-25' },
  { customer: '나', group: '밥캣', company: 'A', item: 'a2', qty: 4, price: null, buyPrice: 70, due: '2026-10-31', orderDate: '2026-10-01' },
  { customer: '나', group: '밥캣', company: 'C', item: 'c', qty: 2, price: 50, buyPrice: 60, due: '2026-11-02', orderDate: '' },
  { customer: '가', group: '엔진', company: 'A', item: 'a', qty: 1, price: 100, buyPrice: 70, due: '', orderDate: '2026-10-02' }
];
test('월별 집계(납기월): 수주금액 = 수량 × 판매단가, 매입금액 = 수량 × 매입단가, 쪽마다 단가 없음 행 수, 차액·차익률은 둘 다 있는 줄만', () => {
  const S = MO.summarize(MR);
  assert.deepEqual(S.months.map((m) => m.label), ['2026-10', '2026-11', '(납기일 없음)']);
  const o = S.months[0];
  assert.deepEqual([o.rows, o.qty, o.sale, o.saleNone, o.buy, o.buyNone, o.bothRows, o.diff, o.rate], [3, 19, 2000, 1, 980, 1, 1, 300, 30]);
  const n = S.months[1];
  assert.deepEqual([n.sale, n.buy, n.diff, n.rate], [100, 120, -20, -20]);                    // 매입이 비싸면 음수
  const T = S.total;
  assert.deepEqual([T.rows, T.sale, T.buy, T.saleNone, T.buyNone, T.bothRows, T.bothSale, T.bothBuy, T.diff, T.rate], [5, 2200, 1170, 1, 1, 3, 1200, 890, 310, 25.8]);
  assert.equal(S.months.reduce((s, m) => s + m.sale, 0), T.sale);
  assert.equal(MO.summarize([{ qty: 1, price: 10, buyPrice: null, due: '2026-10-01' }]).total.diff, null); // 비교할 줄이 없으면 비움
});
test('월별 집계(발주월 선택) · 고객사·구분별 · 품목별 상위 N + 나머지 한 줄', () => {
  const S = MO.summarize(MR, { by: 'order', topN: 1 });
  assert.equal(S.byLabel, '발주월');
  assert.deepEqual(S.months.map((m) => [m.label, m.rows]), [['2026-09', 2], ['2026-10', 2], ['(발주일 없음)', 1]]);
  assert.deepEqual(S.total.groups.map((g) => [g.customer, g.group, g.sale, g.buy]), [['가', '엔진', 2100, 770], ['나', '밥캣', 100, 400]]);
  const it = S.total.items;
  assert.equal(S.total.itemCount, 3);
  assert.deepEqual([it[0].item, it[0].qty, it[0].sale, it[0].buy, it[0].name], ['A', 15, 1100, 1050, '품A']);   // 천일품번 A 로 묶음(고객사 품번 a · a2)
  assert.deepEqual([it[1].item, it[1].rest, it[1].sale, it[1].buy], ['그 밖 2품목', 2, 1100, 120]);
  assert.equal(MO.options({ topN: 'x' }).topN, MO.DEFAULT_TOP);
});
test('Excel 시트 「월별 수주 vs 매입」: 월별 표 + 합계 + 고객사·구분별 + 품목별, 예시 데이터로 합계가 매입단가 붙이기 결과와 같음', () => {
  const A = MO.aoa(MO.summarize(MR));
  assert.equal(MO.SHEET, '월별 수주 vs 매입');
  const hi = A.findIndex((r) => r[0] === '납기월' && r[1] === '행 수');
  assert.deepEqual(A[hi + 1].slice(0, 11), ['2026-10', 3, 19, 2000, 1, 980, 1, 49, 1, 300, 30]);
  assert.deepEqual(A.slice(hi).find((r) => r[0] === '합계').slice(3, 6), [2200, 1, 1170]);
  assert.ok(A.some((r) => r[0] === '고객사 · 구분별') && A.some((r) => /^품목별/.test(r[0])));
  const R = P.apply(MI.rows, PT, {}), S = MO.summarize(R.rows);
  assert.equal(S.total.buy, R.stats.buyAmount); assert.equal(S.total.sale, R.stats.saleAmount);
  assert.deepEqual([S.total.buyNone, S.total.saleNone], [R.stats.buyNone, R.stats.saleNone]);
  assert.equal(S.total.diff, R.stats.marginAmount);                                             // 차액 = 판매 − 매입 합계(둘 다 있는 줄)
  assert.equal(S.total.rows, MI.rows.length);
});


console.log('네 번째 답변(2026-09-30) — 가장 위쪽 매입단가 · 총금액 비교(비중) · 납기월 확정 — 기획서 11.14');
// 손으로 만든 매입단가표: X 는 세 생산처(100·90·80) → 가장 위쪽 100, Y 는 하나
const PT4 = P.parseBook({ names: ['s'], sheets: { s: [['품목코드', '생산처', '매입단가'], ['X', '가', 100], ['X', '나', 90], ['Y', '가', 50], ['X', '다', 80]] } });
test('단가가 여럿인 품번은 가장 위쪽 행 단가 · 행에 buyMulti 표시 · 목록(쓴 값·다른 값·이번 수주 행 수)', () => {
  assert.deepEqual(PT4.map.X, { price: 100, maker: '가', row: 2, sheet: 's' });
  const R = P.apply([{ item: 'X', company: 'X', qty: 3, price: 120 }, { item: 'Y', company: 'Y', qty: 2, price: null }, { item: 'X', company: 'X', qty: 1, price: 120 }], PT4, {});
  assert.deepEqual(R.rows.map((r) => [r.buyPrice, r.maker, r.buyMulti, r.buyAmount]), [[100, '가', true, 300], [50, '가', false, 100], [100, '가', true, 100]]);
  assert.deepEqual([R.stats.buyMultiRows, R.stats.buyMultiItems], [2, 1]);
  assert.deepEqual(P.multiList(PT4, R.rows), [{ key: 'X', price: 100, maker: '가', row: 2, rows: 2, others: '90 · 나 · 3행 / 80 · 다 · 5행' }]);
  assert.deepEqual(P.multiList(PT4, [{ item: 'Y', company: 'Y', buyMulti: false }]), []);            // 이번 수주에 없으면 목록에서 뺌
  const S = P.apply(MI.rows, PT, {}), c105 = S.rows.filter((r) => r.company === 'SMP-C105');     // 예시: C105 500(생산처A) / 520(생산처B)
  assert.ok(c105.length === 1 && c105[0].buyPrice === 500 && c105[0].buyMulti && c105[0].maker === '생산처A(가상)');
  assert.deepEqual(P.multiList(PT, S.rows).map((x) => [x.key, x.price, x.others, x.rows]), [['SMP-C105', 500, '520 · 생산처B(가상) · 17행', 1]]);
});
test('총금액 비교: 비중 = 발주(매입)금액 합계 ÷ 수주금액 합계 × 100, 단가가 한쪽만 있는 줄도 그쪽 합계에 넣음', () => {
  const S = MO.summarize(MR);
  // 10월: 수주 10×100 + 5×200 = 2,000 · 발주 10×70 + 4×70 = 980 → 49.0% / 11월: 100 · 120 → 120.0% / 납기 없음: 100 · 70 → 70.0%
  assert.deepEqual(S.months.map((m) => [m.label, m.sale, m.buy, m.share]), [['2026-10', 2000, 980, 49], ['2026-11', 100, 120, 120], ['(납기일 없음)', 100, 70, 70]]);
  assert.equal(S.total.share, 53.2);                                                          // 1,170 ÷ 2,200 = 53.18…%
  assert.equal(MO.sentence(S.months[0]), '2026-10 수주금액 2,000원 · 발주금액 980원 · 수주금액 대비 발주금액 49.0% (수주단가 없음 1행 · 매입단가 없음 1행)');
  assert.equal(MO.sentence(S.months[1]), '2026-11 수주금액 100원 · 발주금액 120원 · 수주금액 대비 발주금액 120.0%');
  assert.equal(MO.summarize([{ qty: 3, price: null, buyPrice: 10, due: '2026-10-01' }]).total.share, null); // 수주금액 0 이면 비중 비움
  assert.equal(S.total.rate, 25.8);                                                           // 차액·차익률(둘 다 있는 줄)은 그대로 보조 정보
});
test('납기월 확정: 기본·확정 기준은 납기월 · Excel 첫 덩어리 = 월별 총금액 비교(비중) · 단가 여럿 품목 목록', () => {
  assert.equal(MO.options({}).by, 'due'); assert.equal(MO.BY_FIXED, 'due');
  const A = MO.aoa(MO.summarize(MR), P.multiList(PT4, P.apply([{ item: 'X', company: 'X', qty: 1 }], PT4, {}).rows));
  assert.match(A[0][0], /납기월\(확정\)/);
  assert.match(MO.aoa(MO.summarize(MR, { by: 'order' }))[0][0], /발주월\(참고\)/);
  const hi = A.findIndex((r) => r[0] === '납기월' && r[1] === '수주금액');
  assert.ok(hi > 0 && hi < A.findIndex((r) => r[0] === '납기월' && r[1] === '행 수'));        // 총금액 비교가 상세보다 위
  assert.deepEqual(A[hi].slice(1, 4), ['수주금액', '발주금액(매입)', '비중(발주÷수주, %)']);
  assert.deepEqual(A.slice(hi + 1, hi + 5), [['2026-10', 2000, 980, 49, 1, 1, 3], ['2026-11', 100, 120, 120, 0, 0, 1], ['(납기일 없음)', 100, 70, 70, 0, 0, 1], ['합계', 2200, 1170, 53.2, 1, 1, 5]]);
  const mi = A.findIndex((r) => /단가가 둘 이상/.test(r[0] || ''));
  assert.deepEqual(A[mi + 2], ['X', 100, '가', 2, '90 · 나 · 3행 / 80 · 다 · 5행', 1]);
  assert.equal(MO.aoa(MO.summarize(MR)).findIndex((r) => /단가가 둘 이상/.test(r[0] || '')), -1);   // 없으면 덩어리도 없음
});

console.log('환율 — China(RMB) 등 외화 단가를 원화로(서울외국환중개 월평균, 납기월의 전월) — 기획서 11.15');
const FX = require('../js/fx.js');
const { parseTable } = await import('../scripts/fetch-rates.mjs');
test('통화 읽기: China(RMB)·RMB·CNY·CNH·위안 = CNY, 엔화 표기, 원화·빈칸, 모르는 통화는 null', () => {
  assert.deepEqual(['China(RMB)', 'RMB', 'cny', '위안 (CNH)', '중국 위안화', '人民币'].map(FX.normCurrency), ['CNY', 'CNY', 'CNY', 'CNY', 'CNY', 'CNY']);
  assert.deepEqual(['일본 엔 (JPY) (100)', 'USD', '미국 달러', '유로 (EUR)', 'KRW', '원', ''].map(FX.normCurrency), ['JPY', 'USD', 'USD', 'EUR', 'KRW', 'KRW', '']);
  assert.deepEqual(['홍콩 달러 (HKD)', '¥', 'CHF'].map(FX.normCurrency), [null, null, null]);   // ¥ 는 엔·위안 둘 다라 짐작하지 않음
});
test('환율 월: 납기월의 전월(기본)·당월, 1월 납기는 전년 12월, 납기일 없으면 빈칸', () => {
  assert.equal(FX.rateMonth('2026-10-15'), '2026-09');
  assert.equal(FX.rateMonth('2027-01-05', 'prev'), '2026-12');
  assert.equal(FX.rateMonth('2026-10-15', 'same'), '2026-10');
  assert.equal(FX.rateMonth(null), '');
  assert.deepEqual(['2026.08', 2026.08, 2026.1, '2026년 8월', 202608, '2026-08-01', new Date(2026, 7, 3), '8월'].map(FX.parseMonth), ['2026-08', '2026-08', '2026-10', '2026-08', '2026-08', '2026-08', '2026-08', '']);
});
test('원화 단가 = 외화 × 환율, 소수 둘째 자리 반올림(0.005 올림): 12.5 위안 × 190.35 = 2,379.375 → 2,379.38', () => {
  const R = FX.resolver({ file: { rates: { 'CNY|2026-09': { raw: 190.35, unit: 1, rate: 190.35 } } } });
  const c = FX.convert(12.5, 'CNY', '2026-10-15', R, 'prev');
  assert.deepEqual([c.krw, c.raw, c.month, c.src], [2379.38, 190.35, '2026-09', '기준파일']);
  assert.equal(FX.round2(1.005), 1.01); assert.equal(FX.round2(2.675), 2.68); assert.equal(FX.round2(8856.3), 8856.3);   // 이진 소수 오차(1.00499…)를 걷어냄
  const J = FX.resolver({ auto: { rates: FX.fromAuto({ currencies: { JPY: { unit: 100, months: { '2026-08': 885.63 } } } }) } });
  assert.equal(FX.convert(1000, 'JPY', '2026-09-30', J).krw, 8856.3);                 // 1,000엔 × 885.63 ÷ 100
  assert.deepEqual(FX.convert(12.5, 'CNY', '2026-12-01', R), { missing: true, reason: 'CNY 2026-11 환율 없음', cur: 'CNY', month: '2026-11', orig: 12.5 });
  assert.match(FX.convert(12.5, 'CNY', null, R).reason, /납기일 없음/);
  assert.match(FX.convert(12.5, null, '2026-10-01', R).reason, /통화를 알 수 없음/);
});
test('환율 기준 파일 — 서울외국환중개 화면 복사 모양(날짜 | 통화명 | 월평균 매매기준율): 엔화 (100), 숫자로 바뀐 2026.1(=10월)', () => {
  const p = FX.parseRateBook({ names: ['Sheet1'], sheets: { Sheet1: [['월평균 매매기준율'], ['날짜', '통화명', '월평균 매매기준율'],
    ['2026.08', '위안 (CNH)', '208.69'], [2026.07, '위안 (CNH)', 220.94], [2025.1, '위안 (CNH)', 199.82], ['2026.08', '일본 엔 (JPY) (100)', '885.63'], ['2026.08', '홍콩 달러 (HKD)', '180.00'], ['', '', '']] } });
  assert.equal(p.layout, 'long');
  assert.deepEqual([p.stats.pairs, p.stats.bad, p.stats.currencies, p.stats.first, p.stats.last], [4, 1, ['CNY', 'JPY'], '2025-10', '2026-08']);
  assert.deepEqual([p.rates['CNY|2026-08'].raw, p.rates['CNY|2025-10'].raw, p.rates['JPY|2026-08'].unit, p.rates['JPY|2026-08'].rate], [208.69, 199.82, 100, 8.8563]);
});
test('환율 기준 파일 — 회사 양식(연월 | 통화 | 환율(원) | 단위 | 비고) · 가로(연월 | CNY | JPY(100)) · 같은 달 두 값은 위쪽 · 예시 시트는 다른 값이 없을 때만', () => {
  const co = FX.parseRateBook({ names: ['환율기준', '예시', '안내'], sheets: {
    '환율기준': [['연월', '통화', '환율(원)', '단위', '비고(출처)'], ['2026-09', 'China(RMB)', 205.1, '', '회사 기준'], ['2026-09', 'RMB', 206, '', '두 번째 — 무시'], ['2026-09', 'JPY', 9.1, 1, '1엔당'], ['2026-13', 'USD', 1400, '', '없는 달']],
    '예시': [['연월', '통화', '환율(원)'], ['2026-08', 'CNY', 208.69]], '안내': [['설명']] } });
  assert.deepEqual([co.stats.pairs, co.stats.bad, co.stats.conflicts, co.rates['CNY|2026-09'].raw, co.rates['CNY|2026-09'].note], [2, 1, 1, 205.1, '회사 기준']);
  assert.deepEqual([co.rates['JPY|2026-09'].unit, co.rates['JPY|2026-09'].rate], [1, 9.1]);
  assert.equal(co.rates['CNY|2026-08'], undefined);                                      // 「예시」 시트는 읽지 않음
  assert.match(co.problems[0], /CNY 2026-09 .*205\.1/);
  const ex = FX.parseRateBook({ names: ['환율기준', '예시'], sheets: { '환율기준': [['연월', '통화', '환율(원)']], '예시': [['연월', '통화', '환율(원)'], ['2026-08', 'CNY', 208.69]] } });
  assert.equal(ex.rates['CNY|2026-08'].raw, 208.69); assert.ok(ex.problems.some((x) => /예시/.test(x)));
  const wide = FX.parseRateBook({ names: ['s'], sheets: { s: [['기준월', 'China(RMB)', 'USD', 'JPY(100)'], ['2026-08', 208.69, '1,406.30', 885.63], ['2026-09', '', 1390, '']] } });
  assert.equal(wide.layout, 'wide');
  assert.deepEqual([wide.stats.pairs, wide.rates['USD|2026-08'].raw, wide.rates['JPY|2026-08'].unit, wide.rates['USD|2026-09'].raw], [4, 1406.3, 100, 1390]);
  const pasted = FX.parseRateBook(FX.textBook('날짜\t통화명\t월평균 매매기준율\n2026.08\t위안 (CNH)\t208.69\n'));
  assert.equal(pasted.rates['CNY|2026-08'].raw, 208.69);
  const one = FX.parseRateBook({ names: ['CNY 환율'], sheets: { 'CNY 환율': [['연월', '환율'], ['2026-09', 205]] } });   // 통화 칸이 없으면 시트 이름으로
  assert.equal(one.rates['CNY|2026-09'].raw, 205);
  assert.match(FX.parseRateBook({ names: ['s'], sheets: { s: [['품번', '수량']] } }).problems[0], /연월/);
});
test('찾는 순서: 직접입력 > 기준파일 > 자동, 없으면 null · 적용 환율 시트', () => {
  const R = FX.resolver({ manual: { 'CNY|2026-09': 200, 'XXX|2026-09': 1 }, file: { file: 'f.xlsx', rates: { 'CNY|2026-09': { raw: 205.1, unit: 1 }, 'CNY|2026-08': { raw: 208, unit: 1 } } },
    auto: { rates: FX.fromAuto({ currencies: { CNY: { unit: 1, months: { '2026-08': 208.69, '2026-07': 220.94 } } } }) } });
  assert.deepEqual(['2026-09', '2026-08', '2026-07', '2026-06'].map((m) => { const e = R.find('CNY', m); return e && [e.raw, e.src]; }),
    [[200, '직접입력'], [208, '기준파일'], [220.94, '자동(서울외국환중개)'], null]);
  const A = FX.ratesAoa(R, { 'CNY|2026-09': 3 }, [{ cur: 'CNY', month: '2026-11', reason: 'CNY 2026-11 환율 없음', rows: 2 }], { file: 'f.xlsx' });
  const hi = A.findIndex((r) => r[0] === '통화');
  assert.deepEqual(A[hi + 1], ['CNY', '2026-09', 200, 1, '직접입력', 200, 205.1, '', 3]);
  assert.deepEqual(A[A.length - 1], ['CNY', '2026-11', 'CNY 2026-11 환율 없음', 2]);
});
test('매입단가표의 통화: 「통화」 칸 · 「12.5 RMB」 값 · 「매입단가(RMB)」 머리, 모르는 통화 행은 건너뜀', () => {
  const t = P.parseBook({ names: ['s'], sheets: { s: [['품목코드', '매입단가', '통화'], ['A', 12.5, 'China(RMB)'], ['B', '3.5 RMB', ''], ['C', 1000, 'KRW'], ['D', 7, 'HKD'], ['E', 900, '']] } });
  assert.deepEqual([t.map.A.cur, t.map.B.cur, t.map.B.price, t.map.C.cur, t.map.D, t.map.E.cur], ['CNY', 'CNY', 3.5, undefined, undefined, undefined]);
  assert.equal(t.stats.badCur, 1);
  const h = P.parseBook({ names: ['s'], sheets: { s: [['품번', '매입단가(RMB)'], ['A', 12.5]] } });
  assert.equal(h.map.A.cur, 'CNY');
});
// 손으로 계산한 수주 4줄: 기준파일 CNY 2026-09 = 190.35, 자동 USD 2026-08 = 1,406.30
const FXR = FX.resolver({ file: { rates: { 'CNY|2026-09': { raw: 190.35, unit: 1 } } }, auto: { rates: FX.fromAuto({ currencies: { USD: { unit: 1, months: { '2026-08': 1406.3 } } } }) } });
const FXT = P.parseBook({ names: ['s'], sheets: { s: [['품목코드', '매입단가', '통화'], ['P1', 12.5, 'China(RMB)'], ['P2', 1000, '원'], ['P3', 40, '']] } });
const FXROWS = [
  { item: 'P1', company: 'P1', qty: 100, due: '2026-10-15', price: 3000, currency: 'KRW' },   // 매입 12.5 위안 × 190.35 = 2,379.38 → 237,938
  { item: 'P1', company: 'P1', qty: 10, due: '2026-12-03', price: 3000 },                      // 2026-11 환율 없음 → 매입금액에서 뺌
  { item: 'P2', company: 'P2', qty: 5, due: '2026-09-10', price: 2, currency: 'USD' },          // 매입 원화 1,000 · 판매 2 달러 × 1,406.30(2026-08 자동) = 2,812.60
  { item: 'P3', company: 'P3', qty: 2, due: null, price: null }];                               // 통화 빈칸 → 기본 통화
test('매입·판매 단가 환산: 외화만 원화로, 환율 없음은 금액에서 빼고 따로 셈(매입단가 없음과 섞지 않음)', () => {
  const R = P.apply(FXROWS, FXT, {}, { fx: { resolver: FXR, mode: 'prev' } });
  const [a, b, c, d] = R.rows;
  assert.deepEqual([a.buyPrice, a.buyAmount, a.buyPriceOrig, a.buyCur, a.buyFx.month, a.buyFx.src], [2379.38, 237938, 12.5, 'CNY', '2026-09', '기준파일']);
  assert.deepEqual([b.buyPrice, b.buyAmount, b.buyFxMissing.reason, b.buySrc], [null, null, 'CNY 2026-11 환율 없음', '단가표']);
  assert.deepEqual([c.buyPrice, c.buyCur, c.price, c.priceOrig, c.priceCur, c.saleAmount], [1000, undefined, 2812.6, 2, 'USD', 14063]);
  assert.deepEqual([d.buyPrice, d.buyCur], [40, undefined]);                                   // 기본 통화 원화
  assert.deepEqual([R.stats.buyFx, R.stats.buyFxNone, R.stats.buyNone, R.stats.saleFx, R.stats.saleFxNone, R.stats.buyHas], [1, 1, 0, 1, 0, 3]);
  assert.equal(R.missing.length, 0);                                                          // 환율 없음은 「매입단가 없음」 목록에 넣지 않음
  assert.deepEqual(R.fxMissing, [{ cur: 'CNY', month: '2026-11', reason: 'CNY 2026-11 환율 없음', rows: 1 }]);
  assert.deepEqual(R.fxUsed, { 'CNY|2026-09': 1, 'USD|2026-08': 1 });
  const cny = P.apply(FXROWS, FXT, {}, { defaultCur: 'CNY', fx: { resolver: FXR } });             // 통화 칸 빈 P3 를 위안으로 → 납기일 없음 = 환율 없음
  assert.match(cny.rows[3].buyFxMissing.reason, /납기일 없음/);
  const man = P.apply([{ item: 'Q', company: 'Q', qty: 3, due: '2026-10-02' }], null, { Q: 10 }, { manualCur: { Q: 'CNY' }, fx: { resolver: FXR } });
  assert.deepEqual([man.rows[0].buyPrice, man.rows[0].buySrc, man.rows[0].buyAmount], [1903.5, '직접입력', 5710.5]);   // 10 × 190.35
  const same = P.apply(FXROWS.slice(0, 1), FXT, {}, { fx: { resolver: FXR, mode: 'same' } });  // 당월: 2026-10 값 없음
  assert.equal(same.rows[0].buyFxMissing.month, '2026-10');
  assert.equal(P.apply(FXROWS, FXT, {}).rows[0].buyFxMissing.reason, 'CNY 2026-09 환율 없음'); // 환율 출처를 주지 않으면 짐작하지 않음
});
test('월별 수주 vs 매입: 환율 없음 행은 금액에서 빠지고 따로 셈 · 달마다 쓴 환율 · Excel 에 두 열', () => {
  const R = P.apply(FXROWS, FXT, {}, { fx: { resolver: FXR, mode: 'prev' } });
  const S = MO.summarize(R.rows);
  const sep = S.months.find((m) => m.month === '2026-09'), oct = S.months.find((m) => m.month === '2026-10'), dec = S.months.find((m) => m.month === '2026-12');
  // 9월: 수주 5 × 2,812.60 = 14,063 · 발주 5 × 1,000 = 5,000 → 35.6% / 10월: 수주 100 × 3,000 = 300,000 · 발주 100 × 2,379.38 = 237,938 → 79.3%
  assert.deepEqual([sep.sale, sep.buy, sep.share], [14063, 5000, 35.6]);
  assert.deepEqual([oct.sale, oct.buy, oct.share, oct.buyFx0], [300000, 237938, 79.3, 0]);
  assert.deepEqual(oct.fx.map((f) => [f.cur, f.month, f.raw, f.src, f.rows]), [['CNY', '2026-09', 190.35, '기준파일', 1]]);
  assert.deepEqual(sep.fx.map((f) => [f.cur, f.month, f.raw, f.src]), [['USD', '2026-08', 1406.3, '자동(서울외국환중개)']]);
  assert.deepEqual(S.total.fx.map((f) => f.cur + '|' + f.month), ['CNY|2026-09', 'USD|2026-08']);
  assert.deepEqual([dec.sale, dec.buy, dec.buyFx0, dec.buyNone], [30000, 0, 1, 0]);
  assert.equal(MO.sentence(dec), '2026-12 수주금액 30,000원 · 발주금액 0원 · 수주금액 대비 발주금액 0.0% (환율 없음 1행)');
  assert.equal(MO.sentence(oct), '2026-10 수주금액 300,000원 · 발주금액 237,938원 · 수주금액 대비 발주금액 79.3% — 적용 환율 CNY 190.35(2026-09 · 기준파일)');
  assert.ok(S.hasFx);
  const A = MO.aoa(S), hi = A.findIndex((r) => r[0] === '납기월' && r[1] === '수주금액');
  assert.deepEqual(A[hi].slice(-2), ['환율 없음(행)', '적용 환율']);
  assert.deepEqual(A.find((r) => r[0] === '2026-12').slice(-2), [1, '']);
  assert.equal(MO.summarize(P.apply(FXROWS.slice(3), FXT, {}).rows).hasFx, false);              // 외화가 없으면 열도 없음
});
test('통합 수주 Excel: 원래 통화·값과 환율 내역을 맨 끝 열에', () => {
  const R = P.apply(FXROWS, FXT, {}, { fx: { resolver: FXR } });
  const A = I.rowsAoa(R.rows), H = A[0];
  assert.deepEqual(H.slice(-5), ['판매 통화', '판매단가(원래 값)', '매입 통화', '매입단가(원래 값)', '환율 적용 내역']);
  assert.deepEqual(A[1].slice(-5), ['', '', 'CNY', 12.5, 'CNY 12.5 × 190.35 = 2379.38원 (2026-09 월평균 · 기준파일)']);
  assert.equal(A[2][H.indexOf('매입단가 출처')], '환율 없음');
  assert.deepEqual(A[3].slice(-5, -1), ['USD', 2, '', '']);
});
test('서울외국환중개 화면 풀기(scripts/fetch-rates.mjs): 「사이트보안」 글자(d1~d5)를 풀어 연월·통화명·값', () => {
  const enc = (s, L) => [...s].map((ch) => { const c = ch.charCodeAt(0); return c > 255 ? '%u_' + L + c.toString(16) : '%_' + L + c.toString(16); }).join('');
  const html = '<caption>월평균 매매기준율 결과 표</caption><tr><th><script>d2(\'' + enc('날짜', 'A') + '\');</script></th></tr>' +
    '<tr><td><script>d1(\'' + enc('2026', 'Z') + '\');</script>.<script>d1(\'' + enc('08', 'Z') + '\');</script></td><td><script>d2(\'' + enc('위안 (CNH)', 'A') + '\');</script></td><td><script>d3(\'' + enc('208.69', 'B') + '\');</script></td></tr>' +
    '<tr><td><script>d1(\'' + enc('2026', 'Z') + '\');</script>.<script>d1(\'' + enc('07', 'Z') + '\');</script></td><td><script>d2(\'' + enc('미국 달러 (USD)', 'A') + '\');</script></td><td><script>d3(\'' + enc('1,497.43', 'B') + '\');</script></td></tr></table>';
  assert.deepEqual(parseTable(html), [{ month: '2026-08', name: '위안 (CNH)', value: 208.69 }, { month: '2026-07', name: '미국 달러 (USD)', value: 1497.43 }]);
  assert.throws(() => parseTable('<html></html>'), /결과 표/);
});
test('자동 값 파일(data/rates.json): 서울외국환중개 월평균 · CNY 칸 = 위안(CNH) · 끝난 달만', () => {
  const j = JSON.parse(require('node:fs').readFileSync(new URL('../data/rates.json', import.meta.url), 'utf8'));
  assert.match(j.sourceUrl, /smbs\.biz\/ExRate\/MonAvgStdExRate\.jsp/);
  assert.equal(j.currencies.CNY.smbsCode, 'CNH'); assert.equal(j.currencies.JPY.unit, 100);
  const ms = Object.keys(j.currencies.CNY.months).sort();
  assert.ok(ms.length >= 12 && ms.every((m) => /^\d{4}-\d{2}$/.test(m)));
  assert.ok(ms[ms.length - 1] < j.fetchedAt.slice(0, 7));                                     // 받은 달(끝나지 않은 달)은 없음
  assert.equal(j.currencies.CNY.months['2026-08'], 208.69);                                   // 2026-09-30 에 받은 값
});

console.log(`\n${passed}개 통과`);
