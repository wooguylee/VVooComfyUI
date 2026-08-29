# Realtime Comfy Canvas MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a project-local MCP server and ComfyUI extension that safely reads and edits the currently open root canvas through localhost communication without Computer Use.

**Architecture:** A Node.js STDIO MCP server calls ComfyUI's built-in HTTP API and an authenticated Python bridge. The bridge targets the selected ComfyUI WebSocket client, where a JavaScript extension applies revision-checked graph transactions with snapshots and rollback.

**Tech Stack:** Node.js 20.20.0, TypeScript 7.0.2, `@modelcontextprotocol/sdk` 1.30.0, Zod 4.5.2, Vitest 4.1.11, Python 3.13-compatible standard library and aiohttp supplied by ComfyUI, browser-native JavaScript, PowerShell 7.

**Spec:** `doc/specs/2026-08-29-realtime-comfy-canvas-mcp-design.md`

## Global Constraints

- All source, tests, and documentation live under `W:\WorkAI\VVooComfyUI`; only the installer-created custom-node junction and local token live outside the repository.
- The MCP server accepts only `http://127.0.0.1:<port>` or `http://localhost:<port>` ComfyUI base URLs and never starts or stops Comfy Desktop.
- The master token lives at `%LOCALAPPDATA%\VVooComfyUI\bridge-token` and is never committed.
- Canvas writes require `expected_revision`; whole-workflow replacement additionally requires `confirm_replace: true`.
- Removing at least half of a non-empty graph requires `confirm_mass_delete: true`.
- The first release edits only the root graph and returns `SUBGRAPH_UNSUPPORTED` when another graph layer is visible.
- Every implementation task ends with focused verification, an independent Git commit, and `git push origin main`.
- After installing the custom-node junction, stop before restarting Comfy Desktop or performing live canvas writes.

---

## File Map

### Node.js MCP server

- `package.json`: pinned scripts and runtime/development dependencies.
- `package-lock.json`: resolved npm dependency graph.
- `tsconfig.json`: NodeNext strict TypeScript build to `dist`.
- `.gitignore`: generated output, npm files, coverage, caches, and local secrets.
- `src/errors.ts`: structured `ComfyMcpError` and error serialization.
- `src/config.ts`: loopback URL validation, token path resolution, timeout configuration.
- `src/comfy-http-client.ts`: ComfyUI built-in HTTP calls.
- `src/canvas-protocol.ts`: Zod command, patch, and bridge response schemas.
- `src/bridge-client.ts`: authenticated Python bridge calls.
- `src/tool-handlers.ts`: framework-independent MCP tool behavior.
- `src/server.ts`: MCP tool registration and annotations.
- `src/index.ts`: STDIO transport entry point.
- `.codex/config.toml`: project-scoped Codex STDIO MCP registration.

### ComfyUI custom extension

- `comfy-extension/vvoo_comfy_mcp/__init__.py`: ComfyUI route registration and `WEB_DIRECTORY` export.
- `comfy-extension/vvoo_comfy_mcp/bridge_state.py`: session, pending request, authentication, and timeout state.
- `comfy-extension/vvoo_comfy_mcp/js/graph-state.js`: canonical workflow hashing, summaries, and bounded snapshots.
- `comfy-extension/vvoo_comfy_mcp/js/patch-engine.js`: validated atomic graph operations and rollback.
- `comfy-extension/vvoo_comfy_mcp/js/canvas-bridge.js`: ComfyUI `app`/`api` integration, session lifecycle, and command dispatch.

### Installation, tests, and docs

- `scripts/install-comfy-extension.ps1`: token generation, installation discovery, and custom-node junction creation.
- `tests/node/config.test.ts`: URL and token configuration tests.
- `tests/node/comfy-http-client.test.ts`: HTTP success, response, error, and timeout tests.
- `tests/node/canvas-protocol.test.ts`: patch schema and destructive confirmation tests.
- `tests/node/bridge-client.test.ts`: auth header and bridge result tests.
- `tests/node/tool-handlers.test.ts`: tool orchestration tests.
- `tests/node/server.test.ts`: MCP tool list and in-memory call tests.
- `tests/python/test_bridge_state.py`: session and pending request tests.
- `tests/js/graph-state.test.js`: deterministic revision and snapshots.
- `tests/js/patch-engine.test.js`: every patch operation, conflict, rollback, and subgraph rejection.
- `tests/js/fake-graph.js`: deterministic LiteGraph-compatible test double.
- `README.md`: setup, restart boundary, MCP tools, and safety workflow.
- `doc/work-log.md`: task verification, commit, push, and installation evidence.

