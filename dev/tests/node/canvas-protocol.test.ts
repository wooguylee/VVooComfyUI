import { describe, expect, it } from "vitest";

import {
  ApplyPatchInputSchema,
  CanvasCommandSchema,
  PatchOperationSchema,
  ReplaceCanvasInputSchema,
  WorkflowCloseInputSchema,
  WorkflowCreateInputSchema,
  WorkflowRenameInputSchema,
  WorkflowReorderInputSchema,
  WorkflowSaveInputSchema,
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
      mode: 2,
      color: "#123456",
      bgcolor: null,
      collapsed: true,
    },
    { op: "remove_node", node: { id: 1 } },
    { op: "move_node", node: { ref: "positive" }, position: [20, 30] },
    { op: "resize_node", node: { id: "2" }, size: [300, 160] },
    { op: "set_widget", node: { id: 3 }, widget: "steps", value: 25 },
    { op: "set_title", node: { id: 4 }, title: "Sampler" },
    { op: "set_properties", node: { id: 5 }, properties: { color: "blue" } },
    { op: "set_mode", node: { id: 5 }, mode: 4 },
    { op: "set_colors", node: { id: 5 }, color: null, bgcolor: "#222" },
    { op: "set_collapsed", node: { id: 5 }, collapsed: true },
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
    { op: "set_mode", node: { id: 2 }, mode: -1 },
    { op: "set_colors", node: { id: 2 } },
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

  it.each([
    { command: "workflow.list", payload: {} },
    {
      command: "workflow.get",
      payload: { workflow_id: "workflows/demo.json" },
    },
    {
      command: "workflow.select",
      payload: { workflow_id: "workflows/demo.json" },
    },
    {
      command: "workflow.create",
      payload: { filename: "Generated.json", workflow: { nodes: [] } },
    },
    {
      command: "workflow.save",
      payload: {
        workflow_id: "workflows/demo.json",
        expected_revision: revision,
      },
    },
    {
      command: "workflow.rename",
      payload: {
        workflow_id: "workflows/demo.json",
        new_path: "workflows/renamed.json",
      },
    },
    {
      command: "workflow.close",
      payload: {
        workflow_id: "workflows/demo.json",
        confirm_discard: false,
      },
    },
    {
      command: "workflow.reorder",
      payload: { workflow_id: "workflows/demo.json", index: 0 },
    },
    {
      command: "canvas.focus",
      payload: {
        workflow_id: "workflows/demo.json",
        node_ids: [1, "2"],
        select: true,
        fit: "selection",
      },
    },
  ])("accepts $command", (value) => {
    expect(
      CanvasCommandSchema.parse({ ...value, timeout_ms: 10_000 }),
    ).toMatchObject(value);
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

describe("workflow lifecycle schemas", () => {
  it("accepts safe lifecycle requests and applies defaults", () => {
    expect(
      WorkflowCreateInputSchema.parse({ filename: "Generated" }),
    ).toEqual({ filename: "Generated" });
    expect(
      WorkflowSaveInputSchema.parse({
        workflow_id: "workflows/demo.json",
        expected_revision: revision,
      }),
    ).toMatchObject({ workflow_id: "workflows/demo.json" });
    expect(
      WorkflowCloseInputSchema.parse({ workflow_id: "workflows/demo.json" }),
    ).toMatchObject({ confirm_discard: false });
    expect(
      WorkflowReorderInputSchema.parse({
        workflow_id: "workflows/demo.json",
        index: 1,
      }),
    ).toMatchObject({ index: 1 });
  });

  it.each([
    () =>
      WorkflowRenameInputSchema.parse({
        workflow_id: "workflows/demo.json",
        new_path: "../escape.json",
      }),
    () => WorkflowCreateInputSchema.parse({ filename: "folder/demo.json" }),
    () =>
      WorkflowSaveInputSchema.parse({
        workflow_id: "demo.json",
        expected_revision: revision,
      }),
    () =>
      WorkflowReorderInputSchema.parse({
        workflow_id: "workflows/demo.json",
        index: -1,
      }),
  ])("rejects invalid workflow request %#", (parse) => {
    expect(parse).toThrow();
  });
});
