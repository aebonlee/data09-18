/* 브라우저 저장소 — localStorage 를 쓰되, 막혀 있으면 메모리로만 동작합니다 */
(function (root) {
  'use strict';
  var KEY = 'data09-18.state';
  var memory = {};
  var ok = true;
  function get(k) {
    try { return root.localStorage.getItem(k); } catch (e) { ok = false; return memory[k] == null ? null : memory[k]; }
  }
  function set(k, v) {
    try { root.localStorage.setItem(k, v); } catch (e) { ok = false; memory[k] = v; }
  }
  function del(k) {
    try { root.localStorage.removeItem(k); } catch (e) { ok = false; delete memory[k]; }
  }
  function empty() {
    return {
      tables: { orders: null, stock: null, shipments: null }, // {fileName, sheet, aoa, headerRow, mapping}
      savedMappings: { orders: {}, stock: {}, shipments: {} }, // {필드키: 머리행 이름} — 같은 양식 파일이면 자동 적용
      settings: root.SPLogic.defaultSettings(),
      planEdits: {},
      ai: { answer: '', includeName: false },
      intakeOpts: root.SPIntake ? root.SPIntake.defaultOptions() : {}, // 수주 취합 규칙 설정
      intake: null, // 마지막 수주 취합 결과 {base, rows, files, checks, options, at, sample, stockCount, shipCount}
      _sample: false
    };
  }
  function load() {
    var st = empty();
    var raw = get(KEY);
    if (!raw) return st;
    try {
      var p = JSON.parse(raw);
      ['orders', 'stock', 'shipments'].forEach(function (k) {
        if (p.tables && p.tables[k] && Array.isArray(p.tables[k].aoa)) st.tables[k] = p.tables[k];
        if (p.savedMappings && p.savedMappings[k]) st.savedMappings[k] = p.savedMappings[k];
      });
      st.settings = root.SPLogic.mergeSettings(p.settings);
      if (p.planEdits && typeof p.planEdits === 'object') st.planEdits = p.planEdits;
      if (p.ai) st.ai = { answer: String(p.ai.answer || ''), includeName: !!p.ai.includeName };
      st._sample = !!p._sample;
      if (root.SPIntake) st.intakeOpts = root.SPIntake.mergeOptions(p.intakeOpts);
      if (p.intake && Array.isArray(p.intake.rows)) st.intake = p.intake;
    } catch (e) { /* 깨진 값은 무시하고 빈 상태 */ }
    return st;
  }
  root.SPStore = {
    empty: empty,
    load: load,
    save: function (st) { set(KEY, JSON.stringify(st)); },
    clear: function () { del(KEY); },
    available: function () { get(KEY); return ok; }
  };
})(window);
