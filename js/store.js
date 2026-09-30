/* 브라우저 저장소 — localStorage 를 쓰되, 막혀 있으면 메모리로만 동작합니다 */
(function (root) {
  'use strict';
  var KEY = 'data09-18.state';
  var MAP_KEY = 'data09-18.partMapping'; // 고객사 품번 ↔ 천일품번 매핑표(실제 회사 자료 — 이 브라우저에만, 리포에는 없음)
  var PRICE_KEY = 'data09-18.buyPriceTable'; // 매입단가표(당사 품목코드 → 매입단가 · 생산처, 실제 회사 자료 — 이 브라우저에만)
  var PRODUCT_KEY = 'data09-18.productInfo'; // 완제품정보(천일품번 마스터, 실제 회사 자료 — 이 브라우저에만, 기획서 11.16)
  var FX_KEY = 'data09-18.fxFile'; // 불러온 환율 기준 파일에서 읽은 값 {rates, stats, file, at} (기획서 11.15)
  var OLD_PRICE_KEY = 'data09-18.priceTable'; // 2026-09-30 오전판 「단가표」(고객 발주 단가를 채우던 것) — 뜻이 바뀌어 읽지 않고 지웁니다
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
      mapOpts: { unmapped: 'keep' }, // 매핑 없는 품번: keep 고객사 품번 그대로 계산 | drop 선적계획에서 뺌
      uploadOpts: root.SPUpload ? root.SPUpload.defaultOptions() : {}, // ERP 업로드 양식 설정(납품처표·고정값)
      uploadTpl: null, // 사용자가 넣은 업로드 양식의 머리행 {fileName, sheet, headers} — 없으면 내장 기본 양식
      manualBuy: {}, // 「매입단가 없음」 목록에 직접 적은 매입단가 {품목코드 열쇠: 단가} (기획서 11.12)
      showMargin: false, // 판매 − 매입 차이 열 보기
      monthlyOpts: { by: 'due', topN: 20 }, // 월별 수주 vs 매입: 월 기준(due 납기월 | order 발주월) · 품목 상위 N (기획서 11.13)
      // 환율(기획서 11.15): mode prev 납기월의 전월 평균(기본) | same 당월 평균 · defaultCur 통화가 적히지 않은 매입단가의 통화
      //   manual {'CNY|2026-09': 환율} 직접 입력(가장 먼저 씀) · useAuto 자동 값(data/rates.js) 사용
      fx: { mode: 'prev', defaultCur: 'KRW', manual: {}, useAuto: true },
      productOpts: { fallbackKrw: false }, // (판 1.1 설정 — 2026-09-30 다섯 번째 답변 뒤 쓰지 않음: 완제품정보 「발주단가(원화)」를 늘 그대로 씀, 기획서 11.17)
      manualBuyCur: {}, // 직접 적은 매입단가의 통화 {품목코드 열쇠: 'CNY'…} — 없으면 fx.defaultCur
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
      if (root.SPIntake) st.intakeOpts = (root.SPIntake.upgradeOptions || root.SPIntake.mergeOptions)(p.intakeOpts);
      if (p.intake && Array.isArray(p.intake.rows)) st.intake = p.intake;
      if (p.mapOpts) st.mapOpts = { unmapped: p.mapOpts.unmapped === 'drop' ? 'drop' : 'keep' };
      if (root.SPUpload) st.uploadOpts = root.SPUpload.upgradeOptions(p.uploadOpts);
      if (p.uploadTpl && Array.isArray(p.uploadTpl.headers)) st.uploadTpl = p.uploadTpl;
      if (p.manualBuy && typeof p.manualBuy === 'object') st.manualBuy = p.manualBuy;
      st.showMargin = !!p.showMargin;
      if (p.monthlyOpts && root.SPMonthly) st.monthlyOpts = root.SPMonthly.options(p.monthlyOpts);
      if (p.fx && typeof p.fx === 'object') st.fx = {
        mode: p.fx.mode === 'same' ? 'same' : 'prev',
        defaultCur: /^(KRW|CNY|USD|JPY|EUR)$/.test(p.fx.defaultCur) ? p.fx.defaultCur : 'KRW',
        manual: p.fx.manual && typeof p.fx.manual === 'object' ? p.fx.manual : {},
        useAuto: p.fx.useAuto !== false
      };
      if (p.manualBuyCur && typeof p.manualBuyCur === 'object') st.manualBuyCur = p.manualBuyCur;
      if (p.productOpts) st.productOpts = { fallbackKrw: !!p.productOpts.fallbackKrw };
    } catch (e) { /* 깨진 값은 무시하고 빈 상태 */ }
    return st;
  }
  root.SPStore = {
    empty: empty,
    load: load,
    save: function (st) { set(KEY, JSON.stringify(st)); },
    clear: function () { del(KEY); },
    loadMapping: function () { var raw = get(MAP_KEY); if (!raw) return null; try { var m = JSON.parse(raw); return m && m.groups ? m : null; } catch (e) { return null; } },
    saveMapping: function (m) { set(MAP_KEY, JSON.stringify(m)); },
    clearMapping: function () { del(MAP_KEY); },
    loadPriceTable: function () { if (get(OLD_PRICE_KEY) != null) del(OLD_PRICE_KEY); var raw = get(PRICE_KEY); if (!raw) return null; try { var t = JSON.parse(raw); return t && t.map ? t : null; } catch (e) { return null; } },
    savePriceTable: function (t) { set(PRICE_KEY, JSON.stringify(t)); },
    clearPriceTable: function () { del(PRICE_KEY); },
    loadProduct: function () { var raw = get(PRODUCT_KEY); if (!raw) return null; try { return root.SPProduct ? root.SPProduct.unpack(JSON.parse(raw)) : null; } catch (e) { return null; } },
    /** 저장하고 성공했는지 돌려줌(15,000줄이 넘으면 브라우저 저장 한도에 걸릴 수 있음 — 그러면 이 창에서만 씀) */
    saveProduct: function (p) { var before = ok; ok = true; set(PRODUCT_KEY, JSON.stringify(root.SPProduct.pack(p))); var r = ok; ok = before && ok; return r; },
    clearProduct: function () { del(PRODUCT_KEY); },
    loadFxFile: function () { var raw = get(FX_KEY); if (!raw) return null; try { var t = JSON.parse(raw); return t && t.rates ? t : null; } catch (e) { return null; } },
    saveFxFile: function (t) { set(FX_KEY, JSON.stringify(t)); },
    clearFxFile: function () { del(FX_KEY); },
    available: function () { get(KEY); return ok; }
  };
})(window);
