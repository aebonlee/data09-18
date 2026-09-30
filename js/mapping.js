/* 고객사 품번 → 천일품번(당사 품번) 매핑 — 순수 로직 (기획서 11.10, 2026-09-30 매핑표 수령)
   매핑표 파일(시트 「건기엔진품목코드」「밥캣품목코드」, 열 「고객사 | 천일품번」)을 읽어 두 고객 묶음의 표로 만들고,
   통합 수주 표의 각 행에 천일품번을 붙입니다. 재고·선적계획 품번은 천일품번이라 이 값으로 맞춥니다.
   매핑표는 실제 회사 자료라 리포에 두지 않고 브라우저(localStorage)에만 저장합니다.
   브라우저(window.SPMapping)와 node(require) 양쪽에서 씁니다. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SPMapping = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function str(v) { return v == null ? '' : String(v).trim(); }
  function norm(v) { return str(v).toLowerCase().replace(/[\s_()\-·.:：（）]/g, ''); }
  /** 매핑 열쇠: 앞뒤 공백을 떼고 대문자로(엑셀에서 옮기다 생기는 소문자·공백 차이만 흡수, 기호는 그대로) */
  function key(v) { return str(v).replace(/\s+/g, '').toUpperCase(); }

  // 고객 묶음 두 개 = 매핑표 시트 두 장
  var GROUPS = {
    doosan: { label: '건기·엔진 (AM·CKD 포함)', sheetRe: /건기|엔진|두산/ },
    bobcat: { label: '밥캣', sheetRe: /밥캣|bobcat/i }
  };
  var GROUP_KEYS = ['doosan', 'bobcat'];
  /** 통합 수주 행의 구분 → 매핑 묶음. 발주서(그 밖의 고객사)는 매핑표가 없어 null */
  function groupOfRow(g) {
    if (g === '밥캣') return 'bobcat';
    if (g === '건기' || g === '엔진' || g === 'AM' || g === 'CKD') return 'doosan';
    return null;
  }
  function groupOfName(name) {
    var s = str(name);
    if (GROUPS.bobcat.sheetRe.test(s)) return 'bobcat';
    if (GROUPS.doosan.sheetRe.test(s)) return 'doosan';
    return null;
  }

  var CUSTOMER_COL = ['고객사', '고객사품번', '고객품번', '고객사 품번', '고객 품번', 'customer', 'customerpn'];
  var COMPANY_COL = ['천일품번', '당사품번', '사내품번', '자사품번', '천일 품번', '당사 품번', 'companypn'];
  var GROUP_COL = ['구분', '고객구분', '묶음'];
  function findCols(aoa) {
    for (var r = 0; r < Math.min(aoa.length, 10); r++) {
      var hs = (aoa[r] || []).map(norm);
      var ci = -1, pi = -1, gi = -1;
      CUSTOMER_COL.map(norm).some(function (c) { ci = hs.indexOf(c); return ci >= 0; });
      COMPANY_COL.map(norm).some(function (c) { pi = hs.indexOf(c); return pi >= 0; });
      GROUP_COL.map(norm).some(function (c) { gi = hs.indexOf(c); return gi >= 0; });
      if (ci >= 0 && pi >= 0) return { hr: r, customer: ci, company: pi, group: gi };
    }
    return null;
  }
  function emptyGroup() { return { map: {}, conflicts: {}, rows: 0, pairs: 0, blank: 0, dupSame: 0, same: 0, sheet: '' }; }

  /* 매핑표 읽기. book = { names:[시트], sheets:{시트: aoa} }, fileName = 파일 이름(CSV 처럼 시트 이름이 없을 때 묶음 판별)
     반환 { groups: {doosan, bobcat 중 들어 있는 것}, problems: [문장] }
       group.map       — { 고객사품번(열쇠): 천일품번 } (같은 품번이 여러 번이면 위쪽 행)
       group.conflicts — { 고객사품번: [천일품번 …] } 같은 고객사 품번이 서로 다른 천일품번으로 적힌 것(경고)
       rows 읽은 행 · pairs 고유 품번 수 · blank 한쪽이 빈 행 · dupSame 똑같은 줄 반복 · same 두 품번이 같은 것 */
  function parseBook(book, fileName) {
    var out = { groups: {}, problems: [] };
    var names = (book && book.names) || [];
    names.forEach(function (nm) {
      var aoa = book.sheets[nm] || [];
      if (!aoa.some(function (r) { return (r || []).some(function (c) { return str(c) !== ''; }); })) return; // 빈 시트
      var cols = findCols(aoa);
      if (!cols) { out.problems.push('시트「' + nm + '」: 「고객사」「천일품번」 머리를 찾지 못해 건너뛰었습니다'); return; }
      var sheetGroup = groupOfName(nm) || (names.length === 1 ? groupOfName(fileName) : null);
      if (!sheetGroup && cols.group < 0) { out.problems.push('시트「' + nm + '」: 건기·엔진인지 밥캣인지 알 수 없습니다 — 시트(파일) 이름에 「건기」「엔진」 또는 「밥캣」을 넣거나 「구분」 열을 두어 주세요'); return; }
      var noGroupRows = 0;
      for (var r = cols.hr + 1; r < aoa.length; r++) {
        var ln = aoa[r] || [];
        var c = key(ln[cols.customer]), p = str(ln[cols.company]);
        var g = cols.group >= 0 ? (groupOfName(ln[cols.group]) || sheetGroup) : sheetGroup;
        if (!c && !p) continue;
        if (!g) { noGroupRows++; continue; }
        var G = out.groups[g] || (out.groups[g] = emptyGroup());
        if (!G.sheet) G.sheet = nm; else if (G.sheet.split(', ').indexOf(nm) < 0) G.sheet += ', ' + nm;
        G.rows++;
        if (!c || !p) { G.blank++; continue; }
        if (G.map[c] === undefined) { G.map[c] = p; G.pairs++; if (key(p) === c) G.same++; continue; }
        if (key(G.map[c]) === key(p)) { G.dupSame++; continue; }
        var list = G.conflicts[c] || (G.conflicts[c] = [G.map[c]]);
        if (list.map(key).indexOf(key(p)) < 0) list.push(p);
      }
      if (noGroupRows) out.problems.push('시트「' + nm + '」: 「구분」 칸으로 묶음을 알 수 없는 ' + noGroupRows + '행은 넣지 않았습니다');
    });
    if (!Object.keys(out.groups).length && !out.problems.length) out.problems.push('매핑표에서 읽은 행이 없습니다');
    return out;
  }
  /** 한 천일품번을 여러 고객사 품번이 같이 쓰는 경우 수(정상일 수 있어 알림만) */
  function manyToOne(G) {
    var c = {}, n = 0;
    Object.keys(G.map).forEach(function (k) { var v = key(G.map[k]); c[v] = (c[v] || 0) + 1; });
    Object.keys(c).forEach(function (v) { if (c[v] > 1) n++; });
    return n;
  }
  /** 저장할 모양: 새로 읽은 묶음만 바꾸고, 파일에 없던 묶음은 이전 것을 그대로 둡니다 */
  function merge(saved, parsed, fileName, at) {
    var m = { v: 1, groups: {} };
    if (saved && saved.groups) GROUP_KEYS.forEach(function (g) { if (saved.groups[g]) m.groups[g] = saved.groups[g]; });
    Object.keys(parsed.groups).forEach(function (g) {
      var G = parsed.groups[g];
      m.groups[g] = { map: G.map, conflicts: G.conflicts, file: fileName || '', sheet: G.sheet, at: at || '',
        stats: { rows: G.rows, pairs: G.pairs, blank: G.blank, dupSame: G.dupSame, conflicts: Object.keys(G.conflicts).length, same: G.same, manyToOne: manyToOne(G) } };
    });
    return m;
  }
  function has(mapping) { return !!(mapping && mapping.groups && GROUP_KEYS.some(function (g) { return mapping.groups[g]; })); }

  /* 통합 수주 행에 천일품번 붙이기. rows 는 바꾸지 않고 새 행을 돌려줍니다.
     opts.unmapped: 'keep'(기본) 고객사 품번을 그대로 천일품번 자리에 씀 / 'drop' 선적계획에서 뺌
     행.mapStatus: mapped(매핑됨) · conflict(매핑 충돌 — 위쪽 행 값 사용) · unmapped(매핑 없음) · nomap(그 묶음 매핑표 없음) · none(매핑 대상 아님: 발주서)
     반환 { rows, checks(★확인 필요 — 품번마다 한 줄), stats } */
  function apply(rows, mapping, opts) {
    opts = opts || {};
    var loaded = has(mapping);
    var stats = { total: rows.length, mapped: 0, changed: 0, conflict: 0, unmapped: 0, unmappedItems: 0, nomap: 0, none: 0, loaded: loaded };
    var miss = {}, conf = {}, nomapGroups = {};
    var out = rows.map(function (r) {
      var g = groupOfRow(r.group), x = Object.assign({}, r);
      x.customerItem = r.item;
      if (!g) { x.company = r.item; x.mapStatus = 'none'; stats.none++; return x; }
      var G = loaded ? mapping.groups[g] : null;
      if (!G) { x.company = r.item; x.mapStatus = 'nomap'; stats.nomap++; if (loaded) nomapGroups[g] = (nomapGroups[g] || 0) + 1; return x; }
      var k = key(r.item), v = G.map[k];
      if (v === undefined) {
        x.company = r.item; x.mapStatus = 'unmapped'; stats.unmapped++;
        var mk = g + '|' + k;
        (miss[mk] || (miss[mk] = { group: g, item: r.item, rows: 0, qty: 0, files: [] })).rows++;
        miss[mk].qty += r.qty || 0;
        if (miss[mk].files.indexOf(r.source) < 0) miss[mk].files.push(r.source);
        return x;
      }
      x.company = v; x.mapStatus = G.conflicts && G.conflicts[k] ? 'conflict' : 'mapped';
      if (x.mapStatus === 'conflict') { stats.conflict++; conf[g + '|' + k] = { group: g, item: r.item, values: G.conflicts[k] }; }
      else stats.mapped++;
      if (key(v) !== k) stats.changed++;
      return x;
    });
    var checks = [];
    Object.keys(miss).forEach(function (k) {
      var m = miss[k];
      checks.push({ file: m.files.join(', '), row: '', reason: '매핑 없음', detail: GROUPS[m.group].label + ' 고객사 품번 「' + m.item + '」 ' + m.rows + '행(수량 ' + m.qty + ') — 매핑표에 없어 ' + (opts.unmapped === 'drop' ? '선적계획에서 뺐습니다' : '고객사 품번 그대로 계산했습니다'), kind: 'unmapped', item: m.item, group: m.group });
    });
    stats.unmappedItems = checks.length;
    Object.keys(conf).forEach(function (k) {
      var c = conf[k];
      checks.push({ file: '매핑표', row: '', reason: '매핑 충돌', detail: GROUPS[c.group].label + ' 고객사 품번 「' + c.item + '」 → ' + c.values.join(' / ') + ' — 위쪽 행의 「' + c.values[0] + '」로 계산했습니다', kind: 'conflict', item: c.item, group: c.group });
    });
    Object.keys(nomapGroups).forEach(function (g) {
      checks.push({ file: '매핑표', row: '', reason: '매핑표 없음', detail: GROUPS[g].label + ' 시트가 매핑표에 없어 ' + nomapGroups[g] + '행을 고객사 품번 그대로 계산했습니다', kind: 'nomap', group: g });
    });
    return { rows: out, checks: checks, stats: stats };
  }
  /** 선적계획으로 넘길 행: 매핑 없는 행을 뺄지(opts.unmapped === 'drop') */
  function planRows(mappedRows, opts) {
    if (!opts || opts.unmapped !== 'drop') return mappedRows;
    return mappedRows.filter(function (r) { return r.mapStatus !== 'unmapped'; });
  }
  var STATUS_LABEL = { mapped: '매핑됨', conflict: '매핑 충돌', unmapped: '매핑 없음', nomap: '매핑표 없음', none: '매핑 대상 아님' };

  return {
    GROUPS: GROUPS, GROUP_KEYS: GROUP_KEYS, STATUS_LABEL: STATUS_LABEL,
    key: key, groupOfRow: groupOfRow, groupOfName: groupOfName, findCols: findCols,
    parseBook: parseBook, merge: merge, has: has, apply: apply, planRows: planRows, manyToOne: manyToOne
  };
});