---

### Task 1: Project foundation and ComfyUI HTTP client

**Files:**

- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/errors.ts`
- Create: `src/config.ts`
- Create: `src/comfy-http-client.ts`
- Create: `tests/node/config.test.ts`
- Create: `tests/node/comfy-http-client.test.ts`
- Modify: `doc/work-log.md`

**Interfaces:**

- Produces: `loadConfig(env?: NodeJS.ProcessEnv): AppConfig`
- Produces: `assertLoopbackBaseUrl(value: string): URL`
- Produces: `ComfyHttpClient.requestJson<T>(path, init?): Promise<T>`
- Produces: `ComfyHttpClient.getSystemStats()`, `getQueue()`, `getObjectInfo()`, `getHistory()`, `interrupt()`, and `queuePrompt()`.

- [ ] **Step 1: Add package and compiler configuration**

Use ESM and pin the verified package versions:

```json
{
  "type": "module",
  "engines": { "node": ">=20.0.0" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:node": "vitest run tests/node",
    "test:js": "vitest run tests/js",
    "test:python": "python -m unittest discover -s tests/python -v",
    "verify": "npm run test && npm run test:python && npm run build"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.30.0",
    "zod": "4.5.2"
  },
  "devDependencies": {
    "@types/node": "20.x",
    "typescript": "7.0.2",
    "vitest": "4.1.11"
  }
}
```

Run `npm install` to create `package-lock.json`.

- [ ] **Step 2: Write failing configuration tests**

Cover default URL, explicit loopback URL, non-loopback rejection, default token path, and integer timeout parsing:

```ts
expect(loadConfig({ LOCALAPPDATA: "C:\\Local" }).baseUrl.href)
  .toBe("http://127.0.0.1:8188/");
expect(() => loadConfig({ COMFY_BASE_URL: "https://example.com" }))
  .toThrow(/loopback/i);
```

- [ ] **Step 3: Run configuration tests and confirm RED**

Run: `npm run test:node -- tests/node/config.test.ts`

Expected: FAIL because `src/config.ts` does not exist.

- [ ] **Step 4: Implement structured errors and configuration**

Define:

```ts
export interface AppConfig {
  baseUrl: URL;
  tokenPath: string;
  requestTimeoutMs: number;
  bridgeTimeoutMs: number;
}

