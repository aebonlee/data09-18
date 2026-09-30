/* 완제품정보 — 순수 로직 (기획서 11.16, 2026-09-30 요청 「메뉴에 완제품정보를 추가해서 부탁드립니다」)
   회사의 완제품정보 파일(천일 품번 · 특이사항 · 조립처 · 회로수 · 고객사 · 판매단가 · 통화 · 발주단가 · 발주단가(원화) · 생산처)을
   천일품번 마스터로 읽습니다. 머리행은 맨 위가 아니어도 되고(받은 파일은 3행 · B열부터), 값 0 은 빈칸으로 봅니다.
   쓰는 곳
     1. 메뉴 「완제품정보」 — 찾기 · 거르기 · 개수
     2. 매입단가 — 매입단가표에 없는 품번은 완제품정보의 발주단가 · 통화 · 생산처로 찾습니다(순서: 매입단가표 > 완제품정보 > 직접입력, price.js)
     3. 수주 결과 — 특이사항에 「단종」「생산금지」가 있는 품번 표시, 고객사가 없는 줄의 고객사
   통화: 「통화」 칸(China(RMB) 등)을 읽고, 칸이 비었는데 「발주단가(원화)」가 발주단가와 다르면(원화 ÷ 발주단가 ≠ 1) 위안으로 봅니다.
         받은 파일은 발주단가(원화) = 발주단가 × 230 이라(고정 환율로 보임) 줄마다 이 비율(implied)을 따로 남겨 월평균 환산과 나란히 보입니다.
   브라우저(window.SPProduct)와 node(require) 양쪽에서 씁니다. */
