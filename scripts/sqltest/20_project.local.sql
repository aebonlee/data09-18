-- ============================================================================
-- 로컬 검증 전용 — data09-18 프로젝트별 검증 (운영 실행 금지, 가드 내장)
--
--  사용자 A·B·비로그인(anon) 세 역할로 번갈아 들어가
--  RLS 격리 · 기록성 표 · 제약 · 함수 권한을 실제로 확인한다.
-- ============================================================================
do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'authenticator'))
     or exists (select 1 from pg_namespace where nspname = 'graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다. 운영 데이터베이스에서 실행할 수 없습니다.';
  end if;
end;
$guard$;

-- 보조 함수 — 이름이 _assert 로 시작해 공통 권한 검사에서 제외된다.
create or replace function public._assert_raises(p_sql text, p_state text, p_label text)
returns void language plpgsql set search_path = public as $fn$
declare v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    v_state := sqlstate;
  end;
  if v_state = p_state then raise notice '  OK   %', p_label;
  else raise exception 'FAIL  %  (기대 SQLSTATE %, 실제 %)', p_label, p_state, coalesce(v_state, '성공함');
  end if;
end;
$fn$;

create or replace function public._assert_rows(p_sql text, p_rows int, p_label text)
returns void language plpgsql set search_path = public as $fn$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  perform public._assert_eq(v_n, p_rows, p_label);
end;
$fn$;

-- A = 생산관리 담당자(admin) / B = 아직 구성원 아님 / C = 구매·물류 담당자(member, 읽기 전용)
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b@example.com'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c@example.com')
on conflict (id) do nothing;
-- 첫 admin 은 SQL Editor(= RLS 를 거치지 않는 postgres)에서 넣는다 — schema.sql 맨 아래 안내와 같은 방식
insert into public.app_members (user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'member')
on conflict (user_id) do nothing;

-- ── 재실행 안전 ────────────────────────────────────────────────
do $t$ begin raise notice '[프로젝트] 재적용 · 정책 수'; end $t$;
do $t$ begin
  perform public._assert_eq(
    (select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'),
    38, '두 번 적용해도 정책이 38개 그대로다');
  perform public._assert_eq(
    (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal),
    9, '두 번 적용해도 updated_at 트리거가 9개 그대로다');
  perform public._assert(public.valid_ship_rule('{"0": null, "1": 2, "2": 2, "3": 2, "4": 4, "5": 3, "6": null}'),
    '원문 입고 규칙(월~수 +2, 목 +4, 금 +3)은 올바른 규칙이다');
  perform public._assert(not public.valid_ship_rule('{"1": 61}'),  '61일 뒤 입고 규칙은 틀린 규칙이다');
  perform public._assert(not public.valid_ship_rule('{"7": 1}'),   '요일 7 은 없다');
  perform public._assert(not public.valid_ship_rule('{"1": 1.5}'), '일수는 정수여야 한다');
  perform public._assert(not public.valid_ship_rule('[1,2]'),      '규칙은 객체여야 한다');
end $t$;

-- ── 사용자 A (admin) ───────────────────────────────────────────
set role authenticated;
do $t$ begin perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false); end $t$;

