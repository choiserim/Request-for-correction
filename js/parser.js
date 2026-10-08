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

/**
 * 지분율 검증·보정
 * - 지분율이 100%를 넘거나 합계가 100.5%를 넘으면(주식수를 지분율로 오인한 경우) 주식수로 재계산
 * - 지분율이 비어 있으면 요약표(“39.02%”) 값으로 보완, 주주표가 없으면 요약표로 대체
 */
export function normalizeShareholders(list, summaryPct = {}) {
  let out = list.map((x) => ({ ...x }));
  const sumPct = out.reduce((a, x) => a + (x.pct || 0), 0);
  const totalShares = out.reduce((a, x) => a + (x.shares || 0), 0);
  if (out.some((x) => x.pct > 100) || sumPct > 100.5) {
    out.forEach((x) => { x.pct = totalShares && x.shares ? Math.round((x.shares / totalShares) * 10000) / 100 : null; x.pctSource = "주식수 환산"; });
    if (out.every((x) => x.pct == null)) out.forEach((x) => { x.pct = summaryPct[x.name] ?? null; x.pctSource = "요약표"; });
  }
  out.forEach((x) => { if (x.pct == null && summaryPct[x.name] != null) { x.pct = summaryPct[x.name]; x.pctSource = "요약표"; } });
  if (!out.length) out = Object.entries(summaryPct).map(([name, pct]) => ({ name, pct, pctSource: "요약표" }));
  return out;
}

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

  // ---------- 3. 주주 / 관계회사 / 거래처 — 머리글 열 위치 기반 ----------
  // KoDATA 엑셀은 파일마다 병합 셀 위치가 달라, '행에서 처음 나온 숫자'를 쓰면
  // 소유주식수(예: 90,000주)를 지분율로 오인합니다. 머리글 열에 각 셀을 매핑해 읽습니다.
  const readTable = (headerTest, stopTest) => {
    for (const s of sheets) {
      for (let r = 0; r < s.rows.length; r++) {
        const head = s.rows[r].map((v, i) => ({ i, label: clean(v) })).filter((c) => c.label);
        if (!head.length || !headerTest(head.map((c) => c.label))) continue;
        const out = [];
        for (let k = r + 1; k < s.rows.length; k++) {
          const cells = s.rows[k].map((v, i) => ({ i, v: clean(v) })).filter((c) => c.v);
          if (!cells.length) continue;
          if (stopTest(cells[0].v, cells)) break;
          const rec = {};
          for (const c of cells) {
            // 셀 위치 이하에서 가장 가까운 머리글 열에 배정
            const col = head.filter((h) => h.i <= c.i).pop() || head[0];
            (rec[col.label] = rec[col.label] || []).push(c.v);
          }
          out.push(rec);
        }
        return out;
      }
    }
    return [];
  };
  const first = (rec, label) => (rec[label] || [])[0] || "";
  const lastNum = (rec, label) => { const arr = (rec[label] || []).map(toNum).filter((n) => n !== null); return arr.length ? arr[arr.length - 1] : null; };
  const isStop = (v) => /COPYRIGHT|현황$|^매출구성$/.test(v);

  let shareholders = readTable(
    (h) => h[0] === "주주명" && h.includes("지분율"),
    (v) => isStop(v),
  ).filter((rec) => !rec["주주명"] || first(rec, "주주명") !== "보통주")
    .map((rec) => ({
      name: first(rec, "주주명"),
      type: first(rec, "구분"),                       // 최대주주 / 최대주주의특수관계인 …
      shares: lastNum(rec, "소유주식수"),               // 합계 열(마지막 숫자)
      pct: lastNum(rec, "지분율"),                      // 합계 열(마지막 숫자)
      relation: first(rec, "경영실권자와의 관계"),       // 본인 / 가족 / 타인
      role: first(rec, "회사와의 관계"),                // 실제경영자 / 대표이사 / 임원 …
    }))
    .filter((x) => x.name && x.name !== "보통주" && x.name !== "기타");

  const summaryPct = {};
  const si = flat.findIndex((r) => r[0] === "주요 주주");
  if (si >= 0) for (let k = si + 1; k < Math.min(si + 6, flat.length); k++) {
    const r = flat[k];
    if (r[1] && /%$/.test(r[1])) summaryPct[r[0]] = toNum(r[1].replace("%", ""));
  }
  shareholders = normalizeShareholders(shareholders, summaryPct);

  const related = readTable((h) => h[0] === "기업명" && h.includes("관계내용"), (v) => isStop(v))
    .map((rec) => ({ name: first(rec, "기업명"), business: first(rec, "사업내용"), relation: first(rec, "관계내용") }))
    .filter((x) => x.name);

  const parseParties = (title) => {
    // 제목('구매처현황'/'판매처현황') 뒤에 처음 나오는 '기업명 … 거래비중' 머리글을 열 위치로 읽음
    let on = false;
    return readTable((h) => {
      if (h[0] === title) on = true;
      return on && h[0] === "기업명" && h.includes("거래비중");
    }, (v) => isStop(v) || v === "판매처현황")
      .map((rec) => ({ name: first(rec, "기업명"), bizNo: /^\d{3}-\d{2}-\d{5}$/.test(first(rec, "사업자번호")) ? first(rec, "사업자번호") : "", ceo: first(rec, "대표자명"), share: lastNum(rec, "거래비중") ?? toNum((rec["기업명"] || [])[1]) }))
      .filter((x) => x.name);
  };
  const purchasers = parseParties("구매처현황");
  const customers = parseParties("판매처현황");

  // ---------- 3-2. 인물(생년)·연혁(창업 당시 대표자) ----------
  const people = [];
  const addPerson = (p) => {
    if (!p.name) return;
    const ex = people.find((q) => q.name === p.name);
    if (ex) { if (!ex.birthDate && p.birthDate) ex.birthDate = p.birthDate; if (!ex.birthYear && p.birthYear) ex.birthYear = p.birthYear; if (!ex.role && p.role) ex.role = p.role; ex.sources.push(p.source); }
    else people.push({ ...p, sources: [p.source] });
  };
  // 인적사항: "성명 / 직위 | 최순덕/대표이사 | 생년월일 / 성별 | 1960-11-22 / 여성"
  flat.filter((r) => r[0] === "성명 / 직위").forEach((r) => {
    const [nm, pos] = (r[1] || "").split("/").map((v) => v.trim());
    const bi = r.indexOf("생년월일 / 성별");
    const bd = bi >= 0 ? /(\d{4})-(\d{2})-(\d{2})/.exec(r[bi + 1] || "") : null;
    if (nm && !/생년월일/.test(nm)) addPerson({ name: nm, role: pos || "", birthDate: bd ? bd[0] : "", birthYear: bd ? Number(bd[1]) : null, source: "인적사항" });
  });
  // 종합의견 문장: "대표이사 최순덕(1960년생, 여)", "실제경영자 이상붕(1958년생, 남)"
  flat.forEach((r) => r.forEach((cell) => {
    const re = /(대표이사|실제경영자|대표자)\s*([가-힣]{2,5})\s*\((\d{4})년생/g; let m;
    while ((m = re.exec(cell))) addPerson({ name: m[2], role: m[1], birthDate: "", birthYear: Number(m[3]), source: "종합의견" });
  }));
  // 경영진현황: 실제경영자 표시
  readTable((h) => h[0] === "구분" && h.includes("성명") && h.includes("직위"), (v) => isStop(v) || v === "주요주주현황")
    .forEach((rec) => { if (/실제경영자/.test(first(rec, "구분"))) { const nm = first(rec, "성명"); const ex = people.find((q) => q.name === nm); if (ex) ex.actualManager = true; else addPerson({ name: nm, role: "실제경영자", birthYear: null, birthDate: "", source: "경영진현황", actualManager: true }); } });

  // 연혁: 설립 기록에서 창업 당시 대표자, 대표 변경 기록
  const history = [];
  const hi = flat.findIndex((r) => r[0] === "연혁일자");
  if (hi >= 0) for (let k = hi + 1; k < flat.length && !/COPYRIGHT/.test(flat[k][0]); k++) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(flat[k][0])) history.push({ date: flat[k][0], text: flat[k].slice(1).join(" ") });
  }
  const est = history.find((h) => /설립/.test(h.text));
  const founderName = est ? ((/대표자\s*:\s*([가-힣]{2,5})/.exec(est.text) || /대표이사\s*([가-힣]{2,5})에\s*의해/.exec(est.text) || [])[1] || "") : "";
  const foundingAddress = est ? ((/주소\s*:\s*([^\],]+)/.exec(est.text) || /에\s*의해\s*(.+?)\s*소재/.exec(est.text) || [])[1] || "").trim() : "";
  const ceoChanges = history.filter((h) => /대표이사.*(취임|변경)|대표자.*변경/.test(h.text));

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

  company.founderName = founderName || company.ceo;
  company.foundingAddress = foundingAddress;
  return { company, certs, shareholders, related, purchasers, customers, people, history, ceoChanges, fin, statements, sheetCount: sheets.length };
}
