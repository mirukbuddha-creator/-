# 재무회계팀 스케줄러

구글 캘린더(IPO일정·재무회계팀)를 실시간으로 읽어와, 각 일정에 **담당자·진행상태·구분·메모**를 붙여 팀이 함께 관리하는 웹앱입니다.

- 일정·날짜·반복 → **구글 캘린더**에서 관리 (원본)
- 담당자·진행상태 → **이 앱**에서 관리 (Supabase에 팀 공용 저장)

설정값(구글 클라이언트 ID, Supabase URL·키, 캘린더 ID)은 `src/config.js`에 이미 들어 있습니다.

---

## ✅ 배포 전 딱 한 가지 — Supabase 테이블 만들기

Supabase 프로젝트의 **SQL Editor**에 아래를 통째로 붙여넣고 **Run** 하세요. (한 번만)

```sql
-- 팀원 테이블
create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text,
  created_at timestamptz default now()
);

-- 일정별 관리정보 테이블
create table if not exists event_meta (
  event_id text primary key,
  calendar_id text,
  assignee uuid references members(id) on delete set null,
  status text default 'todo',
  category text,
  memo text,
  updated_at timestamptz default now()
);

-- 접근 정책 (내부 팀용: 공개키로 읽기/쓰기 허용)
alter table members enable row level security;
alter table event_meta enable row level security;
create policy "members all"    on members    for all using (true) with check (true);
create policy "event_meta all" on event_meta for all using (true) with check (true);
```

> 참고: 이 정책은 앱을 여는 사람이면 누구나 읽고 쓸 수 있게 한 v1 설정입니다. 내부 팀용으로는 충분하며, 나중에 더 엄격한 접근제어가 필요하면 알려주세요.

---

## 🚀 배포 (Vercel)

### 방법 A — GitHub 연동 (권장: 이후 자동 배포)
1. **github.com** 에서 새 저장소(repository) 생성
2. 이 폴더의 파일들을 그 저장소에 업로드 (웹에서 "Add file → Upload files"로 드래그 업로드 가능)
3. **vercel.com** 로그인 → **Add New → Project** → 그 저장소 **Import**
4. 별도 설정 없이 **Deploy** (Vercel이 Vite 프로젝트를 자동 인식합니다)
5. 배포 완료 후 나오는 주소(예: `https://team-scheduler.vercel.app`)를 복사

### 방법 B — 폴더 직접 업로드 (Vercel CLI)
터미널이 익숙하면: `npm i -g vercel` → 폴더에서 `vercel` 실행.

---

## 🔑 배포 후 마지막 연결 — 구글에 사이트 주소 등록

배포 주소가 나오면, **Google Cloud Console → 사용자 인증 정보 → (만든 OAuth 클라이언트) → 승인된 JavaScript 원본**에 그 주소를 추가하세요.

```
https://team-scheduler.vercel.app   ← 실제 배포 주소로
```

> 이걸 안 하면 그 주소에서 구글 로그인이 막힙니다. (개발용 http://localhost:5173 은 이미 등록돼 있어야 합니다.)

이후 그 주소로 들어가 **Google로 로그인**하면 캘린더가 뜹니다.
처음엔 "확인되지 않은 앱" 경고가 보일 수 있는데, **고급 → (앱 이름)(으)로 이동**을 누르면 됩니다 (테스트 모드라 정상).

---

## 💻 내 PC에서 먼저 테스트 (선택)

Node.js가 설치돼 있으면:

```bash
npm install
npm run dev
```

→ `http://localhost:5173` 에서 확인. (이 주소가 구글 "승인된 원본"에 등록돼 있어야 로그인됨)

---

## 🛠 앞으로 수정할 때

기능을 바꾸고 싶으면 말씀해 주세요. 수정된 코드를 드리고, GitHub 저장소에 반영하면 Vercel이 **1분 내 자동 재배포**합니다.