do $t$ begin raise notice '[프로젝트] 사용자 A 입력 · 제약'; end $t$;
do $t$
declare v_ord bigint; v_stk bigint; v_shp bigint;
begin
  insert into public.source_file (dataset, file_name, sheet, header_row, mapping, is_sample)
    values ('orders', '예시_수주현황.xlsx', '수주', 0, '{"item":0,"dueDate":4,"qty":5}', true) returning id into v_ord;
  insert into public.source_file (dataset, file_name) values ('stock', '예시_재고현황.xlsx') returning id into v_stk;
  insert into public.source_file (dataset, file_name) values ('shipments', '예시_선적예정.xlsx') returning id into v_shp;
  perform set_config('test.a_ord', v_ord::text, false);
  perform set_config('test.a_shp', v_shp::text, false);

  insert into public.order_line (source_file_id, row_no, item, name, customer, order_date, due_date, qty) values
    (v_ord, 2, 'WH-100', '예시 하네스', '예시고객', '2026-09-01', '2026-10-05', 1200),
    (v_ord, 3, 'WH-200', '예시 하네스2', '예시고객', null, '2026-10-07', 300);
  insert into public.stock_line (source_file_id, row_no, item, current, available, safety) values
    (v_stk, 2, 'WH-100', 500, 450, 100);
  insert into public.shipment_line (source_file_id, row_no, item, ship_date, qty, file_arrival) values
    (v_shp, 2, 'WH-100', '2026-09-28', 400, '2026-09-30');
  insert into public.column_mapping (dataset, mapping) values ('orders', '{"item":"품번","dueDate":"납기일"}');
  insert into public.app_settings default values;
  insert into public.plan_edit (plan_id, ship_date, qty) values ('WH-100@2026-10-05', '2026-10-01', 350);
  insert into public.ai_note (answer) values ($ans$WH-100: 긴급
  첫 부족일 10/05, 선적 앞당김 필요$ans$);
  insert into public.shipment_plan_log (plan_id, item, need_date, ship_date, arrival, qty, status, late)
    values ('WH-100@2026-10-05', 'WH-100', '2026-10-05', '2026-10-01', '2026-10-03', 350, '긴급', false);

  perform public._assert_eq((select owner_id from public.source_file where id = v_ord),
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'owner_id 가 auth.uid() 로 자동으로 채워진다');
  perform public._assert_eq((select (rule->>'4')::int from public.app_settings), 4,
    '입고 규칙 기본값이 원문(목요일 선적 → +4일)과 같다');

  -- UNIQUE · upsert
  perform public._assert_raises(format(
    $q$insert into public.order_line (source_file_id, row_no, item, due_date, qty) values (%s, 2, 'X', '2026-10-01', 1)$q$, v_ord),
    '23505', '같은 파일의 같은 엑셀 행은 두 번 들어가지 않는다');
  insert into public.plan_edit (plan_id, qty) values ('WH-100@2026-10-05', 500)
    on conflict (owner_id, plan_id) do update set qty = excluded.qty;
  perform public._assert_eq((select qty from public.plan_edit where plan_id = 'WH-100@2026-10-05'),
    500::numeric, 'onConflict (owner_id, plan_id) upsert 가 갱신으로 동작한다');
  perform public._assert_raises(
    $q$insert into public.column_mapping (dataset) values ('orders')$q$,
    '23505', '열 연결은 자료 종류당 한 행이다');

  -- CHECK · NOT NULL (도구의 필수 칸)
  perform public._assert_raises(format(
    $q$insert into public.order_line (source_file_id, row_no, item, qty) values (%s, 9, 'X', 1)$q$, v_ord),
    '23502', '납기일이 없는 수주 행은 받지 않는다');
  perform public._assert_raises(format(
    $q$insert into public.order_line (source_file_id, row_no, item, due_date, qty) values (%s, 9, '  ', '2026-10-01', 1)$q$, v_ord),
    '23514', '품번이 빈 수주 행은 받지 않는다');
  perform public._assert_raises(format(
    $q$insert into public.shipment_line (source_file_id, row_no, item, ship_date, qty) values (%s, 9, 'X', '2026-10-01', -1)$q$, v_shp),
    '23514', '선적수량 음수는 받지 않는다');
  perform public._assert_raises(
    $q$insert into public.source_file (dataset, file_name) values ('bom', 'x.xlsx')$q$,
    '23514', '자료 종류는 orders/stock/shipments 만 받는다');
  perform public._assert_raises(
    $q$update public.app_settings set rule = '{"1": 99}'$q$,
    '23514', '틀린 입고 규칙은 CHECK 가 막는다');
  perform public._assert_raises(
    $q$update public.app_settings set stock_field = 'safety'$q$,
    '23514', '재고 기준 열은 current/available 만 받는다');
  perform public._assert_raises(
    $q$insert into public.plan_edit (plan_id) values ('WH-100')$q$,
    '23514', '선적계획 id 는 「품번@필요일」 형식이어야 한다');
  perform public._assert_raises(
    $q$insert into public.shipment_plan_log (plan_id, item, need_date, qty, status) values ('x@2026-10-01', 'x', '2026-10-01', 1, '보류')$q$,
    '23514', '상태는 정상·부족·주의·과잉·긴급만 받는다');

  -- 자식 행은 종류가 맞는 파일에만 붙는다
  perform public._assert_raises(format(
    $q$insert into public.order_line (source_file_id, row_no, item, due_date, qty) values (%s, 5, 'X', '2026-10-01', 1)$q$, v_shp),
    '42501', '수주 행을 선적예정 파일에 붙일 수 없다');

  update public.source_file set updated_at = '2000-01-01' where id = v_ord;
  perform public._assert((select updated_at > '2001-01-01' from public.source_file where id = v_ord),
    '수정하면 updated_at 트리거가 현재 시각으로 바꾼다');
