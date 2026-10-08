// (선택) Cloudflare Worker 프록시 — API 키를 브라우저에 두지 않고 팀이 함께 쓸 때 사용
//
// 환경변수 (Cloudflare 대시보드 → Worker → Settings → Variables and Secrets)
//   ANTHROPIC_API_KEY  (Secret, 필수)  sk-ant-...
//   TEAM_CODES         (Secret, 권장)  팀원별 접속 코드. "이름:코드" 를 쉼표로 구분
//                                      예) 최세림:plana-7Kx92q,홍길동:plana-Qm31Za
//                                      코드를 지우면 그 팀원만 즉시 차단됩니다.
//   ALLOWED_ORIGIN     (Text,   권장)  웹앱 주소(도메인까지). 예) https://아이디.github.io
//
// TEAM_CODES 를 설정하지 않으면 접속 코드 검사 없이 동작합니다(공개 사이트에서는 권장하지 않음).

const enc = new TextEncoder();
/** 길이·내용과 무관하게 같은 시간이 걸리는 비교 (코드 추측 공격 완화) */
async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function parseCodes(raw = "") {
  return raw.split(",").map((s) => s.trim()).filter(Boolean).map((entry) => {
    const i = entry.lastIndexOf(":");
    return i > 0 ? { member: entry.slice(0, i).trim(), code: entry.slice(i + 1).trim() } : { member: "팀원", code: entry };
  }).filter((c) => c.code);
}

/** 접속 코드 확인 → { ok, member } */
async function checkCode(request, env) {
  const list = parseCodes(env.TEAM_CODES);
  if (!list.length) return { ok: true, member: null, open: true };
  const given = (request.headers.get("x-team-code") || "").trim();
  if (!given) return { ok: false };
  let hit = null;
  for (const c of list) if (await safeEqual(given, c.code)) hit = c; // 모든 코드와 비교(조기 종료 없음)
  return hit ? { ok: true, member: hit.member } : { ok: false };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
    const okOrigin = allowed.length === 0 || allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": okOrigin ? origin || "*" : "null",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, anthropic-version, x-team-code",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!okOrigin) return json(403, { error: { type: "forbidden_origin", message: "허용되지 않은 사이트에서의 요청입니다." } });

    const url = new URL(request.url);
    const auth = await checkCode(request, env);

    // 연결 확인용: 코드만 검사하고 Anthropic API는 호출하지 않음 (비용 없음)
    if (url.pathname === "/v1/check") {
      if (!auth.ok) return json(401, { ok: false, error: { type: "invalid_team_code", message: "팀 접속 코드가 올바르지 않습니다." } });
      return json(200, { ok: true, member: auth.member, codeRequired: !auth.open, keyConfigured: Boolean(env.ANTHROPIC_API_KEY) });
    }

    if (request.method !== "POST" || url.pathname !== "/v1/messages") return json(404, { error: { type: "not_found", message: "Not found" } });
    if (!auth.ok) return json(401, { error: { type: "invalid_team_code", message: "팀 접속 코드가 올바르지 않습니다." } });
    if (!env.ANTHROPIC_API_KEY) return json(500, { error: { type: "config", message: "프록시에 ANTHROPIC_API_KEY가 설정되지 않았습니다." } });

    // 누가 썼는지 Cloudflare 로그(Workers → Logs)에서 확인 가능 — 내용은 기록하지 않음
    console.log(JSON.stringify({ at: new Date().toISOString(), member: auth.member || "-", origin }));

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": request.headers.get("anthropic-version") || "2023-06-01",
        "x-api-key": env.ANTHROPIC_API_KEY,
      },
      body: request.body,
    });
    const headers = new Headers(upstream.headers);
    Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
    return new Response(upstream.body, { status: upstream.status, headers }); // 스트리밍 그대로 전달
  },
};
