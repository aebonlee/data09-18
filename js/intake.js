/* 수주 자동 취합 — 순수 로직 (기획서 11장 「수주 자동 취합」)
   고객사 포털·발주서 파일 여러 개 → 파일 이름으로 종류 판별 → 종류별 규칙 → 통합 수주 표 한 장 + 「★확인 필요」.
   통합 표는 이 도구의 입력 ①「수주현황」이 되고, 선적계획·창고별재고현황 파일은 입력 ③·② 로 넘깁니다.
   브라우저(window.SPIntake)와 node(require) 양쪽에서 씁니다. 파일을 읽는 일(SheetJS·pdf.js)은 화면 코드가 하고,
   여기에는 「읽은 표(aoa) → 수주 행」 변환만 둡니다. */
(function (root, factory) {
  var L = root && root.SPLogic;
  if (!L && typeof require === 'function') L = require('./logic.js');
  var api = factory(L);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SPIntake = api;
})(typeof window !== 'undefined' ? window : this, function (L) {
  'use strict';

  // ── 작은 도구 ─────────────────────────────────────────
  function str(v) { return v == null ? '' : String(v).trim(); }
  function norm(v) { return str(v).toLowerCase().replace(/[\s_()\-·.:：（）]/g, ''); }
  /** 부호 있는 수. '−3', '-3', '1,200', ' 5 ' 허용. 못 읽으면 null */
  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).replace(/,/g, '').replace(/[−–]/g, '-').trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    return Number(s);
  }
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  var parseDate = L.parseDate, addDays = L.addDays;
  function baseName(name) { return String(name || '').split(/[\\/]/).pop(); }
  /** 파일 이름 속 날짜: 2026.09.29 / 26.09.29 / 2026-09-29 / 20260929 → 'YYYY-MM-DD' */
  function fileDate(name) {
    var s = baseName(name), m = s.match(/(^|[^\d])((?:20)?\d{2})[.\-_](\d{1,2})[.\-_](\d{1,2})(?!\d)/);
    if (m) { var y = m[2].length === 2 ? 2000 + +m[2] : +m[2]; return parseDate(y + '-' + m[3] + '-' + m[4]); }
    m = s.match(/(^|[^\d])(20\d{2})(\d{2})(\d{2})(?!\d)/);
    return m ? parseDate(m[2] + '-' + m[3] + '-' + m[4]) : null;
  }
  /** 발주서 고객사 이름 = 파일 이름(앞 번호·확장자 뺌). 코드에 고객사 이름을 두지 않습니다 */
  function customerFromName(name) { return baseName(name).replace(/\.[^.]+$/, '').replace(/^\d+_/, '').trim(); }

  // ── 설정 (화면에서 바꾸고 이 브라우저에 저장) ───────────
  /* 수강생 답(2026-09-30)으로 기본값이 바뀐 규칙. 예전 기본값이 이 브라우저에 저장돼 있어도 새 확정값으로 한 번 되돌립니다 */
  var RULES_VERSION = '2026-09-30';
  var RESET_ON_UPGRADE = ['collectDirect', 'bobcatShortOffset', 'engineMode', 'poAllSheets'];
  function defaultOptions() {
    return {
      rulesVersion: RULES_VERSION,
      base: '',                  // 기준일(오늘). 비우면 파일 이름 날짜 → 없으면 오늘
      engineShortOffset: 2,      // 요청 ②: 엔진 납기 = 결품일 − 2일
      bobcatShortOffset: 2,      // 확정(2026-09-30): 밥캣도 결품일 − 2일
      engineMode: 'override',    // 확정(2026-09-30): 엔진 결품과 납품예정에 같은 품번 → 결품 기준(납품예정 미반영) | sum = 둘 다
      collectDirect: true,       // 확정(2026-09-30): 직송 파일(인천건기·엔진, 밥캣 직송)도 납품예정과 같게 수주로 넣음
      monthBuckets: true,        // 누적결품의 월 단위 칸(11·12·01…)도 결품으로 넣을지
      shortMode: 'increment',    // increment = 날짜별 늘어난 결품만큼 한 줄씩 | single = 최대 결품을 첫 결품일 한 줄로
      poAllSheets: false,        // 확정(2026-09-30): 발주서 파일에 시트가 여럿이면 최근(발주일자가 가장 늦은) 시트만 / 전부(true)
      borrowPrice: true,         // 판매단가(고객 발주, 참고): 단가 칸이 없는 줄(누적결품 등)은 같은 고객사·같은 품번의 다른 파일 단가로 채움(값이 하나일 때만)
      portalCustomer: '포털 고객사', // 건기·엔진·AM·CKD 파일의 고객사 이름(파일에 이름이 없어 사용자가 적음)
      bobcatCustomer: '밥캣'
    };
  }
  /** 브라우저에 저장돼 있던 설정 불러오기: 규칙 판이 예전이면 이번에 확정된 칸만 새 기본값으로 되돌림 */
  function upgradeOptions(saved) {
    if (!saved || typeof saved !== 'object') return mergeOptions(null);
    if (saved.rulesVersion === RULES_VERSION) return mergeOptions(saved);
    var o = Object.assign({}, saved);
    RESET_ON_UPGRADE.forEach(function (k) { delete o[k]; });
    return mergeOptions(o);
  }
  function mergeOptions(o) {
    var d = defaultOptions();
    if (o && typeof o === 'object') Object.keys(d).forEach(function (k) { if (k !== 'rulesVersion' && o[k] !== undefined && o[k] !== null) d[k] = o[k]; });
    d.engineShortOffset = Math.max(0, Math.min(30, Math.floor(Number(d.engineShortOffset) || 0)));
    d.bobcatShortOffset = Math.max(0, Math.min(30, Math.floor(Number(d.bobcatShortOffset) || 0)));
    d.engineMode = d.engineMode === 'sum' ? 'sum' : 'override';
    d.shortMode = d.shortMode === 'single' ? 'single' : 'increment';
    ['collectDirect', 'monthBuckets', 'poAllSheets', 'borrowPrice'].forEach(function (k) { d[k] = !!d[k]; });
    d.base = parseDate(d.base) || '';
    return d;
  }

  // ── 1. 파일 이름으로 종류 판별 ─────────────────────────
  /* type: plan 납품예정 · short 누적결품 · direct 직송 (건기·엔진·AM·CKD 포털 파일)
           bobcatShort · bobcatPlan · bobcatDirect (밥캣 xls) · shipplan 선적계획 · stock 창고별재고현황
           po 발주서(내용으로 판별) · unknown */
  function plantOf(n) { return /인천/.test(n) ? '인천' : /군산/.test(n) ? '군산' : /안산/.test(n) ? '안산' : ''; }
  function groupOf(n) { return /CKD/i.test(n) ? 'CKD' : /(^|[^A-Za-z])AM([^A-Za-z]|$)/.test(n) ? 'AM' : /건기/.test(n) ? '건기' : /엔진/.test(n) ? '엔진' : ''; }
  function classify(name) {
    var n = baseName(name).replace(/\.[^.]+$/, '');
    var c = { name: baseName(name), date: fileDate(name), plant: plantOf(n), group: '' };
    if (/\.pdf$/i.test(name)) { c.type = 'pdf'; return c; }
    if (/선적계획/.test(n)) { c.type = 'shipplan'; return c; }
    if (/재고/.test(n)) { c.type = 'stock'; return c; }
    if (/밥캣/.test(n)) {
      c.group = '밥캣';
      c.type = /누적결품/.test(n) ? 'bobcatShort' : /직송/.test(n) ? 'bobcatDirect' : /납품예정/.test(n) ? 'bobcatPlan' : 'unknown';
      if (c.type === 'unknown') c.why = '밥캣 파일이지만 누적결품·납품예정·직송 중 무엇인지 이름에서 알 수 없습니다';
      return c;
    }
    var kind = /누적결품/.test(n) ? 'short' : /직송/.test(n) ? 'direct' : /납품예정/.test(n) ? 'plan' : '';
    if (kind) {
      c.group = groupOf(n);
      if (!c.group) { c.type = 'unknown'; c.why = '건기·엔진·AM·CKD 중 무엇인지 이름에서 알 수 없습니다'; return c; }
      c.type = kind; return c;
    }
    c.type = 'po?'; // 발주서인지는 내용(머리행)으로 봅니다
    return c;
  }
  var TYPE_LABEL = {
    plan: '납품예정', short: '누적결품', direct: '직송', bobcatShort: '밥캣 누적결품', bobcatPlan: '밥캣 납품예정 일반', bobcatDirect: '밥캣 납품예정 직송',
    shipplan: '선적계획(→ 선적예정)', stock: '창고별재고현황(→ 재고현황)', po: '발주서', pdf: '발주서(PDF)', unknown: '알 수 없음'
  };

  // ── 머리행·열 찾기 ────────────────────────────────────
  /** 머리행(앞 12행 안) 중 need 이름이 모두 있는 행. 없으면 -1 */
  function findHeader(aoa, need) {
    var want = need.map(norm);
    for (var r = 0; r < Math.min(aoa.length, 12); r++) {
      var hs = (aoa[r] || []).map(norm);
      if (want.every(function (w) { return hs.indexOf(w) >= 0; })) return r;
    }
    return -1;
  }
  /** 머리행에서 이름이 정확히 같은 첫 열(여러 후보 중 먼저 찾은 것) */
  function col(headers, names) {
    var hs = headers.map(norm);
    for (var i = 0; i < names.length; i++) { var k = hs.indexOf(norm(names[i])); if (k >= 0) return k; }
    return -1;
  }
  function blankRow(r) { return !(r || []).some(function (c) { return str(c) !== ''; }); }

  // 파일 종류별 열 이름 (기획서 11.3 열 매핑표). 이름으로 찾으므로 열 순서가 바뀌어도 됩니다.
  var LAYOUTS = {
    // price·currency·priceUnit: 발주단가 열(2026-09-30 요청 「발주단가도 기재」). 없으면 단가 없음으로 둡니다
    portalStd: { need: ['품목코드', '납품잔량', '납기일자'], item: ['품목코드'], name: ['품목명'], qty: ['납품잔량'], due: ['납기일자'], orderDate: ['발주일'], orderType: ['오더유형'], price: ['발주단가'], currency: ['통화', '화폐'] },
    // 군산건기(예정신고전): 생산오더 단위 — 납품잔량 대신 요청수량, 납기일(Actual). 발주단가 열이 없습니다(산처리금액만)
    portalProd: { need: ['품목코드', '요청수량', '납기일(Actual)'], item: ['품목코드'], name: ['품목명'], qty: ['요청수량'], due: ['납기일(Actual)'], orderDate: ['생성일'], orderType: ['오더유형 내역', '오더유형'] },
    // 안산AM: 품목코드가 A열, 오더유형 대신 발주구분
    portalAm: { need: ['품목코드', '납품잔량', '납기일자', '발주구분'], item: ['품목코드'], name: ['품목명'], qty: ['납품잔량'], due: ['납기일자'], orderDate: ['발주일'], orderType: ['발주구분'], extra: ['확정여부'], price: ['발주단가'], currency: ['화폐', '통화'] },
    short: { need: ['품목코드', 'Stock Qty'], item: ['품목코드'], name: ['품목명'] },
    // 밥캣: 발주단가 · 사급단가 · 총단가 중 발주단가(받은 파일은 사급단가 0 이라 총단가 = 발주단가)
    bobcatPlan: { need: ['품번', '납품잔량', '납기일자'], item: ['품번'], name: ['품명'], qty: ['납품잔량'], due: ['납기일자'], orderDate: ['발주일'], orderType: ['오더유형'], price: ['발주단가'], currency: ['통화'] },
    bobcatShort: { need: ['품번', '현재고'], item: ['품번'], name: ['품명'] },
    shipplan: { need: ['품목코드', '미판매수량'], item: ['품목코드'], name: ['품목명(규격)', '품목명'], qty: ['미판매수량'], due: ['변경선적요청일(调整）', '변경선적요청일(调整)', '변경선적요청일'], due2: ['납기일자'] },
    stock: { need: ['품목코드', '합계'], item: ['품목코드'], name: ['품목명'], qty: ['합계'], safety: ['안전재고'] }
  };
  function pick(aoa, lay) {
    var hr = findHeader(aoa, lay.need);
    if (hr < 0) return null;
    var H = aoa[hr], m = { hr: hr, headers: H };
    Object.keys(lay).forEach(function (k) { if (k !== 'need' && Array.isArray(lay[k])) m[k] = col(H, lay[k]); });
    return m;
  }
  /** 발주단가: 단가 칸(가격단위 열이 1보다 크면 나눔). 빈칸·0·음수·글자는 null(단가 없음) */
  function priceOf(ln, m) {
    if (!(m.price >= 0)) return null;
    var p = num(ln[m.price]);
    if (p === null || p <= 0) return null;
    var u = m.priceUnit >= 0 ? num(ln[m.priceUnit]) : null;
    if (u && u > 1) p = p / u;
    return Math.round(p * 10000) / 10000;
  }
  function currencyOf(ln, m) { return m.currency >= 0 ? str(ln[m.currency]) : ''; }
  function isWon(c) { return !c || /^(krw|원|₩|won)$/i.test(c); }
  function portalLayout(aoa) {
    var order = ['portalStd', 'portalProd', 'portalAm'];
    for (var i = 0; i < order.length; i++) {
      var p = pick(aoa, LAYOUTS[order[i]]);
      // 안산AM 은 portalStd 머리행도 갖추고 있으므로, 발주구분 열이 있으면 AM 배치로 봅니다
      if (p && order[i] === 'portalStd' && col(p.headers, ['발주구분']) >= 0) continue;
      if (p) { p.layout = order[i]; return p; }
    }
    return null;
  }

  // ── 2. 누적결품 → 수주 줄 (요청 ②) ──────────────────────
  /** 날짜순 누적값 [{date, v}] → [{date, qty}]. 음수 = 결품(양수로 바꿈).
      increment: 결품이 이전 최대보다 커진 날마다 늘어난 만큼 / single: 최대 결품을 첫 결품일에 한 줄 */
  function shortageSteps(series, mode) {
    var out = [], max = 0;
    series.forEach(function (p) {
      if (p.v == null) return;
      var s = p.v < 0 ? -p.v : 0;
      if (s > max) { out.push({ date: p.date, qty: s - max, month: !!p.month }); max = s; }
    });
    if (mode === 'single' && out.length) return [{ date: out[0].date, qty: max, month: out[0].month }];
    return out;
  }
  /** 누적결품 머리행의 날짜 칸: '2026/09/29' 은 그날, '11'·'12'·'01' 같은 월 칸은 그 달 첫날
      (일별 칸과 같은 달이면 일별 마지막 다음날). 반환 [{col, date, month}] */
  function shortDateCols(H, monthBuckets) {
    var cols = [], last = null;
    H.forEach(function (h, i) {
      var d = typeof h === 'string' && /\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}/.test(h) ? parseDate(h) : (h instanceof Date ? parseDate(h) : null);
      if (d) { cols.push({ col: i, date: d, month: false }); last = d; }
    });
    if (!last || !monthBuckets) return { cols: cols, last: last };
    var y = +last.slice(0, 4), prevM = +last.slice(5, 7);
    H.forEach(function (h, i) {
      if (i <= cols[cols.length - 1].col) return;
      var s = str(h);
      if (!/^\d{1,2}$/.test(s) || +s < 1 || +s > 12) return;
      var m = +s;
      if (m < prevM) y++;
      prevM = m;
      var first = y + '-' + (m < 10 ? '0' : '') + m + '-01';
      var d = first > last ? first : addDays(last, 1);
      cols.push({ col: i, date: d, month: true });
    });
    return { cols: cols, last: last };
  }

  // ── 결과 담기 ─────────────────────────────────────────
  function Report(file, typeLabel) {
    return { file: file.name, type: file.cls.type, typeLabel: typeLabel, customer: '', plant: file.cls.plant || '', group: file.cls.group || '', sheet: '', read: 0, collected: 0, excluded: {}, notes: [] };
  }
  function exclude(rep, reason, n) { rep.excluded[reason] = (rep.excluded[reason] || 0) + (n == null ? 1 : n); }

  // ── 3. 전체 처리 ─────────────────────────────────────
  /* files: [{ name, hash?, sheets: { names: [..], sheets: {시트: aoa} } }  또는  { name, pdf: [{x,y,str,page}] }]
     반환: { base, options, rows, files(파일별 집계), checks(★확인 필요), stock, shipments, lastBobcatDate } */
  function process(files, optsIn, now) {
    var o = mergeOptions(optsIn);
    var checks = [], reps = [], rows = [];
    var dates = {};
    files.forEach(function (f) { var d = fileDate(f.name); if (d) dates[d] = (dates[d] || 0) + 1; });
    var fileBase = Object.keys(dates).sort(function (a, b) { return dates[b] - dates[a] || b.localeCompare(a); })[0] || null;
    var base = o.base || fileBase || L.todayIso(now);
    function check(file, row, reason, detail) { checks.push({ file: file, row: row == null ? '' : row, reason: reason, detail: detail || '' }); }

    // 같은 파일이 두 번(번호 붙은 사본 등) 들어오면 한 번만
    var seen = {}, list = [];
    files.forEach(function (f) {
      var key = f.hash ? f.hash : null;
      if (key && seen[key]) { check(f.name, '', '같은 파일이 두 번 들어옴', '「' + seen[key] + '」와 내용이 같아 한 번만 반영했습니다'); return; }
      if (key) seen[key] = f.name;
      f.cls = classify(f.name);
      list.push(f);
    });

    // 발주서 여부는 내용으로
    list.forEach(function (f) {
      if (f.cls.type === 'po?') {
        f.po = f.sheets ? detectPo(f.sheets) : null;
        f.cls.type = f.po ? 'po' : 'unknown';
        if (!f.po) f.cls.why = '파일 이름에 종류(납품예정·누적결품·직송·밥캣·선적계획·재고)가 없고, 아는 발주서 머리행도 찾지 못했습니다';
      }
    });
    // 같은 종류가 두 개 이상이면 알림(둘 다 반영)
    var kinds = {};
    list.forEach(function (f) {
      if (f.cls.type === 'po' || f.cls.type === 'pdf' || f.cls.type === 'unknown') return;
      var k = f.cls.type + '|' + f.cls.group + '|' + f.cls.plant;
      if (kinds[k]) check(f.name, '', '같은 종류 파일이 둘 이상', '「' + kinds[k] + '」와 같은 종류로 판별되었습니다. 둘 다 반영했으니 날짜가 다른 파일인지 확인해 주세요');
      else kinds[k] = f.name;
    });

    function firstSheet(f) { var nm = f.sheets.names[0]; return { name: nm, aoa: f.sheets.sheets[nm] || [] }; }
    function portalCustomer(f) { return f.cls.group === '밥캣' ? o.bobcatCustomer : o.portalCustomer; }
    function add(f, rep, r, fields) {
      var row = Object.assign({ customer: rep.customer, plant: f.cls.plant || '', group: f.cls.group || '', name: '', orderDate: null, note: '', source: f.name, sheet: rep.sheet, row: r, price: null, currency: '' }, fields);
      if (row.price != null) row.priceSrc = '원본';
      if (row.currency && !isWon(row.currency)) check(f.name, r, '통화가 원화가 아님', row.item + ' · ' + row.currency + ' — 단가를 그대로 두었습니다(환산하지 않음)');
      rows.push(row); rep.collected++;
      return row;
    }
    // 같은 고객사·같은 품번의 단가(규칙으로 뺀 행 것도) — 단가 칸이 없는 줄을 채울 재료
    var priceIdx = {};
    function notePrice(customer, item, p, file) {
      if (p == null) return;
      var k = customer + '|' + item, x = priceIdx[k] || (priceIdx[k] = { values: [], files: [] });
      if (x.values.indexOf(p) < 0) x.values.push(p);
      if (x.files.indexOf(file) < 0) x.files.push(file);
    }

    // 3-1. 누적결품(엔진·밥캣)을 먼저 읽어 겹침 판단 재료를 만듭니다
    var engineShortKeys = {}, bobcatShortItems = {}, bobcatLast = null, hasBobcatShort = false;
    var bobcatPlanFiles = [], enginePlanRows = [];

    list.forEach(function (f) {
      var t = f.cls.type, rep;
      if (t === 'unknown') {
        rep = Report(f, TYPE_LABEL.unknown); reps.push(rep);
        check(f.name, '', '종류를 판별하지 못한 파일', f.cls.why || ''); return;
      }
      if (t === 'pdf') { reps.push(processPdf(f, o, check, rows, notePrice)); return; }
      if (!f.sheets) { rep = Report(f, TYPE_LABEL[t]); reps.push(rep); check(f.name, '', '파일을 읽지 못함', ''); return; }

      if (t === 'short' || t === 'bobcatShort') {
        rep = Report(f, TYPE_LABEL[t]); reps.push(rep);
        rep.customer = portalCustomer(f);
        var sh = firstSheet(f), aoa = sh.aoa; rep.sheet = sh.name;
        var isBob = t === 'bobcatShort';
        var m = pick(aoa, isBob ? LAYOUTS.bobcatShort : LAYOUTS.short);
        if (!m) { check(f.name, '', '머리행을 찾지 못함', '필요한 열: ' + (isBob ? LAYOUTS.bobcatShort : LAYOUTS.short).need.join(', ')); return; }
        var dc, startRow = m.hr + 1;
        if (isBob) {
          // 밥캣: 머리행은 B(D-Day)·B(D+1 Day)…, 바로 아래 행에 실제 날짜(0000/00/00 = 빈 칸)
          var drow = aoa[m.hr + 1] || [], cols = [], last = null;
          m.headers.forEach(function (h, i) {
            if (!/^B\s*\(D/i.test(str(h))) return;
            var d = parseDate(drow[i]);
            if (d) { cols.push({ col: i, date: d, month: false }); if (!last || d > last) last = d; }
          });
          dc = { cols: cols, last: last }; startRow = m.hr + 2;
          hasBobcatShort = true; bobcatLast = last;
          if (!cols.length) check(f.name, m.hr + 2, '날짜 행을 읽지 못함', 'B(D-Day) 아래 행에 날짜가 없습니다');
        } else {
          dc = shortDateCols(m.headers, o.monthBuckets);
          if (!dc.cols.length) check(f.name, m.hr + 1, '날짜 열을 찾지 못함', '「2026/09/29」 같은 날짜 머리가 없습니다');
          var mcols = dc.cols.filter(function (c) { return c.month; });
          if (mcols.length) rep.notes.push('월 단위 칸 ' + mcols.map(function (c) { return str(m.headers[c.col]); }).join('·') + '월은 그 달 첫날(일별 칸과 같은 달이면 일별 마지막 다음날)로 넣었습니다(가정)');
        }
        var reference = t === 'short' && f.cls.group === '건기';
        var offset = isBob ? o.bobcatShortOffset : o.engineShortOffset;
        var writeDate = f.cls.date || (dc.cols[0] && dc.cols[0].date) || null; // 요청 ②: 가능하면 작성일자 → 발주일자
        if (reference) rep.notes.push('요청 ①: 건기 누적결품은 참고자료라 수집하지 않습니다');
        else if (!isBob && f.cls.group !== '엔진') rep.notes.push(f.cls.group + ' 누적결품 규칙이 원문에 없어 엔진과 같은 규칙으로 넣었습니다(확인 부탁)');
        if (isBob && offset) rep.notes.push('밥캣 결품일 기준 납기를 ' + offset + '일 당겼습니다(2026-09-30 확정: 결품일 − 2일)');
        for (var r = startRow; r < aoa.length; r++) {
          var line = aoa[r] || [];
          if (blankRow(line)) continue;
          var item = str(line[m.item]);
          if (!item) { if (!isBob || r !== m.hr + 1) check(f.name, r + 1, '품목코드가 빈 행', ''); continue; }
          rep.read++;
          if (reference) { exclude(rep, '참고자료(건기 누적결품 — 요청 ①)'); continue; }
          var series = dc.cols.map(function (c) { return { date: c.date, v: num(line[c.col]), month: c.month }; });
          var bad = dc.cols.filter(function (c) { return str(line[c.col]) !== '' && num(line[c.col]) === null; });
          if (bad.length) check(f.name, r + 1, '결품 수량을 읽지 못한 칸', bad.map(function (c) { return colName(c.col) + '「' + str(line[c.col]) + '」'; }).join(', '));
          var steps = shortageSteps(series, o.shortMode);
          if (!steps.length) { exclude(rep, '결품(음수) 없음'); continue; }
          if (isBob) bobcatShortItems[item] = true;
          else engineShortKeys[(f.cls.plant || '') + '|' + item] = true;
          steps.forEach(function (s) {
            add(f, rep, r + 1, {
              item: item, name: str(line[m.name]), qty: s.qty, due: addDays(s.date, -offset), orderDate: writeDate,
              rule: '누적결품', shortDate: s.date,
              note: '결품일 ' + s.date + (offset ? ' − ' + offset + '일' : '') + (s.month ? ' · 월 단위 칸(날짜 가정)' : '')
            });
          });
        }
        return;
      }

      if (t === 'plan' || t === 'direct' || t === 'bobcatPlan' || t === 'bobcatDirect') {
        rep = Report(f, TYPE_LABEL[t] + (f.cls.group && t !== 'bobcatPlan' && t !== 'bobcatDirect' ? ' ' + f.cls.group : '')); reps.push(rep);
        rep.customer = portalCustomer(f);
        var isDirect = t === 'direct' || t === 'bobcatDirect';
        var sh2 = firstSheet(f), a2 = sh2.aoa; rep.sheet = sh2.name;
        var mp = t === 'bobcatPlan' || t === 'bobcatDirect' ? pick(a2, LAYOUTS.bobcatPlan) : portalLayout(a2);
        if (!mp) { check(f.name, '', '머리행을 찾지 못함', '품목코드(품번)·납품잔량·납기일자 열이 있어야 합니다'); return; }
        if (mp.layout === 'portalProd') rep.notes.push('생산오더 단위 양식(납품잔량 열 없음) — 요청수량을 수량, 납기일(Actual)을 납기, 생성일을 발주일로 읽었습니다');
        var bob = t === 'bobcatPlan' || t === 'bobcatDirect';
        if (bob) bobcatPlanFiles.push({ f: f, rep: rep, m: mp, aoa: a2, direct: isDirect });
        else {
          for (var r2 = mp.hr + 1; r2 < a2.length; r2++) {
            var ln = a2[r2] || [];
            if (blankRow(ln)) continue;
            var it = str(ln[mp.item]);
            if (!it) { check(f.name, r2 + 1, '품목코드가 빈 행', ''); continue; }
            rep.read++;
            var pr2 = priceOf(ln, mp);
            notePrice(rep.customer, it, pr2, f.name);
            if (isDirect && !o.collectDirect) { exclude(rep, '직송 — 수집 안 함 설정'); continue; }
            var ot = mp.orderType >= 0 ? str(ln[mp.orderType]) : '';
            if (f.cls.group === '엔진' && /^mass\s*po$/i.test(ot)) { exclude(rep, '오더유형 Mass PO(요청 ② — 엔진 납품예정 제외)'); continue; }
            var q = num(ln[mp.qty]), due = parseDate(ln[mp.due]);
            if (q === null) { check(f.name, r2 + 1, '수량을 읽지 못함', colName(mp.qty) + '「' + str(ln[mp.qty]) + '」'); continue; }
            if (q <= 0) { exclude(rep, '잔량 0'); continue; }
            if (!due) { check(f.name, r2 + 1, '납기일을 읽지 못함', colName(mp.due) + '「' + str(ln[mp.due]) + '」'); continue; }
            var extra = [];
            if (ot) extra.push(ot);
            if (mp.extra >= 0 && str(ln[mp.extra])) extra.push(str(ln[mp.extra]));
            var row = add(f, rep, r2 + 1, { item: it, name: str(ln[mp.name]), qty: q, due: due, orderDate: mp.orderDate >= 0 ? parseDate(ln[mp.orderDate]) : null, rule: isDirect ? '직송' : '납품예정', note: extra.join(' · '), price: pr2, currency: currencyOf(ln, mp) });
            if (f.cls.group === '엔진') enginePlanRows.push({ row: row, rep: rep });
          }
          if (isDirect && !o.collectDirect) rep.notes.push('직송 수집을 끈 설정이라 넣지 않았습니다(2026-09-30 확정 기본값은 납품예정과 같이 넣음)');
          else if (isDirect) rep.notes.push('직송도 납품예정과 같은 규칙으로 수주에 넣었습니다(2026-09-30 확정)');
          if (f.cls.group === 'AM' || f.cls.group === 'CKD') rep.notes.push(f.cls.group + ' 는 건기 납품예정과 같이(납품잔량·납기일자) 넣었습니다(2026-09-30 확정)');
        }
        return;
      }

      if (t === 'po') { reps.push(processPo(f, o, check, add, notePrice)); return; }
      if (t === 'shipplan' || t === 'stock') { reps.push(processSide(f, t, check)); return; }
    });

    // 3-2. 엔진: 같은 공장·같은 품번에 누적결품이 있으면 납품예정 행을 뺌(결품 우선, 기본)
    if (o.engineMode === 'override') {
      var drop = [];
      enginePlanRows.forEach(function (x) {
        if (engineShortKeys[(x.row.plant || '') + '|' + x.row.item]) { drop.push(x.row); x.rep.collected--; exclude(x.rep, '같은 공장 누적결품에 같은 품번 — 결품 우선'); }
      });
      if (drop.length) rows = rows.filter(function (r) { return drop.indexOf(r) < 0; });
    }

    // 3-3. 밥캣 납품예정: 위블록(누적결품 결품 품번)과 겹치는 일반 행 제외, 원납기를 [기준일 ~ 결품 마지막 날짜]로 조임
    bobcatPlanFiles.forEach(function (x) {
      var f = x.f, rep = x.rep, mp = x.m, a = x.aoa;
      if (!hasBobcatShort) rep.notes.push('밥캣 누적결품 파일이 없어 겹침 제외와 마지막 날짜 조임을 하지 못했습니다(기준일 쪽만 조임)');
      for (var r = mp.hr + 1; r < a.length; r++) {
        var ln = a[r] || [];
        if (blankRow(ln)) continue;
        var it = str(ln[mp.item]);
        if (!it) { check(f.name, r + 1, '품번이 빈 행', ''); continue; }
        rep.read++;
        var pb = priceOf(ln, mp);
        notePrice(rep.customer, it, pb, f.name);
        if (x.direct && !o.collectDirect) { exclude(rep, '직송 — 수집 안 함 설정'); continue; }
        if (bobcatShortItems[it]) { exclude(rep, '누적결품(위블록) 품번과 겹침 — 결품 값 우선(매크로 규칙)'); continue; }
        var q = num(ln[mp.qty]), due = parseDate(ln[mp.due]);
        if (q === null) { check(f.name, r + 1, '수량을 읽지 못함', colName(mp.qty) + '「' + str(ln[mp.qty]) + '」'); continue; }
        if (q <= 0) { exclude(rep, '잔량 0'); continue; }
        if (!due) { check(f.name, r + 1, '납기일을 읽지 못함', colName(mp.due) + '「' + str(ln[mp.due]) + '」'); continue; }
        var c = clampDue(due, base, bobcatLast);
        var notes = [];
        if (mp.orderType >= 0 && str(ln[mp.orderType])) notes.push(str(ln[mp.orderType]));
        if (c !== due) notes.push('원납기 ' + due + ' → ' + c + (c === base ? '(과거 → 기준일)' : '(마지막 날짜로 조임)'));
        add(f, rep, r + 1, { item: it, name: str(ln[mp.name]), qty: q, due: c, originalDue: due, orderDate: mp.orderDate >= 0 ? parseDate(ln[mp.orderDate]) : null, rule: x.direct ? '밥캣 직송' : '밥캣 납품예정', note: notes.join(' · '), price: pb, currency: currencyOf(ln, mp) });
      }
      if (x.direct && !o.collectDirect) rep.notes.push('직송 수집을 끈 설정이라 넣지 않았습니다(2026-09-30 확정 기본값은 넣음)');
      else if (x.direct) rep.notes.push('밥캣 직송도 납품예정 일반과 같은 규칙(위블록 겹침 제외·원납기 조임)으로 넣었습니다(2026-09-30 확정)');
    });

    // 3-4. 단가 칸이 없는 줄(누적결품·단가 열 없는 양식) — 같은 고객사·같은 품번의 다른 파일 단가가 하나뿐이면 그 값(원본(같은 품번))
    var priceMulti = {};
    rows.forEach(function (r) {
      if (r.price != null) return;
      var x = priceIdx[r.customer + '|' + r.item];
      if (!x) return;
      if (x.values.length > 1) { priceMulti[r.customer + '|' + r.item] = x.values.length; r.priceNote = '같은 품번 단가 ' + x.values.length + '가지 — 채우지 않음'; return; }
      if (!o.borrowPrice) return;
      r.price = x.values[0]; r.priceSrc = '원본(같은 품번)'; r.priceNote = '단가 = ' + x.files.join(', ');
    });
    rows.sort(function (a, b) { return a.due.localeCompare(b.due) || a.item.localeCompare(b.item) || a.source.localeCompare(b.source); });
    var side = { stock: null, shipments: null };
    list.forEach(function (f) { if (f._side) side[f.cls.type === 'stock' ? 'stock' : 'shipments'] = (side[f.cls.type === 'stock' ? 'stock' : 'shipments'] || []).concat(f._side); });
    var multiItems = Object.keys(priceMulti).length, idxMulti = Object.keys(priceIdx).filter(function (k) { return priceIdx[k].values.length > 1; }).length;
    return { base: base, fileBase: fileBase, options: o, rows: rows, files: reps, checks: checks, stock: side.stock, shipments: side.shipments, lastBobcatDate: bobcatLast,
      priceInfo: { items: Object.keys(priceIdx).length, multiItems: idxMulti, blockedItems: multiItems } };
  }

  /** 밥캣 원납기 조임(매크로 4-3): 과거 → 기준일, 마지막 날짜 뒤 → 마지막 날짜 */
  function clampDue(due, base, last) {
    if (due < base) return base;
    if (last && due > last) return last >= base ? last : base;
    return due;
  }

  // ── 3-4. 선적계획·창고별재고현황 → 기존 입력 ③·② ────────
  /** 사내 완제품 품번: 품목코드 안에 「완제품」 글자가 든 것(앞·뒤·[완제품] 모두). 글자는 떼지 않습니다 */
  function isFinishedCode(code) { return /완제품/.test(str(code)); }
  function processSide(f, t, check) {
    var rep = Report(f, TYPE_LABEL[t]);
    var lay = LAYOUTS[t];
    // 시트가 여럿이면 머리행을 찾을 수 있는 첫 시트
    var nm = null, m = null;
    f.sheets.names.some(function (n) { var mm = pick(f.sheets.sheets[n] || [], lay); if (mm) { nm = n; m = mm; return true; } return false; });
    if (!m) { check(f.name, '', '머리행을 찾지 못함', '필요한 열: ' + lay.need.join(', ')); f._side = []; return rep; }
    rep.sheet = nm;
    var aoa = f.sheets.sheets[nm], out = [], finished = 0;
    for (var r = m.hr + 1; r < aoa.length; r++) {
      var ln = aoa[r] || [];
      if (blankRow(ln)) continue;
      var raw = str(ln[m.item]);
      var first = str(ln[0]);
      if (!raw) {
        // 소계·합계·출력 시각 행은 표 밖 줄이라 세지 않고 알림만
        if (/계$|합계|^\d{4}[\/.\-]\d{2}[\/.\-]\d{2}\s.*\d{1,2}:\d{2}/.test(first)) { rep.read++; exclude(rep, '소계·합계·출력시각 행'); continue; }
        check(f.name, r + 1, '품목코드가 빈 행', first ? '첫 칸「' + first + '」' : ''); continue;
      }
      rep.read++;
      if (/^합계$/.test(first)) { exclude(rep, '소계·합계·출력시각 행'); continue; }
      if (t === 'shipplan') {
        var item = raw.replace(/\s*\(CI\)\s*$/i, '');   // 요청 ⑤: 품목코드 끝 (CI) 삭제
        var q = num(ln[m.qty]);
        var d = m.due >= 0 ? parseDate(ln[m.due]) : null, usedDue2 = false;
        if (!d && m.due2 >= 0) { d = parseDate(ln[m.due2]); usedDue2 = !!d; }
        if (q === null || q < 0) { check(f.name, r + 1, '미판매수량을 읽지 못함', '「' + str(ln[m.qty]) + '」'); continue; }
        if (q === 0) { exclude(rep, '미판매수량 0'); continue; }
        if (!d) { check(f.name, r + 1, '선적요청일을 읽지 못함', '변경선적요청일·납기일자가 모두 비었습니다'); continue; }
        if (usedDue2) check(f.name, r + 1, '변경선적요청일이 비어 납기일자를 씀', item + ' · ' + d);
        out.push({ item: item, name: str(ln[m.name]), shipDate: d, qty: q, fileArrival: null, row: r + 1, originalItem: raw });
      } else {
        var s = num(ln[m.qty]);
        if (s === null) { check(f.name, r + 1, '합계(재고)를 읽지 못함', '「' + str(ln[m.qty]) + '」'); continue; }
        // 확정(2026-09-30): 「완제품」이 붙은 품번은 사내 완제품 품번 — 떼지 않고 그대로, 정확히 같은 품번끼리만 맞춥니다
        if (isFinishedCode(raw)) finished++;
        else if (/[가-힣]/.test(raw)) check(f.name, r + 1, '품목코드에 한글이 붙어 있음', '「' + raw + '」 — 수주 품번과 맞지 않을 수 있습니다');
        var sf = m.safety >= 0 ? num(ln[m.safety]) : null;
        out.push({ item: raw, name: str(ln[m.name]), current: s, available: null, safety: sf, row: r + 1 });
      }
      rep.collected++;
    }
    if (t === 'shipplan') {
      var stripped = out.filter(function (x) { return x.originalItem !== x.item; }).length;
      rep.notes.push('품목코드 끝 (CI) ' + stripped + '건 삭제 · 미판매수량 → 선적수량 · 변경선적요청일 → 중국 선적예정일로 넘깁니다');
    } else {
      rep.notes.push('합계 → 현재고로 넘깁니다' + (m.safety >= 0 ? ' · 안전재고 열도 함께' : ''));
      if (finished) rep.notes.push('「완제품」이 붙은 사내 완제품 품번 ' + finished + '개는 그대로 넣었습니다(2026-09-30 확정 — 떼지 않음)');
    }
    f._side = out;
    return rep;
  }

  // ── 4. 발주서 (요청 ③) — 고객사마다 양식이 달라 머리행 이름으로 양식을 알아봅니다 ─────
  /* 목록형 양식 A~C 는 열 이름, 서식형(D) 은 「품번」「발주수량/발주량」 표 + 「발주일」「납기일」 칸 */
  var PO_LIST = [
    { id: 'A', label: '목록형 A (자재코드·납품서잔량·납기요청일·결재일자)', need: ['자재코드', '납품서잔량', '납기요청일'], item: ['자재코드'], name: ['자재내역'], qty: ['납품서잔량'], due: ['납기요청일'], orderDate: ['결재일자'], price: ['단가'], currency: ['화폐'] },
    { id: 'B', label: '목록형 B (자재코드·납품 가능 수량·납기요청일시·수주일자)', need: ['자재코드', '납품 가능 수량', '납기요청일시'], item: ['자재코드'], name: ['자재명'], qty: ['납품 가능 수량'], due: ['납기요청일시'], orderDate: ['수주일자'], price: ['단가'], currency: ['통화'] },
    { id: 'C', label: '목록형 C (품목번호·입력가능수량·납기일자·발주일자)', need: ['품목번호', '입력가능수량', '납기일자'], item: ['품목번호'], name: ['품목명'], qty: ['입력가능수량'], due: ['납기일자'], orderDate: ['발주일자'], price: ['발주단가'], priceUnit: ['가격단위'], currency: ['통화'] }
  ];
  function formHeader(aoa) {
    for (var r = 0; r < Math.min(aoa.length, 40); r++) {
      var hs = (aoa[r] || []).map(norm), ci = hs.indexOf('품번');
      if (ci < 0) continue;
      var qi = -1;
      hs.forEach(function (h, i) { if (qi < 0 && /^발주(수)?량/.test(h)) qi = i; });
      if (qi < 0) continue;
      return { hr: r, item: ci, name: hs.indexOf('품명'), qty: qi, memo: hs.indexOf('비고'), price: hs.indexOf('단가') };
    }
    return null;
  }
  function detectPo(sheets) {
    for (var s = 0; s < sheets.names.length; s++) {
      var aoa = sheets.sheets[sheets.names[s]] || [];
      for (var i = 0; i < PO_LIST.length; i++) if (findHeader(aoa, PO_LIST[i].need) >= 0) return { kind: 'list', def: PO_LIST[i] };
      if (formHeader(aoa)) return { kind: 'form', def: { id: 'D', label: '서식형 D (품번·발주수량 표 + 발주일·납기일 칸)' } };
    }
    return null;
  }
  /** 서식에서 「라벨 → 오른쪽 첫 값」 날짜. 라벨은 norm 값이 re 에 맞는 칸 */
  function labelDate(aoa, re, maxRow) {
    for (var r = 0; r < Math.min(aoa.length, maxRow || aoa.length); r++) {
      var line = aoa[r] || [];
      for (var c = 0; c < line.length; c++) {
        if (!re.test(norm(line[c]))) continue;
        for (var k = c + 1; k < line.length; k++) if (str(line[k]) !== '') { var d = parseDate(line[k]); if (d) return { date: d, row: r + 1 }; break; }
      }
    }
    return null;
  }
  /** 머리 칸 날짜: 날짜 값·날짜 글자, 숫자는 2000~2099년 엑셀 날짜 번호일 때만 */
  function headDate(v) {
    if (typeof v === 'number') return v >= 36526 && v <= 73050 ? parseDate(v) : null;
    return parseDate(v);
  }
  function processPo(f, o, check, add, notePrice) {
    var rep = Report(f, TYPE_LABEL.po + ' · ' + f.po.def.label);
    rep.customer = customerFromName(f.name); rep.group = '발주서';
    if (f.po.kind === 'list') {
      var def = f.po.def, done = false;
      f.sheets.names.forEach(function (nm) {
        if (done) return;
        var aoa = f.sheets.sheets[nm] || [], m = pick(aoa, def);
        if (!m) return;
        done = true; rep.sheet = nm;
        for (var r = m.hr + 1; r < aoa.length; r++) {
          var ln = aoa[r] || [];
          if (blankRow(ln)) continue;
          var it = str(ln[m.item]);
          if (!it) { check(f.name, r + 1, '품번이 빈 행', ''); continue; }
          rep.read++;
          var pp = priceOf(ln, m);
          notePrice(rep.customer, it, pp, f.name);
          var q = num(ln[m.qty]), due = parseDate(ln[m.due]);
          if (q === null) { check(f.name, r + 1, '수량을 읽지 못함', colName(m.qty) + '「' + str(ln[m.qty]) + '」'); continue; }
          if (q <= 0) { exclude(rep, '잔량 0'); continue; }
          if (!due) { check(f.name, r + 1, '납기일을 읽지 못함', colName(m.due) + '「' + str(ln[m.due]) + '」'); continue; }
          add(f, rep, r + 1, { customer: rep.customer, plant: '', group: '발주서', item: it, name: str(ln[m.name]), qty: q, due: due, orderDate: m.orderDate >= 0 ? parseDate(ln[m.orderDate]) : null, rule: '발주서 ' + def.id, price: pp, currency: currencyOf(ln, m) });
        }
      });
      return rep;
    }
    // 서식형: 시트마다 발주서 한 장. 기본은 발주일자가 가장 늦은 시트만
    var forms = [];
    f.sheets.names.forEach(function (nm, idx) {
      var aoa = f.sheets.sheets[nm] || [], h = formHeader(aoa);
      if (!h) return;
      var od = labelDate(aoa, /^발주일(자)?$/, h.hr + 1);
      forms.push({ nm: nm, idx: idx, aoa: aoa, h: h, od: od ? od.date : null });
    });
    var pickForms = forms;
    if (!o.poAllSheets && forms.length > 1) {
      var best = forms.slice().sort(function (a, b) { return (a.od || '').localeCompare(b.od || '') || a.idx - b.idx; }).pop();
      pickForms = [best];
      rep.notes.push('발주서 시트 ' + forms.length + '장 중 발주일자가 가장 늦은 「' + best.nm + '」만 읽었습니다(나머지는 지난 발주서로 봄 — 설정에서 전부 읽기 가능)');
    }
    rep.sheet = pickForms.map(function (x) { return x.nm; }).join(', ');
    forms.forEach(function (x) {
      var aoa = x.aoa, h = x.h, used = pickForms.indexOf(x) >= 0;
      // 표 아래 날짜 행이 있으면 「날짜별 수량」 서식(열마다 요청납기일)
      // 품번 칸이 비어 있어야 날짜 행입니다(첫 품목 행의 수량 200 을 엑셀 날짜 번호로 읽지 않도록)
      var drow = str((aoa[h.hr + 1] || [])[h.item]) === '' ? (aoa[h.hr + 1] || []) : [], dateCols = [], badHeads = [];
      var endCol = h.memo > h.qty ? h.memo : (aoa[h.hr] || []).length;
      for (var c = h.qty; c < Math.max(endCol, drow.length); c++) {
        if (h.memo >= 0 && c >= h.memo) break;
        if (str(drow[c]) === '') continue;
        var d = headDate(drow[c]);
        if (d) dateCols.push({ col: c, date: d }); else badHeads.push({ col: c, text: str(drow[c]) });
      }
      var multi = dateCols.length > 0;
      var due = multi ? null : labelDate(aoa, /^납기일(자)?$/);
      var first = multi ? h.hr + 2 : h.hr + 1;
      if (used && badHeads.length) check(f.name, h.hr + 2, '날짜로 읽지 못한 수량 칸 머리', '시트「' + x.nm + '」 ' + badHeads.map(function (b) { return colName(b.col) + '「' + b.text + '」'; }).join(', ') + ' — 이 칸의 수량은 넣지 않았습니다');
      for (var r = first; r < aoa.length; r++) {
        var ln = aoa[r] || [];
        var lead = norm(ln[0]);
        if (/^합계|^납기일자/.test(lead)) break;
        var it = str(ln[h.item]);
        var qCells = multi ? dateCols.map(function (dc) { return { v: ln[dc.col], date: dc.date, col: dc.col }; }) : [{ v: ln[h.qty], date: due ? due.date : null, col: h.qty }];
        var anyQ = qCells.some(function (q) { return str(q.v) !== ''; });
        if (!it) {
          if (anyQ && used) check(f.name, r + 1, '품번 없이 수량만 있는 칸', '시트「' + x.nm + '」 ' + qCells.filter(function (q) { return str(q.v) !== ''; }).map(function (q) { return colName(q.col) + '「' + str(q.v) + '」'; }).join(', '));
          continue;
        }
        if (/^※/.test(it)) continue; // 서식 안내문(택배 주소 등)
        if (/^(소계|합계)$/.test(norm(it))) break; // 표 끝
        if (!used) { rep.read++; exclude(rep, '지난 발주서 시트'); continue; }
        rep.read++;
        var fp = !multi && h.price > h.qty ? priceOf(ln, { price: h.price }) : null;
        notePrice(rep.customer, it, fp, f.name);
        if (!anyQ) { exclude(rep, '수량 칸 비어 있음(이번 발주 없음)'); continue; }
        qCells.forEach(function (q) {
          if (str(q.v) === '') return;
          var n = num(q.v);
          if (n === null || n < 0) { check(f.name, r + 1, n === null ? '수량을 읽지 못함' : '수량이 음수(취소·조정?)', '시트「' + x.nm + '」 ' + colName(q.col) + '「' + str(q.v) + '」'); return; }
          if (n === 0) { exclude(rep, '잔량 0'); return; }
          if (!q.date) { check(f.name, r + 1, '납기일을 찾지 못함', '시트「' + x.nm + '」 「납기일」 칸이 비었습니다 · ' + it + ' ' + n); return; }
          add(f, rep, r + 1, { customer: rep.customer, plant: '', group: '발주서', sheet: x.nm, item: it, name: h.name >= 0 ? str(ln[h.name]) : '', qty: n, due: q.date, orderDate: x.od, rule: '발주서 D', price: fp });
        });
      }
    });
    return rep;
  }

  // ── 5. PDF 발주서 — pdf.js 텍스트 조각(글자·좌표)으로 표를 다시 짭니다 ─────
  /* items: [{x, y, str, page}] (y 는 위로 갈수록 큼). 반환 {orderDate, due, lines:[{item,name,qty,y}], problems:[]} */
  function lines(items, tol) {
    var ls = [];
    items.slice().sort(function (a, b) { return b.y - a.y || a.x - b.x; }).forEach(function (it) {
      var l = ls.filter(function (x) { return Math.abs(x.y - it.y) <= tol; })[0];
      if (!l) { l = { y: it.y, items: [] }; ls.push(l); }
      l.items.push(it);
    });
    ls.forEach(function (l) { l.items.sort(function (a, b) { return a.x - b.x; }); l.text = l.items.map(function (i) { return i.str; }).join(' '); l.flat = l.items.map(function (i) { return i.str; }).join('').replace(/\s+/g, ''); });
    return ls;
  }
  var DATE_RE = /(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})/;
  function parsePdfOrder(items) {
    var out = { orderDate: null, due: null, lines: [], problems: [] };
    var its = (items || []).filter(function (i) { return str(i.str) !== ''; });
    var ls = lines(its, 2.5);
    ls.forEach(function (l) {
      var m;
      // 글자가 한 글자씩 흩어지거나(「납 기」) 붙어 나오므로 공백을 뺀 줄(flat)에서 라벨 뒤 첫 날짜를 찾습니다
      var k;
      if (!out.orderDate && (k = l.flat.search(/일련번호|발주일/)) >= 0 && (m = l.flat.slice(k).match(DATE_RE))) out.orderDate = parseDate(m[1] + '-' + m[2] + '-' + m[3]);
      if (!out.due && (k = l.flat.search(/납기일/)) >= 0 && (m = l.flat.slice(k).match(DATE_RE))) out.due = parseDate(m[1] + '-' + m[2] + '-' + m[3]);
    });
    var head = ls.filter(function (l) { return /품목코드/.test(l.flat); })[0];
    if (!head) { out.problems.push('「품목코드」 머리를 찾지 못했습니다'); return out; }
    // 머리 글자가 한 글자씩 흩어져 있어, 「수」「량」 연속·「단」「가」 연속 위치로 열 경계를 잡습니다
    function seqX(a, b) {
      var near = its.filter(function (i) { return Math.abs(i.y - head.y) <= 8; }).sort(function (p, q) { return p.x - q.x; });
      for (var i = 0; i < near.length; i++) {
        var s = near[i].str.replace(/\s/g, '');
        if (s === a + b || s.indexOf(a + b) === 0) return near[i].x;
        if (s === a) { var nx = near.filter(function (q) { return q !== near[i] && Math.abs(q.y - near[i].y) < 1 && q.x > near[i].x && q.x - near[i].x < 14; })[0]; if (nx && nx.str.replace(/\s/g, '').charAt(0) === b) return near[i].x; }
      }
      return null;
    }
    var qtyX = seqX('수', '량'), priceX = seqX('단', '가');
    var codeX = head.items[0].x;
    if (qtyX === null) { out.problems.push('「수량」 머리를 찾지 못했습니다'); return out; }
    var foot = ls.filter(function (l) { return l.y < head.y - 3 && /^수량/.test(l.flat) && /(공급가액|합계)/.test(l.flat); })[0];
    var floorY = foot ? foot.y + 3 : -Infinity;
    var body = its.filter(function (i) { return i.y < head.y - 6 && i.y > floorY; });
    var qtys = body.filter(function (i) { return i.x >= qtyX - 20 && (priceX === null || i.x < priceX - 1) && L.parseQty(i.str) !== null; });
    if (!qtys.length) { out.problems.push('수량 칸에서 숫자를 찾지 못했습니다'); return out; }
    var left = Math.min.apply(null, body.map(function (i) { return i.x; }));
    if (Math.abs(left - codeX) > 20) out.problems.push('품목코드 열 위치가 머리와 다릅니다 — 원본과 대조해 주세요');
    var rowsOut = qtys.map(function (q) { return { y: q.y, qty: L.parseQty(q.str), code: [], name: [] }; });
    function nearest(y) { var best = null; rowsOut.forEach(function (r) { if (!best || Math.abs(r.y - y) < Math.abs(best.y - y)) best = r; }); return best; }
    body.forEach(function (i) {
      if (qtys.indexOf(i) >= 0) return;
      if (i.x >= qtyX - 20) return; // 단가·금액
      var r = nearest(i.y);
      if (Math.abs(r.y - i.y) > 16) return;
      (i.x <= left + 8 ? r.code : r.name).push(i);
    });
    // 단가·공급가액: 같은 줄에서 수량 오른쪽 숫자를 차례로(단가 → 공급가액 → 부가세). 머리에 「단가」가 없으면 읽지 않습니다
    rowsOut.forEach(function (r) {
      r.price = null; r.supply = null;
      if (priceX === null) return;
      var q = qtys.filter(function (i) { return i.y === r.y; })[0];
      var right = body.filter(function (i) { return i !== q && Math.abs(i.y - r.y) <= 2.5 && i.x > q.x + 5 && L.parseQty(i.str) !== null; }).sort(function (a, b) { return a.x - b.x; });
      if (right.length) { var pv = L.parseQty(right[0].str); r.price = pv > 0 ? pv : null; }
      if (right.length > 1) r.supply = L.parseQty(right[1].str);
    });
    rowsOut.forEach(function (r) {
      var code = r.code.sort(function (a, b) { return b.y - a.y || a.x - b.x; }).map(function (i) { return str(i.str); }).join('');
      var name = r.name.sort(function (a, b) { return b.y - a.y || a.x - b.x; }).map(function (i) { return str(i.str); }).join(' ');
      out.lines.push({ item: code, name: name, qty: r.qty, y: r.y, price: r.price, supply: r.supply });
    });
    return out;
  }
  function processPdf(f, o, check, rows, notePrice) {
    var rep = Report(f, TYPE_LABEL.pdf);
    rep.customer = customerFromName(f.name); rep.group = '발주서';
    if (!f.pdf) { check(f.name, '', 'PDF 글자를 꺼내지 못함', f.pdfError || '스캔 이미지 PDF 이면 글자가 없습니다'); return rep; }
    var p = parsePdfOrder(f.pdf);
    p.problems.forEach(function (x) { check(f.name, '', 'PDF 표 읽기', x); });
    p.lines.forEach(function (ln, i) {
      rep.read++;
      if (!ln.item) { check(f.name, 'p' + (i + 1), '품목코드를 읽지 못함', '수량 ' + ln.qty); return; }
      if (!p.due) { check(f.name, 'p' + (i + 1), '납기일을 찾지 못함', ln.item + ' ' + ln.qty); return; }
      notePrice(rep.customer, ln.item, ln.price, f.name);
      if (ln.price != null && ln.supply != null && Math.abs(ln.price * ln.qty - ln.supply) > 1) check(f.name, 'p' + (i + 1), 'PDF 단가 × 수량이 공급가액과 다름', ln.item + ' — 원본과 대조해 주세요');
      rows.push({ customer: rep.customer, plant: '', group: '발주서', item: ln.item, name: ln.name, qty: ln.qty, due: p.due, orderDate: p.orderDate, source: f.name, sheet: '', row: 'p' + (i + 1), rule: '발주서 PDF', note: 'PDF 글자에서 읽음 — 원본과 대조해 주세요', price: ln.price, priceSrc: ln.price != null ? '원본' : undefined, currency: '' });
      rep.collected++;
    });
    if (p.lines.length) rep.notes.push('PDF 에서 글자를 꺼내 읽었습니다(발주일 = 일련번호 날짜, 납기 = 「납기일자」). 품목코드가 두 줄로 나뉘어 있으면 이어 붙였습니다');
    return rep;
  }

  // ── 6. 내보내기·넘기기 ─────────────────────────────────
  // 품목코드 = 고객사 품번(파일 그대로), 천일품번 = 매핑표로 바꾼 당사 품번(기획서 11.10). 매핑 전 행은 천일품번 칸이 품목코드와 같습니다
  var MAP_LABEL = { mapped: '매핑됨', conflict: '매핑 충돌', unmapped: '매핑 없음', nomap: '매핑표 없음', none: '매핑 대상 아님' };
  // 단가 두 가지(2026-09-30 두 번째 답변, 기획서 11.12)
  //   판매단가(고객 발주) = 원본 칸(가격단위로 나눔) · 같은 품번 다른 파일 — 참고용. 행의 price · priceSrc
  //   매입단가(생산처 발주) = 매입단가표 · 직접입력(price.js). 행의 buyPrice · buySrc · maker
  var HEAD = ['고객사', '공장', '구분', '품목코드', '천일품번', '매핑', '품명', '수량',
    '판매단가(고객 발주)', '판매금액', '판매단가 출처', '매입단가(생산처 발주)', '매입금액', '생산처', '매입단가 출처',
    '납기일', '발주일', '원본파일', '원본 시트', '원본 행', '규칙', '비고'];
  var MARGIN_HEAD = ['판매−매입(단가)', '판매−매입(금액)'];
  function amountOf(r) { return r.price == null ? null : Math.round(r.qty * r.price * 100) / 100; }
  function buyAmountOf(r) { return r.buyPrice == null ? null : Math.round(r.qty * r.buyPrice * 100) / 100; }
  function blank(v) { return v == null ? '' : v; }
  /** opts.margin = true 면 매입단가 출처 뒤에 「판매−매입」 두 열 */
  function rowsAoa(rows, opts) {
    var mg = !!(opts && opts.margin), H = HEAD.slice();
    if (mg) H.splice(H.indexOf('매입단가 출처') + 1, 0, MARGIN_HEAD[0], MARGIN_HEAD[1]);
    return [H].concat(rows.map(function (r) {
      var a = amountOf(r), b = buyAmountOf(r);
      var line = [r.customer, r.plant, r.group, r.item, r.company || r.item, MAP_LABEL[r.mapStatus] || '', r.name, r.qty,
        blank(r.price), blank(a), r.price == null ? '판매단가 없음' : (r.priceSrc || '원본'),
        blank(r.buyPrice), blank(b), r.maker || '', r.buyPrice == null ? '매입단가 없음' : (r.buySrc || ''),
        r.due, r.orderDate || '', r.source, r.sheet || '', r.row, r.rule || '', [r.note, r.priceNote].filter(Boolean).join(' · ')];
      if (mg) line.splice(15, 0, blank(r.margin), blank(r.marginAmount));
      return line;
    }));
  }
  function excludedText(rep) { return Object.keys(rep.excluded).map(function (k) { return k + ' ' + rep.excluded[k]; }).join(' / '); }
  function excludedCount(rep) { return Object.keys(rep.excluded).reduce(function (s, k) { return s + rep.excluded[k]; }, 0); }
  function exportSheets(res, opts) {
    var s = {};
    s['통합수주'] = rowsAoa(res.rows, opts);
    var ps = priceBySource(res.rows);
    s['파일별집계'] = [['원본파일', '판별', '고객사', '공장', '구분', '시트', '읽은 행', '수집', '판매단가 있음', '판매단가 없음', '제외', '제외 사유', '메모']].concat(res.files.map(function (f) {
      var p = ps[f.file] || { has: 0, none: 0 };
      return [f.file, f.typeLabel, f.customer, f.plant, f.group, f.sheet, f.read, f.collected, p.has, p.none, excludedCount(f), excludedText(f), f.notes.join(' / ')];
    }));
    s['★확인필요'] = [['원본파일', '행', '내용', '자세히']].concat(res.checks.map(function (c) { return [c.file, c.row, c.reason, c.detail]; }));
    s['수주현황'] = ordersAoa(res.rows);
    if (res.stock) s['재고현황'] = L.dataSheets({ stock: res.stock })['재고현황'];
    if (res.shipments) s['선적예정'] = L.dataSheets({ shipments: res.shipments })['선적예정'];
    return s;
  }
  /** 통합 표 → 이 도구의 입력 ①「수주현황」 표준 열(자동 매핑됩니다). 품번 = 천일품번(재고·선적계획과 맞추는 값).
      고객사 품번·매핑·공장·구분·원본은 뒤에 덧붙입니다 */
  function ordersAoa(rows) {
    return [['품번', '품명', '고객사', '수주일', '납기일', '수주수량', '공장', '구분', '고객사 품목코드', '매핑', '원본파일', '원본 행', '판매단가(고객 발주)', '판매금액', '매입단가(생산처 발주)', '매입금액']].concat(rows.map(function (r) {
      var a = amountOf(r), b = buyAmountOf(r);
      return [r.company || r.item, r.name, r.customer, r.orderDate || '', r.due, r.qty, r.plant, r.group, r.item, MAP_LABEL[r.mapStatus] || '', r.source, r.row, blank(r.price), blank(a), blank(r.buyPrice), blank(b)];
    }));
  }
  /** 원본파일마다 판매단가(고객 발주 단가 칸) 있는 줄·없는 줄 */
  function priceBySource(rows) {
    var o = {};
    rows.forEach(function (r) { var x = o[r.source] || (o[r.source] = { has: 0, none: 0 }); if (r.price == null) x.none++; else x.has++; });
    return o;
  }
  function summary(res) {
    var read = 0, ex = 0;
    res.files.forEach(function (f) { read += f.read; ex += excludedCount(f); });
    var qty = res.rows.reduce(function (s, r) { return s + r.qty; }, 0);
    var priced = res.rows.filter(function (r) { return r.price != null; }).length;
    return { files: res.files.length, read: read, rows: res.rows.length, qty: qty, excluded: ex, checks: res.checks.length, priced: priced, unpriced: res.rows.length - priced };
  }

  return {
    defaultOptions: defaultOptions, mergeOptions: mergeOptions, upgradeOptions: upgradeOptions, classify: classify, fileDate: fileDate, customerFromName: customerFromName,
    TYPE_LABEL: TYPE_LABEL, LAYOUTS: LAYOUTS, PO_LIST: PO_LIST,
    shortageSteps: shortageSteps, shortDateCols: shortDateCols, clampDue: clampDue, detectPo: detectPo, parsePdfOrder: parsePdfOrder,
    process: process, rowsAoa: rowsAoa, amountOf: amountOf, buyAmountOf: buyAmountOf, HEAD: HEAD, MARGIN_HEAD: MARGIN_HEAD, priceBySource: priceBySource, ordersAoa: ordersAoa, exportSheets: exportSheets, summary: summary, excludedText: excludedText, excludedCount: excludedCount,
    fixZip: fixZip, num: num, colName: colName, isFinishedCode: isFinishedCode, RULES_VERSION: RULES_VERSION
  };

  // ── xlsx 안 XML 의 「<si >」 같은 공백 태그 고치기 ─────────
  /* 고객사 포털에서 내려받은 xlsx 는 공유 문자열이 <si > 로 적혀 있어 SheetJS 0.18.5 가 글자 칸을 모두 빈칸으로 읽습니다
     (숫자·날짜만 보임). 압축을 풀어 태그 공백만 지우고 다시 묶은 뒤 읽습니다. 고칠 것이 없으면 원본 그대로 돌려줍니다. */
  function fixZip(u8, XLSX) {
    if (!u8 || u8.length < 4 || u8[0] !== 0x50 || u8[1] !== 0x4b || !XLSX || !XLSX.CFB) return u8;
    var cfb;
    try { cfb = XLSX.CFB.read(u8, { type: 'array' }); } catch (e) { return u8; }
    var changed = 0;
    var dec = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null, enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    if (!dec || !enc) return u8;
    cfb.FileIndex.forEach(function (fi) {
      if (fi.type !== 2 || !/\.(xml|rels)$/i.test(fi.name) || !fi.content) return;
      var bytes = fi.content instanceof Uint8Array ? fi.content : new Uint8Array(fi.content);
      var s = dec.decode(bytes), t = s.replace(/<([A-Za-z_][\w:.\-]*) >/g, '<$1>');
      if (t !== s) { changed++; fi.content = enc.encode(t); fi.size = fi.content.length; }
    });
    if (!changed) return u8;
    var out = XLSX.CFB.write(cfb, { type: 'array', fileType: 'zip' });
    return out instanceof Uint8Array ? out : new Uint8Array(out);
  }
});
