# 실시간 Comfy Desktop 캔버스 MCP 설계 명세

## 1. 목적

Codex가 Computer Use 없이 로컬 MCP 통신으로 실행 중인 Comfy Desktop을 제어한다. 기본 ComfyUI 서버 기능뿐 아니라 사용자가 현재 보고 있는 루트 캔버스의 노드를 조회하고, 생성·삭제·이동·크기 변경·연결·연결 해제·위젯 변경·워크플로 교체·복원·실행할 수 있어야 한다.

## 2. 확인된 환경

- 프로젝트 루트: `W:\WorkAI\VVooComfyUI`
- 운영체제: Windows
- Node.js: `20.20.0`
- Comfy Desktop: `1.0.44`
- ComfyUI: `0.34.2`
- ComfyUI frontend package: `1.49.6`
- ComfyUI API: `http://127.0.0.1:8188`
- ComfyUI 소스: `C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI`
- ComfyUI custom nodes: 위 경로의 `custom_nodes`
- 모델·입력·출력 데이터: Comfy Desktop 설정에 따라 `Z:\ConfyUI_Folder` 사용
- Git: 빈 `main` 브랜치, 원격 `https://github.com/wooguylee/VVooComfyUI.git`

MCP가 Comfy Desktop 또는 ComfyUI 백엔드 프로세스를 시작·종료하지 않는다. 사용자가 Desktop에서 로컬 인스턴스를 실행한 상태에서만 제어한다.

## 3. 선택한 접근

프로젝트 로컬 Node.js STDIO MCP 서버, ComfyUI Python 브리지, ComfyUI 프런트엔드 JavaScript 확장을 결합한다.

```text
Codex Desktop
  └─ STDIO MCP
      └─ VVooComfyUI Node.js 서버
          ├─ ComfyUI 기본 HTTP API
          └─ Bearer 인증 localhost HTTP
              └─ ComfyUI Python 브리지
                  └─ 대상 sid의 기존 ComfyUI WebSocket
                      └─ JavaScript 캔버스 확장
                          └─ app.graph / app.canvas
```

전체 워크플로 교체만 사용하는 최소안은 기존 미저장 작업을 덮어쓸 위험이 있어 채택하지 않는다. Electron DevTools/CDP나 화면 자동화 방식은 버전과 화면 상태에 민감하고 사용자의 비 Computer Use 요구에 맞지 않아 채택하지 않는다.

## 4. 구성요소

### 4.1 Node.js STDIO MCP 서버

Codex가 프로젝트별 `.codex/config.toml`을 통해 시작한다. MCP 서버는 `127.0.0.1` 또는 `localhost`가 아닌 ComfyUI 주소를 거부한다. 기본 주소는 `http://127.0.0.1:8188`이다.

책임:

- MCP 도구 스키마와 사용 지침 제공
- ComfyUI 기본 API 호출
- 브리지 세션 목록과 명령 호출
- 입력과 응답 정규화
- 타임아웃·HTTP·브리지 오류를 MCP 오류로 변환

### 4.2 ComfyUI Python 브리지

ComfyUI 커스텀 노드 패키지로 로드되며 실제 생성 노드는 추가하지 않는다. `WEB_DIRECTORY`를 통해 JavaScript 확장을 제공하고 `/vvoo_mcp` 아래 커스텀 라우트를 등록한다.

책임:

- 현재 프런트엔드 세션 등록·heartbeat·정리
- 활성 세션 선택 또는 지정된 세션 검증
- MCP 명령을 대상 ComfyUI WebSocket `sid`에만 전달
- 요청 ID별 응답 Future 관리와 타임아웃
- 로컬 master token으로 MCP 전용 라우트 인증
- 프런트엔드 session token으로 응답 위조 방지

### 4.3 ComfyUI JavaScript 확장

`app.registerExtension`으로 등록한다. `api.clientId`를 Python 브리지에 등록하고 custom message를 수신한다. 현재 루트 그래프를 직렬화하고 명령을 적용한 뒤 결과나 오류를 브리지로 응답한다.

책임:

- 현재 캔버스 상태와 revision 계산
- 원자적 patch 적용
- patch 직전 snapshot 생성
- 검증 실패·예외 시 snapshot으로 rollback
- 적용 후 캔버스 redraw
- 전체 워크플로 교체와 snapshot 복원
- 현재 그래프를 API prompt로 변환

### 4.4 설치 스크립트

PowerShell 스크립트가 다음 작업을 수행한다.

