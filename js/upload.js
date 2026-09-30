/* ERP 업로드 양식으로 내보내기 — 순수 로직 (기획서 11.10 · 11.12)
   수강생이 보낸 업로드 양식(Template.xlsx, 시트 「웹자료올리기」, 머리행 17열)의 열 순서 그대로
   통합 수주(천일품번 붙인 것)를 한 행씩 써 넣습니다. 채울 수 없는 열은 비우거나, 화면의 설정표(품번별 납품처·고정값)로 채웁니다.
   2026-09-30 확정: 일자 = 등록일자(오늘, 20260930) · 순번 1, 2, 3 · 품목코드(상단) = 품목코드 · 매핑 없는 품번은 고객사 원품번 그대로 ·
   납품처 코드·납품처명·담당자는 품번별 수기입력(기억) · 단가 열 = 매입단가(생산처 발주).
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
    // 2026-09-30 두 번째 답변: 업로드 단가 = 매입단가(당사 → 생산처 발주단가). 고객 발주 단가(판매단가)는 「판매단가」 열이 있을 때만
    '단가': 'price', '매입단가': 'price', '발주단가': 'price', '구매단가': 'price', 'unitprice': 'price',
    '금액': 'amount', '매입금액': 'amount', '발주금액': 'amount', '공급가액': 'amount',
    '판매단가': 'sale', '판매금액': 'saleAmount', '생산처': 'maker', '생산처명': 'maker', '매입처': 'maker'
  };
  var PRICE_HEADER = '단가';
  var FIELD_LABEL = {
    date: '등록일자 = 오늘(20260930 모양)', seq: '순번 — 1, 2, 3 차례로', partyCode: '품번별 납품처표(없으면 묶음 기본값)', partyName: '품번별 납품처표(없으면 묶음 기본값)',
    manager: '품번별 납품처표(없으면 묶음 기본값 → 기본 담당자)', due: '통합 수주의 납기일', topItem: '품목코드와 같은 값', item: '천일품번(매핑 없으면 고객사 원품번)', name: '설정(수주 파일의 품명·비움)', qty: '통합 수주의 수량',
    price: '매입단가(생산처 발주 — 매입단가표 · 직접입력, 없으면 빈칸)', amount: '수량 × 매입단가(없으면 빈칸)',
    sale: '판매단가(고객 발주, 참고)', saleAmount: '수량 × 판매단가(참고)', maker: '생산처(매입단가표)'
  };
  function fieldOf(header) { return FIELDS[norm(header)] || null; }

  // 2026-09-30 두 번째 답변으로 확정한 값(판 2). 이전 판에서 저장된 설정은 upgradeOptions 가 이 값으로 바꿉니다
  var OPTIONS_VERSION = 2;
  var CONFIRMED = { dateMode: 'today', dateFormat: 'compact', seqMode: 'row', topItem: 'same', unmapped: 'keep' };
  function defaultOptions() {
    return {
      v: OPTIONS_VERSION,
      dateMode: 'today',     // 확정: 등록일자 = 오늘(TODAY) | order 발주일 | base 취합 기준일 (설정으로 남겨 둠)
      dateFormat: 'compact', // 확정: 20260930 | dash 2026-09-30
      seqMode: 'row',        // 확정: 행마다 1, 2, 3 순차 | party 같은 일자·납품처는 같은 순번
      topItem: 'same',       // 확정: 품목코드(상단) = 품목코드와 같은 값 | blank 비움
      nameMode: 'order',     // order 수주 파일의 품명 | blank 비움(ERP 가 품목코드로 채우는 경우)
      unmapped: 'keep',      // 확정: 매핑표에 없는 품번은 고객사 원품번 그대로 올림 | skip 빼고 내보냄
      priceCol: 'add',       // 양식에 단가 열이 없을 때: add 「수량」 바로 뒤에 「단가」(= 매입단가) 열을 더함 | none 더하지 않음 — 확인 부탁(ERP 가 열이 늘어도 받는지)
      manager: '',           // 기본 담당자(품번별·묶음 기본값에 담당자가 없을 때)
      itemParties: {},       // 확정: 납품처 코드·납품처명·담당자는 수기입력, 품번별로 다름 → { 품목코드 열쇠: { code, name, manager } } 한 번 적으면 기억
      parties: {},           // 묶음 기본값(선택) { 고객사 · 공장 · 구분: { code, name, manager } } — 품번별 값이 없을 때만
      fixed: {}              // { 머리 이름: 값 } — 추가문자형식1·작업지시No.·BOM버전·규격·창고·적요·하위반제품수 등
    };
  }
  function mergeOptions(o) {
    var d = defaultOptions();
    if (o && typeof o === 'object') Object.keys(d).forEach(function (k) { if (o[k] !== undefined && o[k] !== null) d[k] = o[k]; });
    if (['today', 'order', 'base'].indexOf(d.dateMode) < 0) d.dateMode = 'today';
    if (['dash', 'compact'].indexOf(d.dateFormat) < 0) d.dateFormat = 'compact';
    if (['row', 'party'].indexOf(d.seqMode) < 0) d.seqMode = 'row';
    if (['blank', 'same'].indexOf(d.topItem) < 0) d.topItem = 'same';
    if (['order', 'blank'].indexOf(d.nameMode) < 0) d.nameMode = 'order';
    if (['skip', 'keep'].indexOf(d.unmapped) < 0) d.unmapped = 'keep';
    if (['add', 'none'].indexOf(d.priceCol) < 0) d.priceCol = 'add';
    d.manager = str(d.manager);
    if (!d.parties || typeof d.parties !== 'object' || Array.isArray(d.parties)) d.parties = {};
    if (!d.itemParties || typeof d.itemParties !== 'object' || Array.isArray(d.itemParties)) d.itemParties = {};
    if (!d.fixed || typeof d.fixed !== 'object') d.fixed = {};
    return d;
  }
  /** 저장된 설정 읽기: 판이 2 보다 낮으면(확정 전 기본값으로 저장된 것) 확정값으로 바꿉니다. 납품처·고정값은 그대로 */
  function upgradeOptions(o) {
    var d = mergeOptions(o);
    if (!o || o.v !== OPTIONS_VERSION) { Object.keys(CONFIRMED).forEach(function (k) { d[k] = CONFIRMED[k]; }); d.v = OPTIONS_VERSION; }
    return d;
  }

  /** 납품처 열쇠 = 고객사 · 공장 · 구분 (포털 파일은 고객사 이름이 같아도 공장·구분마다 납품처가 다를 수 있어서) */
  function partyKey(r) { return [r.customer, r.plant, r.group].filter(function (x) { return str(x) !== ''; }).join(' · '); }
  function partyKeys(rows) {
    var seen = {}, out = [];
    rows.forEach(function (r) { var k = partyKey(r); if (!seen[k]) { seen[k] = 1; out.push(k); } });
    return out;
  }

  // ── 품번별 납품처 (2026-09-30 확정: 납품처 코드·납품처명·담당자는 수기입력, 품번별로 다름) ──
  /** 품목코드 열쇠: 공백을 없애고 대문자(매핑표와 같은 규칙) */
  function key(v) { return str(v).replace(/\s+/g, '').toUpperCase(); }
  /** 업로드에 쓰는 품목코드 = 천일품번(매핑 없으면 고객사 원품번) */
  function itemCode(r) { return r.company || r.item; }
  /** 한 행의 납품처: 품번별 표(천일품번 → 고객사 품번) → 묶음 기본값 → 기본 담당자. 칸마다 따로 채웁니다 */
  function partyOf(r, o) {
    var ip = o.itemParties[key(itemCode(r))] || o.itemParties[key(r.customerItem || r.item)] || {};
    var gp = o.parties[partyKey(r)] || {};
    return { code: str(ip.code) || str(gp.code), name: str(ip.name) || str(gp.name), manager: str(ip.manager) || str(gp.manager) || o.manager };
  }
  /** 업로드에 나갈 품목 목록(품목코드마다 한 줄) — 화면 「품번별 납품처」 표 */
  function itemList(rows) {
    var m = {}, out = [];
    rows.forEach(function (r) {
      var k = key(itemCode(r));
      var e = m[k];
      if (!e) { e = m[k] = { key: k, code: itemCode(r), customerItem: r.customerItem || r.item, customers: [], groups: [], name: r.name || '', rows: 0, qty: 0 }; out.push(e); }
      e.rows++; e.qty += r.qty || 0;
      if (r.customer && e.customers.indexOf(r.customer) < 0) e.customers.push(r.customer);
      if (r.group && e.groups.indexOf(r.group) < 0) e.groups.push(r.group);
    });
    return out.sort(function (a, b) { return (a.customers[0] || '').localeCompare(b.customers[0] || '') || (a.groups[0] || '').localeCompare(b.groups[0] || '') || a.code.localeCompare(b.code); });
  }
  var PARTY_HEAD = ['품목코드', '고객사 품번', '고객사', '구분', '품목명', '납품처 코드', '납품처명', '담당자'];
  /** 품번별 납품처표 → Excel(지금 수주의 품목 + 이미 적은 값). 채워서 다시 넣으면 그대로 읽힙니다 */
  function itemPartiesAoa(list, itemParties) {
    itemParties = itemParties || {};
    var seen = {};
    var body = list.map(function (e) {
      seen[e.key] = 1;
      var p = itemParties[e.key] || {};
      return [e.code, e.customerItem !== e.code ? e.customerItem : '', e.customers.join(', '), e.groups.join(', '), e.name, str(p.code), str(p.name), str(p.manager)];
    });
    // 이번 수주에 없지만 기억해 둔 품번도 함께(표를 잃지 않게)
    Object.keys(itemParties).sort().forEach(function (k) {
      if (seen[k]) return;
      var p = itemParties[k] || {};
      body.push([k, '', '', '', '', str(p.code), str(p.name), str(p.manager)]);
    });
    return [PARTY_HEAD.slice()].concat(body);
  }
  var P_CODE = ['품목코드', '천일품번', '품번', '당사품번'];
  var P_FIELD = { code: ['납품처코드', '납품처 코드'], name: ['납품처명', '납품처'], manager: ['담당자', '담당자명'] };
  /* 품번별 납품처표 파일 읽기. 반환 { map:{열쇠:{code,name,manager}}, stats:{rows, set, blank}, problems:[] }
     빈 칸은 「값 없음」이라 기존 값을 지우지 않습니다(mergeItemParties) */
  function parseItemParties(book) {
    var out = { map: {}, stats: { rows: 0, set: 0, blank: 0 }, problems: [] };
    var names = (book && book.names) || [];
    names.forEach(function (nm) {
      var aoa = book.sheets[nm] || [], hit = null;
      for (var r = 0; r < Math.min(aoa.length, 10) && !hit; r++) {
        var hs = (aoa[r] || []).map(norm), ci = -1;
        P_CODE.map(norm).some(function (c) { ci = hs.indexOf(c); return ci >= 0; });
        if (ci < 0) continue;
        var f = {};
        Object.keys(P_FIELD).forEach(function (k) { f[k] = -1; P_FIELD[k].map(norm).some(function (c) { f[k] = hs.indexOf(c); return f[k] >= 0; }); });
        if (f.code >= 0 || f.name >= 0 || f.manager >= 0) hit = { hr: r, code: ci, f: f };
      }
      if (!hit) { if (aoa.length) out.problems.push('시트「' + nm + '」: 「품목코드」와 「납품처 코드·납품처명·담당자」 머리를 찾지 못해 건너뛰었습니다'); return; }
      for (var i = hit.hr + 1; i < aoa.length; i++) {
        var ln = aoa[i] || [], k = key(ln[hit.code]);
        if (!k) continue;
        out.stats.rows++;
        var v = {};
        ['code', 'name', 'manager'].forEach(function (x) { if (hit.f[x] >= 0 && str(ln[hit.f[x]]) !== '') v[x] = str(ln[hit.f[x]]); });
        if (!Object.keys(v).length) { out.stats.blank++; continue; }
        out.map[k] = Object.assign(out.map[k] || {}, v); out.stats.set++;
      }
    });
    if (!out.stats.rows && !out.problems.length) out.problems.push('납품처표에서 읽은 행이 없습니다');
    return out;
  }
  /** 품번별 납품처 합치기: 새로 적은 칸만 바꾸고, 빈 칸은 기존 값을 둡니다 */
  function mergeItemParties(old, add) {
    var m = {};
    Object.keys(old || {}).forEach(function (k) { m[k] = Object.assign({}, old[k]); });
    Object.keys(add || {}).forEach(function (k) {
      var v = add[k] || {}, cur = m[k] || {};
      ['code', 'name', 'manager'].forEach(function (x) { if (v[x] !== undefined) { if (str(v[x]) === '') delete cur[x]; else cur[x] = str(v[x]); } });
      if (Object.keys(cur).length) m[k] = cur; else delete m[k];
    });
    return m;
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
    var seqOf = {}, next = 0, noParty = 0;
    var body = use.map(function (r, i) {
      var p = partyOf(r, o);
      if (!p.code) noParty++;
      var date = o.dateMode === 'order' ? (r.orderDate || ctx.today) : o.dateMode === 'base' ? (ctx.base || ctx.today) : ctx.today;
      var seq;
      if (o.seqMode === 'party') { var sk = date + '|' + partyKey(r); if (!seqOf[sk]) seqOf[sk] = ++next; seq = seqOf[sk]; }
      else seq = i + 1;
      var item = itemCode(r);
      return H.map(function (h, c) {
        switch (kinds[c]) {
          case 'date': return fmt(date, o.dateFormat);
          case 'seq': return seq;
          case 'partyCode': return p.code;
          case 'partyName': return p.name;
          case 'manager': return p.manager;
          case 'due': return fmt(r.due, o.dateFormat);
          case 'topItem': return o.topItem === 'same' ? item : str(o.fixed[h]);
          case 'item': return item;
          case 'name': return o.nameMode === 'order' ? str(r.name) : '';
          case 'qty': return r.qty;
          case 'price': return r.buyPrice == null ? '' : r.buyPrice;
          case 'amount': return r.buyPrice == null ? '' : Math.round(r.qty * r.buyPrice * 100) / 100;
          case 'sale': return r.price == null ? '' : r.price;
          case 'saleAmount': return r.price == null ? '' : Math.round(r.qty * r.price * 100) / 100;
          case 'maker': return str(r.maker);
          default: return o.fixed[h] == null ? '' : o.fixed[h];
        }
      });
    });
    var unknown = H.filter(function (h, c) { return !kinds[c] && str(h) !== ''; });
    var blankCols = H.filter(function (h, c) { return body.every(function (ln) { return str(ln[c]) === ''; }); });
    var hasPriceCol = kinds.indexOf('price') >= 0 || kinds.indexOf('amount') >= 0;
    var noPrice = hasPriceCol ? use.filter(function (r) { return r.buyPrice == null; }).length : 0;
    var partyCol = kinds.indexOf('partyCode') >= 0;
    return { sheet: tpl.sheet || DEFAULT_SHEET, aoa: [H.slice()].concat(body), count: body.length, skipped: skipped, unknown: unknown, blankCols: blankCols, added: oh.added, noPrice: noPrice, noParty: partyCol ? noParty : 0, headers: H };
  }

  return {
    DEFAULT_SHEET: DEFAULT_SHEET, DEFAULT_HEADERS: DEFAULT_HEADERS, FIELD_LABEL: FIELD_LABEL,
    defaultOptions: defaultOptions, mergeOptions: mergeOptions, upgradeOptions: upgradeOptions, OPTIONS_VERSION: OPTIONS_VERSION, CONFIRMED: CONFIRMED,
    defaultTemplate: defaultTemplate, readTemplate: readTemplate,
    fieldOf: fieldOf, partyKey: partyKey, partyKeys: partyKeys, build: build, outHeaders: outHeaders, PRICE_HEADER: PRICE_HEADER,
    key: key, itemCode: itemCode, partyOf: partyOf, itemList: itemList, itemPartiesAoa: itemPartiesAoa, parseItemParties: parseItemParties, mergeItemParties: mergeItemParties, PARTY_HEAD: PARTY_HEAD
  };
});
