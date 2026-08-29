# Comfy Desktop MCP 제어 대화 기록

- 날짜: 2026-08-29
- Codex 작업: `Comfy Desktop 제어 가능 여부 확인`
- 작업 ID: `01a04ca9-f13a-7742-93bb-e890e32e8e5f`
- 프로젝트: `W:\WorkAI\VVooComfyUI`

이 문서는 프로젝트에 관한 사용자와 Assistant의 대화를 시간순으로 보존한다. 도구 호출의 원문 전체 대신 대화 메시지와 그 결과로 확정된 기술 사실을 기록하며, 상세 조사 결과는 설계 명세와 작업 로그에 보관한다.

## 1. Comfy Desktop 제어 가능 여부

### 사용자

> 내 데스크탑에 설치된 Comfy Desktop을 니가 제어할 수 있어?

### Assistant

가능해. 현재 세션에는 Windows용 Computer Use 기능이 있어서 Comfy Desktop을 열고 다음 작업을 할 수 있어.

- 워크플로 열기·노드 연결·값 입력
- 모델/LoRA 선택
- Queue 실행 및 진행 상태 확인
- 오류 메시지 분석
- 생성 이미지 확인·저장

다만 Windows에서는 제어 중 마우스와 키보드를 실제로 사용하므로 화면이 잠기면 안 되고, 조작 중에는 PC 사용이 겹치지 않는 편이 좋다. 삭제·덮어쓰기 같은 중요한 작업은 실행 전에 확인하겠다. [OpenAI 공식 안내](https://learn.chatgpt.com/use-cases/use-your-computer-with-codex)

## 2. Computer Use 이외의 통신 제어

### 사용자

> computer use가 아닌 상호 통신을 통한 제어 같은건 불가능해?

### Assistant

가능해. 오히려 ComfyUI는 Computer Use보다 **로컬 HTTP/WebSocket API로 제어하는 방식이 더 안정적**이야.

가능한 제어:

- `POST /prompt`: API 형식 워크플로 실행
- `/ws`: 실행 진행률·노드 상태·오류 실시간 수신
- `/queue`, `/interrupt`: 대기열 조회·중단
- `/history/{prompt_id}`, `/view`: 결과 확인·이미지 수신
- `/models`, `/object_info`, `/system_stats`: 모델·노드·GPU 정보 조회

ComfyUI가 공식적으로 제공하는 인터페이스다. [ComfyUI 서버 API 경로](https://docs.comfy.org/development/comfyui-server/comms_routes), [공식 WebSocket 예제](https://github.com/Comfy-Org/ComfyUI/blob/master/script_examples/websockets_api_example.py)

다만 구분할 점이 있어:

- 워크플로 실행, 파라미터 변경, 결과 다운로드 → API만으로 가능
- 화면에 보이는 노드를 직접 이동하거나 현재 캔버스를 실시간 편집 → 기본 서버 API만으로는 제한적이며 프런트엔드 확장이나 별도 브리지가 필요

가장 적절한 방법은 현재 프로젝트에 로컬 전용 ComfyUI 제어 클라이언트를 만들어서 서버 자동 탐색, API 워크플로 로드, 노드별 값 변경, 실행 모니터링과 결과 저장을 제공하는 것이다.

## 3. MCP 구현 요청과 실행 책임 범위

### 사용자

> 니가 MCP 형식으로 Comfy Desktop을 제어하도록 해줘. Comfy Desktop은 실행해뒀어.

### Assistant

당시 확인 결과 Comfy Desktop 앱은 실행 중이었지만 `127.0.0.1:8188`의 ComfyUI 백엔드는 아직 실행되지 않았다. MCP가 Desktop 프로세스를 시작·종료하지 않고, 사용자가 Desktop에서 로컬 인스턴스를 연 뒤 MCP가 API 연결·워크플로 실행·진행 상태·결과 관리를 맡는 방식을 권장했다. MCP는 프로젝트 로컬 Node.js STDIO 서버로 등록하는 방향을 제안했다.

## 4. 로컬 ComfyUI 실행 확인

### 사용자

> 로컬 실행은 했어

### Assistant

`127.0.0.1:8188`에서 ComfyUI `0.34.2`가 정상 응답하고 GPU 장치 1개, 실행·대기 작업 0개 상태임을 확인했다.

구현 방식으로 다음 세 가지를 비교했다.

1. 프로젝트 로컬 Node.js STDIO MCP 서버 — 권장
2. Streamable HTTP MCP 서버
3. ComfyUI 커스텀 노드/확장에 MCP 기능 내장

별도 상주 포트가 필요 없고 Codex가 필요할 때 실행하며 `127.0.0.1:8188`만 호출하는 첫 번째 방식을 권장했다.

## 5. MCP 서버 기능 범위

### 사용자

> MCP 서버를 통해서 수행 가능한건 어떤게 있을까?

### Assistant

MCP를 통하면 ComfyUI의 핵심 생성 기능 대부분을 화면 조작 없이 제어할 수 있다고 설명했다.

| 영역 | 가능한 작업 |
|---|---|
| 상태 확인 | ComfyUI/Python 버전, GPU·VRAM, 기능 상태 확인 |
| 모델·노드 조회 | 체크포인트·LoRA·VAE 목록, 설치된 노드와 입력 규격 조회 |
| 워크플로 구성 | 노드 규격을 읽어 API 워크플로 생성·수정 |
| 파라미터 변경 | 프롬프트, 시드, 모델, LoRA, 스텝, CFG, 해상도, 배치 수 변경 |
| 입력 파일 | 이미지·마스크 업로드 |
| 실행 | API 형식 JSON 워크플로를 큐에 등록 |
| 실시간 관찰 | 실행 시작, 현재 노드, 진행률, 캐시 사용, 오류를 WebSocket으로 수신 |
| 작업 관리 | 실행·대기 목록 조회, 작업 중단, 대기열 정리 |
| 결과 관리 | 실행 이력과 출력 메타데이터 조회, 생성 이미지 가져오기 |
| 메모리 관리 | 모델 언로드, VRAM/RAM 해제 요청 |
| 워크플로 파일 | 저장된 사용자 워크플로 조회·저장·이름 변경 가능 |

기본 API만으로 Desktop 화면의 노드를 실시간으로 이동·선택·연결하거나 현재 캔버스를 읽는 것은 어렵고, 이를 위해 프런트엔드 확장이 필요하다고 구분했다.

## 6. 노드 생성·연결·프롬프트 설정

### 사용자

> 노드를 생성하고 각 노드에 맞게 연결하고 노드의 프롬프트를 설정하는것도 가능해?

### Assistant

실행 가능한 노드 그래프 생성은 MCP만으로 가능하다고 답했다.

- `/object_info`에서 노드 규격 조회
- 노드 ID와 `class_type` 생성
- 노드 입력값과 프롬프트 설정
- `[연결할 노드 ID, 출력 슬롯 번호]` 형식으로 노드 연결
- `/prompt`로 실행
- 실행 전 노드·모델·필수 입력값 검증

다만 API 그래프를 전송하는 것만으로 현재 Desktop 화면에 노드가 그려지지는 않는다. 현재 열린 캔버스를 즉시 바꾸려면 ComfyUI 프런트엔드 확장이 추가로 필요하다고 설명했다.

## 7. 현재 열린 캔버스 실시간 편집 범위

### 사용자

> 현재 열린 캔버스를 실시간으로 바꾸는 기능까지 되도록 구현하려면, 구현 범위가 어떻게 되는거야?

### Assistant

현재 열린 캔버스를 직접 바꾸려면 단순 MCP 서버 외에 ComfyUI Python 브리지와 프런트엔드 JavaScript 확장이 필요하다고 설명했다.

```text
Codex
  │ MCP 명령
  ▼
프로젝트의 MCP 서버
  │ localhost HTTP
  ▼
ComfyUI Python 브리지
  │ ComfyUI WebSocket 메시지
  ▼
ComfyUI 프런트엔드 확장
  │
  └─ 현재 열린 app.graph / app.canvas 수정
```

권장 범위는 전체 워크플로를 단순 교체하는 방식이 아니라 현재 캔버스를 읽고, revision을 확인한 뒤 노드 단위 작업을 원자적으로 적용하는 방식으로 확정했다.

예정 MCP 기능:

- `comfy_status`
- `comfy_node_types`
- `comfy_canvas_list`
- `comfy_canvas_get`
- `comfy_canvas_apply_patch`
- `comfy_canvas_replace`
- `comfy_canvas_restore`
- `comfy_queue_current`

안전장치:

- 변경 전 워크플로 자동 스냅샷
- revision/hash 충돌 확인
- 노드 타입·슬롯·위젯 검증
- 부분 실패 시 전체 롤백
- 여러 창·탭의 대상 세션 식별
- loopback 전용 접근과 로컬 공유 토큰
- 전체 교체와 대량 삭제의 명시적 확인

초기 구현은 루트 캔버스를 대상으로 하고, 서브그래프·특수 동적 위젯·ComfyUI 네이티브 Undo 통합은 후속 범위로 두기로 했다.

## 8. 문서화·Git 단계 운영과 구현 승인

### 사용자

> 현재 프로젝트의 대화 포함 모든 내용은 프로젝트 폴더의 doc 아래에 md 파일로 저장을 하고, 각 작업 단계마다 마무리는 git 커밋/푸시로 마무리 해줘. 내가 Comfy Desktop을 재실행 해야 하기 전까지 권장안으로 구현까지 진행해.

### Assistant 진행 결정

- 모든 프로젝트 문서는 `doc` 아래에 저장한다.
- 대화, 설계, 구현 계획, 검증 결과와 Git 이력을 기록한다.
- 각 단계는 커밋 후 즉시 `origin`에 푸시한다.
- 승인된 권장 설계에 따라 구현을 계속한다.
- ComfyUI 확장을 설치한 뒤 Comfy Desktop 재실행이 필요한 시점에서 멈추고 사용자에게 재실행을 요청한다.

## 9. 재실행 전 구현 진행 기록

### Assistant 진행

권장 설계에 따라 다음을 단계별로 구현하고 각 완료 단계마다 커밋·푸시했다.

- Node.js loopback HTTP client와 로컬 설정
- 11개 MCP 도구, canvas protocol schema와 MCP STDIO 서버
- master token과 frontend session token을 분리한 ComfyUI Python bridge
- 현재 workflow revision과 snapshot 저장소
- 노드 생성·연결·프롬프트/widget 설정을 포함한 원자적 patch transaction
- 전체 workflow 교체와 snapshot 복원, 실패 시 전체 롤백
- 활성 ComfyUI 탭 등록·heartbeat·명령 처리를 수행하는 frontend JavaScript adapter

Task 4 검증 시 JavaScript 테스트 25개, 구문 검사, TypeScript build가 통과했다. 아직 실행 중인 Comfy Desktop에는 확장을 설치하지 않았으므로 현재 캔버스는 변경하지 않았다.

### Assistant 설치 준비

Comfy Desktop 설치 기록에서 로컬 ComfyUI root를 자동 감지하고, 프로젝트 확장 source를 `custom_nodes`에 junction으로 연결하는 멱등 설치기를 작성했다. 설치기는 다른 기존 대상을 덮어쓰지 않으며 로컬 master token 값을 출력하지 않는다.

`-WhatIf`으로 실제 source·destination·token 경로를 확인했고 외부 파일이 생성되지 않은 상태에서 전체 저장소 검증을 실행했다. Vitest 82개와 Python 18개 테스트, TypeScript build가 모두 통과했다. 이 설치기와 운영 문서를 먼저 커밋·푸시한 뒤 실제 설치를 수행하고, 실행 중인 Comfy Desktop을 건드리지 않은 채 재실행 요청 지점에서 멈추기로 했다.

### Assistant 재실행 직전 결과

설치기·운영 문서를 `9f065ef`로 커밋해 `origin/main`에 푸시한 뒤 설치기를 실행했다.

- 로컬 master token 생성 완료. 값은 표시하지 않았고 64자리 소문자 hex 형식만 확인했다.
- ComfyUI `custom_nodes\vvoo_comfy_mcp` junction이 프로젝트 extension source를 정확히 가리킨다.
- 설치기를 다시 실행했을 때 token과 junction을 모두 재사용해 멱등성을 확인했다.
- ComfyUI 번들 Python으로 확장 파일 compileall이 성공했다.
- 기존 ComfyUI `/api/system_stats`는 HTTP 200을 유지했다.
- 새 `/api/vvoo_mcp/status`는 HTTP 404여서 실행 중인 Comfy Desktop이 아직 확장을 로드하지 않았음을 확인했다.
- ComfyUI 프로세스 시작 시각도 변하지 않아 설치 과정에서 재실행하지 않았다.

사용자가 Comfy Desktop을 완전히 재실행하기 전까지 진행하라는 범위가 완료됐으므로 여기서 멈춘다. 재실행 후에는 bridge status와 frontend session을 확인하고, 현재 workflow snapshot을 확보한 다음 안전한 live canvas 읽기·쓰기 통합 검증을 계속한다.
