import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Calendar, List, LayoutDashboard, Users, RefreshCw, Plus, X, Trash2,
  ChevronLeft, ChevronRight, Clock, AlertTriangle, CheckCircle2, Circle,
  Loader2, PauseCircle, LogIn, ExternalLink, Repeat, MessageSquare,
} from "lucide-react";
import { supabase } from "./supabase";
import { loadGoogle, requestToken, fetchEvents, fetchUserEmail } from "./googleCalendar";
import { CALENDARS, MONTHS_AHEAD } from "./config";

const FONT_LINK = "";

const STATUS = {
  todo:  { label: "대기",   color: "#9a9488", bg: "#ece8df", icon: Circle },
  doing: { label: "진행중", color: "#b06a1e", bg: "#f6e6d2", icon: Loader2 },
  done:  { label: "완료",   color: "#3f6f53", bg: "#dcebe0", icon: CheckCircle2 },
  hold:  { label: "보류",   color: "#7a7a8c", bg: "#e4e2ec", icon: PauseCircle },
};
const STATUS_ORDER = ["todo", "doing", "done", "hold"];

const CATEGORY = {
  close:  { label: "결산",   color: "#0f5e5a" },
  ipo:    { label: "공모주", color: "#7a4ea8" },
  report: { label: "보고",   color: "#b06a1e" },
  tax:    { label: "세무",   color: "#3f6f53" },
  etc:    { label: "기타",   color: "#8a8478" },
};

const MEMBER_COLORS = ["#0f5e5a","#b06a1e","#7a4ea8","#b3402f","#3f6f53","#2d5b8a","#a8487a","#6b7a2d"];
const WEEKDAYS = ["일","월","화","수","목","금","토"];

// ---- 유틸 ----
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
const shiftDay = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const fmtMonth = (d) => `${d.getFullYear()}년 ${d.getMonth() + 1}월`;