- Comfy Desktop 설치와 ComfyUI custom nodes 경로 확인
- `%LOCALAPPDATA%\VVooComfyUI\bridge-token` 생성 또는 재사용
- ComfyUI `custom_nodes\vvoo_comfy_mcp`에 프로젝트 확장 디렉터리 junction 생성
- 기존의 다른 대상이 있으면 덮어쓰지 않고 중단
- 설치 결과와 재실행 필요 여부 출력

## 5. 프로토콜

### 5.1 세션

프런트엔드 확장은 다음 정보를 등록한다.

- `client_id`: ComfyUI WebSocket client ID
- `title`: 창 제목
- `url`: 현재 URL
- `visible`: document visibility
- `focused`: window focus
- `protocol_version`: `1`

Python 브리지는 `client_id`가 실제 `PromptServer.instance.sockets`에 있을 때만 등록을 허용하고 무작위 session token을 반환한다. heartbeat가 일정 시간 끊기거나 WebSocket이 사라진 세션은 목록에서 제외한다.

대상 세션이 명시되지 않으면 `focused`, `visible`, 최근 heartbeat 순으로 하나를 고른다. 동률이거나 활성 세션을 결정할 수 없으면 MCP 호출을 실패시켜 사용자가 대상을 고르게 한다.

### 5.2 인증

- MCP 전용 읽기·명령 라우트는 `%LOCALAPPDATA%\VVooComfyUI\bridge-token`의 Bearer token을 요구한다.
- token은 Git에 저장하지 않는다.
- 프런트엔드 등록은 실제 Comfy WebSocket `client_id`만 허용한다.
- 프런트엔드 heartbeat와 응답은 등록 시 발급한 session token을 요구한다.
- 모든 통신은 현재 ComfyUI의 loopback 서버를 통해서만 수행한다.

### 5.3 명령 메시지

MCP 서버가 Python 브리지에 보낼 공통 구조:

```json
{
  "session_id": "optional-client-id",
  "command": "canvas.get",
  "payload": {},
  "timeout_ms": 10000
}
```

브리지가 프런트엔드에 보낼 구조:

```json
{
  "protocol_version": 1,
  "request_id": "uuid",
  "command": "canvas.get",
  "payload": {}
}
```

응답은 `ok`, `request_id`, `result` 또는 구조화된 `error`를 포함한다.

## 6. MCP 도구

### `comfy_status`

`/system_stats`, `/queue`와 브리지 상태를 함께 반환한다. 읽기 전용이다.

### `comfy_node_types`

`/object_info` 또는 `/object_info/{node_class}`를 호출해 노드 입력·출력·위젯 규격을 반환한다. 읽기 전용이다.

### `comfy_canvas_list`

등록된 Desktop 캔버스 세션 목록과 활성 후보를 반환한다. 읽기 전용이다.

### `comfy_canvas_get`

대상 루트 캔버스의 직렬화된 workflow, 요약된 노드·연결·위젯 값, revision을 반환한다. 읽기 전용이다.

### `comfy_canvas_apply_patch`

`expected_revision`과 한 개 이상의 patch operation을 요구한다. 지원 operation:

- `add_node`: type, 임시 참조키, position, size, title, widgets, properties
- `remove_node`: node ID
- `move_node`: node ID, position
- `resize_node`: node ID, size
- `set_widget`: node ID, widget name, value
- `set_title`: node ID, title
- `set_properties`: node ID, properties
- `connect`: source node/slot, target node/slot
- `disconnect`: target node/input slot

한 요청 안에서 `add_node.ref`로 새 노드를 뒤 operation에서 참조할 수 있다. 적용 직전 snapshot을 만들며 결과에 `backup_id`, 새 revision과 ref→실제 node ID 매핑을 반환한다.

### `comfy_canvas_replace`

전체 UI workflow JSON, `expected_revision`, `confirm_replace: true`를 요구한다. 적용 전 snapshot과 rollback을 제공한다.

### `comfy_canvas_restore`

`backup_id`와 현재 `expected_revision`을 요구한다. 해당 세션이 보관 중인 snapshot을 로드한다.

### `comfy_queue_current`

프런트엔드에서 현재 그래프를 `graphToPrompt()`로 변환하고 Node.js 서버가 `/prompt`에 제출한다. `prompt_id`와 검증 오류를 반환한다.

### 기본 작업 관리 도구

- `comfy_queue_get`
- `comfy_interrupt`
- `comfy_history_get`

## 7. revision과 원자성

revision은 정규화한 루트 workflow JSON의 SHA-256이다. `expected_revision`이 현재 값과 다르면 아무 작업도 적용하지 않고 `REVISION_CONFLICT`를 반환한다.

patch 처리 순서:

