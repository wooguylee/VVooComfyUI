# Local Comfy MCP 설치와 운영

## 목적

Codex가 Comfy Org의 공식 `comfy-mcp` stdio 서버를 실행하고, 로컬 Comfy Desktop의 ComfyUI workspace를 `comfy-cli`를 통해 제어하도록 연결한다.

공식 기준:

- Comfy MCP: <https://docs.comfy.org/agent-tools/mcp.md#local-comfy-mcp-connection>
- Codex MCP 설정: <https://developers.openai.com/codex/mcp>

## 설치 구성

| 항목 | 값 |
|---|---|
| Python | 3.11.15 |
| 가상환경 | `W:\WorkAI\VVooComfyUI\.venv-comfy-mcp` |
| comfy-cli | 1.19.0 |
| comfy-mcp | 0.10.0 |
| ComfyUI workspace | `C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI` |
| Codex 설정 | `W:\WorkAI\VVooComfyUI\.codex\config.toml` |
| MCP 서버 이름 | `comfy_mcp` |

가상환경은 Git에서 제외하며, 실행 파일의 절대 경로를 Codex 설정에 사용한다. `COMFY_BIN`도 절대 경로로 지정해 Codex가 시작한 프로세스의 `PATH`와 무관하게 `comfy-cli`를 찾도록 했다.

Windows 한국어 코드페이지에서 `comfy-cli` 1.19.0 도움말의 Unicode 문자가 `UnicodeEncodeError`를 발생시키는 것을 확인했으므로 MCP 서버 환경에 `PYTHONUTF8=1`을 명시했다.

## 재설치

프로젝트 루트에서 다음 명령을 실행한다.

```powershell
& 'C:\Users\Administrator\AppData\Roaming\uv\python\cpython-3.11.15-windows-x86_64-none\python.exe' -m venv '.venv-comfy-mcp'
& '.\.venv-comfy-mcp\Scripts\python.exe' -m pip install 'comfy-cli>=1.14.0' comfy-mcp
```

기존 Comfy Desktop workspace를 기본 local workspace로 지정한다.

```powershell
$env:PYTHONUTF8 = '1'
$workspace = 'C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI'
& '.\.venv-comfy-mcp\Scripts\comfy.exe' --json set-default $workspace --where local
```

## Codex 설정

프로젝트 루트의 `.codex/config.toml`은 다음 원칙을 사용한다.

- `comfy-mcp.exe`를 stdio 서버로 직접 실행한다.
- `COMFY_BIN`은 같은 가상환경의 `comfy.exe` 절대 경로다.
- `PYTHONUTF8=1`로 stdio와 CLI 출력을 UTF-8로 고정한다.
- 읽기 전용이 아닌 MCP 도구는 Codex 승인 대상으로 둔다.
- 긴 로컬 생성 작업을 위해 도구 제한 시간을 3,600초로 둔다.

설정을 새로 읽으려면 Codex에서 이 프로젝트를 다시 열거나 MCP 서버를 재시작한다. 연결 후 첫 호출은 `server_info()`로 ComfyUI 실행 상태와 workspace를 확인한다.

## 운영 순서

1. Comfy Desktop에서 로컬 ComfyUI를 실행하거나 MCP의 `launch_comfyui`를 호출한다.
2. `server_info()`로 실행 상태와 workspace를 확인한다.
3. 필요하면 `search_models`, `search_nodes` 또는 `search_templates`로 로컬 설치를 조회한다.
4. 워크플로 실행 전 `validate_workflow`로 검증한다.
5. `run_workflow`로 실행한 뒤 `fetch_outputs`로 결과를 원하는 디렉터리에 복사한다.

## 실연결 검증

Codex와 동일한 `command`, `cwd`, `COMFY_BIN`, `PYTHONUTF8` 환경으로 공식 MCP Python client를 연결해 다음 순서를 검증했다.

1. stdio MCP 초기화
2. `tools/list`
3. 실행 전 `server_info()`
4. `launch_comfyui()`
5. 실행 후 `server_info()`

결과:

- MCP server name: `comfy-mcp`
- 등록 도구: 39개
- 필수 도구 `server_info`, `launch_comfyui`, `run_workflow`, `fetch_outputs`: 모두 존재
- 실행 전 상태: `server.running=false`
- 실행 결과: `127.0.0.1:8188`의 background ComfyUI 시작
- 실행 후 상태: `server.running=true`, URL `http://127.0.0.1:8188`
- workspace: 설정한 Comfy Desktop workspace와 일치
- ComfyUI core: `v0.34.2`, 최신 상태
- GPU: NVIDIA GeForce RTX 3090, VRAM 24 GiB
- compatibility warnings: 0개
- 전체 MCP 검증 프로세스: exit code 0
- `stop_comfyui()` 성공 후 최종 `server.running=false` 확인

이미지나 워크플로는 실행하지 않았으며, 검증용 ComfyUI 프로세스는 정상 종료했다.

## 확인된 Windows 실행 특성

전용 가상환경을 활성화하지 않은 일반 셸에서 `comfy.exe`를 절대 경로로 직접 호출해 `launch --background`를 실행하면, `comfy-cli`가 내부에서 bare `comfy` 명령을 재호출할 때 `PATH`에서 찾지 못할 수 있다.

공식 `comfy-mcp 0.10.0`은 이 경우를 처리한다. `COMFY_BIN`을 해석한 디렉터리를 자식 프로세스의 `PATH` 앞에 추가한 뒤 `comfy-cli`를 실행하므로, Codex의 MCP 호출에서는 `launch_comfyui()`가 정상 동작한다. 운영 시 수동 `comfy launch` 대신 MCP의 `launch_comfyui`를 사용하거나 가상환경을 활성화한다.

현재 Comfy Desktop workspace에는 이전 작업이 만든 `vvoo_comfy_mcp` custom-node junction이 남아 있어 시작 로그에 해당 legacy node의 import warning이 기록됐다. 이번 새 작업에서는 기존 `dev`와 그 외부 junction을 수정하거나 제거하지 않았다. 공식 `comfy-mcp` 초기화, 39개 도구 등록, `server_info`, HTTP 상태 확인과 lifecycle 검증에는 영향을 주지 않았다.

## Codex 반영

설정 파일과 서버 실행은 검증됐다. 현재 열려 있던 Codex 작업의 도구 목록은 시작 시점에 정해지므로, 실제 대화에서 `comfy_mcp` 도구를 사용하려면 이 프로젝트를 새 작업으로 열거나 MCP 서버를 재시작한다.