end $t$;

do $t$ begin raise notice '[프로젝트] 기록성 표(shipment_plan_log)'; end $t$;
do $t$ begin
  perform public._assert_rows('update public.shipment_plan_log set qty = 0',
    0, 'shipment_plan_log 는 본인도 UPDATE 할 수 없다(0행)');
  perform public._assert_rows('delete from public.shipment_plan_log',
    0, 'shipment_plan_log 는 본인도 DELETE 할 수 없다(0행)');
  perform public._assert_eq((select qty from public.shipment_plan_log), 350::numeric,
    'shipment_plan_log 값이 그대로 남아 있다');
end $t$;

-- ── 사용자 B (구성원 아님) ─────────────────────────────────────
do $t$ begin perform set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false); end $t$;

do $t$ begin raise notice '[프로젝트] RLS — 구성원이 아닌 B 는 A 의 자료에 손대지 못한다'; end $t$;
do $t$
declare
  t text;
  v_ord text := current_setting('test.a_ord');
begin
  perform public._assert(not public.is_member(), 'B 는 구성원이 아니다');
  foreach t in array array['app_members', 'source_file', 'order_line', 'stock_line', 'shipment_line',
                           'column_mapping', 'app_settings', 'plan_edit', 'ai_note', 'shipment_plan_log']
  loop
    perform public._assert_rows(format('select 1 from public.%I', t), 0, 'B 에게 A 의 ' || t || ' 가 안 보인다');
  end loop;
  perform public._assert_rows('update public.order_line set qty = 0 where source_file_id = ' || v_ord,
    0, 'B 는 A 의 수주 행을 고칠 수 없다(0행)');
  perform public._assert_rows('delete from public.source_file where id = ' || v_ord,
    0, 'B 는 A 의 엑셀을 지울 수 없다(0행)');
  perform public._assert_raises(
    $q$insert into public.app_members (user_id, role) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin')$q$,
    '42501', 'B 는 스스로 admin 으로 등록할 수 없다');
  perform public._assert_raises(format(
    $q$insert into public.order_line (source_file_id, row_no, item, due_date, qty) values (%s, 50, 'X', '2026-10-01', 1)$q$, v_ord),
    '42501', 'B 는 A 의 엑셀에 수주 행을 끼워 넣을 수 없다');
  perform public._assert_raises(
    $q$insert into public.source_file (owner_id, dataset, file_name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'orders', '위장')$q$,
    '42501', 'B 는 owner_id 를 A 로 위장해 넣을 수 없다');
end $t$;

-- ── 사용자 C (member — 읽기 전용 팀원) ───────────────────────────
do $t$ begin perform set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', false); end $t$;

do $t$ begin raise notice '[프로젝트] 팀 공유 — 구성원 C 는 읽기만 한다'; end $t$;
do $t$
declare v_ord text := current_setting('test.a_ord');
begin
  perform public._assert(public.is_member() and not public.is_admin(), 'C 는 구성원이지만 admin 이 아니다');
  perform public._assert_rows('select 1 from public.order_line', 2, 'C 는 A 의 수주 행을 본다(팀 공유)');
  perform public._assert_rows('select 1 from public.shipment_plan_log', 1, 'C 는 A 가 확정한 선적계획 기록을 본다');
  perform public._assert_rows('select 1 from public.app_members', 1, 'C 는 구성원 명단 중 자기 행만 본다');
  perform public._assert_rows('update public.order_line set qty = 0',
    0, 'C 는 A 의 수주 행을 고칠 수 없다(0행)');
  perform public._assert_rows('delete from public.plan_edit',
    0, 'C 는 A 의 선적계획 수정을 지울 수 없다(0행)');
  perform public._assert_rows($q$update public.app_members set role = 'admin'$q$,
    0, 'C 는 자기 역할을 admin 으로 올릴 수 없다(0행)');
  perform public._assert_raises(format(
    $q$insert into public.order_line (source_file_id, row_no, item, due_date, qty) values (%s, 60, 'X', '2026-10-01', 1)$q$, v_ord),
    '42501', 'C 는 A 의 엑셀에 수주 행을 끼워 넣을 수 없다');
end $t$;

