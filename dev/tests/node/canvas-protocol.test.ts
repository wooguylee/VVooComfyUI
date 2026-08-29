import { describe, expect, it } from "vitest";

import {
  ApplyPatchInputSchema,
  CanvasCommandSchema,
  PatchOperationSchema,
  ReplaceCanvasInputSchema,
} from "../../src/canvas-protocol.js";

const revision = "a".repeat(64);

describe("PatchOperationSchema", () => {
  it.each([
    {
      op: "add_node",
      type: "CLIPTextEncode",
      ref: "positive",
      position: [100, 200],
      size: [320, 180],
      title: "Positive prompt",
      widgets: { text: "night city" },
      properties: { purpose: "test" },
    },
    { op: "remove_node", node: { id: 1 } },
    { op: "move_node", node: { ref: "positive" }, position: [20, 30] },
    { op: "resize_node", node: { id: "2" }, size: [300, 160] },
    { op: "set_widget", node: { id: 3 }, widget: "steps", value: 25 },
    { op: "set_title", node: { id: 4 }, title: "Sampler" },
    { op: "set_properties", node: { id: 5 }, properties: { color: "blue" } },
    {
      op: "connect",
      source: { ref: "positive" },
      source_slot: "CONDITIONING",
      target: { id: 3 },
      target_slot: 1,
    },
    { op: "disconnect", target: { id: 3 }, target_slot: "positive" },
  ])("accepts supported operation $op", (operation) => {
    expect(PatchOperationSchema.parse(operation)).toEqual(operation);
  });

  it.each([
    { op: "move_node", node: { id: 1 }, position: [1] },
    { op: "resize_node", node: { id: 1 }, size: [0, 20] },
    {
      op: "connect",
      source: { id: 1 },
      source_slot: -1,
      target: { id: 2 },
      target_slot: 0,
    },
    { op: "disconnect", target: { id: 2 }, target_slot: "" },
  ])("rejects invalid operation %#", (operation) => {
    expect(() => PatchOperationSchema.parse(operation)).toThrow();
  });
});

describe("ApplyPatchInputSchema", () => {
  it("requires at least one operation", () => {
    expect(() =>
      ApplyPatchInputSchema.parse({ expected_revision: revision, operations: [] }),
    ).toThrow();
  });

  it("requires a lowercase SHA-256 revision", () => {
    expect(() =>
      ApplyPatchInputSchema.parse({
        expected_revision: "A".repeat(64),
        operations: [{ op: "remove_node", node: { id: 1 } }],
      }),
    ).toThrow(/revision/i);
  });

  it("rejects duplicate add-node refs within one transaction", () => {
    expect(() =>
      ApplyPatchInputSchema.parse({
        expected_revision: revision,
        operations: [
          { op: "add_node", type: "A", ref: "new-node" },
          { op: "add_node", type: "B", ref: "new-node" },
        ],
      }),
    ).toThrow(/ref/i);
  });

  it("defaults mass-delete confirmation to false", () => {
    expect(
      ApplyPatchInputSchema.parse({
        expected_revision: revision,
        operations: [{ op: "remove_node", node: { id: 1 } }],
      }).confirm_mass_delete,
    ).toBe(false);
  });
});

describe("ReplaceCanvasInputSchema", () => {
  it("requires explicit replacement confirmation", () => {
    expect(() =>
      ReplaceCanvasInputSchema.parse({
        expected_revision: revision,
        workflow: { nodes: [] },
        confirm_replace: false,
      }),
    ).toThrow(/confirm_replace/i);
  });
});

describe("CanvasCommandSchema", () => {
  it("accepts a versioned canvas get command", () => {
    expect(
      CanvasCommandSchema.parse({
        session_id: "canvas-a",
        command: "canvas.get",
        payload: {},
        timeout_ms: 10_000,
      }),
    ).toEqual({
      session_id: "canvas-a",
      command: "canvas.get",
      payload: {},
      timeout_ms: 10_000,
    });
  });

  it("rejects an unknown canvas command", () => {
    expect(() =>
      CanvasCommandSchema.parse({
        command: "canvas.delete_everything",
        payload: {},
        timeout_ms: 10_000,
      }),
    ).toThrow();
  });
});
