-- ============================================================================
-- data09-18 — 생산관리 선적계획 자동화 (수주현황 × 재고현황 × 중국 선적예정)
-- Supabase(PostgreSQL) 스키마 + RLS
--
--  무엇인가 : 지금 브라우저 localStorage('data09-18.state')에만 두는
--             세 엑셀 표·열 연결·설정·선적계획 수정·AI 답변을 DB 로 옮길 때 쓸
--             테이블과 보안 정책입니다.
--             기획서 2.1·8장 3단계의 「생산·구매·물류 담당자와 공유」「여러 사람이 같은 계획을
--             보는 공유 저장소」를 위해 팀 구성원 표(app_members)를 둡니다.
--             확정한 선적계획 기록(shipment_plan_log)은 3단계 「계획 대비 실적」 비교용입니다.
--  실행 위치 : 수강생 본인 Supabase 프로젝트의 SQL Editor 에서 실행
--  재실행    : 안전합니다 (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS 선행)
--
--  본인 프로젝트에 올리는 것을 전제로 하므로 테이블 이름에 접두사를 붙이지 않았습니다.
--  회사 공용 URL·키는 어디에도 들어 있지 않습니다.
--
--  테이블 (18개)
--    app_members        — 팀 구성원과 역할 (admin=생산관리 담당자 / member=구매·물류 담당자, 읽기 전용)
--    source_file        — 올린 엑셀 한 벌 (dataset: orders 수주 / stock 재고 / shipments 선적예정)
--    order_line         — 수주현황 한 행 (품번·품명·고객사·수주일·납기일·수주수량)
--    stock_line         — 재고현황 한 행 (품번·품명·현재고·가용재고·안전재고)
--    shipment_line      — 선적예정 한 행 (품번·품명·중국 선적예정일·선적수량·파일의 입고예정일)
--    column_mapping     — 표준 항목 ↔ 실제 열 이름 연결 (같은 양식 파일이면 자동 적용)
--    app_settings       — 계산 설정 (기준일·재고 기준 열·안전재고·입고 규칙·휴일·긴급/과잉 기준)
--    plan_edit          — 사용자가 고친 선적계획 (선적일·수량)
--    ai_note            — AI 분석 답변 붙여넣기 (고객사·품명 포함 여부)
--    shipment_plan_log  — 확정·공유한 선적계획 기록 — 기록성, 수정·삭제 불가
--    ── 수주 자동 취합 (기획서 11장, localStorage 의 intakeOpts · intake) ──
--    intake_setting     — 수주 취합 규칙 설정 (결품 납기 당김 일수·결품/납품예정 겹침·직송 수집 …)
--    intake_batch       — 파일 묶음 한 번 취합한 결과(기준일·설정 사본·건수)
--    intake_order_line  — 통합 수주 표 한 행 (고객사·공장·구분·품목코드·수량·납기일·발주일·원본파일/행)
--    intake_file        — 파일별 집계 (판별 종류·읽은 행·수집·규칙으로 뺀 행과 사유)
--    intake_check       — 「★확인 필요」 한 줄 (판별·매핑하지 못한 파일·칸)
--    ── 품번 매핑·ERP 업로드 (기획서 11.10, 2026-09-30 매핑표·업로드 양식 수령) ──
--    part_mapping       — 고객사 품번 → 천일품번 (묶음: doosan 건기·엔진 / bobcat 밥캣). 충돌은 두 행으로 남기고, 쓸 값은 chosen
--    upload_setting     — ERP 업로드 양식 설정 (양식 머리행·일자·순번·품번별 납품처·묶음 기본값·고정값·단가 열) — 사용자당 한 행
--    ── 단가 두 가지 (기획서 11.11 · 11.12, 2026-09-30 두 번째 답변으로 나눔) ──
--    intake_order_line 의 unit_price · amount · price_source — 판매단가(고객 발주, 참고): 고객사 파일의 단가 칸 · 판매금액 · 출처
--    intake_order_line 의 buy_price · buy_amount · buy_source · maker — 매입단가(생산처 발주): 당사 → 생산처 발주단가 · 매입금액 · 출처 · 생산처
--    price_master       — 매입단가표(천일품번 → 매입단가 · 생산처, 2026-09-30 확정)와 화면에서 직접 적은 매입단가. 고객 발주 단가와 무관
--    intake_monthly_summary (뷰) — 월별 수주 vs 매입(납기월(확정)·발주월 × 수주금액·매입금액·단가 없음 행 수·비중·차액·차익률), 기획서 11.13·11.14
--    ── 환율 (기획서 11.15, 2026-09-30 China(RMB) 요청) ──
--    fx_rate            — 월평균 환율(통화 · 연월 · 값 · 단위 · 출처: 직접입력 / 기준파일 / 자동(서울외국환중개))
--    intake_order_line 의 sale_currency · sale_price_orig · sale_fx_rate · buy_currency · buy_price_orig · buy_fx_rate · fx_month — 외화 단가의 원래 값과 쓴 환율
--
--  접근 규칙
--    · 자료는 올린 사람(owner_id)만 쓰고 고친다.
--    · 팀 구성원(app_members)은 모든 자료를 읽을 수 있다 — 구매·물류 담당자가 같은 계획을 본다.
--    · 구성원 등록·해제는 admin 만 한다. 첫 admin 은 SQL Editor 에서 넣는다(맨 아래 안내).
--    · 비로그인(anon)은 아무것도 못 한다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

