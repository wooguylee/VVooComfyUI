import { getCanvasState } from "./graph-state.js";
import {
  applyPatchTransaction,
  CanvasError,
  replaceWorkflowTransaction,
  restoreSnapshotTransaction,
} from "./patch-engine.js";

export async function dispatchCanvasCommand(context, command, payload) {
  switch (command) {
    case "canvas.get":
      return getCanvasState(context.app);
    case "canvas.apply_patch":
      return applyPatchTransaction(context, payload);
    case "canvas.replace":
      return replaceWorkflowTransaction(context, payload);
    case "canvas.restore":
      return restoreSnapshotTransaction(context, payload);
    case "canvas.to_prompt":
      return context.app.graphToPrompt();
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
