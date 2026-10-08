// Word(.docx) 보고서 생성 — 전역 docx(UMD) 사용
import { parseBlocks, stripMd } from "./report.js";

const FONT = "맑은 고딕";
const NAVY = "0B3C49", TEAL = "1B6F7A", AMBER = "C9811A", GRAY = "5F6B70", LIGHT = "EAF2F3", RED = "B23A3A";
const W = 9638; // A4 본문 폭 (DXA)

export async function buildDocx(state, D = window.docx) {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType,
    AlignmentType, HeadingLevel, BorderStyle, LevelFormat, Footer, PageNumber, TableOfContents, PageBreak, VerticalAlign,
  } = D;
  const { data, analysis: a, sections, meta } = state;
  const c = data.company;

  const t = (text, o = {}) => new TextRun({ text: stripMd(text), font: FONT, size: o.size || 20, bold: o.bold, color: o.color, italics: o.italics });
  const p = (text, o = {}) => new Paragraph({ children: [t(text, o)], spacing: { after: o.after ?? 100, line: 300 }, alignment: o.align });
  const border = { style: BorderStyle.SINGLE, size: 4, color: "B7C7CA" };
  const borders = { top: border, bottom: border, left: border, right: border };

  const colorFor = (s) => /미충족|미적용|부인|불가/.test(s) ? RED : /확인 필요|조건부/.test(s) ? AMBER : /^충족|가능성 높음/.test(s) ? TEAL : undefined;

  function table(rows) {
    const n = Math.max(...rows.map((r) => r.length));
    const first = n <= 2 ? 2600 : n >= 5 ? 2400 : 2200;
    const rest = Math.floor((W - first) / (n - 1));
    const widths = [first, ...Array(n - 1).fill(rest)];
    widths[n - 1] = W - first - rest * (n - 2);
    return new Table({
      width: { size: W, type: WidthType.DXA }, columnWidths: widths,
      rows: rows.map((r, ri) => new TableRow({
        tableHeader: ri === 0,
        children: Array.from({ length: n }, (_, ci) => {
          const v = r[ci] ?? "";
          const head = ri === 0;
          const numeric = !head && ci > 0 && /^[-\d.,%()~ 억만원]+$/.test(v) && /\d/.test(v) && !/\d-\d/.test(v); // 사업자번호·날짜 제외
          return new TableCell({
            width: { size: widths[ci], type: WidthType.DXA }, borders, verticalAlign: VerticalAlign.CENTER,
            shading: { type: ShadingType.CLEAR, color: "auto", fill: head ? NAVY : ci === 0 ? LIGHT : "FFFFFF" },
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [new Paragraph({
              alignment: head ? AlignmentType.CENTER : numeric ? AlignmentType.RIGHT : AlignmentType.LEFT,
              spacing: { after: 0, line: 270 },
              children: [t(v, { size: 18, bold: head || ci === 0, color: head ? "FFFFFF" : colorFor(v) })],
            })],
          });
        }),
      })),
    });
  }
  const note = (text) => new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: [W],
    rows: [new TableRow({ children: [new TableCell({
      width: { size: W, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, color: "auto", fill: LIGHT },
      borders: { top: { style: BorderStyle.SINGLE, size: 4, color: TEAL }, bottom: { style: BorderStyle.SINGLE, size: 4, color: TEAL }, left: { style: BorderStyle.SINGLE, size: 4, color: TEAL }, right: { style: BorderStyle.SINGLE, size: 4, color: TEAL } },
      margins: { top: 120, bottom: 120, left: 200, right: 200 },
      children: [new Paragraph({ spacing: { after: 0, line: 290 }, children: [t(text, { bold: true, color: NAVY })] })],
    })] })],
  });

  const children = [
    new Paragraph({ spacing: { after: 1800 }, children: [] }),
    p("법인세 경정청구 검토 보고서", { size: 44, bold: true, color: NAVY, after: 200 }),
    p(`${c.name} — 경정청구 가능 여부 및 근거자료 정리`, { size: 26, color: TEAL, after: 600 }),
    table([
      ["항목", "내용"],
      ["대상 기업", `${c.name} (사업자번호 ${c.bizNo})`],
      ["검토 대상", `${data.fin.years.join(" · ")} 사업연도 법인세`],
      ["판단", a.verdict],
      ["기초 자료", meta.sourceName || "한국평가데이터 기업종합보고서"],
      ["작성일", meta.date],
      ["작성", meta.author || "-"],
    ]),
    new Paragraph({ spacing: { before: 300 }, children: [t("※ 외부 신용평가기관 재무정보 기반의 사전 검토이며, 실제 신고서 확인 및 세무대리인 검토를 거쳐 확정해야 합니다.", { size: 17, color: GRAY, italics: true })] }),
    new Paragraph({ children: [new PageBreak()] }),
    p("목차", { size: 28, bold: true, color: NAVY, after: 200 }),
    new TableOfContents("목차", { hyperlink: true, headingStyleRange: "1-2" }),
    p("(Word에서 목차를 우클릭 → '필드 업데이트'로 쪽 번호 표시)", { size: 16, color: GRAY }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  sections.forEach((s, i) => {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 160 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: TEAL, space: 4 } },
      children: [new TextRun({ text: `${i + 1}. ${s.title}`, font: FONT, size: 28, bold: true, color: NAVY })],
    }));
    for (const b of parseBlocks(s.body)) {
      if (b.type === "h") children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100 }, children: [new TextRun({ text: stripMd(b.text), font: FONT, size: 23, bold: true, color: TEAL })] }));
      else if (b.type === "p") children.push(p(b.text));
      else if (b.type === "bullet") children.push(new Paragraph({ numbering: { reference: "b", level: 0 }, spacing: { after: 60, line: 290 }, children: [t(b.text)] }));
      else if (b.type === "note") { children.push(note(b.text)); children.push(new Paragraph({ spacing: { after: 80 }, children: [] })); }
      else if (b.type === "table") { children.push(table(b.rows)); children.push(new Paragraph({ spacing: { after: 120 }, children: [] })); }
    }
  });

  const doc = new Document({
    creator: meta.author || "",
    title: `${c.name} 법인세 경정청구 검토 보고서`,
    styles: {
      default: { document: { run: { font: FONT, size: 20 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 28, bold: true, font: FONT, color: NAVY }, paragraph: { outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 23, bold: true, font: FONT, color: TEAL }, paragraph: { outlineLevel: 1 } },
      ],
    },
    numbering: { config: [{ reference: "b", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 260 } } } }] }] },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: `${c.name} 경정청구 검토${meta.author ? " · " + meta.author : ""}   |   `, font: FONT, size: 16, color: GRAY }),
        new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: GRAY }),
      ] })] }) },
      children,
    }],
  });
  return Packer.toBlob(doc);
}