create table if not exists public.app_members (
  user_id     uuid primary key,
  role        text not null default 'member' check (role in ('admin', 'member')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 엑셀 한 벌 (st.tables[dataset] = { fileName, sheet, aoa, headerRow, mapping })
-- 원본 표(aoa)는 그대로 두지 않고 행 단위 표(order_line …)로 풀어 저장한다.
create table if not exists public.source_file (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  dataset     text not null check (dataset in ('orders', 'stock', 'shipments')),
  file_name   text not null check (length(btrim(file_name)) > 0),
  sheet       text not null default '',
  header_row  int not null default 0 check (header_row >= 0),
  mapping     jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping) = 'object'),  -- {필드키: 열 번호}
  is_sample   boolean not null default false,                                           -- _sample
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists source_file_owner_idx on public.source_file (owner_id, dataset, created_at desc);

-- 수주현황 (logic.js DATASETS.orders: item, name, customer, orderDate, dueDate, qty)
-- 필수 칸(품번·납기일·수주수량)이 빈 행은 도구가 오류로 빼므로 DB 도 받지 않는다.
create table if not exists public.order_line (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null default auth.uid(),
  source_file_id  bigint not null references public.source_file(id) on delete cascade,
  row_no          int not null check (row_no > 0),          -- 엑셀 행 번호
  item            text not null check (length(btrim(item)) > 0),
  name            text not null default '',
  customer        text not null default '',
  order_date      date,
  due_date        date not null,
  qty             numeric not null check (qty >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- ⚠ upsert 시 onConflict: 'source_file_id,row_no'
  constraint order_line_file_row_key unique (source_file_id, row_no)
);
create index if not exists order_line_item_idx on public.order_line (item, due_date);

-- 재고현황 (item, name, current, available, safety)
create table if not exists public.stock_line (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null default auth.uid(),
  source_file_id  bigint not null references public.source_file(id) on delete cascade,
  row_no          int not null check (row_no > 0),
  item            text not null check (length(btrim(item)) > 0),
  name            text not null default '',
  current         numeric not null check (current >= 0),                          -- 현재고
  available       numeric check (available is null or available >= 0),           -- 가용재고
  safety          numeric check (safety is null or safety >= 0),                 -- 안전재고(선택)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint stock_line_file_row_key unique (source_file_id, row_no)
);
create index if not exists stock_line_item_idx on public.stock_line (item);

-- 선적예정 (item, name, shipDate, qty, fileArrival)
create table if not exists public.shipment_line (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null default auth.uid(),
  source_file_id  bigint not null references public.source_file(id) on delete cascade,
  row_no          int not null check (row_no > 0),
  item            text not null check (length(btrim(item)) > 0),
  name            text not null default '',
  ship_date       date not null,                     -- 중국 선적예정일
  qty             numeric not null check (qty >= 0), -- 선적수량
  file_arrival    date,                              -- 파일에 적힌 한국 입고예정일(선택)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint shipment_line_file_row_key unique (source_file_id, row_no)
);
create index if not exists shipment_line_item_idx on public.shipment_line (item, ship_date);

-- 열 연결 (st.savedMappings[dataset] = {필드키: 머리행 이름}) — 사용자·자료 종류당 한 행
create table if not exists public.column_mapping (
  owner_id    uuid not null default auth.uid(),
  dataset     text not null check (dataset in ('orders', 'stock', 'shipments')),
  mapping     jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping) = 'object'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- ⚠ upsert 시 onConflict: 'owner_id,dataset'
  primary key (owner_id, dataset)
);

-- 입고예정일 규칙 검사 — 요일(0=일 … 6=토)별 「선적일 + N일」, N 은 0~60 정수 또는 null(규칙 없음)
create or replace function public.valid_ship_rule(p_rule jsonb)
returns boolean language sql immutable set search_path = public as $fn$
  select jsonb_typeof(p_rule) = 'object'
     and not exists (
       select 1 from jsonb_each(p_rule) e
        where e.key not in ('0', '1', '2', '3', '4', '5', '6')
           or not (jsonb_typeof(e.value) = 'null'
                   or (jsonb_typeof(e.value) = 'number'
                       and (e.value #>> '{}')::numeric between 0 and 60
                       and (e.value #>> '{}')::numeric = trunc((e.value #>> '{}')::numeric))));
$fn$;

-- 계산 설정 (logic.js defaultSettings) — 사용자당 한 행
create table if not exists public.app_settings (
  owner_id        uuid primary key default auth.uid(),
  base_date       date,                                   -- 현재고 기준일. 비우면 오늘
  stock_field     text not null default 'current' check (stock_field in ('current', 'available')),
  default_safety  numeric not null default 0 check (default_safety >= 0),
  -- 원문 규칙: 월~수 선적 → 2일 후, 목 → +4(다음 월요일), 금 → +3, 토·일 → 규칙 없음
  rule            jsonb not null default '{"0": null, "1": 2, "2": 2, "3": 2, "4": 4, "5": 3, "6": null}'::jsonb
                  check (public.valid_ship_rule(rule)),
  holidays        date[] not null default '{}',
  urgent_days     int check (urgent_days is null or urgent_days >= 0),       -- 비우면 긴급 판정 안 함
  excess_ratio    numeric check (excess_ratio is null or excess_ratio >= 0), -- 비우면 과잉 판정 안 함
  arrival_buffer  int not null default 0 check (arrival_buffer >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 선적계획 수정 (st.planEdits = { 'item@needDate': { shipDate, qty } })
create table if not exists public.plan_edit (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  plan_id     text not null check (plan_id ~ '^.+@\d{4}-\d{2}-\d{2}$'),   -- 품번@필요일
  ship_date   date,
  qty         numeric check (qty is null or qty >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- ⚠ upsert 시 onConflict: 'owner_id,plan_id'
  constraint plan_edit_owner_plan_key unique (owner_id, plan_id)
);

-- AI 답변 (st.ai = { answer, includeName }) — 사용자당 한 행
create table if not exists public.ai_note (
  owner_id      uuid primary key default auth.uid(),
  answer        text not null default '',
  include_name  boolean not null default false,          -- 고객사·품명을 질문문에 넣었는가
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 확정·공유한 선적계획 기록 — 기록성이라 UPDATE/DELETE 정책이 없다
create table if not exists public.shipment_plan_log (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  plan_id     text not null,
  item        text not null check (length(btrim(item)) > 0),
  need_date   date not null,
  ship_date   date,
  arrival     date,
  qty         numeric not null check (qty >= 0),
  status      text not null check (status in ('정상', '부족', '주의', '과잉', '긴급')),
  late        boolean not null default false,              -- 납기 내 입고 불가
  edited      boolean not null default false,              -- 사용자가 고친 계획인가
  issued_at   timestamptz not null default now()
);
create index if not exists shipment_plan_log_idx on public.shipment_plan_log (owner_id, issued_at desc);

-- ── 수주 자동 취합 (기획서 11장) ─────────────────────────────────────────────
-- 규칙 설정 (intake.js defaultOptions) — 사용자당 한 행
create table if not exists public.intake_setting (
  owner_id             uuid primary key default auth.uid(),
  base_date            date,                                          -- 비우면 파일 이름 날짜 → 오늘
  engine_short_offset  int not null default 2 check (engine_short_offset between 0 and 30),  -- 요청 ②: 결품일 − 2일
  bobcat_short_offset  int not null default 2 check (bobcat_short_offset between 0 and 30),  -- 확정(2026-09-30): 결품일 − 2일
  engine_mode          text not null default 'override' check (engine_mode in ('override', 'sum')),  -- 확정(2026-09-30): 결품 기준 | 합산
  collect_direct       boolean not null default true,                 -- 확정(2026-09-30): 직송도 납품예정과 같이 수집
  month_buckets        boolean not null default true,                 -- 누적결품 월 단위 칸
  short_mode           text not null default 'increment' check (short_mode in ('increment', 'single')),
  po_all_sheets        boolean not null default false,                -- 발주서 시트 전부 / 최근 시트만(확정 2026-09-30)
  borrow_price         boolean not null default true,                 -- 판매단가(고객 발주, 참고): 단가 칸이 없는 줄에 같은 품번의 다른 파일 단가(값이 하나일 때만)
  portal_customer      text not null default '포털 고객사',
  bobcat_customer      text not null default '밥캣',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- 2026-09-30 수강생 답으로 바뀐 기본값 — 이미 만들어진 표에도 반영(재실행 안전, 저장된 행은 그대로)
alter table public.intake_setting alter column bobcat_short_offset set default 2;
alter table public.intake_setting alter column collect_direct set default true;
alter table public.intake_setting add column if not exists borrow_price boolean not null default true;   -- 2026-09-30 발주단가


-- 취합 한 번 (파일 묶음)
create table if not exists public.intake_batch (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null default auth.uid(),
  base_date    date not null,
  options      jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),  -- 그때 쓴 규칙 설정 사본
  file_count   int not null default 0 check (file_count >= 0),
  row_count    int not null default 0 check (row_count >= 0),
  check_count  int not null default 0 check (check_count >= 0),
  is_sample    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists intake_batch_owner_idx on public.intake_batch (owner_id, created_at desc);

-- 통합 수주 표 한 행. 원본 한 행이 줄 여럿이 될 수 있다(누적결품 날짜별 증가분, 서식형 발주서 날짜 칸) —
-- 그래서 원본 행 + 납기일로 한 줄을 가린다.
create table if not exists public.intake_order_line (
  id            bigint generated always as identity primary key,
  owner_id      uuid not null default auth.uid(),
  batch_id      bigint not null references public.intake_batch(id) on delete cascade,
  customer      text not null default '',
  plant         text not null default '' check (plant in ('', '인천', '군산', '안산')),
  kind          text not null check (length(btrim(kind)) > 0),   -- 구분: 건기·엔진·AM·CKD·밥캣·발주서
  item          text not null check (length(btrim(item)) > 0),   -- 품목코드
  name          text not null default '',
  qty           numeric not null check (qty > 0),                 -- 결품 음수는 양수로 바꿔 넣는다
  due_date      date not null,                                    -- 납기일(엔진 결품 = 결품일 − 2일, 밥캣 = 조인 값)
  original_due  date,                                             -- 밥캣 조이기 전 원납기
  order_date    date,                                             -- 발주일(없으면 비움)
  source_file   text not null check (length(btrim(source_file)) > 0),
  source_sheet  text not null default '',
  source_row    text not null check (length(btrim(source_row)) > 0),   -- 엑셀 행 번호 또는 PDF 'p1'
  rule          text not null default '',
  note          text not null default '',
  company_item  text not null default '',                          -- 천일품번(매핑표로 바꾼 당사 품번, 기획서 11.10). 비면 item 과 같음
  map_status    text not null default '' check (map_status in ('', 'mapped', 'conflict', 'unmapped', 'nomap', 'none')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- ⚠ upsert 시 onConflict: 'batch_id,source_file,source_sheet,source_row,due_date'
  constraint intake_order_line_src_key unique (batch_id, source_file, source_sheet, source_row, due_date)
);
create index if not exists intake_order_line_item_idx on public.intake_order_line (batch_id, item, due_date);
-- 2026-09-30 추가 칸 — 이미 만들어진 표에도(재실행 안전)
alter table public.intake_order_line add column if not exists company_item text not null default '';
alter table public.intake_order_line add column if not exists map_status text not null default '';
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'intake_order_line_map_status_check') then
    alter table public.intake_order_line add constraint intake_order_line_map_status_check
      check (map_status in ('', 'mapped', 'conflict', 'unmapped', 'nomap', 'none'));
  end if;
end $c$;
-- 판매단가(고객 발주, 참고) — 기획서 11.11. 고객사가 보낸 파일의 단가 칸이다. 단가가 없으면 세 칸 모두 비운다.
--   unit_price   — 판매단가(원본 단가 칸 ÷ 가격단위). 0·음수는 받지 않는다(원본의 0 은 단가 없음으로 읽는다)
--   amount       — 판매금액 = 수량 × 판매단가(소수 둘째 자리 반올림). 단가 없이 금액만 있을 수 없다
--   price_source — 원본 · 원본(같은 품번) — 단가가 있을 때만. (2026-09-30 오전판의 직접입력·단가표는 매입단가로 옮겨 여기서 뺐다)
--   currency     — 원본 통화 칸(KRW 등). 비면 원화로 본다
alter table public.intake_order_line add column if not exists unit_price numeric;
alter table public.intake_order_line add column if not exists amount numeric;
alter table public.intake_order_line add column if not exists price_source text not null default '';
alter table public.intake_order_line add column if not exists currency text not null default '';
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'intake_order_line_unit_price_check') then
    alter table public.intake_order_line add constraint intake_order_line_unit_price_check
      check (unit_price is null or unit_price > 0);
  end if;
  -- 판매단가 출처를 원본·원본(같은 품번)으로 좁힌다(재실행 안전: 지우고 다시 건다).
  -- 오전판에서 직접입력·단가표로 채운 값은 고객 발주 단가가 아니므로 비운다.
  alter table public.intake_order_line drop constraint if exists intake_order_line_price_source_check;
  update public.intake_order_line set unit_price = null, amount = null, price_source = '' where price_source in ('직접입력', '단가표');
  alter table public.intake_order_line add constraint intake_order_line_price_source_check
    check (price_source in ('', '원본', '원본(같은 품번)')
           and ((unit_price is null) = (price_source = '')));
  if not exists (select 1 from pg_constraint where conname = 'intake_order_line_amount_check') then
    alter table public.intake_order_line add constraint intake_order_line_amount_check
      check (amount is null or (unit_price is not null and amount = round(qty * unit_price, 2)));
  end if;
end $c$;
-- 매입단가(생산처 발주) — 기획서 11.12, 2026-09-30 두 번째 답변. 당사 → 생산처 발주단가로 고객 발주 단가와 무관하다.
--   buy_price  — 매입단가표(price_master) 또는 직접입력 값. 0·음수는 받지 않는다. ERP 업로드 양식의 「단가」 열이 이 값
--   buy_amount — 매입금액 = 수량 × 매입단가(소수 둘째 자리 반올림)
--   buy_source — 단가표 · 직접입력 — 매입단가가 있을 때만
--   maker      — 생산처(매입단가표의 생산처 칸, 없으면 빈칸)
alter table public.intake_order_line add column if not exists buy_price numeric;
alter table public.intake_order_line add column if not exists buy_amount numeric;
alter table public.intake_order_line add column if not exists buy_source text not null default '';
alter table public.intake_order_line add column if not exists maker text not null default '';
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'intake_order_line_buy_price_check') then
    alter table public.intake_order_line add constraint intake_order_line_buy_price_check
      check (buy_price is null or buy_price > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'intake_order_line_buy_source_check') then
    alter table public.intake_order_line add constraint intake_order_line_buy_source_check
      check (buy_source in ('', '단가표', '직접입력') and ((buy_price is null) = (buy_source = '')));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'intake_order_line_buy_amount_check') then
    alter table public.intake_order_line add constraint intake_order_line_buy_amount_check
      check (buy_amount is null or (buy_price is not null and buy_amount = round(qty * buy_price, 2)));
  end if;
end $c$;

-- 환율 (기획서 11.15) — 외화(China(RMB) 등) 단가를 원화로 바꾼 기록. js/price.js · js/fx.js 와 같은 규칙.
--   *_currency   — KRW(원화, 기본) · CNY(China(RMB) — RMB·CNH·위안 모두) · USD · JPY · EUR
--   *_price_orig — 원래 외화 단가. 원화 줄은 비운다
--   *_fx_rate    — 쓴 환율(외화 1단위당 원 — 엔화도 1엔당으로 나눈 값). unit_price · buy_price = round(원래 값 × 환율, 2)
--   fx_month     — 쓴 환율의 연월(납기월의 전월이 기본, 설정으로 당월) — 외화 줄만
--   환율이 없던 외화 줄: 원래 값만 있고 환율 · 원화 단가 · 출처는 비운다(= 「환율 없음」, 금액에서 뺀다)
alter table public.intake_order_line add column if not exists sale_currency text not null default 'KRW';
alter table public.intake_order_line add column if not exists sale_price_orig numeric;
alter table public.intake_order_line add column if not exists sale_fx_rate numeric;
alter table public.intake_order_line add column if not exists buy_currency text not null default 'KRW';
alter table public.intake_order_line add column if not exists buy_price_orig numeric;
alter table public.intake_order_line add column if not exists buy_fx_rate numeric;
alter table public.intake_order_line add column if not exists fx_month text not null default '';
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'intake_order_line_currency_check') then
    alter table public.intake_order_line add constraint intake_order_line_currency_check
      check (sale_currency in ('KRW', 'CNY', 'USD', 'JPY', 'EUR') and buy_currency in ('KRW', 'CNY', 'USD', 'JPY', 'EUR')
             and (fx_month = '' or fx_month ~ '^\d{4}-(0[1-9]|1[0-2])$'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'intake_order_line_sale_fx_check') then
    alter table public.intake_order_line add constraint intake_order_line_sale_fx_check
      check ((sale_currency = 'KRW' and sale_price_orig is null and sale_fx_rate is null)
          or (sale_currency <> 'KRW' and sale_price_orig > 0
              and ((unit_price is null and sale_fx_rate is null)
                or (sale_fx_rate > 0 and fx_month <> '' and unit_price = round(sale_price_orig * sale_fx_rate, 2)))));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'intake_order_line_buy_fx_check') then
    alter table public.intake_order_line add constraint intake_order_line_buy_fx_check
      check ((buy_currency = 'KRW' and buy_price_orig is null and buy_fx_rate is null)
          or (buy_currency <> 'KRW' and buy_price_orig > 0
              and ((buy_price is null and buy_fx_rate is null)
                or (buy_fx_rate > 0 and fx_month <> '' and buy_price = round(buy_price_orig * buy_fx_rate, 2)))));
  end if;
end $c$;

-- 월평균 환율 (기획서 11.15) — 찾는 순서: 직접입력 > 기준파일 > 자동(서울외국환중개). 같은 출처 · 통화 · 연월은 한 줄
--   rate — 고시 값(외화 1단위당 원, 엔화는 100엔당 — unit 100)
create table if not exists public.fx_rate (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null default auth.uid(),
  currency     text not null check (currency in ('CNY', 'USD', 'JPY', 'EUR')),
  rate_month   text not null check (rate_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  rate         numeric not null check (rate > 0),
  unit         int not null default 1 check (unit in (1, 100)),
  source       text not null check (source in ('직접입력', '기준파일', '자동(서울외국환중개)')),
  source_file  text not null default '',
  note         text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- ⚠ upsert 시 onConflict: 'owner_id,source,currency,rate_month'
  constraint fx_rate_key unique (owner_id, source, currency, rate_month)
);

-- 월별 수주 vs 매입 (기획서 11.13, 2026-09-30 세 번째 답변의 새 요청 — 화면 「월별 수주 vs 매입」, js/monthly.js 와 같은 계산)
--   month_basis  — due 납기월 | order 발주월. 날짜가 없는 줄은 month = '' 한 칸
--   sale_amount  — 수주금액 = 수량 × 판매단가(판매단가 있는 줄만), sale_none = 판매단가 없는 행 수
--   buy_amount   — 매입금액 = 수량 × 매입단가(매입단가 있는 줄만), buy_none = 매입단가 없는 행 수
--   diff · rate  — 두 단가가 모두 있는 줄끼리의 차액(수주 − 매입)과 차익률(%) — 한쪽만 있는 줄을 섞지 않는다
--   security_invoker 라 intake_order_line 의 RLS(본인 · 구성원 읽기)를 그대로 따른다. 표를 새로 만들지 않는다(계산 결과라 저장하지 않음)
create or replace view public.intake_monthly_summary with (security_invoker = true) as
with l as (
  select owner_id, batch_id, customer, kind, qty, due_date, order_date,
         case when unit_price is null then null else coalesce(amount, round(qty * unit_price, 2)) end as sale_amt,
         case when buy_price is null then null else coalesce(buy_amount, round(qty * buy_price, 2)) end as buy_amt,
         (unit_price is null and sale_price_orig is not null) as sale_fx0,   -- 외화인데 환율이 없어 금액에서 뺀 줄(기획서 11.15)
         (buy_price is null and buy_price_orig is not null)   as buy_fx0
  from public.intake_order_line
), m as (
  select owner_id, batch_id, 'due'::text as month_basis, to_char(due_date, 'YYYY-MM') as month, qty, sale_amt, buy_amt, sale_fx0, buy_fx0 from l
  union all
  select owner_id, batch_id, 'order'::text, coalesce(to_char(order_date, 'YYYY-MM'), ''), qty, sale_amt, buy_amt, sale_fx0, buy_fx0 from l
)
select owner_id, batch_id, month_basis, month,
       count(*)::int                                                         as row_count,
       sum(qty)                                                              as qty,
       coalesce(sum(sale_amt), 0)                                            as sale_amount,
       count(*) filter (where sale_amt is null and not sale_fx0)::int        as sale_none,
       coalesce(sum(buy_amt), 0)                                             as buy_amount,
       count(*) filter (where buy_amt is null and not buy_fx0)::int          as buy_none,
       count(*) filter (where sale_amt is not null and buy_amt is not null)::int as both_rows,
       sum(sale_amt - buy_amt) filter (where sale_amt is not null and buy_amt is not null) as diff,
       round(sum(sale_amt - buy_amt) filter (where sale_amt is not null and buy_amt is not null) * 100
             / nullif(sum(sale_amt) filter (where sale_amt is not null and buy_amt is not null), 0), 1) as rate,
       -- 비중(기획서 11.14) = 발주(매입)금액 합계 ÷ 수주금액 합계 × 100 — 단가가 한쪽만 있는 줄도 그쪽 합계에 넣음
       round(coalesce(sum(buy_amt), 0) * 100 / nullif(sum(sale_amt), 0), 1)  as share,
       -- 환율 없음(기획서 11.15): 외화인데 그 달 환율이 없어 금액에서 뺀 행 수 — 단가 없음과 따로 센다
       count(*) filter (where sale_fx0)::int                                 as sale_fx_none,
       count(*) filter (where buy_fx0)::int                                  as buy_fx_none
from m
group by owner_id, batch_id, month_basis, month;
revoke all on public.intake_monthly_summary from public, anon;
grant select on public.intake_monthly_summary to authenticated;

-- 파일별 집계
create table if not exists public.intake_file (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  batch_id    bigint not null references public.intake_batch(id) on delete cascade,
  file_name   text not null check (length(btrim(file_name)) > 0),
  file_type   text not null,        -- plan · short · direct · bobcatShort · bobcatPlan · bobcatDirect · shipplan · stock · po · pdf · unknown
  type_label  text not null default '',
  customer    text not null default '',
  plant       text not null default '',
  kind        text not null default '',
  read_rows   int not null default 0 check (read_rows >= 0),
  collected   int not null default 0 check (collected >= 0),
  excluded    jsonb not null default '{}'::jsonb check (jsonb_typeof(excluded) = 'object'),  -- {사유: 행 수}
  notes       text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- ⚠ upsert 시 onConflict: 'batch_id,file_name'
  constraint intake_file_batch_name_key unique (batch_id, file_name)
);

-- 「★확인 필요」
create table if not exists public.intake_check (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null default auth.uid(),
  batch_id     bigint not null references public.intake_batch(id) on delete cascade,
  source_file  text not null,
  source_row   text not null default '',
  reason       text not null check (length(btrim(reason)) > 0),
  detail       text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists intake_check_batch_idx on public.intake_check (batch_id);

-- ── 품번 매핑·ERP 업로드 (기획서 11.10) ────────────────────────────────────
-- 고객사 품번 → 천일품번. 매핑표 파일의 한 줄. 같은 고객사 품번이 서로 다른 천일품번으로 적힌 「충돌」은
-- 막지 않고 두 행으로 남긴다(도구가 경고하고 위쪽 행 = source_row 가 작은 쪽을 쓴다). 똑같은 줄 반복은 UNIQUE 가 막는다.
create table if not exists public.part_mapping (
  id            bigint generated always as identity primary key,
  owner_id      uuid not null default auth.uid(),
  map_group     text not null check (map_group in ('doosan', 'bobcat')),   -- doosan = 건기·엔진(AM·CKD 포함) / bobcat = 밥캣
  customer_pn   text not null check (length(btrim(customer_pn)) > 0),     -- 고객사 품번(대문자·공백 없앤 열쇠)
  company_pn    text not null check (length(btrim(company_pn)) > 0),      -- 천일품번
  source_file   text not null default '',
  source_row    int check (source_row > 0),
  chosen        boolean not null default false,   -- 충돌에서 사용자가 고른 값(고객사 품번마다 하나). 없으면 source_row 가 작은 쪽
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- ⚠ upsert 시 onConflict: 'owner_id,map_group,customer_pn,company_pn'
  constraint part_mapping_pair_key unique (owner_id, map_group, customer_pn, company_pn)
);
create index if not exists part_mapping_lookup_idx on public.part_mapping (owner_id, map_group, customer_pn);
alter table public.part_mapping add column if not exists chosen boolean not null default false;   -- 2026-09-30 충돌 고르기
create unique index if not exists part_mapping_chosen_uq on public.part_mapping (owner_id, map_group, customer_pn) where chosen;

-- 매입단가표 (price.js, 기획서 11.12) — 당사 → 생산처 발주단가. 수강생이 따로 관리하는 품목별 단가표를 옮긴 것.
-- 고객사 발주 단가(판매단가)와 무관하다. 통합 수주 줄의 buy_price 를 채운다.
--   price_kind  table = 매입단가표 파일의 한 줄 / manual = 화면 「매입단가 없음」 목록에 직접 적은 값(단가표에 없는 품목만 — 단가표가 우선)
--   item        당사 품목코드(천일품번). 매핑 없는 품번은 고객사 원품번(대문자·공백 없앤 열쇠)
--   maker       생산처(선택)
--   unit_price  매입단가
-- 2026-09-30 오전판은 「고객사 × 품목 → 고객 발주 단가를 채우는 표」였다(customer 칸). 뜻이 바뀌어 아래에서 옛 행을 지우고 칸을 뺀다.
create table if not exists public.price_master (
  id            bigint generated always as identity primary key,
  owner_id      uuid not null default auth.uid(),
  price_kind    text not null default 'table' check (price_kind in ('table', 'manual')),
  item          text not null check (length(btrim(item)) > 0),
  maker         text not null default '',
  unit_price    numeric not null check (unit_price > 0),
  currency      text not null default 'KRW',
  source_file   text not null default '',
  source_row    int check (source_row > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- ⚠ upsert 시 onConflict: 'owner_id,price_kind,item'
  constraint price_master_item_key unique (owner_id, price_kind, item)
);
-- 오전판 표가 이미 있으면: 옛 행(고객 발주 단가)은 매입단가가 아니므로 지우고, customer 칸을 빼고(그 칸이 든 UNIQUE 도 함께 빠짐), 새 UNIQUE 를 건다
do $c$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'price_master' and column_name = 'customer') then
    delete from public.price_master;
    alter table public.price_master drop column customer;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'price_master_item_key') then
    alter table public.price_master add constraint price_master_item_key unique (owner_id, price_kind, item);
  end if;
end $c$;
alter table public.price_master add column if not exists maker text not null default '';
create index if not exists price_master_lookup_idx on public.price_master (owner_id, item);
-- 매입단가표의 통화(기획서 11.15) — 칸은 처음부터 있었다(기본 KRW). 값을 KRW · CNY(China(RMB)) · USD · JPY · EUR 로 좁힌다.
-- 외화 매입단가는 통합 수주 줄에서 fx_rate 로 원화로 바꾼다(buy_price_orig · buy_fx_rate)
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'price_master_currency_check') then
    update public.price_master set currency = 'KRW' where currency not in ('KRW', 'CNY', 'USD', 'JPY', 'EUR');
    alter table public.price_master add constraint price_master_currency_check
      check (currency in ('KRW', 'CNY', 'USD', 'JPY', 'EUR'));
  end if;
end $c$;

-- ERP 업로드 양식 설정 (upload.js defaultOptions + 넣은 양식의 머리행) — 사용자당 한 행
create table if not exists public.upload_setting (
  owner_id          uuid primary key default auth.uid(),
  template_sheet    text not null default '웹자료올리기',
  template_headers  text[] not null default '{}',                      -- 비면 내장 기본 양식(17열)
  date_mode         text not null default 'today' check (date_mode in ('today', 'order', 'base')),
  date_format       text not null default 'compact' check (date_format in ('dash', 'compact')),  -- 확정(2026-09-30): 20260930
  seq_mode          text not null default 'row' check (seq_mode in ('row', 'party')),            -- 확정: 1, 2, 3 순차
  top_item          text not null default 'same' check (top_item in ('blank', 'same')),          -- 확정: 품목코드와 같은 값
  name_mode         text not null default 'order' check (name_mode in ('order', 'blank')),
  unmapped          text not null default 'keep' check (unmapped in ('skip', 'keep')),           -- 확정: 고객사 원품번 그대로
  price_col         text not null default 'none' check (price_col in ('add', 'none')),  -- 확정(2026-09-30 세 번째 답변): none 기존 17열 그대로 | add 「수량」 뒤에 「단가」(= 매입단가)
  manager           text not null default '',
  item_parties      jsonb not null default '{}'::jsonb check (jsonb_typeof(item_parties) = 'object'),  -- 확정: 품번별 수기입력 {품목코드: {code, name, manager}}
  parties           jsonb not null default '{}'::jsonb check (jsonb_typeof(parties) = 'object'),  -- 묶음 기본값(선택) {고객사 · 공장 · 구분: {code, name, manager}}
  fixed             jsonb not null default '{}'::jsonb check (jsonb_typeof(fixed) = 'object'),    -- {열 이름: 고정값}
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.upload_setting add column if not exists price_col text not null default 'add';   -- 2026-09-30 단가 열(매입단가)
-- 2026-09-30 두 번째 답변으로 확정한 기본값 — 이미 만들어진 표에도 반영(재실행 안전, 저장된 행은 그대로)
alter table public.upload_setting alter column date_format set default 'compact';
alter table public.upload_setting alter column top_item set default 'same';
alter table public.upload_setting alter column unmapped set default 'keep';
-- 2026-09-30 세 번째 답변: 업로드는 기존 17열 양식 그대로(단가 입력란 없음) — 기본값만 바꾸고 저장된 행은 그대로
alter table public.upload_setting alter column price_col set default 'none';
alter table public.upload_setting add column if not exists item_parties jsonb not null default '{}'::jsonb;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'upload_setting_price_col_check') then
    alter table public.upload_setting add constraint upload_setting_price_col_check check (price_col in ('add', 'none'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'upload_setting_item_parties_check') then
    alter table public.upload_setting add constraint upload_setting_item_parties_check check (jsonb_typeof(item_parties) = 'object');
  end if;
end $c$;

-- ----------------------------------------------------------------------------
-- 2. 함수 — search_path 고정
-- ----------------------------------------------------------------------------

-- 판정 함수. RLS 정책 식에서 쓴다. SECURITY DEFINER 라 app_members 의 RLS 를 거치지 않고
-- 읽는다(정책 안에서 같은 표의 정책을 다시 부르는 무한 재귀를 막는다).
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.app_members m where m.user_id = auth.uid());
$fn$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.app_members m where m.user_id = auth.uid() and m.role = 'admin');
$fn$;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

do $trg$
declare t text;
begin
  foreach t in array array['app_members', 'source_file', 'order_line', 'stock_line', 'shipment_line',
                           'column_mapping', 'app_settings', 'plan_edit', 'ai_note',
                           'intake_setting', 'intake_batch', 'intake_order_line', 'intake_file', 'intake_check',
                           'part_mapping', 'upload_setting', 'price_master', 'fx_rate']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_updated_at', t);
  end loop;
end;
$trg$;

-- ----------------------------------------------------------------------------
-- 3. RLS
-- ----------------------------------------------------------------------------

alter table public.app_members       enable row level security;
alter table public.source_file       enable row level security;
alter table public.order_line        enable row level security;
alter table public.stock_line        enable row level security;
alter table public.shipment_line     enable row level security;
alter table public.column_mapping    enable row level security;
alter table public.app_settings      enable row level security;
alter table public.plan_edit         enable row level security;
alter table public.ai_note           enable row level security;
alter table public.shipment_plan_log enable row level security;
alter table public.intake_setting    enable row level security;
alter table public.intake_batch      enable row level security;
alter table public.intake_order_line enable row level security;
alter table public.intake_file       enable row level security;
alter table public.intake_check      enable row level security;
alter table public.part_mapping      enable row level security;
alter table public.upload_setting    enable row level security;
alter table public.price_master      enable row level security;
alter table public.fx_rate           enable row level security;

-- 3-1. 팀 구성원 : 본인 행은 본인이 보고, 전체 목록과 등록·변경·해제는 admin 만
drop policy if exists app_members_select on public.app_members;
drop policy if exists app_members_insert on public.app_members;
drop policy if exists app_members_update on public.app_members;
drop policy if exists app_members_delete on public.app_members;
create policy app_members_select on public.app_members for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy app_members_insert on public.app_members for insert to authenticated
  with check (public.is_admin());
create policy app_members_update on public.app_members for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy app_members_delete on public.app_members for delete to authenticated
  using (public.is_admin());

-- 3-2. 부모·단독 표 : 읽기 = 본인 또는 팀 구성원 / 쓰기·수정·삭제 = 본인만
do $rls$
declare t text;
begin
  foreach t in array array['source_file', 'column_mapping', 'app_settings', 'plan_edit', 'ai_note',
                           'intake_setting', 'intake_batch', 'part_mapping', 'upload_setting', 'price_master', 'fx_rate']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid() or public.is_member())',
                   t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid())',
                   t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
                   t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())',
                   t || '_delete', t);
  end loop;
end;
$rls$;

-- 3-3. 행 표 : 위와 같고, 붙는 엑셀(source_file)이 본인 것이면서 종류(dataset)도 맞아야 한다
do $rls$
declare r record;
begin
  for r in
    select * from (values
      ('order_line',    'orders'),
      ('stock_line',    'stock'),
      ('shipment_line', 'shipments')
    ) as v(t, ds)
  loop
    execute format('drop policy if exists %I on public.%I', r.t || '_select', r.t);
    execute format('drop policy if exists %I on public.%I', r.t || '_insert', r.t);
    execute format('drop policy if exists %I on public.%I', r.t || '_update', r.t);
    execute format('drop policy if exists %I on public.%I', r.t || '_delete', r.t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid() or public.is_member())',
                   r.t || '_select', r.t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid() and exists (select 1 from public.source_file f where f.id = source_file_id and f.owner_id = auth.uid() and f.dataset = %L))',
                   r.t || '_insert', r.t, r.ds);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid() and exists (select 1 from public.source_file f where f.id = source_file_id and f.owner_id = auth.uid() and f.dataset = %L))',
                   r.t || '_update', r.t, r.ds);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())',
                   r.t || '_delete', r.t);
  end loop;
