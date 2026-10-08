// (선택) Cloudflare Worker 프록시 — API 키를 브라우저에 두지 않고 팀이 함께 쓸 때 사용
// 배포: wrangler secret put ANTHROPIC_API_KEY  /  wrangler.toml 의 vars.ALLOWED_ORIGIN 에 GitHub Pages 주소 지정
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
    const okOrigin = allowed.length === 0 || allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": okOrigin ? origin || "*" : "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, anthropic-version",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/messages") return new Response("Not found", { status: 404, headers: cors });
    if (!okOrigin) return new Response("Origin not allowed", { status: 403, headers: cors });

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
