# 경정청구 AI 검토

한국평가데이터(KoDATA) **기업종합보고서 엑셀**을 올리면 법인세 경정청구 가능 여부를 계산하고, **Claude API**가 결과를 실시간으로 검토·보완·수정한 뒤 **Word 보고서**와 **미팅용 PPT**로 내보내는 웹앱입니다.

- 설치나 빌드가 필요 없는 정적 사이트(HTML + JavaScript) → **GitHub Pages**에서 바로 동작
- 엑셀 파싱, 세액 계산, Word·PPT 생성은 모두 **브라우저 안에서** 처리됩니다
- Claude 호출 시에만 기업 데이터·보고서 내용이 Anthropic API로 전송됩니다

## 주요 기능

| 영역 | 내용 |
|---|---|
| 자동 분석 | 기업개요·주주·관계회사·거래처·3개년 재무제표 추출 → 창업중소기업 세액감면(§6) 50%/100%, 중소기업특별세액감면(§7) 시나리오, 최저한세(7%), 1년 미만 사업연도 연환산, 연도별 경정청구 기한 |
| 감면 미적용 신호 | 재무제표 법인세비용을 역산해 '감면 미적용 / 일부 적용 / 적용' 추정 |
| 보완 입력 | 대표자 창업 당시 나이, 청년 여부, 관계회사 승계 여부, 과밀억제권역, 규모, **신고서상 과세표준·기적용 감면액** → 입력 즉시 재계산 |
| Claude 검토 | 전체 검토 / 보완·수정 반영 / 법령·예규 점검 / 미팅 예상 질문, 자유 요청 채팅. 응답은 **스트리밍으로 실시간 표시** |
| 수정안 적용 | Claude가 섹션 단위 수정안을 내면 미리보기 후 **적용/취소** (모두 적용 가능). 섹션별 "AI 다듬기" |
| 근거자료 첨부 | 법인세 신고서·세무조정계산서 PDF·이미지를 첨부하면 Claude가 함께 읽고 검토 |
| 보고서 편집 | 섹션별 직접 편집(간단 마크업) + 실시간 미리보기, 순서 변경·추가·삭제 |
| 내보내기 | Word(.docx) 보고서, PPT(.pptx, 13장), 프로젝트 저장/불러오기(.json), 브라우저 자동 저장 |

## 1. GitHub에 올리고 배포하기

1. GitHub에서 새 저장소를 만듭니다 (예: `gyeongjeong-ai`). **비공개(Private)** 를 권장합니다.
2. 이 폴더의 파일을 모두 올립니다.
   ```bash
   git init && git add . && git commit -m "경정청구 AI 검토 초기 버전"
   git branch -M main
   git remote add origin https://github.com/<아이디>/gyeongjeong-ai.git
   git push -u origin main
   ```
3. 저장소 **Settings → Pages → Build and deployment → Source: GitHub Actions** 를 선택합니다.
4. `main`에 push하면 `.github/workflows/pages.yml`이 단위 테스트를 돌린 뒤 자동 배포합니다.
   주소: `https://<아이디>.github.io/gyeongjeong-ai/`

> 비공개 저장소의 Pages는 GitHub 유료 플랜(Pro/Team 등)에서 지원됩니다. 무료 계정이면 저장소를 공개로 두되 **고객 자료는 절대 커밋하지 마세요** (`.gitignore`에 xls·pdf·docx·pptx·프로젝트 json이 제외되어 있습니다).

### 로컬에서 실행
```bash
npm start          # http://localhost:8080  (npx http-server 사용)
npm test           # 세액 계산 엔진 단위 테스트
```
`index.html`을 파일로 바로 열면 ES 모듈이 막히므로 반드시 로컬 서버로 여세요.

## 2. 사용 방법

