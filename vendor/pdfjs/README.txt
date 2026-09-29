pdf.js 3.11.174 (pdfjs-dist, build/pdf.min.js · build/pdf.worker.min.js · cmaps)
https://github.com/mozilla/pdf.js — Apache License 2.0 (LICENSE)
수주 취합 화면에서 고객사 발주서 PDF 의 글자와 위치(좌표)를 꺼내 품목코드·수량·납기일을 읽는 데 씁니다.
PDF 를 넣을 때만 불러옵니다. 로컬 파일(file://)로 열면 Worker 가 막히므로 pdf.worker.min.js 를 일반 스크립트로 먼저 읽어 메인 스레드에서 돌립니다.
