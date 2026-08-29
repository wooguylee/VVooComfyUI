import { getCanvasState, getRootGraph } from "./graph-state.js";
import {
  applyPatchTransaction,
  CanvasError,
  replaceWorkflowTransaction,
  restoreSnapshotTransaction,
} from "./patch-engine.js";
import {
  activateWorkflow,
  closeWorkflow,
  createWorkflow,
  getWorkflow,
  listWorkflows,
  renameWorkflow,
  reorderWorkflow,
  saveWorkflow,
} from "./workflow-runtime.js";

async function focusCanvas(context, payload) {
  if (payload.workflow_id !== undefined) {
    await activateWorkflow(context, payload.workflow_id);
  }
  const graph = getRootGraph(context.app);
  const canvas = context.app.canvas;
  const nodes = (payload.node_ids ?? []).map((id) => {
    const node = graph?.getNodeById?.(id);
    if (!node) {
      throw new CanvasError("NODE_NOT_FOUND", "Canvas node was not found", {
        node_id: id,
      });
    }
    return node;
  });
  if (payload.select !== false) {
    if (typeof canvas?.selectNodes === "function") canvas.selectNodes(nodes);
    else if (typeof canvas?.selectItems === "function") canvas.selectItems(nodes);
    else {
      throw new CanvasError(
        "VIEWPORT_UNSUPPORTED",
        "This ComfyUI canvas cannot select nodes",
      );
    }
  }

  const fit = payload.fit ?? "selection";
  const fitNodes = fit === "all" ? [...(graph?._nodes ?? [])] : nodes;
  if (fitNodes.length > 0) {
    if (fitNodes.length === 1 && typeof canvas?.centerOnNode === "function") {
      canvas.centerOnNode(fitNodes[0]);
    } else if (
      canvas?.ds &&
      Array.isArray(canvas.ds.offset) &&
      canvas.canvas?.width > 0 &&
      canvas.canvas?.height > 0
    ) {
      const minX = Math.min(...fitNodes.map((node) => node.pos[0]));
      const minY = Math.min(...fitNodes.map((node) => node.pos[1]));
      const maxX = Math.max(
        ...fitNodes.map((node) => node.pos[0] + node.size[0]),
      );
      const maxY = Math.max(
        ...fitNodes.map((node) => node.pos[1] + node.size[1]),
      );
      const padding = 80;
      const width = Math.max(1, maxX - minX);
      const height = Math.max(1, maxY - minY);
      const scale = Math.max(
        0.1,
        Math.min(
          1.5,
          (canvas.canvas.width - padding * 2) / width,
          (canvas.canvas.height - padding * 2) / height,
        ),
      );
      canvas.ds.scale = scale;
      canvas.ds.offset[0] = -minX +
        (canvas.canvas.width / scale - width) / 2;
      canvas.ds.offset[1] = -minY +
        (canvas.canvas.height / scale - height) / 2;
      canvas.setDirty?.(true, true);
    } else if (typeof canvas?.centerOnNode === "function") {
      canvas.centerOnNode(fitNodes[0]);
    } else {
      throw new CanvasError(
        "VIEWPORT_UNSUPPORTED",
        "This ComfyUI canvas cannot focus the requested nodes",
      );
    }
  }
  return {
    workflow_id:
      context.app.extensionManager?.workflow?.activeWorkflow?.path ?? null,
    focused_node_ids: nodes.map((node) => node.id),
    selected: payload.select !== false,
    fit,
  };
}

export async function dispatchCanvasCommand(context, command, payload) {
  switch (command) {
    case "canvas.get":
      return payload.workflow_id === undefined
        ? getCanvasState(context.app)
        : getWorkflow(context, payload);
    case "canvas.apply_patch":
      return applyPatchTransaction(context, payload);
    case "canvas.replace":
      return replaceWorkflowTransaction(context, payload);
    case "canvas.restore":
      return restoreSnapshotTransaction(context, payload);
    case "canvas.to_prompt":
      if (payload.workflow_id !== undefined) {
        await activateWorkflow(context, payload.workflow_id);
      }
      return context.app.graphToPrompt();
    case "canvas.focus":
      return focusCanvas(context, payload);
    case "workflow.list":
      return listWorkflows(context);
    case "workflow.get":
      return getWorkflow(context, payload);
    case "workflow.select":
      return activateWorkflow(context, payload.workflow_id);
    case "workflow.create":
      return createWorkflow(context, payload);
    case "workflow.save":
      return saveWorkflow(context, payload);
    case "workflow.rename":
      return renameWorkflow(context, payload);
    case "workflow.close":
      return closeWorkflow(context, payload);
    case "workflow.reorder":
      return reorderWorkflow(context, payload);
    default:
      throw new CanvasError("UNKNOWN_COMMAND", "Unknown canvas command", {
        command,
      });
  }
}

export function serializeCommandError(error) {
  if (
    error !== null &&
    typeof error === "object" &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    const serialized = { code: error.code, message: error.message };
    if (error.details !== undefined) serialized.details = error.details;
    return serialized;
  }
  return {
    code: "CANVAS_COMMAND_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}
