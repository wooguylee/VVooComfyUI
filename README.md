# VVooComfyUI

Codex가 MCP를 통해 로컬 Comfy Desktop의 API와 현재 열린 캔버스를 제어하도록 연결하는 프로젝트다. 노드 규격 조회, 노드 생성·연결, 프롬프트/widget 설정, 원자적 캔버스 변경·복원과 현재 workflow 실행을 지원한다.

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
- `comfy_canvas_list`, `comfy_canvas_get`
- `comfy_canvas_apply_patch`, `comfy_canvas_replace`, `comfy_canvas_restore`
- `comfy_queue_current`, `comfy_queue_get`, `comfy_interrupt`, `comfy_history_get`

안전한 변경 순서는 상태·노드 규격 조회 → `comfy_canvas_get`으로 revision 읽기 → 같은 revision으로 patch → 결과의 새 revision과 `backup_id` 보관이다. 실패한 patch는 자동으로 전체 롤백되며, 필요하면 `comfy_canvas_restore`에 현재 revision과 backup ID를 전달한다. 대량 삭제와 전체 교체는 각각 명시적 확인값이 필요하다.

첫 버전은 현재 보이는 root 캔버스만 수정하며 서브그래프 쓰기, 영구 snapshot, ComfyUI 네이티브 Undo 통합은 지원하지 않는다. 여러 탭의 활성도가 같으면 `session_id`를 지정해야 한다.

설치기 옵션, 도구별 설명, 프롬프트 설정 예시, 복원 절차와 제한 사항은 [설치와 운영 문서](doc/setup-and-operations.md)에 있다. 프로젝트 대화·설계·계획·검증·Git 기록은 [문서 인덱스](doc/README.md)에서 확인할 수 있다.
