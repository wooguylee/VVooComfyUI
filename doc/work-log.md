# 작업 로그

## 2026-08-29

### 단계 1: 환경 조사와 설계 명세

상태: 작성 완료, 커밋 전

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
