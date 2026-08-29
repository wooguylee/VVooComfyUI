import { describe, expect, it } from "vitest";

import { getCanvasState, SnapshotStore } from "../../comfy-extension/vvoo_comfy_mcp/js/graph-state.js";
import {
  applyPatchTransaction,
  replaceWorkflowTransaction,
  restoreSnapshotTransaction,
} from "../../comfy-extension/vvoo_comfy_mcp/js/patch-engine.js";
import { createFixture } from "./fake-graph.js";

function createContext() {
  const fixture = createFixture();
  return {
    ...fixture,
    snapshots: new SnapshotStore(10),
    context: {
      app: fixture.app,
      liteGraph: fixture.liteGraph,
      snapshots: new SnapshotStore(10),
    },
  };
}

async function currentRevision(app) {
  return (await getCanvasState(app)).revision;
}

describe("applyPatchTransaction", () => {
  it("adds configured nodes and connects temporary refs atomically", async () => {
    const { app, graph, context } = createContext();
    const before = await currentRevision(app);

    const result = await applyPatchTransaction(context, {
      expected_revision: before,
      operations: [
        {
          op: "add_node",
          type: "Source",
          ref: "source",
          position: [10, 20],
          size: [240, 120],
          title: "Image source",
          widgets: { seed: 42 },
          properties: { role: "source" },
        },
        {
          op: "add_node",
          type: "Target",
          ref: "target",
          position: [400, 20],
          widgets: { prompt: "night city" },
        },
        {
          op: "connect",
          source: { ref: "source" },
          source_slot: "IMAGE",
          target: { ref: "target" },
          target_slot: "image",
        },
      ],
      confirm_mass_delete: false,
    });

    expect(result.backup_id).toEqual(expect.any(String));
    expect(result.revision).not.toBe(before);
    expect(result.refs).toEqual({
      source: graph._nodes[0].id,
      target: graph._nodes[1].id,
    });
    expect(graph._nodes[0]).toMatchObject({
      type: "Source",
      title: "Image source",
      pos: [10, 20],
      size: [240, 120],
      properties: { role: "source" },
    });
    expect(graph._nodes[0].widgets[0].value).toBe(42);
    expect(graph._nodes[1].widgets[0].value).toBe("night city");
    expect(Object.values(graph.links)).toHaveLength(1);
    expect(graph.dirtyCalls.at(-1)).toEqual([true, true]);
  });

  it("moves, resizes, retitles, configures, and disconnects nodes", async () => {
    const { app, graph, liteGraph, context } = createContext();
    const source = graph.add(liteGraph.createNode("Source"));
    const target = graph.add(liteGraph.createNode("Target"));
    source.connect(0, target, 0);
    const before = await currentRevision(app);

    await applyPatchTransaction(context, {
      expected_revision: before,
      operations: [
        { op: "move_node", node: { id: target.id }, position: [100, 200] },
        { op: "resize_node", node: { id: target.id }, size: [300, 180] },
        { op: "set_title", node: { id: target.id }, title: "Output" },
        {
          op: "set_properties",
          node: { id: target.id },
          properties: { color: "blue" },
        },
        {
          op: "set_widget",
          node: { id: target.id },
          widget: "prompt",
          value: "updated",
        },
        { op: "disconnect", target: { id: target.id }, target_slot: 0 },
      ],
      confirm_mass_delete: false,
    });

    expect(target.pos).toEqual([100, 200]);
    expect(target.size).toEqual([300, 180]);
    expect(target.title).toBe("Output");
    expect(target.properties).toEqual({ color: "blue" });
    expect(target.widgets[0].value).toBe("updated");
    expect(target.inputs[0].link).toBeNull();
    expect(Object.values(graph.links)).toHaveLength(0);
  });

  it("removes a node when the transaction is not a mass deletion", async () => {
    const { app, graph, liteGraph, context } = createContext();
    const first = graph.add(liteGraph.createNode("Source"));
    graph.add(liteGraph.createNode("Source"));
    graph.add(liteGraph.createNode("Target"));
    const before = await currentRevision(app);

    await applyPatchTransaction(context, {
      expected_revision: before,
      operations: [{ op: "remove_node", node: { id: first.id } }],
      confirm_mass_delete: false,
    });

    expect(graph.getNodeById(first.id)).toBeNull();
    expect(graph._nodes).toHaveLength(2);
  });

  it("rejects a stale revision before changing the graph", async () => {
    const { app, graph, liteGraph, context } = createContext();
    const node = graph.add(liteGraph.createNode("Source"));
    const before = graph.serialize();

    await expect(
      applyPatchTransaction(context, {
        expected_revision: "0".repeat(64),
        operations: [
          { op: "move_node", node: { id: node.id }, position: [1, 2] },
        ],
        confirm_mass_delete: false,
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(graph.serialize()).toEqual(before);
    expect(await currentRevision(app)).not.toBe("0".repeat(64));
  });

  it.each([
    {
      operation: { op: "move_node", node: { id: 999 }, position: [1, 2] },
      code: "NODE_NOT_FOUND",
    },
    {
      operation: {
        op: "connect",
        source: { id: 1 },
        source_slot: "missing",
        target: { id: 2 },
        target_slot: 0,
      },
      code: "SLOT_NOT_FOUND",
    },
    {
      operation: {
        op: "set_widget",
        node: { id: 2 },
        widget: "missing",
        value: 1,
      },
      code: "WIDGET_NOT_FOUND",
    },
  ])("returns $code and rolls back the graph", async ({ operation, code }) => {
    const { app, graph, liteGraph, context } = createContext();
    graph.add(liteGraph.createNode("Source"));
    graph.add(liteGraph.createNode("Target"));
    const beforeWorkflow = graph.serialize();
    const beforeRevision = await currentRevision(app);

    await expect(
      applyPatchTransaction(context, {
        expected_revision: beforeRevision,
        operations: [
          { op: "move_node", node: { id: 1 }, position: [90, 90] },
          operation,
        ],
        confirm_mass_delete: false,
      }),
    ).rejects.toMatchObject({
      code,
      details: expect.objectContaining({ rolled_back: true }),
    });
    expect(graph.serialize()).toEqual(beforeWorkflow);
  });

  it("rolls back all newly added nodes when a connection is rejected", async () => {
    const { app, graph, context } = createContext();
    const before = await currentRevision(app);

    await expect(
      applyPatchTransaction(context, {
        expected_revision: before,
        operations: [
          { op: "add_node", type: "RejectingSource", ref: "source" },
          { op: "add_node", type: "Target", ref: "target" },
          {
            op: "connect",
            source: { ref: "source" },
            source_slot: 0,
            target: { ref: "target" },
            target_slot: 0,
          },
        ],
        confirm_mass_delete: false,
      }),
    ).rejects.toMatchObject({
      code: "CONNECTION_REJECTED",
      details: expect.objectContaining({ rolled_back: true }),
    });
    expect(graph._nodes).toHaveLength(0);
    expect(graph.serialize().links).toEqual([]);
  });

  it("requires confirmation when removing at least half the graph", async () => {
    const { app, graph, liteGraph, context } = createContext();
    const first = graph.add(liteGraph.createNode("Source"));
    graph.add(liteGraph.createNode("Target"));
    const before = await currentRevision(app);

    await expect(
      applyPatchTransaction(context, {
        expected_revision: before,
        operations: [{ op: "remove_node", node: { id: first.id } }],
        confirm_mass_delete: false,
      }),
    ).rejects.toMatchObject({
      code: "MASS_DELETE_CONFIRMATION_REQUIRED",
    });
    expect(graph._nodes).toHaveLength(2);

    await applyPatchTransaction(context, {
      expected_revision: before,
      operations: [{ op: "remove_node", node: { id: first.id } }],
      confirm_mass_delete: true,
    });
    expect(graph._nodes).toHaveLength(1);
  });

  it("rejects writes while a subgraph is visible", async () => {
    const { app, graph, liteGraph, context } = createContext();
    const node = graph.add(liteGraph.createNode("Source"));
    app.canvas.graph = { isSubgraph: true };

    await expect(
      applyPatchTransaction(context, {
        expected_revision: await currentRevision(app),
        operations: [
          { op: "move_node", node: { id: node.id }, position: [1, 2] },
        ],
        confirm_mass_delete: false,
      }),
    ).rejects.toMatchObject({ code: "SUBGRAPH_UNSUPPORTED" });
  });
});

describe("replace and restore transactions", () => {
  it("replaces the root workflow and keeps the old workflow as a snapshot", async () => {
    const { app, graph, liteGraph, context } = createContext();
    graph.add(liteGraph.createNode("Source"));
    const before = await getCanvasState(app);
    const other = createFixture();
    other.graph.add(other.liteGraph.createNode("Target"));
    const replacement = other.graph.serialize();

    const result = await replaceWorkflowTransaction(context, {
      expected_revision: before.revision,
      workflow: replacement,
      confirm_replace: true,
    });

    expect(graph.serialize()).toEqual(replacement);
    expect(context.snapshots.get(result.backup_id)).toEqual(before.workflow);
  });

  it("rolls back when loading a replacement fails", async () => {
    const { app, graph, liteGraph, context } = createContext();
    graph.add(liteGraph.createNode("Source"));
    const before = await getCanvasState(app);
    const originalLoader = app.loadGraphData.bind(app);
    app.loadGraphData = async (workflow) => {
      if (workflow.fail === true) {
        throw new Error("load failed");
      }
      await originalLoader(workflow);
    };

    await expect(
      replaceWorkflowTransaction(context, {
        expected_revision: before.revision,
        workflow: { fail: true, nodes: [] },
        confirm_replace: true,
      }),
    ).rejects.toMatchObject({
      code: "CANVAS_LOAD_FAILED",
      details: expect.objectContaining({ rolled_back: true }),
    });
    expect(graph.serialize()).toEqual(before.workflow);
  });

  it("restores a previous snapshot and creates a backup of the replaced state", async () => {
    const { app, graph, liteGraph, context } = createContext();
    const node = graph.add(liteGraph.createNode("Source"));
    const original = graph.serialize();
    const firstRevision = await currentRevision(app);
    const patched = await applyPatchTransaction(context, {
      expected_revision: firstRevision,
      operations: [
        { op: "move_node", node: { id: node.id }, position: [100, 200] },
      ],
      confirm_mass_delete: false,
    });

    const restored = await restoreSnapshotTransaction(context, {
      expected_revision: patched.revision,
      backup_id: patched.backup_id,
    });

    expect(graph.serialize()).toEqual(original);
    expect(restored.restored_backup_id).toBe(patched.backup_id);
    expect(context.snapshots.get(restored.backup_id)).toBeDefined();
  });

  it("rejects an unknown backup without changing the graph", async () => {
    const { app, graph, liteGraph, context } = createContext();
    graph.add(liteGraph.createNode("Source"));
    const before = await getCanvasState(app);

    await expect(
      restoreSnapshotTransaction(context, {
        expected_revision: before.revision,
        backup_id: "missing",
      }),
    ).rejects.toMatchObject({ code: "BACKUP_NOT_FOUND" });
    expect(graph.serialize()).toEqual(before.workflow);
  });
});
