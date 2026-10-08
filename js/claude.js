// Claude Messages API 스트리밍 클라이언트 (브라우저 직접 호출 또는 프록시 경유)
// 문서: https://platform.claude.com/docs/en/build-with-claude/streaming

export const MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (권장 · 속도/비용 균형)" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (정밀 검토)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (빠른 초안)" },
];

const API_URL = "https://api.anthropic.com/v1/messages";

/**
 * @param {object} p
 * @param {string} p.apiKey     - 사용자 API 키 (프록시 사용 시 비워둠)
 * @param {string} p.proxyUrl   - 선택: 키를 숨기는 프록시(worker/proxy.js) 주소
 * @param {string} p.model
 * @param {string} p.system
 * @param {Array}  p.messages   - [{role, content}]
 * @param {number} p.maxTokens
 * @param {(text:string, full:string)=>void} p.onText
 * @param {AbortSignal} p.signal
 * @returns {Promise<{text:string, usage:object, stopReason:string}>}
 */
export async function streamClaude({ apiKey, proxyUrl, model, system, messages, maxTokens = 8000, onText, signal }) {
  const url = proxyUrl ? proxyUrl.replace(/\/$/, "") + "/v1/messages" : API_URL;
  const headers = { "content-type": "application/json", "anthropic-version": "2023-06-01" };
  if (!proxyUrl) {
    if (!apiKey) throw new Error("API 키를 입력하세요 (설정 ⚙).");
    headers["x-api-key"] = apiKey;
    headers["anthropic-dangerous-direct-browser-access"] = "true"; // 브라우저 직접 호출(CORS) 허용 헤더
  }
  const res = await fetch(url, {
    method: "POST", headers, signal,
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, stream: true }),
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); msg = j.error?.message || msg; } catch { /* ignore */ }
    if (res.status === 401) msg = "API 키가 올바르지 않습니다. (" + msg + ")";
    if (res.status === 429) msg = "요청 한도 초과 — 잠시 후 다시 시도하세요. (" + msg + ")";
    if (res.status === 529) msg = "API 서버 과부하 — 잠시 후 다시 시도하세요.";
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", full = "", usage = {}, stopReason = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const evt = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const dataLine = evt.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!dataLine) continue;
      let d; try { d = JSON.parse(dataLine); } catch { continue; }
      if (d.type === "content_block_delta" && d.delta?.type === "text_delta") {
        full += d.delta.text; onText?.(d.delta.text, full);
      } else if (d.type === "message_start") usage = { ...usage, ...(d.message?.usage || {}) };
      else if (d.type === "message_delta") { usage = { ...usage, ...(d.usage || {}) }; stopReason = d.delta?.stop_reason || stopReason; }
      else if (d.type === "error") throw new Error(d.error?.message || "스트리밍 오류");
      // ping 등 알 수 없는 이벤트는 무시
    }
  }
  return { text: full, usage, stopReason };
}

// ---------------- 프롬프트 ----------------
export const SYSTEM_BASE = `당신은 한국 법인세 경정청구 사전검토를 돕는 세무 컨설팅 보조자입니다. 사용자는 법인 컨설턴트이며, 결과물은 고객사 미팅용 보고서(Word)와 브리핑 자료(PPT)로 쓰입니다.

원칙
- 제공된 [기업 데이터]와 [계산 결과]의 숫자를 근거로 판단하고, 숫자를 새로 지어내지 마세요. 새로 계산한 값은 산식을 함께 적으세요.
- 법령·예규는 조문 번호(예: 조특법 §6⑩, 국세기본법 §45의2)를 명시하고, 확실하지 않은 해석은 "확인 필요"로 표시하세요.
- 추정과 사실을 구분하세요. 재무제표 역산 값은 '추정'입니다.
- 작성자는 세무사가 아니므로 최종 판단은 세무대리인 확인이 필요하다는 점을 유지하세요.
- 한국어, 간결한 실무 문체(~함/~임 또는 ~습니다 중 기존 섹션 문체를 따름)로 작성하세요.
- 고객 개인정보(주민번호 등)는 출력하지 마세요.`;

export const EDIT_FORMAT = `[수정 출력 형식]
수정하거나 새로 쓰는 섹션만 아래 형식으로 출력하세요. 형식 밖에는 한두 줄의 변경 요약만 쓰세요.
<section id="섹션ID" title="섹션 제목">
본문 (간단 마크업: 일반 줄=문단, "- "=글머리, "| a | b |"=표(첫 줄 머리글), "> "=강조 박스, "## "=소제목)
</section>
- 기존 섹션 ID를 쓰면 그 섹션 전체가 교체됩니다. 바꾸지 않을 내용도 섹션 안에 그대로 포함하세요.
- 새 섹션이 필요하면 새 ID(영문 소문자)를 쓰세요.`;

export function buildContext(state) {
  const { data, analysis, sections, inputs } = state;
  const slim = {
    company: data.company, certs: data.certs, shareholders: data.shareholders, related: data.related,
    customers: data.customers, purchasers: data.purchasers, fin: data.fin,
  };
  const calc = {
    verdict: analysis.verdict, primary: analysis.primary, region: analysis.region, size: analysis.size,
    rates: analysis.rates, checks: analysis.checks, risks: analysis.risks, others: analysis.others,
    rows: analysis.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? Math.round(v) : v]))),
    scenarios: analysis.scen,
  };
  return [
    "[기업 데이터] (금액 단위: 천원)", JSON.stringify(slim),
    "[사용자 보완 입력]", JSON.stringify(inputs || {}),
    "[계산 결과] (금액 단위: 천원, rows: 연도별 산출세액 calc·최저한세 minTax·시나리오 A/B/C 감면액·기적용 existing·net*)", JSON.stringify(calc),
    "[현재 보고서 섹션]",
    ...sections.map((s) => `<section id="${s.id}" title="${s.title}">\n${s.body}\n</section>`),
  ].join("\n");
}

/** 첨부 PDF/이미지 → content 블록 */
export function attachmentBlocks(files = []) {
  return files.map((f) => f.type === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data }, title: f.name }
    : { type: "image", source: { type: "base64", media_type: f.type, data: f.data } });
}

/** 응답에서 <section> 블록 추출 */
export function extractSections(text) {
  const out = [];
  const re = /<section\s+id="([^"]+)"(?:\s+title="([^"]*)")?\s*>([\s\S]*?)<\/section>/g;
  let mm;
  while ((mm = re.exec(text))) out.push({ id: mm[1].trim(), title: (mm[2] || "").trim(), body: mm[3].replace(/^\n+|\n+$/g, "") });
  return out;
}
