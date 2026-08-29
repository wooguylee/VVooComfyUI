import { z } from "zod";

import type { BridgeCommandResult } from "./bridge-client.js";
import {
  ApplyPatchInputSchema,
  CanvasFocusInputSchema,
  CanvasCommandSchema,
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
  type CanvasCommand,
} from "./canvas-protocol.js";
import type {
  QueuePromptPayload,
  QueuePromptResponse,
} from "./comfy-http-client.js";
import { ComfyMcpError, serializeError } from "./errors.js";

const EmptyInputSchema = z.object({}).strict();
const ToPromptResultSchema = z.object({
  output: z.record(z.string(), z.unknown()),
  workflow: z.json(),
});

export interface ComfyApiClient {
  getSystemStats(): Promise<unknown>;
  getQueue(): Promise<unknown>;
  getObjectInfo(nodeClass?: string): Promise<unknown>;
  getHistory(promptId?: string): Promise<unknown>;
  interrupt(): Promise<void>;
  queuePrompt(payload: QueuePromptPayload): Promise<QueuePromptResponse>;
}

export interface CanvasBridgeApiClient {
  listSessions(): Promise<unknown>;
  command(command: CanvasCommand): Promise<BridgeCommandResult>;
}

export interface ToolHandlerDependencies {
  comfy: ComfyApiClient;
  bridge: CanvasBridgeApiClient;
  bridgeTimeoutMs: number;
}

function createCanvasCommand(
  command: CanvasCommand["command"],
  payload: unknown,
  sessionId: string | undefined,
  timeoutMs: number,
): CanvasCommand {
  return CanvasCommandSchema.parse({
    ...(sessionId === undefined ? {} : { session_id: sessionId }),
    command,
    payload,
    timeout_ms: timeoutMs,
  });
}

function mergeAvailableBridgeStatus(result: unknown): Record<string, unknown> {
  if (typeof result === "object" && result !== null && !Array.isArray(result)) {
    return { available: true, ...(result as Record<string, unknown>) };
  }
  return { available: true, result };
}

