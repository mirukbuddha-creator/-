// ===== 설정값 (이미 입력 완료) =====
// 값을 바꿔야 할 일이 생기면 여기만 고치면 됩니다.

export const GOOGLE_CLIENT_ID =
  "642630143890-13vrse0i32137v0bj0te08pddqspsita.apps.googleusercontent.com";

export const SUPABASE_URL = "https://fdkkihtgvoibsdbqcefj.supabase.co";
export const SUPABASE_KEY = "sb_publishable_3L3yS0JaWuYaabznn9GzbA_6RpbepFL";

// 가져올 구글 캘린더 목록
export const CALENDARS = [
  {
    id: "gpdnl4poonhkfdemhqb8pugn7k@group.calendar.google.com",
    name: "재무회계팀",
    color: "#0f5e5a",
    defaultCategory: "etc",
  },
  {
    id: "q9k7nu2jj4lrk96tc12nh55m6g@group.calendar.google.com",
    name: "IPO일정",
    color: "#7a4ea8",
    defaultCategory: "ipo",
  },
];

// 앞으로 몇 개월치 일정을 불러올지 (반복 일정은 무한이므로 구간으로 제한)
export const MONTHS_AHEAD = 12;