function eventDate(side) {
  if (!side) return null;
  if (side.date) return side.date.slice(0, 10);
  if (side.dateTime) return side.dateTime.slice(0, 10);
  return null;
}
function normalizeEvent(ev, cal) {
  const start = eventDate(ev.start);
  let due = eventDate(ev.end);
  if (ev.end?.date && due) due = shiftDay(due, -1); // 종일 일정 종료는 배타적이라 하루 빼기
  if (!due || due < start) due = start;
  return {
    id: ev.id,
    calendarId: cal.id,
    calName: cal.name,
    calColor: cal.color,
    defaultCategory: cal.defaultCategory,
    title: ev.summary || "(제목 없음)",
    start, due,
    time: ev.start?.dateTime ? ev.start.dateTime.slice(11, 16) : null,
    recurring: !!ev.recurringEventId,
    htmlLink: ev.htmlLink,
  };
}

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [booting, setBooting] = useState(false);
  const [error, setError] = useState(null);
  const [events, setEvents] = useState([]);
  const [meta, setMeta] = useState({});
  const [members, setMembers] = useState([]);
  const [view, setView] = useState("dashboard");
  const [cursor, setCursor] = useState(new Date());
  const [filterMember, setFilterMember] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCal, setFilterCal] = useState("all");
  const [taskModal, setTaskModal] = useState(null);
  const [memberModal, setMemberModal] = useState(false);
  const [syncedAt, setSyncedAt] = useState(null);
  const [directives, setDirectives] = useState([]);
  const [userEmail, setUserEmail] = useState(null);

  // ---- 로드 ----
  const loadAll = useCallback(async () => {
    const now = new Date();
    const timeMin = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const timeMax = new Date(now.getFullYear(), now.getMonth() + MONTHS_AHEAD, 1).toISOString();
    let all = [];
    for (const cal of CALENDARS) {
      const items = await fetchEvents(cal.id, timeMin, timeMax);
      all = all.concat(items.map((ev) => normalizeEvent(ev, cal)));
    }
    all.sort((a, b) => a.start.localeCompare(b.start));
    setEvents(all);

    const { data: metaRows } = await supabase.from("event_meta").select("*");
    const m = {};
    (metaRows || []).forEach((r) => { m[r.event_id] = r; });
    setMeta(m);

    const { data: memRows } = await supabase.from("members").select("*").order("created_at");
    setMembers(memRows || []);

    const { data: dirRows } = await supabase.from("directives").select("*").order("created_at", { ascending: false });
    setDirectives(dirRows || []);
    setSyncedAt(Date.now());
  }, []);

  const signIn = async () => {
    setBooting(true); setError(null);
    try {
      await loadGoogle();
      await requestToken({ prompt: "" });
      setAuthed(true);
      const email = await fetchUserEmail();
      setUserEmail(email);
      await loadAll();
    } catch (e) {
      console.error(e);
      setError("구글 로그인 또는 캘린더 조회에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setBooting(false);
    }
  };

  const refresh = async () => {
    setBooting(true); setError(null);
    try {
      try { await requestToken({ prompt: "" }); } catch { /* 토큰 유효하면 통과 */ }
      await loadAll();
    } catch (e) {
      if (e?.status === 401) { setAuthed(false); setError("세션이 만료됐습니다. 다시 로그인해 주세요."); }
      else setError("새로고침에 실패했습니다.");
    } finally {
      setBooting(false);
    }
  };

  // 자동 동기화 (5분마다)
  useEffect(() => {
    if (!authed) return;
    const id = setInterval(() => { if (!document.hidden) refresh(); }, 300000);
    return () => clearInterval(id);
  }, [authed]); // eslint-disable-line

  const memberById = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members]);

  // 이벤트 + 메타 병합
  const tasks = useMemo(() => events.map((ev) => {
    const m = meta[ev.id] || {};
    return {
      ...ev,
      status: m.status || "todo",
      assignee: m.assignee || null,
      category: m.category || ev.defaultCategory || "etc",
      memo: m.memo || "",
    };
  }), [events, meta]);

  const filtered = useMemo(() => tasks.filter((t) => {
    if (filterMember !== "all" && t.assignee !== filterMember) return false;
    if (filterStatus !== "all" && t.status !== filterStatus) return false;
    if (filterCal !== "all" && t.calendarId !== filterCal) return false;
    return true;
  }), [tasks, filterMember, filterStatus, filterCal]);

  // ---- 메타 저장 ----
  const saveMeta = async (task, patch) => {
    const row = {
      event_id: task.id,
      calendar_id: task.calendarId,
      status: task.status,
      assignee: task.assignee,
      category: task.category,
      memo: task.memo,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    setMeta((prev) => ({ ...prev, [task.id]: { ...prev[task.id], ...row } }));
    const { error } = await supabase.from("event_meta").upsert(row, { onConflict: "event_id" });
    if (error) console.error("저장 실패", error);
  };

  const cycleStatus = (task) => {
    const i = STATUS_ORDER.indexOf(task.status);
    saveMeta(task, { status: STATUS_ORDER[(i + 1) % STATUS_ORDER.length] });
  };

  // ---- 팀장 지시사항 ----
  const addDirective = async ({ content, urgency, due_date }) => {
    if (!content.trim()) return;
    const row = { content: content.trim(), urgency, done: false, created_at: new Date().toISOString(), created_by: userEmail, due_date: due_date || null };
    const { data, error } = await supabase.from("directives").insert(row).select().single();
    if (error) { console.error("지시사항 저장 실패", error); setError("지시사항 저장에 실패했습니다: " + error.message); return; }
    if (data) setDirectives((p) => [data, ...p]);
  };
  const toggleDirective = async (id, done) => {
    const { error } = await supabase.from("directives").update({ done }).eq("id", id);
    if (error) { console.error("지시사항 업데이트 실패", error); return; }
    setDirectives((p) => p.map((d) => d.id === id ? { ...d, done } : d));
  };
  const removeDirective = async (id) => {
    const { error } = await supabase.from("directives").delete().eq("id", id);
    if (error) { console.error("지시사항 삭제 실패", error); return; }
    setDirectives((p) => p.filter((d) => d.id !== id));
  };

  // ---- 팀원 ----
  const addMember = async (name) => {
    if (!name.trim()) return;
    const color = MEMBER_COLORS[members.length % MEMBER_COLORS.length];
    const { data } = await supabase.from("members").insert({ name: name.trim(), color }).select().single();
    if (data) setMembers((p) => [...p, data]);
  };
  const removeMember = async (id) => {
    await supabase.from("members").delete().eq("id", id);
    setMembers((p) => p.filter((m) => m.id !== id));
  };

  // ---- 로그인 화면 ----
  if (!authed) {
    return (
      <div style={{ ...wrap, display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <style>{FONT_LINK}{globalCss}</style>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <h1 style={{ ...title, fontSize: 34 }}>재무회계팀 스케줄러</h1>
          <p style={{ ...sub, marginBottom: 28 }}>구글 캘린더(IPO일정·재무회계팀)를 불러옵니다.</p>
          <button className="sch-btn" style={{ ...primaryBtn, padding: "12px 22px", fontSize: 15 }}
            onClick={signIn} disabled={booting}>
            {booting ? <Loader2 size={17} style={{ animation: "spin 1s linear infinite" }} /> : <LogIn size={17} />}
            Google로 로그인
          </button>
          {error && <p style={{ color: "#b3402f", fontSize: 13, marginTop: 16 }}>{error}</p>}
          <p style={{ fontSize: 11.5, color: "#bdb6a6", marginTop: 24, lineHeight: 1.6 }}>
            테스트 모드라 7일에 한 번 재로그인이 필요할 수 있습니다.<br />처음 로그인 시 "확인되지 않은 앱" 경고가 떠도 정상이며, 고급 → 계속을 누르면 됩니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <style>{FONT_LINK}{globalCss}</style>

      <header style={header}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h1 style={title}>재무회계팀 스케줄러</h1>
            <span style={sharedPill}><Repeat size={11} /> 캘린더 연동</span>
          </div>
          <p style={sub}>
            구글 캘린더 실시간 연동
            {syncedAt && <span style={{ color: "#bdb6a6" }}>　·　{new Date(syncedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 동기화</span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sch-btn" style={navBtn} onClick={refresh} title="새로고침">
            <RefreshCw size={15} style={booting ? { animation: "spin 1s linear infinite" } : {}} />
          </button>
          <button className="sch-btn" style={ghostBtn} onClick={() => setMemberModal(true)}>
            <Users size={15} /> 팀원
          </button>
        </div>
      </header>

      {error && <div style={errorBar}>{error}</div>}

      <nav style={tabs}>
        {[["dashboard","대시보드",LayoutDashboard],["calendar","캘린더",Calendar],["list","목록",List]].map(([k,lbl,Icon]) => (
          <button key={k} className="sch-btn" onClick={() => setView(k)}
            style={{ ...tab, ...(view === k ? tabActive : {}) }}>
            <Icon size={15} /> {lbl}
          </button>
        ))}
      </nav>

      {view !== "dashboard" && (
        <div style={filterBar}>
          <Filter label="담당자" value={filterMember} onChange={setFilterMember}
            options={[["all","전체"],["",  "미배정"], ...members.map((m) => [m.id, m.name])]} />
          <Filter label="상태" value={filterStatus} onChange={setFilterStatus}
            options={[["all","전체"], ...STATUS_ORDER.map((s) => [s, STATUS[s].label])]} />
          <Filter label="캘린더" value={filterCal} onChange={setFilterCal}
            options={[["all","전체"], ...CALENDARS.map((c) => [c.id, c.name])]} />
        </div>
      )}

      <main style={{ marginTop: 18 }}>
        {view === "dashboard" && <Dashboard tasks={tasks} members={members} memberById={memberById} onOpen={setTaskModal} directives={directives} onAddDirective={addDirective} onToggleDirective={toggleDirective} onRemoveDirective={removeDirective} userEmail={userEmail} />}
        {view === "calendar" && <CalendarView tasks={filtered} cursor={cursor} setCursor={setCursor} memberById={memberById} onOpen={setTaskModal} />}
        {view === "list" && <ListView tasks={filtered} memberById={memberById} onOpen={setTaskModal} onCycle={cycleStatus} />}
      </main>

      {taskModal && (
        <TaskModal task={tasks.find((t) => t.id === taskModal.id) || taskModal}
          members={members} onSave={saveMeta} onClose={() => setTaskModal(null)} />
      )}
      {memberModal && (
        <MemberModal members={members} onAdd={addMember} onRemove={removeMember} onClose={() => setMemberModal(false)} />
      )}

      <div style={{ marginTop: 22, fontSize: 11.5, color: "#bdb6a6", textAlign: "center" }}>
        일정 입력·수정은 구글 캘린더에서 / 담당자·진행상태는 여기서 관리합니다.
      </div>
    </div>
  );
}

// ---------- 대시보드 ----------
function Dashboard({ tasks, members, memberById, onOpen, directives, onAddDirective, onToggleDirective, onRemoveDirective, userEmail }) {
  const [showDone, setShowDone] = useState(false);
  const today = todayISO();
  const counts = STATUS_ORDER.map((s) => ({ key: s, ...STATUS[s], n: tasks.filter((t) => t.status === s).length }));
  const upcoming = tasks.filter((t) => t.status !== "done" && t.due >= today && daysBetween(today, t.due) <= 10).sort((a,b) => a.due.localeCompare(b.due));
  const overdue = tasks.filter((t) => t.status !== "done" && t.due < today).sort((a,b) => a.due.localeCompare(b.due));
  const doneList = tasks.filter((t) => t.status === "done").sort((a,b) => b.due.localeCompare(a.due));

  return (
    <div style={{ animation: "fadeUp .3s ease" }}>
      <DirectivesPanel directives={directives} onAdd={onAddDirective} onToggle={onToggleDirective} onRemove={onRemoveDirective} userEmail={userEmail} />
      <div style={statGrid}>
        {counts.map((c) => {
          const Icon = c.icon; const clickable = c.key === "done";
          return (
            <div key={c.key} className={clickable ? "sch-card" : ""}
              onClick={clickable ? () => setShowDone((v) => !v) : undefined}
              style={{ ...statCard, borderTopColor: c.color, cursor: clickable ? "pointer" : "default", ...(clickable && showDone ? { background: "#f1f5ef" } : {}) }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "#8a8478", fontWeight: 500 }}>{c.label}</span>
                <Icon size={16} style={{ color: c.color }} />
              </div>
              <div style={{ fontFamily: "'Malgun Gothic','맑은 고딕',sans-serif", fontSize: 38, fontWeight: 600, color: "#2a241b", lineHeight: 1 }}>{c.n}</div>
              {clickable && <span style={{ fontSize: 11, color: "#3f6f53", fontWeight: 600 }}>{showDone ? "접기 ▲" : "완료 보기 ▼"}</span>}
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 18 }}>
        <Panel title="마감 임박 (D-10)" icon={Clock}>
          {upcoming.length === 0 && <Empty>10일 내 마감 예정이 없습니다.</Empty>}
          {upcoming.map((t) => {
            const d = daysBetween(today, t.due);
            return <Row key={t.id} task={t} member={memberById[t.assignee]} onOpen={onOpen}
              right={<span style={{ fontSize: 12, fontWeight: 600, color: d <= 3 ? "#b3402f" : "#8a8478" }}>{d === 0 ? "오늘" : `D-${d}`}</span>} />;
          })}
        </Panel>
        <Panel title="지연" icon={AlertTriangle} accent="#b3402f">
          {overdue.length === 0 && <Empty>지연된 업무가 없습니다. 👍</Empty>}
          {overdue.map((t) => (
            <Row key={t.id} task={t} member={memberById[t.assignee]} onOpen={onOpen}
              right={<span style={{ fontSize: 12, fontWeight: 600, color: "#b3402f" }}>{Math.abs(daysBetween(today, t.due))}일 지남</span>} />
          ))}
        </Panel>
      </div>

      {showDone && (
        <div style={{ marginTop: 18, animation: "fadeUp .25s ease" }}>
          <Panel title="완료된 업무" icon={CheckCircle2} accent="#3f6f53">
            {doneList.length === 0 && <Empty>완료된 업무가 없습니다.</Empty>}
            {doneList.map((t) => (
              <Row key={t.id} task={t} member={memberById[t.assignee]} onOpen={onOpen}
                right={<span style={{ fontSize: 12, fontWeight: 600, color: "#3f6f53" }}>완료</span>} />
            ))}
          </Panel>
        </div>
      )}

      <div style={{ marginTop: 18, fontSize: 12, color: "#a8a292", textAlign: "center" }}>
        팀원 {members.length}명 · 표시 중인 일정 {tasks.length}건
      </div>
    </div>
  );
}

// ---------- 캘린더 ----------
function CalendarView({ tasks, cursor, setCursor, memberById, onOpen }) {
  const y = cursor.getFullYear(), m = cursor.getMonth();
  const startPad = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const today = todayISO();
  const tasksOn = (d) => {
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return tasks.filter((t) => iso >= t.start && iso <= t.due);
  };

  return (
    <div style={{ animation: "fadeUp .3s ease" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18, marginBottom: 14 }}>
        <button className="sch-btn" style={navBtn} onClick={() => setCursor(new Date(y, m - 1, 1))}><ChevronLeft size={18} /></button>
        <h2 style={{ fontFamily: "'Malgun Gothic','맑은 고딕',sans-serif", fontSize: 24, fontWeight: 600, color: "#2a241b", margin: 0, minWidth: 150, textAlign: "center" }}>{fmtMonth(cursor)}</h2>
        <button className="sch-btn" style={navBtn} onClick={() => setCursor(new Date(y, m + 1, 1))}><ChevronRight size={18} /></button>
        <button className="sch-btn" style={{ ...ghostBtn, padding: "6px 12px", fontSize: 12 }} onClick={() => setCursor(new Date())}>오늘</button>
      </div>
      <div style={calGrid}>
        {WEEKDAYS.map((w, i) => <div key={w} style={{ ...calHead, color: i === 0 ? "#b3402f" : i === 6 ? "#2d5b8a" : "#8a8478" }}>{w}</div>)}
        {cells.map((d, i) => {
          const iso = d ? `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
          const dayTasks = d ? tasksOn(d) : [];
          return (
            <div key={i} className={d ? "sch-day" : ""} style={{ ...calCell, background: d ? "#fbfaf6" : "transparent" }}>
              {d && (
                <>
                  <span style={{ fontSize: 12, fontWeight: 600, color: i % 7 === 0 ? "#b3402f" : i % 7 === 6 ? "#2d5b8a" : "#6a6458",
                    ...(iso === today ? { background: "#2a241b", color: "#fff", borderRadius: 99, width: 20, height: 20, display: "inline-grid", placeItems: "center" } : {}) }}>{d}</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
                    {dayTasks.slice(0, 3).map((t) => {
                      const mem = memberById[t.assignee];
                      return (
                        <div key={t.id} onClick={() => onOpen(t)} className="sch-btn"
                          style={{ fontSize: 10.5, padding: "2px 5px", borderRadius: 4, background: STATUS[t.status].bg, color: "#3a342a",
                            borderLeft: `3px solid ${CATEGORY[t.category].color}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                            textDecoration: t.status === "done" ? "line-through" : "none", opacity: t.status === "done" ? 0.55 : 1 }}>
                          {mem && <span style={{ color: mem.color, fontWeight: 700 }}>● </span>}{t.title}
                        </div>
                      );
                    })}
                    {dayTasks.length > 3 && <span style={{ fontSize: 10, color: "#a8a292" }}>+{dayTasks.length - 3}건</span>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- 목록 ----------
function ListView({ tasks, memberById, onOpen, onCycle }) {
  const sorted = [...tasks].sort((a, b) => a.start.localeCompare(b.start));
  return (
    <div style={{ animation: "fadeUp .3s ease", display: "flex", flexDirection: "column", gap: 8 }}>
      {sorted.length === 0 && <Empty>표시할 일정이 없습니다.</Empty>}
      {sorted.map((t) => {
        const mem = memberById[t.assignee]; const st = STATUS[t.status]; const cat = CATEGORY[t.category];
        const StIcon = st.icon;
        return (
          <div key={t.id} className="sch-card" style={listRow}>
            <button className="sch-btn" onClick={() => onCycle(t)} title="상태 변경" style={{ ...iconBtn, color: st.color }}>
              <StIcon size={18} style={t.status === "doing" ? { animation: "spin 1.6s linear infinite" } : {}} />
            </button>
            <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => onOpen(t)}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontWeight: 600, color: "#2a241b", textDecoration: t.status === "done" ? "line-through" : "none", opacity: t.status === "done" ? 0.55 : 1 }}>{t.title}</span>
                {t.recurring && <Repeat size={12} style={{ color: "#bdb6a6" }} />}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
                <Tag color={cat.color}>{cat.label}</Tag>
                <span style={{ fontSize: 12, color: mem?.color ?? "#bdb6a6", fontWeight: 500 }}>{mem?.name ?? "미배정"}</span>
                <span style={{ fontSize: 12, color: "#a8a292" }}>{t.start === t.due ? t.start : `${t.start} ~ ${t.due}`}{t.time ? ` ${t.time}` : ""}</span>
                <span style={{ fontSize: 11, color: t.calColor }}>· {t.calName}</span>
              </div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, color: st.color, background: st.bg, padding: "3px 9px", borderRadius: 99 }}>{st.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------- 업무 메타 모달 ----------
function TaskModal({ task, members, onSave, onClose }) {
  const [f, setF] = useState({ status: task.status, assignee: task.assignee, category: task.category, memo: task.memo });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Overlay onClose={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalHead}>
          <h3 style={{ fontFamily: "'Malgun Gothic','맑은 고딕',sans-serif", fontSize: 19, margin: 0, color: "#2a241b", paddingRight: 10 }}>{task.title}</h3>
          <button className="sch-btn" style={iconBtn} onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ fontSize: 12.5, color: "#a8a292", marginBottom: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span>{task.start === task.due ? task.start : `${task.start} ~ ${task.due}`}{task.time ? ` ${task.time}` : ""}</span>
          <span style={{ color: task.calColor }}>· {task.calName}</span>
          {task.recurring && <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Repeat size={11} /> 반복</span>}
          {task.htmlLink && <a href={task.htmlLink} target="_blank" rel="noreferrer" style={{ color: "#2d5b8a", display: "inline-flex", alignItems: "center", gap: 3 }}>캘린더에서 열기 <ExternalLink size={11} /></a>}
        </div>
        <p style={{ fontSize: 11.5, color: "#bdb6a6", marginTop: -6, marginBottom: 16 }}>※ 일정명·날짜는 구글 캘린더에서 수정합니다. 여기서는 관리 정보만 변경됩니다.</p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="담당자">
            <select value={f.assignee ?? ""} onChange={(e) => set("assignee", e.target.value || null)} style={input}>
              <option value="">미배정</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <Field label="구분">
            <select value={f.category} onChange={(e) => set("category", e.target.value)} style={input}>
              {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="진행상태">
          <select value={f.status} onChange={(e) => set("status", e.target.value)} style={input}>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </select>
        </Field>
        <Field label="메모">
          <textarea value={f.memo} onChange={(e) => set("memo", e.target.value)} rows={3} placeholder="체크포인트, 참고사항 등" style={{ ...input, resize: "vertical", fontFamily: "'Malgun Gothic','맑은 고딕',sans-serif" }} />
        </Field>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button className="sch-btn" style={ghostBtn} onClick={onClose}>취소</button>
          <button className="sch-btn" style={primaryBtn} onClick={() => { onSave(task, f); onClose(); }}>저장</button>
        </div>
      </div>
    </Overlay>
  );
}

// ---------- 팀원 모달 ----------
function MemberModal({ members, onAdd, onRemove, onClose }) {
  const [name, setName] = useState("");
  const submit = () => { onAdd(name); setName(""); };
  return (
    <Overlay onClose={onClose}>
      <div style={{ ...modal, maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHead}>
          <h3 style={{ fontFamily: "'Malgun Gothic','맑은 고딕',sans-serif", fontSize: 20, margin: 0, color: "#2a241b" }}>팀원 관리</h3>
          <button className="sch-btn" style={iconBtn} onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {members.length === 0 && <Empty small>등록된 팀원이 없습니다.</Empty>}
          {members.map((m) => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#fbfaf6", borderRadius: 8 }}>
              <span style={{ width: 12, height: 12, borderRadius: 99, background: m.color }} />
              <span style={{ flex: 1, fontWeight: 500, color: "#2a241b" }}>{m.name}</span>
              <button className="sch-btn" style={iconBtn} onClick={() => onRemove(m.id)}><Trash2 size={15} style={{ color: "#c4bdae" }} /></button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="팀원 이름" style={{ ...input, flex: 1 }} />
          <button className="sch-btn" style={primaryBtn} onClick={submit}><Plus size={16} /> 추가</button>
        </div>
      </div>
    </Overlay>
  );
}

// ---------- 기타업무사항 패널 ----------
const URGENCY = {
  urgent: { label: "긴급", color: "#b3402f", bg: "#f6e0dc" },
  normal: { label: "일반", color: "#8a8478", bg: "#ece8df" },
};

function DirectivesPanel({ directives, onAdd, onToggle, onRemove, userEmail }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [urgency, setUrgency] = useState("normal");
  const [dueDate, setDueDate] = useState("");
  const active = directives.filter((d) => !d.done);
  const done = directives.filter((d) => d.done);

  const submit = () => {
    if (!content.trim()) return;
    onAdd({ content, urgency, due_date: dueDate });
    setContent(""); setUrgency("normal"); setDueDate(""); setOpen(false);
  };

  return (
    <div style={{ marginBottom: 22, background: "#fbfaf6", border: "1px solid #ece8df", borderTop: "3px solid #2a241b", borderRadius: 12, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: active.length > 0 || done.length > 0 || open ? 14 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MessageSquare size={16} style={{ color: "#2a241b" }} />
          <span style={{ fontWeight: 600, color: "#2a241b", fontSize: 15 }}>기타업무사항</span>
          {active.length > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "#b3402f", borderRadius: 99, padding: "1px 7px" }}>{active.length}</span>}
        </div>
        <button className="sch-btn" style={{ ...ghostBtn, padding: "6px 12px", fontSize: 12 }} onClick={() => setOpen((v) => !v)}>
          <Plus size={13} /> {open ? "취소" : "추가"}
        </button>
      </div>

      {open && (
        <div style={{ marginBottom: 14, padding: 14, background: "#f5f3ee", borderRadius: 10, border: "1px solid #ece8df", display: "flex", flexDirection: "column", gap: 10, animation: "fadeUp .2s ease" }}>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={2} placeholder="업무 내용을 입력하세요" style={{ ...input, resize: "vertical", fontFamily: "'Malgun Gothic','맑은 고딕',sans-serif" }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select value={urgency} onChange={(e) => setUrgency(e.target.value)} style={{ ...input, width: "auto", padding: "6px 10px", fontSize: 13 }}>
              <option value="normal">일반</option>
              <option value="urgent">긴급</option>
            </select>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#8a8478", whiteSpace: "nowrap" }}>기한</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={{ ...input, width: "auto", padding: "6px 10px", fontSize: 13 }} />
            </div>
            <button className="sch-btn" style={{ ...primaryBtn, padding: "7px 16px", fontSize: 13 }} onClick={submit}>등록</button>
          </div>
        </div>
      )}

      {active.length === 0 && done.length === 0 && !open && <div style={{ color: "#bdb6a6", fontSize: 13, textAlign: "center", padding: "12px 0" }}>등록된 업무사항이 없습니다.</div>}

      {active.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {active.map((d) => <DirectiveRow key={d.id} d={d} onToggle={onToggle} onRemove={onRemove} userEmail={userEmail} />)}
        </div>
      )}

      {done.length > 0 && (
        <details style={{ marginTop: active.length > 0 ? 12 : 0 }}>
          <summary style={{ fontSize: 12, color: "#a8a292", cursor: "pointer", userSelect: "none" }}>완료된 항목 {done.length}건</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {done.map((d) => <DirectiveRow key={d.id} d={d} onToggle={onToggle} onRemove={onRemove} userEmail={userEmail} />)}
          </div>
        </details>
      )}
    </div>
  );
}

function DirectiveRow({ d, onToggle, onRemove, userEmail }) {
  const urg = URGENCY[d.urgency] || URGENCY.normal;
  const today = todayISO();
  const canDelete = userEmail && d.created_by === userEmail;
  let dueLabel = null;
  let dueColor = "#a8a292";
  if (d.due_date) {
    const diff = daysBetween(today, d.due_date);
    if (diff < 0) { dueLabel = `${Math.abs(diff)}일 지남`; dueColor = "#b3402f"; }
    else if (diff === 0) { dueLabel = "오늘 마감"; dueColor = "#b3402f"; }
    else if (diff <= 3) { dueLabel = `D-${diff}`; dueColor = "#b06a1e"; }
    else { dueLabel = `D-${diff}`; dueColor = "#8a8478"; }
  }
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", background: d.done ? "#f5f3ee" : "#fff", borderRadius: 9, border: "1px solid #ece8df", opacity: d.done ? 0.65 : 1 }}>
      <button className="sch-btn" style={{ ...iconBtn, marginTop: 1, flexShrink: 0 }} onClick={() => onToggle(d.id, !d.done)} title={d.done ? "미완료로 변경" : "완료 처리"}>
        {d.done ? <CheckCircle2 size={18} style={{ color: "#3f6f53" }} /> : <Circle size={18} style={{ color: "#c4bdae" }} />}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, color: "#2a241b", textDecoration: d.done ? "line-through" : "none", lineHeight: 1.5 }}>{d.content}</span>
        <div style={{ display: "flex", gap: 8, marginTop: 5, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: urg.color, background: urg.bg, padding: "1px 7px", borderRadius: 99 }}>{urg.label}</span>
          {dueLabel && <span style={{ fontSize: 11, fontWeight: 600, color: dueColor }}>· {d.due_date} ({dueLabel})</span>}
          {!d.due_date && d.created_at && <span style={{ fontSize: 11, color: "#bdb6a6" }}>· {new Date(d.created_at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })} 등록</span>}
        </div>
      </div>
      {canDelete && (
        <button className="sch-btn" style={{ ...iconBtn, flexShrink: 0 }} onClick={() => onRemove(d.id)} title="삭제">
          <Trash2 size={14} style={{ color: "#c4bdae" }} />
        </button>
      )}
    </div>
  );
}

// ---------- 공통 ----------
const Filter = ({ label, value, onChange, options }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <span style={{ fontSize: 12, color: "#a8a292" }}>{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...input, padding: "5px 8px", fontSize: 13, width: "auto" }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </div>
);
const Panel = ({ title, icon: Icon, accent = "#2a241b", children }) => (
  <div style={{ ...statCard, padding: 0 }}>
    <div style={{ padding: "14px 18px", borderBottom: "1px solid #ece8df", display: "flex", alignItems: "center", gap: 8 }}>
      <Icon size={16} style={{ color: accent }} /><span style={{ fontWeight: 600, color: "#2a241b" }}>{title}</span>
    </div>
    <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 4, minHeight: 80 }}>{children}</div>
  </div>
);
const Row = ({ task, member, onOpen, right }) => (
  <div className="sch-btn" onClick={() => onOpen(task)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8 }}>
    <span style={{ width: 8, height: 8, borderRadius: 99, background: CATEGORY[task.category].color, flexShrink: 0 }} />
    <span style={{ flex: 1, fontSize: 14, color: "#3a342a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</span>
    {member && <span style={{ fontSize: 12, color: member.color, fontWeight: 500 }}>{member.name}</span>}
    {right}
  </div>
);
const Tag = ({ color, children }) => <span style={{ fontSize: 11, fontWeight: 600, color, background: `${color}18`, padding: "2px 8px", borderRadius: 99 }}>{children}</span>;
const Empty = ({ children, small }) => <div style={{ textAlign: "center", color: "#bdb6a6", fontSize: small ? 12 : 13, padding: small ? 8 : 20 }}>{children}</div>;
const Field = ({ label, children }) => (
  <div style={{ marginBottom: 12 }}>
    <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#8a8478", marginBottom: 5 }}>{label}</label>
    {children}
  </div>
);
const Overlay = ({ children, onClose }) => (
  <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(40,30,15,.35)", backdropFilter: "blur(2px)", display: "grid", placeItems: "center", padding: 20, zIndex: 50, animation: "fadeUp .2s ease" }}>{children}</div>
);

// ---------- 스타일 ----------
const globalCss = `
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  *{box-sizing:border-box} body{margin:0;background:#f5f3ee}
  .sch-btn{transition:all .15s ease;cursor:pointer} .sch-btn:hover{filter:brightness(.96)}
  .sch-btn:disabled{opacity:.6;cursor:default}
  .sch-card{transition:transform .15s ease, box-shadow .15s ease}
  .sch-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(40,30,15,.10)}
  .sch-day:hover{background:#efece3 !important}
`;
const wrap = { fontFamily: "'Malgun Gothic','맑은 고딕',sans-serif", background: "#f5f3ee", color: "#2a241b", padding: "24px 26px", maxWidth: 1100, margin: "0 auto", minHeight: "100vh" };
const header = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" };
const title = { fontFamily: "'Malgun Gothic','맑은 고딕',sans-serif", fontSize: 30, fontWeight: 600, margin: 0, color: "#2a241b", letterSpacing: "-0.5px" };
const sub = { fontSize: 13, color: "#a8a292", margin: "4px 0 0" };
const sharedPill = { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "#7a4ea8", background: "#efe6f6", padding: "3px 9px", borderRadius: 99 };
const errorBar = { marginTop: 14, padding: "10px 14px", background: "#f6e0dc", color: "#9e3322", borderRadius: 9, fontSize: 13 };
const tabs = { display: "flex", gap: 4, marginTop: 20, background: "#ece8df", padding: 4, borderRadius: 10, width: "fit-content" };
const tab = { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", border: "none", background: "transparent", borderRadius: 7, fontSize: 13.5, fontWeight: 500, color: "#8a8478", fontFamily: "'Malgun Gothic','맑은 고딕',sans-serif" };
const tabActive = { background: "#fbfaf6", color: "#2a241b", boxShadow: "0 1px 4px rgba(40,30,15,.08)" };
const filterBar = { display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap", alignItems: "center" };
const statGrid = { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 };
const statCard = { background: "#fbfaf6", borderRadius: 12, padding: 18, border: "1px solid #ece8df", borderTop: "3px solid #2a241b", display: "flex", flexDirection: "column", gap: 14 };
const listRow = { display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#fbfaf6", borderRadius: 12, border: "1px solid #ece8df" };
const calGrid = { display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6 };
const calHead = { textAlign: "center", fontSize: 12, fontWeight: 600, padding: "6px 0" };
const calCell = { minHeight: 92, borderRadius: 8, padding: 6, border: "1px solid #ece8df" };
const primaryBtn = { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#2a241b", color: "#fff", border: "none", borderRadius: 9, fontSize: 14, fontWeight: 500, fontFamily: "'Malgun Gothic','맑은 고딕',sans-serif" };
const ghostBtn = { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", background: "#fbfaf6", color: "#6a6458", border: "1px solid #ddd8cc", borderRadius: 9, fontSize: 14, fontWeight: 500, fontFamily: "'Malgun Gothic','맑은 고딕',sans-serif" };
const navBtn = { display: "grid", placeItems: "center", width: 36, height: 36, background: "#fbfaf6", border: "1px solid #ddd8cc", borderRadius: 9, color: "#6a6458" };
const iconBtn = { display: "grid", placeItems: "center", width: 32, height: 32, background: "transparent", border: "none", borderRadius: 7 };
const modal = { background: "#f5f3ee", borderRadius: 16, padding: 24, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(40,30,15,.25)" };
const modalHead = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 };
const input = { width: "100%", padding: "9px 12px", border: "1px solid #ddd8cc", borderRadius: 9, fontSize: 14, fontFamily: "'Malgun Gothic','맑은 고딕',sans-serif", background: "#fbfaf6", color: "#2a241b", outline: "none" };
