import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  ApplyPatchInputSchema,
  CanvasFocusInputSchema,
  CanvasGetInputSchema,
  HistoryInputSchema,
  NodeTypesInputSchema,
  QueueCurrentInputSchema,
  ReplaceCanvasInputSchema,
  RestoreCanvasInputSchema,
  WorkflowCloseInputSchema,
  WorkflowCreateInputSchema,
  WorkflowGetInputSchema,
  WorkflowListInputSchema,
  WorkflowRenameInputSchema,
  WorkflowReorderInputSchema,
  WorkflowSaveInputSchema,
  WorkflowSelectInputSchema,
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

const UI_WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
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

export const SERVER_INSTRUCTIONS = `Call comfy_canvas_list to choose the Comfy Desktop WebView session, then comfy_workflow_list to enumerate its internal tabs. Read the current canvas or target tab with comfy_canvas_get or comfy_workflow_get before every write and pass that exact expected_revision. Never guess a session or workflow ID. Writes visibly activate the exact target tab first. Prefer node-level comfy_canvas_apply_patch over replacement, retain backup_id, and restore only into the same workflow tab. Modified-tab close requires confirm_discard=true. The server never starts or stops Comfy Desktop and only connects to loopback ComfyUI.`;

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
    "comfy_workflow_list",
    {
      title: "List open Comfy workflow tabs",
      description:
        "List every internal workflow tab in the selected Comfy Desktop session, including active state, counts, and revisions.",
      inputSchema: WorkflowListInputSchema,
      annotations: READ_ONLY,
    },
    (args) => executeTool(() => handlers.comfy_workflow_list(args)),
  );

  server.registerTool(
    "comfy_workflow_get",
    {
      title: "Read a Comfy workflow tab",
      description:
        "Read one open workflow tab by workflow_id without changing the visible tab when it is inactive.",
      inputSchema: WorkflowGetInputSchema,
      annotations: READ_ONLY,
    },
    (args) => executeTool(() => handlers.comfy_workflow_get(args)),
  );

  server.registerTool(
    "comfy_workflow_select",
    {
      title: "Select a Comfy workflow tab",
      description:
        "Activate one open workflow tab so it becomes visible in Comfy Desktop.",
      inputSchema: WorkflowSelectInputSchema,
      annotations: UI_WRITE,
    },
    (args) => executeTool(() => handlers.comfy_workflow_select(args)),
  );

  server.registerTool(
    "comfy_workflow_create",
    {
      title: "Create a Comfy workflow tab",
      description:
        "Create and visibly activate a new temporary workflow tab, optionally from workflow JSON.",
      inputSchema: WorkflowCreateInputSchema,
      annotations: SAFE_WRITE,
    },
    (args) => executeTool(() => handlers.comfy_workflow_create(args)),
  );

  server.registerTool(
    "comfy_workflow_save",
    {
      title: "Save a Comfy workflow tab",
      description:
        "Save a non-temporary workflow after verifying its exact expected_revision.",
      inputSchema: WorkflowSaveInputSchema,
      annotations: SAFE_WRITE,
    },
    (args) => executeTool(() => handlers.comfy_workflow_save(args)),
  );

  server.registerTool(
    "comfy_workflow_rename",
    {
      title: "Rename a Comfy workflow tab",
      description:
        "Rename an open workflow to a conflict-free workflows/...json path without overwriting another workflow.",
      inputSchema: WorkflowRenameInputSchema,
      annotations: SAFE_WRITE,
    },
    (args) => executeTool(() => handlers.comfy_workflow_rename(args)),
  );

  server.registerTool(
    "comfy_workflow_close",
    {
      title: "Close a Comfy workflow tab",
      description:
        "Close an open workflow tab. Modified tabs require confirm_discard=true; files are never deleted.",
      inputSchema: WorkflowCloseInputSchema,
      annotations: DESTRUCTIVE_WRITE,
    },
    (args) => executeTool(() => handlers.comfy_workflow_close(args)),
  );

  server.registerTool(
    "comfy_workflow_reorder",
    {
      title: "Reorder Comfy workflow tabs",
      description: "Move one open workflow tab to a zero-based display index.",
      inputSchema: WorkflowReorderInputSchema,
      annotations: UI_WRITE,
    },
    (args) => executeTool(() => handlers.comfy_workflow_reorder(args)),
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
    "comfy_canvas_focus",
    {
      title: "Focus Comfy canvas nodes",
      description:
        "Activate an optional workflow tab, select nodes, and move the visible viewport to the selection or full graph.",
      inputSchema: CanvasFocusInputSchema,
      annotations: UI_WRITE,
    },
    (args) => executeTool(() => handlers.comfy_canvas_focus(args)),
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
