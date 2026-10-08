// 경정청구(창업중소기업 세액감면 등) 사전 검토 계산 엔진
// 금액 단위: 천원 (KoDATA 재무제표 단위와 동일)
// ⚠ 세율·감면율은 법령 개정 시 아래 상수만 수정하면 됩니다.

/** 사업연도 개시연도별 법인세율 구간: [상한(천원), 세율] */
export const TAX_BRACKETS = [
  { from: 2018, to: 2022, brackets: [[200000, 0.10], [20000000, 0.20], [300000000, 0.22], [Infinity, 0.25]] },
  { from: 2023, to: 2025, brackets: [[200000, 0.09], [20000000, 0.19], [300000000, 0.21], [Infinity, 0.24]] },
  // 2025년 세법개정(2026.1.1 이후 개시 사업연도) — 각 구간 1%p 인상
  { from: 2026, to: 2099, brackets: [[200000, 0.10], [20000000, 0.20], [300000000, 0.22], [Infinity, 0.25]] },
];
export const MIN_TAX_RATE_SME = 0.07;       // 중소기업 최저한세율 (조특법 §132)
export const LOCAL_TAX_RATIO = 0.10;        // 법인지방소득세 ≈ 법인세의 10% (역산용 가정)
export const SME_SPECIAL_LIMIT = 100000;    // 중소기업특별세액감면 한도 1억원 (천원)
export const STARTUP_PERIOD_YEARS = 5;      // 창업감면 기간

// 수도권과밀억제권역 (조특령 별표/수도권정비계획법 시행령 별표1 요약) — 일부 지역은 '확인 필요'
const OVERCROWDED_GG = ["의정부", "구리", "하남", "고양", "수원", "성남", "안양", "부천", "광명", "과천", "의왕", "군포"];
const PARTIAL_GG = ["남양주", "시흥"]; // 일부 지역만 과밀억제권역
const PARTIAL_IC_EXCLUDED = ["강화", "옹진"]; // 인천 중 과밀억제권역 아닌 곳 (서구·연수구·남동구 일부 예외 존재)

export function classifyRegion(address = "") {
  const a = address.replace(/\s+/g, " ");
  const sido = /^(서울|인천|경기|부산|대구|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주)/.exec(a)?.[1]
    || (/(서울특별시)/.test(a) && "서울") || (/(인천광역시)/.test(a) && "인천") || (/(경기도)/.test(a) && "경기") || "";
  const capital = ["서울", "인천", "경기"].includes(sido);
  let overcrowded = false, note = "";
  if (sido === "서울") overcrowded = true;
  else if (sido === "인천") {
    if (PARTIAL_IC_EXCLUDED.some((k) => a.includes(k))) overcrowded = false;
    else { overcrowded = "check"; note = "인천은 경제자유구역·남동국가산단 등 일부가 과밀억제권역에서 제외됩니다"; }
  } else if (sido === "경기") {
    if (OVERCROWDED_GG.some((k) => a.includes(k))) overcrowded = true;
    else if (PARTIAL_GG.some((k) => a.includes(k))) { overcrowded = "check"; note = "남양주·시흥은 일부 지역만 과밀억제권역입니다"; }
  }
  return { sido, capital, overcrowded, note };
}

export function calcTax(base, year, months = 12) {
  if (base <= 0) return 0;
  const tbl = (TAX_BRACKETS.find((t) => year >= t.from && year <= t.to) || TAX_BRACKETS[TAX_BRACKETS.length - 1]).brackets;
  const annual = (base * 12) / months; // 법인세법 §55② 1년 미만 사업연도 연환산
  let tax = 0, prev = 0;
  for (const [cap, rate] of tbl) {
    if (annual > prev) tax += (Math.min(annual, cap) - prev) * rate;
    prev = cap;
  }
  return (tax * months) / 12;
}

/** 설립일 → 해당 결산연도 사업연도 월수 (1개월 미만은 1개월) */
export function firstYearMonths(founded, year, fiscalMonth = 12) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(founded || "");
  if (!m || Number(m[1]) !== year) return 12;
  const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const endPlus1 = new Date(year, fiscalMonth, 1); // 결산월 말일 다음날
  const add = (n) => new Date(start.getFullYear(), start.getMonth() + n, start.getDate());
  let months = 0;
  while (months < 12 && add(months + 1) <= endPlus1) months++;
  if (add(months) < endPlus1) months++; // 1개월 미만 잔여일 → 1개월
  return Math.max(1, Math.min(12, months));
}

