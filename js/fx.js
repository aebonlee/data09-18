/* 환율 — 순수 로직 (기획서 11.15, 2026-09-30 수강생 요청 「통화가 China(RMB) 경우 환율 적용」)
   요청 원문: 「통화가 China(RMB) 경우 환율적용을 그때그때 달라지는데 환율을 서울외국환중개소 전월평균으로 끌고와서
              원화단가 산출되는지도 확인부탁드립니다. 만약 원화단가 산출 불가시 China(RMB) 버튼추가하여 환율 직접입력가능한지」
   정한 규칙
     환율 = 서울외국환중개 「월평균 매매기준율」(외화 1단위당 원, 엔화는 100엔당 원).
     어느 달의 환율을 쓰나 = 그 줄의 납기월의 「전월」 평균(설정으로 「당월」). 예: 납기 2026-10-15 → 2026-09 월평균.
     환율을 찾는 순서 = 1. 직접 입력  2. 불러온 환율 기준 파일  3. 자동(data/rates.js — 서울외국환중개에서 매일 받아 둔 값).
     그 달 환율이 어디에도 없으면 짐작하지 않습니다 — 그 줄은 「환율 없음」으로 표시하고 금액 합계에서 뺍니다(행 수는 따로 셈).
     납기일이 없는 줄도 환율 월을 정할 수 없어 「환율 없음」입니다.
   반올림
     원화 단가 = 외화 단가 × (환율 ÷ 단위) → 소수 둘째 자리 반올림(0.005 는 올림).
       예: 12.5 위안 × 190.35 = 2,379.375 → 2,379.38 원.
     금액 = 수량 × 원화 단가(기존 규칙 그대로 소수 둘째 자리, 화면·합계 문장은 원 단위로 보임).
   China(RMB): 서울외국환중개는 CNY 를 2016-01-01 부터 고시하지 않고, 원·위안 직거래 시장의 「위안 (CNH)」 매매기준율을 냅니다.
               그래서 China(RMB) · RMB · CNY · CNH · 위안 은 모두 같은 통화(CNY 칸)로 읽고, 자동 값은 CNH 월평균을 씁니다.
   브라우저(window.SPFx)와 node(require) 양쪽에서 씁니다. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SPFx = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function str(v) { return v == null ? '' : String(v).trim(); }
  function norm(v) { return str(v).toLowerCase().replace(/[\s_()\-·.:：（）\[\]]/g, ''); }

  // 통화. unit = 서울외국환중개 고시 단위(엔화만 100엔당)
  var CUR = {
    KRW: { label: '원화(KRW)', unit: 1 },
    CNY: { label: 'China(RMB) 위안', unit: 1, smbs: 'CNH' },
    USD: { label: '미국 달러(USD)', unit: 1, smbs: 'USD' },
    JPY: { label: '일본 엔(JPY) 100엔당', unit: 100, smbs: 'JPY' },
    EUR: { label: '유로(EUR)', unit: 1, smbs: 'EUR' }
  };
  var FOREIGN = ['CNY', 'USD', 'JPY', 'EUR'];
  var ALIAS = { KRW: 'KRW', WON: 'KRW', CNY: 'CNY', CNH: 'CNY', RMB: 'CNY', USD: 'USD', JPY: 'JPY', EUR: 'EUR' };
  var SRC = { manual: '직접입력', file: '기준파일', auto: '자동(서울외국환중개)' };
  var SRC_ORDER = [SRC.manual, SRC.file, SRC.auto];
  var MODE = { prev: '전월 평균', same: '당월 평균' };

  /** 통화 글자 → 'KRW'·'CNY'·'USD'·'JPY'·'EUR', 빈칸 → '', 모르는 통화(HKD·¥ 처럼 헷갈리는 것 포함) → null */
  function normCurrency(v) {
    var s = str(v);
    if (!s) return '';
    var up = s.toUpperCase();
    var codes = up.match(/[A-Z]{3,4}/g) || [];
    for (var i = 0; i < codes.length; i++) {
      if (ALIAS[codes[i]]) return ALIAS[codes[i]];
    }
    if (/人民币|元|위안|중국|CHINA/.test(up)) return 'CNY';
    if (/円|엔|일본|JAPAN/.test(up)) return 'JPY';
    if (/€|유로|EURO/.test(up)) return 'EUR';
    if (/US\$|미국|미화|DOLLAR|달러/.test(up) && !/홍콩|호주|캐나다|싱가포르|대만|뉴질랜드/.test(s)) return 'USD';
    if (/^\$$/.test(up)) return 'USD';
    if (/^(원|원화|₩)$/.test(s)) return 'KRW';
    if (codes.some(function (c) { return c.length === 3; })) return null;   // HKD 같은 다른 ISO 코드
    return null;
  }
  function label(cur) { return CUR[cur] ? CUR[cur].label : cur; }
  function unitOf(cur) { return CUR[cur] ? CUR[cur].unit : 1; }

  /** 소수 둘째 자리 반올림 — 12.5 × 190.35 = 2379.3749999… 같은 부동소수 오차를 걷어내고 0.005 는 올립니다 */
  function round2(x) { var y = Number((x).toPrecision(12)); return Math.round(y * 100 + (y >= 0 ? 1e-9 : -1e-9)) / 100; }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ym(y, m) { return y >= 1990 && y <= 2100 && m >= 1 && m <= 12 ? y + '-' + pad(m) : ''; }
  /** 연월 읽기 → 'YYYY-MM' 또는 ''. 2026-08 · 2026.08 · 2026/8 · 2026년 8월 · 202608 · 2026-08-01 · 날짜 객체 · 엑셀 일련번호 · 숫자 2026.08 */
  function parseMonth(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) return isNaN(v) ? '' : ym(v.getFullYear(), v.getMonth() + 1);
    if (typeof v === 'number') {
      if (v >= 199001 && v <= 210012 && v === Math.floor(v)) return ym(Math.floor(v / 100), v % 100);
      if (v > 1990 && v < 2101 && v !== Math.floor(v)) { var y = Math.floor(v); return ym(y, Math.round((v - y) * 100)); } // 2026.08 · 2026.1(=10월, 엑셀이 끝 0 을 지움)
      if (v > 20000 && v < 80000) { var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); return ym(d.getUTCFullYear(), d.getUTCMonth() + 1); }
      return '';
    }
    var s = str(v), m;
    if ((m = s.match(/^(\d{4})\s*(?:[.\-/]|년)\s*(\d{1,2})(?!\d)/))) return ym(+m[1], +m[2]);
    if ((m = s.match(/^(\d{4})(\d{2})$/))) return ym(+m[1], +m[2]);
    if ((m = s.match(/^(\d{4})\.(\d)$/))) return ym(+m[1], +m[2] === 1 ? 10 : +m[2]);
    return '';
  }
  function addMonth(m, k) {
    if (!/^\d{4}-\d{2}$/.test(m)) return '';
    var y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1 + k;
    y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
    return y + '-' + pad(mo + 1);
  }
  /** 줄의 환율 월: 납기일 'YYYY-MM-DD' → 전월(prev, 기본) 또는 당월(same). 납기일이 없으면 '' */
  function rateMonth(due, mode) {
    var d = str(due);
    if (!/^\d{4}-\d{2}/.test(d)) return '';
    var m = d.slice(0, 7);
    return mode === 'same' ? m : addMonth(m, -1);
  }
  /** 금액 칸 읽기: 숫자 · 「1,234.5」 · 「12.5 RMB」 · 「CNY 12.5」 · 「¥12.5」 → {value, cur(''|코드|null)} 또는 null */
  function parseMoney(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? { value: v, cur: '' } : null;
    var s = str(v), m = s.match(/-?\d[\d,]*(?:\.\d+)?|-?\.\d+/);
    if (!m) return null;
    var num = Number(m[0].replace(/,/g, ''));
    if (!isFinite(num)) return null;
    var rest = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).trim();
    if (!rest) return { value: num, cur: '' };
    if (/^(원|₩)$/.test(rest)) return { value: num, cur: 'KRW' };
    return { value: num, cur: normCurrency(rest) };
  }
  function money(v) { var p = parseMoney(v); return p && p.cur === '' ? p.value : null; }

  // ── 환율 기준 파일 읽기 ─────────────────────────────────────────────
  // 두 모양을 읽습니다.
  //  세로(서울외국환중개 월평균 화면을 복사하거나 회사 양식): 연월 | 통화 | 환율 (| 단위 | 비고)
  //     서울외국환중개 화면: 날짜「2026.08」 | 통화명「위안 (CNH)」 | 월평균 매매기준율「208.69」 — 엔화는 통화명에 「(100)」
  //  가로: 연월 | CNY | USD | JPY(100) … (통화마다 한 열)
  var MONTH_COL = ['연월', '기준월', '적용월', '년월', '월', '날짜', '일자', '기간', '기준연월', 'month', 'date', 'yyyymm', 'period'];
  var CUR_COL = ['통화', '통화명', '통화코드', '화폐', 'currency', 'cur', 'ccy'];
  var RATE_COL = ['환율', '매매기준율', '월평균매매기준율', '월평균', '평균환율', '기준환율', '환율원', 'rate', 'exchangerate'];
  var UNIT_COL = ['단위', '고시단위', 'unit'];
  var NOTE_COL = ['비고', '출처', '비고(출처)', '출처(비고)', '메모', 'note', 'source'];
  function exact(hs, cands) { var n = cands.map(norm); for (var i = 0; i < hs.length; i++) if (n.indexOf(hs[i]) >= 0) return i; return -1; }
  function rateCol(hs, used) {
    var i = exact(hs, RATE_COL);
    if (i >= 0 && used.indexOf(i) < 0) return i;
    for (i = 0; i < hs.length; i++) if (used.indexOf(i) < 0 && /환율|매매기준율|기준율|rate/.test(hs[i])) return i;
    return -1;
  }
  function headerCurrency(raw) {   // 「CNY」「위안 (CNH)」「JPY(100)」「China(RMB) 환율」 → 통화 · 단위
    var c = normCurrency(raw);
    if (!c || c === 'KRW') return null;
    return { cur: c, unit: /\(\s*100\s*\)|100\s*엔/.test(str(raw)) ? 100 : unitOf(c) };
  }
  function findLayout(aoa, hint) {
    for (var r = 0; r < Math.min(aoa.length, 15); r++) {
      var raw = aoa[r] || [], hs = raw.map(norm);
      var mc = exact(hs, MONTH_COL);
      if (mc < 0) continue;
      var cc = exact(hs, CUR_COL), rc = rateCol(hs, [mc, cc]);
      if (rc >= 0 && (cc >= 0 || hint || headerCurrency(raw[rc]))) {
        return { type: 'long', hr: r, month: mc, cur: cc, rate: rc, unit: exact(hs, UNIT_COL), note: exact(hs, NOTE_COL), fixed: cc < 0 ? (headerCurrency(raw[rc]) || hint) : null };
      }
      var cols = [];
      raw.forEach(function (h, i) { if (i === mc) return; var x = headerCurrency(h); if (x) cols.push({ i: i, cur: x.cur, unit: x.unit, head: str(h) }); });
      if (cols.length) return { type: 'wide', hr: r, month: mc, cols: cols };
    }
    return null;
  }
  /* book = { names, sheets:{시트: aoa} }, fileName 은 통화 힌트(「CNY」「위안」)로만 씁니다.
     반환 { rates:{'CNY|2026-08': {cur, month, raw, unit, rate, note, sheet, row}}, stats:{rows, pairs, bad, dup, conflicts, currencies:[], first, last}, problems:[], sheets:[], layout } */
  function parseRateBook(book, fileName) {
    var out = { rates: {}, stats: { rows: 0, pairs: 0, bad: 0, dup: 0, conflicts: 0, currencies: [], first: '', last: '' }, problems: [], sheets: [], layout: '' };
    var names = (book && book.names) || [];
    function put(cur, month, raw, unit, note, sheet, row) {
      var k = cur + '|' + month, cur0 = out.rates[k];
      var e = { cur: cur, month: month, raw: raw, unit: unit, rate: raw / unit, note: note || '', sheet: sheet, row: row };
      if (!cur0) { out.rates[k] = e; out.stats.pairs++; return; }
      if (cur0.raw === raw && cur0.unit === unit) { out.stats.dup++; return; }
      out.stats.conflicts++;
      if (out.problems.length < 20) out.problems.push(cur + ' ' + month + ' 환율이 두 번 다르게 적혀 있습니다(' + cur0.raw + ' · ' + raw + ') — 위쪽 값 ' + cur0.raw + ' 을 씁니다');
    }
    // 양식 파일의 「안내」 시트는 읽지 않고, 「예시」 시트는 다른 시트에 값이 하나도 없을 때만 읽습니다(예시 값이 회사 기준에 섞이지 않게)
    var isEx = function (nm) { return /예시|sample|example/i.test(nm); };
    var main = names.filter(function (nm) { return !/^안내|^설명|^readme/i.test(nm) && !isEx(nm); });
    main.forEach(one);
    if (!out.stats.pairs) names.filter(isEx).forEach(function (nm) { one(nm); if (out.stats.pairs) out.fromExample = true; });
    function one(nm) {
      var aoa = (book.sheets[nm] || []);
      if (!aoa.some(function (r) { return (r || []).some(function (c) { return str(c) !== ''; }); })) return;
      var hint = headerCurrency(nm) || headerCurrency(fileName || '');
      var L = findLayout(aoa, hint);
      if (!L) { out.problems.push('시트「' + nm + '」: 「연월」과 「환율(매매기준율)」 머리, 또는 「연월 | CNY | USD …」 머리를 찾지 못해 건너뛰었습니다'); return; }
      out.sheets.push(nm); out.layout = out.layout && out.layout !== L.type ? '섞임' : L.type;
      for (var r = L.hr + 1; r < aoa.length; r++) {
        var ln = aoa[r] || [];
        if (!ln.some(function (c) { return str(c) !== ''; })) continue;
        var month = parseMonth(ln[L.month]);
        if (L.type === 'long') {
          out.stats.rows++;
          var cRaw = L.cur >= 0 ? ln[L.cur] : '', cur = L.cur >= 0 ? normCurrency(cRaw) : L.fixed.cur;
          var p = parseMoney(ln[L.rate]), unitCell = L.unit >= 0 ? Number(str(ln[L.unit]).replace(/[^\d.]/g, '')) : 0;
          var unit = unitCell > 0 ? unitCell : L.cur >= 0 ? (/\(\s*100\s*\)|100\s*엔/.test(str(cRaw)) ? 100 : unitOf(cur)) : L.fixed.unit;
          if (!month || !cur || cur === 'KRW' || !p || !(p.value > 0)) { out.stats.bad++; continue; }
          put(cur, month, p.value, unit, L.note >= 0 ? str(ln[L.note]) : '', nm, r + 1);
        } else {
          L.cols.forEach(function (c) {
            if (str(ln[c.i]) === '') return;
            out.stats.rows++;
            var q = parseMoney(ln[c.i]);
            if (!month || !q || !(q.value > 0)) { out.stats.bad++; return; }
            put(c.cur, month, q.value, c.unit, '', nm, r + 1);
          });
        }
      }
    }
    var keys = Object.keys(out.rates).sort(), curs = {};
    keys.forEach(function (k) { curs[out.rates[k].cur] = 1; });
    out.stats.currencies = FOREIGN.filter(function (c) { return curs[c]; });
    var months = keys.map(function (k) { return k.slice(4); }).sort();
    out.stats.first = months[0] || ''; out.stats.last = months[months.length - 1] || '';
    keys.forEach(function (k) {   // 엔화 단위 점검: 100엔당 값이 너무 작으면 1엔당 값을 적은 것일 수 있음
      var e = out.rates[k];
      if (e.cur === 'JPY' && e.unit === 100 && e.raw < 100 && out.problems.length < 20) out.problems.push('JPY ' + e.month + ' 환율 ' + e.raw + ' 은 100엔당 값으로 읽었습니다. 1엔당 값이면 「단위」 칸에 1 을 적어 주세요');
    });
    if (out.fromExample) out.problems.push('「예시」 시트 값을 읽었습니다 — 회사 기준 값은 「환율기준」 시트에 적어 주세요');
    if (!out.sheets.length && !out.problems.length) out.problems.push('환율 기준 파일에서 읽은 행이 없습니다');
    if (out.sheets.length && !out.stats.pairs) out.problems.push('머리는 찾았지만 읽을 수 있는 환율 값이 없습니다(연월·통화·숫자를 확인해 주세요)');
    return out;
  }
  /** 붙여넣은 글(엑셀·웹 표 복사 — 탭으로 나뉨, 또는 쉼표) → book */
  function textBook(text) {
    var lines = str(text).replace(/\r/g, '').split('\n');
    var tab = lines.some(function (l) { return l.indexOf('\t') >= 0; });
    var aoa = lines.map(function (l) { return tab ? l.split('\t').map(str) : splitCsv(l); });
    return { names: ['붙여넣기'], sheets: { '붙여넣기': aoa } };
  }
  function splitCsv(l) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < l.length; i++) {
      var ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  // ── 자동 값(data/rates.js · rates.json) ───────────────────────────────
  /** {currencies:{CNY:{unit, months:{'2026-08': 208.69}}}} → rates 표 */
  function fromAuto(json) {
    var out = {};
    if (!json || !json.currencies) return out;
    Object.keys(json.currencies).forEach(function (c) {
      var x = json.currencies[c], cur = normCurrency(c);
      if (!cur || cur === 'KRW' || !x || !x.months) return;
      var unit = Number(x.unit) > 0 ? Number(x.unit) : unitOf(cur);
      Object.keys(x.months).forEach(function (m) {
        var raw = Number(x.months[m]);
        if (/^\d{4}-\d{2}$/.test(m) && raw > 0) out[cur + '|' + m] = { cur: cur, month: m, raw: raw, unit: unit, rate: raw / unit, note: x.label || '' };
      });
    });
    return out;
  }
  /** 직접 입력 {'CNY|2026-09': 205.1} → rates 표(단위는 통화 기본 — 엔화는 100엔당) */
  function fromManual(manual) {
    var out = {};
    Object.keys(manual || {}).forEach(function (k) {
      var p = k.split('|'), cur = p[0], m = p[1], raw = Number(manual[k]);
      if (FOREIGN.indexOf(cur) >= 0 && /^\d{4}-\d{2}$/.test(m || '') && raw > 0) out[k] = { cur: cur, month: m, raw: raw, unit: unitOf(cur), rate: raw / unitOf(cur), note: '' };
    });
    return out;
  }
  /** 세 출처를 합쳐 찾는 함수. src = {manual:{…}, file:{rates, file}, auto:{rates, fetchedAt}} (없으면 빈 것) */
  function resolver(src) {
    src = src || {};
    var layers = [
      { name: SRC.manual, rates: fromManual(src.manual) },
      { name: SRC.file, rates: (src.file && src.file.rates) || {}, file: src.file && src.file.file },
      { name: SRC.auto, rates: (src.auto && src.auto.rates) || {} }
    ];
    function find(cur, month) {
      var k = cur + '|' + month;
      for (var i = 0; i < layers.length; i++) {
        var e = layers[i].rates[k];
        if (e) return { cur: cur, month: month, raw: e.raw, unit: e.unit, rate: e.rate, src: layers[i].name, file: layers[i].file || '', note: e.note || '' };
      }
      return null;
    }
    /** 모든 출처의 값을 한 표로(통화·월 순) — 화면·Excel 「적용 환율」용. 같은 칸에 여러 출처가 있으면 쓰는 값과 가려진 값 */
    function table() {
      var keys = {};
      layers.forEach(function (l) { Object.keys(l.rates).forEach(function (k) { keys[k] = 1; }); });
      return Object.keys(keys).sort(function (a, b) {
        var ca = FOREIGN.indexOf(a.split('|')[0]), cb = FOREIGN.indexOf(b.split('|')[0]);
        return ca - cb || (a < b ? 1 : a > b ? -1 : 0);   // 통화 순, 최근 달이 위
      }).map(function (k) {
        var p = k.split('|'), used = find(p[0], p[1]), all = {};
        layers.forEach(function (l) { if (l.rates[k]) all[l.name] = l.rates[k].raw; });
        return Object.assign(used, { all: all });
      });
    }
    return { find: find, table: table, layers: layers };
  }
  /* 외화 단가 → 원화. 반환 {krw, raw, unit, rate, month, src, file, cur, orig} 또는 {missing:true, reason, cur, month, orig} */
  function convert(price, cur, due, R, mode) {
    if (cur === null) return { missing: true, reason: '통화를 알 수 없음', cur: '?', month: '', orig: price };
    var month = rateMonth(due, mode);
    if (!month) return { missing: true, reason: '납기일 없음(환율 월을 정할 수 없음)', cur: cur, month: '', orig: price };
    var e = R && R.find(cur, month);
    if (!e) return { missing: true, reason: cur + ' ' + month + ' 환율 없음', cur: cur, month: month, orig: price };
    return { krw: round2(price * e.raw / e.unit), raw: e.raw, unit: e.unit, rate: e.rate, month: month, src: e.src, file: e.file, cur: cur, orig: price };
  }
  /** 한 줄 설명 「CNY 12.5 × 208.69(2026-08 전월 평균 · 자동(서울외국환중개))」 */
  function describe(fx) {
    if (!fx) return '';
    if (fx.missing) return '환율 없음 — ' + fx.reason;
    return fx.cur + ' ' + fx.orig + ' × ' + fx.raw + (fx.unit !== 1 ? '/' + fx.unit : '') + ' (' + fx.month + ' · ' + fx.src + ')';
  }

  /** Excel 「적용 환율」 시트 — used = {'CNY|2026-08': 행 수} (이번 계산에서 쓴 칸), missing = [{cur, month, rows}] */
  function ratesAoa(R, used, missing, info) {
    info = info || {};
    var out = [['적용 환율 — 서울외국환중개 월평균 매매기준율(외화 1단위당 원, 엔화는 100엔당). 줄마다 납기월의 ' + (info.mode === 'same' ? '당월' : '전월') + ' 평균을 씁니다.'],
      ['찾는 순서: 직접입력 > 기준파일(' + (info.file || '없음') + ') > 자동(서울외국환중개, 받은 때 ' + (info.fetchedAt || '없음') + ')'],
      [],
      ['통화', '환율 월', '환율(원)', '단위', '쓰는 출처', '직접입력', '기준파일', '자동(서울외국환중개)', '이번 계산에 쓴 행 수']];
    R.table().forEach(function (e) {
      var k = e.cur + '|' + e.month;
      out.push([e.cur, e.month, e.raw, e.unit, e.src, e.all[SRC.manual] == null ? '' : e.all[SRC.manual], e.all[SRC.file] == null ? '' : e.all[SRC.file], e.all[SRC.auto] == null ? '' : e.all[SRC.auto], (used && used[k]) || '']);
    });
    if (missing && missing.length) {
      out.push([]);
      out.push(['환율 없음 — 금액 합계에서 뺀 줄']);
      out.push(['통화', '환율 월', '사유', '행 수']);
      missing.forEach(function (m) { out.push([m.cur, m.month, m.reason, m.rows]); });
    }
    return out;
  }
  /** 환율 기준 파일 빈 양식(회사용) */
  function templateAoa() {
    return [['연월', '통화', '환율(원)', '단위', '비고(출처)']];
  }

  return {
    CUR: CUR, FOREIGN: FOREIGN, SRC: SRC, SRC_ORDER: SRC_ORDER, MODE: MODE,
    normCurrency: normCurrency, label: label, unitOf: unitOf, round2: round2, parseMonth: parseMonth, addMonth: addMonth, rateMonth: rateMonth,
    parseMoney: parseMoney, money: money, parseRateBook: parseRateBook, textBook: textBook, fromAuto: fromAuto, fromManual: fromManual,
    resolver: resolver, convert: convert, describe: describe, ratesAoa: ratesAoa, templateAoa: templateAoa
  };
});
