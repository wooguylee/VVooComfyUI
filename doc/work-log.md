# 작업 로그

## 2026-08-29

### 작업 1: 공식 Local Comfy MCP 설치와 프로젝트 설정

상태: 설치·설정·검증 완료

범위:

- 기존 `dev` 디렉터리를 수정하지 않고 프로젝트 루트에서 새로 시작
- Python 3.11 전용 가상환경 생성
- 공식 `comfy-cli>=1.14.0`, `comfy-mcp` 설치
- 기존 Comfy Desktop의 ComfyUI workspace를 기본 local workspace로 지정
- 프로젝트별 Codex stdio MCP 설정 추가
- 가상환경 Git 제외와 설치·운영 문서 작성

설치 결과:

- Python: 3.11.15
- comfy-cli: 1.19.0
- comfy-mcp: 0.10.0
- 기본 workspace: `C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI`
- 기본 실행 위치: `local`

확인한 문제와 처리:

- 첫 패키지 설치 종료 시점과 즉시 재시도 시점이 겹치며 Windows 파일 잠금 오류가 발생했다.
- 관련 Python/pip 프로세스가 없고 문제 파일의 독점 열기가 가능해진 것을 확인한 후 재실행했으며, 두 패키지가 설치된 상태와 exit code 0을 확인했다.
- Windows CP949 콘솔에서 `comfy-cli` 도움말의 em dash 출력이 `UnicodeEncodeError`를 일으켰다.
- `PYTHONUTF8=1`만 적용한 동일 도움말 명령이 exit code 0으로 끝나 원인을 확인했고, Codex MCP 환경에도 같은 값을 추가했다.

검증 결과:

- 패키지 metadata: `comfy-cli=1.19.0`, `comfy-mcp=0.10.0`
- `python -m pip check`: `No broken requirements found`, exit code 0
- `.codex/config.toml`: Python `tomllib` 파싱 성공
- 설정의 `command`, `COMFY_BIN`: 두 실행 파일 모두 존재
- `comfy --json which`: 지정한 Comfy Desktop workspace를 `default`로 반환, exit code 0
- `codex mcp list`: `comfy_mcp`가 `enabled` 상태로 표시, exit code 0
- `git diff --check`: exit code 0
- 변경 경로: `.codex/`, `.gitignore`, `doc/`만 해당
- `dev` 변경 파일 수: 0

Git 마무리:

- 커밋 메시지: `chore: configure official local Comfy MCP`
- 푸시 대상: `origin/main`

실제 Git 결과:

- 커밋: `48e0ccf chore: configure official local Comfy MCP`
- 푸시: `origin/main` 성공
- 푸시 후 `HEAD`와 `origin/main`: `48e0ccfe64a72a13320349471bb7510594e10c13`로 일치

### 작업 2: 공식 MCP 실연결과 ComfyUI 기동 검증

상태: 실연결·수명주기·문서 검증 완료

검증 경로:

- 프로젝트 설정과 동일한 `comfy-mcp.exe`, `cwd`, `COMFY_BIN`, `PYTHONUTF8`로 stdio client 시작
- MCP initialize 완료
- `tools/list`에서 39개 도구 수신
- `server_info → launch_comfyui → server_info` 순서로 호출

MCP 결과:

- server name: `comfy-mcp`
- 필수 도구 `server_info`, `launch_comfyui`, `run_workflow`, `fetch_outputs`: 모두 등록
- 실행 전: `server.running=false`
- `launch_comfyui`: background 서버를 `127.0.0.1:8188`에 시작
- 실행 후: `server.running=true`, URL `http://127.0.0.1:8188`
- workspace: 설정한 Comfy Desktop workspace와 일치
- ComfyUI core: `v0.34.2`, `outdated=false`
- hardware: NVIDIA GeForce RTX 3090, VRAM 25,769,803,776 bytes
- compatibility warnings: 빈 목록
- 통합 검증 exit code: 0
- 이미지·워크플로 실행: 없음

확인한 문제와 처리:

- 가상환경을 활성화하지 않은 셸에서 `comfy.exe` 절대 경로로 직접 `launch --background`를 호출하면 내부 bare `comfy` 재호출이 `PATH`에서 명령을 찾지 못해 실패했다.
- 공식 `comfy-mcp` 소스에서 `COMFY_BIN` 디렉터리를 자식 `PATH` 앞에 추가하는 처리를 확인했다.
- 실제 MCP의 `launch_comfyui` 호출은 같은 환경에서 성공했으므로 `.codex/config.toml` 변경은 필요하지 않았다.
- 첫 검증 client는 CP949 출력과 MCP SDK 2.x의 snake_case 필드명을 반영하지 못해 launch 전 중단됐다. 검증 client를 UTF-8로 시작하고 `server_info` 필드명을 사용한 뒤 전체 순서가 exit code 0으로 끝났다.
- 첫 성공 검증에서 시작된 background 프로세스는 검증용 터미널 세션 종료 뒤 자식 프로세스 정리 경계에서 함께 종료됐다. ComfyUI 로그에는 crash나 정상 shutdown 기록이 없었다.
- 최종 검증은 하나의 MCP 세션 안에서 `launch_comfyui → server_info → HTTP system_stats → stop_comfyui → server_info` 전체 수명주기를 수행했다.
- 최종 실행 중 `server.running=true`, `GET /api/system_stats` HTTP 200을 확인했다.
- `stop_comfyui`는 `stopped=true`를 반환했고 최종 `server.running=false`를 확인했다.
- 최종 lifecycle 검증 exit code: 0
- 기존 `dev` 연계 custom-node junction에서 import warning이 있었지만, 사용자 지시에 따라 기존 작업은 수정하지 않았다. 공식 MCP 검증에는 영향이 없었다.

최종 정적 검증:

- Codex MCP 설정 재확인
- Python 의존성 무결성 재확인
- Git diff와 `dev` 무변경 확인

Git 마무리:

- 커밋 메시지: `docs: verify local Comfy MCP connection`
- 푸시 대상: `origin/main`
