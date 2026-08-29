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

상태: 구현·검증·커밋·푸시 완료

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

상태: 구현·검증·커밋·푸시 완료

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

Git 결과:

- 커밋: `c9f1dae feat: expose Comfy canvas MCP tools`
- 푸시: `origin/main` 성공
- 푸시 후 상태: `main...origin/main`, clean

### 단계 5: Task 3 - ComfyUI Python command bridge

상태: 구현·검증·커밋·푸시 완료

RED 확인:

- `test_bridge_state.py`: `bridge_state` 모듈 부재로 실패
- pending 전송 실패 정리 테스트: `cancel_pending` 메서드 부재로 실패
- `test_routes.py`: ComfyUI 확장 `__init__.py` 부재로 route 테스트 4개 실패

GREEN 확인:

- 명령: `python -m unittest discover -s tests/python -v`
- 결과: 18 tests passed
- 시스템 Python `compileall`: 성공
- ComfyUI 번들 Python 3.13 `compileall`: 성공
- `git diff --check`: 성공

구현 내용:

- 실제 Comfy WebSocket이 존재하는 `client_id`만 등록
- protocol version 검증과 session token 발급
- focus·visibility·heartbeat 기반 활성 세션 선택과 모호성 거절
- session별 pending Future, timeout·전송 실패·연결 종료 정리
- master Bearer token과 frontend session token 분리
- `/vvoo_mcp/frontend/register`, `/heartbeat`, `/result` route
- `/vvoo_mcp/sessions`, `/status`, `/command` route
- `vvoo.mcp.command` 메시지를 선택된 WebSocket `sid`에만 전송
- 실제 ComfyUI 노드를 추가하지 않는 `WEB_DIRECTORY` 전용 확장

Git 결과:

- 커밋: `63c916a feat: add authenticated ComfyUI command bridge`
- 푸시: `origin/main` 성공
- 푸시 후 상태: `main...origin/main`, clean

### 단계 6: Task 4 - 실시간 캔버스 상태·원자적 patch 엔진

상태: 구현·검증·커밋·푸시 완료

RED 확인:

- `graph-state.test.js`: `graph-state.js` 모듈 부재로 실패
- `patch-engine.test.js`: `patch-engine.js` 모듈 부재로 실패
- `canvas-runtime.test.js`: `canvas-runtime.js` 모듈 부재로 실패

GREEN 확인:

- 명령: `npm run test:js`
- 결과: 3 files, 25 tests passed
- JavaScript 4개 파일 `node --check`: 성공
- `npm run build`: 성공
- `git diff --check`: 성공

구현 내용:

- 정규 JSON과 SHA-256 기반 canvas revision
- 최근 10개의 인메모리 workflow snapshot
- 루트 캔버스 workflow·노드·링크·위젯 요약 조회
- 노드 추가·삭제·이동·크기·제목·속성·위젯 변경
- 임시 ref 또는 실제 ID와 슬롯 이름·번호를 이용한 연결·해제
- revision 충돌, 대량 삭제 확인, 루트 캔버스 제한
- patch·전체 교체·snapshot 복원 전 자동 백업
- 작업 실패 시 원래 workflow 전체 롤백과 안정된 오류 코드
- `canvas.get`, `apply_patch`, `replace`, `restore`, `to_prompt` 명령 디스패치
- WebSocket client ID 등록, 5초 heartbeat, focus·visibility 활성 세션 메타데이터
- 프런트엔드 명령 직렬화와 session token 기반 결과 반환

Git 결과:

- 커밋: `63748cf feat: add atomic live canvas patch engine`
- 푸시: `origin/main` 성공
- 푸시 후 상태: `main...origin/main`, clean

### 단계 7: Task 5 - 설치기·운영 문서와 설치 전 전체 검증

상태: 구현·검증·커밋·푸시 완료

설치기 구현:

