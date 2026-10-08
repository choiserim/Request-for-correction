// 미팅용 PPT(.pptx) 생성 — 전역 PptxGenJS 사용
// 수치 슬라이드는 계산 결과에서, 문장 슬라이드는 보고서 섹션(AI 수정 반영)에서 가져옵니다.
import { parseBlocks, bulletsOf, notesOf, stripMd } from "./report.js";
import { fmtM, range } from "./taxengine.js";

const F = "맑은 고딕";
const NAVY = "0B3C49", TEAL = "1B6F7A", AMBER = "C9811A", LIGHT = "EAF2F3", GRAY = "5F6B70", INK = "1F2A2E", RED = "B23A3A", WHITE = "FFFFFF", MID = "B7C7CA";
const cut = (s, n) => { s = stripMd(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const statusColor = (s) => /미충족|부인|불가/.test(s) ? RED : /확인/.test(s) ? AMBER : TEAL;

export async function buildPptx(state, PptxGenJS = window.PptxGenJS) {
  const { data, analysis: a, sections, meta } = state;
  const c = data.company, fin = data.fin;
  const sec = (id) => sections.find((s) => s.id === id)?.body || "";
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";
  pres.author = meta.author || "";
  pres.title = `${c.name} 법인세 경정청구 검토`;
  pres.theme = { headFontFace: F, bodyFontFace: F };
  pres.defineSlideMaster({
    title: "CONTENT", background: { color: WHITE },
    objects: [{ text: { text: `${c.name} 경정청구 검토${meta.author ? " · " + meta.author : ""}`, options: { x: 0.6, y: 7.0, w: 8, h: 0.3, fontFace: F, fontSize: 10, color: GRAY, margin: 0 } } }],
    slideNumber: { x: 12.2, y: 7.0, w: 0.6, h: 0.3, fontFace: F, fontSize: 10, color: GRAY, align: "right" },
  });
  pres.defineSlideMaster({ title: "DARK", background: { color: NAVY }, objects: [] });

  const txt = (s, text, o) => s.addText(text, Object.assign({ fontFace: F, fontSize: 14, color: INK, margin: 0, valign: "top", isTextBox: true }, o));
  const title = (s, t1, sub) => { txt(s, cut(t1, 40), { x: 0.6, y: 0.4, w: 12.1, h: 0.75, fontSize: 30, bold: true, color: NAVY }); if (sub) txt(s, cut(sub, 80), { x: 0.6, y: 1.12, w: 12.1, h: 0.4, fontSize: 15, color: TEAL }); };
  const card = (s, x, y, w, h, fill = LIGHT) => s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: fill }, line: { color: fill }, rectRadius: 0.12 });
  const badge = (s, x, y, n, fill = TEAL, d = 0.5) => {
    s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill } });
    txt(s, String(n), { x, y, w: d, h: d, fontSize: d > 0.45 ? 16 : 12, bold: true, color: WHITE, align: "center", valign: "middle" });
  };
  const hdr = (arr) => arr.map((v) => ({ text: v, options: { bold: true, color: WHITE, fill: { color: NAVY }, align: "center" } }));
  const tblOpt = (o) => Object.assign({ fontFace: F, fontSize: 13, color: INK, border: { type: "solid", pt: 0.75, color: MID }, valign: "middle", margin: [0.03, 0.1, 0.03, 0.1] }, o);
  const chartBase = () => ({
    barDir: "col", showValue: true, dataLabelPosition: "outEnd", dataLabelFontSize: 11, dataLabelColor: INK, dataLabelFontFace: "+mn-lt",
    catAxisLabelColor: GRAY, valAxisLabelColor: GRAY, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", catAxisLabelFontSize: 12, valAxisLabelFontSize: 11,
    valGridLine: { color: "E3E8EA", size: 0.5 }, catGridLine: { style: "none" }, showLegend: true, legendPos: "t", legendFontSize: 11, legendFontFace: "+mn-lt",
    showTitle: true, titleFontSize: 13, titleColor: NAVY, titleFontFace: "+mn-lt",
  });
  const yLabels = fin.years.map((y, i) => (a.rows[i].months < 12 ? `${y} (${a.rows[i].months}개월)` : String(y)));
  const M = (v) => Math.round(v / 100) / 10; // 천원 → 백만원
  const prim = a.scen[a.primary];

  // 1. 표지
  {
    const s = pres.addSlide({ masterName: "DARK" });
    s.addShape(pres.shapes.OVAL, { x: 9.3, y: -1.2, w: 5.5, h: 5.5, fill: { color: TEAL, transparency: 55 }, line: { color: TEAL, transparency: 100 } });
    s.addShape(pres.shapes.OVAL, { x: 10.9, y: 3.6, w: 3.2, h: 3.2, fill: { color: AMBER, transparency: 70 }, line: { color: AMBER, transparency: 100 } });
    txt(s, "법인세 경정청구 검토", { x: 0.8, y: 2.0, w: 9, h: 0.9, fontSize: 40, bold: true, color: WHITE });
    txt(s, `${c.name} — 세액감면 적용 가능성과 근거`, { x: 0.8, y: 2.95, w: 9.5, h: 0.5, fontSize: 18, color: "CFE3E6" });
    txt(s, `검토 대상: ${fin.years.join(" · ")} 사업연도`, { x: 0.8, y: 4.3, w: 8, h: 0.4, color: WHITE });
    txt(s, `${meta.date}   ${meta.author || ""}`, { x: 0.8, y: 4.75, w: 8, h: 0.4, color: WHITE });
    txt(s, `기초자료: ${meta.sourceName || "한국평가데이터 기업종합보고서"}`, { x: 0.8, y: 6.6, w: 10, h: 0.3, fontSize: 11, color: "9FBFC4" });
  }

  // 2. 결론
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    title(s, `결론: ${a.verdict}`, notesOf(sec("summary"))[1] || `기본안 ${a.primary}. ${prim.label}`);
    const claimable = a.rows.filter((r) => r.calc > 0);
    const stats = [
      [range(prim.net, prim.gross).replace(/원/g, ""), `예상 환급액 (원, ${prim.label})`, AMBER],
      [`${claimable.length}개 연도`, `${claimable.map((r) => r.year).join(" · ")} 청구 가능`, TEAL],
      [`${(claimable[0]?.claimDue || "").slice(0, 4)}년~`, "가장 이른 청구 기한", NAVY],
    ];
    stats.forEach(([n, l, col], i) => {
      const x = 0.6 + i * 4.1;
      card(s, x, 1.85, 3.8, 2.0);
      txt(s, n, { x: x + 0.3, y: 2.05, w: 3.3, h: 1.0, fontSize: i === 0 ? 22 : 32, bold: true, color: col, valign: "middle", fit: "shrink" });
      txt(s, l, { x: x + 0.3, y: 3.1, w: 3.3, h: 0.55, fontSize: 13, color: GRAY });
    });
    bulletsOf(sec("summary")).slice(-4).slice(0, 4).forEach((b, i) => {
      const y = 4.15 + i * 0.68;
      badge(s, 0.6, y + 0.04, i + 1, i === 3 ? RED : TEAL, 0.44);
      txt(s, cut(b, 120), { x: 1.25, y, w: 11.5, h: 0.55, fontSize: 14, valign: "middle", fit: "shrink" });
    });
  }

  // 3. 기업 개요
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    title(s, "기업 개요", "감면 요건과 직접 연결되는 항목");
    const tb = parseBlocks(sec("company")).find((b) => b.type === "table");
    const rows = (tb ? tb.rows.slice(1) : []).slice(0, 9);
    if (rows.length) s.addTable(rows.map((r) => [
      { text: cut(r[0] || "", 10), options: { bold: true, fill: { color: LIGHT }, color: NAVY } },
      { text: cut(r.slice(1).join(" "), 46), options: { color: /관계회사/.test(r[0]) && a.sameIndustryRelated.length ? RED : INK, bold: /관계회사/.test(r[0]) && a.sameIndustryRelated.length > 0 } },
    ]), tblOpt({ x: 0.6, y: 1.75, w: 7.4, colW: [1.6, 5.8], rowH: 0.52, fontSize: 13 }));
    card(s, 8.3, 1.75, 4.45, 4.9);
    txt(s, "감면 요건 연결 포인트", { x: 8.6, y: 1.95, w: 4, h: 0.4, fontSize: 17, bold: true, color: NAVY });
    a.checks.forEach((k, i) => {
      const y = 2.55 + i * 0.66;
      const ok = /^충족/.test(k.status);
      badge(s, 8.6, y, ok ? "✓" : "?", ok ? TEAL : statusColor(k.status), 0.42);
      txt(s, `${k.item} — ${k.status}`, { x: 9.2, y, w: 3.4, h: 0.42, fontSize: 13, valign: "middle", fit: "shrink" });
    });
  }

  // 4. 실적
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    const L = fin.years.length - 1;
    title(s, "재무 실적 추이", `매출 ${fmtM(fin.revenue[0])} → ${fmtM(fin.revenue[L])}백만원, 세전이익 ${fmtM(fin.pretaxIncome[L])}백만원 (${fin.years[L]})`);
    s.addChart(pres.charts.BAR, [
      { name: "매출액", labels: yLabels, values: fin.revenue.map(M) },
      { name: "세전이익", labels: yLabels, values: fin.pretaxIncome.map(M) },
    ], Object.assign(chartBase(), { x: 0.6, y: 1.75, w: 7.6, h: 4.9, barGapWidthPct: 60, chartColors: [TEAL, AMBER], title: "매출액 · 법인세차감전순이익 (백만원)" }));
    const opm = fin.revenue[L] ? (fin.operatingIncome[L] / fin.revenue[L] * 100).toFixed(1) + "%" : "-";
    const debt = fin.equity[L] ? (fin.totalLiabilities[L] / fin.equity[L] * 100).toFixed(1) + "%" : "-";
    [[opm, "영업이익률"], [debt, "부채비율"], [`${fmtM(fin.loansToOfficers[L])}백만`, "가지급금 (기말)"]].forEach(([n, l], i) => {
      const y = 1.85 + i * 1.6;
      card(s, 8.6, y, 4.15, 1.35);
      txt(s, n, { x: 8.9, y: y + 0.15, w: 3.6, h: 0.65, fontSize: 28, bold: true, color: i === 2 && fin.loansToOfficers[L] > 0 ? RED : NAVY });
      txt(s, l, { x: 8.9, y: y + 0.82, w: 3.6, h: 0.4, fontSize: 13, color: GRAY });
    });
  }

  // 5. 세액 비교
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    title(s, "실제 납부세액 vs 감면 적용 시 세액", "법인세비용 역산 결과 — 두 막대의 차이가 환급 가능 규모");
    const k = a.primary;
    s.addChart(pres.charts.BAR, [
      { name: "감면 전 산출세액", labels: fin.years.map(String), values: a.rows.map((r) => M(r.calc)) },
      { name: "실제 납부 추정 (법인세비용÷1.1)", labels: fin.years.map(String), values: a.rows.map((r) => M(r.paidEst)) },
      { name: `${a.scen[k].label} 적용 시`, labels: fin.years.map(String), values: a.rows.map((r) => M(r.calc - r[k])) },
    ], Object.assign(chartBase(), { x: 0.6, y: 1.75, w: 7.8, h: 4.95, barGapWidthPct: 50, chartColors: [MID, NAVY, AMBER], dataLabelFormatCode: "0.0", title: "법인세 비교 (백만원)" }));
    card(s, 8.8, 1.85, 3.95, 4.8);
    txt(s, "연도별 판단", { x: 9.1, y: 2.05, w: 3.4, h: 0.4, fontSize: 17, bold: true, color: NAVY });
    a.rows.forEach((r, i) => {
      txt(s, [{ text: `${r.year}년`, options: { bold: true, breakLine: true } }, { text: r.signal, options: { color: /미적용/.test(r.signal) ? RED : INK } }],
        { x: 9.1, y: 2.65 + i * 1.0, w: 3.4, h: 0.85, fontSize: 14 });
    });
  }

  // 6. 요건 점검
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    title(s, "창업중소기업 세액감면 요건 점검", "조세특례제한법 제6조 · 시행령 제5조");
    const rows = [hdr(["요건", "법령 기준", "현황", "판단"]), ...a.checks.map((k) => [
      k.item, cut(k.rule, 40), cut(k.fact, 40), { text: k.status, options: { bold: true, color: statusColor(k.status), align: "center" } },
    ])];
    s.addTable(rows, tblOpt({ x: 0.6, y: 1.8, w: 12.13, colW: [1.8, 4.2, 4.2, 1.93], rowH: 0.62, fontSize: 13 }));
  }

  // 7. 시나리오
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    title(s, "예상 환급세액: 시나리오별 비교", "법인세 본세 기준 · 국세환급가산금 별도");
    const desc = { A: "기본안 — 창업 해당성 확인 시", B: "대표자 창업 당시 만 34세 이하", C: "창업 불인정 시 대안" };
    ["A", "B", "C"].forEach((k, i) => {
      const x = 0.6 + i * 4.1, sc = a.scen[k], on = k === a.primary;
      card(s, x, 1.8, 3.8, 3.3, on ? "FBF1E2" : LIGHT);
      badge(s, x + 0.3, 2.05, k, on ? AMBER : i === 2 ? GRAY : TEAL);
      txt(s, sc.label, { x: x + 0.95, y: 2.05, w: 2.7, h: 0.5, fontSize: 16, bold: true, color: NAVY, valign: "middle", fit: "shrink" });
      txt(s, range(sc.net, sc.gross).replace(" ~ ", " ~\n"), { x: x + 0.3, y: 2.8, w: 3.3, h: 1.3, fontSize: 24, bold: true, color: on ? AMBER : TEAL, valign: "middle" });
      txt(s, desc[k], { x: x + 0.3, y: 4.3, w: 3.3, h: 0.6, fontSize: 13, color: GRAY });
    });
    const rows = [hdr(["감면액 (백만원)", ...fin.years.map(String), "합계"]), ...["A", "B", "C"].map((k) => [
      `${k}. ${a.scen[k].label}`, ...a.rows.map((r) => fmtM(r[k])), { text: fmtM(a.scen[k].gross), options: { bold: true, color: k === a.primary ? AMBER : INK } },
    ])];
    const n = fin.years.length + 2, first = 3.3, rest = (12.13 - first) / (n - 1);
    s.addTable(rows, tblOpt({ x: 0.6, y: 5.3, w: 12.13, colW: [first, ...Array(n - 1).fill(rest)], rowH: 0.36, fontSize: 12, align: "center" }));
  }

  // 8. 기타 공제
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    title(s, "함께 검토한 공제·감면 항목", "중복 배제를 고려해 유리한 조합으로 선택");
    a.others.slice(0, 4).forEach((o, i) => {
      const y = 1.8 + i * 1.22;
      badge(s, 0.6, y + 0.15, i + 1, i === 0 ? AMBER : i === 1 ? TEAL : GRAY);
      txt(s, o.name, { x: 1.35, y: y + 0.05, w: 6.9, h: 0.4, fontSize: 16, bold: true, color: NAVY });
      txt(s, cut(o.desc, 110), { x: 1.35, y: y + 0.45, w: 6.9, h: 0.7, fontSize: 13, fit: "shrink" });
      card(s, 8.5, y + 0.1, 4.25, 0.95);
      txt(s, cut(o.note, 50), { x: 8.7, y: y + 0.1, w: 3.9, h: 0.95, fontSize: 13, bold: true, color: NAVY, valign: "middle", fit: "shrink" });
    });
  }

  // 9. 쟁점·리스크 (섹션 글머리 → 카드)
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    title(s, "핵심 쟁점과 함께 정리할 리스크", "청구 시 세무서가 해당 연도 신고 전체를 다시 봅니다");
    const items = bulletsOf(sec("issues")).slice(0, 6);
    const cols = 2, h = items.length > 4 ? 1.5 : 2.25;
    items.forEach((b, i) => {
      const x = 0.6 + (i % cols) * 6.15, y = 1.75 + Math.floor(i / cols) * (h + 0.2);
      const [head, ...rest] = b.split(/:\s/);
      const body = rest.join(": ");
      const cutAt = body.lastIndexOf("→"); // 마지막 화살표 뒤 = 대응 방안
      const d = (cutAt > 0 ? body.slice(0, cutAt) : body).trim();
      const act = cutAt > 0 ? body.slice(cutAt + 1).trim() : "";
      card(s, x, y, 5.95, h);
      txt(s, cut(rest.length ? head : b, 30), { x: x + 0.3, y: y + 0.15, w: 5.4, h: 0.42, fontSize: 16, bold: true, color: i === 0 ? RED : NAVY, fit: "shrink" });
      if (rest.length) txt(s, cut(d, 90), { x: x + 0.3, y: y + 0.6, w: 5.4, h: h - 1.05, fontSize: 12, fit: "shrink" });
      if (act) txt(s, "→ " + cut(act, 45), { x: x + 0.3, y: y + h - 0.45, w: 5.4, h: 0.35, fontSize: 12, bold: true, color: TEAL });
    });
  }

  // 10. 준비서류
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    title(s, "준비서류 체크리스트", "회사 준비 자료와 작성 서류");
    const docs = bulletsOf(sec("docs")).slice(0, 12);
    const half = Math.ceil(docs.length / 2);
    [docs.slice(0, half), docs.slice(half)].forEach((arr, ci) => arr.forEach((it, i) => {
      const x = 0.6 + ci * 6.3, y = 1.8 + i * 0.82;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: y + 0.12, w: 0.34, h: 0.34, fill: { color: WHITE }, line: { color: TEAL, width: 1.5 }, rectRadius: 0.06 });
      txt(s, cut(it, 70), { x: x + 0.55, y, w: 5.45, h: 0.6, fontSize: 13, valign: "middle", fit: "shrink" });
    }));
  }

  // 11. 절차
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    title(s, "진행 절차와 일정", "자료 수령 후 약 4~5주 내 청구, 세무서 처리 2개월");
    const tb = parseBlocks(sec("process")).find((b) => b.type === "table");
    const st = (tb ? tb.rows.slice(1) : []).slice(0, 6);
    const step = st.length ? 12.13 / st.length : 2;
    s.addShape(pres.shapes.LINE, { x: 1.0, y: 2.75, w: 11.2, h: 0, line: { color: MID, width: 2 } });
    st.forEach((r, i) => {
      const x = 0.6 + i * step;
      badge(s, x + 0.25, 2.45, i + 1, i === 3 ? AMBER : TEAL, 0.6);
      txt(s, cut((r[0] || "").replace(/^\d+\.\s*/, ""), 10), { x, y: 3.25, w: step - 0.1, h: 0.45, fontSize: 16, bold: true, color: NAVY });
      txt(s, cut(r[1] || "", 40), { x, y: 3.75, w: step - 0.2, h: 1.0, fontSize: 12, fit: "shrink" });
      txt(s, cut(r[2] || "", 12), { x, y: 4.8, w: step - 0.2, h: 0.4, fontSize: 13, bold: true, color: TEAL });
    });
  }

  // 12. 근거 법령
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    title(s, "근거 법령 · 예규", "미팅 시 근거자료로 제시");
    const tb = parseBlocks(sec("laws")).find((b) => b.type === "table");
    const rows = (tb ? tb.rows.slice(1) : []).slice(0, 9);
    s.addTable([hdr(["근거", "주요 내용"]), ...rows.map((r) => [{ text: cut(r[0], 30), options: { bold: true, color: NAVY, fill: { color: LIGHT } } }, cut(r.slice(1).join(" "), 70)])],
      tblOpt({ x: 0.6, y: 1.7, w: 12.13, colW: [3.8, 8.33], rowH: 0.5 }));
  }

  // 13. 다음 단계
  {
    const s = pres.addSlide({ masterName: "DARK" });
    txt(s, "다음 단계 제안", { x: 0.8, y: 0.7, w: 10, h: 0.8, fontSize: 32, bold: true, color: WHITE });
    bulletsOf(sec("next")).slice(0, 5).forEach((b, i) => {
      const y = 1.8 + i * 0.95;
      const [k, ...rest] = b.split(/:\s/);
      const has = rest.length && k.length <= 8;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.8, y, w: 1.6, h: 0.7, fill: { color: i === 3 ? AMBER : TEAL }, line: { color: i === 3 ? AMBER : TEAL }, rectRadius: 0.1 });
      txt(s, has ? k : String(i + 1), { x: 0.8, y, w: 1.6, h: 0.7, fontSize: 15, bold: true, color: WHITE, align: "center", valign: "middle" });
      txt(s, cut(has ? rest.join(": ") : b, 90), { x: 2.7, y, w: 9.8, h: 0.7, fontSize: 16, color: WHITE, valign: "middle", fit: "shrink" });
    });
    txt(s, "본 자료는 요약 재무정보 기반의 사전 검토이며, 최종 세액은 신고서 확인 및 세무사 검토로 확정됩니다.", { x: 0.8, y: 6.6, w: 11.7, h: 0.4, fontSize: 11, color: "9FBFC4" });
  }

  return pres.write({ outputType: "blob" });
}
