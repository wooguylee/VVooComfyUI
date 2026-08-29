import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMcpServer } from "../../src/server.js";
import { createToolHandlers } from "../../src/tool-handlers.js";

const revision = "e".repeat(64);

const closeCallbacks: Array<() => Promise<void>> = [];

async function createConnectedClient() {
  const dependencies = {
    comfy: {
      getSystemStats: vi.fn(async () => ({ version: "0.34.2" })),
      getQueue: vi.fn(async () => ({ queue_running: [], queue_pending: [] })),
      getObjectInfo: vi.fn(async () => ({})),
      getHistory: vi.fn(async () => ({})),
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
  const server = createMcpServer(createToolHandlers(dependencies));
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closeCallbacks.push(async () => {
    await client.close();
    await server.close();
  });
  return { client, dependencies };
}

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

describe("MCP server", () => {
  it("publishes all tools with safety annotations and instructions", async () => {
    const { client } = await createConnectedClient();

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "comfy_status",
      "comfy_node_types",
      "comfy_canvas_list",
      "comfy_workflow_list",
      "comfy_workflow_get",
      "comfy_workflow_select",
      "comfy_workflow_create",
      "comfy_workflow_save",
      "comfy_workflow_rename",
      "comfy_workflow_close",
      "comfy_workflow_reorder",
      "comfy_canvas_get",
      "comfy_canvas_apply_patch",
      "comfy_canvas_replace",
      "comfy_canvas_restore",
      "comfy_canvas_focus",
      "comfy_queue_current",
      "comfy_queue_get",
      "comfy_interrupt",
      "comfy_history_get",
    ]);
    expect(
      tools.tools.find((tool) => tool.name === "comfy_status")?.annotations,
    ).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(
      tools.tools.find((tool) => tool.name === "comfy_canvas_replace")
        ?.annotations,
    ).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(
      tools.tools.find((tool) => tool.name === "comfy_workflow_get")
        ?.annotations,
    ).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(
      tools.tools.find((tool) => tool.name === "comfy_workflow_close")
        ?.annotations,
    ).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(client.getInstructions()).toMatch(/read the current canvas/i);
    expect(client.getInstructions()).toMatch(/expected_revision/i);
  });

  it("calls an internal workflow read through the MCP transport", async () => {
    const { client, dependencies } = await createConnectedClient();

    const result = await client.callTool({
      name: "comfy_workflow_get",
      arguments: { workflow_id: "workflows/demo.json" },
    });

    expect(result.isError).not.toBe(true);
    expect(dependencies.bridge.command).toHaveBeenCalledWith({
      command: "workflow.get",
      payload: { workflow_id: "workflows/demo.json" },
      timeout_ms: 15_000,
    });
  });

  it("calls a read tool through the MCP transport", async () => {
    const { client } = await createConnectedClient();

    const result = await client.callTool({ name: "comfy_status", arguments: {} });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      system: { version: "0.34.2" },
      bridge: { available: true },
    });
  });

  it("validates and forwards a canvas patch through the MCP transport", async () => {
    const { client, dependencies } = await createConnectedClient();

    const result = await client.callTool({
      name: "comfy_canvas_apply_patch",
      arguments: {
        session_id: "canvas-a",
        expected_revision: revision,
        operations: [
          { op: "move_node", node: { id: 1 }, position: [10, 20] },
        ],
      },
    });

    expect(result.isError).not.toBe(true);
    expect(dependencies.bridge.command).toHaveBeenCalledWith({
      session_id: "canvas-a",
      command: "canvas.apply_patch",
      payload: {
        expected_revision: revision,
        operations: [
          { op: "move_node", node: { id: 1 }, position: [10, 20] },
        ],
        confirm_mass_delete: false,
      },
      timeout_ms: 15_000,
    });
  });
});