export class ComfyMcpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) { super(message); }
}
```

Resolve the token path with `path.join(LOCALAPPDATA, "VVooComfyUI", "bridge-token")`. Reject credentials, non-HTTP schemes, query strings, fragments, and hostnames other than `127.0.0.1` and `localhost`.

- [ ] **Step 5: Run configuration tests and confirm GREEN**

Run: `npm run test:node -- tests/node/config.test.ts`

Expected: all configuration tests pass.

- [ ] **Step 6: Write failing HTTP client tests**

Start a temporary `node:http` server on `127.0.0.1` and verify JSON parsing, non-2xx error bodies, invalid JSON, request timeout, prompt submission payload, and interrupt POST.

```ts
const client = new ComfyHttpClient({
  baseUrl: new URL(serverUrl),
  timeoutMs: 100,
});
await expect(client.requestJson("/slow")).rejects.toMatchObject({
  code: "COMFY_TIMEOUT",
});
```

- [ ] **Step 7: Run HTTP client tests and confirm RED**

Run: `npm run test:node -- tests/node/comfy-http-client.test.ts`

Expected: FAIL because `ComfyHttpClient` does not exist.

- [ ] **Step 8: Implement the minimal ComfyUI HTTP client**

Use built-in `fetch` and `AbortSignal.timeout`. Convert network errors to `COMFY_UNAVAILABLE`, aborts to `COMFY_TIMEOUT`, and non-2xx responses to `COMFY_HTTP_ERROR`. Expose exact built-in API methods required by later tool handlers.

- [ ] **Step 9: Verify Task 1**

Run:

```powershell
npm run test:node -- tests/node/config.test.ts tests/node/comfy-http-client.test.ts
npm run build
git diff --check
```

Expected: tests and TypeScript build pass; diff check is clean.

- [ ] **Step 10: Record, commit, and push Task 1**

Update `doc/work-log.md` with commands and results, then run:

```powershell
git add package.json package-lock.json tsconfig.json .gitignore src tests/node doc/work-log.md
git commit -m "feat: add ComfyUI HTTP client foundation"
git push origin main
```

---

### Task 2: Canvas protocol, bridge client, and MCP tools

**Files:**

- Create: `src/canvas-protocol.ts`
- Create: `src/bridge-client.ts`
- Create: `src/tool-handlers.ts`
- Create: `src/server.ts`
- Create: `src/index.ts`
- Create: `.codex/config.toml`
- Create: `tests/node/canvas-protocol.test.ts`
- Create: `tests/node/bridge-client.test.ts`
- Create: `tests/node/tool-handlers.test.ts`
- Create: `tests/node/server.test.ts`
- Modify: `doc/work-log.md`

**Interfaces:**

- Consumes: `AppConfig`, `ComfyHttpClient`, and `ComfyMcpError` from Task 1.
- Produces: `PatchOperationSchema`, `CanvasCommandSchema`, and exported inferred types.
- Produces: `BridgeClient.listSessions()` and `BridgeClient.command()`.
- Produces: `createToolHandlers(deps): ToolHandlers`.
- Produces: `createMcpServer(deps): McpServer`.

- [ ] **Step 1: Write failing protocol tests**

Validate every operation discriminator and safety rule. The transaction schema has this shape:

```ts
const ApplyPatchInputSchema = z.object({
  session_id: z.string().min(1).optional(),
  expected_revision: z.string().length(64),
  operations: z.array(PatchOperationSchema).min(1),
  confirm_mass_delete: z.boolean().default(false),
});
```

Test duplicate `add_node.ref`, invalid positions, empty operations, missing replacement confirmation, and malformed 64-character revisions.

- [ ] **Step 2: Run protocol tests and confirm RED**

Run: `npm run test:node -- tests/node/canvas-protocol.test.ts`

Expected: FAIL because protocol schemas do not exist.

- [ ] **Step 3: Implement Zod protocol schemas**

Define discriminated unions for `add_node`, `remove_node`, `move_node`, `resize_node`, `set_widget`, `set_title`, `set_properties`, `connect`, and `disconnect`. A node reference accepts either `{ "id": number|string }` or `{ "ref": string }`; slots accept a non-negative index or a non-empty name.

- [ ] **Step 4: Write failing bridge client tests**

Use a temporary HTTP server and a temporary token file. Assert `Authorization: Bearer <token>`, JSON bodies, session parsing, error-code preservation, and timeouts.

```ts
await expect(client.command({ command: "canvas.get", payload: {} }))
  .resolves.toMatchObject({ ok: true });
