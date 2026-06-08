// 매일 오후 3시 자동 알림 스크립트
// GitHub Actions에서 실행됩니다.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function supabaseFetch(path, params = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}${params}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Supabase 오류: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sendTelegram(message) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "HTML",
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error("텔레그램 전송 실패: " + JSON.stringify(data));
  return data;
}

function todayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

async function main() {
  const today = todayKST();
  console.log("오늘 날짜(KST):", today);

  // 1. 오늘의 필수 업무 미처리 항목
  const allTasks = await supabaseFetch("daily_tasks", "?order=order_idx");
  const todayChecks = await supabaseFetch("daily_checks", `?check_date=eq.${today}`);
  const checkedIds = new Set(todayChecks.filter((c) => c.done).map((c) => c.task_id));
  const undoneDailyTasks = allTasks.filter((t) => !checkedIds.has(t.id));

  // 2. 오늘 마감인 캘린더 업무 중 미완료
  const dueTodayEvents = await supabaseFetch(
    "event_meta",
    `?due_date=eq.${today}&status=neq.done&select=title,status`
  );

  // 3. 메시지 구성
  let lines = [];
  lines.push(`📋 <b>[재무회계팀] 오후 3시 업무 알림</b>`);
  lines.push(`📅 ${today}`);
  lines.push("");

  if (undoneDailyTasks.length === 0 && dueTodayEvents.length === 0) {
    lines.push("✅ 오늘의 모든 업무가 처리되었습니다. 수고하셨습니다!");
  } else {
    if (undoneDailyTasks.length > 0) {
      lines.push(`🔴 <b>미처리 필수 업무 (${undoneDailyTasks.length}건)</b>`);
      undoneDailyTasks.forEach((t) => lines.push(`  • ${t.title}`));
      lines.push("");
    }
    if (dueTodayEvents.length > 0) {
      lines.push(`⚠️ <b>오늘 마감 미완료 일정 (${dueTodayEvents.length}건)</b>`);
      dueTodayEvents.forEach((e) => lines.push(`  • ${e.title}`));
      lines.push("");
    }
    lines.push("확인 후 처리해 주세요.");
  }

  const message = lines.join("\n");
  console.log("전송 메시지:\n", message);

  await sendTelegram(message);
  console.log("텔레그램 전송 완료!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