1. 우측 상단 **⚙ 설정**에서 Anthropic API 키(`sk-ant-...`)와 모델을 지정합니다.
   - 키 발급: [Claude Console](https://platform.claude.com/) → API Keys
   - 기본 모델은 `claude-sonnet-5-5`, 정밀 검토는 `claude-opus-5-5`
2. **기업종합보고서(.xls/.xlsx)** 를 끌어다 놓으면 대시보드에 판단·시나리오·연도별 계산이 표시됩니다.
3. 대표자 나이, 관계회사 승계 여부, 신고서 값 등을 **보완 입력**에 넣으면 즉시 재계산됩니다.
4. 오른쪽 **Claude 검토** 패널에서
   - `전체 검토` → 결론 타당성·오류·누락·추가 확인사항을 실시간으로 받음
   - `보완·수정 반영` → 섹션별 수정안 → **적용** 클릭 시 보고서에 반영
   - 채팅으로 "결론을 더 보수적으로", "가지급금 리스크를 구체화" 등 요청
5. **Word 보고서 / 미팅 PPT** 버튼으로 내려받습니다. PPT의 문장 슬라이드(결론·리스크·준비서류·다음 단계)는 보고서 섹션 내용을 그대로 사용하므로, AI 수정이 PPT에도 반영됩니다.

### 보고서 섹션 마크업
```
일반 줄            → 문단
- 항목             → 글머리 기호
| 머리글 | 머리글 |  → 표 (연속된 줄, 첫 줄이 머리글)
> 강조 문장         → 강조 박스
## 소제목           → 소제목
```

## 3. API 키 보안

- 기본 방식은 **브라우저 → Anthropic API 직접 호출**입니다(`anthropic-dangerous-direct-browser-access` 헤더). 키는 이 브라우저의 세션에만 보관되며, "이 브라우저에 키 저장"을 체크했을 때만 localStorage에 남습니다. 개인 PC에서만 사용하세요.
- 팀이 함께 쓰거나 키를 노출하고 싶지 않다면 `worker/` 의 **Cloudflare Worker 프록시**를 배포하세요.
  ```bash
  cd worker
  npx wrangler secret put ANTHROPIC_API_KEY      # 키는 Worker에만 저장
  # wrangler.toml 의 ALLOWED_ORIGIN 을 https://<아이디>.github.io 로 수정
  npx wrangler deploy
  ```
  배포된 주소(`https://....workers.dev`)를 설정의 **프록시 URL**에 넣으면 API 키 없이 동작합니다.
  프록시는 공개 주소이므로 ALLOWED_ORIGIN 제한과 Anthropic Console의 사용 한도(Spend limit)를 꼭 설정하세요.

## 4. 폴더 구조

```
index.html              화면
css/style.css           스타일
js/app.js               화면 동작·상태·자동 저장
js/parser.js            KoDATA 기업종합보고서 엑셀 파서
js/taxengine.js         세율표·감면율·최저한세·시나리오 계산 (법령 개정 시 여기 상수 수정)
js/report.js            보고서 섹션 생성·마크업 렌더러
js/claude.js            Claude Messages API 스트리밍, 프롬프트, 수정안 파싱
js/export-docx.js       Word 생성 (docx 라이브러리)
js/export-pptx.js       PPT 생성 (PptxGenJS)
worker/                 (선택) API 키 보관용 Cloudflare Worker 프록시
tests/engine.test.mjs   계산 엔진 단위 테스트 (node --test)
.github/workflows/      GitHub Pages 자동 배포
```

외부 라이브러리(버전 고정, jsDelivr CDN): SheetJS `xlsx@0.18.5`, `docx@8.5.0`, `pptxgenjs@3.12.0`

## 5. 계산 가정과 한계

- 과세표준 = 법인세비용차감전순이익, 법인세비용에는 지방소득세 10%가 포함된 것으로 가정합니다. **신고서 값 입력란**을 채우면 추정 대신 실제 값으로 계산합니다.
- 세율: 2023~2025 사업연도 9/19/21/24%, 2026년 이후 10/20/22/25% (`TAX_BRACKETS`에서 수정).
- 과밀억제권역은 주소 기반 자동 판정이며, 인천·남양주·시흥 등 일부 지역은 '확인 필요'로 표시합니다.
- 통합고용세액공제는 연도별 상시근로자 수가 엑셀에 없어 금액을 계산하지 않고 검토 항목으로만 제시합니다.
- 본 도구의 결과는 사전 검토 자료입니다. 실제 경정청구는 세무대리인(세무사)의 확인을 거쳐 진행하세요.
