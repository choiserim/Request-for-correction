import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/proxy.js";

const ORIGIN = "https://plana.github.io";
const env = { ANTHROPIC_API_KEY: "sk-ant-secret", TEAM_CODES: "최세림:plana-AAA111, 홍길동:plana-BBB222", ALLOWED_ORIGIN: ORIGIN };
const upstreamCalls = [];
globalThis.fetch = async (url, init) => { upstreamCalls.push({ url, init }); return new Response("event: message_stop\ndata: {}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }); };
const req = (path, { code, origin = ORIGIN, method = "POST" } = {}) => new Request("https://gj-proxy.example.workers.dev" + path, {
  method, headers: { "content-type": "application/json", Origin: origin, ...(code ? { "x-team-code": code } : {}) },
  body: method === "POST" ? JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 10, messages: [] }) : undefined,
});

test("코드 없음 / 틀린 코드 → 401, Anthropic 호출 안 함", async () => {
  upstreamCalls.length = 0;
  assert.equal((await worker.fetch(req("/v1/messages"), env)).status, 401);
  assert.equal((await worker.fetch(req("/v1/messages", { code: "plana-WRONG" }), env)).status, 401);
  assert.equal(upstreamCalls.length, 0);
});
test("올바른 코드 → Anthropic으로 전달, 키는 서버에서만 붙임", async () => {
  upstreamCalls.length = 0;
  const r = await worker.fetch(req("/v1/messages", { code: "plana-BBB222" }), env);
  assert.equal(r.status, 200);
  assert.equal(upstreamCalls[0].init.headers["x-api-key"], "sk-ant-secret");
  assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
});
test("연결 확인(/v1/check)은 팀원 이름을 돌려주고 API 호출 없음", async () => {
  upstreamCalls.length = 0;
  const r = await worker.fetch(req("/v1/check", { code: "plana-AAA111", method: "GET" }), env);
  const j = await r.json();
  assert.equal(j.ok, true); assert.equal(j.member, "최세림"); assert.equal(j.codeRequired, true);
  assert.equal(upstreamCalls.length, 0);
});
test("허용되지 않은 사이트 → 403", async () => {
  assert.equal((await worker.fetch(req("/v1/messages", { code: "plana-AAA111", origin: "https://evil.example" }), env)).status, 403);
});
test("TEAM_CODES 미설정 시 코드 없이 동작(경고는 /v1/check 로 확인)", async () => {
  const j = await (await worker.fetch(req("/v1/check", { method: "GET" }), { ...env, TEAM_CODES: "" })).json();
  assert.equal(j.ok, true); assert.equal(j.codeRequired, false);
});