```

- [ ] **Step 5: Run bridge tests and confirm RED**

Run: `npm run test:node -- tests/node/bridge-client.test.ts`

Expected: FAIL because `BridgeClient` does not exist.

- [ ] **Step 6: Implement `BridgeClient`**

Read and trim the master token for every MCP process start. Reject an absent or empty token as `BRIDGE_TOKEN_MISSING`. Call `/vvoo_mcp/sessions` and `/vvoo_mcp/command`, forwarding a selected session and command timeout.

- [ ] **Step 7: Write failing tool-handler tests**

Inject fake HTTP and bridge clients. Test every handler without MCP transport:

```ts
const handlers = createToolHandlers({ comfy, bridge });
const result = await handlers.comfy_canvas_apply_patch({
  expected_revision: "a".repeat(64),
  operations: [{ op: "move_node", node: { id: 1 }, position: [10, 20] }],
});
expect(bridge.command).toHaveBeenCalledWith(expect.objectContaining({
  command: "canvas.apply_patch",
}));
```

Verify `comfy_queue_current` first requests `canvas.to_prompt` and then submits `/prompt` with the selected `client_id`, API prompt, and workflow metadata.

- [ ] **Step 8: Implement all tool handlers**

Implement the tools from the spec exactly:

- `comfy_status`
- `comfy_node_types`
- `comfy_canvas_list`
- `comfy_canvas_get`
- `comfy_canvas_apply_patch`
- `comfy_canvas_replace`
- `comfy_canvas_restore`
- `comfy_queue_current`
- `comfy_queue_get`
- `comfy_interrupt`
- `comfy_history_get`

Return JSON-serializable objects and preserve structured error codes.

- [ ] **Step 9: Write failing MCP server tests**

Create an SDK in-memory client/server transport pair. Assert the tool list, read-only/destructive annotations, and one read call plus one patch call.

- [ ] **Step 10: Register tools and STDIO entry point**

Use `McpServer` and `StdioServerTransport`. Provide server instructions whose first 512 characters state that callers must read the canvas first, pass its revision to writes, and never guess a session when more than one is active.

Register read tools with `readOnlyHint: true`; canvas writes and interrupt use `readOnlyHint: false`. Mark replacement and interrupt as destructive.

- [ ] **Step 11: Add project MCP configuration**

Create:

```toml
[mcp_servers.vvoo_comfy]
command = "node"
args = ["dist/index.js"]
cwd = "W:\\WorkAI\\VVooComfyUI"
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
required = false
default_tools_approval_mode = "writes"
```

- [ ] **Step 12: Verify Task 2**

Run:

```powershell
npm run test:node
npm run build
node --check dist/index.js
git diff --check
```

Expected: all Node/MCP tests pass, build succeeds, and the entry point parses.

- [ ] **Step 13: Record, commit, and push Task 2**

```powershell
git add src tests/node .codex package.json package-lock.json doc/work-log.md
git commit -m "feat: expose Comfy canvas MCP tools"
git push origin main
```

---

### Task 3: Python session and WebSocket command bridge

**Files:**

- Create: `comfy-extension/vvoo_comfy_mcp/bridge_state.py`
- Create: `comfy-extension/vvoo_comfy_mcp/__init__.py`
- Create: `tests/python/test_bridge_state.py`
- Modify: `doc/work-log.md`

**Interfaces:**

- Produces: `BridgeState.register_session`, `heartbeat`, `list_sessions`, `select_session`, `create_pending`, `resolve_pending`, and `drop_session`.
- Produces HTTP routes `/vvoo_mcp/frontend/register`, `/frontend/heartbeat`, `/frontend/result`, `/sessions`, `/status`, and `/command`.
- Sends ComfyUI event type `vvoo.mcp.command` with protocol version `1`.

- [ ] **Step 1: Write failing Python state tests**

Use `unittest.IsolatedAsyncioTestCase`. Cover:

```python
async def test_selects_focused_visible_recent_session(self):
    state = BridgeState(socket_exists=lambda sid: sid in {"a", "b"})
    token = state.register_session("a", {"focused": True, "visible": True})
    self.assertEqual(state.select_session(None).client_id, "a")
