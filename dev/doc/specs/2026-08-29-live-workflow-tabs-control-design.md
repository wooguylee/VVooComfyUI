# Live Workflow Tabs Control Design

## 목적

VVooComfyUI MCP가 Computer Use 없이 Comfy Desktop 내부 workflow 탭을 조회하고, 사용자가 보고 있는 화면에서 대상 탭을 활성화한 뒤 노드와 연결, widget, workflow 수명주기를 실시간으로 제어하게 한다. Codex는 열린 모든 탭을 하나씩 읽어 노드의 역할과 데이터 흐름을 설명할 수 있어야 하며, 사용자가 요청하면 같은 탭을 즉시 수정할 수 있어야 한다.

## 성공 조건

- 열린 workflow 탭 전체와 현재 활성 탭을 안정된 `workflow_id`로 조회한다.
- 활성·비활성 탭의 workflow JSON, 노드·링크·widget 요약과 revision을 읽는다.
- 쓰기 대상 탭을 Comfy Desktop 화면에서 먼저 활성화하고 노드 변경을 즉시 그린다.
- 탭 생성·선택·순서 변경·저장·이름 변경·닫기를 MCP로 수행한다.
- 노드 추가·삭제·이동·크기·제목·색상·실행 mode·collapse·properties·widget과 연결을 원자적으로 변경한다.
- 변경 노드를 선택하거나 특정 노드·전체 그래프로 viewport를 이동해 사용자가 결과를 바로 볼 수 있게 한다.
- stale revision, 잘못된 탭, 수정된 탭 닫기, 대량 삭제, 전체 교체와 다른 탭 snapshot 복원을 안전하게 거절한다.
- 기존 queue, history, node type, canvas patch·replace·restore 기능을 유지한다.
- 설치와 Codex MCP 설정을 `dev` 디렉터리 기준으로 정리하고, 마지막 Comfy Desktop 재로딩은 사용자가 수행한다.

## 비목표

- Computer Use, 화면 좌표 클릭 또는 DOM 탭 클릭을 사용하지 않는다.
- workflow 파일의 영구 삭제는 이번 범위에 포함하지 않는다. 탭 닫기만 지원한다.
- 서브그래프 내부 쓰기와 ComfyUI 네이티브 Undo 통합은 기존과 같이 지원하지 않는다.
- Comfy Cloud나 원격 ComfyUI를 제어하지 않는다.
- 프런트엔드 비공개 번들 모듈을 직접 import하지 않는다.

## 권장 아키텍처

ComfyUI가 확장에 공개하는 `app.extensionManager.workflow`를 workflow 탭의 단일 진실 원천으로 사용한다. 이 store는 `openWorkflows`, `activeWorkflow`, `openWorkflow`, `createNewTemporary`, `saveWorkflow`, `renameWorkflow`, `closeWorkflow`, `reorderWorkflows`를 제공한다. 현재 root 그래프는 `app.rootGraph`와 `app.canvas`로 다룬다.

```text
Codex
  -> vvoo-comfyui MCP server (Node.js STDIO)
  -> authenticated loopback Python bridge
  -> selected ComfyUI WebSocket client
  -> frontend canvas bridge
       -> app.extensionManager.workflow
       -> app.rootGraph / app.canvas
```

Python bridge의 `client_id`는 브라우저 창·WebView 세션을 선택한다. 그 세션 안에서 `workflow_id`는 내부 workflow 탭을 선택한다. `workflow_id`는 store에서 유일한 `workflow.path`를 그대로 사용한다. 임시 workflow도 store가 충돌 없는 `workflows/Unsaved Workflow*.json` 경로를 부여하므로 같은 선택 규칙을 적용한다.

## 프런트엔드 명령

기존 canvas 명령에 다음 workflow 명령을 추가한다.

- `workflow.list`: 열린 탭의 compact metadata와 `active_workflow_id` 반환
- `workflow.get`: 지정 탭의 workflow JSON, summary와 revision 반환
- `workflow.select`: 지정 탭을 로드하고 화면에서 활성화
- `workflow.create`: 빈 workflow 또는 전달된 workflow JSON으로 새 임시 탭 생성 후 활성화
- `workflow.save`: 현재 내용을 지정 탭의 서버 파일에 저장
- `workflow.rename`: 충돌 없는 새 `workflows/...json` 경로로 이름 변경
- `workflow.close`: 탭을 닫고 필요하면 다음 탭을 활성화
- `workflow.reorder`: 탭 표시 순서 변경
- `canvas.focus`: 지정 노드를 선택하고 해당 노드 또는 전체 그래프로 viewport 이동

기존 `canvas.apply_patch`, `canvas.replace`, `canvas.restore`, `canvas.to_prompt` payload에는 선택적 `workflow_id`를 추가한다. `workflow_id`가 있으면 명령 실행 전에 대상 탭을 활성화한다. 없으면 현재 활성 탭을 사용해 이전 호출과 호환한다.

