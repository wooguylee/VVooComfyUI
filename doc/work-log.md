# 작업 로그

## 2026-08-29

### 단계 1: 환경 조사와 설계 명세

상태: 완료

확인 결과:

- 저장소는 아직 커밋이 없는 `main` 브랜치다.
- `origin`은 `https://github.com/wooguylee/VVooComfyUI.git`이며 원격 브랜치는 비어 있다.
- Comfy Desktop `1.0.44`가 실행 중이다.
- ComfyUI `0.34.2`가 `127.0.0.1:8188`에서 응답한다.
- ComfyUI frontend package는 `1.49.6`이다.
- 설치된 ComfyUI `server.py`에서 custom route, WebSocket `clientId`, 대상 `sid` 전송과 `send_sync`를 확인했다.
- 설치된 ComfyUI `nodes.py`에서 custom node의 `WEB_DIRECTORY` 로딩을 확인했다.
- Codex는 프로젝트별 `.codex/config.toml`에서 STDIO MCP 서버를 등록할 수 있음을 OpenAI Docs에서 확인했다.

결정:

- Node.js STDIO MCP + ComfyUI Python 브리지 + JavaScript 캔버스 확장 구조를 사용한다.
- 캔버스 변경은 expected revision, snapshot, rollback이 있는 원자적 patch로 수행한다.
- 초기 버전은 루트 캔버스만 지원한다.
- Comfy Desktop 재실행이 필요한 설치 직전까지 구현과 정적·단위 검증을 진행한다.

Git 결과:

- 커밋: `8fc2e70 docs: define realtime Comfy canvas MCP design`
- 푸시: `origin/main` 성공
- 푸시 후 상태: `main...origin/main`, clean

### 단계 2: 구현 계획

상태: 완료

계획 범위:

- Task 1: Node.js 프로젝트 기반과 ComfyUI 기본 HTTP 클라이언트
- Task 2: 캔버스 프로토콜, Python 브리지 클라이언트와 MCP 도구
- Task 3: Python 세션·WebSocket 명령 브리지
- Task 4: JavaScript 캔버스 상태와 원자적 patch 엔진
- Task 5: installer, 전체 검증, custom-node junction 설치와 재실행 경계

자체 검토:

- 설계 명세의 MCP 도구 11개가 모두 구현 계획에 포함됐다.
- placeholder 표현이 없음을 확인했다.
- Node/Python/JavaScript 인터페이스와 파일 책임을 대조했다.
- 각 Task에 RED→GREEN TDD, focused verification, 커밋과 `git push origin main`을 명시했다.

Git 결과:

- 커밋: `2821d88 docs: add realtime Comfy MCP implementation plan`
- 푸시: `origin/main` 성공
- 푸시 후 상태: `main...origin/main`, clean

### 단계 3: Task 1 - Node.js 기반과 ComfyUI HTTP 클라이언트

상태: 구현·검증 완료, 커밋 전

RED 확인:

- 명령: `npm run test:node -- tests/node/config.test.ts tests/node/comfy-http-client.test.ts`
- 결과: 두 테스트 파일 모두 `src/config.ts`, `src/comfy-http-client.ts` 모듈 부재로 실패

GREEN 확인:

- 설정·HTTP 테스트: 2 files, 17 tests passed
- TypeScript build: 성공
- `git diff --check`: 성공

구현 내용:

- 외부 호스트·HTTPS·credentials·경로·query·fragment를 거절하는 loopback URL 검증
- `%LOCALAPPDATA%\VVooComfyUI\bridge-token` 기본 경로와 timeout 설정
- `ComfyMcpError` 구조화 오류
- ComfyUI JSON 요청, HTTP 오류, JSON 오류, timeout과 연결 오류 처리
- system stats, queue, object info, history, prompt 제출과 interrupt API

빌드 중 확인한 문제:

- TypeScript 7은 설치된 `@types/node@20.19.43`을 현재 설정에서 자동 포함하지 않았다.
- `tsc --showConfig`에 `types`가 없음을 확인한 후 `types: ["node"]`만 추가했다.
- 수정 후 빌드와 17개 테스트가 모두 통과했다.

Git 결과:

- 커밋: `e158de8 feat: add ComfyUI HTTP client foundation`
- 푸시: `origin/main` 성공
- 푸시 후 상태: `main...origin/main`, clean

### 단계 4: Task 2 - 캔버스 프로토콜과 MCP 도구

상태: 구현·검증 완료, 커밋 전

RED 확인:

- `canvas-protocol.test.ts`: `src/canvas-protocol.ts` 모듈 부재로 실패
- `bridge-client.test.ts`: `src/bridge-client.ts` 모듈 부재로 실패
- `tool-handlers.test.ts`: `src/tool-handlers.ts` 모듈 부재로 실패
- `server.test.ts`: `src/server.ts` 모듈 부재로 실패

GREEN 확인:

- 명령: `npm run test:node`
- 결과: 6 files, 57 tests passed
- `npm run build`: 성공
- `node --check dist/index.js`: 성공
- `git diff --check`: 성공

구현 내용:

- 9개 캔버스 patch operation과 revision·교체·복원 Zod schema
- 로컬 master token을 사용하는 canvas bridge HTTP client
- non-2xx 응답에서도 `REVISION_CONFLICT` 같은 bridge 오류 코드 보존
- 상태·노드·캔버스·patch·교체·복원·실행·queue·interrupt·history 도구 11개
- `canvas.to_prompt` 결과 검증 후 현재 UI workflow를 `/prompt`로 제출
- MCP server instructions와 read/write/destructive annotation
- 프로젝트별 `.codex/config.toml` STDIO 등록

구현 중 확인한 문제:

- Zod 4는 refinement가 붙은 object에 `.omit()`을 허용하지 않는다.
- MCP 입력과 bridge payload가 공통 shape를 사용하되 각각 schema를 생성하고 중복-ref 검증 함수만 공유하도록 분리했다.
- 수정 후 protocol을 포함한 57개 테스트가 모두 통과했다.
