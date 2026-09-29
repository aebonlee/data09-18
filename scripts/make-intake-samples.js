// 수주 취합 예시 파일 만들기: node scripts/make-intake-samples.js
// js/intake-sample.js(가상 데이터)를 samples/수주취합/ 에 실제 파일(xlsx·xls·pdf)로 씁니다.
// - 포털 파일(납품예정·누적결품·직송)은 실제 포털 파일처럼 공유 문자열을 「<si >」로 적어, 도구의 고침(fixZip)이 도는지 보여 줍니다.
// - PDF 는 playwright(Chromium)가 있을 때만 다시 만듭니다(없으면 있던 파일을 둡니다). 경로는 PLAYWRIGHT 환경변수로 줄 수 있습니다.
// 끝에 쓴 파일을 도구와 같은 방식으로 다시 읽어, 화면의 「예시 파일로 해 보기」와 같은 결과가 나오는지 확인합니다.
globalThis.window = globalThis;
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const I = require('../js/intake.js');
const S = require('../js/intake-sample.js');

const out = path.join(__dirname, '..', 'samples', '수주취합');
fs.mkdirSync(out, { recursive: true });
const portalLike = (n) => /납품예정|누적결품|직송/.test(n) && !/밥캣/.test(n);
const dateCells = (n) => portalLike(n) || /고객사[CDE]_/.test(n);

function toSheet(aoa, name) {
  const conv = aoa.map((r) => r.map((v) => (dateCells(name) && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)) : v)));
  return XLSX.utils.aoa_to_sheet(conv, { cellDates: true });
}
function spaceTags(buf) { // 포털 파일의 <si > 를 흉내
  const cfb = XLSX.CFB.read(buf, { type: 'buffer' });
  cfb.FileIndex.forEach((fi) => {
    if (fi.type !== 2 || !/sharedStrings\.xml$/.test(fi.name)) return;
    const s = Buffer.from(fi.content).toString('utf8').replace(/<si>/g, '<si >');
    fi.content = Buffer.from(s, 'utf8'); fi.size = fi.content.length;
  });
  return Buffer.from(XLSX.CFB.write(cfb, { type: 'buffer', fileType: 'zip' }));
}

const written = [];
for (const f of S.files()) {
  const p = path.join(out, f.name);
  if (f.kind === 'pdf') continue;
  const wb = XLSX.utils.book_new();
  for (const [nm, aoa] of Object.entries(f.sheets)) XLSX.utils.book_append_sheet(wb, toSheet(aoa, f.name), nm);
  let buf = XLSX.write(wb, { bookType: f.kind === 'xls' ? 'biff8' : 'xlsx', type: 'buffer', bookSST: true });
  if (portalLike(f.name)) buf = spaceTags(buf);
  fs.writeFileSync(p, buf);
  written.push(f.name);
}

// PDF — 서식형 발주서를 HTML 로 그려 Chromium 으로 인쇄(원본 PDF 도 브라우저 인쇄본입니다)
async function makePdf() {
  const cands = [process.env.PLAYWRIGHT, path.join(__dirname, '..', 'node_modules', 'playwright'), path.join(__dirname, '..', '..', 'hd-project05', 'node_modules', 'playwright')].filter(Boolean);
  let pw = null;
  for (const c of cands) { try { pw = require(c); break; } catch (e) { /* 다음 후보 */ } }
  const p = path.join(out, '고객사F_발주서.pdf');
  if (!pw) { console.log('playwright 가 없어 PDF 는 다시 만들지 않았습니다' + (fs.existsSync(p) ? '(있던 파일 사용)' : '')); return; }
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{font-family:"Apple SD Gothic Neo","Malgun Gothic",sans-serif;font-size:11px;margin:40px}
    h1{text-align:center;font-size:20px;letter-spacing:8px} table{border-collapse:collapse;width:100%} td,th{border:1px solid #333;padding:4px 6px}
    .code{width:60px;word-break:break-all} .n{text-align:right}</style>
    <h1>발 주 서</h1>
    <table><tr><td>일련번호</td><td>2026/09/10 - 3</td><td>회사명/대표</td><td>(예시) 고객사F</td></tr>
    <tr><td>수 신</td><td>(예시) 우리 회사</td><td>주 소</td><td>(예시) 주소</td></tr>
    <tr><td></td><td>납기일자 : 2026/10/08</td><td>담당/연락처</td><td>(예시) 담당자</td></tr></table><br>
    <table><tr><th class="code">품목코드</th><th>품목명[규격]</th><th>수량(단위포함)</th><th>단가</th><th>공급가액</th><th>부가세</th></tr>
    <tr><td class="code">SMP-PDF-0001</td><td>EXAMPLE-CHARGING</td><td class="n">120</td><td class="n">1,000</td><td class="n">120,000</td><td class="n">12,000</td></tr>
    <tr><td class="code">SMP-D002</td><td>EXAMPLE-HARNESS</td><td class="n">40</td><td class="n">2,000</td><td class="n">80,000</td><td class="n">8,000</td></tr></table><br>
    <table><tr><td>수량</td><td class="n">160</td><td>공급가액</td><td class="n">200,000</td><td>VAT</td><td class="n">20,000</td><td>합계</td><td class="n">220,000</td></tr></table>`;
  const browser = await pw.chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html);
  await page.pdf({ path: p, format: 'A4' });
  await browser.close();
}

async function pdfItems(file) {
  require('../vendor/pdfjs/pdf.min.js'); require('../vendor/pdfjs/pdf.worker.min.js');
  const P = globalThis.pdfjsLib;
  const doc = await P.getDocument({ data: new Uint8Array(fs.readFileSync(file)), isEvalSupported: false }).promise;
  const items = [];
  for (let i = 1; i <= doc.numPages; i++) (await (await doc.getPage(i)).getTextContent()).items.forEach((it) => items.push({ x: it.transform[4], y: it.transform[5], str: it.str, page: i }));
  return items;
}

(async () => {
  await makePdf();
  // 검증: 쓴 파일을 도구와 같은 방식으로 다시 읽어 취합
  const input = [];
  for (const f of S.files()) {
    const p = path.join(out, f.name);
    if (f.kind === 'pdf') { if (fs.existsSync(p)) input.push({ name: f.name, pdf: await pdfItems(p) }); continue; }
    const wb = XLSX.read(I.fixZip(new Uint8Array(fs.readFileSync(p)), XLSX), { type: 'array', cellDates: true });
    const sheets = {};
    wb.SheetNames.forEach((n) => { sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }); });
    input.push({ name: f.name, sheets: { names: wb.SheetNames, sheets } });
  }
  const now = new Date(2026, 8, 29);
  const fromFiles = I.process(input, {}, now), fromMemory = I.process(S.asInput(), {}, now);
  const a = I.summary(fromFiles), b = I.summary(fromMemory);
  const key = (r) => [r.source, r.item, r.qty, r.due, r.orderDate || ''].join('|');
  const same = JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(fromFiles.rows.map(key).sort()) === JSON.stringify(fromMemory.rows.map(key).sort());
  console.log('파일로 다시 읽은 결과', a);
  if (!same) { console.error('화면 예시와 결과가 다릅니다', b); process.exit(1); }
  console.log('samples/수주취합/ 에 예시 파일 ' + (written.length + 1) + '개를 썼고, 다시 읽은 결과가 화면 예시와 같습니다');
})().catch((e) => { console.error(e); process.exit(1); });