## MCP 도구

Node MCP 서버에는 다음 도구를 노출한다.

- `comfy_workflow_list`
- `comfy_workflow_get`
- `comfy_workflow_select`
- `comfy_workflow_create`
- `comfy_workflow_save`
- `comfy_workflow_rename`
- `comfy_workflow_close`
- `comfy_workflow_reorder`
- `comfy_canvas_focus`

각 도구는 선택적인 `session_id`와 필요한 `workflow_id`를 명시적으로 받는다. `comfy_workflow_list`가 반환한 ID를 후속 호출에 그대로 사용한다. 여러 workflow를 한 응답에 전부 포함하지 않고 list 후 get을 반복해 MCP 출력 제한을 피한다.

## Workflow 조회 모델

`workflow.list`는 다음 항목을 탭 순서대로 반환한다.

- `workflow_id`, `path`, `filename`, `key`
- `index`, `active`, `modified`, `temporary`, `loaded`
- `node_count`, `link_count`
- 계산 가능한 경우 `revision`

`workflow.get`은 활성 탭이면 `app.rootGraph.serialize()`을 사용한다. 비활성 탭이면 `workflow.activeState`를 사용한다. ComfyUI는 탭 전환 전에 활성 그래프 상태를 해당 workflow에 보관하므로 비활성 탭을 화면에서 전환하지 않고 읽을 수 있다. 상태가 아직 load되지 않았다면 read 명령만 `workflow.load()`를 허용하되 활성 탭은 바꾸지 않는다.

노드 summary는 serialized workflow에서도 계산 가능하도록 graph-state 모듈을 분리한다. 각 노드에 ID, type, title, position, size, mode, flags, properties와 widget 값을 포함하고, link에는 origin/target 노드와 슬롯을 포함한다. 전체 JSON은 분석이 필요한 경우에만 `workflow.get`이 반환한다.

## 실시간 쓰기 흐름

모든 캔버스 쓰기는 다음 순서를 따른다.

1. `session_id`로 frontend 세션을 선택한다.
2. `workflow_id`가 있으면 store에서 정확한 workflow를 찾는다.
3. 대상이 비활성 탭이면 현재 그래프 상태를 보존하고 대상 workflow를 로드해 화면에서 활성화한다.
4. 활성 root graph의 revision을 다시 계산한다.
5. `expected_revision`과 다르면 아무 작업도 하지 않고 거절한다.
6. 대상 workflow에 귀속된 snapshot을 만든다.
7. patch 전체를 한 transaction으로 적용한다.
8. 캔버스를 dirty 처리하고 변경 노드가 보이도록 선택·viewport 요청을 적용한다.
9. 새 workflow, summary, revision, `backup_id`와 실제 활성 workflow ID를 반환한다.

이 순서 때문에 사용자는 MCP가 다른 탭을 수정할 때 Comfy Desktop에서 탭 전환과 최종 그래프 변경을 즉시 본다. patch 명령은 직렬화하므로 같은 frontend 세션에서 두 명령이 동시에 그래프를 변경하지 않는다.

## Patch 확장

기존 operation을 유지하고 다음 operation을 추가한다.

- `set_mode`: LiteGraph node 실행 mode 설정
- `set_colors`: node `color`와 `bgcolor` 설정 또는 해제
- `set_collapsed`: node collapse 상태 설정

노드 추가는 기존처럼 type, ref, position, size, title, widgets, properties를 받으며 mode, color, bgcolor, collapsed도 선택적으로 받는다. 모든 node type과 widget 이름은 먼저 `comfy_node_types`로 확인한다.

`canvas.focus`는 영구 workflow 변경이 아닌 UI 상태 변경이다. node ID 배열, `select`, `fit`을 받고 `fit="selection"` 또는 `fit="all"`을 지원한다. 지원하지 않는 frontend 메서드는 workflow 변경을 되돌리지 않고 `VIEWPORT_UNSUPPORTED`로 분리해 보고한다.

## 탭 수명주기와 안전 규칙

- **생성:** 기본 빈 workflow 또는 검증된 workflow JSON으로 임시 탭을 만들고 즉시 활성화한다.
- **선택:** store에서 정확한 `workflow_id`를 찾고 load한 뒤 `app.loadGraphData`로 화면과 store를 함께 전환한다.
- **저장:** `expected_revision`을 요구한다. 임시 탭은 먼저 `workflow.rename`으로 저장 경로를 확정해야 한다.
- **이름 변경:** 대상 경로가 이미 존재하면 덮어쓰지 않고 `WORKFLOW_PATH_CONFLICT`를 반환한다.
- **닫기:** 수정되지 않은 탭은 바로 닫을 수 있다. 수정된 탭은 `confirm_discard=true`가 없으면 `WORKFLOW_DISCARD_CONFIRMATION_REQUIRED`로 거절한다. 마지막 탭을 닫을 때는 새 빈 탭을 먼저 만든다.
- **순서 변경:** 열린 탭 범위의 정수 index만 허용한다.
- **삭제:** 서버 workflow 파일 영구 삭제 도구는 제공하지 않는다.

