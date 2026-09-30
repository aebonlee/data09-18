/* 수주 자동 취합 — 예시(가상) 파일. 품번·수량·고객사는 모두 시연용 가상 값입니다.
   머리행(열 이름·열 순서)만 실제 고객사 포털·발주서 양식과 같게 만들었습니다(기획서 11.3 열 매핑표).
   「예시 파일로 해 보기」 버튼과 scripts/make-intake-samples.js(엑셀·PDF 파일 만들기), 테스트가 함께 씁니다.
   기준일 2026-09-29(화). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SPIntakeSample = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var BASE = '2026-09-29';
  function sp(s) { return s.split('|'); }
  function row(width, cells) { var r = []; for (var i = 0; i < width; i++) r.push(''); Object.keys(cells).forEach(function (k) { r[colIdx(k)] = cells[k]; }); return r; }
  function colIdx(c) { var n = 0; for (var i = 0; i < c.length; i++) n = n * 26 + (c.charCodeAt(i) - 64); return n - 1; }
  function addDays(iso, n) { var d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000); return d.toISOString().slice(0, 10); }
  function slash(iso) { return iso.replace(/-/g, '/'); }

  // ── 고객사 포털 「납품예정·직송」 표준 양식 (A:No … CC:Rev, 81열) ──
  var PORTAL = sp('No|원산지|FTA원산지|납품가능|JIS|사급여부|조회여부|플랜트명|발주번호|발주항번|품목코드|품목명|납품예정신고수량|납품가능일자|자율검사|성적서 상태|발주수량|소포장수량|납품누적수량|납품잔량|품질 합격잔량|오더유형|Shipping Type|Shipping Type Desc|조기납품가능일자|납기일자|발주일|발주단가|발주금액|발주단위|미납금액|통화|검사구분|저장위치|저장위치명|저장Bin|창고담당자|창고담당자명|납촉담당자|납촉담당자명|직송협력사코드|직송협력사명|Site|Site명|구매조직|오더유형 코드|Serial No|대표사양|L/C Apporval No|L/C 확인일자|Inspec Result|Inspection Desc|Specification|APQP|Parkerizing Amount|내수/수출|설변전 품번|유효기간(From)|유효기간(To)|FTA유효기간(From)|FTA유효기간(To)|PO 납기일|S/O 번호|S/O 납기요청일|공정그룹|THREAD|MPQ|최근발주일자|간헐적 PO 여부|자재 그룹|Reschedule date|FTANOO_OPTN|PR Item Text|초도|DICC PO Type|DICC PO Type Des|자재 유형|물류유형|ctq|Ship To|Rev');
  function portal(no, plant, item, name, qty, type, due, orderDate) {
    return row(PORTAL.length, { A: no, H: plant, I: '99000' + (10000 + no * 7), J: '00010', K: item, L: name, M: 0, Q: qty, S: 0, T: qty, V: type, Y: due, Z: due, AA: orderDate, AD: 'EA', AT: type === 'Mass PO' ? 'Z1' : 'Z5' });
  }
  // ── 군산 건기 「예정신고전」 생산오더 양식 (A:No … BN:ERNAM, 66열) ──
  var PROD = sp('No|선택여부|원산지|FTA원산지|플랜트|Lot-Size|발주번호|발주항번|생산오더번호|품목코드|품목명|추적성|연번|사급여부|조회여부|Category|자율검사|성적서 상태|품질검사결과|APQP|모델-호기|기종-호기|Scheduled start|Scheduled start time|INPUT일자|INPUT시간|조기납품가능일자|납기일(Actual)|납기시간(Actual)|UoM|요청수량|납품예정신고수량|Finish품번|생산오더유형|오더유형 내역|요청자|요청사유|Inv. Manager|Inv. Manager Name|생산라인|검사유형|검사유형명|품질검사명|저장위치|저장위치명|BIN|생성일|생성시간|예약번호|예약항번|할당수량|Serial|예약요청번호|예약요청항번|산처리금액|Scheduled finish|Scheduled finish time|Work Center|Sales Order|FTA유효기간(From)|FTA유효기간(To)|RECENT_PO_DATE|LONGTERM_PO|오더유형|WCPOS|ERNAM');
  function prod(no, item, due) { return row(PROD.length, { A: no, E: '9111', J: item, K: '예시 하네스 ' + item, P: 'P', AB: due, AD: 'EA', AE: 1, AF: 1, AH: 'DP01', AI: 'Standard PP Order', AU: '2026-09-28', BL: 'Z1' }); }
  // ── 안산 AM 양식 (A:품목코드 … BA:Maker Part No, 53열) ──
  var AM = sp('품목코드|품목명|CTQ|발주수량|납품누적수량|납품잔량|납품예정신고수량|발주일|납기일자|확정여부|확정일자|발주단가|발주금액|발주단위|원산지|FTA원산지|Priority|플랜트명|Model|협력사 품목코드|THREAD|가용재고|전체예약현황|긴급예약현황|전일대비변동|조기납품가능일자|납품예정일(ETD)|납품가능일자|발주구분|납품잔량금액|화폐|직송오더번호|직송처|직송처명|저장위치|저장위치명|발주번호|발주항번|사급여부|사급수령|QM Inspection|납기요구일(실적)|검사구분|유효기간(From)|유효기간(To)|FTA유효기간(From)|FTA유효기간(To)|직송구분|오더유형 코드|최근입고일|Direct P/O Address|고객메모|Maker Part No');
  function am(item, qty, orderDate, due, kind, fixed) { return row(AM.length, { A: item, B: '예시 하네스 ' + item, D: qty, E: 0, F: qty, G: 0, H: orderDate, I: due, J: fixed, AC: kind, AW: kind.slice(0, 2), R: '예시 AM 센터' }); }

  // ── 누적결품 양식 (A:No … CN:Subcontract) — P~BS 일별 누적, BT~BX 월 칸 ──
  var SHORT_HEAD = (function () {
    var h = sp('No|플랜트|품목코드|품목명|InventoryManager|CodeName|창고코드|MRP Type|LotSize|BaseUnit|Text|Delivery Qty|Fac Gate Qty|Inspection Qty|Stock Qty');
    for (var i = 0; i < 56; i++) h.push(slash(addDays(BASE, i)));
    return h.concat(sp('11|12|01|02|03|직송/유상|자율검사|수입검사|출장검사|OpenPO Qty|QuantityOfGoodsReceived|QuantityOfGoodsReceived|Suffix|EngineeringStatus|Text|ChagedOn|PurchaseRequisitionQuantity|CurrencyKey|PurchasingGroup|DescOfPurchasingGroup|Subcontract'));
  })();
  /** steps: {날짜오프셋: 누적값} — 그 날부터 다음 변화까지 같은 값. months: [11,12,01,02,03 칸 값] */
  function shortRow(no, plant, item, stock, steps, months) {
    var r = row(SHORT_HEAD.length, { A: no, B: plant, C: item, D: '예시 하네스 ' + item, J: 'EA', L: 0, M: 0, N: 0, O: stock });
    var v = stock;
    for (var i = 0; i < 56; i++) { if (steps[i] !== undefined) v = steps[i]; r[15 + i] = v; }
    for (var m = 0; m < 5; m++) r[71 + m] = months ? months[m] : v;
    return r;
  }

  // ── 밥캣 누적결품 양식 (A:CK … BS:상태, 71열) — 머리 아래 행에 실제 날짜 ──
  var BOB_SHORT = (function () {
    var h = sp('CK|Plant|Plant명|품번|품명|MRP|Lot-Size|단위|납품예정신고|반입신고|현재고');
    h.push('B(D-Day)'); for (var i = 1; i <= 30; i++) h.push('B(D+' + i + ' Day)');
    return h.concat(sp('금일입고량|D Qty|D1 Qty|D2 Qty|D3 Qty|D4 Qty|최초납기|발주수량|MRP Controller|MRP C|InventoryManager|Inv. Manager|WarehouseController|Warehouse C|EP.SLoc|창고|당월미납량|소요량|소요량|소요량|소요량|3개월평균소요량|금월입고량|최근입고일|최근불출일|조회 회수|HEADER_YN|삭제|상태'));
  })();
  // 영업일 16일(10/3·10/5·10/9 휴일 가정)만 날짜, 나머지는 0000/00/00 — 마지막 날짜 = 2026/10/22
  var BOB_DAYS = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'];
  function bobDateRow() {
    var r = row(BOB_SHORT.length, { A: 0 });
    for (var i = 0; i < 31; i++) r[11 + i] = i < BOB_DAYS.length ? slash(BOB_DAYS[i]) : '0000/00/00';
    return r;
  }
  function bobShortRow(item, stock, vals) {
    var r = row(BOB_SHORT.length, { A: 0, B: 'F999', C: '예시 밥캣 공장', D: item, E: '예시 하네스 ' + item, F: 'PD', H: 'EA', I: '0', J: '0', K: String(stock) });
    for (var i = 0; i < 31; i++) r[11 + i] = i < BOB_DAYS.length ? String(vals[i] !== undefined ? vals[i] : vals[vals.length - 1]) : '0';
    return r;
  }
  // ── 밥캣 납품예정 양식 (A:삭제 … CR:자재 유형, 96열). 수량·날짜가 글자로 들어 있음 ──
  var BOB_PLAN = sp('삭제|상태|선택|물류유형|물류유형|No.|원산지|원산지 이름|FTA원산지|납품가능|JIS|CTQ|사급여부|조회여부|Plant|Plant명|발주번호|발주항번|Ship To|품번|Rev.|품명|납품예정신고수량|납품가능일자|자율검사|성적서 상태|Q_FLAG|P_FLAG|발주수량|소포장수량|납품누적수량|납품잔량|합격수량|품질 합격잔량|오더유형|Shipping Type|Shipping Type Desc.|조기납품가능일자|납기일자|발주일|발주단가|발주금액|사급단가|사급금액|총단가|총금액|발주단위|미납금액|통화|검사구분|저장위치|저장위치명|저장Bin|창고담당자|창고담당자명|납촉담당자|납촉담당자명|직송업체코드|직송업체명|Site|Site명|구매조직|오더유형 코드|Serial No.|대표사양|L/C Apporval No.|L/C 확인일자|Inspec Result|Inspection Desc.|Specification|APQP|Parkerizing Amount|JIS Confirm|내수/수출|설변전 품번|유효기간(From)|유효기간(To)|FTA유효기간(From)|FTA유효기간(To)|PO 납기일|S/O 번호|S/O 납기요청일|공정그룹|THREAD|MPQ|최근발주일자|간헐적 PO 여부|자재 그룹|Reschedule date|SET_CHECK_COMP|FTANOO_OPTN|PR Item Text|초도|DICC PO Type|DICC PO Type Des.|자재 유형');
  function bobPlan(no, item, qty, type, due, orderDate) {
    return row(BOB_PLAN.length, { A: 0, C: 0, F: String(no), G: 'KR', J: 'Y', O: 'F999', P: '예시 밥캣 공장', Q: '59000' + (20000 + no), R: '00010', T: item, V: '예시 하네스 ' + item, W: '0', X: '0000/00/00', AC: qty, AE: '0', AF: String(qty), AI: type, AL: slash(addDays(due, -6)), AM: slash(due), AN: slash(orderDate), AU: 'EA' });
  }

  // ── 선적계획(미판매현황) · 창고별재고현황 — 1행 제목, 2행 머리, 끝에 소계·합계·출력시각 ──
  var SHIP = sp('일자-No.|참조|품목코드|품목명(규격)|일자|번호|수량|미판매수량|납기일자|변경선적요청일(调整）|거래처명|적요|미판매부가세|비고(备注）|최종수정일시');
  function ship(no, item, qty, left, due, req) { return ['2026/09/01 -' + no, 'SOI-EX-' + no, item, '예시 하네스 ' + item.replace(/\(CI\)$/, ''), '2026/09/01 ', String(no), qty, left, slash(due) + ' ', req ? slash(req) + ' ' : '', '예시 거래처', '', '', '', '2026/09/15 (화) 13:54:57']; }
  var STOCK = sp('순번|품목코드|품목구분|대분류|품목명|규격|합계|창고A-검사대기|창고A-입고대기|완제품창고(1F)|완제품창고(B2)|포장반|초도품창고|회로검사대기|반제품창고|완제품창고2|품질검사|안전재고|자재위치|적요|완제품단가|반제품단가|일반무역단가(RMB)|외주단가');
  function stock(no, item, qty, safety) { var r = row(STOCK.length, { A: String(no), B: item, C: '[제품]', D: '상품', E: '예시 하네스 ' + item, G: qty, J: qty }); if (safety !== undefined) r[17] = safety; return r; }

  // ── 발주서 양식 (고객사 이름 대신 「고객사A」 등) ──
  var PO_A = sp('사업장|수주번호|수주항번|수주유형|수주유형명|구매요청사유|결재일자|요구일자(부적합)|자재코드|자재내역|금형지그정보|단위|수량|납품서잔량|납기요청일|생산예정일|입고예정일|화폐|단가|금액|구매담당자|직납업체|발주요청자|직납업체|납품처|납품처명|입고처|입고처명|비고명|납입지시수량|납품예정시|납입지시유효|운영단위코드|협력업체|협력업체코드|플랜트|Flag|권한그룹|취소요청|구매요청유형|구매요청유형|선유형|  |회사단위|내/외자|출장검사번호|출장검사항번|검사결과|납입항번|검수여부|검수담당자|입고담당자');
  function poA(no, item, qty, left, due, ok) { return row(PO_A.length, { A: '예시 사업장', B: '45000' + (70000 + no), C: '00010', D: '생산 구매', E: 'ZNB', G: ok.replace(/-/g, ''), I: item, J: '예시 하네스 ' + item, L: 'EA', M: qty, N: left, O: due.replace(/-/g, ''), Q: '00000000', R: 'KRW' }); }
  var PO_A2 = sp('운영단위|사업장(플랜트)|내/외자|수주번호|수주항번|수주유형|구매요청유형|구매요청사유|결재일자|자재코드|자재내역|금형지그정보|단위|수량|납품서잔량|납기요청일|납기제한일자|생산예정일|입고예정일|화폐|단가|금액|세금|구매담당|구매담당자|직납업체코드|직납업체명|하차위치|하차위치명|자재형태|대분류|중분류|소분류');
  function poA2(no, item, qty, left, due, ok) { return row(PO_A2.length, { A: '예시 운영단위', B: '예시공장 [9411]', C: '내자', D: '45000' + (80000 + no), E: '00010', F: '생산 구매', I: ok, J: item, K: '예시 하네스 ' + item, M: 'EA', N: qty, O: left, P: due, T: 'KRW' }); }
  var PO_B = sp('No|구분|색상|개발여부|임시저장여부|수주번호|수주항번|수주일자|착수일자|납입지시번호|납기요청일시|자재코드|자재명|납품처|출력가능여부|납품 가능 수량|납품수량|납입지시항번|순번|조립 (오전/오후)|납기요청시간|납품예정일|납품서 생성가능일|ECN 내용|색상명|특이사항|Issue No|Rack|저장빈|카테고리|Mfr Part No.|검사대상여부|제출서류|수입검사/샘플링대상여부|수주수량|납입지시수량|납품서생성수량(발주)|납품서생성수량(납입지시)|임시저장수량|단위|통화|단가|생산번호|연번|공정정보|생산라인|납품처코드|상세주소|납품처상세주소|저장위치|호기|모델|표준모델|긴급여부|옵션|구매요청번호|구매요청항번');
  function poB(no, item, ordered, made, due, od) { return row(PO_B.length, { A: no, D: 'ZNB', E: 'N', F: 'M2600' + (10000 + no), G: '00001', H: od, K: due, L: item, M: '예시 하네스 ' + item, N: '예시 납품처', O: 'Y', P: ordered - made, Q: 0, AD: '일반', AI: ordered, AJ: 0, AK: made, AN: 'EA', AO: 'KRW' }); }
  var PO_C = sp('No|긴급|발주접수상태||플랜트|추가정보|확정제어키|발주번호|항번|생산오더|발주명|자재리비전|ACC|저장위치|저장위치코드|MRP관리자|EWM창고여부|WBS요소|구매유형|품목번호|품목명|품목텍스트|자재유형|단위|발주수량|누적납품수량|반품수량|입력가능수량|초과 허용치|입고수량|통화|발주단가|발주금액|가격단위|발주종료|발주강제종료|지급조건|발주일자|납기일자|Bin(정위치)|사업장|구매요청자|납품장소|직납여부|직납업체|계획납품기간|조기납품허용일|검사성적서|제품군|계약번호|판매문서|품목');
  function poC(no, item, qty, done, od, due) { return row(PO_C.length, { A: no, C: '승인', E: '[9782] 예시 플랜트', H: '45044' + (30000 + no), I: no * 10, T: item, U: '예시 하네스 ' + item, X: 'EA', Y: qty, Z: done, AA: 0, AB: qty - done, AL: od, AM: due }); }
  /** 서식형 발주서 한 장. dates: 날짜별 수량 서식이면 [날짜…], 아니면 null(= 납기일 칸 하나) */
  function poForm(title, orderDate, due, items, dates, extraHead) {
    var W = 30, a = [];
    for (var i = 0; i < 30; i++) a.push(row(W, {}));
    a[0] = row(W, { F: title });
    a[3] = row(W, { B: '발주업체', C: '(예시) 우리 회사', J: '발주자', O: '(예시) 고객사' });
    a[10] = row(W, { J: '발주일', O: orderDate });
    if (due) a[11] = row(W, { J: '납기일', O: due });
    a[14] = row(W, { A: '순번', B: '품 번', F: '품 명', I: '단위', K: dates ? '발주량 및 요청납기일' : '발주수량', W: '비고' });
    if (dates) { var h = row(W, {}); dates.forEach(function (d, k) { h[10 + k * 3] = d; }); if (extraHead) h[10 + dates.length * 3] = extraHead; a[15] = h; }
    items.forEach(function (it, k) {
      var r = row(W, { A: k + 1, B: it[0], F: '예시 하네스 ' + it[0], I: 'EA' });
      for (var q = 1; q < it.length; q++) if (it[q] !== '' && it[q] != null) r[10 + (q - 1) * 3] = it[q];
      a[(dates ? 16 : 15) + k] = r;
    });
    a[22] = row(W, { B: '※ 택배 배송주소 > (예시) 주소' });
    a[23] = row(W, { A: '합 계' });
    a[24] = row(W, { A: '납 기 일 자', K: '납 품 장 소' });
    return a;
  }

  // ── PDF 발주서의 글자 조각(pdf.js getTextContent 가 주는 모양 그대로: 머리 글자가 한 글자씩, 품목코드가 두 줄) ──
  var PDF_ITEMS = (function () {
    var it = [];
    function t(x, y, s) { it.push({ x: x, y: y, str: s, page: 1 }); }
    function spread(x, y, s) { for (var i = 0; i < s.length; i++) t(x + i * 8, y, s.charAt(i)); }
    t(277, 789, '발 주 서'); t(68, 767, '일련번호'); t(118, 767, '2026/09/10'); t(168, 767, '-'); t(172, 767, '3');
    t(76, 750, '수 신'); t(118, 750, '(예시) 우리 회사'); t(291, 705, '회사명/대표'); t(347, 705, '(예시) 고객사F');
    t(123, 672, '납기일자 :'); t(167, 672, '2026/10/08');
    spread(65, 624, '품목코드'); spread(220, 624, '품목명[규격]'); spread(385, 629, '수량(단'); spread(385, 618, '위포함)');
    spread(428, 624, '단가'); spread(463, 624, '공급가액'); spread(511, 624, '부가세');
    t(60, 607, 'SMP-PDF-'); t(60, 597, '0001'); t(104, 602, 'EXAMPLE-CHARGING'); t(397, 602, '120'); t(428, 602, '1,000'); t(459, 602, '120,000'); t(512, 602, '12,000');
    t(60, 577, 'SMP-D002'); t(104, 577, 'EXAMPLE-HARNESS'); t(401, 577, '40'); t(428, 577, '2,000'); t(459, 577, '80,000'); t(512, 577, '8,000');
    t(68, 220, '수량'); t(135, 220, '160'); t(158, 220, '공급가액'); t(240, 220, '200,000'); t(289, 220, 'VAT'); t(350, 220, '20,000'); t(396, 220, '합계'); t(504, 220, '220,000');
    return it;
  })();

  // ── 파일 목록 ──
  var P = '2026.09.29_';
  function files() {
    var f = [];
    function x(name, sheets, kind) { f.push({ name: name, kind: kind || 'xlsx', sheets: sheets }); }
    // 건기 납품예정(인천) — 잔량 0 한 줄, 납기 빈칸 한 줄(★)
    x(P + '납품예정 인천건기.xlsx', { sheet1: [PORTAL,
      portal(1, 'CE', 'SMP-C101', '예시 하네스 C101', 5, 'Mass PO', '2026-10-06', '2026-09-17'),
      portal(2, 'CE', 'SMP-C102', '예시 하네스 C102', 4, 'Mass PO', '2026-10-07', '2026-09-17'),
      portal(3, 'CE', 'SMP-C103', '예시 하네스 C103', 2, 'Proto-Domestic PO', '2026-10-13', '2026-09-20'),
      portal(4, 'CE', 'SMP-C101', '예시 하네스 C101', 0, 'Mass PO', '2026-10-14', '2026-09-21'),
      portal(5, 'CE', 'SMP-C104', '예시 하네스 C104', 3, 'Mass PO', '', '2026-09-21')] });
    x(P + '납품예정 군산건기(예정신고전).xlsx', { sheet1: [PROD, prod(1, 'SMP-G201', '2026-09-30'), prod(2, 'SMP-G201', '2026-09-30'), prod(3, 'SMP-G201', '2026-10-01'), prod(4, 'SMP-G202', '2026-10-05')] });
    // 엔진 납품예정 — Mass PO 는 빼고, 누적결품에 있는 품번(E301)은 결품 우선으로 빠짐
    x(P + '납품예정 인천엔진.xlsx', { sheet1: [PORTAL,
      portal(1, 'EM', 'SMP-E301', '예시 하네스 E301', 10, 'Mass PO', '2026-10-01', '2026-09-15'),
      portal(2, 'EM', 'SMP-E302', '예시 하네스 E302', 6, 'Mass PO', '2026-10-02', '2026-09-15'),
      portal(3, 'EM', 'SMP-E301', '예시 하네스 E301', 3, 'Proto-Domestic PO', '2026-10-05', '2026-09-20'),
      portal(4, 'EM', 'SMP-E303', '예시 하네스 E303', 2, 'Proto-Domestic PO', '2026-10-08', '2026-09-21')] });
    x(P + '납품예정 군산엔진.xlsx', { sheet1: [PORTAL, portal(1, 'EM GS', 'SMP-E401', '예시 하네스 E401', 7, 'Mass PO', '2026-10-05', '2026-09-15')] });
    x(P + '납품예정 안산AM.xlsx', { sheet1: [AM, am('SMP-A501', 5, '2026-09-06', '2026-11-27', 'NB(일반)', '미확정'), am('SMP-A502', 1, '2026-09-20', '2026-10-05', 'N3(긴급)', '확정')] });
    x(P + '납품예정CKD건기.xlsx', { sheet1: [PORTAL, portal(1, 'CE CKD', 'SMP-K601', '예시 하네스 K601', 500, 'Mass PO', '2026-10-14', '2026-09-22')] });
    // 누적결품 — 엔진은 수주로, 건기는 참고자료(제외)
    x(P + '누적결품 인천엔진.xlsx', { sheet1: [SHORT_HEAD,
      shortRow(1, '9130', 'SMP-E301', 8, { 0: 6, 3: 2, 6: -2, 9: -5, 30: -9 }),
      shortRow(2, '9130', 'SMP-E304', 20, { 0: 20 }),
      shortRow(3, '9130', 'SMP-E305', 4, { 0: 4 }, [4, -3, -3, -7, -7])] });
    x(P + '누적결품 군산엔진.xlsx', { sheet1: [SHORT_HEAD, shortRow(1, '9131', 'SMP-E401', 2, { 0: 1, 2: -1 })] });
    x(P + '누적결품 인천건기.xlsx', { sheet1: [SHORT_HEAD, shortRow(1, '9000', 'SMP-C101', 0, { 3: -4 }), shortRow(2, '9000', 'SMP-C103', 1, { 0: 1 })] });
    x(P + '누적결품 군산건기.xlsx', { sheet1: [SHORT_HEAD, shortRow(1, '9111', 'SMP-G201', 1, { 1: -2 })] });
    x(P + '직송 인천건기.xlsx', { sheet1: [PORTAL, portal(1, 'CE', 'SMP-C105', '예시 하네스 C105', 100, 'Mass PO', '2026-10-06', '2026-09-15')] });
    x(P + '직송 인천엔진.xlsx', { sheet1: [PORTAL, portal(1, 'EM', 'SMP-E306', '예시 하네스 E306', 30, 'Mass PO', '2026-09-27', '2026-09-20')] });
    // 밥캣 — 결품 품번(B701)과 겹치는 일반 행은 빠지고, 원납기는 [기준일 ~ 2026-10-22]로 조임
    x('26.09.29_누적결품 밥캣.xls', { Sheet1: [BOB_SHORT, bobDateRow(), bobShortRow('SMP-B701', 3, [3, 3, 3, 1, -1, -1, -2]), bobShortRow('SMP-B702', 0, [0, 0, -1])] }, 'xls');
    x('26.09.29_납품예정 밥캣 일반.xls', { Sheet1: [BOB_PLAN,
      bobPlan(1, 'SMP-B701', 30, 'Kanban PO', '2026-10-08', '2026-09-20'),
      bobPlan(2, 'SMP-B703', 500, 'Kanban PO', '2026-09-07', '2026-09-01'),
      bobPlan(3, 'SMP-B704', 12, 'Mass PO', '2026-10-13', '2026-09-22'),
      bobPlan(4, 'SMP-B705', 1, 'Proto-Domestic PO', '2026-11-17', '2026-09-28')] }, 'xls');
    x('26.09.29_납품예정 밥캣 직송.xls', { Sheet1: [BOB_PLAN, bobPlan(1, 'SMP-B706', 10, 'Mass PO', '2026-10-06', '2026-09-27')] }, 'xls');
    // 선적계획 · 재고 — 기존 입력 ③ · ② 로 넘어감
    x('선적계획(품목코드,미판매수량,변경선적요청일).xlsx', { '미판매현황': [['회사명 : (예시) 해외 공장 / 예시 거래처 외 1건 / 2025/10/31  ~ 2026/10/31 '], SHIP,
      ship(1, 'SMP-E301(CI)', 20, 12, '2026-09-25', '2026-10-01'),
      ship(2, 'SMP-C101(CI)', 10, 10, '2026-10-02', '2026-10-06'),
      ship(3, 'SMP-B703(CI)', 600, 600, '2026-10-05', ''),
      ['2026/09  계', '', '', '', '', '', 630, 622], ['총합계', '', '', '', '', '', 630, 622], ['2026/09/29 (화) 9:11:30']] });
    x('창고별재고현황_2026.09.29(품목코드,합계).xlsx', { '재고현황': [['회사명 : (예시) 우리 회사 / 완제품창고 외 / 2026/09/29'], STOCK,
      stock(1, 'SMP-C101', 3), stock(2, 'SMP-E301', 2, 1), stock(3, 'SMP-E303', 5), stock(4, 'SMP-B703', 120), stock(5, 'SMP-G201', 1), stock(6, 'SMP-A501', 2),
      stock(7, 'SMP-C103-완제품', 4), ['합계', '', '', '', '', '', 137], ['2026/09/29  오전 7:52:32']] });
    // 발주서 7종
    x('고객사A_발주서.xlsx', { sheet: [PO_A, poA(1, 'SMP-P801', 60, 20, '2026-10-02', '2026-09-14'), poA(2, 'SMP-P802', 40, 40, '2026-10-12', '2026-09-24'), poA(3, 'SMP-P803', 10, 0, '2026-09-20', '2026-09-01')] });
    x('고객사B_발주서.xlsx', { sheet1: [PO_B, poB(1, 'SMP-P811', 20, 19, '2026-10-05', '2026-09-20'), poB(2, 'SMP-P812', 3, 0, '2026-10-07', '2026-09-21')] });
    x('고객사C_발주서.xlsx', { sheet1: [PO_C, poC(1, 'SMP-P821', 7, 0, '2026-09-06', '2026-10-15'), poC(2, 'SMP-P822', 5, 2, '2026-09-06', '2026-11-19')] });
    x('고객사D_발주서.xlsx', { Sheet1: poForm('10월 발주서', '2026-09-12', '2026-10-09', [['SMP-P831', 200], ['SMP-P832', 50], ['SMP-P833', '']], null) });
    x('고객사E_발주서.xlsx', {
      '지난 발주서': poForm('발 주 서', '2026-08-01', null, [['SMP-P841', 80]], ['2026-08-30']),
      '10월': poForm('발 주 서', '2026-09-20', null, [['SMP-P841', 130, 40, 5], ['SMP-P842', '', 24], ['SMP-P843', -5]], ['2026-10-10', '2026-10-24'], '추가분')
    });
    x('고객사G_발주서.xlsx', { Sheet1: [PO_A2, poA2(1, 'SMP-P851', 200, 150, '2026-10-14', '2026-09-23'), poA2(2, 'SMP-P852', 80, 80, '2026-10-16', '2026-09-25')] });
    f.push({ name: '고객사F_발주서.pdf', kind: 'pdf', pdf: PDF_ITEMS });
    // 종류를 알 수 없는 파일 — ★확인 필요로 가는 것을 보여 줌
    x('회의메모_기타자료.xlsx', { Sheet1: [['메모', '내용'], ['1', '다음 주 회의']] });
    return f;
  }
  /** 화면·테스트용: process() 에 바로 넣을 모양 {name, sheets:{names, sheets}} / {name, pdf} */
  function asInput() {
    return files().map(function (x) {
      if (x.kind === 'pdf') return { name: x.name, pdf: x.pdf, hash: 'sample:' + x.name };
      return { name: x.name, hash: 'sample:' + x.name, sheets: { names: Object.keys(x.sheets), sheets: x.sheets } };
    });
  }
  // ── 품번 매핑표(고객사 품번 → 천일품번) 예시 — 실제 매핑표와 같은 시트 이름·열(고객사 | 천일품번), 품번은 가상 ──
  // 대부분 두 품번이 같고(실제 매핑표도 그렇습니다), CH- 로 시작하는 것만 당사 품번이 다릅니다.
  // 일부러 넣은 것: 같은 줄 반복(C101·B701), 빈 칸 1행, 매핑 충돌(B705 → 두 값), 매핑 없음(AM A502 · 밥캣 B706)
  var MAPPING = {
    '건기엔진품목코드': [['고객사', '천일품번'],
      ['SMP-C101', 'SMP-C101'], ['SMP-C102', 'SMP-C102'], ['SMP-C103', 'SMP-C103-완제품'], ['SMP-C104', 'SMP-C104'], ['SMP-C105', 'SMP-C105'],
      ['SMP-E301', 'SMP-E301'], ['SMP-E302', 'SMP-E302'], ['SMP-E303', 'SMP-E303'], ['SMP-E304', 'SMP-E304'], ['SMP-E305', 'CH-E305'], ['SMP-E306', 'SMP-E306'],
      ['SMP-E401', 'SMP-E401'], ['SMP-G201', 'SMP-G201'], ['SMP-G202', 'SMP-G202'], ['SMP-A501', 'SMP-A501'], ['SMP-K601', 'CH-K601'],
      ['SMP-C101', 'SMP-C101'], ['SMP-X901', 'SMP-X901']],
    '밥캣품목코드': [['고객사', '천일품번'],
      ['SMP-B701', 'SMP-B701'], ['SMP-B702', 'SMP-B702'], ['SMP-B703', 'SMP-B703'], ['SMP-B704', 'CH-B704'], ['SMP-B705', 'CH-B705'],
      ['SMP-B701', 'SMP-B701'], ['', 'CH-B799'], ['SMP-B705', 'CH-B705-A']]
  };
  function mappingBook() { return { names: Object.keys(MAPPING), sheets: MAPPING }; }
  // ── ERP 업로드 양식 예시 — 머리행만(수강생 양식과 같은 17열). 열 이름은 일반 명칭입니다 ──
  var TEMPLATE_HEAD = ['일자', '순번', '추가문자형식1', '납품처 코드', '납품처명', '담당자', '납기일자', '품목코드(상단)', '작업지시No.',
    '품목코드', '품목명', 'BOM버전', '규격', '수량', '창고', '적요', '하위반제품수'];

  return { BASE: BASE, files: files, asInput: asInput, PDF_ITEMS: PDF_ITEMS, MAPPING: MAPPING, mappingBook: mappingBook, TEMPLATE_HEAD: TEMPLATE_HEAD };
});
