import { describe, expect, it, vi } from "vitest";

import { ComfyMcpError } from "../../src/errors.js";
import { createToolHandlers } from "../../src/tool-handlers.js";

const revision = "d".repeat(64);

function createDependencies() {
  return {
    comfy: {
      getSystemStats: vi.fn(async () => ({ system: { comfyui_version: "0.34.2" } })),
      getQueue: vi.fn(async () => ({ queue_running: [], queue_pending: [] })),
      getObjectInfo: vi.fn(async (nodeClass?: string) => ({ nodeClass })),
      getHistory: vi.fn(async (promptId?: string) => ({ promptId })),
      interrupt: vi.fn(async () => undefined),
      queuePrompt: vi.fn(async () => ({ prompt_id: "prompt-1" })),
    },
    bridge: {
      listSessions: vi.fn(async () => ({ sessions: [{ client_id: "canvas-a" }] })),
      command: vi.fn(async () => ({
        request_id: "request-1",
        session_id: "canvas-a",
        result: { revision },
      })),
    },
    bridgeTimeoutMs: 15_000,
  };
}

describe("tool handlers", () => {
  it("combines ComfyUI, queue, and canvas bridge status", async () => {
    const dependencies = createDependencies();
    const handlers = createToolHandlers(dependencies);

    await expect(handlers.comfy_status({})).resolves.toEqual({
      system: { system: { comfyui_version: "0.34.2" } },
      queue: { queue_running: [], queue_pending: [] },
      bridge: {
        available: true,
        sessions: [{ client_id: "canvas-a" }],
      },
    });
  });

  it("keeps ComfyUI status useful when the canvas bridge is not loaded", async () => {
    const dependencies = createDependencies();
    dependencies.bridge.listSessions.mockRejectedValueOnce(
      new ComfyMcpError("COMFY_HTTP_ERROR", "not loaded", { status: 404 }),
    );
    const handlers = createToolHandlers(dependencies);

    await expect(handlers.comfy_status({})).resolves.toMatchObject({
      bridge: {
        available: false,
        error: { code: "COMFY_HTTP_ERROR", message: "not loaded" },
      },
    });
  });

  it("gets all node types or one requested node class", async () => {
    const dependencies = createDependencies();
    const handlers = createToolHandlers(dependencies);

    await expect(handlers.comfy_node_types({})).resolves.toEqual({
      nodeClass: undefined,
    });
    await expect(
      handlers.comfy_node_types({ node_class: "KSampler" }),
    ).resolves.toEqual({ nodeClass: "KSampler" });
  });

  it("lists registered canvas sessions", async () => {
    const dependencies = createDependencies();
    const handlers = createToolHandlers(dependencies);

    await expect(handlers.comfy_canvas_list({})).resolves.toEqual({
      sessions: [{ client_id: "canvas-a" }],
    });
  });

  it("gets a selected canvas with the configured timeout", async () => {
    const dependencies = createDependencies();
    const handlers = createToolHandlers(dependencies);

    await handlers.comfy_canvas_get({ session_id: "canvas-a" });

    expect(dependencies.bridge.command).toHaveBeenCalledWith({
      session_id: "canvas-a",
      command: "canvas.get",
      payload: {},
      timeout_ms: 15_000,
    });
  });

  it("lists, gets, and selects internal workflow tabs", async () => {
    const dependencies = createDependencies();
    const handlers = createToolHandlers(dependencies);

    await handlers.comfy_workflow_list({ session_id: "canvas-a" });
    expect(dependencies.bridge.command).toHaveBeenLastCalledWith({
      session_id: "canvas-a",
      command: "workflow.list",
      payload: {},
      timeout_ms: 15_000,
    });

    await handlers.comfy_workflow_get({
      session_id: "canvas-a",
      workflow_id: "workflows/demo.json",
    });
    expect(dependencies.bridge.command).toHaveBeenLastCalledWith({
      session_id: "canvas-a",
      command: "workflow.get",
      payload: { workflow_id: "workflows/demo.json" },
      timeout_ms: 15_000,
    });

    await handlers.comfy_workflow_select({
      workflow_id: "workflows/demo.json",
    });
    expect(dependencies.bridge.command).toHaveBeenLastCalledWith({
      command: "workflow.select",
      payload: { workflow_id: "workflows/demo.json" },
      timeout_ms: 15_000,
    });
  });

  it("forwards workflow lifecycle and viewport commands", async () => {
    const dependencies = createDependencies();
    const handlers = createToolHandlers(dependencies);

    await handlers.comfy_workflow_create({ filename: "Generated.json" });
    expect(dependencies.bridge.command).toHaveBeenLastCalledWith({
      command: "workflow.create",
      payload: { filename: "Generated.json" },
      timeout_ms: 15_000,
    });
    await handlers.comfy_workflow_save({
      workflow_id: "workflows/demo.json",
      expected_revision: revision,
    });
    expect(dependencies.bridge.command).toHaveBeenLastCalledWith({
      command: "workflow.save",
      payload: {
        workflow_id: "workflows/demo.json",
        expected_revision: revision,
      },
      timeout_ms: 15_000,
    });
    await handlers.comfy_workflow_rename({
      workflow_id: "workflows/demo.json",
      new_path: "workflows/renamed.json",
    });
    expect(dependencies.bridge.command).toHaveBeenLastCalledWith({
      command: "workflow.rename",
      payload: {
        workflow_id: "workflows/demo.json",
        new_path: "workflows/renamed.json",
      },
      timeout_ms: 15_000,
    });
    await handlers.comfy_workflow_close({
      workflow_id: "workflows/renamed.json",
    });
    expect(dependencies.bridge.command).toHaveBeenLastCalledWith({
      command: "workflow.close",
      payload: {
        workflow_id: "workflows/renamed.json",
        confirm_discard: false,
      },
      timeout_ms: 15_000,
    });
    await handlers.comfy_workflow_reorder({
      workflow_id: "workflows/renamed.json",
      index: 0,
    });
    expect(dependencies.bridge.command).toHaveBeenLastCalledWith({
      command: "workflow.reorder",
      payload: { workflow_id: "workflows/renamed.json", index: 0 },
      timeout_ms: 15_000,
    });
    await handlers.comfy_canvas_focus({
      workflow_id: "workflows/renamed.json",
      node_ids: [1, "2"],
      fit: "selection",
    });
    expect(dependencies.bridge.command).toHaveBeenLastCalledWith({
      command: "canvas.focus",
      payload: {
        workflow_id: "workflows/renamed.json",
        node_ids: [1, "2"],
        select: true,
        fit: "selection",
      },
      timeout_ms: 15_000,
    });
  });

  it("forwards a revision-checked patch transaction", async () => {
    const dependencies = createDependencies();
    const handlers = createToolHandlers(dependencies);
    const operations = [
      { op: "move_node" as const, node: { id: 1 }, position: [10, 20] },
    ];

    await handlers.comfy_canvas_apply_patch({
      session_id: "canvas-a",
      workflow_id: "workflows/demo.json",
      expected_revision: revision,
      operations,
    });

    expect(dependencies.bridge.command).toHaveBeenCalledWith({
      session_id: "canvas-a",
      command: "canvas.apply_patch",
      payload: {
        expected_revision: revision,
        workflow_id: "workflows/demo.json",
        operations,
        confirm_mass_delete: false,
      },
      timeout_ms: 15_000,
    });
  });

  it("forwards confirmed replacement and snapshot restore commands", async () => {
    const dependencies = createDependencies();
    const handlers = createToolHandlers(dependencies);

    await handlers.comfy_canvas_replace({
      expected_revision: revision,
      workflow: { nodes: [] },
      confirm_replace: true,
    });
    expect(dependencies.bridge.command).toHaveBeenLastCalledWith({
      command: "canvas.replace",
      payload: {
        expected_revision: revision,
        workflow: { nodes: [] },
        confirm_replace: true,
      },
      timeout_ms: 15_000,
    });

    await handlers.comfy_canvas_restore({
      expected_revision: revision,
      backup_id: "backup-1",
    });
    expect(dependencies.bridge.command).toHaveBeenLastCalledWith({
      command: "canvas.restore",
      payload: {
        expected_revision: revision,
        backup_id: "backup-1",
      },
      timeout_ms: 15_000,
    });
  });

  it("converts the current UI graph and submits it to the selected client", async () => {
    const dependencies = createDependencies();
    dependencies.bridge.command.mockResolvedValueOnce({
      request_id: "request-2",
      session_id: "canvas-a",
      result: {
        output: { "1": { class_type: "SaveImage", inputs: {} } },
        workflow: { nodes: [{ id: 1, type: "SaveImage" }] },
      },
    });
    const handlers = createToolHandlers(dependencies);

    await expect(
      handlers.comfy_queue_current({ session_id: "canvas-a", front: true }),
    ).resolves.toEqual({ prompt_id: "prompt-1" });
    expect(dependencies.comfy.queuePrompt).toHaveBeenCalledWith({
      prompt: { "1": { class_type: "SaveImage", inputs: {} } },
      client_id: "canvas-a",
      extra_data: {
        extra_pnginfo: {
          workflow: { nodes: [{ id: 1, type: "SaveImage" }] },
        },
      },
      front: true,
    });
    expect(dependencies.bridge.command).toHaveBeenCalledWith({
      session_id: "canvas-a",
      command: "canvas.to_prompt",
      payload: {},
      timeout_ms: 15_000,
    });
  });

  it("rejects an invalid graph-to-prompt response before queueing", async () => {
    const dependencies = createDependencies();
    dependencies.bridge.command.mockResolvedValueOnce({
      session_id: "canvas-a",
      result: { workflow: {} },
    });
    const handlers = createToolHandlers(dependencies);

    await expect(handlers.comfy_queue_current({})).rejects.toMatchObject({
      code: "BRIDGE_PROTOCOL_ERROR",
    });
    expect(dependencies.comfy.queuePrompt).not.toHaveBeenCalled();
  });

  it("exposes queue, interrupt, and history operations", async () => {
    const dependencies = createDependencies();
    const handlers = createToolHandlers(dependencies);

    await expect(handlers.comfy_queue_get({})).resolves.toEqual({
      queue_running: [],
      queue_pending: [],
    });
    await expect(handlers.comfy_interrupt({})).resolves.toEqual({
      interrupted: true,
    });
    await expect(
      handlers.comfy_history_get({ prompt_id: "prompt-1" }),
    ).resolves.toEqual({ promptId: "prompt-1" });
  });
});
