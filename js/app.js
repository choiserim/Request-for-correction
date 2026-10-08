import { parseKodata } from "./parser.js";
import { analyze, fmtM, range } from "./taxengine.js";
import { buildSections, renderHTML } from "./report.js";
import { MODELS, streamClaude, SYSTEM_BASE, EDIT_FORMAT, buildContext, attachmentBlocks, extractSections } from "./claude.js";
import { buildDocx } from "./export-docx.js";
import { buildPptx } from "./export-pptx.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

// 계산값으로 다시 만들어도 되는(수치 중심) 섹션
const NUMERIC_SECTIONS = ["summary", "company", "finance", "system", "items", "refund"];
const STORE_KEY = "gj-state-v1", SETTINGS_KEY = "gj-settings-v1";

const state = {
  data: null, analysis: null, sections: [], dirty: new Set(),
  inputs: { ceoAge: null, youth: "unknown", related: "unknown", overcrowded: "auto", size: "auto", taxBase: {}, existingRelief: {} },
  meta: { author: "", date: new Date().toISOString().slice(0, 10), sourceName: "" },
  chat: [], attachments: [], proposals: [],
};
const settings = { apiKey: "", remember: false, model: MODELS[0].id, maxTokens: 8000, proxyUrl: "" };

// ---------------- 저장소 (localStorage는 실패해도 동작) ----------------
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};
function loadSettings() {
  const s = ls.get(SETTINGS_KEY);
  if (s) Object.assign(settings, s);
  try { const k = sessionStorage.getItem("gj-key"); if (k && !settings.apiKey) settings.apiKey = k; } catch { /* */ }
}
function saveSettings() {
  const copy = { ...settings };
  if (!settings.remember) { copy.apiKey = ""; try { sessionStorage.setItem("gj-key", settings.apiKey); } catch { /* */ } }
  ls.set(SETTINGS_KEY, copy);
  $("#modelBadge").textContent = MODELS.find((m) => m.id === settings.model)?.id || settings.model;
}
let saveTimer;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!state.data) return;
    const ok = ls.set(STORE_KEY, serialize(false));
    $("#saveState").textContent = ok ? `자동 저장됨 ${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}` : "";
  }, 600);
}
function serialize(withAttachments) {
  return {
    v: 1, data: state.data, sections: state.sections, dirty: [...state.dirty], inputs: state.inputs, meta: state.meta,
    chat: state.chat.slice(-30), attachments: withAttachments ? state.attachments : [],
  };
}
function restore(obj) {
  if (!obj?.data) return false;
  state.data = obj.data; state.sections = obj.sections || []; state.dirty = new Set(obj.dirty || []);
  Object.assign(state.inputs, obj.inputs || {}); Object.assign(state.meta, obj.meta || {});
  state.chat = obj.chat || []; state.attachments = obj.attachments || [];
  recompute({ keepSections: true });
  renderChatHistory(); renderAttachments();
  return true;
}

// ---------------- 토스트 ----------------
function toast(msg, ms = 2600) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ---------------- 파일 업로드 ----------------
async function handleXls(file) {
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const data = parseKodata(window.XLSX, buf);
    if (!data.fin.years.length) throw new Error("재무제표(손익계산서) 영역을 찾지 못했습니다. KoDATA 기업종합보고서 엑셀인지 확인하세요.");
    state.data = data; state.meta.sourceName = `한국평가데이터 기업종합보고서 (${file.name})`;
    state.dirty = new Set(); state.chat = []; state.proposals = [];
    $("#fileName").textContent = `✓ ${file.name}`;
    recompute({ keepSections: false });
    renderChatHistory(); renderProposals();
    toast(`${data.company.name} — ${data.fin.years.length}개 연도 재무 데이터 분석 완료`);
  } catch (e) {
    console.error(e); toast("읽기 실패: " + e.message, 5000);
  }
}
async function handleAttach(files) {
  for (const f of files) {
    if (!/^(application\/pdf|image\/(png|jpeg|gif|webp))$/.test(f.type)) { toast(`${f.name}: PDF·이미지만 첨부할 수 있습니다`); continue; }
    if (f.size > 20 * 1024 * 1024) { toast(`${f.name}: 20MB 초과 파일은 제외됩니다`); continue; }
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });
    state.attachments.push({ name: f.name, type: f.type, size: f.size, data });
  }
  renderAttachments();
}
function renderAttachments() {
  $("#attachList").innerHTML = state.attachments.map((a, i) => `<li><span>📎 ${esc(a.name)} <span class="muted">(${Math.round(a.size / 1024)}KB)</span></span><button data-del="${i}" title="제거">✕</button></li>`).join("");
}

