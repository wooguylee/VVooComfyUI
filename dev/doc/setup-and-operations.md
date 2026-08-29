# VVooComfyUI MCP 설치와 운영

## 목적

VVooComfyUI는 Codex의 MCP 호출을 로컬 ComfyUI API와 현재 열린 Comfy Desktop 캔버스에 연결한다. 화면 좌표를 클릭하지 않고 노드를 조회·생성·연결하고 widget 값과 프롬프트를 설정하며, 현재 UI workflow를 실행할 수 있다.

통신 경로는 다음과 같다.

```text
Codex MCP server (Node.js, STDIO)
  -> loopback HTTP + master Bearer token
ComfyUI custom node (Python)
  -> 대상 client_id의 기존 ComfyUI WebSocket
ComfyUI frontend extension (JavaScript)
  -> app.extensionManager.workflow 내부 탭 store
  -> app.rootGraph / app.canvas
```

## 요구 사항

- Windows에서 실행 중인 로컬 Comfy Desktop 설치
- Node.js 20 이상과 npm
- PowerShell 7 (`pwsh`)
- Codex에서 이 저장소를 프로젝트로 연 상태
- ComfyUI가 기본적으로 `127.0.0.1:8188`에서 접근 가능한 상태

## 프로젝트 준비와 검증

프로젝트 루트에서 다음을 실행한다.

```powershell
npm install
npm run verify
```

`npm run verify`는 Node/JavaScript 테스트, Python 단위 테스트와 TypeScript build를 수행한다.

## Comfy Desktop 확장 설치

자동 감지 설치:

```powershell
pwsh -File scripts/install-comfy-extension.ps1
```

변경 없이 설치 대상만 미리 확인:

```powershell
pwsh -File scripts/install-comfy-extension.ps1 -WhatIf
```

다른 ComfyUI root를 명시할 때는 `custom_nodes`를 포함한 경로를 전달한다.

```powershell
pwsh -File scripts/install-comfy-extension.ps1 -ComfyRoot 'C:\path\to\ComfyUI'
```

설치기는 `%APPDATA%\Comfy Desktop\installations.json`에서 설치 완료된 로컬 `ComfyUI` 하나를 선택하고, 다음 junction을 만든다. 코드가 프로젝트 root에서 `dev`로 이동하기 전에 설치된 정확한 구형 junction target은 새 `dev` source로 migration하지만, 그 밖의 target이나 일반 디렉터리는 변경하지 않는다.

```text
<ComfyUI>\custom_nodes\vvoo_comfy_mcp
  -> <프로젝트>\comfy-extension\vvoo_comfy_mcp
```

또한 `%LOCALAPPDATA%\VVooComfyUI\bridge-token`에 64자리 소문자 hex 토큰을 생성한다. 토큰 값은 로그나 문서에 출력하지 않는다. 기존 junction이 같은 프로젝트를 가리키면 재사용하고, 일반 디렉터리이거나 다른 곳을 가리키면 삭제·덮어쓰기 없이 실패한다. 토큰을 의도적으로 교체할 때만 `-ForceTokenRotation`을 사용한다.

설치 후에는 반드시 Comfy Desktop을 완전히 종료했다가 다시 실행해야 Python route와 frontend extension이 로드된다. `.codex/config.toml`의 MCP 서버를 새로 읽도록 Codex 프로젝트도 다시 열거나 MCP 설정을 reload해야 한다.

## MCP 도구

| 도구 | 역할 |
|---|---|
| `comfy_status` | ComfyUI와 canvas bridge 상태 확인 |
| `comfy_node_types` | 설치된 노드 타입과 입력 규격 조회 |
| `comfy_canvas_list` | ComfyUI WebView/browser 세션과 활성 대상 조회 |
| `comfy_workflow_list` | 선택 세션의 내부 workflow 탭 전체와 revision 조회 |
| `comfy_workflow_get` | 한 workflow 탭의 전체 JSON, 노드·링크·widget 요약 조회 |
| `comfy_workflow_select` | 대상 workflow 탭을 Comfy Desktop 화면에서 활성화 |
| `comfy_workflow_create` | 빈 JSON 또는 전달된 JSON으로 임시 탭 생성 |
| `comfy_workflow_save` | revision 확인 후 비임시 workflow 저장 |
| `comfy_workflow_rename` | 충돌 없이 workflow 경로와 탭 이름 변경 |
| `comfy_workflow_close` | 탭 닫기. 수정 탭은 discard 확인 필요 |
| `comfy_workflow_reorder` | 내부 workflow 탭 표시 순서 변경 |
| `comfy_canvas_get` | 현재 또는 지정 root workflow와 revision 조회 |
| `comfy_canvas_apply_patch` | 노드 단위 변경을 한 transaction으로 적용 |
| `comfy_canvas_replace` | 명시적 확인 후 root workflow 전체 교체 |
| `comfy_canvas_restore` | snapshot ID로 이전 workflow 복원 |
| `comfy_canvas_focus` | 노드를 선택하고 selection 또는 전체 그래프로 viewport 이동 |
| `comfy_queue_current` | 현재 UI workflow를 prompt로 변환해 실행 큐에 등록 |
| `comfy_queue_get` | 실행·대기 큐 조회 |
| `comfy_interrupt` | 현재 실행 중단 |
| `comfy_history_get` | 실행 이력 또는 특정 prompt 결과 조회 |