- `%APPDATA%\Comfy Desktop\installations.json`에서 설치 완료된 non-cloud `ComfyUI` 하나만 선택
- 명시적 `-ComfyRoot`는 `custom_nodes` 포함 여부 검증
- 프로젝트 확장 source와 `custom_nodes\vvoo_comfy_mcp` destination 정규화·범위 검증
- 기존 대상이 같은 junction일 때만 멱등 허용하고, 일반 디렉터리·다른 target은 변경 전에 실패
- 32-byte 암호학적 난수로 64자리 소문자 hex token 생성
- `-ForceTokenRotation`, `-WhatIf`, `SupportsShouldProcess` 지원
- secret 값을 출력하지 않고 경로·상태·`RestartRequired`만 반환

설치 전 검증:

- `-WhatIf` source: `W:\WorkAI\VVooComfyUI\comfy-extension\vvoo_comfy_mcp`
- `-WhatIf` destination: `C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\custom_nodes\vvoo_comfy_mcp`
- `-WhatIf` token: `C:\Users\Administrator\AppData\Local\VVooComfyUI\bridge-token`
- preview 후 token과 destination이 생성되지 않음을 확인
- `npm run verify`: Vitest 9 files, 82 tests passed; Python 18 tests passed; TypeScript build 성공
- `git diff --check`: 성공

문서:

- root `README.md`에 빠른 설치·도구·안전 순서·제한 기록
- `doc/setup-and-operations.md`에 전체 설치·운영·복원·오류 대응 기록

Git 결과:

- 커밋: `9f065ef docs: add Comfy extension installation workflow`
- 푸시: `origin/main` 성공
- 푸시 후 상태: `main...origin/main`, clean

### 단계 8: 확장 설치와 Comfy Desktop 재실행 직전 검증

상태: 설치·검증 완료, 사용자 재실행 대기

설치 결과:

- 프로젝트 source: `W:\WorkAI\VVooComfyUI\comfy-extension\vvoo_comfy_mcp`
- ComfyUI root: `C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI`
- junction: `C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\custom_nodes\vvoo_comfy_mcp`
- token path: `C:\Users\Administrator\AppData\Local\VVooComfyUI\bridge-token`
- 최초 실행 결과: `TokenState=created`, `JunctionState=created`, `RestartRequired=True`
- 재실행 결과: `TokenState=already-present`, `JunctionState=already-installed`로 멱등성 확인

비밀값을 출력하지 않은 검증:

- token 파일 존재: 참
- token 길이: 64
- token 형식: `^[a-f0-9]{64}$` 일치
- link type: `Junction`
- junction target이 프로젝트 source와 대소문자 무시 완전 일치
- ComfyUI 번들 Python compileall exit code: 0
- `GET http://127.0.0.1:8188/api/system_stats`: HTTP 200
- 인증된 `GET http://127.0.0.1:8188/api/vvoo_mcp/status`: HTTP 404
- 실행 중 ComfyUI Python process 생성 시각은 모두 `2026-08-29 17:53:16`으로 유지돼 설치 중 재실행하지 않았음

404는 현재 프로세스가 새 custom extension을 아직 import하지 않았다는 예상 결과다. 다음 단계는 사용자가 Comfy Desktop을 완전히 재실행하는 것이며, 그 전에는 live canvas write를 수행하지 않는다.

### 단계 9: 내부 workflow 탭 조회·수명주기·실시간 제어 확장

상태: 구현·설정·설치 검증 완료, 사용자 재시작 직전

확정 구조:

- `comfy_canvas_list`는 ComfyUI WebView/browser 세션을 선택한다.
- `comfy_workflow_list`와 `workflow_id`는 그 세션 안의 내부 workflow 탭을 선택한다.
- 공식 `app.extensionManager.workflow` store로 탭을 조회·생성·저장·이름 변경·닫기·정렬한다.
- 쓰기는 대상 탭을 `app.loadGraphData(..., workflow)`로 먼저 화면에 활성화한 뒤 `app.rootGraph`를 수정한다.
- snapshot은 workflow 객체에 귀속해 다른 탭 복원을 거절하고 같은 객체의 rename은 허용한다.

TDD RED 확인:

