/* 생산관리 선적계획 자동화 — 순수 계산 로직
   기획서(docs/01_프로젝트_기획서.md) 5.1 입고예정일 규칙 · 5.2 과부족·상태 판정 · 5.3 기능 목록
   브라우저(window.SPLogic)와 node(require) 양쪽에서 씁니다. 화면·저장소 코드는 들어 있지 않습니다. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SPLogic = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // ── 날짜 (모두 'YYYY-MM-DD' 문자열, UTC 로 계산해 시간대 영향 없음) ──────────
  var DAY = 86400000;
  var WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoFromUtc(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function utc(iso) { var p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function validYmd(y, m, d) {
    if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    var ms = Date.UTC(y, m - 1, d);
    var back = new Date(ms);
    if (back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null; // 2월 30일 같은 값 거부
    return isoFromUtc(ms);
  }
  /** 날짜 칸 값 → 'YYYY-MM-DD' 또는 null. Date, 엑셀 일련번호, 2026-09-28 / 2026.09.28 / 2026/9/28 / 20260928 */
  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return null;
      // SheetJS(cellDates)는 현지 자정으로 만듭니다 — 현지 연월일을 그대로 씁니다
      return validYmd(v.getFullYear(), v.getMonth() + 1, v.getDate());
    }
    if (typeof v === 'number') {
      if (v >= 20000101 && v <= 22001231 && Math.floor(v) === v) return parseDate(String(v));
      if (v > 0 && v < 100000) return isoFromUtc(Date.UTC(1899, 11, 30) + Math.round(v) * DAY); // 엑셀 일련번호
      return null;
    }
    var s = String(v).trim();
    var m = s.match(/^(\d{4})[-./ ]\s*(\d{1,2})[-./ ]\s*(\d{1,2})\.?(?:\s.*)?$/);
    if (m) return validYmd(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return validYmd(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
    if (m) return validYmd(+m[1], +m[2], +m[3]);
    return null;
  }
  function addDays(iso, n) { return isoFromUtc(utc(iso) + n * DAY); }
  function weekday(iso) { return new Date(utc(iso)).getUTCDay(); } // 0=일 … 6=토
  function daysBetween(a, b) { return Math.round((utc(b) - utc(a)) / DAY); }
  function mondayOf(iso) { var w = weekday(iso); return addDays(iso, w === 0 ? -6 : 1 - w); }
  function fmtDate(iso) { return iso ? iso + ' (' + WEEKDAY_KO[weekday(iso)] + ')' : ''; }
  function todayIso(now) { var d = now || new Date(); return validYmd(d.getFullYear(), d.getMonth() + 1, d.getDate()); }

  /** 수량 칸 값 → 0 이상의 수 또는 null. 1,200 / 1200EA / ' 300 ' 허용 */
  function parseQty(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) && v >= 0 ? v : null;
    var s = String(v).replace(/,/g, '').replace(/\s*(EA|ea|개|pcs|PCS)$/, '').trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    return Number(s);
  }

  // ── 설정 ───────────────────────────────────────────────
  /* 입고예정일 규칙: 요일별 「선적일 + N일」. null = 원문에 규칙 없음.
     원문: 월~수 선적 → 2일 후 입고, 목~금 선적 → 다음 월요일 입고 (목 +4, 금 +3). */
  var DEFAULT_RULE = { 0: null, 1: 2, 2: 2, 3: 2, 4: 4, 5: 3, 6: null };
  function defaultSettings() {
    return {
      baseDate: '',              // 현재고 기준일. 비우면 오늘
      stockField: 'current',     // 'current' 현재고 | 'available' 가용재고
      defaultSafety: 0,          // 안전재고 열이 없거나 비었을 때 쓰는 값
      rule: JSON.parse(JSON.stringify(DEFAULT_RULE)),
      holidays: [],              // 'YYYY-MM-DD' 목록. 입고일이 걸리면 다음 영업일로
      urgentDays: 7,             // (가정) 첫 부족일이 기준일로부터 이 일수 이내면 「긴급」. 빈 값이면 판정 안 함
      excessRatio: 100,          // (가정) 과부족수량 ≥ 수주수량 합계 × 이 비율(%) 이면 「과잉」. 빈 값이면 판정 안 함
      arrivalBuffer: 0           // 선적계획 역산 시 필요일보다 며칠 먼저 입고되게 할지
    };
  }
  function mergeSettings(s) {
    var d = defaultSettings();
    if (!s || typeof s !== 'object') return d;
    Object.keys(d).forEach(function (k) { if (s[k] !== undefined) d[k] = s[k]; });
    var r = {};
    for (var w = 0; w < 7; w++) {
      var v = s.rule && s.rule[w] !== undefined ? s.rule[w] : DEFAULT_RULE[w];
      r[w] = v === null || v === '' || v === undefined ? null : Number(v);
      if (r[w] !== null && !(r[w] >= 0 && r[w] <= 60 && Math.floor(r[w]) === r[w])) r[w] = DEFAULT_RULE[w];
    }
    d.rule = r;
    d.holidays = (Array.isArray(d.holidays) ? d.holidays : []).map(parseDate).filter(Boolean);
    return d;
  }
  function optNum(v) { return v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v); }

  // ── 입고예정일 (기획서 5.1) ─────────────────────────────
  function isWorkday(iso, settings) {
    var w = weekday(iso);
    return w !== 0 && w !== 6 && settings.holidays.indexOf(iso) < 0;
  }
  /** 중국 선적일 → 한국 입고예정일. 규칙 없는 요일이면 null.
      계산된 날이 휴일(사용자 목록)이나 주말이면 다음 영업일로 미룹니다(가정). */
  function arrivalDate(shipIso, settings) {
    var off = settings.rule[weekday(shipIso)];
    if (off === null || off === undefined) return null;
    var d = addDays(shipIso, off);
    for (var i = 0; i < 30 && !isWorkday(d, settings); i++) d = addDays(d, 1);
    return d;
  }
  /** 목표일까지 입고되는 가장 늦은 선적일(earliest 이후). 없으면 null */
  function latestShipFor(targetIso, earliestIso, settings) {
    for (var s = targetIso; s >= earliestIso; s = addDays(s, -1)) {
      var a = arrivalDate(s, settings);
      if (a && a <= targetIso) return s;
    }
    return null;
  }
  /** earliest 이후 선적 가능한(규칙이 있는) 첫 날 */
  function firstShipOnOrAfter(earliestIso, settings) {
    for (var i = 0, s = earliestIso; i < 14; i++, s = addDays(s, 1)) if (arrivalDate(s, settings)) return s;
    return null;
  }

  // ── 열 매핑 (기획서 3장 항목) ───────────────────────────
  var DATASETS = {
    orders: {
      label: '수주현황',
      fields: [
        { key: 'item', label: '품번', required: true, syn: ['품번', '품목코드', '품목번호', '부품번호', 'partno', 'part no', 'item', 'itemcode', 'p/n'] },
        { key: 'name', label: '품명', syn: ['품명', '품목명', '부품명', 'partname', 'description'] },
        { key: 'customer', label: '고객사', syn: ['고객사', '고객', '거래처', 'customer'] },
        { key: 'orderDate', label: '수주일', syn: ['수주일', '수주일자', '주문일', 'orderdate'] },
        { key: 'dueDate', label: '납기일', required: true, syn: ['납기일', '납기', '납기일자', '요청납기', 'duedate', 'due'] },
        { key: 'qty', label: '수주수량', required: true, syn: ['수주수량', '수주량', '주문수량', '수량', 'orderqty', 'qty'] }
      ]
    },
    stock: {
      label: '재고현황',
      fields: [
        { key: 'item', label: '품번', required: true, syn: ['품번', '품목코드', '품목번호', '부품번호', 'partno', 'part no', 'item', 'itemcode', 'p/n'] },
        { key: 'name', label: '품명', syn: ['품명', '품목명', '부품명', 'partname', 'description'] },
        { key: 'current', label: '현재고', required: true, syn: ['현재고', '현재고수량', '재고', '재고수량', '재고량', 'onhand', 'stock'] },
        { key: 'available', label: '가용재고', syn: ['가용재고', '가용재고수량', '가용', 'available'] },
        { key: 'safety', label: '안전재고 (선택)', syn: ['안전재고', '안전재고수량', 'safetystock', 'safety'] }
      ]
    },
    shipments: {
      label: '선적예정',
      fields: [
        { key: 'item', label: '품번', required: true, syn: ['품번', '품목코드', '품목번호', '부품번호', 'partno', 'part no', 'item', 'itemcode', 'p/n'] },
        { key: 'name', label: '품명', syn: ['품명', '품목명', '부품명', 'partname', 'description'] },
        { key: 'shipDate', label: '중국 선적예정일', required: true, syn: ['중국선적예정일', '선적예정일', '선적일', '중국선적일', 'shipdate', 'etd'] },
        { key: 'qty', label: '선적수량', required: true, syn: ['선적수량', '선적량', '수량', 'shipqty', 'qty'] },
        { key: 'fileArrival', label: '한국 입고예정일 (파일 값, 선택)', syn: ['한국입고예정일', '입고예정일', '입고일', 'eta', 'arrival'] }
      ]
    }
  };
  function normHeader(s) { return String(s == null ? '' : s).toLowerCase().replace(/[\s_()\-·.]/g, ''); }
  /** 첫 번째로 칸이 2개 이상 찬 행을 머리행으로 봅니다 */
  function findHeaderRow(aoa) {
    for (var i = 0; i < Math.min(aoa.length, 20); i++) {
      var filled = (aoa[i] || []).filter(function (c) { return String(c).trim() !== ''; }).length;
      if (filled >= 2) return i;
    }
    return 0;
  }
  /** 머리행 → {필드키: 열 번호}. 정확히 같은 이름을 먼저, 다음으로 동의어를 찾습니다 */
  function guessMapping(headers, datasetKey) {
    var fields = DATASETS[datasetKey].fields;
    var hs = headers.map(normHeader);
    var used = {}, map = {};
    fields.forEach(function (f) {
      var cands = [normHeader(f.label.replace(/\s*\(.*\)$/, ''))].concat(f.syn.map(normHeader));
      for (var c = 0; c < cands.length; c++) {
        var idx = hs.indexOf(cands[c]);
        if (idx >= 0 && !used[idx]) { map[f.key] = idx; used[idx] = true; return; }
      }
    });
    return map;
  }
  /** 표(aoa) + 매핑 → {rows, errors}. 빈 행은 건너뜁니다. errors: {row(엑셀 행 번호), field, code} */
  function mapRows(aoa, headerRow, mapping, datasetKey) {
    var fields = DATASETS[datasetKey].fields;
    var rows = [], errors = [];
    fields.forEach(function (f) {
      if (f.required && (mapping[f.key] === undefined || mapping[f.key] === null || mapping[f.key] === ''))
        errors.push({ row: 0, field: f.key, code: 'unmapped' });
    });
    if (errors.length) return { rows: rows, errors: errors };
    for (var r = headerRow + 1; r < aoa.length; r++) {
      var line = aoa[r] || [];
      if (!line.some(function (c) { return String(c).trim() !== ''; })) continue;
      var o = {}, bad = false;
      fields.forEach(function (f) {
        var idx = mapping[f.key];
        var raw = idx === undefined || idx === null || idx === '' ? '' : line[idx];
        var v;
        if (f.key === 'item' || f.key === 'name' || f.key === 'customer') v = String(raw == null ? '' : raw).trim();
        else if (/Date|Arrival/.test(f.key)) v = parseDate(raw);
        else v = parseQty(raw);
        if (f.required && (v === null || v === '')) { errors.push({ row: r + 1, field: f.key, code: raw === '' || raw == null ? 'empty' : 'bad_value', value: raw }); bad = true; }
        else if (!f.required && raw !== '' && raw != null && v === null) { errors.push({ row: r + 1, field: f.key, code: 'bad_value_optional', value: raw }); }
        o[f.key] = v === '' ? (f.key === 'name' || f.key === 'customer' ? '' : null) : v;
      });
      if (!bad) rows.push(o);
    }
    return { rows: rows, errors: errors };
  }

  // ── 계산 (기획서 5.2) ──────────────────────────────────
  function resolveShipments(shipments, settings, base) {
    return shipments.map(function (s, i) {
      var calc = arrivalDate(s.shipDate, settings);
      var r = { idx: i, item: s.item, name: s.name || '', shipDate: s.shipDate, qty: s.qty, fileArrival: s.fileArrival || null, calcArrival: calc, arrival: calc, issues: [] };
      if (!calc) {
        if (s.fileArrival) { r.arrival = s.fileArrival; r.issues.push('no_rule_file_used'); }
        else r.issues.push('no_rule');
      } else if (s.fileArrival && s.fileArrival !== calc) r.issues.push('mismatch');
      if (r.arrival && r.arrival < base) r.issues.push('before_base');
      r.counted = !!r.arrival && r.arrival >= base;
      return r;
    });
  }

  /** 전체 계산. data = {orders, stock, shipments} (mapRows 결과 행). 반환: 품번별 결과·선적계획·경고 */
  function compute(data, settingsIn, now) {
    var settings = mergeSettings(settingsIn);
    var base = parseDate(settings.baseDate) || todayIso(now);
    var urgentDays = optNum(settings.urgentDays), excessRatio = optNum(settings.excessRatio);
    var buffer = Math.max(0, Math.floor(optNum(settings.arrivalBuffer) || 0));
    var defSafety = optNum(settings.defaultSafety) || 0;
    var orders = data.orders || [], stock = data.stock || [], shipments = data.shipments || [];
    var ships = resolveShipments(shipments, settings, base);
    var warnings = [];

    var items = {}, order = [];
    function it(code, name) {
      if (!items[code]) { items[code] = { item: code, name: '', customers: [], hasStock: false, stockRows: 0, stock: 0, safety: defSafety, safetyFromFile: false, orderSum: 0, inSum: 0, events: {}, orders: [], ships: [], overdue: 0 }; order.push(code); }
      if (name && !items[code].name) items[code].name = name;
      return items[code];
    }
    function ev(x, d) { if (!x.events[d]) x.events[d] = { inQty: 0, outQty: 0 }; return x.events[d]; }

    stock.forEach(function (s) {
      var x = it(s.item, s.name);
      var q = settings.stockField === 'available' ? s.available : s.current;
      if (q === null || q === undefined) q = 0;
      x.stock += q; x.hasStock = true; x.stockRows++;
      if (s.safety !== null && s.safety !== undefined) { x.safety = x.safetyFromFile ? Math.max(x.safety, s.safety) : s.safety; x.safetyFromFile = true; }
    });
    orders.forEach(function (o) {
      var x = it(o.item, o.name);
      var d = o.dueDate < base ? base : o.dueDate; // 기준일 전 납기(미출하로 가정)는 기준일에 뺍니다
      if (o.dueDate < base) x.overdue++;
      ev(x, d).outQty += o.qty;
      x.orderSum += o.qty;
      x.orders.push(o);
      if (o.customer && x.customers.indexOf(o.customer) < 0) x.customers.push(o.customer);
    });
    ships.forEach(function (s) {
      var x = it(s.item, s.name);
      x.ships.push(s);
      if (!s.counted) return;
      ev(x, s.arrival).inQty += s.qty;
      x.inSum += s.qty;
    });

    var results = [], plans = [];
    order.forEach(function (code) {
      var x = items[code];
      var dates = Object.keys(x.events).sort();
      var running = x.stock, daily = [], minGap = x.stock - x.safety, firstShort = x.stock < x.safety ? base : null;
      dates.forEach(function (d) {
        var e = x.events[d];
        running += e.inQty - e.outQty;
        daily.push({ date: d, inQty: e.inQty, outQty: e.outQty, stock: running, gap: running - x.safety });
        if (running - x.safety < minGap) minGap = running - x.safety;
        if (!firstShort && running < x.safety) firstShort = d;
      });
      var expected = x.stock + x.inSum - x.orderSum;          // 기획안 8장: 현재고 + 입고예정수량 − 수주수량
      var balance = expected - x.safety;                        // 기획안 8장: 예상재고 − 안전재고
      var shortage = Math.max(0, -minGap);
      var status;
      if (balance < 0) status = urgentDays !== null && firstShort && daysBetween(base, firstShort) <= urgentDays ? '긴급' : '부족';
      else if (shortage > 0) status = '주의';
      else if (excessRatio !== null && (x.orderSum > 0 ? balance >= x.orderSum * excessRatio / 100 : balance > 0)) status = '과잉';
      else status = '정상';
      var flags = [];
      if (!x.hasStock) flags.push('no_stock_row');
      if (x.stockRows > 1) flags.push('stock_rows_summed');
      if (x.overdue) flags.push('overdue_orders');
      if (!x.orders.length) flags.push('no_orders');
      var dueDates = x.orders.map(function (o) { return o.dueDate; }).sort();
      var r = {
        item: code, name: x.name, customers: x.customers, stock: x.stock, safety: x.safety, safetyFromFile: x.safetyFromFile,
        orderSum: x.orderSum, inSum: x.inSum, expected: expected, balance: balance, shortage: shortage,
        firstShort: firstShort, nearestDue: dueDates[0] || null, status: status, daily: daily, flags: flags
      };
      results.push(r);
      if (shortage > 0) plans = plans.concat(planForItem(r, x, base, buffer, settings));
    });
    var rank = { '긴급': 0, '부족': 1, '주의': 2, '과잉': 3, '정상': 4 };
    results.sort(function (a, b) {
      return rank[a.status] - rank[b.status] || (a.firstShort || '9999') .localeCompare(b.firstShort || '9999') || b.shortage - a.shortage || a.item.localeCompare(b.item);
    });
    ships.forEach(function (s) {
      if (s.issues.indexOf('no_rule') >= 0) warnings.push({ code: 'no_rule', item: s.item, shipDate: s.shipDate });
    });
    return { base: base, settings: settings, results: results, plans: plans, shipments: ships, warnings: warnings };
  }

  /** 품번 하나의 선적계획: 일자별로 안전재고 아래로 내려가는 날마다 모자란 만큼을
      그날(− 여유일)까지 입고되는 가장 늦은 선적일로 잡습니다. 같은 선적일은 합칩니다. */
  function planForItem(r, x, base, buffer, settings) {
    var out = [];
    function add(needDate, qty) {
      var target = addDays(needDate, -buffer);
      var ship = target >= base ? latestShipFor(target, base, settings) : null;
      var late = false;
      if (!ship) { ship = firstShipOnOrAfter(base, settings); late = true; }
      if (!ship) return;
      var arr = arrivalDate(ship, settings);
      if (arr > needDate) late = true;
      var same = out.filter(function (p) { return p.shipDate === ship; })[0];
      if (same) { same.qty += qty; same.late = same.late || late; return; }
      out.push({ id: r.item + '@' + needDate, item: r.item, name: r.name, needDate: needDate, shipDate: ship, arrival: arr, qty: qty, late: late, status: r.status });
    }
    var running = x.stock, covered = 0;
    if (running < x.safety) { add(base, x.safety - running); covered = x.safety - running; }
    Object.keys(x.events).sort().forEach(function (d) {
      var e = x.events[d];
      running += e.inQty - e.outQty;
      var gap = running + covered - x.safety;
      if (gap < 0) { add(d, -gap); covered += -gap; }
    });
    return out;
  }

  /** 사용자가 고친 선적계획(수정 목록)을 적용합니다. edits: {id: {shipDate, qty}} */
  function applyPlanEdits(plans, edits, settingsIn) {
    var settings = mergeSettings(settingsIn);
    edits = edits || {};
    return plans.map(function (p) {
      var e = edits[p.id];
      if (!e) return Object.assign({ edited: false }, p);
      var q = Object.assign({}, p, { edited: true });
      var sd = parseDate(e.shipDate);
      if (sd) { q.shipDate = sd; q.arrival = arrivalDate(sd, settings); }
      var qty = parseQty(e.qty);
      if (qty !== null) q.qty = qty;
      q.late = !q.arrival || q.arrival > q.needDate;
      q.noRule = !q.arrival;
      return q;
    });
  }

  // ── Dashboard (기획안 11장) ────────────────────────────
  function dashboard(res, plans) {
    var weekStart = mondayOf(res.base), weekEnd = addDays(weekStart, 6);
    var k = { items: res.results.length, orderSum: 0, stock: 0, inSum: 0, shortItems: 0, shortage: 0, urgentItems: [], weekShipPlanned: 0, weekShipConfirmed: 0, byStatus: { '정상': 0, '부족': 0, '주의': 0, '과잉': 0, '긴급': 0 } };
    res.results.forEach(function (r) {
      k.orderSum += r.orderSum; k.stock += r.stock; k.inSum += r.inSum;
      k.byStatus[r.status]++;
      if (r.status === '부족' || r.status === '긴급') { k.shortItems++; k.shortage += r.shortage; }
      if (r.status === '긴급') k.urgentItems.push(r.item);
    });
    var weeks = {};
    function wk(d) { var m = mondayOf(d); if (!weeks[m]) weeks[m] = { week: m, confirmed: 0, planned: 0 }; return weeks[m]; }
    res.shipments.forEach(function (s) {
      if (s.shipDate >= weekStart && s.shipDate <= weekEnd) k.weekShipConfirmed += s.qty;
      if (s.shipDate >= weekStart) wk(s.shipDate).confirmed += s.qty;
    });
    plans.forEach(function (p) {
      if (p.shipDate >= weekStart && p.shipDate <= weekEnd) k.weekShipPlanned += p.qty;
      wk(p.shipDate).planned += p.qty;
    });
    k.weeks = Object.keys(weeks).sort().map(function (w) { return weeks[w]; });
    k.weekStart = weekStart; k.weekEnd = weekEnd;
    return k;
  }

  // ── AI 분석 (반자동, 기획안 9장) ───────────────────────
  var AI_FORMAT = '품번 | 우선순위 | 의견';
  function buildAiPrompt(res, plans, opts) {
    opts = opts || {};
    var targets = res.results.filter(function (r) { return r.status === '긴급' || r.status === '부족' || r.status === '주의'; });
    var lines = [];
    lines.push('당신은 와이어링 하네스 생산관리 담당자를 돕는 선적계획 분석 도우미입니다.');
    lines.push('아래는 기준일 ' + res.base + ' 기준으로 규칙 계산한 부족·긴급·주의 품번입니다. 수치는 계산 결과이므로 바꾸지 말고, 이 수치만 근거로 판단해 주세요.');
    lines.push('계산식: 예상재고 = 현재고 + 입고예정수량 - 수주수량, 과부족수량 = 예상재고 - 안전재고. 입고예정일은 중국 선적일 기준(월~수 선적 → 2일 후, 목~금 선적 → 다음 월요일)입니다.');
    lines.push('');
    var head = ['품번'].concat(opts.includeName ? ['품명'] : []).concat(['상태', '첫 부족일', '최단 납기일', '현재고', '입고예정수량', '수주수량', '안전재고', '과부족수량', '부족수량', '제안 선적(선적일:수량)']);
    lines.push(head.join(' | '));
    targets.forEach(function (r) {
      var ps = plans.filter(function (p) { return p.item === r.item; }).map(function (p) { return p.shipDate + ':' + p.qty + (p.late ? '(입고 늦음)' : ''); }).join(', ') || '-';
      lines.push([r.item].concat(opts.includeName ? [r.name || '-'] : []).concat([r.status, r.firstShort || '-', r.nearestDue || '-', r.stock, r.inSum, r.orderSum, r.safety, r.balance, r.shortage, ps]).join(' | '));
    });
    if (!targets.length) lines.push('(부족·긴급·주의 품번 없음)');
    lines.push('');
    lines.push('요청: 우선적으로 대응해야 할 순서대로 품번별 의견을 짧게 써 줘. 추가 선적이 필요한 수량과 시점을 한 문장으로 설명해 줘.');
    lines.push('답은 설명 없이 한 줄에 한 품번씩, 아래 형식으로만 써 줘. 우선순위는 1부터 시작하는 숫자로 써 줘.');
    lines.push(AI_FORMAT);
    lines.push('예) A001 | 1 | 10월 2일 기준 재고 부족이 예상됩니다. 300EA 추가 선적이 필요합니다.');
    return lines.join('\n');
  }
  /** AI 답 → [{item, priority, comment}] + 알 수 없는 줄 목록 */
  function parseAiAnswer(text, knownItems) {
    var known = {};
    (knownItems || []).forEach(function (c) { known[String(c).toUpperCase()] = c; });
    var rows = [], skipped = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var s = line.replace(/^\s*[-*•]\s*/, '').replace(/^\|/, '').replace(/\|\s*$/, '').trim();
      if (!s) return;
      var parts = s.split('|').map(function (p) { return p.trim().replace(/^\*\*|\*\*$/g, ''); });
      if (parts.length < 3) { skipped.push(line); return; }
      if (/^품번$/.test(parts[0]) || /^-+$/.test(parts[0].replace(/:/g, ''))) return; // 머리행·구분선
      var code = known[parts[0].toUpperCase()];
      var pr = parseInt(parts[1], 10);
      if (!code || isNaN(pr)) { skipped.push(line); return; }
      rows.push({ item: code, priority: pr, comment: parts.slice(2).join(' | ') });
    });
    rows.sort(function (a, b) { return a.priority - b.priority; });
    return { rows: rows, skipped: skipped };
  }

  // ── 공유용 내보내기 ────────────────────────────────────
  function shareText(res, plans, k) {
    var L = [];
    L.push('[선적계획 공유] 기준일 ' + fmtDate(res.base));
    L.push('부족 품번 ' + k.shortItems + '개(긴급 ' + k.urgentItems.length + '개), 부족수량 합계 ' + k.shortage + ', 금주 제안 선적수량 ' + k.weekShipPlanned);
    if (k.urgentItems.length) L.push('긴급 품번: ' + k.urgentItems.join(', '));
    L.push('');
    L.push('선적계획(제안)');
    if (!plans.length) L.push('- 추가 선적 필요 없음');
    plans.slice().sort(function (a, b) { return a.shipDate.localeCompare(b.shipDate) || a.item.localeCompare(b.item); }).forEach(function (p) {
      L.push('- ' + p.item + (p.name ? ' ' + p.name : '') + ': ' + fmtDate(p.shipDate) + ' 선적 ' + p.qty + ' → 입고 ' + (p.arrival ? fmtDate(p.arrival) : '규칙 없음') + ' (필요일 ' + p.needDate + (p.late ? ', 필요일보다 늦게 입고' : '') + ')');
    });
    L.push('');
    L.push('상세 표는 첨부한 Excel 파일을 확인해 주세요.');
    return L.join('\n');
  }
  function exportSheets(res, plans, aiRows) {
    var ai = {};
    (aiRows || []).forEach(function (a) { ai[a.item] = a; });
    var s = {};
    s['과부족현황'] = [['품번', '품명', '상태', '현재고', '입고예정수량', '수주수량', '예상재고', '안전재고', '과부족수량', '부족수량', '첫 부족일', '최단 납기일', 'AI 우선순위', 'AI 의견', '확인 필요']]
      .concat(res.results.map(function (r) {
        return [r.item, r.name, r.status, r.stock, r.inSum, r.orderSum, r.expected, r.safety, r.balance, r.shortage, r.firstShort || '', r.nearestDue || '',
          ai[r.item] ? ai[r.item].priority : '', ai[r.item] ? ai[r.item].comment : '', r.flags.map(flagLabel).join(', ')];
      }));
    s['선적계획'] = [['품번', '품명', '선적일', '선적 요일', '선적수량', '한국 입고예정일', '필요일', '상태', '비고']]
      .concat(plans.slice().sort(function (a, b) { return a.shipDate.localeCompare(b.shipDate) || a.item.localeCompare(b.item); }).map(function (p) {
        return [p.item, p.name, p.shipDate, WEEKDAY_KO[weekday(p.shipDate)], p.qty, p.arrival || '규칙 없음', p.needDate, p.status,
          [p.late ? '필요일보다 늦게 입고' : '', p.edited ? '사용자 수정' : ''].filter(Boolean).join(', ')];
      }));
    s['부족품번'] = [['품번', '품명', '상태', '첫 부족일', '부족수량', '과부족수량']]
      .concat(res.results.filter(function (r) { return r.shortage > 0 || r.balance < 0; }).map(function (r) {
        return [r.item, r.name, r.status, r.firstShort || '', r.shortage, r.balance];
      }));
    s['일자별예상재고'] = [['품번', '일자', '요일', '입고예정', '수주(납기)', '예상재고', '안전재고 대비']];
    res.results.forEach(function (r) {
      s['일자별예상재고'].push([r.item, res.base, WEEKDAY_KO[weekday(res.base)] + ' (기준일 현재고)', '', '', r.stock, r.stock - r.safety]);
      r.daily.forEach(function (d) { s['일자별예상재고'].push([r.item, d.date, WEEKDAY_KO[weekday(d.date)], d.inQty, d.outQty, d.stock, d.gap]); });
    });
    s['입고예정계산'] = [['품번', '품명', '중국 선적예정일', '선적 요일', '선적수량', '규칙 계산 입고예정일', '파일 입고예정일', '적용 입고예정일', '비고']]
      .concat(res.shipments.map(function (x) {
        return [x.item, x.name, x.shipDate, WEEKDAY_KO[weekday(x.shipDate)], x.qty, x.calcArrival || '규칙 없음', x.fileArrival || '', x.counted ? x.arrival : '(계산 제외)', x.issues.map(issueLabel).join(', ')];
      }));
    return s;
  }
  /** 통합 데이터 관리 파일: 세 자료를 표준 열 이름으로 (다시 가져오면 자동 매핑됩니다) */
  function dataSheets(data) {
    var s = {};
    Object.keys(DATASETS).forEach(function (k) {
      var f = DATASETS[k].fields;
      s[DATASETS[k].label] = [f.map(function (x) { return x.label.replace(/\s*\(.*\)$/, ''); })].concat((data[k] || []).map(function (r) {
        return f.map(function (x) { var v = r[x.key]; return v === null || v === undefined ? '' : v; });
      }));
    });
    return s;
  }
  var FLAG = { no_stock_row: '재고현황에 없는 품번', stock_rows_summed: '재고 행 여러 개 합산', overdue_orders: '기준일 전 납기 수주 포함', no_orders: '수주 없음' };
  var ISSUE = { no_rule: '선적 요일 규칙 없음(계산 제외)', no_rule_file_used: '선적 요일 규칙 없음 — 파일 입고일 사용', mismatch: '파일 입고일과 규칙 계산이 다름', before_base: '기준일 전 입고(현재고에 포함된 것으로 보고 제외)' };
  function flagLabel(c) { return FLAG[c] || c; }
  function issueLabel(c) { return ISSUE[c] || c; }

  function toCsv(aoa) {
    return '﻿' + aoa.map(function (r) {
      return r.map(function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',');
    }).join('\r\n');
  }

  return {
    WEEKDAY_KO: WEEKDAY_KO, DATASETS: DATASETS, DEFAULT_RULE: DEFAULT_RULE, AI_FORMAT: AI_FORMAT,
    parseDate: parseDate, parseQty: parseQty, addDays: addDays, weekday: weekday, daysBetween: daysBetween, mondayOf: mondayOf,
    fmtDate: fmtDate, todayIso: todayIso,
    defaultSettings: defaultSettings, mergeSettings: mergeSettings,
    arrivalDate: arrivalDate, latestShipFor: latestShipFor,
    findHeaderRow: findHeaderRow, guessMapping: guessMapping, mapRows: mapRows,
    compute: compute, applyPlanEdits: applyPlanEdits, dashboard: dashboard,
    buildAiPrompt: buildAiPrompt, parseAiAnswer: parseAiAnswer,
    shareText: shareText, exportSheets: exportSheets, dataSheets: dataSheets, flagLabel: flagLabel, issueLabel: issueLabel, toCsv: toCsv
  };
});