## 안전한 캔버스 변경 순서

1. `comfy_status`와 `comfy_canvas_list`로 bridge와 대상 WebView/browser 세션을 확인한다.
2. `comfy_workflow_list`로 그 세션 안에 열린 내부 workflow 탭과 `workflow_id`를 확인한다.
3. 분석할 탭은 `comfy_workflow_get`으로 읽는다. 비활성 탭도 화면 전환 없이 읽을 수 있다.
4. `comfy_node_types`로 사용할 노드의 실제 type, 입력, widget과 슬롯을 확인한다.
5. 대상 `workflow_id`의 revision을 `expected_revision`으로 넣어 `comfy_canvas_apply_patch`를 호출한다.
6. 쓰기 직전에 대상 탭이 화면에서 활성화되고, patch 결과가 즉시 그려진다.
7. 결과의 새 revision과 `backup_id`를 보관한다.
8. 필요하면 같은 workflow 탭의 새 revision과 backup ID로 `comfy_canvas_restore`를 호출한다.

`add_node`의 임시 `ref`를 같은 transaction의 `connect`에서 참조할 수 있다. 지원 patch는 노드 추가·삭제·이동·크기 변경, 제목·properties·widget·실행 mode·색상·collapse 변경, 연결·해제다. widget 이름에는 예를 들어 CLIP Text Encode 노드의 `text`를 지정해 positive/negative 프롬프트를 설정할 수 있다.

revision이 달라졌으면 `REVISION_CONFLICT` 또는 `WORKFLOW_REVISION_CONFLICT`로 변경을 거절하므로 대상 탭을 다시 읽고 의도를 재적용해야 한다. 노드의 절반 이상을 삭제할 때는 `confirm_mass_delete: true`, 전체 교체에는 `confirm_replace: true`, 수정 탭 닫기에는 `confirm_discard: true`가 필요하다. 변경 전 workflow는 최근 10개까지 세션 메모리에 snapshot으로 유지되고, 작업 도중 하나라도 실패하면 같은 workflow 탭에서 전체 transaction을 원래 상태로 되돌린다.

## 현재 제한

- 열려 있는 모든 root workflow 탭은 읽고 수정할 수 있다. 서브그래프가 열려 있으면 쓰기를 거절한다.
- snapshot은 해당 브라우저 탭 메모리에만 있으며 Comfy Desktop 재실행 후에는 사라진다.
- snapshot은 생성된 workflow 객체에 귀속되며 다른 탭에는 복원할 수 없다. 같은 탭의 rename은 허용한다.
- ComfyUI 네이티브 Undo stack과 별개이므로 MCP 변경 복구는 `comfy_canvas_restore`를 사용한다.
- 일부 custom node의 동적 widget·슬롯 callback은 노드 자체 구현에 따라 추가 호환 처리가 필요할 수 있다.
- 여러 WebView/browser 세션의 활성도가 같아 대상이 모호하면 자동 선택하지 않는다. `session_id`를 지정해야 한다. 내부 workflow 탭은 `workflow_id`로 별도 선택한다.
- 서비스는 loopback ComfyUI와 로컬 토큰을 전제로 하며 원격 ComfyUI URL을 허용하지 않는다.

## 문제 확인

- `comfy_status`가 `BRIDGE_TOKEN_MISSING`이면 설치기를 실행해 토큰을 만든다.
- `NO_CANVAS_SESSION`이면 Comfy Desktop을 재실행하고 ComfyUI 캔버스 탭이 열린 뒤 잠시 기다린다.
- `PROTOCOL_MISMATCH`면 저장소 확장과 빌드된 MCP 서버를 함께 최신 상태로 맞춘다.
- `REVISION_CONFLICT`면 `comfy_canvas_get`부터 다시 실행한다.
- `WORKFLOW_STORE_UNAVAILABLE`이면 Comfy Desktop과 Codex 프로젝트가 모두 새 확장·MCP build를 읽도록 재시작했는지 확인한다.
- `SNAPSHOT_WORKFLOW_MISMATCH`이면 backup을 생성한 원래 `workflow_id`로 돌아가 복원한다.
- 복원 시 `BACKUP_NOT_FOUND`이면 해당 탭이 재실행됐거나 최근 10개 범위를 벗어난 것이다.
