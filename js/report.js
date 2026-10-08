// 보고서 섹션 모델 — Word/PPT/AI 수정이 모두 이 섹션 텍스트를 공유합니다.
// 섹션 본문 표기법 (간단 마크업)
//   일반 줄           → 문단
//   "- " 로 시작      → 글머리 기호
//   "| a | b |" 연속  → 표 (첫 줄이 머리글)
//   "> " 로 시작      → 강조 박스(주석)
//   "## " 로 시작     → 소제목
import { fmtM, range } from "./taxengine.js";

const m = (v) => fmtM(v);
const pct = (v) => `${(v * 100).toFixed(1)}%`;

export function buildSections(data, a) {
  const { company: c, fin } = data;
  const y = fin.years;
  const prim = a.scen[a.primary];
  const sh = data.shareholders.map((s) => `${s.name} ${s.pct ?? "-"}%`).join(", ");
  const rel = data.related.length ? data.related.map((r) => `${r.name} (${r.business}, ${r.relation})`).join("; ") : "없음";
  const certs = Object.entries(data.certs).map(([k, v]) => `${k} ${v}`).join(", ") || "-";
  const row = (label, arr, f = m) => `| ${label} | ${arr.map(f).join(" | ")} |`;
  const hdrYears = `| 구분 (백만원) | ${y.map((yy, i) => (a.rows[i].months < 12 ? `${yy} (${a.rows[i].months}개월)` : yy)).join(" | ")} |`;

  const S = [];
  S.push({ id: "summary", title: "검토 결론 요약", body: [
    `> 결론: ${a.verdict}`,
    `- ${c.name}는 ${c.founded} ${c.address.split(" ").slice(0, 2).join(" ")}(${a.region.overcrowded === true ? "수도권과밀억제권역 내" : a.region.overcrowded === "check" ? "과밀억제권역 여부 확인 필요" : "수도권과밀억제권역 외"})에 설립된 ${c.industryName} 법인으로, 조특법 제6조 창업중소기업 세액감면 검토 대상입니다.`,
    ...a.rows.filter((r) => r.calc > 0).map((r) => `- ${r.year}년: 감면 전 산출세액 ${m(r.calc)}백만원, 법인세비용 역산 납부액 ${m(r.paidEst)}백만원 → ${r.signal}`),
    `- 감면기간은 ${a.foundedYear}~${a.foundedYear + 4} 사업연도이며, 경정청구 기한(법정신고기한 후 5년)이 ${a.rows.filter((r) => r.calc > 0).map((r) => r.year).join("·")}년 모두 남아 있습니다.`,
    a.sameIndustryRelated.length ? `- 다만 동일 업종 관계회사 '${a.sameIndustryRelated[0].name}'가 있어 '새로운 창업'으로 인정되는지가 핵심 쟁점입니다.` : `- 관계회사 관련 승계 이슈는 확인되지 않았습니다(신고서·등기 확인 필요).`,
    `| 시나리오 | 예상 환급 (법인세 본세) | 비고 |`,
    `| A. ${a.scen.A.label} | ${range(a.scen.A.net, a.scen.A.gross)} | 최저한세 반영, 하한은 기적용 공제·감면 추정분 차감 |`,
    `| B. ${a.scen.B.label} | ${range(a.scen.B.net, a.scen.B.gross)} | 대표자 창업 당시 만 34세 이하 + 최대주주 |`,
    `| C. ${a.scen.C.label} | ${range(a.scen.C.net, a.scen.C.gross)} | 창업 불인정 시 대안 |`,
    `> 기본안: ${a.primary}. ${prim.label} — 예상 환급 ${range(prim.net, prim.gross)} (국세환급가산금 별도, 법인지방소득세 별도 검토)`,
  ].join("\n") });

  S.push({ id: "company", title: "기업 개요", body: [
    `| 항목 | 내용 |`,
    `| 기업명 | ${c.name} (대표 ${c.ceo}) |`,
    `| 사업자번호 | ${c.bizNo} |`,
    `| 설립 | ${c.founded} ${c.foundType} |`,
    `| 업종 | ${c.industry} / 주요제품 ${c.product || "-"} |`,
    `| 소재지 | ${c.address} |`,
    `| 규모 | ${c.size} · 종업원 ${c.employees ?? "-"}명 |`,
    `| 주주 | ${sh || "-"} |`,
    `| 주 판매처 | ${data.customers.slice(0, 2).map((x) => `${x.name} ${x.share ?? "-"}%`).join(", ") || "-"} |`,
    `| 관계회사 | ${rel} |`,
    `| 기업인증 | ${certs} |`,
  ].join("\n") });

  S.push({ id: "finance", title: "재무·세무 현황 분석", body: [
    "## 3개년 주요 재무지표",
    hdrYears,
    row("매출액", fin.revenue), row("영업이익", fin.operatingIncome), row("법인세비용차감전순이익", fin.pretaxIncome),
    row("법인세비용", fin.taxExpense), row("당기순이익", fin.netIncome),
    `| 법인세부담률 | ${a.rows.map((r) => pct(r.taxRatio)).join(" | ")} |`,
    row("가지급금", fin.loansToOfficers), row("인건비 합계", fin.laborTotal),
    "## 법인세비용 역산을 통한 감면 적용 여부 추정",
    `| 구분 (백만원) | ${y.join(" | ")} |`,
    `| ① 감면 전 산출세액 | ${a.rows.map((r) => m(r.calc)).join(" | ")} |`,
    `| ② 법인세비용 ÷ 1.1 | ${a.rows.map((r) => m(r.paidEst)).join(" | ")} |`,
    `| ③ 기적용 공제·감면 | ${a.rows.map((r) => `${m(r.existing)} (${r.existingSource})`).join(" | ")} |`,
    `| ④ 창업감면 가능액 | ${a.rows.map((r) => m(r.A)).join(" | ")} |`,
    `| 판단 | ${a.rows.map((r) => r.signal).join(" | ")} |`,
    "> 가정: 과세표준 = 법인세비용차감전순이익, 법인세비용에 지방소득세 10% 포함. 1년 미만 사업연도는 법인세법 §55②에 따라 연환산. 최저한세 = 과세표준 × 7%.",
  ].join("\n") });

  S.push({ id: "system", title: "경정청구 제도 개요", body: [
    "| 구분 | 내용 |",
    "| 근거 | 국세기본법 제45조의2 (경정 등의 청구) |",
    "| 대상 | 신고세액이 세법상 세액을 초과하는 경우 (감면·공제 누락 포함) |",
    "| 청구 기한 | 법정신고기한이 지난 후 5년 이내 |",
    "| 처리 기한 | 청구일로부터 2개월 이내 결정·통지 |",
    "| 환급 | 환급세액 + 국세환급가산금 |",
    "| 감면신청서 미제출 | 요건 충족 시 경정청구로 감면 적용 가능 (감면신청은 협력의무) |",
    "| 지방소득세 | 관할 지방자치단체에 별도 경정청구 |",
    "## 연도별 청구 기한",
    "| 사업연도 | 법정신고기한 | 경정청구 기한 |",
    ...a.rows.map((r) => `| ${r.year}${r.months < 12 ? ` (${r.months}개월)` : ""} | ${r.filingDue} | ${r.claimDue} |`),
  ].join("\n") });

  S.push({ id: "items", title: "경정청구 항목별 검토", body: [
    "## 창업중소기업 등에 대한 세액감면 (조특법 제6조)",
    "| 요건 | 법령 기준 | 현황 | 판단 |",
    ...a.checks.map((k) => `| ${k.item} | ${k.rule} | ${k.fact} | ${k.status} |`),
    "- 50% 감면은 최저한세 적용 대상, 100% 감면 과세연도는 최저한세 배제 (조특법 §132)",
    "## 기타 공제·감면",
    ...a.others.map((o) => `- ${o.name}: ${o.desc} → ${o.note}`),
  ].join("\n") });

  S.push({ id: "refund", title: "예상 환급세액 추정", body: [
    `| 구분 (백만원) | ${y.join(" | ")} | 합계 |`,
    `| 감면 전 산출세액 | ${a.rows.map((r) => m(r.calc)).join(" | ")} | ${m(a.rows.reduce((s, r) => s + r.calc, 0))} |`,
    `| 최저한세 | ${a.rows.map((r) => m(r.minTax)).join(" | ")} | ${m(a.rows.reduce((s, r) => s + r.minTax, 0))} |`,
    ...["A", "B", "C"].flatMap((k) => [
      `| ${k}. ${a.scen[k].label} | ${a.rows.map((r) => m(r[k])).join(" | ")} | ${m(a.scen[k].gross)} |`,
      `| (기적용분 차감 후) | ${a.rows.map((r) => m(r["net" + k])).join(" | ")} | ${m(a.scen[k].net)} |`,
    ]),
    "> 실제 과세표준(세무조정 후)·이월결손금·기적용 공제감면에 따라 달라집니다. 신고서 값을 입력하면 즉시 재계산됩니다.",
  ].join("\n") });

  S.push({ id: "issues", title: "핵심 쟁점 및 리스크", body: [
    ...a.risks.map((r) => `- ${r.title}: ${r.desc} → ${r.action}`),
    a.sameIndustryRelated.length ? "## 창업 해당성 확인 사항" : "",
    ...(a.sameIndustryRelated.length ? [
      `- ${a.sameIndustryRelated[0].name}가 계속 사업 중인 독립 사업체인가 (폐업 후 이전이면 재개업)`,
      "- 기계·비품을 신규 취득했는가 (자산 인수 시 승계)",
      `- 주 판매처${data.customers[0] ? `(${data.customers[0].name})` : ""}가 관계회사의 기존 거래처였는가`,
      "- 직원이 관계회사에서 옮겨왔는가",
      "- 사업장·제품이 분리되어 있는가",
    ] : []),
  ].filter(Boolean).join("\n") });

  S.push({ id: "docs", title: "준비서류 체크리스트", body: [
    `- ${y[0]}~${y[y.length - 1]} 법인세 신고서 일체 (세무조정계산서, 공제감면세액합계표, 최저한세조정계산서)`,
    "- 경정청구서 (국세기본법 시행규칙 별지 제16호의2)",
    "- 세액감면신청서 (조특법 시행규칙 별지 제2호) 및 수정 세액조정계산서",
    "- 법인등기사항전부증명서, 정관, 주주명부",
    "- 사업자등록증명, 사업장 임대차계약서",
    "- 대표자 생년월일 확인 서류 (병역 이행 시 병적증명서)",
    "- 설립 시 기계·비품 취득 세금계산서",
    data.related.length ? "- 관계회사 사업자등록·거래처·자산 비교자료" : "",
    "- 4대보험 가입자 명부, 원천세 신고서 (월별 인원)",
    "- 표준재무제표증명 (3개년)",
  ].filter(Boolean).join("\n") });

  S.push({ id: "process", title: "진행 절차 및 일정", body: [
    "| 단계 | 내용 | 기간 |",
    "| 1. 자료 수집 | 신고서·등기·관계회사 자료 확보 | 1주 |",
    "| 2. 사전 검토 | 창업 해당성 판단, 기적용 공제·감면 확인, 리스크 점검 | 1~2주 |",
    "| 3. 세액 재계산 | 시나리오 확정, 최저한세·중복배제 반영 | 1주 |",
    "| 4. 경정청구 | 세무대리인 홈택스 제출 | 1일 |",
    "| 5. 세무서 검토 | 보완 요청 대응, 사실관계 소명 | 2개월 내 |",
    "| 6. 환급 | 환급금·가산금 수령, 잔여 감면기간 지속 적용 | 결정 후 |",
  ].join("\n") });

  S.push({ id: "laws", title: "근거 법령·예규", body: [
    "| 근거 | 주요 내용 |",
    "| 국세기본법 §45의2 | 법정신고기한 후 5년 이내 경정청구, 2개월 내 처리 |",
    "| 조특법 §6 ①·⑩ | 창업중소기업 감면 (과밀억제권역 외 50%·청년 100%, 5년) / 창업 제외 사유 |",
    "| 조특법 시행령 §5 | 청년: 15~34세(병역 최대 6년 차감), 법인은 대표자·최대주주 |",
    "| 조특법 §7 | 중소기업 특별세액감면 (소기업·수도권 외·제조업 30%, 한도 1억) |",
    "| 조특법 §29의8 | 통합고용세액공제 |",
    "| 조특법 §127 · §132 | 감면·공제 중복 배제 / 최저한세 |",
    "| 법인세법 §55 | 세율, 1년 미만 사업연도 연환산 |",
    "| 법인세과-380 (2014) | 개인사업 계속 중 과밀억제권역 외 별도 법인 설립 → 창업 해당 |",
    "| 서면-2020-법인-1374 | 요건 충족 시 별도 법인도 창업, 승계 시 불인정 |",
    "| 조심2021인3259 | 매출처·자산 동일 → 법인 전환으로 보아 감면 부인 |",
    "| 서면-2024-법인-0070 | 창업 추가감면(§6⑦)과 고용증대세액공제 동시 적용 불가 |",
  ].join("\n") });

  S.push({ id: "next", title: "다음 단계 제안", body: [
    `- 즉시: ${y[0]}~${y[y.length - 1]} 법인세 신고서·주주명부·관계회사 자료 전달 → 창업 해당성 사전 판단`,
    "- 2주 내: 시나리오별 환급액 확정 및 리스크 정리안 보고",
    "- 확정 후: 세무대리인을 통한 일괄 경정청구",
    `- 추가 제안: ${data.certs["부설연구소"] === "미인증" ? "기업부설연구소 설립(R&D 25% 공제), " : ""}${fin.loansToOfficers[fin.loansToOfficers.length - 1] > 0 ? "가지급금 정리, " : ""}벤처·이노비즈 인증`,
  ].join("\n") });

  S.push({ id: "notes", title: "유의사항", body: [
    "- 본 자료는 한국평가데이터 요약 재무정보 기반의 사전 검토이며 실제 세무조정 내역과 다를 수 있습니다.",
    "- 경정청구 제출은 세무대리인(세무사)을 통해 진행해야 합니다.",
    `- 법령·해석은 작성일(${new Date().toISOString().slice(0, 10)}) 기준이며 제출 전 재확인이 필요합니다.`,
  ].join("\n") });
  return S;
}

