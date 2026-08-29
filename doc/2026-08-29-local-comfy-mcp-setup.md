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

## 현재 검증 경계

설치와 프로젝트 설정 검증은 완료 후 작업 로그에 기록한다. 실제 ComfyUI 프로세스와 `server_info()`의 연결 검증은 별도 작업과 커밋으로 기록한다.