end;
$rls$;

-- 3-3b. 수주 취합 자식 표 : 붙는 취합(intake_batch)이 본인 것이어야 한다
do $rls$
declare t text;
begin
  foreach t in array array['intake_order_line', 'intake_file', 'intake_check']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid() or public.is_member())',
                   t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid() and exists (select 1 from public.intake_batch b where b.id = batch_id and b.owner_id = auth.uid()))',
                   t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid() and exists (select 1 from public.intake_batch b where b.id = batch_id and b.owner_id = auth.uid()))',
                   t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())',
                   t || '_delete', t);
  end loop;
end;
$rls$;

-- 3-4. 기록성 표 : 읽기(본인·팀)·추가(본인)만. 수정·삭제 정책을 두지 않아 사후 조작을 막는다.
drop policy if exists shipment_plan_log_select on public.shipment_plan_log;
drop policy if exists shipment_plan_log_insert on public.shipment_plan_log;
create policy shipment_plan_log_select on public.shipment_plan_log for select to authenticated
  using (owner_id = auth.uid() or public.is_member());
create policy shipment_plan_log_insert on public.shipment_plan_log for insert to authenticated
  with check (owner_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 4. 함수 실행 권한
--
--  GRANT 만으로는 제한되지 않는다. 권한이 두 겹으로 미리 붙는다.
--    ① PostgreSQL 이 함수 생성 시 PUBLIC 에 EXECUTE 기본 부여
--    ② Supabase 가 신규 함수마다 anon·authenticated·service_role 에 자동 부여
--  그래서 PUBLIC 과 anon 을 둘 다 끊고 authenticated 에만 다시 준다.
--
--  is_member()·is_admin() 은 RLS 정책 식에서 쓰지만, 그 정책이 전부 `to authenticated` 라
--  anon 요청에서는 평가되지 않는다. 그래서 anon EXECUTE 를 남길 필요가 없다.
--  (anon 에게도 열리는 정책을 새로 만들고 그 식에서 이 함수를 쓰게 되면
--   그때는 anon EXECUTE 를 다시 줘야 한다 — 안 주면 비로그인 조회가 통째로 오류가 난다)
-- ----------------------------------------------------------------------------

revoke all on function public.is_member()             from public, anon;
revoke all on function public.is_admin()              from public, anon;
revoke all on function public.valid_ship_rule(jsonb)  from public, anon;
revoke all on function public.set_updated_at()        from public, anon;

grant execute on function public.is_member()            to authenticated;
grant execute on function public.is_admin()             to authenticated;
-- CHECK 제약에서 쓰므로 app_settings 에 쓰는 사용자가 실행할 수 있어야 한다
grant execute on function public.valid_ship_rule(jsonb) to authenticated;
-- 트리거 전용 함수. 트리거 발화 시 호출자 EXECUTE 를 검사할 경우를 대비해 남긴다.
grant execute on function public.set_updated_at()       to authenticated;

-- ----------------------------------------------------------------------------
-- 끝. 첫 admin 등록 (SQL Editor 에서 한 번):
--   insert into public.app_members (user_id, role)
--   select id, 'admin' from auth.users where email = '<생산관리 담당자 이메일>'
--   on conflict (user_id) do update set role = 'admin';
-- ----------------------------------------------------------------------------