// ---------- 간단 마크업 → 블록 ----------
export function parseBlocks(body = "") {
  const lines = body.split(/\r?\n/);
  const blocks = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((s) => s.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // markdown 구분선 무시
      const last = blocks[blocks.length - 1];
      if (last && last.type === "table") last.rows.push(cells); else blocks.push({ type: "table", rows: [cells] });
    } else if (/^\s*[-*•]\s+/.test(line)) blocks.push({ type: "bullet", text: line.replace(/^\s*[-*•]\s+/, "") });
    else if (/^>\s?/.test(line)) blocks.push({ type: "note", text: line.replace(/^>\s?/, "") });
    else if (/^#{1,4}\s+/.test(line)) blocks.push({ type: "h", text: line.replace(/^#+\s+/, "") });
    else blocks.push({ type: "p", text: line.trim() });
  }
  return blocks;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

export function renderHTML(body) {
  let html = "", inList = false;
  for (const b of parseBlocks(body)) {
    if (b.type !== "bullet" && inList) { html += "</ul>"; inList = false; }
    if (b.type === "bullet") { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(b.text)}</li>`; }
    else if (b.type === "p") html += `<p>${inline(b.text)}</p>`;
    else if (b.type === "h") html += `<h4>${inline(b.text)}</h4>`;
    else if (b.type === "note") html += `<div class="note">${inline(b.text)}</div>`;
    else if (b.type === "table") {
      const [h, ...rest] = b.rows;
      html += `<div class="tbl"><table><thead><tr>${h.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rest.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
  }
  if (inList) html += "</ul>";
  return html;
}

/** 섹션 본문에서 글머리 줄만 추출 (PPT 슬라이드용) */
export const bulletsOf = (body) => parseBlocks(body).filter((b) => b.type === "bullet").map((b) => b.text);
export const notesOf = (body) => parseBlocks(body).filter((b) => b.type === "note").map((b) => b.text);
export const stripMd = (s) => String(s).replace(/\*\*(.+?)\*\*/g, "$1");
