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

진행 중 확인한 문제:

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
