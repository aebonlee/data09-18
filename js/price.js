/* 판매단가·매입단가 — 순수 로직 (기획서 11.11 · 11.12)
   2026-09-30 두 번째 답변으로 단가를 둘로 나눴습니다.
     판매단가(고객 발주) — 고객사가 보낸 발주 파일의 단가 칸. 「참고」로만 봅니다.
                           통합 수주 행의 price · priceSrc(원본 · 원본(같은 품번)) 값이 이것입니다(intake.js 가 채움).
     매입단가(생산처 발주) — 당사 → 생산처 발주단가. 수강생이 따로 관리하는 「품목별 단가표」(품목코드 → 매입단가, 생산처 선택)에서 찾고,
                           단가표에 없는 품목은 화면에서 직접 적습니다. 고객 발주 단가와 무관합니다. ERP 업로드 양식의 단가 열은 이 값입니다.
   매입단가를 정하는 순서: 1. 매입단가표(천일품번 — 매핑 없는 품번은 고객사 원품번) 2. 직접입력. 둘 다 없으면 「매입단가 없음」.
   판매 − 매입(단가 차이)은 둘 다 있을 때만 계산합니다(화면에서 켜고 끔).
   매입단가표·직접입력 값은 실제 회사 자료라 이 브라우저(localStorage)에만 저장합니다(리포에는 가상 예시만).
   2026-09-30 환율(기획서 11.15): 매입단가표에 「통화」 칸(China(RMB)·RMB·CNY·USD…)이나 「12.5 RMB」 같은 값, 「매입단가(RMB)」 같은 머리가 있으면
   그 통화로 읽고, 통화가 없는 단가는 화면에서 고른 통화(기본 원화)로 봅니다. 외화 단가는 js/fx.js 로 원화로 바꾼 값이 buyPrice 가 되고,
   원래 값은 buyPriceOrig · buyCur, 환산 내역은 buyFx 에 남습니다. 고객 발주(판매단가)의 통화 칸도 같은 방법으로 원화로 바꿉니다.
   환율이 없으면 buyPrice(price) 는 비우고 buyFxMissing(saleFxMissing) 을 붙여 「매입단가 없음」과 따로 셉니다.
   브라우저(window.SPPrice)와 node(require) 양쪽에서 씁니다. */