function smeSpecialRate(size, capital, isMfg) {
  const small = /소기업|소상공인/.test(size);
  if (!isMfg) return small ? (capital ? 0.10 : 0.10) : (capital ? 0 : 0.05); // 도소매 등 단순화
  if (small) return capital ? 0.20 : 0.30;
  return capital ? 0 : 0.15; // 중기업 수도권 내는 지식기반산업만 10% (단순화: 0)
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const r1 = (v) => Math.round(v * 10) / 10;

/**
 * @param {object} data parseKodata 결과
 * @param {object} opt 사용자 보완 입력
 *   youth: 'unknown'|'yes'|'no', ceoAge: number|null
 *   related: 'unknown'|'independent'|'succession'
 *   overcrowded: 'auto'|'in'|'out'
 *   size: 'auto'|'소기업'|'중기업'
 *   taxBase: {year: 천원}, existingRelief: {year: 천원}  (실제 신고서 값으로 덮어쓰기)
 */
export function analyze(data, opt = {}) {
  const { company, fin, related } = data;
  const years = fin.years;
  const foundedYear = Number((company.founded || "").slice(0, 4)) || years[0];
  const region = classifyRegion(company.address);
  let overcrowded = region.overcrowded;
  if (opt.overcrowded === "in") overcrowded = true;
  if (opt.overcrowded === "out") overcrowded = false;
  const size = opt.size && opt.size !== "auto" ? opt.size : (/중기업/.test(company.size) ? "중기업" : /대기업|중견/.test(company.size) ? company.size : "소기업");
  const isSME = !/대기업|중견/.test(size);
  const isMfg = /^C/.test(company.industryCode || "");
  const youthByAge = opt.ceoAge ? opt.ceoAge >= 15 && opt.ceoAge <= 34 : null;
  const youth = opt.youth === "yes" ? true : opt.youth === "no" ? false : youthByAge; // null = 미확인
  const largest = data.shareholders.slice().sort((a, b) => (b.pct || 0) - (a.pct || 0))[0];
  const ceoIsLargest = largest ? largest.name === company.ceo : null;
  const sameIndustryRelated = related.filter((r) => company.industryName && r.business && (r.business.includes(company.industryName) || company.industryName.includes(r.business)));
  const relatedStatus = opt.related || "unknown";

  const rateA = overcrowded === true ? 0 : 0.5;              // 일반창업
  const rateB = overcrowded === true ? 0.5 : 1.0;            // 청년창업
  const rateC = smeSpecialRate(size, region.capital, isMfg); // 중소기업특별세액감면

  const rows = years.map((y, i) => {
    const months = firstYearMonths(company.founded, y, company.fiscalMonth);
    const base = opt.taxBase?.[y] ?? fin.pretaxIncome[i];
    const calc = calcTax(base, y, months);
    const minTax = Math.max(0, base) * MIN_TAX_RATE_SME;
    const room = Math.max(0, calc - minTax);
    const inPeriod = y >= foundedYear && y < foundedYear + STARTUP_PERIOD_YEARS;
    const A = inPeriod ? Math.min(calc * rateA, room) : 0;
    const B = inPeriod ? (rateB === 1 ? calc : Math.min(calc * rateB, room)) : 0;
    const C = Math.min(calc * rateC, room, SME_SPECIAL_LIMIT);
    const paidEst = fin.taxExpense[i] / (1 + LOCAL_TAX_RATIO);
    const existingEst = Math.max(0, calc - paidEst);
    const existing = opt.existingRelief?.[y] ?? existingEst;
    const existingSource = opt.existingRelief?.[y] != null ? "입력값" : "역산 추정";
    const fiscalEnd = new Date(y, company.fiscalMonth || 12, 0);
    const filingDue = new Date(fiscalEnd.getFullYear(), fiscalEnd.getMonth() + 4, 0);
    const claimDue = new Date(filingDue.getFullYear() + 5, filingDue.getMonth(), filingDue.getDate());
    let signal = "확인 필요";
    if (calc <= 0) signal = "과세표준 없음";
    else if (existing < calc * 0.03) signal = "감면 미적용 추정";
    else if (existing < A * 0.9) signal = "일부 적용, 한도 미달 추정";
    else signal = "감면 적용 추정";
    return {
      year: y, months, base, calc, minTax, room, inPeriod, A, B, C, paidEst, existing, existingSource, signal,
      netA: Math.max(0, A - existing), netB: Math.max(0, B - existing), netC: Math.max(0, C - existing),
      filingDue: ymd(filingDue), claimDue: ymd(claimDue),
      taxRatio: base > 0 ? fin.taxExpense[i] / base : 0,
    };
  });
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const scen = {
    A: { label: `일반창업 ${Math.round(rateA * 100)}%`, rate: rateA, gross: sum("A"), net: sum("netA") },
    B: { label: `청년창업 ${Math.round(rateB * 100)}%`, rate: rateB, gross: sum("B"), net: sum("netB") },
    C: { label: `중소기업특별감면 ${Math.round(rateC * 100)}%`, rate: rateC, gross: sum("C"), net: sum("netC") },
  };

  // ---------- 요건 체크 ----------
  const checks = [
    { item: "업종", rule: "제조업 등 조특법 §6③ 감면 업종", fact: company.industry || "-", status: isMfg ? "충족" : "확인 필요" },
    { item: "지역", rule: "수도권과밀억제권역 외 창업 → 50%", fact: company.address || "-", status: overcrowded === true ? "미충족(청년만 50%)" : overcrowded === "check" ? "확인 필요" : "충족" },
    { item: "규모", rule: "중소기업", fact: `${company.size || "-"} · 종업원 ${company.employees ?? "-"}명`, status: isSME ? "충족" : "미충족" },
    { item: "감면기간", rule: "최초 소득 발생연도부터 5년", fact: `${foundedYear}~${foundedYear + 4} 사업연도`, status: years.some((y) => y >= foundedYear && y < foundedYear + 5) ? "충족" : "미충족" },
    { item: "창업 해당성", rule: "승계·법인전환·재개업·사업확장 제외 (§6⑩)",
      fact: sameIndustryRelated.length ? `동일 업종 관계회사: ${sameIndustryRelated.map((r) => r.name).join(", ")}` : (related.length ? `관계회사: ${related.map((r) => r.name).join(", ")}` : "관계회사 정보 없음"),
      status: relatedStatus === "independent" ? "충족(소명자료 확보)" : relatedStatus === "succession" ? "미충족 가능성" : (sameIndustryRelated.length ? "확인 필요" : "충족 추정") },
    { item: "청년 (100%)", rule: "창업 당시 15~34세(병역 최대 6년 차감) + 대표자·최대주주",
      fact: `${company.ceo || "대표자"} ${largest ? `${largest.pct}% ${ceoIsLargest ? "최대주주" : "(최대주주 아님)"}` : ""}${opt.ceoAge ? ` · 창업 당시 ${opt.ceoAge}세` : " · 연령 미확인"}`,
      status: youth === true && ceoIsLargest !== false ? "충족" : youth === false ? "미충족" : "확인 필요" },
  ];

  // ---------- 판단 ----------
  const anyGap = rows.some((r) => r.inPeriod && r.calc > 0 && r.existing < r.A * 0.9);
  const startupBlocked = !isSME || overcrowded === true && youth !== true || relatedStatus === "succession";
  let verdict, verdictLevel;
  if (rows.every((r) => r.calc <= 0)) { verdict = "실익 없음 (과세표준 없음)"; verdictLevel = "low"; }
  else if (startupBlocked) { verdict = scen.C.net > 0 ? "창업감면 어려움 — 중소기업특별세액감면 대안 검토" : "경정청구 실익 낮음"; verdictLevel = scen.C.net > 0 ? "mid" : "low"; }
  else if (anyGap && (checks[4].status.startsWith("확인") || checks[1].status === "확인 필요")) { verdict = "경정청구 가능성 높음 (조건부)"; verdictLevel = "high"; }
  else if (anyGap) { verdict = "경정청구 가능성 높음"; verdictLevel = "high"; }
  else { verdict = "이미 감면 적용 추정 — 신고서 확인 필요"; verdictLevel = "mid"; }
  const primary = youth === true && !startupBlocked ? "B" : startupBlocked ? "C" : "A";

  // ---------- 리스크 ----------
  const last = years.length - 1;
  const risks = [];
  if (sameIndustryRelated.length) risks.push({ title: `관계회사 ${sameIndustryRelated[0].name}`, desc: "동일 업종·실제경영자 지배 → 사업 승계·확장으로 보면 창업감면 부인", action: "거래처·자산·인력·사업장 분리 소명자료 확보", level: "high" });
  if (fin.loansToOfficers[last] > 0) risks.push({ title: `가지급금 ${(fin.loansToOfficers[last] / 100000).toFixed(2)}억`, desc: `인정이자(연 4.6% 가정 시 약 ${Math.round(fin.loansToOfficers[last] * 0.046 / 1000)}백만원) 익금산입·대표 상여처분 대상`, action: "신고 반영 여부 확인, 상환 계획", level: "high" });
  if (/파이낸셜|캐피탈|리스/.test(company.mainBank)) risks.push({ title: "업무용승용차", desc: `주채권기관 ${company.mainBank} → 리스·할부 차량 추정. 감가상각 연 800만원 한도·운행기록부`, action: "임직원전용보험·운행기록부 확인", level: "mid" });
  if (last > 0 && fin.advances[last] > fin.advances[last - 1] * 2 && fin.advances[last] > 100000) risks.push({ title: "선급금 급증", desc: `${Math.round(fin.advances[last - 1] / 1000)} → ${Math.round(fin.advances[last] / 1000)}백만원. 실거래 증빙 요구 가능`, action: "계약서·세금계산서 정리", level: "mid" });
  const top = data.customers[0];
  if (top && top.share >= 80) risks.push({ title: `매출 집중 (${top.name} ${top.share}%)`, desc: "주 판매처가 관계회사의 기존 거래처였다면 승계 판단 근거가 됨 (조심2021인3259)", action: "거래 개시 경위 자료 확보", level: "mid" });
  risks.push({ title: "중복 적용 배제", desc: "창업감면 ↔ 통합투자·중소기업특별감면 동시 적용 불가, 통합고용공제는 해석 엇갈림", action: "조합별 세액 비교 후 선택", level: "mid" });

  const others = [
    { name: "통합고용세액공제 (§29의8)", desc: `인건비 ${fin.laborTotal.map((v) => Math.round(v / 1000)).join(" → ")}백만원${company.employees ? `, 종업원 ${company.employees}명` : ""}. ${region.capital ? "수도권" : "비수도권"} 중소기업 증가 1인당 ${region.capital ? "청년 등 1,450만원 / 그 외 850만원" : "청년 등 1,550만원 / 그 외 950만원"}`, note: "창업감면과 병행 여부 해석 엇갈림 → 택일 비교" },
    { name: "중소기업특별세액감면 (§7)", desc: `${size}·${region.capital ? "수도권" : "수도권 외"}·${isMfg ? "제조업" : "기타업종"} ${Math.round(rateC * 100)}%, 한도 1억원`, note: "창업감면과 중복 불가 → 큰 쪽 선택" },
    { name: "통합투자세액공제 (§24)", desc: `기계장치 ${Math.round((fin.machinery[last] || 0) / 1000)}백만원 등`, note: "창업감면과 택일" },
    { name: "연구·인력개발비 공제 (§10)", desc: `연구개발비 ${Math.round(fin.rnd.reduce((a, b) => a + b, 0) / 1000)}백만원, 연구소 ${data.certs["부설연구소"] || "-"}`, note: fin.rnd.some((v) => v > 0) ? "누락 여부 확인" : "과거분 해당 없음 → 향후 설립 시 25%" },
  ];

  return {
    region: { ...region, overcrowded }, size, isSME, isMfg, youth, ceoIsLargest, sameIndustryRelated, foundedYear,
    rates: { A: rateA, B: rateB, C: rateC }, rows, scen, checks, verdict, verdictLevel, primary, risks, others,
    generatedAt: new Date().toISOString(),
  };
}

export const fmtM = (thousand) => (Math.round(thousand / 100) / 10).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }); // 백만원 1자리
export const fmtWon = (thousand) => {
  const won = thousand * 1000;
  if (won >= 1e8) return `${(Math.round(won / 1e6) / 100).toLocaleString("ko-KR")}억원`;
  return `${(Math.round(won / 1e6) * 100).toLocaleString("ko-KR")}만원`;
};
export const range = (lo, hi) => `${fmtWon(lo)} ~ ${fmtWon(hi)}`;
export { r1 };