// ---------------- 계산 & 렌더 ----------------
function recompute({ keepSections }) {
  if (!state.data) return;
  state.analysis = analyze(state.data, state.inputs);
  const fresh = buildSections(state.data, state.analysis);
  if (!keepSections || !state.sections.length) state.sections = fresh;
  else {
    // 사용자가 편집하지 않은 수치 섹션만 갱신
    state.sections = state.sections.map((s) => (NUMERIC_SECTIONS.includes(s.id) && !state.dirty.has(s.id) ? fresh.find((f) => f.id === s.id) || s : s));
  }
  $("#empty").hidden = true;
  $("#inputsPanel").hidden = false; $("#exportPanel").hidden = false;
  $("#subtitle").textContent = `${state.data.company.name} · ${state.data.company.industryName || ""}`;
  syncInputs(); renderDash(); renderSections(); showTab(currentTab);
  autosave();
}

let currentTab = "dash";
function showTab(t) {
  currentTab = t;
  $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
  $("#tab-dash").hidden = t !== "dash" || !state.data;
  $("#tab-report").hidden = t !== "report" || !state.data;
}

const pill = (s) => `<span class="pill ${/미충족|부인|불가|미적용/.test(s) ? "bad" : /확인|조건부|일부/.test(s) ? "warn" : "ok"}">${esc(s)}</span>`;

