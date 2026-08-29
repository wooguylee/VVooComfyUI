import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  ApplyPatchInputSchema,
  CanvasGetInputSchema,
  HistoryInputSchema,
  NodeTypesInputSchema,
  QueueCurrentInputSchema,
  ReplaceCanvasInputSchema,
  RestoreCanvasInputSchema,
} from "./canvas-protocol.js";
import { serializeError } from "./errors.js";
import type { ToolHandlers } from "./tool-handlers.js";

const EmptyInputSchema = z.object({}).strict();

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const SAFE_WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const DESTRUCTIVE_WRITE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

function asStructuredContent(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

async function executeTool(action: () => Promise<unknown>) {
  try {
    const value = await action();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
      structuredContent: asStructuredContent(value),
    };
  } catch (error) {
    const serialized = serializeError(error);
    return {
      isError: true,
      content: [
        { type: "text" as const, text: JSON.stringify(serialized, null, 2) },
      ],
      structuredContent: { error: serialized },
    };
  }
}

export const SERVER_INSTRUCTIONS = `Read the current canvas with comfy_canvas_get before every canvas write. Pass that exact expected_revision to apply, replace, or restore. Never guess a canvas session when more than one is active; call comfy_canvas_list and select the intended session. Canvas writes affect the user's open, possibly unsaved workflow. Prefer node-level comfy_canvas_apply_patch over whole-workflow replacement, retain the returned backup_id, and use comfy_canvas_restore when the user asks to undo an MCP change. The first release supports only the root canvas. The server never starts or stops Comfy Desktop and only connects to a loopback ComfyUI server.`;

export function createMcpServer(handlers: ToolHandlers): McpServer {
  const server = new McpServer(
    { name: "vvoo-comfyui", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "comfy_status",
    {
      title: "ComfyUI status",
      description:
        "Read ComfyUI system, queue, and live canvas bridge availability.",
      inputSchema: EmptyInputSchema,
      annotations: READ_ONLY,
    },
    (args) => executeTool(() => handlers.comfy_status(args)),
  );

  server.registerTool(
    "comfy_node_types",
    {
      title: "ComfyUI node types",
      description:
        "Read all installed ComfyUI node schemas or one node class schema.",
      inputSchema: NodeTypesInputSchema,
      annotations: READ_ONLY,
    },
    (args) => executeTool(() => handlers.comfy_node_types(args)),
  );

  server.registerTool(
    "comfy_canvas_list",
    {
      title: "List live Comfy canvases",
      description:
        "List registered Comfy Desktop canvas sessions and active-session metadata.",
      inputSchema: EmptyInputSchema,
      annotations: READ_ONLY,
    },
    (args) => executeTool(() => handlers.comfy_canvas_list(args)),
  );

  server.registerTool(
    "comfy_canvas_get",
    {
      title: "Read live Comfy canvas",
      description:
        "Read the selected open root workflow, summary, and revision required for writes.",
      inputSchema: CanvasGetInputSchema,
      annotations: READ_ONLY,
    },
    (args) => executeTool(() => handlers.comfy_canvas_get(args)),
  );

  server.registerTool(
    "comfy_canvas_apply_patch",
    {
      title: "Patch live Comfy canvas",
      description:
        "Atomically add, remove, move, resize, configure, connect, or disconnect nodes after checking expected_revision.",
      inputSchema: ApplyPatchInputSchema,
      annotations: DESTRUCTIVE_WRITE,
    },
    (args) => executeTool(() => handlers.comfy_canvas_apply_patch(args)),
  );

  server.registerTool(
    "comfy_canvas_replace",
    {
      title: "Replace live Comfy canvas",
      description:
        "Replace the entire selected root workflow. Requires expected_revision and confirm_replace=true.",
      inputSchema: ReplaceCanvasInputSchema,
      annotations: DESTRUCTIVE_WRITE,
    },
    (args) => executeTool(() => handlers.comfy_canvas_replace(args)),
  );

  server.registerTool(
    "comfy_canvas_restore",
    {
      title: "Restore Comfy canvas snapshot",
      description:
        "Restore a snapshot created by a prior MCP canvas change after checking expected_revision.",
      inputSchema: RestoreCanvasInputSchema,
      annotations: SAFE_WRITE,
    },
    (args) => executeTool(() => handlers.comfy_canvas_restore(args)),
  );

  server.registerTool(
    "comfy_queue_current",
    {
      title: "Queue current Comfy canvas",
      description:
        "Convert the selected open canvas to an API prompt and submit it to ComfyUI.",
      inputSchema: QueueCurrentInputSchema,
      annotations: SAFE_WRITE,
    },
    (args) => executeTool(() => handlers.comfy_queue_current(args)),
  );

  server.registerTool(
    "comfy_queue_get",
    {
      title: "Read ComfyUI queue",
      description: "Read running and pending ComfyUI queue entries.",
      inputSchema: EmptyInputSchema,
      annotations: READ_ONLY,
    },
    (args) => executeTool(() => handlers.comfy_queue_get(args)),
  );

  server.registerTool(
    "comfy_interrupt",
    {
      title: "Interrupt ComfyUI",
      description: "Interrupt the currently executing ComfyUI prompt.",
      inputSchema: EmptyInputSchema,
      annotations: DESTRUCTIVE_WRITE,
    },
    (args) => executeTool(() => handlers.comfy_interrupt(args)),
  );

  server.registerTool(
    "comfy_history_get",
    {
      title: "Read ComfyUI history",
      description: "Read all ComfyUI history or one prompt result by prompt_id.",
      inputSchema: HistoryInputSchema,
      annotations: READ_ONLY,
    },
    (args) => executeTool(() => handlers.comfy_history_get(args)),
  );

  return server;
}
