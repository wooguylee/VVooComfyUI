# Live Workflow Tabs Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Completed through the pre-restart boundary on 2026-08-29. Live loading remains intentionally deferred until the user restarts Comfy Desktop.

**Goal:** Extend the project-local VVooComfyUI MCP so Codex can inspect, activate, create, save, rename, reorder, close, focus, and safely edit every workflow tab that is open in Comfy Desktop without Computer Use.

**Architecture:** The existing Node STDIO MCP and authenticated Python bridge remain unchanged in shape. The browser extension adds a public `app.extensionManager.workflow` adapter that owns internal tab discovery and lifecycle, while graph writes first activate the requested tab, re-check its revision, bind snapshots to that workflow object, then mutate `app.rootGraph` and the visible canvas.

**Tech Stack:** TypeScript, Zod, MCP SDK, browser-native JavaScript, ComfyUI frontend extension API, Python/aiohttp, Vitest, unittest, PowerShell.

**Spec:** `doc/specs/2026-08-29-live-workflow-tabs-control-design.md`

## Global Constraints

- Never use Computer Use, screen coordinates, DOM tab clicks, or private ComfyUI bundle imports.
- Use `workflow.path` as the externally visible workflow ID and retain the workflow object internally so rename does not invalidate a same-tab snapshot.
- Reads may load an unloaded workflow state without switching tabs; every write visibly activates the exact target tab before mutation.
- All graph writes require `expected_revision`; modified-tab close requires explicit discard confirmation; permanent file deletion is out of scope.
- Preserve current canvas, queue, history, session authentication, root-graph, mass-delete, replace, and rollback behavior.
- Add each behavior through a failing focused test before production code, then run the focused test green.
- Do not stop or restart Comfy Desktop. Stop after source, build, config, junction, and pre-restart verification are complete.

---

### Task 1: Browser workflow-store adapter

**Files:**

- Create: `comfy-extension/vvoo_comfy_mcp/js/workflow-runtime.js`
- Create: `tests/js/workflow-runtime.test.js`
- Modify: `tests/js/fake-graph.js`

**Interfaces:**

- Produces `getWorkflowStore(context)`, `listWorkflows(context)`, `getWorkflow(context, payload)`, and `activateWorkflow(context, workflowId)`.
- Produces `createWorkflow`, `saveWorkflow`, `renameWorkflow`, `closeWorkflow`, and `reorderWorkflow`.
- Returns stable `WORKFLOW_*` errors and compact tab metadata.

- [x] Write a fake workflow store with active, inactive, temporary, unloaded, and modified workflow objects.
- [x] Write list/get tests for order, active metadata, inactive `activeState`, load-without-switch, serialized summary, and revision.
- [x] Run `npm run test:js -- tests/js/workflow-runtime.test.js` and confirm RED.
- [x] Implement workflow-store detection, lookup, serialization, summary, and activation through public store methods.
- [x] Write and run RED lifecycle tests for create, select, revision-checked save, rename conflict, modified close, last-tab close, and reorder bounds.
- [x] Implement the lifecycle methods minimally and rerun the focused test GREEN.
- [x] Run `node --check` on the new module and `git diff --check`.

---

### Task 2: Tab-bound graph transactions and viewport control

**Files:**

- Modify: `comfy-extension/vvoo_comfy_mcp/js/graph-state.js`
- Modify: `comfy-extension/vvoo_comfy_mcp/js/patch-engine.js`
- Modify: `comfy-extension/vvoo_comfy_mcp/js/canvas-runtime.js`
- Modify: `tests/js/graph-state.test.js`
- Modify: `tests/js/patch-engine.test.js`
- Modify: `tests/js/canvas-runtime.test.js`

**Interfaces:**

- `SnapshotStore.add(workflow, identity)` and `get(backupId)` return workflow-bound records.
- Existing canvas commands accept optional `workflow_id` and activate it before reading or writing.
- Patch operations add `set_mode`, `set_colors`, and `set_collapsed`; `add_node` accepts their initial values.
- `canvas.focus` selects node IDs and invokes supported canvas centering/fit behavior.

