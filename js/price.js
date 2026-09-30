/* 발주단가 — 단가표(품목코드 → 단가)·직접입력으로 원본에 단가가 없는 줄을 채우는 순수 로직 (기획서 11.11, 2026-09-30 요청 「발주단가도 기재가 필요하다」)
   통합 수주 행의 단가는 이 순서로 정합니다.
     1. 원본            — 그 줄의 원본 파일 단가 칸(포털 발주단가, 밥캣 발주단가, 발주서 단가·발주단가, PDF 단가)
     2. 원본(같은 품번) — 단가 칸이 없는 줄(누적결품 등)에 같은 고객사·같은 품번의 다른 파일 단가(값이 하나일 때만, intake.js)
     3. 직접입력        — 화면의 「단가 없음」 목록에 사용자가 적은 값
     4. 단가표          — 사용자가 넣은 단가표 파일(품목코드 | 단가, 고객사 열은 선택)
   그래도 없으면 비워 두고 「단가 없음」으로 셉니다. 금액 = 수량 × 단가.
   단가표·직접입력 값은 실제 회사 자료라 이 브라우저(localStorage)에만 저장합니다(리포에는 가상 예시만).
   브라우저(window.SPPrice)와 node(require) 양쪽에서 씁니다. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SPPrice = api;
})(typeof window !== 'undefined' ? window : this, function () {
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

  var SRC = { source: '원본', borrowed: '원본(같은 품번)', manual: '직접입력', table: '단가표' };
  var SRC_ORDER = [SRC.source, SRC.borrowed, SRC.manual, SRC.table];

  // 단가표 열 이름 후보 — 「고객사」는 매핑표에서 고객사 품번 열 이름이라, 품목코드 후보가 따로 있을 때만 고객사 이름 열로 봅니다
  var CODE_COL = ['품목코드', '품번', '천일품번', '당사품번', '고객사품번', '고객사 품번', '자재코드', '품목번호', 'item', 'itemcode', 'partno', 'part no', 'pn'];
  var PRICE_COL = ['단가', '발주단가', '판매단가', '구매단가', '계약단가', 'unitprice', 'unit price', 'price'];
  var CUST_COL = ['고객사', '고객사명', '거래처', '거래처명', 'customer'];
  function findCols(aoa) {
    for (var r = 0; r < Math.min(aoa.length, 10); r++) {
      var hs = (aoa[r] || []).map(norm);
      var ci = -1, pi = -1, ki = -1;
      CODE_COL.map(norm).some(function (c) { ci = hs.indexOf(c); return ci >= 0; });
      PRICE_COL.map(norm).some(function (c) { pi = hs.indexOf(c); return pi >= 0; });
      CUST_COL.map(norm).some(function (c) { ki = hs.indexOf(c); return ki >= 0 && ki !== ci; });
      if (ci >= 0 && pi >= 0) return { hr: r, code: ci, price: pi, customer: ki !== ci ? ki : -1 };
    }
    return null;
  }

  /* 단가표 읽기. book = { names, sheets:{시트: aoa} }
     반환 { map:{품번열쇠: 단가}, byCustomer:{고객사|품번열쇠: 단가}, stats:{rows, pairs, blank, bad, dupSame, conflicts}, conflicts:{열쇠:[값…]}, problems:[] }
     같은 품번이 여러 번이면 위쪽 행 값을 쓰고, 값이 다르면 「단가 충돌」로 셉니다 */
  function parseBook(book) {
    var out = { map: {}, byCustomer: {}, conflicts: {}, stats: { rows: 0, pairs: 0, blank: 0, bad: 0, dupSame: 0, conflicts: 0 }, problems: [], sheets: [] };
    var names = (book && book.names) || [];
    names.forEach(function (nm) {
      var aoa = book.sheets[nm] || [];
      if (!aoa.some(function (r) { return (r || []).some(function (c) { return str(c) !== ''; }); })) return;
      var c = findCols(aoa);
      if (!c) { out.problems.push('시트「' + nm + '」: 「품목코드(품번)」「단가」 머리를 찾지 못해 건너뛰었습니다'); return; }
      out.sheets.push(nm);
      for (var r = c.hr + 1; r < aoa.length; r++) {
        var ln = aoa[r] || [];
        var k = key(ln[c.code]);
        if (!k && str(ln[c.price]) === '') continue;
        out.stats.rows++;
        var p = num(ln[c.price]);
        if (!k || str(ln[c.price]) === '') { out.stats.blank++; continue; }
        if (p === null || p <= 0) { out.stats.bad++; continue; }
        var cust = c.customer >= 0 ? str(ln[c.customer]) : '';
        var tgt = cust ? out.byCustomer : out.map, tk = cust ? cust + '|' + k : k;
        if (tgt[tk] === undefined) { tgt[tk] = p; out.stats.pairs++; continue; }
        if (tgt[tk] === p) { out.stats.dupSame++; continue; }
        var list = out.conflicts[tk] || (out.conflicts[tk] = [tgt[tk]]);
        if (list.indexOf(p) < 0) list.push(p);
      }
    });
    out.stats.conflicts = Object.keys(out.conflicts).length;
    if (!out.sheets.length && !out.problems.length) out.problems.push('단가표에서 읽은 행이 없습니다');
    return out;
  }
  function has(t) { return !!(t && ((t.map && Object.keys(t.map).length) || (t.byCustomer && Object.keys(t.byCustomer).length))); }
  /** 단가표에서 한 줄의 단가: 고객사+고객사 품번 → 고객사+천일품번 → 고객사 품번 → 천일품번 */
  function lookup(t, r) {
    if (!has(t)) return null;
    var cands = [], c = str(r.customer), a = key(r.customerItem || r.item), b = key(r.company || '');
    if (c) { cands.push(t.byCustomer[c + '|' + a]); if (b) cands.push(t.byCustomer[c + '|' + b]); }
    cands.push(t.map[a]); if (b) cands.push(t.map[b]);
    for (var i = 0; i < cands.length; i++) if (cands[i] !== undefined && cands[i] !== null) return cands[i];
    return null;
  }
  /** 직접입력 열쇠 = 고객사 | 고객사 품번 */
  function manualKey(r) { return str(r.customer) + '|' + key(r.customerItem || r.item); }
  function amount(qty, price) { return price == null ? null : Math.round(qty * price * 100) / 100; }

  /* 통합 수주 행(매핑을 거친 것)에 단가 붙이기. rows 는 바꾸지 않고 새 행을 돌려줍니다.
     table = parseBook 결과(없으면 null), manual = { manualKey: 단가 }
     행: price(단가 또는 null) · priceSrc(원본·원본(같은 품번)·직접입력·단가표) · amount(수량 × 단가)
     반환 { rows, missing:[품번마다 {key, customer, item, company, rows, qty, files}], stats } */
  function apply(rows, table, manual) {
    manual = manual || {};
    var stats = { total: rows.length, has: 0, none: 0, bySrc: {}, noneItems: 0, amount: 0, tableDiff: 0, tableLoaded: has(table), manualCount: 0, bySource: {} };
    SRC_ORDER.forEach(function (s) { stats.bySrc[s] = 0; });
    var miss = {}, diff = {};
    var out = rows.map(function (r) {
      var x = Object.assign({}, r);
      var t = lookup(table, r);
      if (x.price != null) {
        x.priceSrc = x.priceSrc || SRC.source;
        if (t != null && t !== x.price) diff[manualKey(r)] = 1;   // 원본이 우선, 단가표와 다르면 셉니다
      } else {
        var m = manual[manualKey(r)];
        if (m != null && m !== '' && num(m) > 0) { x.price = num(m); x.priceSrc = SRC.manual; }
        else if (t != null) { x.price = t; x.priceSrc = SRC.table; }
        else x.priceSrc = '';
      }
      x.amount = amount(x.qty, x.price);
      var bs = stats.bySource[x.source] || (stats.bySource[x.source] = { has: 0, none: 0 });
      if (x.price == null) {
        stats.none++; bs.none++;
        var k = manualKey(r);
        var e = miss[k] || (miss[k] = { key: k, customer: r.customer, item: r.customerItem || r.item, company: r.company || r.item, group: r.group, rows: 0, qty: 0, files: [], note: '' });
        e.rows++; e.qty += r.qty || 0;
        if (e.files.indexOf(r.source) < 0) e.files.push(r.source);
        if (r.priceNote && !e.note) e.note = r.priceNote;
      } else {
        stats.has++; bs.has++; stats.bySrc[x.priceSrc]++;
        stats.amount += x.amount;
      }
      return x;
    });
    stats.amount = Math.round(stats.amount * 100) / 100;
    stats.tableDiff = Object.keys(diff).length;
    stats.manualCount = Object.keys(manual).filter(function (k) { return num(manual[k]) > 0; }).length;
    var missing = Object.keys(miss).map(function (k) { return miss[k]; }).sort(function (a, b) { return b.qty - a.qty || a.item.localeCompare(b.item); });
    stats.noneItems = missing.length;
    return { rows: out, missing: missing, stats: stats };
  }
  /** 원본 단가끼리 서로 다른 품번 수(같은 고객사·같은 품번에 단가가 두 가지 이상) — 「어느 단가를 쓸지」 확인용 */
  function sourceDisagreements(rows) {
    var m = {};
    rows.forEach(function (r) {
      if (r.price == null || (r.priceSrc && r.priceSrc !== SRC.source)) return;
      var k = manualKey(r), x = m[k] || (m[k] = []);
      if (x.indexOf(r.price) < 0) x.push(r.price);
    });
    return Object.keys(m).filter(function (k) { return m[k].length > 1; }).length;
  }
  /** 「단가 없음」 목록 → Excel 시트 */
  function missingAoa(missing) {
    return [['고객사', '고객사 품번', '천일품번', '구분', '행 수', '수량 합계', '원본파일', '메모']].concat(missing.map(function (m) {
      return [m.customer, m.item, m.company, m.group || '', m.rows, m.qty, m.files.join(', '), m.note || ''];
    }));
  }

  return {
    SRC: SRC, SRC_ORDER: SRC_ORDER, key: key, num: num, findCols: findCols, parseBook: parseBook, has: has, lookup: lookup,
    manualKey: manualKey, amount: amount, apply: apply, sourceDisagreements: sourceDisagreements, missingAoa: missingAoa
  };
});
