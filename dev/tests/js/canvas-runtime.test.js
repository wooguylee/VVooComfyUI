import { describe, expect, it } from "vitest";

import { SnapshotStore } from "../../comfy-extension/vvoo_comfy_mcp/js/graph-state.js";
import {
  dispatchCanvasCommand,
  serializeCommandError,
} from "../../comfy-extension/vvoo_comfy_mcp/js/canvas-runtime.js";
import { createFixture } from "./fake-graph.js";

function createContext() {
  const fixture = createFixture();
  return {
    ...fixture,
    context: {
      app: fixture.app,
      liteGraph: fixture.liteGraph,
      snapshots: new SnapshotStore(10),
    },
  };
}

describe("dispatchCanvasCommand", () => {
  it("returns the current root canvas state", async () => {
    const { graph, liteGraph, context } = createContext();
    graph.add(liteGraph.createNode("Source"));

    const result = await dispatchCanvasCommand(context, "canvas.get", {});

    expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(result.summary.nodes).toHaveLength(1);
  });

  it("returns graphToPrompt output without reshaping it", async () => {
    const { app, context } = createContext();
    const prompt = { output: { 1: { class_type: "Source" } }, workflow: { x: 1 } };
    app.graphToPrompt = async () => prompt;

    await expect(
      dispatchCanvasCommand(context, "canvas.to_prompt", {}),
    ).resolves.toBe(prompt);
  });

  it("dispatches a patch transaction", async () => {
    const { context } = createContext();
    const current = await dispatchCanvasCommand(context, "canvas.get", {});

    const result = await dispatchCanvasCommand(context, "canvas.apply_patch", {
      expected_revision: current.revision,
      operations: [{ op: "add_node", type: "Target", ref: "target" }],
      confirm_mass_delete: false,
    });

    expect(result.refs.target).toEqual(expect.any(Number));
    expect(result.summary.nodes[0].type).toBe("Target");
  });

  it("rejects unknown commands with a stable protocol error", async () => {
    const { context } = createContext();

    await expect(
      dispatchCanvasCommand(context, "canvas.unknown", {}),
    ).rejects.toMatchObject({ code: "UNKNOWN_COMMAND" });
  });
});

describe("serializeCommandError", () => {
  it("preserves structured canvas errors", () => {
    expect(
      serializeCommandError({
        code: "NODE_NOT_FOUND",
        message: "missing",
        details: { node_id: 4 },
      }),
    ).toEqual({
      code: "NODE_NOT_FOUND",
      message: "missing",
      details: { node_id: 4 },
    });
  });

  it("hides raw exceptions behind a stable code", () => {
    expect(serializeCommandError(new Error("boom"))).toEqual({
      code: "CANVAS_COMMAND_FAILED",
      message: "boom",
    });
  });
});