function renderDash() {
  const a = state.analysis, d = state.data, c = d.company;
  const prim = a.scen[a.primary];
  const yrs = a.rows;
  $("#tab-dash").innerHTML = `
    <div class="verdict ${a.verdictLevel}">
      <div><h2>${esc(a.verdict)}</h2>
        <p>${esc(c.name)} · ${esc(c.founded)} 설립 · ${esc(c.address.split(" ").slice(0, 3).join(" "))} · ${esc(a.region.overcrowded === true ? "과밀억제권역 내" : a.region.overcrowded === "check" ? "과밀억제권역 확인 필요" : "과밀억제권역 외")}</p>
        ${a.region.note ? `<p>⚠ ${esc(a.region.note)}</p>` : ""}</div>
      <div class="big">${esc(range(prim.net, prim.gross))}<small>기본안 ${a.primary}. ${esc(prim.label)} · 법인세 본세</small></div>
    </div>
    <div class="cards">${["A", "B", "C"].map((k) => `
      <div class="card ${k === a.primary ? "on" : ""}"><h3>${k}. ${esc(a.scen[k].label)}</h3>
        <div class="num">${esc(range(a.scen[k].net, a.scen[k].gross))}</div>
        <div class="muted small">${k === "A" ? "창업 해당성 인정 시" : k === "B" ? "대표자 창업 당시 34세 이하·최대주주" : "창업 불인정 시 대안"}</div></div>`).join("")}
    </div>
    <div class="block"><h3>연도별 계산 (백만원)</h3><div class="tbl"><table>
      <thead><tr><th>구분</th>${yrs.map((r) => `<th>${r.year}${r.months < 12 ? ` (${r.months}개월)` : ""}</th>`).join("")}</tr></thead><tbody>
      ${[["과세표준(가정)", "base"], ["감면 전 산출세액", "calc"], ["최저한세 7%", "minTax"], ["실제 납부 추정", "paidEst"], ["기적용 공제·감면", "existing"], [`A. ${a.scen.A.label}`, "A"], [`B. ${a.scen.B.label}`, "B"], [`C. ${a.scen.C.label}`, "C"]]
        .map(([l, k]) => `<tr><td>${esc(l)}</td>${yrs.map((r) => `<td class="n">${fmtM(r[k])}${k === "existing" ? ` <span class="muted small">${r.existingSource === "입력값" ? "입력" : "추정"}</span>` : ""}</td>`).join("")}</tr>`).join("")}
      <tr><td>판단</td>${yrs.map((r) => `<td>${pill(r.signal)}</td>`).join("")}</tr>
      <tr><td>경정청구 기한</td>${yrs.map((r) => `<td>${r.claimDue}</td>`).join("")}</tr>
      </tbody></table></div></div>
    <div class="block"><h3>창업중소기업 세액감면 요건 (조특법 §6)</h3><div class="tbl"><table>
      <thead><tr><th>요건</th><th>법령 기준</th><th>현황</th><th>판단</th></tr></thead><tbody>
      ${a.checks.map((k) => `<tr><td>${esc(k.item)}</td><td>${esc(k.rule)}</td><td>${esc(k.fact)}</td><td>${pill(k.status)}</td></tr>`).join("")}
      </tbody></table></div></div>
    <div class="block"><h3>쟁점·리스크</h3><div class="risk">
      ${a.risks.map((r) => `<div class="${r.level}"><b>${esc(r.title)}</b><p>${esc(r.desc)}</p><em>→ ${esc(r.action)}</em></div>`).join("")}
    </div></div>
    <div class="block"><h3>재무 요약 (백만원)</h3><div class="tbl"><table>
      <thead><tr><th>구분</th>${d.fin.years.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>
      ${[["매출액", "revenue"], ["영업이익", "operatingIncome"], ["세전이익", "pretaxIncome"], ["법인세비용", "taxExpense"], ["당기순이익", "netIncome"], ["가지급금", "loansToOfficers"], ["인건비", "laborTotal"]]
        .map(([l, k]) => `<tr><td>${l}</td>${d.fin[k].map((v) => `<td class="n">${fmtM(v)}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div></div>`;
}

function renderSections() {
  $("#sections").innerHTML = state.sections.map((s, i) => `
    <article class="sec" data-id="${esc(s.id)}">
      <div class="sec-head">
        <span class="no">${i + 1}</span>
        <input class="sec-title" value="${esc(s.title)}" />
        ${state.dirty.has(s.id) ? `<span class="dirty" title="편집됨 — 재계산 시 유지">✎ 편집됨</span>` : ""}
        <button class="ghost small" data-act="ai" title="이 섹션을 Claude로 다듬기">AI 다듬기</button>
        <button class="ghost small" data-act="up" title="위로">↑</button>
        <button class="ghost small" data-act="down" title="아래로">↓</button>
        <button class="ghost small" data-act="del" title="삭제">✕</button>
      </div>
      <div class="sec-body">
        <textarea class="sec-text" spellcheck="false">${esc(s.body)}</textarea>
        <div class="preview">${renderHTML(s.body)}</div>
      </div>
    </article>`).join("");
}

// ---------------- 보완 입력 ----------------
function syncInputs() {
  const i = state.inputs;
  $("#inCeoAge").value = i.ceoAge ?? ""; $("#inYouth").value = i.youth; $("#inRelated").value = i.related;
  $("#inOver").value = i.overcrowded; $("#inSize").value = i.size; $("#inAuthor").value = state.meta.author || "";
  const yrs = state.data.fin.years;
  if ($("#yearInputs").dataset.years !== yrs.join(",")) {
    $("#yearInputs").dataset.years = yrs.join(",");
    $("#yearInputs").innerHTML = `<div class="yr muted"><span>연도</span><span>과세표준</span><span>기적용 공제감면</span></div>` +
      yrs.map((y) => `<div class="yr"><b>${y}</b><input type="number" data-k="taxBase" data-y="${y}" placeholder="추정 사용" /><input type="number" data-k="existingRelief" data-y="${y}" placeholder="추정 사용" /></div>`).join("");
  }
  $$("#yearInputs input").forEach((el) => { const v = i[el.dataset.k]?.[el.dataset.y]; el.value = v ?? ""; });
}
function readInputs() {
  const i = state.inputs;
  const age = Number($("#inCeoAge").value);
  i.ceoAge = age > 0 ? age : null; i.youth = $("#inYouth").value; i.related = $("#inRelated").value;
  i.overcrowded = $("#inOver").value; i.size = $("#inSize").value; state.meta.author = $("#inAuthor").value.trim();
  i.taxBase = {}; i.existingRelief = {};
  $$("#yearInputs input").forEach((el) => { if (el.value !== "") i[el.dataset.k][el.dataset.y] = Number(el.value); });
}

// ---------------- AI ----------------
const PROMPTS = {
  review: { edit: false, text: "현재 계산 결과와 보고서 전체를 검토해 주세요.\n1) 결론(경정청구 가능 여부)의 타당성\n2) 숫자·산식·법령 인용 오류\n3) 누락된 공제·감면 또는 리스크\n4) 고객에게 추가로 받아야 할 자료와 확인 질문\n항목별로 간결하게, 수정이 필요한 섹션 ID를 함께 적어 주세요." },
  improve: { edit: true, text: "직전 검토 의견과 첨부자료를 반영해 보고서를 보완·수정해 주세요. 근거가 약한 문장은 보강하고, 추정은 추정으로 표시하세요. 수정이 필요한 섹션만 출력하세요." },
  laws: { edit: true, text: "‘근거 법령·예규’(laws)와 ‘경정청구 항목별 검토’(items) 섹션의 법령·예규 인용이 정확한지 점검하고, 틀리거나 불확실한 부분을 고쳐 주세요. 확인이 필요한 해석은 '확인 필요'로 표시하세요." },
  qa: { edit: true, text: "고객사 대표와의 미팅에서 나올 예상 질문 8개와 답변을 새 섹션(id=\"qa\", title=\"미팅 예상 질문과 답변\")으로 작성해 주세요. 질문은 '## Q. ...' 소제목, 답변은 문단/글머리로." },
};

let aborter = null;
async function runAI(userText, { edit, sectionId } = {}) {
  if (!state.data) { toast("먼저 기업종합보고서 엑셀을 올려 주세요"); return; }
  if (!settings.apiKey && !settings.proxyUrl) { openSettings(); toast("API 키를 입력해 주세요"); return; }
  readInputs();
  const system = [SYSTEM_BASE, edit ? EDIT_FORMAT : "", sectionId ? `이번 요청은 섹션 id="${sectionId}"만 수정합니다.` : "", buildContext(state)].filter(Boolean).join("\n\n");
  const history = state.chat.slice(-10).map((m) => ({ role: m.role, content: m.content }));
  while (history.length && history[0].role !== "user") history.shift();
  const content = [...attachmentBlocks(state.attachments), { type: "text", text: userText }];
  const messages = [...history, { role: "user", content }];

  state.chat.push({ role: "user", content: userText });
  appendMsg("user", userText);
  const bubble = appendMsg("bot", "", true);
  setBusy(true);
  aborter = new AbortController();
  let raf = 0, latest = "";
  try {
    const res = await streamClaude({
      apiKey: settings.apiKey, proxyUrl: settings.proxyUrl, model: settings.model, maxTokens: Number(settings.maxTokens) || 8000,
      system, messages, signal: aborter.signal,
      onText: (_, full) => { latest = full; if (!raf) raf = requestAnimationFrame(() => { raf = 0; bubble.innerHTML = renderBot(latest); scrollChat(); }); },
    });
    cancelAnimationFrame(raf);
    bubble.classList.remove("cursor");
    bubble.innerHTML = renderBot(res.text);
    state.chat.push({ role: "assistant", content: res.text || "(빈 응답)" });
    const u = res.usage || {};
    $("#usage").textContent = u.output_tokens ? `입력 ${u.input_tokens?.toLocaleString() ?? "-"} · 출력 ${u.output_tokens.toLocaleString()} 토큰` : "";
    if (res.stopReason === "max_tokens") appendMsg("sys", "출력이 최대 토큰에서 잘렸습니다. 설정에서 최대 출력 토큰을 늘리거나 범위를 좁혀 요청하세요.");
    const secs = extractSections(res.text);
    if (secs.length) { state.proposals = secs.map((s) => ({ ...s, title: s.title || state.sections.find((x) => x.id === s.id)?.title || s.id })); renderProposals(); }
    else if (edit) appendMsg("sys", "수정안(<section>)이 포함되지 않았습니다. 요청을 더 구체적으로 적어 보세요.");
  } catch (e) {
    bubble.remove();
    state.chat.pop(); // 응답 없는 질문은 대화 기록에서 제외 (user/assistant 교대 유지)
    if (e.name === "AbortError") appendMsg("sys", "중지했습니다.");
    else appendMsg("err", "오류: " + e.message);
  } finally {
    setBusy(false); aborter = null; autosave();
  }
}
function renderBot(text) {
  // <section> 블록은 칩으로 접어서 표시
  const shown = text.replace(/<section\s+id="([^"]+)"(?:\s+title="([^"]*)")?\s*>[\s\S]*?(<\/section>|$)/g, (m, id, t, end) => `\n[[SEC:${t || id}${end ? "" : " (작성 중…)"}]]\n`);
  return renderHTML(shown).replace(/\[\[SEC:([^\]]+)\]\]/g, (m, t) => `<span class="secref">📝 수정안: ${t}</span>`);
}
function appendMsg(kind, text, streaming = false) {
  const el = document.createElement("div");
  el.className = `msg ${kind}${streaming ? " cursor" : ""}`;
  if (kind === "bot") el.innerHTML = renderBot(text); else el.textContent = text;
  $("#chat").appendChild(el); scrollChat();
  return el;
}
const scrollChat = () => { const c = $("#chat"); c.scrollTop = c.scrollHeight; };
function renderChatHistory() {
  $("#chat").innerHTML = "";
  if (!state.chat.length) appendMsg("sys", "위 버튼을 누르거나 아래에 요청을 입력하세요. 예) “결론을 더 보수적으로 바꿔줘”");
  state.chat.forEach((m) => appendMsg(m.role === "user" ? "user" : "bot", typeof m.content === "string" ? m.content : ""));
}
function setBusy(b) {
  $("#btnSend").disabled = b; $("#btnStop").hidden = !b;
  $$(".quick button, [data-act=ai]").forEach((x) => (x.disabled = b));
}
function renderProposals() {
  const box = $("#proposals");
  if (!state.proposals.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="prop-all"><span class="muted small" style="margin-right:auto">수정안 ${state.proposals.length}건</span>
      <button class="ghost small" data-prop="none">모두 취소</button><button class="primary small" data-prop="all">모두 적용</button></div>` +
    state.proposals.map((p, i) => {
      const exists = state.sections.some((s) => s.id === p.id);
      return `<div class="prop"><header><b>${exists ? "수정" : "추가"}: ${esc(p.title)}</b>
        <span><button class="ghost small" data-prop-skip="${i}">취소</button> <button class="primary small" data-prop-apply="${i}">적용</button></span></header>
        <div class="diff">${renderHTML(p.body)}</div></div>`;
    }).join("");
}
function applyProposal(i) {
  const p = state.proposals[i]; if (!p) return;
  const idx = state.sections.findIndex((s) => s.id === p.id);
  if (idx >= 0) state.sections[idx] = { ...state.sections[idx], title: p.title || state.sections[idx].title, body: p.body };
  else state.sections.splice(Math.max(0, state.sections.findIndex((s) => s.id === "notes")), 0, { id: p.id, title: p.title, body: p.body });
  state.dirty.add(p.id);
  state.proposals.splice(i, 1);
  renderSections(); renderProposals(); autosave();
  const el = $(`.sec[data-id="${CSS.escape(p.id)}"]`); if (el) { el.classList.add("flash"); }
}

// ---------------- 내보내기 ----------------
function download(blob, name) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const fileBase = () => `${(state.data?.company.name || "기업").replace(/[()（）주식회사\s]/g, "")}_경정청구`;
async function exportDocx() {
  readInputs();
  try { download(await buildDocx({ ...state, meta: { ...state.meta, date: new Date().toISOString().slice(0, 10) } }), `${fileBase()}_검토보고서.docx`); }
  catch (e) { console.error(e); toast("Word 생성 실패: " + e.message, 5000); }
}
async function exportPptx() {
  readInputs();
  try { download(await buildPptx({ ...state, meta: { ...state.meta, date: new Date().toISOString().slice(0, 10) } }), `${fileBase()}_미팅자료.pptx`); }
  catch (e) { console.error(e); toast("PPT 생성 실패: " + e.message, 5000); }
}

// ---------------- 설정 ----------------
function openSettings() {
  $("#setKey").value = settings.apiKey; $("#setRemember").checked = settings.remember;
  $("#setModel").innerHTML = MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join("");
  $("#setModel").value = settings.model; $("#setMaxTok").value = settings.maxTokens; $("#setProxy").value = settings.proxyUrl;
  $("#dlgSettings").showModal();
}

// ---------------- 이벤트 ----------------
function bind() {
  $("#fileXls").addEventListener("change", (e) => handleXls(e.target.files[0]));
  const drop = $("#drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => handleXls(e.dataTransfer.files[0]));
  $("#fileAttach").addEventListener("change", (e) => { handleAttach([...e.target.files]); e.target.value = ""; });
  $("#attachList").addEventListener("click", (e) => { const i = e.target.dataset.del; if (i !== undefined) { state.attachments.splice(Number(i), 1); renderAttachments(); } });

  $("#inputsPanel").addEventListener("input", () => { readInputs(); recompute({ keepSections: true }); });

  $$(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  // 섹션 편집
  $("#sections").addEventListener("input", (e) => {
    const art = e.target.closest(".sec"); if (!art) return;
    const s = state.sections.find((x) => x.id === art.dataset.id); if (!s) return;
    if (e.target.classList.contains("sec-text")) { s.body = e.target.value; $(".preview", art).innerHTML = renderHTML(s.body); }
    if (e.target.classList.contains("sec-title")) s.title = e.target.value;
    if (!state.dirty.has(s.id)) { state.dirty.add(s.id); const h = $(".sec-head", art); if (!$(".dirty", h)) h.querySelector(".sec-title").insertAdjacentHTML("afterend", `<span class="dirty">✎ 편집됨</span>`); }
    autosave();
  });
  $("#sections").addEventListener("click", (e) => {
    const act = e.target.dataset.act; if (!act) return;
    const id = e.target.closest(".sec").dataset.id;
    const i = state.sections.findIndex((x) => x.id === id);
    if (act === "del" && confirmDel(state.sections[i].title)) state.sections.splice(i, 1);
    if (act === "up" && i > 0) [state.sections[i - 1], state.sections[i]] = [state.sections[i], state.sections[i - 1]];
    if (act === "down" && i < state.sections.length - 1) [state.sections[i + 1], state.sections[i]] = [state.sections[i], state.sections[i + 1]];
    if (act === "ai") {
      const req = prompt(`'${state.sections[i].title}' 섹션을 어떻게 다듬을까요?`, "미팅 자료에 맞게 간결하고 설득력 있게 다듬어 주세요");
      if (req) runAI(`[섹션 ${id}] ${req}`, { edit: true, sectionId: id });
      return;
    }
    renderSections(); autosave();
  });
  $("#btnRegen").addEventListener("click", () => { NUMERIC_SECTIONS.forEach((id) => state.dirty.delete(id)); recompute({ keepSections: true }); toast("수치 섹션을 최신 계산값으로 다시 만들었습니다"); });
  $("#btnAddSec").addEventListener("click", () => { const id = "custom" + Date.now().toString(36); state.sections.push({ id, title: "새 섹션", body: "- 내용을 입력하세요" }); state.dirty.add(id); renderSections(); autosave(); });

  // AI
  $$(".quick button").forEach((b) => b.addEventListener("click", () => { const p = PROMPTS[b.dataset.ai]; runAI(p.text, { edit: p.edit }); }));
  $("#chatForm").addEventListener("submit", (e) => { e.preventDefault(); const t = $("#chatInput").value.trim(); if (!t) return; $("#chatInput").value = ""; runAI(t, { edit: $("#editMode").checked }); });
  $("#chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) $("#chatForm").requestSubmit(); });
  $("#btnStop").addEventListener("click", () => aborter?.abort());
  $("#proposals").addEventListener("click", (e) => {
    const d = e.target.dataset;
    if (d.propApply !== undefined) applyProposal(Number(d.propApply));
    if (d.propSkip !== undefined) { state.proposals.splice(Number(d.propSkip), 1); renderProposals(); }
    if (d.prop === "all") { while (state.proposals.length) applyProposal(0); toast("수정안을 모두 적용했습니다"); }
    if (d.prop === "none") { state.proposals = []; renderProposals(); }
  });

  // 내보내기 / 저장
  $("#btnDocx").addEventListener("click", exportDocx);
  $("#btnPptx").addEventListener("click", exportPptx);
  $("#btnSave").addEventListener("click", () => download(new Blob([JSON.stringify(serialize(true))], { type: "application/json" }), `${fileBase()}_프로젝트.json`));
  $("#fileProject").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { if (restore(JSON.parse(await f.text()))) toast("프로젝트를 불러왔습니다"); else toast("올바른 프로젝트 파일이 아닙니다"); } catch (err) { toast("불러오기 실패: " + err.message); }
    e.target.value = "";
  });

  // 설정
  $("#btnSettings").addEventListener("click", openSettings);
  $("#setSave").addEventListener("click", () => {
    settings.apiKey = $("#setKey").value.trim(); settings.remember = $("#setRemember").checked;
    settings.model = $("#setModel").value; settings.maxTokens = Number($("#setMaxTok").value) || 8000; settings.proxyUrl = $("#setProxy").value.trim();
    saveSettings(); toast("설정을 저장했습니다");
  });
}
const confirmDel = (t) => window.confirm(`'${t}' 섹션을 삭제할까요?`);

// ---------------- 시작 ----------------
loadSettings(); saveSettings(); bind();
const saved = ls.get(STORE_KEY);
if (saved && restore(saved)) toast("이전 작업을 불러왔습니다");

// 테스트·디버그용
window.__gj = { state, settings, recompute, exportDocx, exportPptx, runAI };