- `workflow-runtime.js` 부재로 새 workflow 테스트 suite가 실패했다.
- workflow 명령, canvas focus, mode/color/collapse와 snapshot 귀속 부재로 JavaScript 테스트 8개가 실패했다.
- 새 Python command allowlist와 capability 부재로 route 테스트가 실패했다.
- 새 Zod schema, handler와 MCP registration 부재로 Node 테스트 19개가 실패했다.
- 공식 store처럼 새 임시 workflow가 즉시 `openWorkflows`에 들어가지 않는 경계에서 create/last-close 테스트 2개가 실패했다.
- `app.graph` alias가 없는 `app.rootGraph` 전용 경계와 같은 탭 replace/restore load binding, `loadGraphData=false` 경계를 각각 재현했다.

GREEN 및 전체 검증:

- `npm run test:js`: 4 files, 47 tests passed
- `npm run test:node`: 6 files, 79 tests passed
- `npm run verify`: Vitest 10 files, 126 tests passed; Python 20 tests passed; TypeScript build 성공
- browser JavaScript 5개와 `dist/index.js`의 `node --check`: 성공
- 시스템 Python과 ComfyUI 번들 Python compileall: 성공
- `git diff --check`: 성공

구현 결과:

- 내부 탭 `list/get/select/create/save/rename/close/reorder` 명령과 MCP 도구 8개
- `comfy_canvas_focus` 노드 선택과 selection/전체 그래프 viewport 이동
- 기존 canvas get/patch/replace/restore/to_prompt에 선택적인 `workflow_id`
- 실행 mode, node color/bgcolor, collapse patch와 add-node 초기값
- 활성·비활성 workflow JSON, 노드·링크·widget 요약과 SHA-256 revision
- 쓰기 전 가시적 탭 활성화와 활성화 후 revision 재검사
- patch 성공 시 ComfyUI ChangeTracker capture로 activeState·수정 표시 동기화
- replace/restore/rollback 시 ChangeTracker restoring 경계로 같은 탭 상태 유지
- 같은 workflow에 귀속된 최근 10개 snapshot과 교차 탭 복원 거절
- 수정 탭 close 확인, rename 충돌 거절, 마지막 탭 close 전 빈 탭 생성
- `app.rootGraph` 우선 사용과 같은 탭에 귀속된 rollback/replace/restore
- Python command allowlist/status capability와 총 20개 MCP 도구 등록

설정과 설치:

- root `.codex/config.toml`에 기존 공식 `comfy_mcp`를 보존하면서 `vvoo_comfy`를 추가했다.
- root와 `dev/.codex/config.toml` 모두 `cwd=W:\WorkAI\VVooComfyUI\dev`, `args=["dist/index.js"]`를 가리킨다.
- `-WhatIf`에서 알려진 이전 junction target만 새 `dev` source로 migration하는 두 작업을 확인했다.
- 실제 junction 상태: `legacy-migrated`
- 최종 junction target: `W:\WorkAI\VVooComfyUI\dev\comfy-extension\vvoo_comfy_mcp`
- 이전 junction 자체만 제거·재생성했으며 target source 데이터는 삭제하지 않았다.
- token은 값을 출력하지 않고 존재, 길이 64, `^[a-f0-9]{64}$` 일치를 확인했다.
- `dist/index.js` 존재, 두 TOML의 cwd/args 파싱, `/api/system_stats` HTTP 200을 확인했다.
- 인증된 `/api/vvoo_mcp/status`는 HTTP 404이며 새 workflow capability는 아직 로드되지 않았다.
- 최종 설치 스크립트 재실행: `TokenState=already-present`, `JunctionState=already-installed`, `RestartRequired=True`.
- 최종 읽기 전용 재확인: junction target 정확히 일치, token 길이/형식 정상, build entry 존재, `/api/system_stats` HTTP 200, 인증된 bridge status HTTP 404.
- 현재 ComfyUI Python process 시작 시각: `2026-08-29 20:58:22`, `2026-08-29 20:58:33`; 이 단계에서는 프로세스를 종료하거나 재시작하지 않았다.

현재 404는 실행 중인 Comfy Desktop을 자동 종료하지 않았고 새 Python route/frontend JavaScript가 아직 메모리에 로드되지 않았음을 뜻한다. 다음 단계는 사용자가 Comfy Desktop을 완전히 재시작하고 Codex 프로젝트를 새 세션으로 여는 것이다.
