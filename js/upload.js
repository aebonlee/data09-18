/* ERP 업로드 양식으로 내보내기 — 순수 로직 (기획서 11.10, 2026-09-30 업로드 양식 수령)
   수강생이 보낸 업로드 양식(Template.xlsx, 시트 「웹자료올리기」, 머리행 17열)의 열 순서 그대로
   통합 수주(천일품번 붙인 것)를 한 행씩 써 넣습니다. 채울 수 없는 열은 비우거나, 화면의 설정표(납품처·고정값)로 채웁니다.
   내장 기본 양식은 머리행 이름만 담습니다(열 이름은 일반 명칭이라 리포에 둡니다). 사용자가 자기 양식 파일을 넣으면 그 순서를 따릅니다.
   브라우저(window.SPUpload)와 node(require) 양쪽에서 씁니다. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SPUpload = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function str(v) { return v == null ? '' : String(v).trim(); }
  function norm(v) { return str(v).toLowerCase().replace(/[\s_()\-·.:：（）]/g, ''); }

  var DEFAULT_SHEET = '웹자료올리기';
  var DEFAULT_HEADERS = ['일자', '순번', '추가문자형식1', '납품처 코드', '납품처명', '담당자', '납기일자', '품목코드(상단)', '작업지시No.',
    '품목코드', '품목명', 'BOM버전', '규격', '수량', '창고', '적요', '하위반제품수'];

  /* 머리 이름(norm) → 채우는 방법. 여기 없는 열은 「고정값」 표에 적은 값(없으면 빈칸) */
  var FIELDS = {
    '일자': 'date', '순번': 'seq', '납품처코드': 'partyCode', '납품처명': 'partyName', '담당자': 'manager', '납기일자': 'due',
    '품목코드상단': 'topItem', '품목코드': 'item', '품목명': 'name', '수량': 'qty',
    // 2026-09-30 요청 「발주단가」: 양식에 단가·금액 열이 있으면 채웁니다
    '단가': 'price', '발주단가': 'price', 'unitprice': 'price', '금액': 'amount', '발주금액': 'amount', '공급가액': 'amount'
  };
  var PRICE_HEADER = '단가';
  var FIELD_LABEL = {
    date: '일자 — 설정(오늘·발주일·기준일)', seq: '순번 — 1부터 차례로(설정: 행마다·납품처별)', partyCode: '납품처 설정표', partyName: '납품처 설정표',
    manager: '납품처 설정표(비면 기본 담당자)', due: '통합 수주의 납기일', topItem: '설정(비움·품목코드와 같게)', item: '천일품번', name: '설정(수주 파일의 품명·비움)', qty: '통합 수주의 수량',
    price: '발주단가(원본 · 같은 품번 · 직접입력 · 단가표, 없으면 빈칸)', amount: '수량 × 발주단가(단가 없으면 빈칸)'
  };
  function fieldOf(header) { return FIELDS[norm(header)] || null; }

  function defaultOptions() {
    return {
      dateMode: 'today',     // today 오늘(올리는 날) | order 발주일(없으면 오늘) | base 취합 기준일 — 확인 부탁
      dateFormat: 'dash',    // dash 2026-09-30 | compact 20260930 — 확인 부탁
      seqMode: 'row',        // row 행마다 1, 2, 3… | party 같은 납품처(와 같은 일자)는 같은 순번(한 전표) — 확인 부탁
      topItem: 'blank',      // blank 비움 | same 품목코드와 같게 — 확인 부탁
      nameMode: 'order',     // order 수주 파일의 품명 | blank 비움(ERP 가 품목코드로 채우는 경우)
      unmapped: 'skip',      // skip 매핑 없는 품번은 내보내지 않음 | keep 고객사 품번 그대로 내보냄
      priceCol: 'add',       // 양식에 단가 열이 없을 때: add 「수량」 바로 뒤에 「단가」 열을 더함 | none 더하지 않음 — 확인 부탁(ERP 가 열이 늘어도 받는지)
      manager: '',           // 기본 담당자(납품처 표에 담당자가 없을 때)
      parties: {},           // { 납품처 열쇠: { code, name, manager } }
      fixed: {}              // { 머리 이름: 값 } — 추가문자형식1·작업지시No.·BOM버전·규격·창고·적요·하위반제품수 등
    };
  }
  function mergeOptions(o) {
    var d = defaultOptions();
    if (o && typeof o === 'object') Object.keys(d).forEach(function (k) { if (o[k] !== undefined && o[k] !== null) d[k] = o[k]; });
    if (['today', 'order', 'base'].indexOf(d.dateMode) < 0) d.dateMode = 'today';
    if (['dash', 'compact'].indexOf(d.dateFormat) < 0) d.dateFormat = 'dash';
    if (['row', 'party'].indexOf(d.seqMode) < 0) d.seqMode = 'row';
    if (['blank', 'same'].indexOf(d.topItem) < 0) d.topItem = 'blank';
    if (['order', 'blank'].indexOf(d.nameMode) < 0) d.nameMode = 'order';
    if (['skip', 'keep'].indexOf(d.unmapped) < 0) d.unmapped = 'skip';
    if (['add', 'none'].indexOf(d.priceCol) < 0) d.priceCol = 'add';
    d.manager = str(d.manager);
    if (!d.parties || typeof d.parties !== 'object') d.parties = {};
    if (!d.fixed || typeof d.fixed !== 'object') d.fixed = {};
    return d;
  }

  /** 납품처 열쇠 = 고객사 · 공장 · 구분 (포털 파일은 고객사 이름이 같아도 공장·구분마다 납품처가 다를 수 있어서) */
  function partyKey(r) { return [r.customer, r.plant, r.group].filter(function (x) { return str(x) !== ''; }).join(' · '); }
  function partyKeys(rows) {
    var seen = {}, out = [];
    rows.forEach(function (r) { var k = partyKey(r); if (!seen[k]) { seen[k] = 1; out.push(k); } });
    return out;
  }

  /* 양식 파일 읽기: 시트 「웹자료올리기」(없으면 첫 시트)의 첫 머리행(칸 2개 이상 찬 첫 행).
     반환 { sheet, headers, headerRow } 또는 { error } */
  function readTemplate(book) {
    var names = (book && book.names) || [];
    if (!names.length) return { error: '시트가 없습니다' };
    var nm = names.filter(function (n) { return norm(n) === norm(DEFAULT_SHEET); })[0] || names[0];
    var aoa = book.sheets[nm] || [];
    for (var r = 0; r < Math.min(aoa.length, 20); r++) {
      var line = aoa[r] || [];
      var filled = line.filter(function (c) { return str(c) !== ''; }).length;
      if (filled >= 2) {
        var last = line.length - 1;
        while (last >= 0 && str(line[last]) === '') last--;
        return { sheet: nm, headers: line.slice(0, last + 1).map(str), headerRow: r };
      }
    }
    return { error: '시트「' + nm + '」에서 머리행(칸 2개 이상 찬 행)을 찾지 못했습니다' };
  }
  function defaultTemplate() { return { sheet: DEFAULT_SHEET, headers: DEFAULT_HEADERS.slice(), builtIn: true }; }
  /** 내보낼 머리행: 양식에 단가 열이 없고 priceCol = add 면 「수량」 바로 뒤(없으면 맨 끝)에 「단가」를 끼웁니다 */
  function outHeaders(tplHeaders, o) {
    var H = tplHeaders.slice();
    if (o.priceCol !== 'add' || H.some(function (h) { return fieldOf(h) === 'price'; })) return { headers: H, added: [] };
    var qi = -1;
    H.forEach(function (h, i) { if (qi < 0 && fieldOf(h) === 'qty') qi = i; });
    H.splice(qi < 0 ? H.length : qi + 1, 0, PRICE_HEADER);
    return { headers: H, added: [PRICE_HEADER] };
  }

  function fmt(iso, f) { return !iso ? '' : f === 'compact' ? iso.replace(/-/g, '') : iso; }

  /* 업로드 표 만들기.
     rows  = 매핑을 거친 통합 수주 행(SPMapping.apply 결과, company·mapStatus 있음)
     tpl   = { sheet, headers }  opts = mergeOptions 결과  ctx = { today:'YYYY-MM-DD', base:'YYYY-MM-DD' }
     반환 { sheet, aoa(머리행 + 행), count, skipped:{unmapped}, unknown:[자동으로 못 채우는 머리], blankCols:[끝까지 빈 열] } */
  function build(rows, tpl, opts, ctx) {
    var o = mergeOptions(opts);
    tpl = tpl && tpl.headers && tpl.headers.length ? tpl : defaultTemplate();
    ctx = ctx || {};
    var oh = outHeaders(tpl.headers, o), H = oh.headers, kinds = H.map(fieldOf);
    var skipped = { unmapped: 0 };
    var use = rows.filter(function (r) {
      if (r.mapStatus === 'unmapped' && o.unmapped === 'skip') { skipped.unmapped++; return false; }
      return true;
    });
    use = use.slice().sort(function (a, b) {
      return o.seqMode === 'party' ? (partyKey(a).localeCompare(partyKey(b)) || str(a.due).localeCompare(str(b.due)) || str(a.company || a.item).localeCompare(str(b.company || b.item)))
        : (str(a.due).localeCompare(str(b.due)) || str(a.company || a.item).localeCompare(str(b.company || b.item)));
    });
    var seqOf = {}, next = 0;
    var body = use.map(function (r, i) {
      var p = o.parties[partyKey(r)] || {};
      var date = o.dateMode === 'order' ? (r.orderDate || ctx.today) : o.dateMode === 'base' ? (ctx.base || ctx.today) : ctx.today;
      var seq;
      if (o.seqMode === 'party') { var sk = date + '|' + partyKey(r); if (!seqOf[sk]) seqOf[sk] = ++next; seq = seqOf[sk]; }
      else seq = i + 1;
      var item = r.company || r.item;
      return H.map(function (h, c) {
        switch (kinds[c]) {
          case 'date': return fmt(date, o.dateFormat);
          case 'seq': return seq;
          case 'partyCode': return str(p.code);
          case 'partyName': return str(p.name);
          case 'manager': return str(p.manager) || o.manager;
          case 'due': return fmt(r.due, o.dateFormat);
          case 'topItem': return o.topItem === 'same' ? item : str(o.fixed[h]);
          case 'item': return item;
          case 'name': return o.nameMode === 'order' ? str(r.name) : '';
          case 'qty': return r.qty;
          case 'price': return r.price == null ? '' : r.price;
          case 'amount': return r.price == null ? '' : Math.round(r.qty * r.price * 100) / 100;
          default: return o.fixed[h] == null ? '' : o.fixed[h];
        }
      });
    });
    var unknown = H.filter(function (h, c) { return !kinds[c] && str(h) !== ''; });
    var blankCols = H.filter(function (h, c) { return body.every(function (ln) { return str(ln[c]) === ''; }); });
    var hasPriceCol = kinds.indexOf('price') >= 0 || kinds.indexOf('amount') >= 0;
    var noPrice = hasPriceCol ? use.filter(function (r) { return r.price == null; }).length : 0;
    return { sheet: tpl.sheet || DEFAULT_SHEET, aoa: [H.slice()].concat(body), count: body.length, skipped: skipped, unknown: unknown, blankCols: blankCols, added: oh.added, noPrice: noPrice, headers: H };
  }

  return {
    DEFAULT_SHEET: DEFAULT_SHEET, DEFAULT_HEADERS: DEFAULT_HEADERS, FIELD_LABEL: FIELD_LABEL,
    defaultOptions: defaultOptions, mergeOptions: mergeOptions, defaultTemplate: defaultTemplate, readTemplate: readTemplate,
    fieldOf: fieldOf, partyKey: partyKey, partyKeys: partyKeys, build: build, outHeaders: outHeaders, PRICE_HEADER: PRICE_HEADER
  };
});