(function (root, factory) {
  var Fx = typeof module === 'object' && module.exports ? require('./fx.js') : root.SPFx;
  var api = factory(Fx);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SPProduct = api;
})(typeof window !== 'undefined' ? window : this, function (Fx) {
  'use strict';

  function str(v) { return v == null ? '' : String(v).trim(); }
  function norm(v) { return str(v).toLowerCase().replace(/[\s_()\-·.:：（）]/g, ''); }
  function key(v) { return str(v).replace(/\s+/g, '').toUpperCase(); }
  /** 값 0 · '0' · 빈칸 → '' */
  function cell(v) { var s = str(v); return s === '' || s === '0' || v === 0 ? '' : s; }
  function num(v) {
    if (v == null || v === '' || v === 0) return null;
    if (typeof v === 'number') return isFinite(v) && v > 0 ? v : null;
    var s = String(v).replace(/[,\s₩원]/g, '');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    var n = Number(s);
    return n > 0 ? n : null;
  }
  function round4(x) { return Math.round(x * 10000) / 10000; }

  // 열 이름 후보(앞쪽 우선). F = 머리행에서 찾을 칸
  var F = {
    code: ['천일품번', '천일 품번', '당사품번', '품목코드', '품번'],
    note: ['특이사항', '비고', '메모'],
    assembler: ['조립처', '조립'],
    circuits: ['회로수', '회로 수'],
    customer: ['고객사', '고객사명', '고객'],
    sale: ['판매단가'],
    cur: ['통화', '화폐', '통화코드'],
    buy: ['발주단가', '매입단가', '구매단가'],
    buyKrw: ['발주단가(원화)', '발주단가 원화', '원화발주단가', '발주단가(krw)', '원화단가'],
    maker: ['생산처', '생산처명', '매입처']
  };
  var FIELDS = ['code', 'note', 'assembler', 'circuits', 'customer', 'sale', 'cur', 'buy', 'buyKrw', 'maker'];
  var LABEL = { code: '천일품번', note: '특이사항', assembler: '조립처', circuits: '회로수', customer: '고객사', sale: '판매단가', cur: '통화', buy: '발주단가', buyKrw: '발주단가(원화)', maker: '생산처' };
  var STOP_RE = /단종|생산\s*금지/;

  function findHeader(aoa) {
    for (var r = 0; r < Math.min(aoa.length, 20); r++) {
      var hs = (aoa[r] || []).map(norm), c = {}, found = 0;
      FIELDS.forEach(function (f) {
        c[f] = -1;
        F[f].map(norm).some(function (x) { var i = hs.indexOf(x); if (i >= 0 && Object.keys(c).every(function (g) { return c[g] !== i; })) { c[f] = i; return true; } return false; });
        if (c[f] >= 0) found++;
      });
      if (c.code >= 0 && found >= 3) { c.hr = r; return c; }
    }
    return null;
  }

  /* book = { names, sheets:{시트: aoa} } → 마스터
     반환 { list:[{key, code, note, assembler, circuits, customer, sale, cur, curSrc, buy, buyKrw, implied, maker, stop, row, sheet}], map:{key: 첫 줄}, stats, problems, sheet, cols } */
  function parseBook(book) {
    var out = { list: [], map: {}, problems: [], sheet: '', cols: [],
      stats: { rows: 0, items: 0, dup: 0, dupDiff: 0, withBuy: 0, withKrw: 0, byCur: {}, curFromKrw: 0, curBlankWithBuy: 0, implied: {}, withCustomer: 0, withSale: 0, stop: 0, customers: 0, makers: 0, assemblers: 0, badCur: 0 } };
    var names = (book && book.names) || [];
    var hit = null, aoa = null;
    names.some(function (nm) { var a = book.sheets[nm] || [], c = findHeader(a); if (c) { hit = c; aoa = a; out.sheet = nm; return true; } return false; });
    if (!hit) { out.problems.push('「천일 품번」과 「발주단가」「고객사」「생산처」 같은 머리를 찾지 못했습니다(맨 위 20행 안)'); return out; }
    out.cols = FIELDS.filter(function (f) { return hit[f] >= 0; }).map(function (f) { return LABEL[f]; });
    var cust = {}, mk = {}, asm = {};
    for (var r = hit.hr + 1; r < aoa.length; r++) {
      var ln = aoa[r] || [];
      var code = cell(ln[hit.code]);
      if (!code) { if (ln.some(function (v) { return cell(v) !== ''; })) out.stats.rows++; continue; }
      out.stats.rows++;
      var g = function (f) { return hit[f] >= 0 ? ln[hit[f]] : ''; };
      var e = { key: key(code), code: code, note: cell(g('note')), assembler: cell(g('assembler')), circuits: cell(g('circuits')), customer: cell(g('customer')),
        sale: num(g('sale')), cur: '', curSrc: '', buy: num(g('buy')), buyKrw: num(g('buyKrw')), implied: null, maker: cell(g('maker')), stop: false, row: r + 1 };
      var rawCur = cell(g('cur'));
      if (rawCur) {
        var c = Fx ? Fx.normCurrency(rawCur) : null;
        if (c === null) { out.stats.badCur++; if (out.problems.length < 20) out.problems.push((r + 1) + '행 ' + code + ': 통화 「' + rawCur + '」 를 알 수 없습니다(원화로 보지 않고 비워 둠)'); e.cur = '?'; }
        else { e.cur = c; e.curSrc = '통화 칸'; }
      }
      if (e.buy && e.buyKrw) {
        e.implied = round4(e.buyKrw / e.buy);
        if (!e.cur) {
          if (Math.abs(e.implied - 1) < 1e-9) { e.cur = 'KRW'; e.curSrc = '원화 칸 = 발주단가'; }
          else { e.cur = 'CNY'; e.curSrc = '원화 칸으로 추정'; }
        }
      }
      e.stop = STOP_RE.test(e.note);
      var cur0 = out.map[e.key];
      if (cur0) {
        out.stats.dup++;
        if (['note', 'customer', 'cur', 'buy', 'maker'].some(function (f) { return str(cur0[f]) !== str(e[f]); })) out.stats.dupDiff++;
        continue;   // 같은 품번은 위쪽 줄(매입단가표와 같은 규칙)
      }
      out.map[e.key] = e; out.list.push(e);
      out.stats.items++;
      if (e.buy) out.stats.withBuy++;
      if (e.implied != null) out.stats.implied[e.implied] = (out.stats.implied[e.implied] || 0) + 1;   // 파일 환율(원화 ÷ 발주단가)별 품번 수
      if (e.buyKrw) out.stats.withKrw++;
      if (e.curSrc === '원화 칸으로 추정') out.stats.curFromKrw++;
      if (e.buy && !e.cur) out.stats.curBlankWithBuy++;
      if (e.cur && e.cur !== '?') out.stats.byCur[e.cur] = (out.stats.byCur[e.cur] || 0) + 1;
      if (e.customer) { out.stats.withCustomer++; cust[e.customer] = 1; }
      if (e.sale) out.stats.withSale++;
      if (e.maker) mk[e.maker] = 1;
      if (e.assembler) asm[e.assembler] = 1;
      if (e.stop) out.stats.stop++;
    }
    out.stats.customers = Object.keys(cust).length; out.stats.makers = Object.keys(mk).length; out.stats.assemblers = Object.keys(asm).length;
    if (out.stats.dupDiff && out.problems.length < 20) out.problems.push('같은 천일품번이 다른 값으로 두 번 이상 적힌 품번 ' + out.stats.dupDiff + '개 — 위쪽 줄을 씁니다');
    if (!out.list.length) out.problems.push('머리는 찾았지만 천일품번이 적힌 줄이 없습니다');
    return out;
  }
  function has(p) { return !!(p && p.map && Object.keys(p.map).length); }
  /** 저장용으로 줄이기(localStorage) — 줄마다 배열 */
  var PACK = ['code', 'note', 'assembler', 'circuits', 'customer', 'sale', 'cur', 'curSrc', 'buy', 'buyKrw', 'implied', 'maker', 'row'];
  function pack(p) {
    return { v: 1, sheet: p.sheet, cols: p.cols, stats: p.stats, problems: p.problems, file: p.file, at: p.at,
      rows: p.list.map(function (e) { return PACK.map(function (f) { return e[f] == null ? '' : e[f]; }); }) };
  }
  function unpack(s) {
    if (!s || !Array.isArray(s.rows)) return null;
    var out = { list: [], map: {}, sheet: s.sheet, cols: s.cols || [], stats: s.stats || {}, problems: s.problems || [], file: s.file, at: s.at };
    s.rows.forEach(function (a) {
      var e = {};
      PACK.forEach(function (f, i) { e[f] = a[i] === '' && /^(sale|buy|buyKrw|implied)$/.test(f) ? null : a[i]; });
      e.key = key(e.code); e.stop = STOP_RE.test(e.note || '');
      if (!out.map[e.key]) { out.map[e.key] = e; out.list.push(e); }
    });
    return out;
  }

  /** 거르기. f = {q(품번), customer, maker, assembler(포함), note(포함), cur('KRW'|'CNY'|'none'(빈칸)|''), stop(bool), buy(bool)} */
  function filter(p, f) {
    f = f || {};
    var q = key(f.q), asm = str(f.assembler).toLowerCase(), nt = str(f.note).toLowerCase();
    return (p && p.list ? p.list : []).filter(function (e) {
      if (q && e.key.indexOf(q) < 0) return false;
      if (f.customer && e.customer !== f.customer) return false;
      if (f.maker && e.maker !== f.maker) return false;
      if (asm && str(e.assembler).toLowerCase().indexOf(asm) < 0) return false;
      if (nt && str(e.note).toLowerCase().indexOf(nt) < 0) return false;
      if (f.cur === 'none' ? !!e.cur : f.cur && e.cur !== f.cur) return false;
      if (f.stop && !e.stop) return false;
      if (f.buy && !e.buy) return false;
      return true;
    });
  }
  function values(p, field) {
    var m = {};
    (p && p.list ? p.list : []).forEach(function (e) { if (e[field]) m[e[field]] = (m[e[field]] || 0) + 1; });
    return Object.keys(m).sort(function (a, b) { return m[b] - m[a] || a.localeCompare(b); }).map(function (k) { return { value: k, count: m[k] }; });
  }
  /* 파일의 원화(고정 환율) 와 월평균 환산을 나란히: rateFor(cur) → {raw, unit, month, src} 또는 null
     반환 {fileKrw, fxKrw, diff, rate, month, src} — 외화 발주단가가 없으면 null */
  function compare(e, rateFor) {
    if (!e || !e.buy || !e.cur || e.cur === 'KRW' || e.cur === '?') return null;
    var r = rateFor ? rateFor(e.cur) : null;
    var fx = r ? Fx.round2(e.buy * r.raw / r.unit) : null;
    return { fileKrw: e.buyKrw, fxKrw: fx, diff: fx != null && e.buyKrw != null ? Fx.round2(fx - e.buyKrw) : null, rate: r ? r.raw / r.unit : null, month: r ? r.month : '', src: r ? r.src : '', implied: e.implied };
  }
  /** Excel — 거른 목록과 비교 칸 */
  function aoa(list, rateFor) {
    var head = ['천일품번', '특이사항', '조립처', '회로수', '고객사', '생산처', '판매단가', '통화', '통화 출처', '발주단가', '발주단가(원화) — 파일', '파일 환율(원화 ÷ 발주단가)', '월평균 환율', '환율 월 · 출처', '발주단가(원화) — 월평균', '차이(월평균 − 파일)', '단종·생산금지', '원본 행'];
    return [head].concat(list.map(function (e) {
      var c = compare(e, rateFor);
      return [e.code, e.note, e.assembler, e.circuits, e.customer, e.maker, e.sale == null ? '' : e.sale, e.cur === '?' ? '모름' : e.cur, e.curSrc, e.buy == null ? '' : e.buy, e.buyKrw == null ? '' : e.buyKrw,
        e.implied == null ? '' : e.implied, c && c.rate != null ? c.rate : '', c && c.month ? c.month + ' · ' + c.src : '', c && c.fxKrw != null ? c.fxKrw : '', c && c.diff != null ? c.diff : '', e.stop ? '예' : '', e.row];
    }));
  }

  return { FIELDS: FIELDS, LABEL: LABEL, STOP_RE: STOP_RE, key: key, cell: cell, num: num, findHeader: findHeader, parseBook: parseBook, has: has, pack: pack, unpack: unpack, filter: filter, values: values, compare: compare, aoa: aoa };
});