기존 대량 삭제는 `confirm_mass_delete=true`, 전체 교체는 `confirm_replace=true`를 계속 요구한다. save, rename, close와 canvas write는 쓰기 도구로 표시하고 MCP approval mode `writes`의 적용을 받는다.

## Snapshot 귀속과 복원

현재 snapshot 저장소는 workflow JSON만 보관하므로 다른 탭에서 backup ID를 잘못 사용할 수 있다. snapshot record를 다음처럼 변경한다.

```text
backup_id -> { workflow_id, workflow }
```

`canvas.restore`는 현재 활성 workflow ID가 snapshot의 workflow ID와 같아야 한다. 다르면 `SNAPSHOT_WORKFLOW_MISMATCH`를 반환하고 아무것도 변경하지 않는다. 탭 rename 후에는 store 객체의 현재 path와 snapshot 생성 당시 ID를 함께 추적해 같은 workflow 객체의 정상 rename은 허용하되 다른 탭에는 적용하지 않는다.

## 오류 계약

다음 안정된 오류 코드를 추가한다.

- `WORKFLOW_STORE_UNAVAILABLE`
- `WORKFLOW_NOT_FOUND`
- `WORKFLOW_NOT_LOADED`
- `WORKFLOW_BUSY`
- `WORKFLOW_PATH_CONFLICT`
- `WORKFLOW_REVISION_CONFLICT`
- `WORKFLOW_DISCARD_CONFIRMATION_REQUIRED`
- `SNAPSHOT_WORKFLOW_MISMATCH`
- `VIEWPORT_UNSUPPORTED`

프런트엔드 내부 예외와 파일 경로 세부 정보는 필요한 범위만 구조화해 반환하고 stack과 token은 노출하지 않는다. heartbeat와 WebSocket이 끊긴 세션은 기존 TTL 정리 규칙을 유지한다.

## 호환성과 기능 탐지

프런트엔드 확장은 `app.extensionManager?.workflow`와 필요한 method를 runtime에서 검사한다. 없으면 canvas 기존 기능은 유지하고 workflow 도구만 `WORKFLOW_STORE_UNAVAILABLE`로 거절한다. `comfy_status`와 `workflow.list`에는 다음 capability를 포함한다.

- `workflow_tabs`
- `workflow_lifecycle`
- `canvas_focus`
- `snapshot_workflow_binding`

비공개 번들 경로 import는 사용하지 않으므로 ComfyUI frontend asset hash와 무관하다.

## 테스트 전략

### JavaScript

- fake workflow store에 활성·비활성·임시·수정 탭을 구성한다.
- list/get이 탭 순서와 activeState를 정확히 반환하는지 검증한다.
- select/create/save/rename/close/reorder가 store와 root graph를 함께 갱신하는지 검증한다.
- 비활성 탭 patch가 먼저 탭을 활성화하고 화면 graph를 변경하는지 검증한다.
- revision 충돌, 이름 충돌, 수정 탭 close, 마지막 탭 close와 snapshot 교차 복원을 검증한다.
- 새 node mode/color/collapse operation과 viewport focus를 검증한다.

### Python

- 새 workflow command allowlist와 route 전달을 검증한다.
- 명령 결과가 요청을 소유한 frontend session에서만 resolve되는 기존 보안을 유지한다.

### Node/TypeScript

- 모든 새 Zod schema의 정상·오류 입력을 검증한다.
- tool handler가 정확한 frontend command와 workflow ID를 전달하는지 검증한다.
- MCP server가 새 도구를 read/write annotation과 함께 등록하는지 검증한다.

### 통합과 설치

- `npm run verify`로 JS, Node, Python, TypeScript build를 전부 실행한다.
- 설치기의 `-WhatIf`와 실제 junction/token 검사를 실행한다.
- `dev/.codex/config.toml`의 `cwd`와 `dist/index.js`가 실제 build 위치를 가리키는지 확인한다.
- Comfy Desktop 재로딩 전에는 기존 탭을 건드리지 않는다.
- 사용자가 재로딩한 뒤 새 Codex 세션에서 `comfy_status` -> `comfy_workflow_list` -> 각 `comfy_workflow_get` 순으로 live 검증한다.

## 재로딩 경계

코드, 테스트, build, junction과 MCP 설정까지 Codex가 완료한다. custom node junction이 source 디렉터리를 가리키므로 별도 복사는 필요하지 않다. 새 Python route와 frontend JavaScript를 로드하려면 사용자가 Comfy Desktop을 완전히 재시작해야 한다. 새 MCP tool inventory를 읽으려면 그 뒤 Codex 프로젝트도 새 세션으로 연다. 재시작 전에는 현재 열린 workflow 탭을 보존하기 위해 Comfy Desktop 프로세스를 자동 종료하지 않는다.
