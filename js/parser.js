// 한국평가데이터(KoDATA) 기업종합보고서 엑셀(xls/xlsx) 파서
// 브라우저에서는 전역 XLSX(SheetJS)를, 테스트에서는 주입된 XLSX를 사용합니다.

const STATEMENT_TITLES = ["재무상태표", "손익계산서", "현금흐름표", "자본변동표", "이익잉여금처분계산서", "제조원가명세서", "재무비율"];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const toNum = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/,/g, "").trim();
  if (s === "-" || s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** 워크북 → 시트별 행 배열 (원래 열 위치 유지) */
function readSheets(XLSX, data) {
  const wb = XLSX.read(data, { type: "array" });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: true }),
  }));
}

/** 빈 칸을 제거한 문자열 행 */
const compact = (row) => row.map(clean).filter((v) => v !== "");

export function parseKodata(XLSX, arrayBuffer) {
  const sheets = readSheets(XLSX, arrayBuffer);
  const flat = []; // 전체 행 (compact)
  sheets.forEach((s) => s.rows.forEach((r) => { const c = compact(r); if (c.length) flat.push(c); }));

  // ---------- 1. key-value (라벨 다음 칸) ----------
  const kv = (label) => {
    for (const r of flat) {
      const i = r.indexOf(label);
      if (i >= 0 && i + 1 < r.length) return r[i + 1];
    }
    return "";
  };
  const isLabelish = (v) => /^(영문기업명|법인\(주민\)번호|종업원수|설립년월|기업규모|팩스번호|이메일|기업공개일자|소속그룹|당좌거래은행)$/.test(v);
  const kvSafe = (label) => { const v = kv(label); return isLabelish(v) ? "" : v; };

  const company = {
    name: kvSafe("기업명") || (flat.find((r) => r[0] === "- 기업명 :") || [])[1] || "",
    bizNo: kvSafe("사업자번호"),
    ceo: kvSafe("대표자명") || (flat.find((r) => r[0] === "- 대표자 :") || [])[1] || "",
    employees: toNum(String(kvSafe("종업원수")).replace(/[^\d]/g, "")) || null,
    founded: kvSafe("설립년월"),
    foundType: kvSafe("설립형태"),
    size: kvSafe("기업규모"),
    address: kvSafe("주소").replace(/^\(\d{5}\)\s*/, ""),
    industry: kvSafe("표준산업분류(11차)") || kvSafe("표준산업분류(10차)"),
    product: kvSafe("주요제품(상품)"),
    mainBank: kvSafe("주채권기관"),
    fiscalMonth: toNum(String(kvSafe("결산월")).replace(/[^\d]/g, "")) || 12,
    vatType: kvSafe("휴폐업정보"),
  };
  const ind = /\(([A-Z]\d{4,5})\)\s*(.+)/.exec(company.industry);
  company.industryCode = ind ? ind[1] : "";
  company.industryName = ind ? ind[2] : company.industry;

  // ---------- 2. 기업인증 ----------
  const certs = {};
  const ci = flat.findIndex((r) => r[0] === "벤처" && r.includes("이노비즈"));
  if (ci >= 0 && flat[ci + 1]) flat[ci].forEach((k, i) => (certs[k] = flat[ci + 1][i] || ""));

  // ---------- 3. 주주 / 관계회사 / 거래처 ----------
  const section = (startTest, stopTest) => {
    const out = []; let on = false;
    for (const r of flat) {
      if (!on && startTest(r)) { on = true; continue; }
      if (on) { if (stopTest(r)) break; out.push(r); }
    }
    return out;
  };
  const stopCommon = (r) => /COPYRIGHT/.test(r[0]) || /현황$/.test(r[0]) && r.length <= 4 && !/^\d/.test(r[1] || "");

  const shareholders = section((r) => r[0] === "주주명", (r) => r[0] === "관계회사현황" || /COPYRIGHT/.test(r[0]))
    .filter((r) => r[0] !== "보통주" && r.length >= 2)
    .map((r) => ({ name: r[0], pct: toNum(r.find((v) => /^\d+(\.\d+)?$/.test(v))) ?? null, relation: r[r.length - 1] }))
    .filter((s) => s.name && s.name !== "기타");

  const related = section((r) => r[0] === "기업명" && r.includes("관계내용"), stopCommon)
    .map((r) => ({ name: r[0], business: r[1] || "", relation: r[2] || "" }));

  const parseParties = (title) => section((r) => r[0] === title, (r) => /COPYRIGHT/.test(r[0]) || r[0] === "판매처현황" || r[0] === "매출구성")
    .filter((r) => r[0] !== "기업명")
    .map((r) => ({ name: r[0], bizNo: /^\d{3}-\d{2}-\d{5}$/.test(r[1]) ? r[1] : "", share: toNum(r.find((v, i) => i >= 2 && /^\d+(\.\d+)?$/.test(v))) }));
  const purchasers = parseParties("구매처현황");
  const customers = parseParties("판매처현황");

  // ---------- 4. 재무제표 (천원) — 열 위치 기반 ----------
  const statements = {}; // { 손익계산서: { years:[], rows:{label:[..]} } }
  let cur = null, cols = null;
  for (const s of sheets) {
    for (const row of s.rows) {
      const c0 = clean(row[0]);
      const rowText = row.map(clean).join(" ");
      if (STATEMENT_TITLES.includes(c0) && /단위\s*:\s*천원/.test(rowText)) { cur = c0; cols = null; statements[cur] = statements[cur] || { years: [], rows: {} }; continue; }
      if (STATEMENT_TITLES.includes(c0) && !/천원/.test(rowText)) { cur = null; cols = null; continue; }
      if (!cur) continue;
      if (c0 === "계정명") {
        cols = [];
        row.forEach((v, i) => { const m = DATE_RE.exec(clean(v)); if (m) cols.push({ i, year: Number(m[1]) }); });
        if (!cols.length) { cols = null; continue; }
        statements[cur].years = cols.map((c) => c.year);
        continue;
      }
      if (!cols || !c0 || /COPYRIGHT|조회일시|감사의견/.test(c0)) continue;
      const label = c0.replace(/^\*/, "").replace(/\(\*\)$/, "").trim();
      const vals = cols.map((c) => toNum(row[c.i]));
      if (vals.every((v) => v === null)) continue;
      if (!(label in statements[cur].rows)) statements[cur].rows[label] = vals.map((v) => v ?? 0);
    }
  }

  const BS = statements["재무상태표"] || { years: [], rows: {} };
  const IS = statements["손익계산서"] || { years: [], rows: {} };
  const MC = statements["제조원가명세서"] || { years: [], rows: {} };
  const years = IS.years.length ? IS.years : BS.years;
  const pick = (st, ...labels) => {
    for (const l of labels) if (st.rows[l]) return alignYears(st, years, st.rows[l]);
    return years.map(() => 0);
  };
  function alignYears(st, ys, arr) { return ys.map((y) => { const i = st.years.indexOf(y); return i >= 0 ? arr[i] : 0; }); }

  const fin = {
    years,
    unit: "천원",
    revenue: pick(IS, "매출액"),
    operatingIncome: pick(IS, "영업이익(손실)"),
    pretaxIncome: pick(IS, "법인세비용차감전순손익", "법인세비용차감전순이익"),
    taxExpense: pick(IS, "법인세비용"),
    netIncome: pick(IS, "당기순이익(순손실)", "당기순이익"),
    sgaSalary: pick(IS, "급여", "직원급여"),
    mfgLabor: pick(MC, "노동관계비용", "급여"),
    rnd: pick(IS, "경상연구개발비", "연구개발비"),
    entertainment: pick(IS, "접대비", "기업업무추진비"),
    totalAssets: pick(BS, "자산"),
    totalLiabilities: pick(BS, "부채"),
    equity: pick(BS, "자본"),
    loansToOfficers: pick(BS, "가지급금", "주.임.종단기채권"),
    advances: pick(BS, "선급금"),
    machinery: pick(BS, "기계장치"),
    vehicles: pick(BS, "차량운반구"),
    incomeTaxPayable: pick(BS, "미지급법인세"),
    cash: pick(BS, "현금 및 현금성자산"),
  };
  fin.laborTotal = fin.sgaSalary.map((v, i) => v + (fin.mfgLabor[i] || 0));

  return { company, certs, shareholders, related, purchasers, customers, fin, statements, sheetCount: sheets.length };
}
