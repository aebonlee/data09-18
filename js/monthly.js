/* 월별 수주 vs 매입 — 순수 로직 (기획서 11.13, 2026-09-30 세 번째 답변의 새 요청)
   요청 원문: 「고객사발주(수주)와 매입금액 비교까지 가능하면 좋겠습니다. 월별 집계표 — 수주 VS 매입」
     수주금액 = 수량 × 판매단가(고객 발주 파일의 단가 — 통합 수주 행의 price)
     매입금액 = 수량 × 매입단가(당사 → 생산처 발주단가 — 매입단가표·직접입력, 행의 buyPrice)
   한쪽 단가가 없는 줄은 그쪽 합계에 들어가지 않습니다. 합계가 조용히 작아지지 않도록 쪽마다 「단가 없음」 행 수·수량을 함께 셉니다.
   차액·차익률은 두 단가가 모두 있는 줄끼리만 비교합니다(한쪽만 있는 줄을 섞으면 차액이 부풀거나 줄어들기 때문).
     차액   = (둘 다 있는 줄의) 수주금액 − 매입금액
     차익률 = 차액 ÷ (둘 다 있는 줄의) 수주금액 × 100
   월 기준은 납기월(기본) 또는 발주월. 날짜가 없는 줄은 「(납기일 없음)」「(발주일 없음)」 한 칸에 모읍니다.
   입력 행은 SPPrice.apply 를 거친 통합 수주 행(price · buyPrice · qty · due · orderDate · customer · group · company · item · name).
   브라우저(window.SPMonthly)와 node(require) 양쪽에서 씁니다. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SPMonthly = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function str(v) { return v == null ? '' : String(v).trim(); }
  function round2(x) { return Math.round(x * 100) / 100; }
  function round1(x) { return Math.round(x * 10) / 10; }

  var BY = { due: '납기월', order: '발주월' };
  var NO_DATE = { due: '(납기일 없음)', order: '(발주일 없음)' };
  var DEFAULT_TOP = 20;

  function options(o) {
    o = o || {};
    var top = parseInt(o.topN, 10);
    return { by: o.by === 'order' ? 'order' : 'due', topN: top > 0 ? Math.min(top, 500) : DEFAULT_TOP };
  }
  /** 행의 월 열쇠 'YYYY-MM' — 날짜가 없거나 이상하면 '' */
  function monthOf(r, by) {
    var d = str(by === 'order' ? r.orderDate : r.due);
    return /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : '';
  }
  function monthLabel(m, by) { return m || NO_DATE[by === 'order' ? 'order' : 'due']; }

  function newAgg() {
    return { rows: 0, qty: 0, sale: 0, saleRows: 0, saleNone: 0, saleNoneQty: 0, buy: 0, buyRows: 0, buyNone: 0, buyNoneQty: 0, bothRows: 0, bothSale: 0, bothBuy: 0 };
  }
  function add(a, r) {
    var q = Number(r.qty) || 0;
    a.rows++; a.qty += q;
    var hasSale = r.price != null && r.price !== '', hasBuy = r.buyPrice != null && r.buyPrice !== '';
    var s = hasSale ? q * Number(r.price) : 0, b = hasBuy ? q * Number(r.buyPrice) : 0;
    if (hasSale) { a.sale += s; a.saleRows++; } else { a.saleNone++; a.saleNoneQty += q; }
    if (hasBuy) { a.buy += b; a.buyRows++; } else { a.buyNone++; a.buyNoneQty += q; }
    if (hasSale && hasBuy) { a.bothRows++; a.bothSale += s; a.bothBuy += b; }
  }
  /** 합계를 둥글리고 차액·차익률을 붙입니다 */
  function finish(a) {
    ['sale', 'buy', 'bothSale', 'bothBuy'].forEach(function (k) { a[k] = round2(a[k]); });
    a.diff = a.bothRows ? round2(a.bothSale - a.bothBuy) : null;
    a.rate = a.bothRows && a.bothSale > 0 ? round1(a.diff / a.bothSale * 100) : null;
    return a;
  }
  function groupKey(r) { return [str(r.customer) || '(고객사 없음)', str(r.group) || '(구분 없음)'].join(' · '); }
  function itemKey(r) { return str(r.company || r.item).replace(/\s+/g, '').toUpperCase(); }
  /** 금액 순서: 수주금액 큰 순 → 매입금액 큰 순 → 이름 */
  function byAmount(a, b) { return b.sale - a.sale || b.buy - a.buy || String(a.key).localeCompare(String(b.key)); }

  /* 집계.
     반환 { by, byLabel, topN, months:[{month, label, …합계, groups:[…], items:[…], itemCount}], total:{…합계, groups, items, itemCount} }
     groups = 고객사 · 구분마다(수주금액 큰 순), items = 품목(천일품번, 매핑 없으면 고객사 품번)마다 상위 topN + 나머지 한 줄 */
  function summarize(rows, opts) {
    var o = options(opts);
    var months = {}, total = newAgg();
    total.g = {}; total.i = {};
    (rows || []).forEach(function (r) {
      var m = monthOf(r, o.by);
      var M = months[m];
      if (!M) { M = months[m] = newAgg(); M.month = m; M.label = monthLabel(m, o.by); M.g = {}; M.i = {}; }
      add(M, r); add(total, r);
      [M, total].forEach(function (T) {
        var gk = groupKey(r), g = T.g[gk];
        if (!g) { g = T.g[gk] = newAgg(); g.key = gk; g.customer = str(r.customer); g.group = str(r.group); }
        add(g, r);
        var ik = itemKey(r), it = T.i[ik];
        if (!it) { it = T.i[ik] = newAgg(); it.key = ik; it.item = str(r.company || r.item); it.customerItem = str(r.customerItem || r.item); it.name = str(r.name); it.customers = []; }
        if (!it.name && r.name) it.name = str(r.name);
        if (r.customer && it.customers.indexOf(r.customer) < 0) it.customers.push(r.customer);
        add(it, r);
      });
    });
    function close(T) {
      var groups = Object.keys(T.g).map(function (k) { return finish(T.g[k]); }).sort(byAmount);
      var items = Object.keys(T.i).map(function (k) { return finish(T.i[k]); }).sort(byAmount);
      T.itemCount = items.length;
      var top = items.slice(0, o.topN), rest = items.slice(o.topN);
      if (rest.length) {
        var e = newAgg(); e.key = ''; e.item = '그 밖 ' + rest.length + '품목'; e.customerItem = ''; e.name = ''; e.customers = []; e.rest = rest.length;
        ['rows', 'qty', 'sale', 'saleRows', 'saleNone', 'saleNoneQty', 'buy', 'buyRows', 'buyNone', 'buyNoneQty', 'bothRows', 'bothSale', 'bothBuy'].forEach(function (k) {
          rest.forEach(function (x) { e[k] += x[k]; });
        });
        top.push(finish(e));
      }
      delete T.g; delete T.i;
      T.groups = groups; T.items = top;
      return finish(T);
    }
    var list = Object.keys(months).sort(function (a, b) { return a === '' ? 1 : b === '' ? -1 : a.localeCompare(b); }).map(function (k) { return close(months[k]); });
    return { by: o.by, byLabel: BY[o.by], topN: o.topN, months: list, total: close(total) };
  }

  var NOTE = '차액·차익률은 판매단가(수주)와 매입단가가 둘 다 있는 줄끼리 계산합니다. 한쪽 단가가 없는 줄은 그쪽 금액 합계에 들어가지 않으니 「단가 없음」 행 수를 함께 보세요.';
  var HEAD = ['행 수', '수량', '수주금액', '수주단가 없음(행)', '매입금액', '매입단가 없음(행)', '비교한 행(둘 다 있음)', '차액(둘 다 있는 줄)', '차익률(%)'];
  function cells(a) { return [a.rows, a.qty, a.sale, a.saleNone, a.buy, a.buyNone, a.bothRows, a.diff == null ? '' : a.diff, a.rate == null ? '' : a.rate]; }

  /** Excel 시트 「월별 수주 vs 매입」 — 월별 표 · 고객사·구분별 · 품목별(월마다 상위 N) 세 덩어리를 위에서 아래로 */
  function aoa(sum) {
    var out = [];
    out.push(['월별 수주 vs 매입 — 기준: ' + sum.byLabel]);
    out.push([NOTE]);
    out.push([]);
    out.push([sum.byLabel].concat(HEAD));
    sum.months.forEach(function (m) { out.push([m.label].concat(cells(m))); });
    out.push(['합계'].concat(cells(sum.total)));
    out.push([]);
    out.push(['고객사 · 구분별']);
    out.push([sum.byLabel, '고객사', '구분'].concat(HEAD));
    sum.months.concat([Object.assign({ label: '전체' }, sum.total)]).forEach(function (m) {
      m.groups.forEach(function (g) { out.push([m.label, g.customer, g.group].concat(cells(g))); });
    });
    out.push([]);
    out.push(['품목별 — ' + sum.byLabel + '마다 수주금액 상위 ' + sum.topN + '품목(나머지는 한 줄로)']);
    out.push([sum.byLabel, '품목코드(천일품번)', '고객사 품번', '품목명', '고객사'].concat(HEAD));
    sum.months.concat([Object.assign({ label: '전체' }, sum.total)]).forEach(function (m) {
      m.items.forEach(function (it) { out.push([m.label, it.item, it.customerItem !== it.item ? it.customerItem : '', it.name, it.customers.join(', ')].concat(cells(it))); });
    });
    return out;
  }

  return { BY: BY, NO_DATE: NO_DATE, DEFAULT_TOP: DEFAULT_TOP, NOTE: NOTE, SHEET: '월별 수주 vs 매입', options: options, monthOf: monthOf, summarize: summarize, aoa: aoa };
});
