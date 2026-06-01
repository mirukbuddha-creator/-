import { GOOGLE_CLIENT_ID } from "./config";

const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

let accessToken = null;
let tokenClient = null;

// Google Identity Services 스크립트 로드
export function loadGoogle() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Google 로그인 스크립트를 불러오지 못했습니다."));
    document.head.appendChild(s);
  });
}

// 액세스 토큰 요청 (prompt: "" = 가능하면 조용히, "consent" = 동의 화면 강제)
export function requestToken({ prompt = "" } = {}) {
  return new Promise((resolve, reject) => {
    try {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPE,
        prompt,
        callback: (resp) => {
          if (resp && resp.access_token) {
            accessToken = resp.access_token;
            resolve(accessToken);
          } else {
            reject(resp || new Error("토큰을 받지 못했습니다."));
          }
        },
        error_callback: (err) => reject(err),
      });
      tokenClient.requestAccessToken({ prompt });
    } catch (e) {
      reject(e);
    }
  });
}

export function getToken() {
  return accessToken;
}

// 특정 캘린더의 이벤트 조회 (반복 일정은 singleEvents로 펼침)
export async function fetchEvents(calendarId, timeMin, timeMax) {
  const all = [];
  let pageToken;
  do {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        calendarId
      )}/events`
    );
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("timeZone", "Asia/Seoul");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const err = new Error("캘린더 조회 실패 (" + res.status + ")");
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    all.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return all;
}