-- ── A 가 B 를 구성원으로 등록하면 B 도 볼 수 있다 ───────────────
do $t$ begin perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false); end $t$;
do $t$ begin raise notice '[프로젝트] admin 의 구성원 관리'; end $t$;
do $t$ begin
  perform public._assert_rows('select 1 from public.app_members', 2, 'admin A 는 구성원 명단 전체를 본다');
  insert into public.app_members (user_id, role) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'member');
  perform public._assert_raises(
    $q$update public.app_members set role = 'owner' where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$q$,
    '23514', '역할은 admin/member 만 받는다');
end $t$;
do $t$ begin perform set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false); end $t$;
do $t$ begin
  perform public._assert_rows('select 1 from public.order_line', 2, '등록된 뒤 B 는 A 의 수주 행을 본다');
end $t$;

-- ── 비로그인(anon) ─────────────────────────────────────────────
reset role;
set role anon;
do $t$ begin perform set_config('request.jwt.claim.sub', '', false); end $t$;

do $t$ begin raise notice '[프로젝트] anon 차단'; end $t$;
do $t$
declare t text;
begin
  foreach t in array array['app_members', 'source_file', 'order_line', 'stock_line', 'shipment_line',
                           'column_mapping', 'app_settings', 'plan_edit', 'ai_note', 'shipment_plan_log']
  loop
    perform public._assert_rows(format('select 1 from public.%I', t), 0, 'anon 에게 ' || t || ' 가 안 보인다');
  end loop;
  perform public._assert_raises($q$insert into public.source_file (dataset, file_name) values ('orders', 'x')$q$,
    '42501', 'anon 은 엑셀을 올릴 수 없다');
  perform public._assert_raises($q$insert into public.app_members (user_id) values ('dddddddd-dddd-dddd-dddd-dddddddddddd')$q$,
    '42501', 'anon 은 구성원을 등록할 수 없다');
  perform public._assert_raises($q$insert into public.shipment_plan_log (plan_id, item, need_date, qty, status) values ('x@2026-10-01', 'x', '2026-10-01', 1, '정상')$q$,
    '42501', 'anon 은 선적계획 기록을 쓸 수 없다');
  perform public._assert_raises($q$select public.is_admin()$q$,  '42501', 'anon 은 is_admin() 을 실행할 수 없다');
  perform public._assert_raises($q$select public.is_member()$q$, '42501', 'anon 은 is_member() 를 실행할 수 없다');
  perform public._assert_raises($q$select public.set_updated_at()$q$, '42501', 'anon 은 set_updated_at() 을 실행할 수 없다');
end $t$;

reset role;

-- ── 함수 ACL ───────────────────────────────────────────────────
do $t$ begin raise notice '[프로젝트] 함수 ACL (proacl)'; end $t$;
do $t$
declare v_bad text;
begin
  -- 이 스키마에는 anon 예외 함수가 없다(판정 함수를 쓰는 정책이 전부 to authenticated)
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
         lateral aclexplode(p.proacl) a
   where n.nspname = 'public' and p.proname not like '\_assert%'
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole);
  perform public._assert(v_bad is null,
    'proacl 에 PUBLIC·anon EXECUTE 가 없다' || coalesce(' (발견: ' || v_bad || ')', ''));
  perform public._assert(
    (select bool_and(proacl is not null) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname not like '\_assert%'),
    '모든 함수의 proacl 이 기본값(NULL=PUBLIC 실행)이 아니다');
  perform public._assert(
    (select bool_and(proconfig @> array['search_path=public'])
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname not like '\_assert%'),
    '모든 함수가 search_path = public 으로 고정돼 있다');
  -- anon 에게 열린 정책이 없는가 — 있다면 판정 함수의 anon EXECUTE 를 다시 검토해야 한다
  perform public._assert(
    not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
                 join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public'
                  and (p.polroles @> array[0::oid] or p.polroles @> array['anon'::regrole::oid])),
    'anon·PUBLIC 에 열린 정책이 없다(판정 함수의 anon EXECUTE 가 필요 없다)');
end $t$;

-- 정리
delete from public.shipment_plan_log;
delete from public.ai_note;
delete from public.plan_edit;
delete from public.app_settings;
delete from public.column_mapping;
delete from public.source_file;
delete from public.app_members;
delete from auth.users where email in ('a@example.com', 'b@example.com', 'c@example.com');

do $t$ begin raise notice ''; raise notice '전부 통과했습니다.'; end $t$;
