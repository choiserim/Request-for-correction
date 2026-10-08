import test from "node:test";
import assert from "node:assert/strict";
import { calcTax, firstYearMonths, classifyRegion, analyze } from "../js/taxengine.js";

test("법인세 산출세액 (2024, 과표 1.95억 → 9%)", () => {
  assert.equal(Math.round(calcTax(195000, 2024)), 17550);
});
test("1년 미만 사업연도 연환산 (2023.8.25 설립, 과표 2.57억)", () => {
  assert.equal(firstYearMonths("2023-08-25", 2023), 5);
  assert.equal(Math.round(calcTax(257000, 2023, 5)), 40497);
});
test("사업연도 월수 경계값", () => {
  assert.equal(firstYearMonths("2024-01-01", 2024), 12);
  assert.equal(firstYearMonths("2024-12-31", 2024), 1);
  assert.equal(firstYearMonths("2023-08-25", 2024), 12);
});
test("과밀억제권역 판정", () => {
  assert.equal(classifyRegion("충남 아산시 음봉면").overcrowded, false);
  assert.equal(classifyRegion("서울특별시 강남구").overcrowded, true);
  assert.equal(classifyRegion("경기 수원시 영통구").overcrowded, true);
  assert.equal(classifyRegion("경기 화성시 향남읍").overcrowded, false);
  assert.equal(classifyRegion("경기 남양주시 화도읍").overcrowded, "check");
});

const sample = {
  company: { name: "(주)테스트", ceo: "홍길동", founded: "2023-08-25", address: "충남 아산시 음봉면", industryCode: "C29271", industryName: "반도체 제조용 기계 제조업", size: "소기업", fiscalMonth: 12, mainBank: "" },
  certs: {}, shareholders: [{ name: "홍길동", pct: 60, relation: "본인" }], related: [], customers: [], purchasers: [],
  fin: {
    years: [2023, 2024, 2025], pretaxIncome: [257000, 195000, 584000], taxExpense: [33000, 19000, 77000], revenue: [1, 1, 1],
    operatingIncome: [0, 0, 0], laborTotal: [0, 0, 0], loansToOfficers: [0, 0, 0], advances: [0, 0, 0], machinery: [0, 0, 0], rnd: [0, 0, 0],
  },
};
test("창업감면 50% 시나리오 (최저한세 반영)", () => {
  const a = analyze(sample, {});
  assert.equal(Math.round(a.scen.A.gross), 69628); // 20,248 + 3,900 + 45,480
  assert.equal(Math.round(a.rows[1].A), 3900); // 2024년은 최저한세 한도
  assert.equal(a.rows[1].signal, "감면 미적용 추정");
});
test("신고서 기적용 감면 입력 시 덮어쓰기", () => {
  const a = analyze(sample, { existingRelief: { 2025: 45480 } });
  assert.equal(Math.round(a.rows[2].netA), 0);
});
test("청년 100%는 최저한세 배제", () => {
  const a = analyze(sample, { ceoAge: 30 });
  assert.equal(a.primary, "B");
  assert.equal(Math.round(a.rows[2].B), Math.round(a.rows[2].calc));
});

// ---- 주주 지분율 · 청년창업 요건 ----
import { normalizeShareholders } from "../js/parser.js";
import { founderYouth, ageAtFounding } from "../js/taxengine.js";

test("주식수를 지분율로 오인한 경우 주식수로 재계산 (예: 90000%)", () => {
  const r = normalizeShareholders([{ name: "김종수", shares: 90000, pct: 90000 }, { name: "박영희", shares: 10000, pct: 10000 }]);
  assert.equal(r[0].pct, 90); assert.equal(r[1].pct, 10); assert.equal(r[0].pctSource, "주식수 환산");
});
test("지분율이 비면 요약표로 보완", () => {
  const r = normalizeShareholders([{ name: "이상붕", shares: 16000, pct: null }], { 이상붕: 39.02 });
  assert.equal(r[0].pct, 39.02);
});
test("창업 당시 만 나이: 생년월일 정확 / 출생연도 범위", () => {
  assert.deepEqual(ageAtFounding({ birthDate: "1990-09-01" }, "2023-08-25").min, 32);
  const a = ageAtFounding({ birthYear: 1958 }, "2022-05-20");
  assert.equal(a.min, 63); assert.equal(a.max, 64); assert.equal(a.exact, false);
});
const base = (over) => ({ company: { ceo: "최순덕", founderName: "이상붕", founded: "2022-05-20" }, shareholders: [
  { name: "이상붕", pct: 39.02 }, { name: "최순덕", pct: 7.32 }], people: [{ name: "이상붕", birthYear: 1958 }], ...over });
test("현 대표가 아닌 '창업 당시 대표' 기준으로 판단, 표시 문구에 실제 지분 사용", () => {
  const f = founderYouth(base({}), {});
  assert.equal(f.founder, "이상붕"); assert.equal(f.ceoIsLargest, true);
  assert.match(f.fact, /창업 당시 대표 이상붕 \(현 대표 최순덕\) · 지분 39.02% 최대주주 · 창업 당시 만 63~64세/);
  assert.match(f.status, /^미충족/);
});
test("대표자가 최대주주가 아니면 청년이라도 미충족", () => {
  const f = founderYouth({ company: { ceo: "홍길동", founded: "2023-01-10" }, shareholders: [{ name: "홍길동", pct: 30 }, { name: "김부친", pct: 70 }], people: [] }, { ceoAge: 30 });
  assert.equal(f.ceoIsLargest, false); assert.equal(f.status, "미충족 (대표자≠최대주주)");
  assert.match(f.fact, /최대주주 김부친 70%/);
});
test("35~40세는 병역기간 차감 여지 → 확인 필요", () => {
  const f = founderYouth({ company: { ceo: "A", founded: "2023-01-10" }, shareholders: [{ name: "A", pct: 100 }], people: [] }, { ceoAge: 37 });
  assert.equal(f.status, "확인 필요 (병역기간 차감 시 가능)");
});
