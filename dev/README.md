# VVooComfyUI

Codex가 MCP를 통해 로컬 Comfy Desktop의 API, 내부 workflow 탭과 현재 보이는 root 캔버스를 제어하도록 연결하는 프로젝트다. 열린 탭 전체 분석, 탭 선택·생성·저장·이름 변경·정렬·닫기, 노드 규격 조회, 노드 생성·연결, 프롬프트/widget 설정, 원자적 캔버스 변경·복원과 workflow 실행을 지원한다.

## 준비와 설치

요구 사항은 Windows의 로컬 Comfy Desktop, Node.js 20 이상, npm, PowerShell 7과 이 저장소를 연 Codex 프로젝트다.

```powershell
npm install
npm run verify
pwsh -File scripts/install-comfy-extension.ps1 -WhatIf
pwsh -File scripts/install-comfy-extension.ps1
```

설치기는 Comfy Desktop의 로컬 `ComfyUI` 설치를 자동 감지해 `custom_nodes\vvoo_comfy_mcp` junction과 `%LOCALAPPDATA%\VVooComfyUI\bridge-token`을 안전하게 만든다. 기존 대상이 다른 디렉터리이면 덮어쓰거나 삭제하지 않고 실패한다.

설치 후 Comfy Desktop을 완전히 종료했다가 다시 실행해야 한다. `.codex/config.toml`의 MCP 서버를 새로 읽도록 Codex 프로젝트도 다시 열거나 MCP 설정을 reload해야 한다.

## MCP 도구

- `comfy_status`, `comfy_node_types`
- `comfy_canvas_list`: ComfyUI WebView/browser 세션 목록
- `comfy_workflow_list`, `comfy_workflow_get`, `comfy_workflow_select`
- `comfy_workflow_create`, `comfy_workflow_save`, `comfy_workflow_rename`, `comfy_workflow_close`, `comfy_workflow_reorder`
- `comfy_canvas_get`, `comfy_canvas_apply_patch`, `comfy_canvas_replace`, `comfy_canvas_restore`, `comfy_canvas_focus`
- `comfy_queue_current`, `comfy_queue_get`, `comfy_interrupt`, `comfy_history_get`

`session_id`는 Comfy Desktop의 WebView/browser 세션을, `workflow_id`는 그 세션 안의 내부 workflow 탭을 가리킨다. 안전한 변경 순서는 `comfy_canvas_list` → `comfy_workflow_list` → 대상 `comfy_workflow_get` → 같은 revision과 workflow ID로 patch → 새 revision과 `backup_id` 보관이다. 쓰기 전에 대상 탭이 화면에서 활성화되므로 사용자는 탭 전환과 결과를 즉시 볼 수 있다.

실패한 patch는 같은 workflow 탭에서 자동 롤백되며 snapshot은 다른 탭에 복원할 수 없다. 대량 삭제와 전체 교체, 수정된 탭 닫기는 각각 명시적 확인값이 필요하다. root workflow는 탭별로 지원하지만 서브그래프 내부 쓰기, 영구 snapshot, ComfyUI 네이티브 Undo 통합은 지원하지 않는다.

설치기 옵션, 도구별 설명, 프롬프트 설정 예시, 복원 절차와 제한 사항은 [설치와 운영 문서](doc/setup-and-operations.md)에 있다. 프로젝트 대화·설계·계획·검증·Git 기록은 [문서 인덱스](doc/README.md)에서 확인할 수 있다.
