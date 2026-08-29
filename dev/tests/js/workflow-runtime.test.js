import { describe, expect, it } from "vitest";

import {
  activateWorkflow,
  closeWorkflow,
  createWorkflow,
  getWorkflow,
  listWorkflows,
  renameWorkflow,
  reorderWorkflow,
  saveWorkflow,
} from "../../comfy-extension/vvoo_comfy_mcp/js/workflow-runtime.js";
import { revisionForWorkflow } from "../../comfy-extension/vvoo_comfy_mcp/js/graph-state.js";
import { createFixture } from "./fake-graph.js";

function workflowJson(id, nodeType = "Source") {
  return {
    id,
    last_node_id: 1,
    last_link_id: 0,
    nodes: [
      {
        id: 1,
        type: nodeType,
        title: nodeType,
        pos: [10, 20],
        size: [200, 100],
        properties: {},
        widgets_values: nodeType === "Source" ? [1] : [""],
        inputs: [],
        outputs: [],
      },
    ],
    links: [],
    groups: [],
    config: {},
    extra: {},
    version: 0.4,
  };
}

function makeWorkflow(path, state, options = {}) {
  let currentPath = path;
  const workflow = {
    get path() {
      return currentPath;
    },
    set path(value) {
      currentPath = value;
    },
    get filename() {
      return currentPath.split("/").at(-1).replace(/\.json$/i, "");
    },
    get key() {
      return currentPath.replace(/^workflows\//, "");
    },
    isLoaded: options.loaded ?? true,
    isModified: options.modified ?? false,
    isTemporary: options.temporary ?? false,
    activeState: options.loaded === false ? null : structuredClone(state),
    loadCalls: 0,
    async load() {
      this.loadCalls += 1;
      this.isLoaded = true;
      this.activeState = structuredClone(state);
      return this;
    },
  };
  workflow.changeTracker = {
    prepareForSaveCalls: 0,
    prepareForSave() {
      this.prepareForSaveCalls += 1;
    },
  };
  return workflow;
}

function createWorkflowContext(options = {}) {
  const fixture = createFixture();
  const first = makeWorkflow(
    "workflows/first.json",
    workflowJson("first"),
    options.first,
  );
  const second = makeWorkflow(
    "workflows/second.json",
    workflowJson("second", "Target"),
    options.second,
  );
  const store = {
    activeWorkflow: first,
    openWorkflows: [first, second],
    isBusy: false,
    getWorkflowByPath(path) {
      return this.openWorkflows.find((workflow) => workflow.path === path) ?? null;
    },
    createNewTemporary(name, data) {
      const filename = name ?? `Unsaved Workflow ${this.openWorkflows.length + 1}.json`;
      const path = `workflows/${filename}`;
      const workflow = makeWorkflow(path, data ?? workflowJson(path), {
        temporary: true,
      });
      return workflow;
    },
    async saveWorkflow(workflow) {
      workflow.saved = true;
      workflow.isModified = false;
    },
    async renameWorkflow(workflow, newPath) {
      workflow.path = newPath;
      workflow.isTemporary = false;
    },
    async closeWorkflow(workflow) {
      this.openWorkflows = this.openWorkflows.filter((item) => item !== workflow);
      workflow.closed = true;
    },
    reorderWorkflows(from, to) {
      const [workflow] = this.openWorkflows.splice(from, 1);
      this.openWorkflows.splice(to, 0, workflow);
    },
  };
  fixture.app.extensionManager = { workflow: store };
  fixture.app.rootGraph = fixture.graph;
  fixture.graph.load(first.activeState);
  fixture.app.loadGraphData = async (state, _clean, _restoreView, workflow) => {
    fixture.graph.load(structuredClone(state));
    fixture.app.canvas.graph = fixture.graph;
    store.activeWorkflow = workflow ?? store.activeWorkflow;
    if (workflow) {
      workflow.activeState = structuredClone(state);
      if (!store.openWorkflows.includes(workflow)) store.openWorkflows.push(workflow);
    }
    return true;
  };
  return { ...fixture, context: { app: fixture.app }, store, first, second };
}

describe("workflow reads", () => {
  it("lists open tabs in display order with active and graph metadata", async () => {
    const { context } = createWorkflowContext();

    const result = await listWorkflows(context);

    expect(result.active_workflow_id).toBe("workflows/first.json");
    expect(result.capabilities).toEqual({
      workflow_tabs: true,
      workflow_lifecycle: true,
      canvas_focus: true,
      snapshot_workflow_binding: true,
    });
    expect(result.workflows).toEqual([
      expect.objectContaining({
        workflow_id: "workflows/first.json",
        index: 0,
        active: true,
        node_count: 1,
        link_count: 0,
        revision: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      expect.objectContaining({
        workflow_id: "workflows/second.json",
        index: 1,
        active: false,
        node_count: 1,
      }),
    ]);
  });

  it("lists an inactive tab whose frontend state is a proxy", async () => {
    const { context, second } = createWorkflowContext();
    second.activeState = new Proxy(second.activeState, {});

    const result = await listWorkflows(context);

    expect(result.workflows).toHaveLength(2);
    expect(result.workflows[1]).toEqual(
      expect.objectContaining({
        workflow_id: "workflows/second.json",
        active: false,
        node_count: 1,
        revision: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it("loads an inactive workflow for reading without selecting it", async () => {
    const { context, store, second } = createWorkflowContext({
      second: { loaded: false },
    });

    const result = await getWorkflow(context, {
      workflow_id: "workflows/second.json",
    });

    expect(second.loadCalls).toBe(1);
    expect(store.activeWorkflow.path).toBe("workflows/first.json");
    expect(result.workflow.id).toBe("second");
    expect(result.summary.nodes[0]).toMatchObject({ id: 1, type: "Target" });
  });

  it("reports missing stores and workflow IDs with stable errors", async () => {
    await expect(listWorkflows({ app: {} })).rejects.toMatchObject({
      code: "WORKFLOW_STORE_UNAVAILABLE",
    });
    const { context } = createWorkflowContext();
    await expect(
      getWorkflow(context, { workflow_id: "workflows/missing.json" }),
    ).rejects.toMatchObject({ code: "WORKFLOW_NOT_FOUND" });
  });
});

describe("workflow lifecycle", () => {
  it("activates the requested workflow and visibly loads its graph", async () => {
    const { context, store, graph } = createWorkflowContext();

    const result = await activateWorkflow(context, "workflows/second.json");

    expect(store.activeWorkflow.path).toBe("workflows/second.json");
    expect(graph.serialize().nodes[0].type).toBe("Target");
    expect(result.workflow_id).toBe("workflows/second.json");
  });

  it("creates and activates a new temporary tab", async () => {
    const { context, store } = createWorkflowContext();

    const result = await createWorkflow(context, {
      filename: "Generated.json",
      workflow: workflowJson("generated"),
    });

    expect(result.workflow_id).toBe("workflows/Generated.json");
    expect(store.activeWorkflow.path).toBe(result.workflow_id);
    expect(store.openWorkflows).toHaveLength(3);
  });

  it("revision-checks persisted saves and rejects temporary saves", async () => {
    const { context, first, second } = createWorkflowContext({
      second: { temporary: true },
    });
    const revision = (
      await getWorkflow(context, { workflow_id: first.path })
    ).revision;

    await expect(
      saveWorkflow(context, {
        workflow_id: first.path,
        expected_revision: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_REVISION_CONFLICT" });
    await expect(
      saveWorkflow(context, {
        workflow_id: second.path,
        expected_revision: await revisionForWorkflow(second.activeState),
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_PATH_REQUIRED" });

    const result = await saveWorkflow(context, {
      workflow_id: first.path,
      expected_revision: revision,
    });
    expect(first.saved).toBe(true);
    expect(first.changeTracker.prepareForSaveCalls).toBe(1);
    expect(result.modified).toBe(false);
  });

  it("renames without overwriting an existing workflow", async () => {
    const { context, first } = createWorkflowContext();

    await expect(
      renameWorkflow(context, {
        workflow_id: first.path,
        new_path: "workflows/second.json",
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_PATH_CONFLICT" });

    const result = await renameWorkflow(context, {
      workflow_id: first.path,
      new_path: "workflows/renamed.json",
    });
    expect(result.workflow_id).toBe("workflows/renamed.json");
    expect(first.path).toBe("workflows/renamed.json");
  });

  it("requires discard confirmation and keeps a blank tab when closing last", async () => {
    const { context, store, first, second } = createWorkflowContext({
      first: { modified: true },
    });
    await expect(
      closeWorkflow(context, { workflow_id: first.path }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_DISCARD_CONFIRMATION_REQUIRED",
    });

    await closeWorkflow(context, {
      workflow_id: first.path,
      confirm_discard: true,
    });
    expect(store.activeWorkflow).toBe(second);
    await closeWorkflow(context, { workflow_id: second.path });
    expect(store.openWorkflows).toHaveLength(1);
    expect(store.activeWorkflow.isTemporary).toBe(true);
  });

  it("reorders only within the open tab range", async () => {
    const { context, store, first } = createWorkflowContext();

    await reorderWorkflow(context, { workflow_id: first.path, index: 1 });
    expect(store.openWorkflows.map((workflow) => workflow.path)).toEqual([
      "workflows/second.json",
      "workflows/first.json",
    ]);
    await expect(
      reorderWorkflow(context, { workflow_id: first.path, index: 2 }),
    ).rejects.toMatchObject({ code: "WORKFLOW_INDEX_OUT_OF_RANGE" });
  });
});