1. 루트 그래프인지 확인한다.
2. 현재 workflow와 revision을 계산한다.
3. expected revision을 비교한다.
4. 현재 workflow snapshot을 제한된 메모리 저장소에 보관한다.
5. operation을 순서대로 적용한다.
6. 노드·슬롯·위젯과 연결 결과를 확인한다.
7. 새 workflow와 revision을 계산한다.
8. redraw 후 성공 응답을 보낸다.

중간 단계가 실패하면 `app.loadGraphData(snapshot)`을 호출해 원상복구하고 오류를 반환한다. snapshot은 세션별 최근 10개만 보관한다.

## 8. 안전 경계

- 서브그래프가 현재 보이는 경우 초기 버전은 `SUBGRAPH_UNSUPPORTED`로 거절한다.
- 동적 위젯은 이름이 실제 생성된 widget에 존재하는 경우만 값을 바꾼다.
- 전체 교체는 `confirm_replace: true` 없이는 거절한다.
- remove operation이 전체 노드의 절반 이상이면 `confirm_mass_delete: true`를 추가로 요구한다.
- MCP 서버는 로컬 ComfyUI 외의 호스트로 요청하지 않는다.
- 커스텀 노드 설치·업데이트·삭제와 Comfy Desktop 프로세스 제어는 MCP 도구 범위에서 제외한다.
- 현재 캔버스를 대상으로 하는 실환경 쓰기 검증은 사용자 워크플로 snapshot을 확보한 뒤 수행한다.

## 9. 오류 모델

오류는 최소한 다음 code를 제공한다.

- `COMFY_UNAVAILABLE`
- `AUTH_FAILED`
- `NO_CANVAS_SESSION`
- `AMBIGUOUS_CANVAS_SESSION`
- `SESSION_GONE`
- `BRIDGE_TIMEOUT`
- `PROTOCOL_MISMATCH`
- `SUBGRAPH_UNSUPPORTED`
- `REVISION_CONFLICT`
- `NODE_TYPE_NOT_FOUND`
- `NODE_NOT_FOUND`
- `SLOT_NOT_FOUND`
- `WIDGET_NOT_FOUND`
- `CONNECTION_REJECTED`
- `MASS_DELETE_CONFIRMATION_REQUIRED`
- `REPLACE_CONFIRMATION_REQUIRED`
- `PATCH_FAILED_ROLLED_BACK`

## 10. 검증 전략

### Node.js

- loopback URL 제한
- token 읽기와 Authorization header
- HTTP 정상·오류·타임아웃 처리
- patch schema와 대량 삭제 확인
- MCP 도구 등록과 read/write annotation

### Python

- 세션 등록 시 실제 socket 검증
- session token 검증
- 활성 세션 선택과 모호성 오류
- pending request 응답·타임아웃·세션 종료
- master token 인증

### JavaScript

- workflow 정규화와 revision 안정성
- 노드 생성과 임시 ref 매핑
- 슬롯 이름·번호 연결
- 위젯 변경
- revision conflict
- patch 실패 rollback
- snapshot restore
- 서브그래프 거절

### 실환경

Comfy Desktop 재실행 후 별도 단계에서 다음을 검증한다.

1. Python/JavaScript 확장 로드 로그 확인
2. 캔버스 세션 등록 확인
3. 현재 workflow snapshot 확보
4. 무해한 노드 한 개 생성·이동·위젯 설정
5. 연결 가능한 두 노드 생성과 연결
6. `comfy_canvas_get`으로 화면 상태 재확인
7. snapshot restore로 원상복구
8. 현재 그래프 queue 제출은 사용자가 허용한 테스트 workflow에서만 수행

## 11. 후속 범위

초기 구현에 포함하지 않는다.

- 서브그래프 내부 편집
- 모든 커스텀 노드의 특수 동적 위젯 지원
- ComfyUI 네이티브 Undo stack과의 완전한 통합
- 선택 노드·컨텍스트 메뉴·팝업 같은 UI 상태 제어
- Comfy Manager를 통한 커스텀 노드 설치·삭제
- Comfy Desktop 프로세스 시작·종료

## 12. 근거 문서

- [ComfyUI 서버 통신 개요](https://docs.comfy.org/development/comfyui-server/comms_overview)
- [ComfyUI 서버 경로](https://docs.comfy.org/development/comfyui-server/comms_routes)
- [ComfyUI 메시지](https://docs.comfy.org/development/comfyui-server/comms_messages)
- [ComfyUI JavaScript 확장](https://docs.comfy.org/custom-nodes/js/javascript_overview)
- [ComfyUI 프런트엔드 객체](https://docs.comfy.org/custom-nodes/js/javascript_objects_and_hijacking)
- [ComfyUI 서브그래프](https://docs.comfy.org/custom-nodes/js/subgraphs)
- [OpenAI Docs: Codex MCP 설정](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
