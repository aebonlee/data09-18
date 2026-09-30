/* 선적계획 자동화 — 화면
   흐름: 자료 가져오기(열 매핑) → 설정 → 과부족 현황 / 일자별 예상재고 → 선적계획 → AI 분석 → 공유·내보내기, 대시보드 */
(function () {
  'use strict';
  var L = window.SPLogic, S = window.SPStore, Sample = window.SPSample, I = window.SPIntake, ISample = window.SPIntakeSample;
  var M = window.SPMapping, U = window.SPUpload, Pr = window.SPPrice, Mo = window.SPMonthly;
  var KEYS = ['orders', 'stock', 'shipments'];
  var st = S.load();
  var partMap = S.loadMapping(); // 고객사 품번 → 천일품번 매핑표(이 브라우저에만 저장, 기획서 11.10)
  var priceTable = S.loadPriceTable(); // 매입단가표 당사 품목코드 → 매입단가·생산처(이 브라우저에만 저장, 기획서 11.12)
  var pendingSheets = { orders: null, stock: null, shipments: null }; // 방금 연 파일의 시트들(시트 바꾸기용, 저장 안 함)
  var main = document.getElementById('main');

  // ── 작은 도구 ─────────────────────────────────────────
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function n(v) { return v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('ko-KR'); }
  function badge(s) { return h('span', { class: 'status st-' + s }, s); }
  function save() { S.save(st); }
  var toastTimer;
  function toast(msg, isErr) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast' + (isErr ? ' error' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }
  function download(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function copyText(text) {
    function fallback() {
      var ta = h('textarea', { style: 'position:fixed;left:-9999px' }); ta.value = text;
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('복사했습니다'); } catch (e) { toast('복사하지 못했습니다. 직접 선택해 복사해 주세요', true); }
      ta.remove();
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { toast('복사했습니다'); }, fallback);
    else fallback();
  }
  function suffix() { return (st._sample ? '_예시데이터' : ''); }
  function writeXlsx(sheets, name) {
    var wb = XLSX.utils.book_new();
    Object.keys(sheets).forEach(function (k) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheets[k]), k); });
    var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(name, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }

  // ── 파일 읽기 (Excel·CSV) ─────────────────────────────
  function readFile(file, done) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var buf = new Uint8Array(reader.result), wb;
        if (/\.csv$/i.test(file.name)) {
          var text;
          try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
          catch (e) { text = new TextDecoder('euc-kr').decode(buf); } // 엑셀에서 저장한 한글 CSV
          wb = XLSX.read(text.replace(/^﻿/, ''), { type: 'string', raw: true });
        } else wb = XLSX.read(window.SPIntake ? window.SPIntake.fixZip(buf, XLSX) : buf, { type: 'array', cellDates: true }); // 포털 xlsx 의 <si > 고침(기획서 11.2)
        var sheets = {};
        wb.SheetNames.forEach(function (nm) { sheets[nm] = XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, raw: true, defval: '' }); });
        done(null, { names: wb.SheetNames, sheets: sheets });
      } catch (err) { done(err); }
    };
    reader.onerror = function () { done(reader.error); };
    reader.readAsArrayBuffer(file);
  }
  /** Date 객체는 저장 전에 'YYYY-MM-DD' 로 바꿉니다(localStorage JSON 용) */
  function cleanAoa(aoa) {
    return aoa.map(function (r) { return r.map(function (c) { return c instanceof Date ? (L.parseDate(c) || '') : c; }); });
  }
  function setTable(k, fileName, sheetName, aoa) {
    aoa = cleanAoa(aoa);
    var hr = L.findHeaderRow(aoa);
    st.tables[k] = { fileName: fileName, sheet: sheetName, aoa: aoa, headerRow: hr, mapping: initialMapping(k, aoa[hr] || []) };
    st.planEdits = {};
  }
  function initialMapping(k, headers) {
    var m = L.guessMapping(headers, k);
    var saved = st.savedMappings[k] || {};
    Object.keys(saved).forEach(function (f) {
      var idx = headers.map(String).indexOf(saved[f]);
      if (idx >= 0) {
        Object.keys(m).forEach(function (g) { if (m[g] === idx && g !== f) delete m[g]; });
        m[f] = idx;
      }
    });
    return m;
  }

  // ── 계산 ──────────────────────────────────────────────
  function mapped() {
    var data = {}, errors = {}, loaded = {};
    KEYS.forEach(function (k) {
      var t = st.tables[k];
      loaded[k] = !!t;
      if (!t) { data[k] = []; errors[k] = []; return; }
      var r = L.mapRows(t.aoa, t.headerRow, t.mapping, k);
      data[k] = r.rows; errors[k] = r.errors;
    });
    return { data: data, errors: errors, loaded: loaded };
  }
  function calc() {
    var m = mapped();
    var res = L.compute(m.data, st.settings);
    var plans = L.applyPlanEdits(res.plans, st.planEdits, st.settings);
    var ai = L.parseAiAnswer(st.ai.answer, res.results.map(function (r) { return r.item; }));
    return { m: m, res: res, plans: plans, k: L.dashboard(res, plans), ai: ai };
  }
  function hasData() { return KEYS.some(function (k) { return !!st.tables[k]; }); }

  function loadSample() {
    KEYS.forEach(function (k) { setTable(k, '예시데이터_' + L.DATASETS[k].label + '.xlsx', L.DATASETS[k].label, Sample.tables[k]); pendingSheets[k] = null; });
    st.settings = L.mergeSettings(Object.assign({}, st.settings, { baseDate: Sample.BASE }));
    st.planEdits = {}; st.ai = { answer: '', includeName: false };
    st._sample = true;
    save();
    toast('예시 데이터를 불러왔습니다 (기준일 ' + Sample.BASE + ')');
    location.hash = '#/dashboard'; render();
  }
  function sampleButton(primary) {
    return h('button', { type: 'button', class: 'btn' + (primary ? ' btn-primary' : ''), onclick: loadSample }, '예시 데이터 불러오기');
  }

  // ── 공통 경고 ─────────────────────────────────────────
  function warningsBox(c) {
    var items = [];
    KEYS.forEach(function (k) {
      if (!c.m.loaded[k]) items.push(L.DATASETS[k].label + ' 파일이 아직 없습니다. 없는 자료는 0으로 보고 계산합니다.');
      var e = c.m.errors[k];
      if (e.some(function (x) { return x.code === 'unmapped'; })) items.push(L.DATASETS[k].label + ': 필수 열 매핑이 끝나지 않았습니다.');
      else {
        var bad = e.filter(function (x) { return x.code === 'empty' || x.code === 'bad_value'; }).length;
        if (bad) items.push(L.DATASETS[k].label + ': 값이 비었거나 읽을 수 없는 칸 ' + bad + '곳이 있어 해당 행을 뺐습니다.');
      }
    });
    var noRule = c.res.shipments.filter(function (s) { return s.issues.indexOf('no_rule') >= 0; }).length;
    if (noRule) items.push('규칙이 없는 요일(토·일)에 선적한 ' + noRule + '건은 입고예정일을 정할 수 없어 계산에서 뺐습니다.');
    var mism = c.res.shipments.filter(function (s) { return s.issues.indexOf('mismatch') >= 0; }).length;
    if (mism) items.push('파일의 한국 입고예정일이 규칙 계산과 다른 선적 ' + mism + '건이 있습니다(계산은 규칙 값).');
    if (!items.length) return null;
    return h('div', { class: 'alert warn' }, h('strong', null, '확인할 점'), h('ul', null, items.map(function (x) { return h('li', null, x); })),
      h('p', { style: 'margin:6px 0 0' }, h('a', { href: '#/data' }, '자료 가져오기에서 확인'), ' · ', h('a', { href: '#/plan' }, '입고예정 계산표 보기')));
  }
  function needData() {
    main.appendChild(h('div', { class: 'card empty' },
      h('p', null, '아직 불러온 자료가 없습니다.'),
      h('p', { class: 'note' }, '수주현황·재고현황·중국 선적예정 파일을 가져오거나, 시연용 예시 데이터로 먼저 둘러볼 수 있습니다.'),
      h('div', { class: 'btn-row', style: 'justify-content:center' }, sampleButton(true), h('a', { class: 'btn', href: '#/data' }, '자료 가져오기'))));
  }

  // ── 대시보드 (기획안 11장) ─────────────────────────────
  function viewDashboard() {
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '대시보드'), hasData() ? h('span', { class: 'note' }, '기준일 ' + L.fmtDate(calc().res.base)) : null));
    if (!hasData()) { needData(); return; }
    var c = calc(), k = c.k;
    append(main, warningsBox(c));
    function kpi(label, value, sub, alert, href) {
      var box = h(href ? 'a' : 'div', { class: 'kpi' + (alert ? ' alert-kpi' : ''), href: href || null, style: href ? 'text-decoration:none;color:inherit' : null },
        h('div', { class: 'k' }, label), h('div', { class: 'v' }, value), sub ? h('div', { class: 's' }, sub) : null);
      return box;
    }
    main.appendChild(h('div', { class: 'kpis' },
      kpi('전체 품번 수', n(k.items)),
      kpi('전체 수주수량', n(k.orderSum)),
      kpi('현재고', n(k.stock), st.settings.stockField === 'available' ? '가용재고 기준' : '현재고 기준'),
      kpi('입고예정수량', n(k.inSum), '기준일 이후 입고분'),
      kpi('부족 품번 수', n(k.shortItems), '부족 + 긴급', k.shortItems > 0, '#/result'),
      kpi('부족수량', n(k.shortage), '부족·긴급 품번 합계', k.shortage > 0),
      kpi('금주 선적수량', n(k.weekShipPlanned + k.weekShipConfirmed), '제안 ' + n(k.weekShipPlanned) + ' · 확정 예정 ' + n(k.weekShipConfirmed) + ' (' + k.weekStart.slice(5) + '~' + k.weekEnd.slice(5) + ')', false, '#/plan'),
      kpi('긴급 선적 품번', n(k.urgentItems.length), k.urgentItems.join(', ') || '없음', k.urgentItems.length > 0, '#/result')));

    var total = k.items || 1, order = ['긴급', '부족', '주의', '과잉', '정상'];
    var statusCard = h('div', { class: 'card' }, h('h2', null, '상태별 품번'),
      h('div', { class: 'stack', role: 'img', 'aria-label': order.map(function (s) { return s + ' ' + k.byStatus[s]; }).join(', ') },
        order.map(function (s) { return k.byStatus[s] ? h('span', { class: 'st-' + s, style: 'width:' + (k.byStatus[s] / total * 100) + '%', title: s + ' ' + k.byStatus[s] }) : null; })),
      h('div', { class: 'legend' }, order.map(function (s) { return h('span', null, h('i', { class: 'st-' + s }), s + ' ' + k.byStatus[s]); })),
      h('p', { class: 'note', style: 'margin-top:10px' }, '판정 기준은 설정 화면에서 바꿀 수 있습니다. 긴급·주의·과잉 기준은 수강생 확인 전 가정값입니다.'));

    var max = 1;
    k.weeks.forEach(function (w) { max = Math.max(max, w.confirmed, w.planned); });
    var weekCard = h('div', { class: 'card' }, h('h2', null, '주차별 선적계획'),
      k.weeks.length ? h('div', { class: 'bars' }, k.weeks.map(function (w) {
        return h('div', { class: 'bar-row' },
          h('div', { class: 'bar-label' }, w.week.slice(5).replace('-', '/') + ' 주'),
          h('div', { class: 'bar-track' },
            h('div', { class: 'bar confirmed' }, h('span', { style: 'width:' + (w.confirmed / max * 80) + '%' }), h('em', null, '확정 예정 ' + n(w.confirmed))),
            h('div', { class: 'bar planned' }, h('span', { style: 'width:' + (w.planned / max * 80) + '%' }), h('em', null, '제안 ' + n(w.planned)))));
      })) : h('p', { class: 'note' }, '기준일 이후 선적이 없습니다.'),
      h('div', { class: 'legend' }, h('span', null, h('i', { style: 'background:var(--bar-confirmed)' }), '확정 선적예정(파일)'), h('span', null, h('i', { style: 'background:var(--bar-planned)' }), '제안 선적계획')),
      h('p', { class: 'note', style: 'margin-top:10px' }, '주는 월요일 시작으로 묶었습니다.'));
    main.appendChild(h('div', { class: 'grid-2' }, statusCard, weekCard));

    var urgent = c.res.results.filter(function (r) { return r.status === '긴급' || r.status === '부족' || r.status === '주의'; }).slice(0, 8);
    main.appendChild(h('div', { class: 'card' }, h('h2', null, '먼저 볼 품번'),
      urgent.length ? resultTable(urgent, c, true) : h('p', { class: 'note' }, '부족·긴급·주의 품번이 없습니다.'),
      h('p', { style: 'margin:10px 0 0' }, h('a', { href: '#/result' }, '과부족 현황 전체 보기'))));
  }

  // ── 과부족 현황 ──────────────────────────────────────
  function resultTable(rows, c, compact) {
    var ai = {};
    c.ai.rows.forEach(function (a) { ai[a.item] = a; });
    var cols = compact
      ? ['품번', '상태', '첫 부족일', '부족수량', '현재고', '입고예정', '수주']
      : ['품번', '품명', '상태', '현재고', '입고예정수량', '수주수량', '예상재고', '안전재고', '과부족수량', '부족수량', '첫 부족일', '최단 납기일', 'AI 의견', '확인 필요'];
    var numCols = { '현재고': 1, '입고예정': 1, '입고예정수량': 1, '수주': 1, '수주수량': 1, '예상재고': 1, '안전재고': 1, '과부족수량': 1, '부족수량': 1 };
    return h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, cols.map(function (x) { return h('th', { class: numCols[x] ? 'num' : null }, x); }))),
      h('tbody', null, rows.map(function (r) {
        var go = function () { location.hash = '#/daily/' + encodeURIComponent(r.item); };
        var cell = {
          '품번': h('td', { class: 'nowrap' }, h('strong', null, r.item)), '품명': h('td', null, r.name), '상태': h('td', null, badge(r.status)),
          '현재고': h('td', { class: 'num' }, n(r.stock)), '입고예정': h('td', { class: 'num' }, n(r.inSum)), '입고예정수량': h('td', { class: 'num' }, n(r.inSum)),
          '수주': h('td', { class: 'num' }, n(r.orderSum)), '수주수량': h('td', { class: 'num' }, n(r.orderSum)),
          '예상재고': h('td', { class: 'num' + (r.expected < 0 ? ' neg' : '') }, n(r.expected)),
          '안전재고': h('td', { class: 'num' }, n(r.safety)),
          '과부족수량': h('td', { class: 'num' + (r.balance < 0 ? ' neg' : '') }, n(r.balance)),
          '부족수량': h('td', { class: 'num' + (r.shortage > 0 ? ' neg' : '') }, n(r.shortage)),
          '첫 부족일': h('td', { class: 'nowrap' }, r.firstShort ? L.fmtDate(r.firstShort) : '-'),
          '최단 납기일': h('td', { class: 'nowrap' }, r.nearestDue ? L.fmtDate(r.nearestDue) : '-'),
          'AI 의견': h('td', null, ai[r.item] ? ai[r.item].priority + '. ' + ai[r.item].comment : ''),
          '확인 필요': h('td', null, r.flags.map(function (f) { return h('span', { class: 'tag warn' }, L.flagLabel(f)); }))
        };
        return h('tr', { class: 'clickable', tabindex: '0', onclick: go, onkeydown: function (e) { if (e.key === 'Enter') go(); } }, cols.map(function (x) { return cell[x]; }));
      }))));
  }
  var filter = { status: '', q: '' };
  function viewResult() {
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '과부족 현황')));
    if (!hasData()) { needData(); return; }
    var c = calc();
    append(main, warningsBox(c));
    main.appendChild(h('div', { class: 'alert info' },
      '예상재고 = 현재고 + 입고예정수량 − 수주수량, 과부족수량 = 예상재고 − 안전재고 (기획안 8장). 부족수량은 일자별 예상재고가 안전재고 아래로 가장 많이 내려간 만큼입니다. 행을 누르면 일자별 예상재고를 봅니다.'));
    var sel = h('select', { 'aria-label': '상태' }, h('option', { value: '' }, '전체 상태'), ['긴급', '부족', '주의', '과잉', '정상'].map(function (s) { return h('option', { value: s }, s); }));
    sel.value = filter.status;
    var q = h('input', { type: 'search', placeholder: '품번·품명 검색', value: filter.q, 'aria-label': '품번·품명 검색' });
    var holder = h('div');
    function draw() {
      filter.status = sel.value; filter.q = q.value.trim().toLowerCase();
      var rows = c.res.results.filter(function (r) {
        return (!filter.status || r.status === filter.status) && (!filter.q || (r.item + ' ' + r.name).toLowerCase().indexOf(filter.q) >= 0);
      });
      holder.textContent = '';
      holder.appendChild(h('div', { class: 'list-meta' }, h('span', null, rows.length + '개 품번')));
      holder.appendChild(rows.length ? resultTable(rows, c, false) : h('p', { class: 'empty' }, '조건에 맞는 품번이 없습니다.'));
    }
    sel.addEventListener('change', draw); q.addEventListener('input', draw);
    main.appendChild(h('div', { class: 'card' }, h('div', { class: 'form-grid' }, h('label', { class: 'field' }, h('span', null, '상태'), sel), h('label', { class: 'field' }, h('span', null, '검색'), q)), holder));
    draw();
  }

  // ── 일자별 예상재고 ──────────────────────────────────
  function viewDaily(arg) {
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '일자별 예상재고')));
    if (!hasData()) { needData(); return; }
    var c = calc();
    var items = c.res.results.map(function (r) { return r.item; }).sort();
    if (!items.length) { main.appendChild(h('p', { class: 'empty' }, '품번이 없습니다.')); return; }
    var cur = items.indexOf(arg) >= 0 ? arg : c.res.results[0].item;
    var r = c.res.results.filter(function (x) { return x.item === cur; })[0];
    var sel = h('select', { 'aria-label': '품번', onchange: function () { location.hash = '#/daily/' + encodeURIComponent(sel.value); } },
      items.map(function (i) { return h('option', { value: i }, i); }));
    sel.value = cur;
    main.appendChild(h('div', { class: 'card' },
      h('div', { class: 'form-grid' }, h('label', { class: 'field' }, h('span', null, '품번'), sel)),
      h('p', { style: 'margin-top:12px' }, h('strong', null, r.item), r.name ? ' · ' + r.name : '', ' ', badge(r.status)),
      h('p', { class: 'note' }, '현재고 ' + n(r.stock) + ' · 입고예정 ' + n(r.inSum) + ' · 수주 ' + n(r.orderSum) + ' · 안전재고 ' + n(r.safety) + (r.safetyFromFile ? '(파일)' : '(기본값)') +
        ' · 예상재고 ' + n(r.expected) + ' · 과부족 ' + n(r.balance) + ' · 부족수량 ' + n(r.shortage)),
      r.flags.length ? h('p', null, r.flags.map(function (f) { return h('span', { class: 'tag warn' }, L.flagLabel(f)); })) : null));
    var rows = [h('tr', { class: 'row-base' }, h('td', { class: 'nowrap' }, L.fmtDate(c.res.base)), h('td', null, '기준일 현재고'), h('td', { class: 'num' }, ''), h('td', { class: 'num' }, ''),
      h('td', { class: 'num' + (r.stock < r.safety ? ' neg' : '') }, n(r.stock)), h('td', { class: 'num' + (r.stock - r.safety < 0 ? ' neg' : '') }, n(r.stock - r.safety)))];
    r.daily.forEach(function (d) {
      rows.push(h('tr', null, h('td', { class: 'nowrap' }, L.fmtDate(d.date)), h('td', null, [d.inQty ? '입고' : '', d.outQty ? '납기' : ''].filter(Boolean).join(' · ')),
        h('td', { class: 'num' }, d.inQty ? '+' + n(d.inQty) : ''), h('td', { class: 'num' }, d.outQty ? '−' + n(d.outQty) : ''),
        h('td', { class: 'num' + (d.stock < 0 ? ' neg' : '') }, n(d.stock)), h('td', { class: 'num' + (d.gap < 0 ? ' neg' : '') }, n(d.gap))));
    });
    main.appendChild(h('div', { class: 'card' }, h('h2', null, '날짜별 흐름'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, h('th', null, '일자'), h('th', null, '구분'), h('th', { class: 'num' }, '입고예정'), h('th', { class: 'num' }, '수주(납기)'), h('th', { class: 'num' }, '예상재고'), h('th', { class: 'num' }, '안전재고 대비'))),
        h('tbody', null, rows))),
      h('p', { class: 'note', style: 'margin-top:8px' }, '입고·납기가 있는 날만 표시합니다. 기준일 전 납기 수주는 기준일에 뺍니다(가정).')));
    var ps = c.plans.filter(function (p) { return p.item === cur; });
    var ss = c.res.shipments.filter(function (s) { return s.item === cur; });
    main.appendChild(h('div', { class: 'grid-2' },
      h('div', { class: 'card' }, h('h2', null, '선적예정 (파일)'), ss.length ? h('ul', null, ss.map(function (s) {
        return h('li', null, L.fmtDate(s.shipDate) + ' 선적 ' + n(s.qty) + ' → ' + (s.arrival ? L.fmtDate(s.arrival) + ' 입고' : '입고일 없음'), s.issues.map(function (i) { return h('span', { class: 'tag warn' }, L.issueLabel(i)); }));
      })) : h('p', { class: 'note' }, '없음')),
      h('div', { class: 'card' }, h('h2', null, '제안 선적계획'), ps.length ? h('ul', null, ps.map(function (p) {
        return h('li', null, L.fmtDate(p.shipDate) + ' 선적 ' + n(p.qty) + ' → ' + (p.arrival ? L.fmtDate(p.arrival) : '규칙 없음') + ' 입고 (필요일 ' + p.needDate + ')', p.late ? h('span', { class: 'tag warn' }, '필요일보다 늦게 입고') : null);
      })) : h('p', { class: 'note' }, '추가 선적이 필요 없습니다.'))));
  }

  // ── 선적계획 ─────────────────────────────────────────
  function viewPlan() {
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '선적계획')));
    if (!hasData()) { needData(); return; }
    var c = calc();
    append(main, warningsBox(c));
    main.appendChild(h('div', { class: 'alert info' },
      '부족이 생기는 날마다 모자란 수량을, 그날' + (Number(st.settings.arrivalBuffer) ? '보다 ' + st.settings.arrivalBuffer + '일 먼저' : '') +
      '까지 한국에 입고되는 가장 늦은 중국 선적일로 제안합니다(입고예정일 규칙 역산). 선적일·수량은 고칠 수 있고, 고치면 입고예정일을 다시 계산합니다.'));
    var plans = c.plans.slice().sort(function (a, b) { return a.shipDate.localeCompare(b.shipDate) || a.item.localeCompare(b.item); });
    function edit(p, field, value) {
      var e = st.planEdits[p.id] || { shipDate: p.shipDate, qty: p.qty };
      e[field] = value;
      st.planEdits[p.id] = e; save(); render();
    }
    var body = plans.map(function (p) {
      var d = h('input', { type: 'date', value: p.shipDate, 'aria-label': p.item + ' 선적일', onchange: function () { if (d.value) edit(p, 'shipDate', d.value); } });
      var q = h('input', { type: 'number', min: '0', step: '1', value: String(p.qty), 'aria-label': p.item + ' 선적수량', onchange: function () { if (q.value !== '') edit(p, 'qty', q.value); } });
      return h('tr', null,
        h('td', { class: 'nowrap' }, h('strong', null, p.item)), h('td', null, p.name), h('td', null, badge(p.status)),
        h('td', { class: 'nowrap' }, L.fmtDate(p.needDate)), h('td', null, d), h('td', null, L.WEEKDAY_KO[L.weekday(p.shipDate)]), h('td', null, q),
        h('td', { class: 'nowrap' }, p.arrival ? L.fmtDate(p.arrival) : '규칙 없음'),
        h('td', null, p.late ? h('span', { class: 'tag warn' }, '필요일보다 늦게 입고') : null, p.edited ? h('span', { class: 'tag' }, '사용자 수정') : null),
        h('td', null, p.edited ? h('button', { type: 'button', class: 'btn btn-small', onclick: function () { delete st.planEdits[p.id]; save(); render(); } }, '되돌리기') : null));
    });
    main.appendChild(h('div', { class: 'card' }, h('h2', null, '제안 선적계획 ' + plans.length + '건'),
      plans.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, ['품번', '품명', '상태', '필요일', '중국 선적일', '요일', '선적수량', '한국 입고예정일', '비고', ''].map(function (x) { return h('th', null, x); }))),
        h('tbody', null, body))) : h('p', { class: 'note' }, '추가 선적이 필요한 품번이 없습니다.'),
      Object.keys(st.planEdits).length ? h('div', { class: 'btn-row', style: 'margin-top:12px' }, h('button', { type: 'button', class: 'btn', onclick: function () { st.planEdits = {}; save(); render(); } }, '수정 모두 되돌리기')) : null));

    main.appendChild(h('div', { class: 'card' }, h('h2', null, '입고예정 계산표 (파일의 선적예정)'),
      h('p', { class: 'note' }, '중국 선적예정일에 입고예정일 규칙(설정)을 적용한 결과입니다. 기준일 전에 입고된 건은 현재고에 들어 있는 것으로 보고 뺍니다(가정).'),
      c.res.shipments.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, ['품번', '중국 선적예정일', '선적수량', '규칙 계산 입고예정일', '파일 입고예정일', '비고'].map(function (x) { return h('th', null, x); }))),
        h('tbody', null, c.res.shipments.map(function (s) {
          return h('tr', null, h('td', { class: 'nowrap' }, s.item), h('td', { class: 'nowrap' }, L.fmtDate(s.shipDate)), h('td', { class: 'num' }, n(s.qty)),
            h('td', { class: 'nowrap' }, s.calcArrival ? L.fmtDate(s.calcArrival) : '규칙 없음'), h('td', { class: 'nowrap' }, s.fileArrival ? L.fmtDate(s.fileArrival) : ''),
            h('td', null, s.issues.map(function (i) { return h('span', { class: 'tag warn' }, L.issueLabel(i)); })));
        })))) : h('p', { class: 'note' }, '선적예정 자료가 없습니다.')));
  }

  // ── AI 분석 (반자동) ─────────────────────────────────
  function viewAi() {
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, 'AI 분석')));
    if (!hasData()) { needData(); return; }
    var c = calc();
    var prompt = L.buildAiPrompt(c.res, c.plans, { includeName: st.ai.includeName });
    main.appendChild(h('div', { class: 'alert info' },
      '이 도구는 AI에 직접 접속하지 않습니다. 아래 질문문을 복사해 사내에서 사용이 허용된 AI에 붙여 넣고, 받은 답을 아래 칸에 붙여 넣습니다. 질문문에는 품번과 계산 수치만 들어가며 고객사는 넣지 않습니다.'));
    main.appendChild(h('div', { class: 'grid-2' },
      h('div', { class: 'card' }, h('h2', null, '1. 질문문 복사'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.ai.includeName, onchange: function (e) { st.ai.includeName = e.target.checked; save(); render(); } }), '품명도 넣기'),
        h('div', { class: 'prompt-box', tabindex: '0' }, prompt),
        h('div', { class: 'btn-row', style: 'margin-top:12px' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { copyText(prompt); } }, '질문문 복사'))),
      (function () {
        var ta = h('textarea', { name: 'ai_answer', 'aria-label': 'AI 답', placeholder: L.AI_FORMAT + '\nA001 | 1 | …' });
        ta.value = st.ai.answer;
        return h('div', { class: 'card' }, h('h2', null, '2. AI 답 붙여넣기'),
          h('p', { class: 'note' }, '형식: 한 줄에 한 품번, 「' + L.AI_FORMAT + '」'),
          h('label', { class: 'field' }, h('span', null, 'AI 답'), ta),
          h('div', { class: 'btn-row', style: 'margin-top:12px' },
            h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { st.ai.answer = ta.value; save(); render(); toast('답을 읽었습니다'); } }, '답 읽기'),
            h('button', { type: 'button', class: 'btn', onclick: function () { st.ai.answer = ''; save(); render(); } }, '비우기')));
      })()));
    var res = h('div', { class: 'card' }, h('h2', null, '3. 품번별 AI 의견'));
    if (!c.ai.rows.length) res.appendChild(h('p', { class: 'note' }, st.ai.answer ? '형식에 맞는 줄을 찾지 못했습니다.' : '아직 붙여 넣은 답이 없습니다.'));
    else {
      var byItem = {};
      c.res.results.forEach(function (r) { byItem[r.item] = r; });
      res.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, ['우선순위', '품번', '상태', '부족수량', 'AI 의견'].map(function (x) { return h('th', null, x); }))),
        h('tbody', null, c.ai.rows.map(function (a) {
          var r = byItem[a.item];
          return h('tr', null, h('td', { class: 'num' }, a.priority), h('td', { class: 'nowrap' }, a.item), h('td', null, badge(r.status)), h('td', { class: 'num' }, n(r.shortage)), h('td', null, a.comment));
        })))));
      res.appendChild(h('p', { class: 'note', style: 'margin-top:8px' }, 'AI 의견은 참고용입니다. 수량과 날짜는 계산 결과(과부족 현황·선적계획)를 기준으로 판단합니다.'));
    }
    if (c.ai.skipped.length) res.appendChild(h('div', { class: 'alert warn' }, '형식에 맞지 않거나 모르는 품번이라 읽지 않은 줄 ' + c.ai.skipped.length + '개: ', c.ai.skipped.slice(0, 5).join(' / ')));
    main.appendChild(res);
  }

  // ── 공유·내보내기 ────────────────────────────────────
  function viewShare() {
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '공유·내보내기')));
    if (!hasData()) { needData(); return; }
    var c = calc();
    var text = shareText(c);
    main.appendChild(h('div', { class: 'grid-2' },
      h('div', { class: 'card' }, h('h2', null, '공유용 Excel'),
        h('p', null, '생산·구매·물류 담당자에게 보낼 파일입니다. 시트: 과부족현황, 선적계획, 부족품번, 일자별예상재고, 입고예정계산.'),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
            writeXlsx(L.exportSheets(c.res, c.plans, c.ai.rows), '선적계획_' + c.res.base + suffix() + '.xlsx');
          } }, '공유용 Excel 내려받기'),
          h('button', { type: 'button', class: 'btn', onclick: function () {
            download('선적계획_' + c.res.base + suffix() + '.csv', new Blob([L.toCsv(L.exportSheets(c.res, c.plans, c.ai.rows)['선적계획'])], { type: 'text/csv;charset=utf-8' }));
          } }, '선적계획만 CSV'))),
      h('div', { class: 'card' }, h('h2', null, '담당자 안내문 초안'),
        h('p', { class: 'note' }, '메일·메신저에 붙여 넣어 쓰는 글입니다. 자동 발송은 2단계에서 다룹니다.'),
        h('div', { class: 'prompt-box', tabindex: '0' }, text),
        h('div', { class: 'btn-row', style: 'margin-top:12px' }, h('button', { type: 'button', class: 'btn', onclick: function () { copyText(text); } }, '안내문 복사')))));
  }
  function shareText(c) { return L.shareText(c.res, c.plans, c.k); }

  // ── 자료 가져오기 (열 매핑) ──────────────────────────
  function viewData() {
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '자료 가져오기'), sampleButton(false)));
    if (!S.available()) main.appendChild(h('div', { class: 'alert warn' }, '이 브라우저는 저장소를 쓸 수 없어, 창을 닫으면 불러온 자료가 사라집니다.'));
    main.appendChild(h('div', { class: 'alert info' },
      '수주현황·재고현황·중국 선적예정 파일(xlsx·xls·csv)을 각각 넣고, 각 항목이 파일의 어느 열인지 고릅니다. 고른 매핑은 저장되어 같은 양식의 파일을 다음에 넣으면 자동으로 맞춰집니다. 파일은 이 브라우저 안에서만 읽습니다.'));
    main.appendChild(h('div', { class: 'grid-3' }, KEYS.map(datasetCard)));
    var whole = h('input', { type: 'file', accept: '.xlsx,.xls', 'aria-label': '통합 데이터 파일' });
    whole.addEventListener('change', function () {
      var f = whole.files[0]; if (!f) return;
      readFile(f, function (err, wb) {
        if (err) { toast('파일을 읽지 못했습니다: ' + (err.message || err), true); return; }
        var got = [];
        KEYS.forEach(function (k) {
          var nm = wb.names.filter(function (x) { return x.trim() === L.DATASETS[k].label; })[0];
          if (nm) { setTable(k, f.name, nm, wb.sheets[nm]); pendingSheets[k] = null; got.push(L.DATASETS[k].label); }
        });
        if (!got.length) { toast('「수주현황」「재고현황」「선적예정」 이름의 시트가 없습니다', true); return; }
        st._sample = /예시/.test(f.name);
        save(); render(); toast(got.join(', ') + ' 시트를 불러왔습니다');
      });
    });
    main.appendChild(h('div', { class: 'card' }, h('h2', null, '통합 데이터 파일'),
      h('p', null, '세 자료를 표준 열 이름으로 한 파일(시트 3개)에 담아 보관하거나 다시 불러옵니다.'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: function () {
          if (!hasData()) { toast('불러온 자료가 없습니다', true); return; }
          writeXlsx(L.dataSheets(mapped().data), '통합데이터_' + L.todayIso() + suffix() + '.xlsx');
        } }, '통합 데이터 파일 내려받기'),
        h('label', { class: 'field', style: 'flex:1 1 220px' }, h('span', null, '통합 파일 불러오기'), whole)),
      h('hr', { style: 'border:none;border-top:1px solid var(--line);margin:16px 0' }),
      h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
        if (!window.confirm('불러온 자료·설정·선적계획 수정·AI 답·수주 취합 결과·품번 매핑표·업로드 양식 설정을 모두 지웁니다. 계속할까요?')) return;
        S.clear(); S.clearMapping(); S.clearPriceTable(); partMap = null; priceTable = null; st = S.empty(); intakeFiles = null; intakeSide = { stock: null, shipments: null }; save(); render(); toast('모두 지웠습니다');
      } }, '모두 지우기')));
  }
  function datasetCard(k) {
    var ds = L.DATASETS[k], t = st.tables[k];
    var input = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', 'aria-label': ds.label + ' 파일' });
    input.addEventListener('change', function () {
      var f = input.files[0]; if (!f) return;
      readFile(f, function (err, wb) {
        if (err) { toast('파일을 읽지 못했습니다: ' + (err.message || err), true); return; }
        var nm = wb.names.filter(function (x) { return x.trim() === ds.label; })[0] || wb.names[0];
        pendingSheets[k] = wb.names.length > 1 ? wb : null;
        setTable(k, f.name, nm, wb.sheets[nm]);
        if (st._sample && !/예시/.test(f.name)) st._sample = false;
        save(); render(); toast(ds.label + ' 파일을 읽었습니다');
      });
    });
    var card = h('div', { class: 'card' }, h('h2', null, ds.label),
      h('label', { class: 'field' }, h('span', null, t ? '다른 파일로 바꾸기' : '파일 선택'), input));
    if (!t) { card.appendChild(h('p', { class: 'note', style: 'margin-top:8px' }, '항목: ' + ds.fields.map(function (f) { return f.label; }).join(', '))); return card; }
    card.appendChild(h('p', { class: 'note', style: 'margin-top:8px' }, t.fileName + (t.sheet ? ' · 시트 ' + t.sheet : '')));
    var pend = pendingSheets[k];
    if (pend) {
      var ssel = h('select', { 'aria-label': '시트', onchange: function () { setTable(k, t.fileName, ssel.value, pend.sheets[ssel.value]); save(); render(); } },
        pend.names.map(function (x) { return h('option', { value: x }, x); }));
      ssel.value = t.sheet;
      card.appendChild(h('label', { class: 'field' }, h('span', null, '시트'), ssel));
    }
    var headers = (t.aoa[t.headerRow] || []).map(function (x) { return String(x); });
    var hr = h('input', { type: 'number', min: '1', max: String(Math.max(1, t.aoa.length)), value: String(t.headerRow + 1), 'aria-label': '머리행 번호',
      onchange: function () {
        var v = Math.max(1, Math.min(t.aoa.length, parseInt(hr.value, 10) || 1)) - 1;
        t.headerRow = v; t.mapping = initialMapping(k, (t.aoa[v] || []).map(String)); save(); render();
      } });
    var grid = h('div', { class: 'map-grid' }, h('label', { class: 'field' }, h('span', null, '머리행(열 이름이 있는 행)'), hr));
    ds.fields.forEach(function (f) {
      var s = h('select', { 'aria-label': f.label, onchange: function () {
        if (s.value === '') { delete t.mapping[f.key]; delete st.savedMappings[k][f.key]; }
        else {
          var idx = Number(s.value);
          Object.keys(t.mapping).forEach(function (g) { if (t.mapping[g] === idx) delete t.mapping[g]; });
          t.mapping[f.key] = idx; st.savedMappings[k][f.key] = headers[idx];
        }
        st.planEdits = {}; save(); render();
      } }, h('option', { value: '' }, '(없음)'), headers.map(function (x, i) { return h('option', { value: String(i) }, x || '(' + (i + 1) + '번째 열)'); }));
      s.value = t.mapping[f.key] === undefined ? '' : String(t.mapping[f.key]);
      grid.appendChild(h('label', { class: 'field' + (f.required && s.value === '' ? ' missing' : '') },
        h('span', null, f.label, f.required ? h('span', { class: 'req' }, ' *') : null), s));
    });
    card.appendChild(grid);
    var r = L.mapRows(t.aoa, t.headerRow, t.mapping, k);
    var unm = r.errors.filter(function (e) { return e.code === 'unmapped'; });
    if (unm.length) card.appendChild(h('div', { class: 'alert warn' }, '필수 항목을 골라 주세요: ', unm.map(function (e) { return fieldLabel(k, e.field); }).join(', ')));
    else {
      card.appendChild(h('p', null, h('strong', null, '읽은 행 ' + r.rows.length + '개')));
      var bad = r.errors.filter(function (e) { return e.row > 0; });
      if (bad.length) card.appendChild(h('div', { class: 'alert warn' }, '확인할 칸 ' + bad.length + '곳',
        h('ul', null, bad.slice(0, 6).map(function (e) {
          return h('li', null, e.row + '행 ' + fieldLabel(k, e.field) + ': ' + (e.code === 'empty' ? '비어 있음(행 제외)' : '「' + e.value + '」 읽을 수 없음' + (e.code === 'bad_value' ? '(행 제외)' : '(무시)')));
        }), bad.length > 6 ? h('li', null, '외 ' + (bad.length - 6) + '곳') : null)));
    }
    var prev = t.aoa.slice(t.headerRow + 1, t.headerRow + 4);
    card.appendChild(h('details', null, h('summary', null, '원본 미리보기 (3행)'),
      h('div', { class: 'table-wrap preview' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, headers.map(function (x) { return h('th', null, x); }))),
        h('tbody', null, prev.map(function (row) { return h('tr', null, headers.map(function (_, i) { return h('td', { class: 'nowrap' }, row[i] == null ? '' : String(row[i])); })); }))))));
    return card;
  }
  function fieldLabel(k, key) { return L.DATASETS[k].fields.filter(function (f) { return f.key === key; })[0].label; }

  // ── 설정 ─────────────────────────────────────────────
  function viewSettings() {
    var s = st.settings;
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '설정')));
    function num(name, value, attrs) { return h('input', Object.assign({ type: 'number', name: name, value: value === null || value === undefined ? '' : String(value) }, attrs || {})); }
    var base = h('input', { type: 'date', name: 'baseDate', value: s.baseDate || '' });
    var stockSel = h('select', { name: 'stockField' }, h('option', { value: 'current' }, '현재고 (기획안 8장 공식)'), h('option', { value: 'available' }, '가용재고'));
    stockSel.value = s.stockField;
    var safety = num('defaultSafety', s.defaultSafety, { min: '0', step: '1' });
    var urgent = num('urgentDays', s.urgentDays, { min: '0', step: '1' });
    var excess = num('excessRatio', s.excessRatio, { min: '0', step: '1' });
    var buffer = num('arrivalBuffer', s.arrivalBuffer, { min: '0', step: '1' });
    var hol = h('textarea', { name: 'holidays', placeholder: '2026-10-05\n2026-10-09' });
    hol.value = s.holidays.join('\n');
    var ruleInputs = {};
    var ruleRows = [1, 2, 3, 4, 5, 6, 0].map(function (w) {
      var inp = num('rule' + w, s.rule[w], { min: '0', max: '60', step: '1', placeholder: '규칙 없음', 'aria-label': L.WEEKDAY_KO[w] + '요일 선적 후 입고까지 일수' });
      ruleInputs[w] = inp;
      var off = s.rule[w];
      var eg = off === null ? '규칙 없음 — 계산에서 제외' : '→ ' + L.WEEKDAY_KO[(w + off) % 7] + '요일 입고';
      return h('tr', null, h('td', null, L.WEEKDAY_KO[w] + '요일 선적'), h('td', null, inp), h('td', { class: 'note' }, eg));
    });
    var form = h('form', { class: 'card', onsubmit: function (e) {
      e.preventDefault();
      var rule = {};
      Object.keys(ruleInputs).forEach(function (w) { rule[w] = ruleInputs[w].value === '' ? null : Number(ruleInputs[w].value); });
      var hs = hol.value.split(/[\s,]+/).filter(Boolean), badH = hs.filter(function (x) { return !L.parseDate(x); });
      if (badH.length) { toast('휴일 날짜를 읽을 수 없습니다: ' + badH.join(', '), true); return; }
      st.settings = L.mergeSettings({ baseDate: base.value, stockField: stockSel.value, defaultSafety: safety.value === '' ? 0 : Number(safety.value),
        rule: rule, holidays: hs, urgentDays: urgent.value, excessRatio: excess.value, arrivalBuffer: buffer.value === '' ? 0 : Number(buffer.value) });
      st.planEdits = {}; save(); render(); toast('설정을 저장했습니다');
    } },
      h('h2', null, '계산 기준'),
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', null, '기준일 (현재고 기준 시점)'), base, h('small', null, '비우면 오늘 날짜로 계산합니다.')),
        h('label', { class: 'field' }, h('span', null, '재고 기준 열'), stockSel, h('small', null, '현재고와 가용재고 중 무엇을 쓸지는 확인이 필요합니다.')),
        h('label', { class: 'field' }, h('span', null, '기본 안전재고'), safety, h('small', null, '재고현황에 안전재고 열이 없거나 빈 품번에 씁니다.'))),
      h('h2', { style: 'margin-top:20px' }, '상태 판정 기준 (가정값 — 수강생 확인 필요)'),
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', null, '긴급 기준일수'), urgent, h('small', null, '과부족이 음수이고 첫 부족일이 기준일로부터 이 일수 이내면 「긴급」. 비우면 판정하지 않습니다.')),
        h('label', { class: 'field' }, h('span', null, '과잉 기준 비율(%)'), excess, h('small', null, '과부족수량이 수주수량 합계의 이 비율 이상이면 「과잉」. 비우면 판정하지 않습니다.')),
        h('label', { class: 'field' }, h('span', null, '입고 여유일'), buffer, h('small', null, '선적계획을 역산할 때 필요일보다 며칠 먼저 입고되게 할지.'))),
      h('h2', { style: 'margin-top:20px' }, '한국 입고예정일 규칙'),
      h('p', { class: 'note' }, '원문: 월~수 선적 → 2일 후 입고, 목~금 선적 → 다음 월요일 입고. 칸의 숫자는 「선적일 + N일」입니다. 비우면 그 요일은 규칙 없음으로 봅니다.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list' }, h('thead', null, h('tr', null, h('th', null, '선적 요일'), h('th', null, '입고까지 일수'), h('th', null, '결과'))), h('tbody', null, ruleRows))),
      h('div', { class: 'form-grid', style: 'margin-top:14px' },
        h('label', { class: 'field' }, h('span', null, '휴일 목록'), hol, h('small', null, '한 줄에 하나(YYYY-MM-DD). 계산된 입고일이 휴일·주말이면 다음 영업일로 미룹니다(가정).'))),
      h('div', { class: 'btn-row', style: 'margin-top:16px' },
        h('button', { type: 'submit', class: 'btn btn-primary' }, '저장'),
        h('button', { type: 'button', class: 'btn', onclick: function () {
          st.settings = L.mergeSettings({ baseDate: s.baseDate }); st.planEdits = {}; save(); render(); toast('기본값으로 되돌렸습니다');
        } }, '기본값으로')));
    main.appendChild(form);
  }

  // ── 수주 취합 (기획서 11장) ─────────────────────────────
  // 넣은 파일은 이 창에서만 기억합니다(설정을 바꾸면 다시 계산). 결과 표만 브라우저에 저장합니다.
  var intakeFiles = null, intakeSide = { stock: null, shipments: null }, intakeFilter = { group: '', q: '' }, intakeBusy = false;
  function fnv(buf) { var h = 0x811c9dc5; for (var i = 0; i < buf.length; i++) { h ^= buf[i]; h = Math.imul(h, 16777619) >>> 0; } return h.toString(16) + ':' + buf.length; }

  var pdfjsPromise = null;
  function loadPdfJs() {
    if (pdfjsPromise) return pdfjsPromise;
    function load(src) {
      return new Promise(function (resolve, reject) {
        var el = document.createElement('script');
        el.src = src; el.onload = resolve;
        el.onerror = function () { reject(new Error('PDF 라이브러리(' + src + ')를 불러오지 못했습니다')); };
        document.head.appendChild(el);
      });
    }
    // 로컬 파일(file://)로 열면 Worker 가 막히므로 worker 스크립트를 먼저 읽어 메인 스레드에서 돌립니다
    pdfjsPromise = load('vendor/pdfjs/pdf.min.js')
      .then(function () { return location.protocol === 'file:' ? load('vendor/pdfjs/pdf.worker.min.js') : null; })
      .then(function () {
        var lib = window.pdfjsLib;
        if (!lib) throw new Error('PDF 라이브러리를 불러오지 못했습니다');
        lib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
        return lib;
      });
    pdfjsPromise.catch(function () { pdfjsPromise = null; });
    return pdfjsPromise;
  }
  function pdfItems(bytes) {
    return loadPdfJs().then(function (lib) {
      return lib.getDocument({ data: bytes, cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true, isEvalSupported: false }).promise;
    }).then(function (doc) {
      var out = [], p = Promise.resolve();
      for (var i = 1; i <= doc.numPages; i++) (function (n) {
        p = p.then(function () { return doc.getPage(n); }).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
          tc.items.forEach(function (it) { if (it.str) out.push({ x: it.transform[4], y: it.transform[5], str: it.str, page: n }); });
        });
      })(i);
      return p.then(function () { return out; });
    });
  }
  /** 파일 하나 → intake 입력 {name, hash, sheets | pdf | error} */
  function readIntakeFile(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onerror = function () { resolve({ name: file.name, error: String(reader.error) }); };
      reader.onload = function () {
        var buf = new Uint8Array(reader.result), hash = fnv(buf);
        if (/\.pdf$/i.test(file.name)) {
          pdfItems(buf).then(function (items) { resolve({ name: file.name, hash: hash, pdf: items }); },
            function (err) { resolve({ name: file.name, hash: hash, pdf: null, pdfError: String(err && err.message || err) }); });
          return;
        }
        try {
          var wb;
          if (/\.csv$/i.test(file.name)) {
            var text;
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder('euc-kr').decode(buf); }
            wb = XLSX.read(text.replace(/^﻿/, ''), { type: 'string', raw: true });
          } else wb = XLSX.read(I.fixZip(buf, XLSX), { type: 'array', cellDates: true });
          var sheets = {};
          wb.SheetNames.forEach(function (nm) { sheets[nm] = XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, raw: true, defval: '' }); });
          resolve({ name: file.name, hash: hash, sheets: { names: wb.SheetNames, sheets: sheets } });
        } catch (err) { resolve({ name: file.name, hash: hash, error: String(err && err.message || err) }); }
      };
      reader.readAsArrayBuffer(file);
    });
  }
  function runIntake(sample) {
    var input = intakeFiles.map(function (f) { return f.error ? { name: f.name, hash: f.hash } : f; });
    var res = I.process(input, st.intakeOpts);
    intakeFiles.forEach(function (f) { if (f.error) res.checks.unshift({ file: f.name, row: '', reason: '파일을 읽지 못함', detail: f.error }); });
    intakeSide = { stock: res.stock, shipments: res.shipments };
    st.intake = { base: res.base, fileBase: res.fileBase, rows: res.rows, files: res.files, checks: res.checks, options: res.options, at: new Date().toISOString(), sample: !!sample,
      stockCount: res.stock ? res.stock.length : 0, shipCount: res.shipments ? res.shipments.length : 0, lastBobcatDate: res.lastBobcatDate };
    save();
  }
  function addIntakeFiles(list, sample) {
    if (!list.length || intakeBusy) return;
    intakeBusy = true; toast('파일 ' + list.length + '개를 읽는 중입니다…');
    Promise.all(list.map(readIntakeFile)).then(function (got) {
      intakeFiles = got; intakeBusy = false;
      runIntake(sample); render();
      toast('파일 ' + got.length + '개를 취합했습니다 — 통합 수주 ' + st.intake.rows.length + '행, ★확인 필요 ' + st.intake.checks.length + '건');
    });
  }
  function intakeSampleRun() {
    intakeFiles = ISample.asInput();
    st.intakeOpts = I.mergeOptions(Object.assign({}, st.intakeOpts, { base: ISample.BASE }));
    runIntake(true); render();
    toast('예시 파일 ' + intakeFiles.length + '개로 취합했습니다(가상 데이터)');
  }
  /** 통합 수주에 매핑표를 적용한 결과 {rows, checks, stats} — 저장된 결과에도 매번 새로 적용합니다(매핑표를 바꾸면 바로 반영) */
  function mappedIntake() {
    if (!st.intake) return null;
    var mi = M.apply(st.intake.rows, partMap, st.mapOpts);
    // 판매단가(고객 발주, 참고)는 원본 그대로, 매입단가(생산처 발주, 기획서 11.12)는 매입단가표 → 직접입력. 바꾸면 바로 반영
    mi.price = Pr.apply(mi.rows, priceTable, st.manualBuy);
    mi.rows = mi.price.rows;
    return mi;
  }
  function readPriceFile(file) {
    readFile(file, function (err, book) {
      if (err) { toast('매입단가표를 읽지 못했습니다: ' + (err.message || err), true); return; }
      var p = Pr.parseBook(book);
      if (!p.stats.pairs) { toast(p.problems[0] || '매입단가표에서 읽은 단가가 없습니다', true); return; }
      priceTable = Object.assign(p, { file: file.name, at: new Date().toISOString() });
      S.savePriceTable(priceTable); render();
      toast('매입단가표를 읽었습니다 — 품목 ' + n(p.stats.pairs) + '개' + (p.stats.makers ? ' · 생산처 ' + p.stats.makers + '곳' : '') + (p.stats.conflicts ? ' · 단가 충돌 ' + p.stats.conflicts + '건(위쪽 값)' : ''));
    });
  }
  function readMappingFile(file) {
    readFile(file, function (err, book) {
      if (err) { toast('매핑표를 읽지 못했습니다: ' + (err.message || err), true); return; }
      var p = M.parseBook(book, file.name);
      if (!Object.keys(p.groups).length) { toast(p.problems[0] || '매핑표에서 읽은 행이 없습니다', true); return; }
      partMap = M.merge(partMap, p, file.name, new Date().toISOString());
      partMap.problems = p.problems;
      S.saveMapping(partMap); render();
      toast('매핑표를 읽었습니다 — ' + Object.keys(p.groups).map(function (g) { return M.GROUPS[g].label + ' ' + n(p.groups[g].pairs) + '개'; }).join(', '));
    });
  }
  function readTemplateFile(file) {
    readFile(file, function (err, book) {
      if (err) { toast('양식 파일을 읽지 못했습니다: ' + (err.message || err), true); return; }
      var t = U.readTemplate(book);
      if (t.error) { toast(t.error, true); return; }
      st.uploadTpl = { fileName: file.name, sheet: t.sheet, headers: t.headers };
      save(); render(); toast('업로드 양식을 읽었습니다 — 시트「' + t.sheet + '」 ' + t.headers.length + '열');
    });
  }
  function uploadTemplate() { return st.uploadTpl || U.defaultTemplate(); }
  function exportUpload() {
    var mi = mappedIntake();
    if (!mi || !mi.rows.length) { toast('내보낼 수주가 없습니다', true); return; }
    var out = U.build(mi.rows, uploadTemplate(), st.uploadOpts, { today: L.todayIso(), base: st.intake.base });
    if (!out.count) { toast('내보낼 행이 없습니다(매핑 없는 ' + out.skipped.unmapped + '행은 설정대로 뺐습니다)', true); return; }
    var sheets = {}; sheets[out.sheet] = out.aoa;
    writeXlsx(sheets, '업로드양식_' + st.intake.base + (st.intake.sample ? '_예시데이터' : '') + '.xlsx');
    toast('업로드 양식 ' + out.count + '행을 내보냈습니다' + (out.skipped.unmapped ? ' · 매핑 없는 ' + out.skipped.unmapped + '행은 뺐습니다' : '') + (out.noPrice ? ' · 매입단가 없음 ' + out.noPrice + '행은 단가 빈칸' : '') + (out.noParty ? ' · 납품처 코드 없음 ' + out.noParty + '행' : ''));
  }
  function sendIntakeToPlan() {
    var r = st.intake;
    if (!r || !r.rows.length) { toast('넘길 수주가 없습니다', true); return; }
    var mi = mappedIntake(), planRows = M.planRows(mi.rows, st.mapOpts);
    if (!planRows.length) { toast('넘길 수주가 없습니다(매핑 없는 행을 모두 뺐습니다)', true); return; }
    setTable('orders', '수주취합_' + r.base + '.xlsx', '수주현황', I.ordersAoa(planRows)); pendingSheets.orders = null;
    var sent = ['수주 ' + planRows.length + '행' + (mi.stats.loaded ? '(천일품번으로)' : '')];
    if (intakeSide.stock) { setTable('stock', '창고별재고현황(수주 취합에서).xlsx', '재고현황', L.dataSheets({ stock: intakeSide.stock })['재고현황']); pendingSheets.stock = null; sent.push('재고 ' + intakeSide.stock.length + '행'); }
    if (intakeSide.shipments) { setTable('shipments', '선적계획(수주 취합에서).xlsx', '선적예정', L.dataSheets({ shipments: intakeSide.shipments })['선적예정']); pendingSheets.shipments = null; sent.push('선적예정 ' + intakeSide.shipments.length + '행'); }
    var missing = (r.stockCount && !intakeSide.stock) || (r.shipCount && !intakeSide.shipments);
    st.settings = L.mergeSettings(Object.assign({}, st.settings, { baseDate: r.base }));
    st._sample = !!r.sample;
    save();
    toast(sent.join(' · ') + '을 넘기고 기준일을 ' + r.base + '로 맞췄습니다' + (missing ? ' (재고·선적계획 파일은 창을 새로 열어 기억이 없어 넘기지 못했습니다 — 다시 넣어 주세요)' : ''));
    location.hash = '#/dashboard';
  }

  function viewIntake() {
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '수주 취합'),
      h('button', { type: 'button', class: 'btn', onclick: intakeSampleRun }, '예시 파일로 해 보기')));
    main.appendChild(h('div', { class: 'alert info' },
      '고객사 포털에서 내려받은 납품예정·누적결품·직송 파일, 밥캣 xls, 고객사 발주서(엑셀·PDF), 선적계획·창고별재고현황 파일을 한꺼번에 넣으면 파일 이름으로 종류를 알아보고 규칙대로 하나의 수주 표를 만듭니다. ',
      '판별하지 못한 파일·칸은 빠뜨리지 않고 「★확인 필요」에 남깁니다. 파일은 이 브라우저 안에서만 읽습니다.'));

    // 1. 파일 넣기
    var input = h('input', { type: 'file', multiple: true, accept: '.xlsx,.xls,.csv,.pdf', 'aria-label': '수주 파일 여러 개' });
    input.addEventListener('change', function () { addIntakeFiles(Array.prototype.slice.call(input.files)); });
    var drop = h('label', { class: 'drop' }, h('strong', null, '파일을 여기에 끌어다 놓거나 눌러서 고르세요'),
      h('span', { class: 'note' }, '여러 개를 한꺼번에 · xlsx·xls·csv·pdf · 같은 파일이 두 번 들어오면 한 번만 반영'), input);
    ['dragover', 'dragenter'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); addIntakeFiles(Array.prototype.slice.call(e.dataTransfer.files || [])); });
    main.appendChild(h('div', { class: 'card' }, h('h2', null, '1. 파일 넣기'), drop,
      h('details', { style: 'margin-top:12px' }, h('summary', null, '파일 이름으로 알아보는 규칙'),
        h('ul', { class: 'note' },
          h('li', null, '「납품예정」「누적결품」「직송」 + 「건기」「엔진」「AM」「CKD」 + 「인천」「군산」「안산」 — 고객사 포털 파일'),
          h('li', null, '「밥캣」 + 「누적결품」「납품예정 … 일반」「직송」 — 밥캣 xls'),
          h('li', null, '「선적계획」 → 선적예정 입력으로, 「재고」 → 재고현황 입력으로'),
          h('li', null, '그 밖의 파일은 머리행으로 발주서 양식(목록형 A·B·C, 서식형 D)을 알아보고, 고객사 이름은 파일 이름을 씁니다. PDF 는 글자를 꺼내 읽습니다'),
          h('li', null, '어느 것에도 맞지 않으면 「★확인 필요」로 갑니다')))));

    // 2. 규칙 설정
    var o = st.intakeOpts;
    function setOpt(k, v) {
      st.intakeOpts = I.mergeOptions(Object.assign({}, st.intakeOpts, (function () { var x = {}; x[k] = v; return x; })()));
      if (intakeFiles) { runIntake(st.intake && st.intake.sample); toast('규칙을 바꿔 다시 취합했습니다'); }
      else { save(); if (st.intake) toast('저장했습니다. 이미 만든 표에 반영하려면 파일을 다시 넣어 주세요'); }
      render();
    }
    function sel(k, opts, label, help) {
      var s = h('select', { name: k, onchange: function () { setOpt(k, s.value === 'true' ? true : s.value === 'false' ? false : s.value); } },
        opts.map(function (x) { return h('option', { value: String(x[0]) }, x[1]); }));
      s.value = String(o[k]);
      return h('label', { class: 'field' }, h('span', null, label), s, help ? h('small', null, help) : null);
    }
    function numIn(k, label, help) {
      var i = h('input', { type: 'number', min: '0', max: '30', step: '1', name: k, value: String(o[k]), onchange: function () { setOpt(k, i.value); } });
      return h('label', { class: 'field' }, h('span', null, label), i, help ? h('small', null, help) : null);
    }
    function textIn(k, label, help, type) {
      var i = h('input', { type: type || 'text', name: k, value: o[k] || '', onchange: function () { setOpt(k, i.value); } });
      return h('label', { class: 'field' }, h('span', null, label), i, help ? h('small', null, help) : null);
    }
    main.appendChild(h('div', { class: 'card' }, h('h2', null, '2. 규칙 설정'),
      h('p', { class: 'note' }, '요청에 적힌 규칙과 2026-09-30 답변으로 확정된 규칙이 기본값입니다. 아직 답을 받지 못한 것만 「가정」으로 두었습니다. 바꾸면 넣은 파일로 바로 다시 취합합니다.'),
      h('div', { class: 'form-grid' },
        textIn('base', '기준일(오늘)', '비우면 파일 이름의 날짜(' + ((st.intake && st.intake.fileBase) || '없으면 오늘') + '). 밥캣 원납기 조임의 시작일입니다.', 'date'),
        numIn('engineShortOffset', '엔진 결품 → 납기 당김(일)', '요청 ②: 납기 = 결품일 − 2일'),
        sel('engineMode', [['override', '결품 우선 — 납품예정 행을 뺌'], ['sum', '둘 다 넣기(합산)']], '엔진 결품·납품예정에 같은 품번', '같은 공장·같은 품번 기준. 2026-09-30 확정: 누적결품 기준(납품예정 미반영)'),
        sel('collectDirect', [[true, '납품예정처럼 넣음'], [false, '넣지 않음']], '직송 파일', '인천건기·인천엔진 직송, 밥캣 직송. 2026-09-30 확정: AM·CKD 와 같이 납품예정과 동일하게 넣음'),
        numIn('bobcatShortOffset', '밥캣 결품 → 납기 당김(일)', '2026-09-30 확정: 결품일 − 2일'),
        sel('shortMode', [['increment', '날짜별로 늘어난 만큼 한 줄씩'], ['single', '가장 큰 결품을 첫 결품일 한 줄로']], '누적결품 → 수주 줄 만들기', '누적값이라 날짜별 증가분이 그날의 결품입니다'),
        sel('monthBuckets', [[true, '넣음(그 달 첫날로)'], [false, '넣지 않음(일별 칸만)']], '누적결품의 월 단위 칸(11·12·01월…)'),
        sel('poAllSheets', [[false, '최근 시트만(발주일자가 가장 늦은 시트)'], [true, '모든 시트']], '발주서 파일에 시트가 여럿일 때', '2026-09-30 확정: 괄호 힌트 없는 발주서는 최근 시트만'),
        sel('borrowPrice', [[true, '같은 품번의 다른 파일 단가로 채움'], [false, '채우지 않음(판매단가 없음)']], '단가 칸이 없는 줄(누적결품 등)의 판매단가(고객 발주, 참고)', '같은 고객사·같은 품번 단가가 한 가지일 때만 채웁니다. 매입단가(생산처 발주)와는 무관합니다'),
        textIn('portalCustomer', '포털 파일 고객사 이름', '건기·엔진·AM·CKD 파일에는 고객사 이름이 없어 여기 적은 이름을 씁니다'),
        textIn('bobcatCustomer', '밥캣 파일 고객사 이름'))));

    main.appendChild(mappingCard());

    var r = st.intake;
    if (!r) { main.appendChild(h('div', { class: 'card empty' }, h('p', null, '아직 취합한 파일이 없습니다.'), h('p', { class: 'note' }, '파일을 넣거나 「예시 파일로 해 보기」로 먼저 둘러보세요.'))); return; }
    var mi = mappedIntake(), allChecks = mi.checks.concat(r.checks);
    var unmappedChecks = mi.checks.filter(function (c) { return c.kind === 'unmapped'; });
    if (r.sample) main.appendChild(h('div', { class: 'alert warn' }, '예시(가상) 파일로 만든 결과입니다. 품번·수량·고객사는 실제 자료가 아닙니다.'));
    if (!intakeFiles) main.appendChild(h('div', { class: 'alert info' }, '이전에 만든 결과입니다(' + r.at.slice(0, 16).replace('T', ' ') + '). 규칙을 바꾸거나 재고·선적계획까지 넘기려면 파일을 다시 넣어 주세요.'));

    var sum = I.summary({ files: r.files, rows: r.rows, checks: allChecks });
    main.appendChild(h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'k' }, '넣은 파일'), h('div', { class: 'v' }, n(sum.files)), h('div', { class: 's' }, '기준일 ' + r.base)),
      h('div', { class: 'kpi' }, h('div', { class: 'k' }, '읽은 행'), h('div', { class: 'v' }, n(sum.read)), h('div', { class: 's' }, '규칙으로 뺀 행 ' + n(sum.excluded))),
      h('div', { class: 'kpi' }, h('div', { class: 'k' }, '통합 수주'), h('div', { class: 'v' }, n(sum.rows) + '행'), h('div', { class: 's' }, '수량 합계 ' + n(sum.qty))),
      h('div', { class: 'kpi' + (mi.stats.unmapped ? ' alert-kpi' : '') }, h('div', { class: 'k' }, '천일품번 매핑'),
        h('div', { class: 'v' }, mi.stats.loaded ? n(mi.stats.mapped + mi.stats.conflict) + '행' : '매핑표 없음'),
        h('div', { class: 's' }, mi.stats.loaded ? '매핑 없음 ' + n(mi.stats.unmappedItems) + '품번(' + n(mi.stats.unmapped) + '행) · 대상 아님 ' + n(mi.stats.none) + '행' : '위 3번에 매핑표를 넣어 주세요')),
      h('button', { type: 'button', class: 'kpi kpi-btn' + (mi.price.stats.buyNone ? ' alert-kpi' : ''), onclick: function () { var el = document.getElementById('intake-price'); if (el) el.scrollIntoView({ behavior: 'smooth' }); } },
        h('div', { class: 'k' }, '매입단가(생산처 발주)'), h('div', { class: 'v' }, n(mi.price.stats.buyHas) + '행'),
        h('div', { class: 's' }, (mi.price.stats.buyNone ? '매입단가 없음 ' + n(mi.price.stats.buyNone) + '행(' + n(mi.price.stats.buyNoneItems) + '품목)' : '모든 줄에 매입단가가 있습니다') + ' · 판매단가(참고) ' + n(mi.price.stats.saleHas) + '행')),
      h('button', { type: 'button', class: 'kpi kpi-btn' + (sum.checks ? ' alert-kpi' : ''), onclick: function () { var el = document.getElementById('intake-checks'); if (el) el.scrollIntoView({ behavior: 'smooth' }); } }, h('div', { class: 'k' }, '★확인 필요'), h('div', { class: 'v' }, n(sum.checks) + '건'), h('div', { class: 's' }, sum.checks ? '아래 목록을 확인해 주세요' : '없습니다'))));

    main.appendChild(h('div', { class: 'card' }, h('h2', null, '4. 결과 쓰기'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: sendIntakeToPlan, disabled: r.rows.length ? null : true }, '이 수주로 선적계획 계산'),
        h('button', { type: 'button', class: 'btn', onclick: function () {
          var sheets = I.exportSheets({ rows: mi.rows, files: r.files, checks: allChecks, stock: intakeSide.stock, shipments: intakeSide.shipments }, { margin: st.showMargin });
          sheets['매입단가없음'] = Pr.missingAoa(mi.price.missing);
          var cl = M.conflictList(partMap, st.intake.rows);
          if (cl.length) sheets['매핑충돌'] = M.conflictAoa(cl);
          sheets[Mo.SHEET] = Mo.aoa(Mo.summarize(mi.rows, st.monthlyOpts));
          writeXlsx(sheets, '수주취합_' + r.base + (r.sample ? '_예시데이터' : '') + '.xlsx');
        } }, '통합 수주 Excel 내려받기'),
        h('button', { type: 'button', class: 'btn', onclick: exportUpload, disabled: r.rows.length ? null : true }, '업로드 양식으로 내보내기'),
        h('a', { class: 'btn', href: '#/monthly' }, '월별 수주 vs 매입 보기')),
      h('p', { class: 'note', style: 'margin-top:8px' }, '「이 수주로 선적계획 계산」은 통합 수주를 ' + (mi.stats.loaded ? '천일품번으로 바꿔 ' : '') + '입력 ① 수주현황으로, 선적계획 파일(' + (r.shipCount || 0) + '행)은 입력 ③ 선적예정으로, 창고별재고현황(' + (r.stockCount || 0) + '행)은 입력 ② 재고현황으로 넘기고 기준일을 맞춘 뒤 대시보드로 갑니다. 넣지 않은 자료는 지금 들어 있는 것을 그대로 둡니다.'),
      h('p', { class: 'note' }, 'Excel 시트: 통합수주(판매단가(고객 발주) · 매입단가(생산처 발주) · 생산처' + (st.showMargin ? ' · 판매−매입' : '') + ' 포함) · 파일별집계 · ★확인필요 · 수주현황(이 도구 표준 열) · 매입단가없음 · ' + Mo.SHEET + (M.has(partMap) && M.conflictList(partMap).length ? ' · 매핑충돌' : '') + (intakeSide.stock ? ' · 재고현황' : '') + (intakeSide.shipments ? ' · 선적예정' : '') + '. 「업로드 양식으로 내보내기」는 아래 5번 설정대로 시트「' + uploadTemplate().sheet + '」 ' + uploadTemplate().headers.length + '열을 씁니다.')));

    // ★확인 필요 — 매핑 없음
    if (mi.stats.loaded) main.appendChild(h('div', { class: 'card', id: 'intake-unmapped' }, h('h2', null, '★확인 필요 — 매핑 없음 ' + unmappedChecks.length + '건'),
      h('p', { class: 'note' }, '매핑표에 없는 고객사 품번입니다(' + n(mi.stats.unmapped) + '행). ' + (st.mapOpts.unmapped === 'drop' ? '설정대로 선적계획에서 뺐습니다.' : '고객사 품번 그대로 선적계획을 계산했습니다.') + ' 업로드 양식에서는 ' + (st.uploadOpts.unmapped === 'keep' ? '고객사 품번 그대로 내보냅니다.' : '빼고 내보냅니다.') + ' 매핑표에 추가한 뒤 다시 넣어 주세요.'),
      unmappedChecks.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, ['묶음', '고객사 품번', '자세히', '원본파일'].map(function (x) { return h('th', null, x); }))),
        h('tbody', null, unmappedChecks.map(function (c) { return h('tr', null, h('td', null, M.GROUPS[c.group].label), h('td', { class: 'nowrap' }, h('strong', null, c.item)), h('td', null, c.detail), h('td', null, c.file)); }))))
        : h('p', { class: 'note' }, '매핑표에 없는 품번이 없습니다.')));

    main.appendChild(priceCard(mi));

    // 파일별 집계
    var pbs = mi.price.stats.bySource;
    main.appendChild(h('div', { class: 'card' }, h('h2', null, '파일별 결과 ' + r.files.length + '개'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, ['원본파일', '판별', '고객사 · 공장 · 구분', '읽은 행', '수집', '판매단가 있음 / 없음', '규칙으로 뺀 행(사유)', '메모'].map(function (x, i) { return h('th', { class: i >= 3 && i <= 5 ? 'num' : null }, x); }))),
        h('tbody', null, r.files.map(function (f) {
          return h('tr', null, h('td', null, f.file), h('td', null, f.typeLabel), h('td', null, [f.customer, f.plant, f.group].filter(Boolean).join(' · ')),
            h('td', { class: 'num' }, n(f.read)), h('td', { class: 'num' }, n(f.collected)),
            h('td', { class: 'num nowrap' }, pbs[f.file] ? n(pbs[f.file].sale) + ' / ' + n(pbs[f.file].saleNone) : '-'),
            h('td', null, Object.keys(f.excluded).map(function (k) { return h('span', { class: 'tag' }, k + ' ' + f.excluded[k]); })),
            h('td', { class: 'note' }, f.notes.join(' / ')));
        }))))));

    // ★확인 필요
    var otherChecks = allChecks.filter(function (c) { return c.kind !== 'unmapped'; });
    main.appendChild(h('div', { class: 'card', id: 'intake-checks' }, h('h2', null, '★확인 필요 ' + otherChecks.length + '건' + (unmappedChecks.length ? ' (매핑 없음 ' + unmappedChecks.length + '건은 위에)' : '')),
      otherChecks.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, ['원본파일', '행', '내용', '자세히'].map(function (x) { return h('th', null, x); }))),
        h('tbody', null, otherChecks.map(function (c) { return h('tr', null, h('td', null, c.file), h('td', { class: 'nowrap' }, String(c.row)), h('td', null, h('span', { class: 'tag warn' }, c.reason)), h('td', null, c.detail)); }))))
        : h('p', { class: 'note' }, '판별하지 못한 파일·칸이 없습니다.')));

    // 통합 수주 표
    var groups = [];
    mi.rows.forEach(function (x) { if (groups.indexOf(x.group) < 0) groups.push(x.group); });
    var gsel = h('select', { 'aria-label': '구분' }, h('option', { value: '' }, '전체 구분'), groups.map(function (g) { return h('option', { value: g }, g); }));
    gsel.value = intakeFilter.group;
    var q = h('input', { type: 'search', placeholder: '품목코드·고객사·파일 검색', value: intakeFilter.q, 'aria-label': '통합 수주 검색' });
    var holder = h('div');
    var LIMIT = 300;
    function draw() {
      intakeFilter.group = gsel.value; intakeFilter.q = q.value.trim().toLowerCase();
      var rows = mi.rows.filter(function (x) {
        return (!intakeFilter.group || x.group === intakeFilter.group) && (!intakeFilter.q || (x.item + ' ' + x.company + ' ' + x.customer + ' ' + x.source + ' ' + (x.name || '')).toLowerCase().indexOf(intakeFilter.q) >= 0);
      });
      holder.textContent = '';
      holder.appendChild(h('div', { class: 'list-meta' }, h('span', null, rows.length + '행 · 수량 ' + n(rows.reduce(function (s, x) { return s + x.qty; }, 0)) + ' · 매입금액(매입단가 있는 줄) ' + n(Math.round(rows.reduce(function (s, x) { return s + (x.buyAmount || 0); }, 0)))), rows.length > LIMIT ? h('span', { class: 'note' }, '화면에는 앞 ' + LIMIT + '행만 보입니다 — 전체는 Excel 로 내려받아 주세요') : null));
      if (!rows.length) { holder.appendChild(h('p', { class: 'empty' }, '조건에 맞는 행이 없습니다.')); return; }
      holder.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, ['고객사', '공장', '구분', '품목코드', '천일품번', '수량', '판매단가(고객 발주)', '매입단가(생산처 발주)', '생산처', '매입금액'].concat(st.showMargin ? ['판매−매입'] : [], ['납기일', '발주일', '원본파일 / 행', '비고']).map(function (x) { return h('th', { class: /수량|단가|금액|판매−매입/.test(x) ? 'num' : null }, x); }))),
        h('tbody', null, rows.slice(0, LIMIT).map(function (x) {
          return h('tr', null, h('td', null, x.customer), h('td', null, x.plant), h('td', null, x.group), h('td', { class: 'nowrap' }, x.item),
            h('td', { class: 'nowrap' }, h('strong', null, x.company), x.mapStatus === 'unmapped' || x.mapStatus === 'conflict' ? h('span', { class: 'tag warn' }, M.STATUS_LABEL[x.mapStatus]) : x.mapChosen ? h('span', { class: 'tag' }, '충돌에서 고름') : null),
            h('td', { class: 'num' }, n(x.qty)),
            h('td', { class: 'num nowrap note' }, x.price == null ? '' : [n(x.price), x.priceSrc && x.priceSrc !== '원본' ? h('span', { class: 'tag' }, x.priceSrc) : null]),
            h('td', { class: 'num nowrap' }, x.buyPrice == null ? h('span', { class: 'tag warn' }, '매입단가 없음') : [n(x.buyPrice), x.buySrc === '직접입력' ? h('span', { class: 'tag' }, '직접입력') : null]),
            h('td', null, x.maker || ''),
            h('td', { class: 'num' }, x.buyAmount == null ? '' : n(x.buyAmount)),
            st.showMargin ? h('td', { class: 'num nowrap' }, x.margin == null ? '' : x.margin < 0 ? h('span', { class: 'tag warn' }, n(x.margin)) : n(x.margin)) : null,
            h('td', { class: 'nowrap' }, L.fmtDate(x.due)), h('td', { class: 'nowrap' }, x.orderDate || ''),
            h('td', null, x.source + (x.sheet && x.sheet !== 'sheet1' && x.sheet !== 'Sheet1' ? ' · ' + x.sheet : '') + ' · ' + x.row), h('td', { class: 'note' }, [x.rule, x.note, x.priceNote].filter(Boolean).join(' · ')));
        })))));
    }
    gsel.addEventListener('change', draw); q.addEventListener('input', draw);
    main.appendChild(h('div', { class: 'card' }, h('h2', null, '통합 수주 표'),
      h('p', { class: 'note' }, '품목코드는 고객사 품번(파일 그대로), 천일품번은 매핑표로 바꾼 당사 품번입니다. 재고·선적계획은 천일품번으로 맞춥니다. 판매단가(고객 발주)는 고객 파일의 단가로 참고용이고, 매입단가(생산처 발주)는 매입단가표에서 찾은 값입니다. 납기일 순입니다.'),
      h('div', { class: 'form-grid' }, h('label', { class: 'field' }, h('span', null, '구분'), gsel), h('label', { class: 'field' }, h('span', null, '검색'), q)), holder));
    draw();
    main.appendChild(uploadCard(mi));
  }

  // 3. 품번 매핑표 카드
  function mappingCard() {
    var input = h('input', { type: 'file', accept: '.xlsm,.xlsx,.xls,.csv', 'aria-label': '품번 매핑표 파일' });
    input.addEventListener('change', function () { if (input.files[0]) readMappingFile(input.files[0]); });
    var body = [];
    if (M.has(partMap)) {
      body.push(h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, ['묶음', '파일 · 시트', '읽은 행', '고유 품번', '같은 줄 반복', '빈 칸', '두 품번이 같음', '매핑 충돌'].map(function (x, i) { return h('th', { class: i >= 2 ? 'num' : null }, x); }))),
        h('tbody', null, M.GROUP_KEYS.map(function (g) {
          var G = partMap.groups[g];
          if (!G) return h('tr', null, h('td', null, M.GROUPS[g].label), h('td', { colspan: '7', class: 'note' }, '없음 — 이 묶음 수주는 고객사 품번 그대로 계산하고 ★확인 필요에 남깁니다'));
          var x = G.stats;
          return h('tr', null, h('td', null, M.GROUPS[g].label), h('td', null, G.file + ' · ' + G.sheet), h('td', { class: 'num' }, n(x.rows)), h('td', { class: 'num' }, n(x.pairs)),
            h('td', { class: 'num' }, n(x.dupSame)), h('td', { class: 'num' }, n(x.blank)), h('td', { class: 'num' }, n(x.same)),
            h('td', { class: 'num' }, x.conflicts ? h('span', { class: 'tag warn' }, n(x.conflicts) + '건') : '0'));
        })))));
      // 매핑 충돌: 정확한 고객사 품번과 천일품번 후보(매핑표 행 번호)를 보여 주고, 쓸 값을 고르게 합니다(2026-09-30 질문 「어떤 품번인지」)
      var confl = M.conflictList(partMap, st.intake ? st.intake.rows : null);
      if (confl.length) body.push(h('div', { class: 'alert warn', style: 'margin-top:12px', id: 'map-conflicts' },
        h('strong', null, '매핑 충돌 ' + confl.length + '건 — 같은 고객사 품번이 서로 다른 천일품번으로 적혀 있습니다.'),
        h('p', { class: 'note' }, '고르지 않으면 매핑표 위쪽 행 값으로 계산합니다. 맞는 값을 고르면 그 값으로 계산하고 「매핑 충돌」 표시가 없어집니다(이 브라우저에 기억, 매핑표를 다시 넣어도 같은 충돌이면 유지). 매핑표 자체를 고치는 것이 가장 확실합니다 — 행 번호를 참고해 주세요.'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
          h('thead', null, h('tr', null, ['묶음', '고객사 품번', '천일품번 후보 (매핑표 시트 · 행)', '이번 수주', '쓸 천일품번'].map(function (x) { return h('th', null, x); }))),
          h('tbody', null, confl.slice(0, 100).map(function (c) {
            var s2 = h('select', { 'aria-label': c.item + ' 쓸 천일품번', onchange: function () { partMap = M.choose(partMap, c.group, c.item, s2.value); S.saveMapping(partMap); render(); toast(s2.value ? '「' + c.item + '」 → 「' + s2.value + '」로 계산합니다' : '위쪽 행 값으로 되돌렸습니다'); } },
              h('option', { value: '' }, '위쪽 행 값(' + c.values[0].value + ')'), c.values.map(function (v) { return h('option', { value: v.value }, v.value); }));
            s2.value = c.chosen || '';
            return h('tr', null, h('td', null, c.label), h('td', { class: 'nowrap' }, h('strong', null, c.item)),
              h('td', null, h('ul', { class: 'plain' }, c.values.map(function (v) { return h('li', null, h('strong', null, v.value), v.rows.length ? ' — ' + (v.sheet ? v.sheet + ' ' : '') + v.rows.join('·') + '행' : ''); }))),
              h('td', { class: 'nowrap' }, c.orders.rows ? n(c.orders.rows) + '행 · 수량 ' + n(c.orders.qty) : '없음'),
              h('td', null, s2));
          })))),
        confl.length > 100 ? h('p', { class: 'note' }, '외 ' + (confl.length - 100) + '건 — 전체는 「충돌 목록 내려받기」로') : null,
        h('div', { class: 'btn-row', style: 'margin-top:8px' }, h('button', { type: 'button', class: 'btn', onclick: function () {
          writeXlsx({ '매핑충돌': M.conflictAoa(M.conflictList(partMap, st.intake ? st.intake.rows : null)) }, '매핑충돌_' + L.todayIso() + '.xlsx');
        } }, '충돌 목록 내려받기(Excel)'))));
      (partMap.problems || []).forEach(function (p) { body.push(h('div', { class: 'alert info', style: 'margin-top:8px' }, p)); });
    }
    var um = h('select', { 'aria-label': '매핑 없는 품번', onchange: function () { st.mapOpts = { unmapped: um.value }; save(); render(); } },
      h('option', { value: 'keep' }, '고객사 품번 그대로 계산(★확인 필요에 남김)'), h('option', { value: 'drop' }, '선적계획에서 뺌(★확인 필요에 남김)'));
    um.value = st.mapOpts.unmapped;
    return h('div', { class: 'card' }, h('h2', null, '3. 품번 매핑표 (고객사 품번 → 천일품번)'),
      h('p', { class: 'note' }, '「건기엔진품목코드」「밥캣품목코드」 시트(열: 고객사 | 천일품번)가 든 매핑표 파일(xlsm·xlsx·csv)을 넣어 주세요. 매크로는 읽지 않고 표만 읽습니다. 매핑표는 이 브라우저에만 저장되고 어디로도 보내지 않습니다. 시트가 하나뿐인 파일(CSV 등)은 파일 이름의 「건기·엔진」「밥캣」으로, 또는 「구분」 열로 묶음을 알아봅니다. 한 묶음만 든 파일을 넣으면 그 묶음만 바뀝니다.'),
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', null, M.has(partMap) ? '매핑표 다시 넣기' : '매핑표 넣기'), input,
          M.has(partMap) ? null : h('button', { type: 'button', class: 'btn', style: 'margin-top:6px', onclick: function () {
            partMap = M.merge(null, M.parseBook(ISample.mappingBook(), '예시'), '예시 매핑표(가상 품번)', new Date().toISOString());
            S.saveMapping(partMap); render(); toast('예시 매핑표(가상 품번)를 넣었습니다 — 실제 매핑표를 넣으면 바뀝니다');
          } }, '예시 매핑표로 해 보기')),
        h('label', { class: 'field' }, h('span', null, '매핑 없는 고객사 품번'), um, h('small', null, '건기·엔진·AM·CKD 는 건기엔진 시트, 밥캣은 밥캣 시트로 찾습니다. 발주서(그 밖의 고객사)는 매핑표가 없어 품번 그대로 씁니다.'))),
      body,
      M.has(partMap) ? h('div', { class: 'btn-row', style: 'margin-top:12px' }, h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
        if (!window.confirm('이 브라우저에 저장된 품번 매핑표를 지웁니다. 계속할까요?')) return;
        S.clearMapping(); partMap = null; render(); toast('매핑표를 지웠습니다');
      } }, '매핑표 지우기')) : null);
  }

  // 매입단가 카드 (기획서 11.12): 매입단가(생산처 발주) = 매입단가표 → 직접입력, 판매단가(고객 발주)는 참고
  function priceCard(mi) {
    var ps = mi.price.stats, miss = mi.price.missing, LIM = 200;
    var input = h('input', { type: 'file', accept: '.xlsx,.xls,.xlsm,.csv', 'aria-label': '매입단가표 파일' });
    input.addEventListener('change', function () { if (input.files[0]) readPriceFile(input.files[0]); });
    function setManual(k, v) {
      var m = Object.assign({}, st.manualBuy), x = Pr.num(v);
      if (x && x > 0) m[k] = x; else delete m[k];
      st.manualBuy = m; save(); render();
    }
    var t = priceTable;
    var tableInfo = Pr.has(t)
      ? h('p', { class: 'note' }, '넣은 매입단가표: ' + (t.file || '') + ' — 품목 ' + n(t.stats.pairs) + '개' + (t.stats.makers ? ' · 생산처 ' + n(t.stats.makers) + '곳' : '') + (t.stats.blank ? ' · 빈 칸 ' + n(t.stats.blank) + '행' : '') + (t.stats.bad ? ' · 숫자가 아닌 단가 ' + n(t.stats.bad) + '행' : '') + (t.stats.conflicts ? ' · 같은 품목에 단가·생산처가 둘 이상 ' + n(t.stats.conflicts) + '건(위쪽 행 값)' : '') + (ps.manualShadowed ? ' · 직접 적은 값 중 ' + n(ps.manualShadowed) + '개는 이제 단가표 값을 씀' : ''))
      : h('p', { class: 'note' }, '매입단가표가 없습니다. 품목별 단가표 파일을 넣거나 아래 목록에 직접 적어 주세요.');
    var conflictBox = null;
    if (Pr.has(t) && t.stats.conflicts) {
      var ck = Object.keys(t.conflicts).sort();
      conflictBox = h('details', { style: 'margin-top:8px' }, h('summary', null, '매입단가표에서 같은 품목코드가 다른 값으로 적힌 ' + ck.length + '건'),
        h('ul', { class: 'note' }, ck.slice(0, 50).map(function (k) { return h('li', null, k + ' — ' + t.conflicts[k].map(function (x) { return n(x.price) + (x.maker ? '(' + x.maker + ')' : '') + ' ' + x.row + '행'; }).join(' / ')); })));
    }
    var mg = h('input', { type: 'checkbox', checked: !!st.showMargin, onchange: function () { st.showMargin = mg.checked; save(); render(); } });
    var saleText = Pr.SALE_ORDER.map(function (k) { return k + ' ' + n(ps.saleBySrc[k] || 0); }).join(' · ');
    return h('div', { class: 'card', id: 'intake-price' }, h('h2', null, '매입단가(생산처 발주) — 없음 ' + n(ps.buyNone) + '행 (' + n(ps.buyNoneItems) + '품목)'),
      h('p', { class: 'note' }, '매입단가는 당사가 생산처에 발주하는 단가로, 고객사 발주 단가와 무관합니다. 품목별 매입단가표(천일품번 → 매입단가, 생산처 선택)에서 찾고, 표에 없는 품목은 아래 목록에 직접 적습니다. 업로드 양식은 기존 17열 그대로라 매입단가·매입금액은 이 화면·통합 수주 Excel·「월별 수주 vs 매입」에서 봅니다. 매입단가표·직접 적은 값은 이 브라우저에만 저장합니다.'),
      h('p', null, h('strong', null, '매입단가: '), '단가표 ' + n(ps.buyBySrc['단가표'] || 0) + ' · 직접입력 ' + n(ps.buyBySrc['직접입력'] || 0) + ' · 없음 ' + n(ps.buyNone) + ' · 매입금액 합계 ' + n(Math.round(ps.buyAmount))),
      h('p', { class: 'note' }, h('strong', null, '판매단가(고객 발주, 참고): '), saleText + ' · 없음 ' + n(ps.saleNone) + ' · 판매금액 합계 ' + n(Math.round(ps.saleAmount)) + ' — 고객사 파일의 단가 칸 그대로입니다.'),
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', null, Pr.has(t) ? '매입단가표 다시 넣기' : '매입단가표 넣기'), input,
          h('small', null, '열: 품목코드(천일품번·당사품번·품번) | 매입단가(구매단가·발주단가·단가) | 생산처(선택). 「판매단가」 열은 읽지 않습니다. 천일품번으로 찾습니다(2026-09-30 확정). 매핑표에 없는 품번만 고객사 원품번으로 찾습니다.'),
          Pr.has(t) ? null : h('button', { type: 'button', class: 'btn', style: 'margin-top:6px', onclick: function () {
            priceTable = Object.assign(Pr.parseBook(ISample.priceBook()), { file: '예시 매입단가표(가상 품번·가상 단가)', at: new Date().toISOString() });
            S.savePriceTable(priceTable); render(); toast('예시 매입단가표를 넣었습니다 — 실제 단가표를 넣으면 바뀝니다');
          } }, '예시 매입단가표로 해 보기')),
        h('label', { class: 'check field' }, mg, h('span', null, '판매 − 매입 차이 보기'), h('small', null, '통합 수주 표와 Excel 에 「판매−매입」 열을 붙입니다(둘 다 있는 줄만).'))),
      tableInfo, conflictBox,
      st.showMargin ? h('p', { class: ps.negative ? 'alert warn' : 'note' }, '판매 − 매입: 두 단가가 모두 있는 ' + n(ps.both) + '행, 차이 금액 합계 ' + n(Math.round(ps.marginAmount)) + (ps.negative ? ' · 매입단가가 판매단가보다 높은 줄 ' + n(ps.negative) + '행(' + n(ps.negativeItems) + '품목) — 표에 빨간 표시' : '')) : null,
      Pr.has(t) ? h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
        if (!window.confirm('이 브라우저에 저장된 매입단가표를 지웁니다. 계속할까요?')) return;
        S.clearPriceTable(); priceTable = null; render(); toast('매입단가표를 지웠습니다');
      } }, '매입단가표 지우기')) : null,
      miss.length ? h('div', { class: 'table-wrap', style: 'margin-top:12px' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, ['품목코드', '고객사 품번', '고객사 · 구분', '행 수', '수량', '매입단가 직접입력'].map(function (x, i) { return h('th', { class: i === 3 || i === 4 ? 'num' : null }, x); }))),
        h('tbody', null, miss.slice(0, LIM).map(function (m) {
          var inp = h('input', { type: 'text', inputmode: 'decimal', value: st.manualBuy[m.key] == null ? '' : String(st.manualBuy[m.key]), 'aria-label': m.item + ' 매입단가', style: 'max-width:120px', onchange: function () { setManual(m.key, inp.value); } });
          return h('tr', null, h('td', { class: 'nowrap' }, h('strong', null, m.item)), h('td', { class: 'nowrap' }, m.customerItem !== m.item ? m.customerItem : ''),
            h('td', null, m.customers.join(', ') + (m.group ? ' · ' + m.group : '')), h('td', { class: 'num' }, n(m.rows)), h('td', { class: 'num' }, n(m.qty)), h('td', null, inp));
        }))))
        : h('p', { class: 'note' }, '모든 줄에 매입단가가 있습니다.'),
      miss.length > LIM ? h('p', { class: 'note' }, '화면에는 수량이 큰 ' + LIM + '품목만 보입니다 — 전체는 Excel 의 「매입단가없음」 시트로 확인해 주세요') : null,
      h('div', { class: 'btn-row', style: 'margin-top:8px' },
        miss.length ? h('button', { type: 'button', class: 'btn', onclick: function () { writeXlsx({ '매입단가표': Pr.templateAoa(miss) }, '매입단가표_채우기_' + L.todayIso() + '.xlsx'); } }, '매입단가 없는 품목을 단가표 양식으로 내려받기') : null,
        ps.manualCount ? h('button', { type: 'button', class: 'btn', onclick: function () {
          if (!window.confirm('직접 적은 매입단가 ' + ps.manualCount + '개를 지웁니다. 계속할까요?')) return;
          st.manualBuy = {}; save(); render();
        } }, '직접 적은 매입단가 지우기(' + ps.manualCount + '개)') : null));
  }

  // 품번별 납품처표 파일 읽기(품목코드 | 납품처 코드 | 납품처명 | 담당자) — 빈 칸은 기존 값을 지우지 않습니다
  function readPartyFile(file) {
    readFile(file, function (err, book) {
      if (err) { toast('납품처표를 읽지 못했습니다: ' + (err.message || err), true); return; }
      var p = U.parseItemParties(book);
      if (!p.stats.set) { toast(p.problems[0] || '납품처 값이 적힌 행이 없습니다', true); return; }
      st.uploadOpts = U.mergeOptions(Object.assign({}, st.uploadOpts, { itemParties: U.mergeItemParties(st.uploadOpts.itemParties, p.map) }));
      save(); render(); toast('납품처표를 읽었습니다 — 품번 ' + n(p.stats.set) + '개' + (p.stats.blank ? ' · 값이 빈 ' + p.stats.blank + '행은 건너뜀' : ''));
    });
  }
  var partyFilter = { onlyEmpty: false, q: '' };

  // 5. ERP 업로드 양식 카드
  function uploadCard(mi) {
    var o = st.uploadOpts, tpl = uploadTemplate();
    function setUp(k, v) { var x = {}; x[k] = v; st.uploadOpts = U.mergeOptions(Object.assign({}, st.uploadOpts, x)); save(); render(); }
    function sel(k, opts, label, help) {
      var s = h('select', { name: 'up-' + k, onchange: function () { setUp(k, s.value); } }, opts.map(function (x) { return h('option', { value: x[0] }, x[1]); }));
      s.value = o[k];
      return h('label', { class: 'field' }, h('span', null, label), s, help ? h('small', null, help) : null);
    }
    var tin = h('input', { type: 'file', accept: '.xlsx,.xls,.xlsm,.csv', 'aria-label': '업로드 양식 파일' });
    tin.addEventListener('change', function () { if (tin.files[0]) readTemplateFile(tin.files[0]); });
    var mgr = h('input', { type: 'text', value: o.manager, onchange: function () { setUp('manager', mgr.value); } });

    // 품번별 납품처 (확정: 납품처 코드·납품처명·담당자는 수기입력, 품번별로 다름 — 한 번 적으면 이 브라우저에 기억)
    var expRows = mi.rows.filter(function (r) { return !(r.mapStatus === 'unmapped' && o.unmapped === 'skip'); });
    var items = U.itemList(expRows), ip = o.itemParties;
    function filled(e) { var p = ip[e.key] || ip[U.key(e.customerItem)] || {}; return !!(p.code || p.name || p.manager); }
    var emptyCount = items.filter(function (e) { return !filled(e); }).length;
    function setItemParty(k, f, v) {
      var add = {}; add[k] = {}; add[k][f] = v.trim();
      st.uploadOpts = U.mergeOptions(Object.assign({}, st.uploadOpts, { itemParties: U.mergeItemParties(st.uploadOpts.itemParties, add) }));
      save();   // 입력 중 화면을 다시 그리지 않습니다(다음 칸으로 바로 넘어가게) — 미리보기 수는 다른 설정을 바꿀 때 갱신
    }
    var pin = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', 'aria-label': '품번별 납품처표 파일' });
    pin.addEventListener('change', function () { if (pin.files[0]) readPartyFile(pin.files[0]); });
    var only = h('input', { type: 'checkbox', checked: partyFilter.onlyEmpty });
    var pq = h('input', { type: 'search', placeholder: '품목코드·고객사 검색', value: partyFilter.q, 'aria-label': '품번별 납품처 검색' });
    var partyHolder = h('div');
    var PLIM = 300;
    function drawParties() {
      partyFilter.onlyEmpty = only.checked; partyFilter.q = pq.value.trim().toLowerCase();
      var list = items.filter(function (e) {
        return (!partyFilter.onlyEmpty || !filled(e)) && (!partyFilter.q || (e.code + ' ' + e.customerItem + ' ' + e.customers.join(' ') + ' ' + e.groups.join(' ')).toLowerCase().indexOf(partyFilter.q) >= 0);
      });
      partyHolder.textContent = '';
      if (!list.length) { partyHolder.appendChild(h('p', { class: 'note' }, partyFilter.onlyEmpty ? '납품처가 빈 품번이 없습니다.' : '조건에 맞는 품번이 없습니다.')); return; }
      partyHolder.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, ['품목코드', '고객사 · 구분', '행 · 수량', '납품처 코드', '납품처명', '담당자', ''].map(function (x) { return h('th', null, x); }))),
        h('tbody', null, list.slice(0, PLIM).map(function (e, i) {
          var p = ip[e.key] || ip[U.key(e.customerItem)] || {};
          var inputs = {};
          function cell(f, label) {
            var inp = inputs[f] = h('input', { type: 'text', value: p[f] || '', 'aria-label': e.code + ' ' + label, style: 'max-width:150px', onchange: function () { setItemParty(e.key, f, inp.value); } });
            return h('td', null, inp);
          }
          var prev = i > 0 ? list[i - 1] : null;
          return h('tr', null, h('td', { class: 'nowrap' }, h('strong', null, e.code), e.customerItem !== e.code ? h('div', { class: 'note' }, '고객사 ' + e.customerItem) : null),
            h('td', null, e.customers.join(', ') + (e.groups.length ? ' · ' + e.groups.join(', ') : '')),
            h('td', { class: 'num nowrap' }, n(e.rows) + ' · ' + n(e.qty)),
            cell('code', '납품처 코드'), cell('name', '납품처명'), cell('manager', '담당자'),
            h('td', null, prev ? h('button', { type: 'button', class: 'btn btn-small', title: '바로 위 품번의 납품처 코드·납품처명·담당자를 그대로 넣습니다', onclick: function () {
              var cur = st.uploadOpts.itemParties;   // 방금 적은 값까지(화면을 다시 그리지 않고 저장만 했으므로 ip 가 아니라 지금 값)
              var q = cur[prev.key] || cur[U.key(prev.customerItem)] || {};
              var add = {}; add[e.key] = { code: q.code || '', name: q.name || '', manager: q.manager || '' };
              st.uploadOpts = U.mergeOptions(Object.assign({}, st.uploadOpts, { itemParties: U.mergeItemParties(st.uploadOpts.itemParties, add) }));
              save(); render();
            } }, '위와 같게') : null));
        })))));
      if (list.length > PLIM) partyHolder.appendChild(h('p', { class: 'note' }, '화면에는 앞 ' + PLIM + '품번만 보입니다 — 검색으로 좁히거나 Excel 로 내려받아 채운 뒤 넣어 주세요'));
    }
    only.addEventListener('change', drawParties); pq.addEventListener('input', drawParties);
    drawParties();

    // 묶음 기본값(선택): 통합 수주의 고객사 · 공장 · 구분마다 한 줄 — 품번별 값이 없을 때만 씁니다
    var keys = U.partyKeys(mi.rows);
    var partyRows = keys.map(function (k) {
      var p = o.parties[k] || {};
      function cell(f, label) {
        var i = h('input', { type: 'text', value: p[f] || '', 'aria-label': k + ' ' + label, onchange: function () {
          var parties = Object.assign({}, st.uploadOpts.parties); parties[k] = Object.assign({}, parties[k] || {}); parties[k][f] = i.value.trim();
          setUp('parties', parties);
        } });
        return h('td', null, i);
      }
      return h('tr', null, h('td', null, k), cell('code', '납품처 코드'), cell('name', '납품처명'), cell('manager', '담당자'));
    });
    // 고정값 표: 자동으로 채우지 않는 열
    var fixedCols = tpl.headers.filter(function (x) { return x && !U.fieldOf(x); });
    var fixedRows = fixedCols.map(function (col) {
      var i = h('input', { type: 'text', value: o.fixed[col] == null ? '' : o.fixed[col], 'aria-label': col + ' 고정값', onchange: function () {
        var f = Object.assign({}, st.uploadOpts.fixed); if (i.value.trim()) f[col] = i.value.trim(); else delete f[col]; setUp('fixed', f);
      } });
      return h('tr', null, h('td', null, col, U.isBlankCol(col) ? h('span', { class: 'tag' }, '확정: 비움') : null), h('td', null, i));
    });
    var preview = U.build(mi.rows, tpl, o, { today: L.todayIso(), base: st.intake.base });
    var outH = preview.headers || tpl.headers;
    return h('div', { class: 'card', id: 'upload-template' }, h('h2', null, '5. ERP 업로드 양식'),
      h('p', { class: 'note' }, '「업로드 양식으로 내보내기」는 양식의 열 순서 그대로 시트「' + tpl.sheet + '」를 씁니다. ' + (st.uploadTpl ? '넣은 양식: ' + st.uploadTpl.fileName + '.' : '지금은 내장 기본 양식(웹자료올리기 17열 머리행)입니다. 회사 양식 파일을 넣으면 그 열 순서를 따릅니다.')),
      h('div', { class: 'alert info' }, '2026-09-30 확정: 일자 = 등록일자(오늘, 20260930 모양) · 순번 = 1, 2, 3 차례로 · 품목코드(상단) = 품목코드와 같은 값 · 매핑표에 없는 품번은 고객사 원품번 그대로 · 납품처 코드·납품처명·담당자는 품번별로 직접 적음(아래 표, 한 번 적으면 기억) · ',
        h('strong', null, '기존 17열 양식 그대로(단가 열 없음)'), ' — 매입단가·매입금액은 통합 수주 표·Excel 과 ', h('a', { href: '#/monthly' }, '월별 수주 vs 매입'), '에서 봅니다 · 작업지시No.·BOM버전·추가문자형식1·창고·적요·하위반제품수·규격은 비움.'),
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', null, '업로드 양식 파일(선택)'), tin, h('small', null, '머리행만 읽습니다. 시트「웹자료올리기」가 있으면 그 시트, 없으면 첫 시트.')),
        sel('dateMode', [['today', '오늘(등록일자)'], ['order', '발주일(없으면 오늘)'], ['base', '취합 기준일']], '「일자」 열', '확정: 등록일자 = 오늘'),
        sel('dateFormat', [['compact', '20260930'], ['dash', '2026-09-30']], '날짜 쓰는 모양', '확정: 20260930 (납기일자도 같은 모양)'),
        sel('seqMode', [['row', '행마다 1, 2, 3…'], ['party', '같은 일자·납품처는 같은 순번(한 전표)']], '「순번」 열', '확정: 1, 2, 3 순차'),
        sel('topItem', [['same', '품목코드(천일품번)와 같게'], ['blank', '비움']], '「품목코드(상단)」 열', '확정: 품목코드와 같은 값'),
        sel('nameMode', [['order', '수주 파일의 품명'], ['blank', '비움(ERP 가 품목코드로 채움)']], '「품목명」 열'),
        sel('unmapped', [['keep', '고객사 원품번 그대로 내보냄'], ['skip', '빼고 내보냄']], '매핑 없는 품번', '확정: 매핑표는 주기적으로 갱신 예정이라 고객사 원품번 그대로 등록'),
        sel('priceCol', [['none', '더하지 않음 — 기존 17열 양식 그대로'], ['add', '「수량」 뒤에 「단가」(매입단가) 열을 더함']], '양식에 단가 열이 없을 때', '확정: 기존 양식 그대로(단가 입력란 없음). 양식에 단가 열이 있는 회사 양식을 넣으면 그 열에 매입단가를 씁니다.'),
        h('label', { class: 'field' }, h('span', null, '기본 담당자(선택)'), mgr, h('small', null, '품번별 표·묶음 기본값에 담당자가 없을 때만 씁니다'))),
      h('h3', { style: 'margin-top:16px' }, '품번별 납품처 (품목코드 → 납품처 코드 · 납품처명 · 담당자) — 빈 품번 ' + n(emptyCount) + ' / ' + n(items.length)),
      h('p', { class: 'note' }, '품번마다 납품처가 달라 직접 적습니다. 한 번 적으면 이 브라우저에 기억해 다음 취합에 그대로 채웁니다(천일품번으로 기억하고, 매핑 전 고객사 품번으로 적은 값도 찾습니다). 많을 때는 Excel 로 내려받아 채운 뒤 다시 넣어 주세요 — 빈 칸은 기존 값을 지우지 않습니다.'),
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', null, '품번별 납품처표 넣기(Excel·CSV)'), pin, h('small', null, '열: 품목코드 | 납품처 코드 | 납품처명 | 담당자')),
        h('label', { class: 'field' }, h('span', null, '검색'), pq),
        h('label', { class: 'check field' }, only, h('span', null, '납품처가 빈 품번만 보기'))),
      h('div', { class: 'btn-row', style: 'margin:8px 0' },
        h('button', { type: 'button', class: 'btn', onclick: function () { writeXlsx({ '품번별납품처': U.itemPartiesAoa(items, st.uploadOpts.itemParties) }, '품번별납품처_' + L.todayIso() + '.xlsx'); } }, '품번별 납품처표 내려받기(Excel)'),
        Object.keys(ip).length ? h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
          if (!window.confirm('기억해 둔 품번별 납품처 ' + Object.keys(ip).length + '개를 지웁니다. 계속할까요?')) return;
          setUp('itemParties', {});
        } }, '기억한 납품처 지우기(' + Object.keys(ip).length + '개)') : null),
      partyHolder,
      h('details', { style: 'margin-top:12px' }, h('summary', null, '묶음 기본값(선택) — 고객사 · 공장 · 구분마다, 품번별 값이 없을 때만'),
        keys.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' }, h('thead', null, h('tr', null, ['통합 수주의 고객사 · 공장 · 구분', '납품처 코드', '납품처명', '담당자'].map(function (x) { return h('th', null, x); }))), h('tbody', null, partyRows)))
          : h('p', { class: 'note' }, '통합 수주가 없습니다.')),
      h('h3', { style: 'margin-top:16px' }, '고정값 (자동으로 채우지 않는 열 — 비우면 빈칸)'),
      h('p', { class: 'note' }, '2026-09-30 확정: 아래 열은 모두 비워 올립니다. 값이 정해지면 그때 적어 주세요.'),
      fixedRows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' }, h('thead', null, h('tr', null, h('th', null, '열'), h('th', null, '모든 행에 넣을 값'))), h('tbody', null, fixedRows))) : null,
      h('details', { style: 'margin-top:12px' }, h('summary', null, '열마다 무엇으로 채우는지 (' + outH.length + '열' + (preview.added && preview.added.length ? ' — 양식 ' + tpl.headers.length + '열 + 더한 「' + preview.added.join('」「') + '」' : '') + ')'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'list' }, h('thead', null, h('tr', null, h('th', null, '순서'), h('th', null, '열'), h('th', null, '채우는 값'))),
          h('tbody', null, outH.map(function (col, i) { var f = U.fieldOf(col), added = (preview.added || []).indexOf(col) >= 0 && tpl.headers.indexOf(col) < 0; return h('tr', null, h('td', { class: 'num' }, String(i + 1)), h('td', null, col, added ? h('span', { class: 'tag' }, '더한 열') : null), h('td', { class: 'note' }, f ? U.FIELD_LABEL[f] : (o.fixed[col] ? '고정값 「' + o.fixed[col] + '」' : U.isBlankCol(col) ? '빈칸(확정)' : '빈칸'))); }))))),
      h('p', { class: 'note', style: 'margin-top:8px' }, '지금 설정으로 ' + n(preview.count) + '행' + (preview.skipped.unmapped ? ' (매핑 없는 ' + n(preview.skipped.unmapped) + '행 뺌)' : '') + (preview.noParty ? ' · 납품처 코드 없음 ' + n(preview.noParty) + '행' : '') + (preview.noPrice ? ' · 매입단가 없음 ' + n(preview.noPrice) + '행은 단가 빈칸' : '') + '. 모든 행이 빈 열: ' + (preview.blankCols.length ? preview.blankCols.join(', ') : '없음') + '.'),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: exportUpload, disabled: preview.count ? null : true }, '업로드 양식으로 내보내기'),
        st.uploadTpl ? h('button', { type: 'button', class: 'btn', onclick: function () { st.uploadTpl = null; save(); render(); toast('내장 기본 양식으로 되돌렸습니다'); } }, '내장 기본 양식으로') : null));
  }

  // ── 월별 수주 vs 매입 (기획서 11.13) ─────────────────────
  var monthlyPick = '';   // 아래 고객사·구분별 · 품목별 표에 보일 월('' = 전체 기간, '-' = 날짜 없는 줄)
  function viewMonthly() {
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '월별 수주 vs 매입')));
    main.appendChild(h('div', { class: 'alert info' },
      '고객사 발주(수주)금액과 당사 → 생산처 매입금액을 월별로 나란히 봅니다. 수주금액 = 수량 × 판매단가(고객사 발주 파일의 단가), 매입금액 = 수량 × 매입단가(매입단가표 · 직접입력). ',
      '한쪽 단가가 없는 줄은 그쪽 합계에 들어가지 않으므로 「단가 없음」 행 수를 함께 보여 줍니다. 차액·차익률은 두 단가가 모두 있는 줄끼리 계산합니다.'));
    var r = st.intake;
    if (!r || !r.rows.length) {
      main.appendChild(h('div', { class: 'card empty' }, h('p', null, '아직 취합한 수주가 없습니다.'),
        h('p', { class: 'note' }, h('a', { href: '#/intake' }, '수주 취합'), '에서 파일을 넣거나 「예시 파일로 해 보기」를 먼저 눌러 주세요. 매입단가는 수주 취합 화면의 매입단가표로 채웁니다.')));
      return;
    }
    var mi = mappedIntake(), o = Mo.options(st.monthlyOpts), S = Mo.summarize(mi.rows, o), T = S.total;
    if (r.sample) main.appendChild(h('div', { class: 'alert warn' }, '예시(가상) 파일로 만든 결과입니다. 금액은 실제 자료가 아닙니다.'));
    function setMo(k, v) { var x = Object.assign({}, st.monthlyOpts); x[k] = v; st.monthlyOpts = Mo.options(x); save(); render(); }
    var bySel = h('select', { 'aria-label': '월 기준', onchange: function () { monthlyPick = ''; setMo('by', bySel.value); } },
      h('option', { value: 'due' }, '납기월(납기일 기준)'), h('option', { value: 'order' }, '발주월(발주일 기준)'));
    bySel.value = o.by;
    var topIn = h('input', { type: 'number', min: '1', max: '500', step: '1', value: String(o.topN), 'aria-label': '품목 상위 개수', onchange: function () { setMo('topN', topIn.value); } });
    function pickOf(m) { return m.month || '-'; }
    if (monthlyPick && !S.months.some(function (m) { return pickOf(m) === monthlyPick; })) monthlyPick = '';
    var monSel = h('select', { 'aria-label': '아래 표의 월', onchange: function () { monthlyPick = monSel.value; render(); } },
      h('option', { value: '' }, '전체 기간'), S.months.map(function (m) { return h('option', { value: pickOf(m) }, m.label); }));
    monSel.value = monthlyPick;
    function won(v) { return v == null ? '-' : n(Math.round(v)); }
    function rate(v) { return v == null ? '-' : v.toFixed(1) + '%'; }
    function download() {
      var sheets = {}; sheets[Mo.SHEET] = Mo.aoa(S);
      writeXlsx(sheets, '월별수주vs매입_' + r.base + (r.sample ? '_예시데이터' : '') + '.xlsx');
    }
    main.appendChild(h('div', { class: 'card' },
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', null, '월 기준'), bySel, h('small', null, '기본은 납기월입니다. 날짜가 없는 줄은 「' + Mo.NO_DATE[o.by] + '」 한 칸에 모읍니다.')),
        h('label', { class: 'field' }, h('span', null, '품목별 표 — 상위 몇 품목'), topIn, h('small', null, '수주금액이 큰 순서입니다. 나머지는 「그 밖 N품목」 한 줄로 합칩니다.'))),
      h('div', { class: 'btn-row', style: 'margin-top:8px' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: download }, 'Excel 내려받기(시트 「' + Mo.SHEET + '」)'),
        h('a', { class: 'btn', href: '#/intake' }, '수주 취합으로 — 매입단가표 넣기'))));

    main.appendChild(h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('div', { class: 'k' }, '수주금액(고객 발주)'), h('div', { class: 'v' }, won(T.sale)), h('div', { class: 's' }, '판매단가 있는 ' + n(T.saleRows) + '행')),
      h('div', { class: 'kpi' }, h('div', { class: 'k' }, '매입금액(생산처 발주)'), h('div', { class: 'v' }, won(T.buy)), h('div', { class: 's' }, '매입단가 있는 ' + n(T.buyRows) + '행')),
      h('div', { class: 'kpi' + (T.diff != null && T.diff < 0 ? ' alert-kpi' : '') }, h('div', { class: 'k' }, '차액(둘 다 있는 줄)'), h('div', { class: 'v' }, won(T.diff)), h('div', { class: 's' }, '비교한 ' + n(T.bothRows) + '행 · 수주 ' + won(T.bothSale) + ' − 매입 ' + won(T.bothBuy))),
      h('div', { class: 'kpi' }, h('div', { class: 'k' }, '차익률'), h('div', { class: 'v' }, rate(T.rate)), h('div', { class: 's' }, '차액 ÷ 비교한 줄의 수주금액')),
      h('div', { class: 'kpi' + (T.saleNone ? ' alert-kpi' : '') }, h('div', { class: 'k' }, '수주단가 없음'), h('div', { class: 'v' }, n(T.saleNone) + '행'), h('div', { class: 's' }, '수량 ' + n(T.saleNoneQty) + ' — 수주금액에 빠짐')),
      h('div', { class: 'kpi' + (T.buyNone ? ' alert-kpi' : '') }, h('div', { class: 'k' }, '매입단가 없음'), h('div', { class: 'v' }, n(T.buyNone) + '행'), h('div', { class: 's' }, '수량 ' + n(T.buyNoneQty) + ' — 매입금액에 빠짐'))));
    if (T.buyNone === T.rows) main.appendChild(h('div', { class: 'alert warn' }, '매입단가가 한 줄도 없습니다. ', h('a', { href: '#/intake' }, '수주 취합'), ' 화면의 「매입단가표 넣기」로 품목별 매입단가표를 넣거나 직접 적어 주세요.'));

    var max = 0;
    S.months.forEach(function (m) { max = Math.max(max, m.sale, m.buy); });
    function bar(v, cls) { return h('span', { class: 'mbar ' + cls, style: 'width:' + (max ? Math.max(0, v) / max * 100 : 0) + '%' }); }
    function numRow(a) {
      return [h('td', { class: 'num' }, n(a.rows)), h('td', { class: 'num' }, n(a.qty)),
        h('td', { class: 'num nowrap' }, won(a.sale)), h('td', { class: 'num' }, a.saleNone ? h('span', { class: 'tag warn' }, n(a.saleNone)) : '0'),
        h('td', { class: 'num nowrap' }, won(a.buy)), h('td', { class: 'num' }, a.buyNone ? h('span', { class: 'tag warn' }, n(a.buyNone)) : '0'),
        h('td', { class: 'num' }, n(a.bothRows)),
        h('td', { class: 'num nowrap' }, a.diff != null && a.diff < 0 ? h('span', { class: 'tag warn' }, won(a.diff)) : won(a.diff)),
        h('td', { class: 'num nowrap' }, rate(a.rate))];
    }
    var HEAD = ['행 수', '수량', '수주금액', '수주단가 없음(행)', '매입금액', '매입단가 없음(행)', '비교한 행', '차액', '차익률'];
    main.appendChild(h('div', { class: 'card', id: 'monthly-table' }, h('h2', null, S.byLabel + '별 수주 vs 매입'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, [S.byLabel].concat(HEAD, ['수주 · 매입']).map(function (x, i) { return h('th', { class: i >= 1 && i <= 9 ? 'num' : null }, x); }))),
        h('tbody', null, S.months.map(function (m) {
          var go = function () { monthlyPick = pickOf(m); render(); var el = document.getElementById('monthly-detail'); if (el) el.scrollIntoView({ behavior: 'smooth' }); };
          return h('tr', { class: 'clickable', tabindex: '0', title: '이 달의 고객사·구분별 · 품목별 보기', onclick: go, onkeydown: function (e) { if (e.key === 'Enter') go(); } },
            [h('td', { class: 'nowrap' }, h('strong', null, m.label))].concat(numRow(m), [h('td', { class: 'mbars' }, bar(m.sale, 'sale'), bar(m.buy, 'buy'))]));
        }), h('tr', { class: 'total' }, [h('td', null, h('strong', null, '합계'))].concat(numRow(T), [h('td', null)]))))),
      h('div', { class: 'legend' }, h('span', null, h('i', { class: 'mbar-key sale' }), '수주금액'), h('span', null, h('i', { class: 'mbar-key buy' }), '매입금액')),
      h('p', { class: 'note' }, Mo.NOTE + ' 월 행을 누르면 아래 표가 그 달로 바뀝니다.')));

    var P = !monthlyPick ? T : S.months.filter(function (m) { return pickOf(m) === monthlyPick; })[0] || T;
    var label = !monthlyPick ? '전체 기간' : P.label;
    main.appendChild(h('div', { class: 'card', id: 'monthly-detail' }, h('h2', null, '고객사 · 구분별 — ' + label),
      h('div', { class: 'form-grid' }, h('label', { class: 'field' }, h('span', null, '보일 월'), monSel)),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, ['고객사', '구분'].concat(HEAD).map(function (x, i) { return h('th', { class: i >= 2 ? 'num' : null }, x); }))),
        h('tbody', null, P.groups.map(function (g) { return h('tr', null, [h('td', null, g.customer || '-'), h('td', null, g.group || '-')].concat(numRow(g))); }))))));
    main.appendChild(h('div', { class: 'card', id: 'monthly-items' }, h('h2', null, '품목별 — ' + label + ' · 수주금액 상위 ' + o.topN + '품목 (전체 ' + n(P.itemCount) + '품목)'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, ['품목코드(천일품번)', '품목명', '고객사'].concat(HEAD).map(function (x, i) { return h('th', { class: i >= 3 ? 'num' : null }, x); }))),
        h('tbody', null, P.items.map(function (it) {
          return h('tr', { class: it.rest ? 'total' : null }, [h('td', { class: 'nowrap' }, h('strong', null, it.item), it.customerItem && it.customerItem !== it.item ? h('div', { class: 'note' }, '고객사 ' + it.customerItem) : null),
            h('td', null, it.name || ''), h('td', null, it.customers.join(', '))].concat(numRow(it)));
        })))),
      h('p', { class: 'note' }, '품목은 천일품번(매핑 없으면 고객사 원품번)으로 묶습니다. 매입단가 없는 품목은 수주 취합 화면에서 단가표 양식으로 내려받아 채울 수 있습니다.')));
  }

  // ── 라우터 ──────────────────────────────────────────
  var ROUTES = [
    ['intake', '수주 취합', viewIntake], ['monthly', '월별 수주 vs 매입', viewMonthly], ['dashboard', '대시보드', viewDashboard], ['data', '자료 가져오기', viewData], ['settings', '설정', viewSettings],
    ['result', '과부족 현황', viewResult], ['daily', '일자별 예상재고', viewDaily], ['plan', '선적계획', viewPlan],
    ['ai', 'AI 분석', viewAi], ['share', '공유·내보내기', viewShare]
  ];
  function render() {
    var parts = (location.hash.replace(/^#\/?/, '') || (hasData() ? 'dashboard' : 'data')).split('/');
    var route = parts[0], arg = parts[1] ? decodeURIComponent(parts[1]) : '';
    var hit = ROUTES.filter(function (r) { return r[0] === route; })[0] || ROUTES[1];
    var nav = document.getElementById('nav');
    nav.textContent = '';
    ROUTES.forEach(function (r) { nav.appendChild(h('a', { href: '#/' + r[0], 'aria-current': r[0] === hit[0] ? 'page' : null }, r[1])); });
    document.getElementById('sampleBanner').hidden = !st._sample;
    main.textContent = '';
    try { hit[2](arg); }
    catch (err) { main.appendChild(h('div', { class: 'alert warn' }, '화면을 그리지 못했습니다: ' + (err && err.message || err))); if (window.console) console.error(err); }
    main.setAttribute('data-route', location.hash || '#/'); // 화면 전환 완료 표시(점검용)
  }
  window.addEventListener('hashchange', function () { render(); main.focus({ preventScroll: true }); window.scrollTo(0, 0); });
  render();
})();