(function (root, factory) {
  var Fx = typeof module === 'object' && module.exports ? require('./fx.js') : root.SPFx;
  var api = factory(Fx);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SPPrice = api;
})(typeof window !== 'undefined' ? window : this, function (Fx) {
  'use strict';

  function str(v) { return v == null ? '' : String(v).trim(); }
  function norm(v) { return str(v).toLowerCase().replace(/[\s_()\-·.:：（）]/g, ''); }
  /** 품번 열쇠: 공백을 없애고 대문자(매핑표와 같은 규칙) */
  function key(v) { return str(v).replace(/\s+/g, '').toUpperCase(); }
  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).replace(/[,\s₩원]/g, '').trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    return Number(s);
  }
  function round2(x) { return Math.round(x * 100) / 100; }

  // 판매단가 출처(intake.js) · 매입단가 출처(이 파일)
  var SALE_SRC = { source: '원본', borrowed: '원본(같은 품번)' };
  var SALE_ORDER = [SALE_SRC.source, SALE_SRC.borrowed];
  var BUY_SRC = { table: '단가표', product: '완제품정보', manual: '직접입력' };
  var BUY_ORDER = [BUY_SRC.table, BUY_SRC.product, BUY_SRC.manual];   // 2026-09-30 완제품정보(기획서 11.16): 매입단가표 > 완제품정보 발주단가 > 직접입력

  // 매입단가표 열 이름 후보. 앞쪽이 우선 — 「매입단가」와 「단가」가 함께 있으면 매입단가를 읽습니다.
  // 「판매단가」는 고객 발주 단가라 매입단가로 읽지 않습니다(표에 같이 있어도 건너뜀)
  var CODE_COL = ['품목코드', '천일품번', '당사품번', '당사 품목코드', '품번', '자재코드', '품목번호', 'item', 'itemcode', 'partno', 'part no', 'pn'];
  var BUY_COL = ['매입단가', '구매단가', '생산처단가', '생산처 발주단가', '발주단가', '외주단가', '입고단가', '단가', 'unitprice', 'unit price', 'price'];
  var MAKER_COL = ['생산처', '생산처명', '매입처', '매입처명', '구매처', '공급처', '공급업체', '협력사', '외주처', '업체', '업체명', '거래처', '거래처명', 'maker', 'supplier', 'vendor'];
  var SALE_COL = ['판매단가', '판매단가참고', '고객단가', '고객 발주단가'];
  var CUR_COL = ['통화', '통화명', '화폐', '통화코드', 'currency', 'cur', 'ccy'];
  function pick(hs, cands) { var i = -1; cands.map(norm).some(function (c) { i = hs.indexOf(c); return i >= 0; }); return i; }
  /** 「매입단가(RMB)」「단가(China(RMB))」처럼 머리 끝에 통화를 붙인 열도 매입단가 열로 봅니다 */
  function pickBuy(hs) {
    var i = pick(hs, BUY_COL);
    if (i >= 0) return i;
    BUY_COL.map(norm).some(function (c) { hs.some(function (h, j) { if (h.indexOf(c) === 0 && h.length > c.length && Fx && Fx.normCurrency(h.slice(c.length))) { i = j; return true; } return false; }); return i >= 0; });
    return i;
  }
  function headCur(t) { var c = Fx ? Fx.normCurrency(t) : null; return c && c !== 'KRW' ? c : ''; }
  function findCols(aoa) {
    for (var r = 0; r < Math.min(aoa.length, 10); r++) {
      var hs = (aoa[r] || []).map(norm);
      var ci = pick(hs, CODE_COL), pi = pickBuy(hs), mi = pick(hs, MAKER_COL), si = pick(hs, SALE_COL);
      if (ci >= 0 && pi >= 0) return { hr: r, code: ci, price: pi, maker: mi, sale: si, cur: pick(hs, CUR_COL) };
      if (ci >= 0 && si >= 0) return { hr: r, code: ci, price: -1, maker: mi, sale: si, saleOnly: true };
    }
    return null;
  }

  /* 매입단가표 읽기. book = { names, sheets:{시트: aoa} }
     반환 { map:{품목코드 열쇠: {price, maker, row, sheet}}, conflicts:{열쇠:[{price, maker, row}…]}, stats:{rows, pairs, blank, bad, dupSame, conflicts, makers}, problems:[], sheets:[] }
     같은 품목코드가 여러 번이면 위쪽 행 값을 쓰고, 단가나 생산처가 다르면 「단가 충돌」로 셉니다.
     2026-09-30 네 번째 답변으로 확정: 「현재 생산처 이원화로 진행되지만 향후(1개월 이내) 품번별 생산처는 1곳으로 지정되기 때문에
     현재 기준 가장 위쪽 단가로 해도 무방합니다」 — 고르는 화면 없이 위쪽 행 값을 쓰고, 여럿이었던 품목은 목록으로만 보여 줍니다 */
  function parseBook(book) {
    var out = { map: {}, conflicts: {}, stats: { rows: 0, pairs: 0, blank: 0, bad: 0, dupSame: 0, conflicts: 0, makers: 0 }, problems: [], sheets: [] };
    var names = (book && book.names) || [], makers = {};
    names.forEach(function (nm) {
      var aoa = book.sheets[nm] || [];
      if (!aoa.some(function (r) { return (r || []).some(function (c) { return str(c) !== ''; }); })) return;
      var c = findCols(aoa);
      if (!c) { out.problems.push('시트「' + nm + '」: 「품목코드」「매입단가(단가)」 머리를 찾지 못해 건너뛰었습니다'); return; }
      if (c.saleOnly) { out.problems.push('시트「' + nm + '」: 「판매단가」 열만 있고 매입단가 열이 없어 건너뛰었습니다 — 매입단가(생산처 발주단가) 열을 넣어 주세요'); return; }
      out.sheets.push(nm);
      var hc = headCur(str((aoa[c.hr] || [])[c.price]).replace(/^[^(（]*/, ''));   // 머리 「매입단가(RMB)」의 통화
      if (hc || c.cur >= 0) out.currencyCol = true;
      for (var r = c.hr + 1; r < aoa.length; r++) {
        var ln = aoa[r] || [];
        var k = key(ln[c.code]);
        if (!k && str(ln[c.price]) === '') continue;
        out.stats.rows++;
        if (!k || str(ln[c.price]) === '') { out.stats.blank++; continue; }
        var p = num(ln[c.price]), cc = '';
        if (p === null && Fx) { var mo = Fx.parseMoney(ln[c.price]); if (mo && mo.cur !== null) { p = mo.value; cc = mo.cur; } }   // 「12.5 RMB」
        if (p === null || p <= 0) { out.stats.bad++; continue; }
        if (c.cur >= 0 && str(ln[c.cur]) !== '') {
          var rc = Fx ? Fx.normCurrency(ln[c.cur]) : null;
          if (rc === null) { out.stats.badCur = (out.stats.badCur || 0) + 1; if (out.problems.length < 20) out.problems.push('시트「' + nm + '」 ' + (r + 1) + '행: 통화 「' + str(ln[c.cur]) + '」 를 알 수 없어 건너뛰었습니다'); continue; }
          cc = rc;
        }
        if (!cc) cc = hc;
        if (cc === 'KRW') cc = '';
        var mk = c.maker >= 0 ? str(ln[c.maker]) : '';
        if (mk) makers[mk] = 1;
        var cur = out.map[k], e = { price: p, maker: mk, row: r + 1, sheet: nm };
        if (cc) e.cur = cc;
        if (!cur) { out.map[k] = e; out.stats.pairs++; continue; }
        if (cur.price === p && cur.maker === mk && (cur.cur || '') === cc) { out.stats.dupSame++; continue; }
        var list = out.conflicts[k] || (out.conflicts[k] = [{ price: cur.price, maker: cur.maker, row: cur.row }]);
        var ce = { price: p, maker: mk, row: r + 1 };
        if (cc) ce.cur = cc;
        if (cur.cur && !list[0].cur) list[0].cur = cur.cur;
        if (!list.some(function (x) { return x.price === p && x.maker === mk && (x.cur || '') === cc; })) list.push(ce);
      }
    });
    out.stats.conflicts = Object.keys(out.conflicts).length;
    out.stats.makers = Object.keys(makers).length;
    if (!out.sheets.length && !out.problems.length) out.problems.push('매입단가표에서 읽은 행이 없습니다');
    return out;
  }
  function has(t) { return !!(t && t.map && Object.keys(t.map).length); }
  /** 매입단가 열쇠 = 업로드에 쓰는 품목코드(천일품번, 매핑 없으면 고객사 품번) */
  function buyKey(r) { return key(r.company || r.item); }
  /** 매입단가표에서 한 줄: 2026-09-30 세 번째 답변 — 매입단가표는 천일품번 기준(확정).
      매핑을 거친 행은 천일품번으로만 찾고, 매핑 없는 행(고객사 원품번을 그대로 올리는 행)만 그 품번으로 찾습니다.
      (판 0.7 까지는 매핑된 행도 고객사 품번으로 한 번 더 찾았으나, 다른 품목의 천일품번과 우연히 같으면 틀린 단가가 붙어 뺐습니다) */
  function lookup(t, r) {
    if (!has(t)) return null;
    return t.map[buyKey(r)] || null;
  }
  function amount(qty, price) { return price == null ? null : round2(qty * price); }

  /* 통합 수주 행(매핑을 거친 것)에 매입단가 붙이기. rows 는 바꾸지 않고 새 행을 돌려줍니다.
     table = parseBook 결과(없으면 null), manual = { buyKey: 매입단가 }
     행에 더하는 것:
       판매(참고) — price · priceSrc 는 그대로(원본 파일 단가), saleAmount = 수량 × 판매단가
       매입      — buyPrice · buySrc(단가표·직접입력·'') · maker(생산처) · buyAmount = 수량 × 매입단가
       차이      — margin = 판매단가 − 매입단가, marginAmount = 수량 × 차이 (둘 다 있을 때만)
     반환 { rows, missing:[품목코드마다 {key, item, customerItem, customers, group, rows, qty, files, name}], stats, fxMissing, fxUsed } */
  /* opts(기획서 11.15 환율, 없으면 모두 원화로 봄):
       defaultCur — 통화가 적히지 않은 매입단가의 통화(매입단가표 · 직접입력 공통, 기본 'KRW')
       manualCur  — { buyKey: 통화 } 직접 적은 매입단가의 통화(없으면 defaultCur)
       fx         — { resolver: SPFx.resolver(...), mode: 'prev'|'same' } — 외화를 원화로 바꿀 때 씀
       product    — SPProduct.parseBook 결과(완제품정보, 기획서 11.16). 매입단가표에 없는 품번의 발주단가 · 통화 · 생산처,
                    모든 줄에 고객사(productCustomer) · 특이사항(productNote) · 단종/생산금지(productStop) · 조립처
       productFallback — true 면 월평균 환율이 없을 때 완제품정보의 「발주단가(원화)」(파일의 고정 환율 값)를 씀(기본 false — 확인 부탁) */
  function apply(rows, table, manual, opts) {
    manual = manual || {}; opts = opts || {};
    var defCur = opts.defaultCur && opts.defaultCur !== 'KRW' ? opts.defaultCur : '';
    var manCur = opts.manualCur || {}, fxo = opts.fx || {};
    var fxMiss = {}, fxUsed = {};
    function conv(price, cur, r) {
      var c = Fx ? Fx.convert(price, cur, r.due, fxo.resolver, fxo.mode) : { missing: true, reason: '환율 계산기 없음', cur: cur, month: '', orig: price };
      if (c.missing) { var mk = c.cur + '|' + c.month + '|' + c.reason, m = fxMiss[mk] || (fxMiss[mk] = { cur: c.cur, month: c.month, reason: c.reason, rows: 0 }); m.rows++; }
      else { var uk = c.cur + '|' + c.month; fxUsed[uk] = (fxUsed[uk] || 0) + 1; }
      return c;
    }
    var stats = {
      total: rows.length, buyHas: 0, buyNone: 0, buyBySrc: {}, buyNoneItems: 0, buyAmount: 0,
      saleHas: 0, saleNone: 0, saleBySrc: {}, saleAmount: 0,
      both: 0, marginAmount: 0, negative: 0, negativeItems: 0,
      tableLoaded: has(table), manualCount: 0, manualShadowed: 0, bySource: {},
      buyMultiRows: 0, buyMultiItems: 0,
      buyFx: 0, buyFxNone: 0, saleFx: 0, saleFxNone: 0,  // 외화 단가를 원화로 바꾼 행 · 환율이 없어 금액에서 뺀 행
      productLoaded: false, productRows: 0, productStopRows: 0, productStopItems: 0, buyFileFallback: 0,
      fileKrwRows: 0, fileKrwAmount: 0, fxKrwAmount: 0   // 완제품정보 발주단가로 원화를 낸 줄: 파일 원화(고정 환율) 금액 vs 월평균 금액
    };
    var prod = opts.product && opts.product.map && Object.keys(opts.product.map).length ? opts.product : null;
    stats.productLoaded = !!prod;
    var stopItems = {};
    BUY_ORDER.forEach(function (s) { stats.buyBySrc[s] = 0; });
    SALE_ORDER.forEach(function (s) { stats.saleBySrc[s] = 0; });
    var miss = {}, neg = {}, multi = {};
    var out = rows.map(function (r) {
      var x = Object.assign({}, r), k = buyKey(r);
      // 완제품정보(기획서 11.16): 고객사 · 특이사항 · 조립처 · 단종/생산금지
      var pe = prod ? prod.map[k] || null : null;
      if (pe) {
        stats.productRows++;
        x.productCustomer = pe.customer || ''; x.productNote = pe.note || ''; x.assembler = pe.assembler || ''; x.productStop = !!pe.stop;
        if (pe.stop) { stats.productStopRows++; stopItems[k] = 1; }
      }
      // 판매단가(고객 발주, 참고) — 통화 칸이 원화가 아니면 원화로 바꿈(원래 값은 priceOrig · priceCur)
      var sc = Fx && x.price != null ? Fx.normCurrency(x.currency) : '';
      if (sc !== '' && sc !== 'KRW') {
        var sv = conv(x.price, sc, r);
        x.priceOrig = x.price; x.priceCur = sc === null ? str(x.currency) : sc;
        if (sv.missing) { x.price = null; x.saleFxMissing = sv; stats.saleFxNone++; }
        else { x.price = sv.krw; x.saleFx = sv; stats.saleFx++; }
      }
      x.saleAmount = amount(x.qty, x.price);
      var bs = stats.bySource[x.source] || (stats.bySource[x.source] = { sale: 0, saleNone: 0, buy: 0, buyNone: 0 });
      if (x.price == null) { if (!x.saleFxMissing) stats.saleNone++; bs.saleNone++; }
      else { stats.saleHas++; bs.sale++; stats.saleBySrc[x.priceSrc || SALE_SRC.source] = (stats.saleBySrc[x.priceSrc || SALE_SRC.source] || 0) + 1; stats.saleAmount += x.saleAmount; }
      // 매입단가(생산처 발주): 단가표 → 직접입력
      var t = lookup(table, r), m = num(manual[k]), bc = '';
      x.buyMulti = false;
      if (t) {
        x.buyPrice = t.price; x.buySrc = BUY_SRC.table; x.maker = t.maker || ''; bc = t.cur || defCur;
        if (table.conflicts && table.conflicts[k]) { x.buyMulti = true; stats.buyMultiRows++; multi[k] = 1; }   // 단가가 여럿 → 위쪽 값(확정)
      }
      else if (pe && pe.buy && pe.cur !== '?') {   // 완제품정보 발주단가 — 통화 칸(또는 원화 칸으로 추정한 위안), 없으면 기본 통화
        x.buyPrice = pe.buy; x.buySrc = BUY_SRC.product; x.maker = pe.maker || ''; bc = pe.cur || defCur;
        if (pe.buyKrw && bc && bc !== 'KRW') x.buyKrwFile = pe.buyKrw;
      }
      else if (m != null && m > 0) { x.buyPrice = m; x.buySrc = BUY_SRC.manual; x.maker = ''; bc = manCur[k] || defCur; }
      else { x.buyPrice = null; x.buySrc = ''; x.maker = ''; }
      if (bc === 'KRW') bc = '';
      if (x.buyPrice != null && bc) {   // 외화 매입단가 → 원화
        var bv = conv(x.buyPrice, bc, r);
        x.buyPriceOrig = x.buyPrice; x.buyCur = bc;
        if (bv.missing && opts.productFallback && x.buyKrwFile) {   // 월평균이 없으면 완제품정보의 원화 칸(고정 환율)
          x.buyPrice = x.buyKrwFile; stats.buyFileFallback++;
          x.buyFx = { cur: bc, orig: x.buyPriceOrig, raw: pe.implied, unit: 1, rate: pe.implied, month: '', src: '완제품정보 원화 칸(고정 환율)', krw: x.buyKrwFile, fallback: true };
          fxMiss[bv.cur + '|' + bv.month + '|' + bv.reason].rows--;
          if (!fxMiss[bv.cur + '|' + bv.month + '|' + bv.reason].rows) delete fxMiss[bv.cur + '|' + bv.month + '|' + bv.reason];
        }
        else if (bv.missing) { x.buyPrice = null; x.buyFxMissing = bv; }
        else { x.buyPrice = bv.krw; x.buyFx = bv; stats.buyFx++; }
        if (x.buyKrwFile && x.buyFx && !x.buyFx.fallback) { stats.fileKrwRows++; stats.fileKrwAmount += x.qty * x.buyKrwFile; stats.fxKrwAmount += x.qty * x.buyPrice; }
      }
      x.buyAmount = amount(x.qty, x.buyPrice);
      if (x.buyFxMissing) { stats.buyFxNone++; }
      else if (x.buyPrice == null) {
        stats.buyNone++; bs.buyNone++;
        var e = miss[k] || (miss[k] = { key: k, item: r.company || r.item, customerItem: r.customerItem || r.item, customers: [], group: r.group, rows: 0, qty: 0, files: [], name: r.name || '' });
        e.rows++; e.qty += r.qty || 0;
        if (e.files.indexOf(r.source) < 0) e.files.push(r.source);
        if (r.customer && e.customers.indexOf(r.customer) < 0) e.customers.push(r.customer);
      } else {
        stats.buyHas++; bs.buy++; stats.buyBySrc[x.buySrc]++;
        stats.buyAmount += x.buyAmount;
      }
      // 판매 − 매입
      if (x.price != null && x.buyPrice != null) {
        x.margin = round2(x.price - x.buyPrice); x.marginAmount = round2(x.qty * x.margin);
        stats.both++; stats.marginAmount += x.marginAmount;
        if (x.margin < 0) { stats.negative++; neg[k] = 1; }
      } else { x.margin = null; x.marginAmount = null; }
      return x;
    });
    ['buyAmount', 'saleAmount', 'marginAmount', 'fileKrwAmount', 'fxKrwAmount'].forEach(function (f) { stats[f] = round2(stats[f]); });
    stats.productStopItems = Object.keys(stopItems).length;
    stats.negativeItems = Object.keys(neg).length;
    stats.buyMultiItems = Object.keys(multi).length;
    Object.keys(manual).forEach(function (k) {
      if (!(num(manual[k]) > 0)) return;
      stats.manualCount++;
      if (has(table) && table.map[k]) stats.manualShadowed++;   // 단가표에 생겨 직접입력을 쓰지 않는 것
    });
    var missing = Object.keys(miss).map(function (k) { return miss[k]; }).sort(function (a, b) { return b.qty - a.qty || a.item.localeCompare(b.item); });
    stats.buyNoneItems = missing.length;
    var fxMissing = Object.keys(fxMiss).sort().map(function (k) { return fxMiss[k]; });
    return { rows: out, missing: missing, stats: stats, fxMissing: fxMissing, fxUsed: fxUsed };
  }
  /** 원본(고객 발주) 판매단가끼리 서로 다른 품번 수 — 같은 고객사·같은 품번에 판매단가가 두 가지 이상 */
  function sourceDisagreements(rows) {
    var m = {};
    rows.forEach(function (r) {
      if (r.price == null || (r.priceSrc && r.priceSrc !== SALE_SRC.source)) return;
      var k = str(r.customer) + '|' + key(r.customerItem || r.item), x = m[k] || (m[k] = []);
      if (x.indexOf(r.price) < 0) x.push(r.price);
    });
    return Object.keys(m).filter(function (k) { return m[k].length > 1; }).length;
  }
  /** 매입단가표에서 단가·생산처가 둘 이상인 품목 목록(쓴 값 = 가장 위쪽 행).
      rows(apply 결과 행)를 주면 이번 수주에 나오는 품목만, 행 수와 함께. 품목코드 순 */
  function multiList(t, rows) {
    if (!t || !t.conflicts) return [];
    var cnt = null;
    if (rows) { cnt = {}; rows.forEach(function (r) { if (r.buyMulti) { var k = buyKey(r); cnt[k] = (cnt[k] || 0) + 1; } }); }
    return Object.keys(t.conflicts).filter(function (k) { return !cnt || cnt[k]; }).sort().map(function (k) {
      var list = t.conflicts[k], top = t.map[k] || list[0];
      return {
        key: k, price: top.price, maker: top.maker || '', row: top.row, rows: cnt ? cnt[k] : '',
        others: list.filter(function (x) { return x.row !== top.row; }).map(function (x) { return x.price + (x.maker ? ' · ' + x.maker : '') + ' · ' + x.row + '행'; }).join(' / ')
      };
    });
  }
  /** 「매입단가 없음」 목록 → Excel 시트 */
  function missingAoa(missing) {
    return [['품목코드', '고객사 품번', '품목명', '고객사', '구분', '행 수', '수량 합계', '원본파일']].concat(missing.map(function (m) {
      return [m.item, m.customerItem !== m.item ? m.customerItem : '', m.name || '', m.customers.join(', '), m.group || '', m.rows, m.qty, m.files.join(', ')];
    }));
  }
  /** 매입단가표 채우기 양식: 매입단가 없는 품목을 「품목코드 | 품목명 | 생산처 | 매입단가」 빈칸으로 — 채워서 다시 넣으면 그대로 읽힙니다 */
  function templateAoa(missing) {
    return [['품목코드', '품목명', '생산처', '매입단가']].concat(missing.map(function (m) { return [m.item, m.name || '', '', '']; }));
  }

  return {
    SALE_SRC: SALE_SRC, SALE_ORDER: SALE_ORDER, BUY_SRC: BUY_SRC, BUY_ORDER: BUY_ORDER,
    key: key, num: num, findCols: findCols, parseBook: parseBook, has: has, lookup: lookup, buyKey: buyKey,
    amount: amount, apply: apply, multiList: multiList, sourceDisagreements: sourceDisagreements, missingAoa: missingAoa, templateAoa: templateAoa
  };
});
