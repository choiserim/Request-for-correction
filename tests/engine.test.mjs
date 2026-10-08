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
