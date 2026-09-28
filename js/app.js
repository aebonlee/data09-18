/* 선적계획 자동화 — 화면
   흐름: 자료 가져오기(열 매핑) → 설정 → 과부족 현황 / 일자별 예상재고 → 선적계획 → AI 분석 → 공유·내보내기, 대시보드 */
(function () {
  'use strict';
  var L = window.SPLogic, S = window.SPStore, Sample = window.SPSample;
  var KEYS = ['orders', 'stock', 'shipments'];
  var st = S.load();
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
        } else wb = XLSX.read(buf, { type: 'array', cellDates: true });
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
        if (!window.confirm('불러온 자료·설정·선적계획 수정·AI 답을 모두 지웁니다. 계속할까요?')) return;
        S.clear(); st = S.empty(); save(); render(); toast('모두 지웠습니다');
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

  // ── 라우터 ──────────────────────────────────────────
  var ROUTES = [
    ['dashboard', '대시보드', viewDashboard], ['data', '자료 가져오기', viewData], ['settings', '설정', viewSettings],
    ['result', '과부족 현황', viewResult], ['daily', '일자별 예상재고', viewDaily], ['plan', '선적계획', viewPlan],
    ['ai', 'AI 분석', viewAi], ['share', '공유·내보내기', viewShare]
  ];
  function render() {
    var parts = (location.hash.replace(/^#\/?/, '') || (hasData() ? 'dashboard' : 'data')).split('/');
    var route = parts[0], arg = parts[1] ? decodeURIComponent(parts[1]) : '';
    var hit = ROUTES.filter(function (r) { return r[0] === route; })[0] || ROUTES[0];
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