- [x] Write RED graph-state tests for serialized summaries containing mode/flags/colors/collapse and workflow-bound snapshots.
- [x] Implement serialized and live-graph summary helpers plus snapshot records; rerun GREEN.
- [x] Write RED patch tests for mode, colors, collapse, inactive-tab activation, stale revision after activation, cross-tab restore rejection, and same-object rename restore.
- [x] Implement activation-before-write, operation extensions, object-bound snapshot validation, and rollback; rerun GREEN.
- [x] Write RED runtime tests for workflow dispatch, optional workflow IDs on legacy commands, and viewport focus.
- [x] Implement workflow command dispatch and focus behavior; rerun all JavaScript tests GREEN.
- [x] Run syntax checks for every browser module.

---

### Task 3: Python bridge command surface

**Files:**

- Modify: `comfy-extension/vvoo_comfy_mcp/__init__.py`
- Modify: `tests/python/test_routes.py`

**Interfaces:**

- Route allowlist accepts `workflow.list/get/select/create/save/rename/close/reorder` and `canvas.focus` in addition to current canvas commands.
- Status capability metadata includes `workflow_tabs`, `workflow_lifecycle`, `canvas_focus`, and `snapshot_workflow_binding`.

- [x] Add route tests that fail for each newly expected command and capability.
- [x] Run `python -m unittest tests.python.test_routes -v` and confirm RED.
- [x] Extend only the allowlist/status payload and retain session ownership checks.
- [x] Rerun Python tests GREEN and compile the extension.

---

### Task 4: Node protocol, handlers, and MCP tools

**Files:**

- Modify: `src/canvas-protocol.ts`
- Modify: `src/tool-handlers.ts`
- Modify: `src/server.ts`
- Modify: `tests/node/canvas-protocol.test.ts`
- Modify: `tests/node/tool-handlers.test.ts`
- Modify: `tests/node/server.test.ts`

**Interfaces:**

- Adds schemas and handlers for `comfy_workflow_list/get/select/create/save/rename/close/reorder` and `comfy_canvas_focus`.
- Existing patch/replace/restore/queue inputs accept optional `workflow_id` while preserving prior callers.
- Read-only annotations apply to list/get; all lifecycle and canvas focus/select annotations match their actual side effects.

- [x] Write RED Zod tests for every new input and patch extension, including invalid paths, indexes, node IDs, confirmations, and revision requirements.
- [x] Implement the protocol schemas and rerun focused tests GREEN.
- [x] Write RED handler tests for exact bridge command/payload forwarding and selected-workflow queue conversion.
- [x] Implement handlers and rerun focused tests GREEN.
- [x] Write RED in-memory MCP tests for tool inventory, annotations, and representative calls.
- [x] Register tools with concise descriptions and annotations; rerun all Node tests and TypeScript build GREEN.

---

### Task 5: Project setup, documentation, and restart boundary

**Files:**

- Modify: `.codex/config.toml`
- Modify: `dev/.codex/config.toml`
- Modify: `dev/README.md`
- Modify: `dev/doc/work-log.md`
- Modify: `dev/doc/conversation/2026-08-29-comfy-desktop-mcp.md`
- Generated: `dev/dist/**`

- [x] Point the root project MCP entry at `W:\\WorkAI\\VVooComfyUI\\dev` and keep the official `comfy_mcp` registration intact.
- [x] Correct the nested development config to the same real build directory.
- [x] Document internal workflow tabs separately from browser/WebView sessions and document the new read-to-write flow.
- [x] Run `npm run verify`, `node --check dist/index.js`, Python compile checks, and `git diff --check`.
- [x] Run the installer with `-WhatIf`, then idempotently run it for the existing junction/token.
- [x] Verify without printing the token: 64-lowercase-hex token, exact junction target, built entry point, config paths, and live legacy ComfyUI health.
- [x] Record verification evidence and commit the implementation.
- [x] Stop and ask the user to restart Comfy Desktop; do not restart it automatically or claim the new frontend tools are live before that restart.