```

Also test nonexistent socket rejection, invalid session token, ambiguous active sessions, heartbeat expiry, pending result resolution, wrong-session response rejection, timeout cleanup, and session-drop failure.

- [ ] **Step 2: Run Python tests and confirm RED**

Run: `python -m unittest discover -s tests/python -v`

Expected: FAIL because `bridge_state.py` does not exist.

- [ ] **Step 3: Implement the Python bridge state**

Use standard-library dataclasses, `asyncio`, `secrets`, `time.monotonic`, and `uuid`. Define `BridgeError(code, message, status=400, details=None)` and serialize errors without stack traces.

The state object must never hold an expired session or a completed pending Future. Session selection returns `AMBIGUOUS_CANVAS_SESSION` when the top candidates have identical focus, visibility, and activity values.

- [ ] **Step 4: Run Python tests and confirm GREEN**

Run: `python -m unittest discover -s tests/python -v`

Expected: all bridge-state tests pass.

- [ ] **Step 5: Add ComfyUI route registration**

In `__init__.py`:

```python
WEB_DIRECTORY = "./js"
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
```

Read `%LOCALAPPDATA%\VVooComfyUI\bridge-token` at import. MCP routes compare the bearer token with `secrets.compare_digest`. Frontend registration verifies `client_id in PromptServer.instance.sockets`; result routes verify the per-session token.

The command route creates a pending Future, calls:

```python
await PromptServer.instance.send(
    "vvoo.mcp.command",
    message,
    sid=session.client_id,
)
```

and waits with the requested bounded timeout.

- [ ] **Step 6: Perform Python static verification**

Run:

```powershell
python -m unittest discover -s tests/python -v
python -m compileall -q comfy-extension/vvoo_comfy_mcp tests/python
git diff --check
```

Expected: tests pass and every Python file compiles.

- [ ] **Step 7: Record, commit, and push Task 3**

```powershell
git add comfy-extension tests/python doc/work-log.md
git commit -m "feat: add authenticated ComfyUI command bridge"
git push origin main
```

---

### Task 4: JavaScript graph state and atomic patch engine

**Files:**

- Create: `comfy-extension/vvoo_comfy_mcp/js/graph-state.js`
- Create: `comfy-extension/vvoo_comfy_mcp/js/patch-engine.js`
- Create: `comfy-extension/vvoo_comfy_mcp/js/canvas-bridge.js`
- Create: `tests/js/fake-graph.js`
- Create: `tests/js/graph-state.test.js`
- Create: `tests/js/patch-engine.test.js`
- Modify: `doc/work-log.md`

**Interfaces:**

- Produces: `canonicalJson(value): string`
- Produces: `revisionForWorkflow(workflow): Promise<string>`
- Produces: `SnapshotStore(limit = 10)`
- Produces: `getCanvasState(app): Promise<CanvasState>`
- Produces: `applyPatchTransaction(context, request): Promise<PatchResult>`
- Produces: `replaceWorkflowTransaction` and `restoreSnapshotTransaction`.

- [ ] **Step 1: Build the fake graph and failing graph-state tests**

The fake implements `serialize`, `getNodeById`, `add`, `remove`, node `connect`, `disconnectInput`, widgets, `setDirtyCanvas`, and a configurable `LiteGraph.createNode` registry.

Graph-state tests assert:

- object key order does not change revision;
- array order does change revision;
- revision is 64 lowercase hex characters;
- node/link/widget summary is stable;
- snapshot IDs are unique and only the newest 10 remain.

- [ ] **Step 2: Run graph-state tests and confirm RED**

Run: `npm run test:js -- tests/js/graph-state.test.js`

Expected: FAIL because graph-state exports do not exist.

- [ ] **Step 3: Implement canonical hashing and snapshots**

Recursively sort object keys, preserve arrays, serialize finite JSON values, and hash UTF-8 bytes with `crypto.subtle.digest("SHA-256", ...)`. Return root workflow plus summary and revision.

- [ ] **Step 4: Write failing patch-engine tests**

Add one test for every operation plus these transaction cases:

```js
await expect(applyPatchTransaction(ctx, {
  expected_revision: "0".repeat(64),
  operations: [{ op: "move_node", node: { id: 1 }, position: [1, 2] }],
})).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
```

- ref mapping allows `add_node` followed by `connect` in one transaction;
- slot names and numeric indexes both work;
- missing nodes, slots, and widgets produce exact error codes;
- rejected connections rollback the entire serialized graph;
- removing at least half of a non-empty graph requires confirmation;
- visible subgraph rejects every write;
- replacement requires confirmation and rolls back on load failure;
- restore requires current revision and a known backup ID.

- [ ] **Step 5: Run patch-engine tests and confirm RED**

Run: `npm run test:js -- tests/js/patch-engine.test.js`

Expected: FAIL because patch operations are not implemented.

- [ ] **Step 6: Implement patch transactions**

Resolve node references through this helper contract:

```js
function resolveNode(graph, refMap, reference) {
  const id = "ref" in reference ? refMap.get(reference.ref) : reference.id;
  const node = graph.getNodeById(id);
  if (!node) throw new CanvasError("NODE_NOT_FOUND", `Node ${id} was not found`);
  return node;
}
```

Use `LiteGraph.createNode(type)`, then graph `add`. Set widget values only after the node is added. Validate output/input slots by index or name before calling `connect`. Save the original workflow before the first mutation and call `await app.loadGraphData(original)` on any failure.

- [ ] **Step 7: Run graph tests and confirm GREEN**

Run: `npm run test:js`

Expected: every graph-state and patch-engine test passes.

- [ ] **Step 8: Implement the ComfyUI frontend adapter**

Import:

```js
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
```

Register extension name `VVoo.ComfyMCP.CanvasBridge`. Wait for `api.clientId`, register the session, heartbeat on a 5-second timer and focus/visibility changes, and listen with:

```js
api.addEventListener("vvoo.mcp.command", async ({ detail }) => {
  const response = await dispatchCommand(detail);
  await postFrontendResult(response);
});
```

Dispatch `canvas.get`, `canvas.apply_patch`, `canvas.replace`, `canvas.restore`, and `canvas.to_prompt`. For `canvas.to_prompt`, return the exact `{ output, workflow }` from `await app.graphToPrompt()`.

- [ ] **Step 9: Verify Task 4**

Run:

```powershell
npm run test:js
node --check comfy-extension/vvoo_comfy_mcp/js/graph-state.js
node --check comfy-extension/vvoo_comfy_mcp/js/patch-engine.js
node --check comfy-extension/vvoo_comfy_mcp/js/canvas-bridge.js
npm run build
git diff --check
```

- [ ] **Step 10: Record, commit, and push Task 4**

```powershell
git add comfy-extension tests/js doc/work-log.md
git commit -m "feat: add atomic live canvas patch engine"
git push origin main
```

---

### Task 5: Installer, documentation, full pre-restart verification, and installation

**Files:**

- Create: `scripts/install-comfy-extension.ps1`
- Create: `README.md`
- Modify: `doc/README.md`
- Modify: `doc/conversation/2026-08-29-comfy-desktop-mcp.md`
- Modify: `doc/work-log.md`

**Interfaces:**

- Installer parameters: `-ComfyRoot`, `-ForceTokenRotation`, and `-WhatIf` through `SupportsShouldProcess`.
- Installer output: resolved source, destination, token path, junction state, and `RestartRequired: true|false`.

- [ ] **Step 1: Implement an idempotent installer**

Read `%APPDATA%\Comfy Desktop\installations.json`, choose the installed non-cloud record whose name is `ComfyUI`, and resolve `<installPath>\ComfyUI\custom_nodes`.

Generate a 32-byte random token as 64 lowercase hex characters using `System.Security.Cryptography.RandomNumberGenerator`. Create the token directory and file only when absent unless `-ForceTokenRotation` is passed.

Create a directory junction from:

```text
<custom_nodes>\vvoo_comfy_mcp
```

to:

```text
W:\WorkAI\VVooComfyUI\comfy-extension\vvoo_comfy_mcp
```

If the destination exists and resolves to the same source, report `already-installed`. If it points elsewhere or is a normal directory, fail without deleting or overwriting it.

- [ ] **Step 2: Write setup and safety documentation**

`README.md` must include prerequisites, `npm install`, `npm run verify`, installer invocation, the required Comfy Desktop restart, Codex project restart/reload for `.codex/config.toml`, all tool names, the read→revision→write sequence, restore instructions, and initial limitations.

- [ ] **Step 3: Run full repository verification before external installation**

Run:

```powershell
npm run verify
git diff --check
git status --short
```

Expected: all Node, JavaScript, and Python tests pass; TypeScript builds; only intended files are changed.

- [ ] **Step 4: Commit and push installer and documentation**

```powershell
git add scripts README.md doc
git commit -m "docs: add Comfy extension installation workflow"
git push origin main
```

- [ ] **Step 5: Preview installation without changing ComfyUI**

Run:

```powershell
pwsh -File scripts/install-comfy-extension.ps1 -WhatIf
```

Verify that the source and destination are exact and remain inside the named project and ComfyUI `custom_nodes` directory.

- [ ] **Step 6: Install the extension and token**

Run:

```powershell
pwsh -File scripts/install-comfy-extension.ps1
```

Do not stop or restart Comfy Desktop.

- [ ] **Step 7: Verify the installed pre-restart state**

Read-only checks:

- token exists, is 64 lowercase hex characters, and its value is never printed;
- destination is a junction resolving to the repository source;
- Python files compile with ComfyUI's bundled Python;
- current ComfyUI still responds on `/system_stats`;
- `/vvoo_mcp/status` remains unavailable before restart, proving the running process has not loaded the new extension.

- [ ] **Step 8: Record installation evidence, commit, and push**

Append paths, non-secret validation, response codes, tests, and `RestartRequired: true` to `doc/work-log.md`, append the current turn outcome to the conversation record, then run:

```powershell
git add doc
git commit -m "docs: record pre-restart Comfy MCP installation"
git push origin main
git status --short --branch
```

- [ ] **Step 9: Stop at the user restart boundary**

Report the final commit, pushed branch, installed junction, passed verification, and exact next action: restart Comfy Desktop and tell Codex when the local ComfyUI instance is open again. Do not perform live canvas writes until that response.