export function createToolHandlers(dependencies: ToolHandlerDependencies) {
  const { comfy, bridge, bridgeTimeoutMs } = dependencies;

  return {
    async comfy_status(input: unknown): Promise<unknown> {
      EmptyInputSchema.parse(input);
      const [system, queue] = await Promise.all([
        comfy.getSystemStats(),
        comfy.getQueue(),
      ]);
      let bridgeStatus: Record<string, unknown>;
      try {
        bridgeStatus = mergeAvailableBridgeStatus(await bridge.listSessions());
      } catch (error) {
        bridgeStatus = { available: false, error: serializeError(error) };
      }
      return { system, queue, bridge: bridgeStatus };
    },

    async comfy_node_types(input: unknown): Promise<unknown> {
      const parsed = NodeTypesInputSchema.parse(input);
      return comfy.getObjectInfo(parsed.node_class);
    },

    async comfy_canvas_list(input: unknown): Promise<unknown> {
      EmptyInputSchema.parse(input);
      return bridge.listSessions();
    },

    async comfy_canvas_get(input: unknown): Promise<BridgeCommandResult> {
      const parsed = CanvasGetInputSchema.parse(input);
      return bridge.command(
        createCanvasCommand(
          "canvas.get",
          parsed.workflow_id === undefined
            ? {}
            : { workflow_id: parsed.workflow_id },
          parsed.session_id,
          bridgeTimeoutMs,
        ),
      );
    },

    async comfy_workflow_list(input: unknown): Promise<BridgeCommandResult> {
      const parsed = WorkflowListInputSchema.parse(input);
      return bridge.command(
        createCanvasCommand(
          "workflow.list",
          {},
          parsed.session_id,
          bridgeTimeoutMs,
        ),
      );
    },

    async comfy_workflow_get(input: unknown): Promise<BridgeCommandResult> {
      const parsed = WorkflowGetInputSchema.parse(input);
      const { session_id: sessionId, ...payload } = parsed;
      return bridge.command(
        createCanvasCommand(
          "workflow.get",
          payload,
          sessionId,
          bridgeTimeoutMs,
        ),
      );
    },

    async comfy_workflow_select(input: unknown): Promise<BridgeCommandResult> {
      const parsed = WorkflowSelectInputSchema.parse(input);
      const { session_id: sessionId, ...payload } = parsed;
      return bridge.command(
        createCanvasCommand(
          "workflow.select",
          payload,
          sessionId,
          bridgeTimeoutMs,
        ),
      );
    },

    async comfy_workflow_create(input: unknown): Promise<BridgeCommandResult> {
      const parsed = WorkflowCreateInputSchema.parse(input);
      const { session_id: sessionId, ...payload } = parsed;
      return bridge.command(
        createCanvasCommand(
          "workflow.create",
          payload,
          sessionId,
          bridgeTimeoutMs,
        ),
      );
    },

    async comfy_workflow_save(input: unknown): Promise<BridgeCommandResult> {
      const parsed = WorkflowSaveInputSchema.parse(input);
      const { session_id: sessionId, ...payload } = parsed;
      return bridge.command(
        createCanvasCommand(
          "workflow.save",
          payload,
          sessionId,
          bridgeTimeoutMs,
        ),
      );
    },

    async comfy_workflow_rename(input: unknown): Promise<BridgeCommandResult> {
      const parsed = WorkflowRenameInputSchema.parse(input);
      const { session_id: sessionId, ...payload } = parsed;
      return bridge.command(
        createCanvasCommand(
          "workflow.rename",
          payload,
          sessionId,
          bridgeTimeoutMs,
        ),
      );
    },

    async comfy_workflow_close(input: unknown): Promise<BridgeCommandResult> {
      const parsed = WorkflowCloseInputSchema.parse(input);
      const { session_id: sessionId, ...payload } = parsed;
      return bridge.command(
        createCanvasCommand(
          "workflow.close",
          payload,
          sessionId,
          bridgeTimeoutMs,
        ),
      );
    },

    async comfy_workflow_reorder(input: unknown): Promise<BridgeCommandResult> {
      const parsed = WorkflowReorderInputSchema.parse(input);
      const { session_id: sessionId, ...payload } = parsed;
      return bridge.command(
        createCanvasCommand(
          "workflow.reorder",
          payload,
          sessionId,
          bridgeTimeoutMs,
        ),
      );
    },

    async comfy_canvas_apply_patch(
      input: unknown,
    ): Promise<BridgeCommandResult> {
      const parsed = ApplyPatchInputSchema.parse(input);
      const { session_id: sessionId, ...payload } = parsed;
      return bridge.command(
        createCanvasCommand(
          "canvas.apply_patch",
          payload,
          sessionId,
          bridgeTimeoutMs,
        ),
      );
    },

    async comfy_canvas_replace(input: unknown): Promise<BridgeCommandResult> {
      const parsed = ReplaceCanvasInputSchema.parse(input);
      const { session_id: sessionId, ...payload } = parsed;
      return bridge.command(
        createCanvasCommand(
          "canvas.replace",
          payload,
          sessionId,
          bridgeTimeoutMs,
        ),
      );
    },

    async comfy_canvas_restore(input: unknown): Promise<BridgeCommandResult> {
      const parsed = RestoreCanvasInputSchema.parse(input);
      const { session_id: sessionId, ...payload } = parsed;
      return bridge.command(
        createCanvasCommand(
          "canvas.restore",
          payload,
          sessionId,
          bridgeTimeoutMs,
        ),
      );
    },

    async comfy_canvas_focus(input: unknown): Promise<BridgeCommandResult> {
      const parsed = CanvasFocusInputSchema.parse(input);
      const { session_id: sessionId, ...payload } = parsed;
      return bridge.command(
        createCanvasCommand(
          "canvas.focus",
          payload,
          sessionId,
          bridgeTimeoutMs,
        ),
      );
    },

    async comfy_queue_current(input: unknown): Promise<QueuePromptResponse> {
      const parsed = QueueCurrentInputSchema.parse(input);
      const toPromptPayload =
        parsed.workflow_id === undefined
          ? {}
          : { workflow_id: parsed.workflow_id };
      const bridgeResponse = await bridge.command(
        createCanvasCommand(
          "canvas.to_prompt",
          toPromptPayload,
          parsed.session_id,
          bridgeTimeoutMs,
        ),
      );
      const promptResult = ToPromptResultSchema.safeParse(bridgeResponse.result);
      if (!promptResult.success) {
        throw new ComfyMcpError(
          "BRIDGE_PROTOCOL_ERROR",
          "Canvas bridge returned an invalid graphToPrompt result",
          { issues: promptResult.error.issues },
        );
      }

      const payload: QueuePromptPayload = {
        prompt: promptResult.data.output,
        extra_data: {
          extra_pnginfo: { workflow: promptResult.data.workflow },
        },
      };
      if (bridgeResponse.session_id !== undefined) {
        payload.client_id = bridgeResponse.session_id;
      }
      if (parsed.front !== undefined) {
        payload.front = parsed.front;
      }
      if (parsed.number !== undefined) {
        payload.number = parsed.number;
      }
      return comfy.queuePrompt(payload);
    },

    async comfy_queue_get(input: unknown): Promise<unknown> {
      EmptyInputSchema.parse(input);
      return comfy.getQueue();
    },

    async comfy_interrupt(input: unknown): Promise<{ interrupted: true }> {
      EmptyInputSchema.parse(input);
      await comfy.interrupt();
      return { interrupted: true };
    },

    async comfy_history_get(input: unknown): Promise<unknown> {
      const parsed = HistoryInputSchema.parse(input);
      return comfy.getHistory(parsed.prompt_id);
    },
  };
}

export type ToolHandlers = ReturnType<typeof createToolHandlers>;
