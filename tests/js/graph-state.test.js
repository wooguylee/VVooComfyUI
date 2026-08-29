import { describe, expect, it } from "vitest";

import {
  SnapshotStore,
  canonicalJson,
  getCanvasState,
  revisionForWorkflow,
} from "../../comfy-extension/vvoo_comfy_mcp/js/graph-state.js";
import { createFixture } from "./fake-graph.js";

describe("canonicalJson", () => {
  it("ignores object key insertion order", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it("preserves array order", () => {
    expect(canonicalJson({ values: [1, 2] })).not.toBe(
      canonicalJson({ values: [2, 1] }),
    );
  });
});

describe("revisionForWorkflow", () => {
  it("returns a stable lowercase SHA-256 revision", async () => {
    const first = await revisionForWorkflow({ b: 2, a: 1 });
    const second = await revisionForWorkflow({ a: 1, b: 2 });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });
});

describe("SnapshotStore", () => {
  it("returns independent clones and evicts the oldest entry", () => {
    const snapshots = new SnapshotStore(2);
    const original = { nodes: [{ id: 1 }] };
    const first = snapshots.add(original);
    original.nodes[0].id = 99;
    const second = snapshots.add({ nodes: [{ id: 2 }] });
    const third = snapshots.add({ nodes: [{ id: 3 }] });

    expect(first).not.toBe(second);
    expect(second).not.toBe(third);
    expect(snapshots.get(first)).toBeUndefined();
    expect(snapshots.get(second)).toEqual({ nodes: [{ id: 2 }] });
    const restored = snapshots.get(third);
    restored.nodes[0].id = 30;
    expect(snapshots.get(third)).toEqual({ nodes: [{ id: 3 }] });
  });
});

describe("getCanvasState", () => {
  it("returns workflow, node/link/widget summary, and revision", async () => {
    const { app, graph, liteGraph } = createFixture();
    const source = graph.add(liteGraph.createNode("Source"));
    source.pos = [10, 20];
    source.widgets[0].value = 42;
    const target = graph.add(liteGraph.createNode("Target"));
    source.connect(0, target, 0);

    const state = await getCanvasState(app);

    expect(state.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(state.root_canvas_visible).toBe(true);
    expect(state.summary.nodes).toEqual([
      expect.objectContaining({
        id: source.id,
        type: "Source",
        position: [10, 20],
        widgets: { seed: 42 },
      }),
      expect.objectContaining({ id: target.id, type: "Target" }),
    ]);
    expect(state.summary.links).toEqual([
      expect.objectContaining({
        source_node: source.id,
        source_slot: 0,
        target_node: target.id,
        target_slot: 0,
      }),
    ]);
    expect(state.workflow).toEqual(graph.serialize());
  });
});
