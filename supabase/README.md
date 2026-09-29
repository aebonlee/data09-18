# Supabase DB 스크립트 — 생산관리 선적계획 자동화

이 폴더에는 선적계획 도구의 자료를 데이터베이스(Supabase)에 저장할 때 쓰는 SQL 스크립트가 들어 있습니다.
지금 도구는 이 스크립트 없이도 그대로 동작합니다.
앱을 DB 에 연결하는 일은 다음 단계에서 진행합니다.

## 왜 DB 가 필요한가

지금 도구는 수주현황·재고현황·선적예정 엑셀, 열 연결, 설정, 선적계획 수정, AI 답변을 브라우저 저장소(localStorage)에만 둡니다.
이 방식에는 다음과 같은 한계가 있습니다.

- **계획을 담당자끼리 함께 볼 수 없습니다.** 기획서 2.1 의 목표는 선적계획을 「생산·구매·물류 담당자와 공유」하는 것이고, 8장 3단계는 「여러 사람이 같은 계획을 보는 공유 저장소」입니다. 지금은 엑셀로 내보내 따로 보내야 합니다.
- **엑셀 원본 표를 통째로 저장해 용량이 금방 찹니다.** 세 파일의 모든 칸이 한 저장소 키에 들어갑니다. 품번이 많아지면 저장이 멈출 수 있습니다.
- **확정한 계획이 남지 않습니다.** 새 파일을 올리면 이전 계획과 수정 내용이 사라집니다. 3단계의 「계획 대비 실적(실제 입고일·수량) 비교」를 하려면 확정한 계획을 쌓아 두어야 합니다.
- **다른 PC 에서는 처음부터 다시 올려야 합니다.**

## 테이블

| 테이블 | 용도 | localStorage 대응 (`data09-18.state`) |
|---|---|---|
| `app_members` | 팀 구성원과 역할(admin = 생산관리 담당자, member = 구매·물류 담당자) | 없음(새로 추가, 공유용) |
| `source_file` | 올린 엑셀 한 벌(자료 종류, 파일·시트 이름, 머리행, 열 번호 연결) | `tables.orders`·`tables.stock`·`tables.shipments` 의 `fileName`·`sheet`·`headerRow`·`mapping`, `_sample` |
| `order_line` | 수주현황 한 행(품번, 품명, 고객사, 수주일, 납기일, 수주수량) | `tables.orders.aoa` 를 행으로 푼 것 |
| `stock_line` | 재고현황 한 행(품번, 품명, 현재고, 가용재고, 안전재고) | `tables.stock.aoa` 를 행으로 푼 것 |
| `shipment_line` | 선적예정 한 행(품번, 품명, 중국 선적예정일, 선적수량, 파일의 한국 입고예정일) | `tables.shipments.aoa` 를 행으로 푼 것 |
| `column_mapping` | 표준 항목과 실제 열 이름의 연결(같은 양식 파일이면 자동 적용) | `savedMappings` |
| `app_settings` | 계산 설정(기준일, 재고 기준 열, 기본 안전재고, 요일별 입고 규칙, 휴일, 긴급·과잉 기준, 입고 여유일) | `settings` |
| `plan_edit` | 사용자가 고친 선적계획(선적일, 수량) | `planEdits` |
| `ai_note` | AI 분석 답변과 고객사·품명 포함 여부 | `ai` |
| `shipment_plan_log` | 확정·공유한 선적계획 기록(품번, 필요일, 선적일, 입고일, 수량, 상태) | 없음(새로 추가, 3단계용) |
| `intake_setting` | 수주 취합 규칙 설정(엔진 결품 납기 당김 일수, 결품·납품예정 겹침 처리, 직송 수집, 월 단위 칸, 발주서 시트, 고객사 이름) | `intakeOpts` |
| `intake_batch` | 파일 묶음을 한 번 취합한 결과(기준일, 그때 쓴 설정, 파일·행·★확인 건수) | `intake` 의 `base`·`options`·`sample` |
| `intake_order_line` | 통합 수주 표 한 행(고객사, 공장, 구분, 품목코드, 수량, 납기일, 원납기, 발주일, 원본파일·시트·행, 규칙, 비고) | `intake.rows` |
| `intake_file` | 파일별 집계(판별 종류, 읽은 행, 수집, 규칙으로 뺀 행과 사유, 메모) | `intake.files` |
| `intake_check` | 「★확인 필요」 한 줄(파일, 행, 내용, 자세히) | `intake.checks` |

지켜지는 규칙은 다음과 같습니다.

- 도구가 오류로 빼는 행(필수 칸인 품번·납기일·수주수량, 품번·현재고, 품번·선적예정일·선적수량이 비었거나 못 읽은 행)은 DB 도 받지 않습니다. 수량은 0 이상이어야 합니다.
- 수주 행은 orders 파일에만, 재고 행은 stock 파일에만, 선적 행은 shipments 파일에만 붙습니다.
- 입고 규칙은 요일(0=일 ~ 6=토)마다 0~60 정수 또는 비움(규칙 없음)이어야 합니다. 기본값은 원문 규칙(월~수 +2일, 목 +4일, 금 +3일)입니다.
- 선적계획 id 는 「품번@필요일」 형식, 상태는 정상·부족·주의·과잉·긴급 다섯 가지입니다.
- 통합 수주 줄은 수량이 0 보다 커야 하고(누적결품의 음수는 양수로 바꿔 넣습니다), 공장은 인천·군산·안산 또는 빈칸, 납기일은 반드시 있어야 합니다. 원본 한 행이 여러 줄이 될 수 있어(누적결품 날짜별 증가분, 날짜별 수량 발주서) 「원본 파일·시트·행 + 납기일」로 한 줄을 가립니다.
- 수주 취합 자식 표(`intake_order_line`·`intake_file`·`intake_check`)는 본인의 취합(`intake_batch`)에만 붙습니다.
- 앱에서 upsert 할 때 지정할 `onConflict` 값: 행 표 3개는 `source_file_id,row_no`, `plan_edit` 는 `owner_id,plan_id`, `column_mapping` 은 `owner_id,dataset`, `intake_order_line` 은 `batch_id,source_file,source_sheet,source_row,due_date`, `intake_file` 은 `batch_id,file_name`.

## 보안

- 모든 테이블에 행 수준 보안(RLS)이 켜져 있습니다.
- 자료는 올린 사람(`owner_id`)만 쓰고 고칩니다. `owner_id` 는 로그인한 사용자로 자동으로 채워집니다.
- 팀 구성원(`app_members` 에 등록된 사람)은 모든 자료를 **읽을** 수 있습니다. 구매·물류 담당자가 같은 계획을 보되 고치지는 못하게 한 것입니다.
- 구성원 등록·역할 변경·해제는 admin 만 합니다. 구성원이 스스로 admin 이 될 수 없습니다.
- 등록되지 않은 로그인 사용자는 남의 자료를 볼 수 없고, 로그인하지 않은 방문자(anon)는 아무것도 보거나 쓸 수 없습니다.
- `shipment_plan_log` 는 기록용이라 본인도 수정·삭제할 수 없습니다(추가·조회만 가능).
- 함수는 `search_path` 를 고정했고, 실행 권한을 로그인 사용자에게만 줍니다. 판정 함수 `is_member()`·`is_admin()` 은 로그인 사용자용 정책에서만 쓰므로 anon 실행 권한을 주지 않았습니다.

## 적용 방법

1. <https://supabase.com> 에 가입합니다.
2. 새 프로젝트(New project)를 만듭니다. 본인 계정의 본인 프로젝트에 적용합니다.
3. 왼쪽 메뉴에서 SQL Editor 를 엽니다.
4. `supabase/schema.sql` 파일 내용을 전부 복사해 붙여 넣습니다.
5. Run 을 눌러 실행합니다.
6. 생산관리 담당자가 한 번 로그인(가입)한 뒤, SQL Editor 에서 첫 admin 을 등록합니다.

   ```sql
   insert into public.app_members (user_id, role)
   select id, 'admin' from auth.users where email = '<생산관리 담당자 이메일>'
   on conflict (user_id) do update set role = 'admin';
   ```

   그다음 구성원은 admin 이 앱(연결 후) 또는 SQL Editor 에서 `role = 'member'` 로 등록합니다.

여러 번 실행해도 안전합니다. 이미 있는 테이블·정책은 건너뛰거나 새로 고쳐 만듭니다.

## 확인 방법

- Table Editor 에 위 표의 테이블 15개가 보이면 됩니다.
- Authentication → Policies 에서 15개 테이블 모두 RLS 가 켜져 있고 정책이 붙어 있는지 확인합니다.
- SQL Editor 에서 다음을 실행하면 정책 58개가 나와야 합니다.

  ```sql
  select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by 1, 2;
  ```

## 앱 연결은 다음 단계입니다

이번에는 스크립트만 저장했습니다.
도구의 `js/store.js` 는 아직 localStorage 를 씁니다.
연결할 때는 본인 프로젝트의 URL 과 anon 키를 받아 로그인 기능과 함께 붙입니다.

## 로컬 검증 방법

운영 DB 에 올리기 전에 내 컴퓨터의 임시 PostgreSQL 에서 스크립트를 실제로 적용해 확인할 수 있습니다.

```sh
./scripts/sqltest/run.sh
```

- PostgreSQL 16·17 이 필요합니다(macOS: `brew install postgresql@17`).
- 임시 데이터베이스를 만들어 쓰고 끝나면 지우므로 기존 설치에 영향이 없습니다.
- 스키마를 두 번 적용해 재실행 안전성을 보고, admin·구성원·비구성원·비로그인 네 역할로 RLS 격리·팀 공유·기록성 표·제약·함수 권한을 확인합니다.
- 마지막에 「SQL 검증 통과.」가 나오면 성공입니다.
- `scripts/sqltest/*.local.sql` 은 로컬 검증 전용입니다. Supabase SQL Editor 에서 실행하면 스스로 멈추도록 가드가 들어 있습니다.
