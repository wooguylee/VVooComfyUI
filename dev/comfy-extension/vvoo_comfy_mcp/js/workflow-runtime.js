import {
  cloneJson,
  getCanvasState,
  getSerializedWorkflowState,
} from "./graph-state.js";

export class WorkflowError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
    this.details = details;
  }
}

const CAPABILITIES = Object.freeze({
  workflow_tabs: true,
  workflow_lifecycle: true,
  canvas_focus: true,
  snapshot_workflow_binding: true,
});

export function getWorkflowStore(context) {
  const store = context?.app?.extensionManager?.workflow;
  if (
    !store ||
    !Array.isArray(store.openWorkflows) ||
    typeof store.getWorkflowByPath !== "function"
  ) {
    throw new WorkflowError(
      "WORKFLOW_STORE_UNAVAILABLE",
      "ComfyUI workflow tabs are not available in this frontend",
    );
  }
  return store;
}

function assertStoreReady(store) {
  if (store.isBusy) {
    throw new WorkflowError(
      "WORKFLOW_BUSY",
      "ComfyUI is already performing a workflow file operation",
    );
  }
}

export function findWorkflow(context, workflowId) {
  const store = getWorkflowStore(context);
  const workflow = store.getWorkflowByPath(workflowId);
  if (!workflow || !store.openWorkflows.includes(workflow)) {
    throw new WorkflowError("WORKFLOW_NOT_FOUND", "Workflow tab was not found", {
      workflow_id: workflowId,
    });
  }
  return { store, workflow };
}

function isActive(store, workflow) {
  return store.activeWorkflow === workflow || store.activeWorkflow?.path === workflow.path;
}

async function ensureLoaded(workflow) {
  if (!workflow.isLoaded || workflow.activeState == null) {
    if (typeof workflow.load !== "function") {
      throw new WorkflowError(
        "WORKFLOW_NOT_LOADED",
        "Workflow state is not loaded and cannot be loaded",
        { workflow_id: workflow.path },
      );
    }
    await workflow.load();
  }
  if (workflow.activeState == null) {
    throw new WorkflowError("WORKFLOW_NOT_LOADED", "Workflow has no active state", {
      workflow_id: workflow.path,
    });
  }
  return workflow;
}

async function stateForWorkflow(context, store, workflow) {
  if (isActive(store, workflow)) {
    return getCanvasState(context.app);
  }
  await ensureLoaded(workflow);
  return getSerializedWorkflowState(workflow.activeState);
}

function workflowMetadata(workflow, index, active, state) {
  return {
    workflow_id: workflow.path,
    path: workflow.path,
    filename: workflow.filename,
    key: workflow.key,
    index,
    active,
    modified: workflow.isModified === true,
    temporary: workflow.isTemporary === true,
    loaded: workflow.isLoaded === true,
    node_count: state?.summary?.nodes?.length ?? null,
    link_count: state?.summary?.links?.length ?? null,
    revision: state?.revision ?? null,
  };
}

async function describeWorkflow(context, store, workflow) {
  const state = await stateForWorkflow(context, store, workflow);
  const index = store.openWorkflows.indexOf(workflow);
  return {
    ...workflowMetadata(workflow, index, isActive(store, workflow), state),
    ...state,
  };
}

export async function listWorkflows(context) {
  const store = getWorkflowStore(context);
  const workflows = [];
  for (const workflow of store.openWorkflows) {
    const state = await stateForWorkflow(context, store, workflow);
    workflows.push(
      workflowMetadata(
        workflow,
        workflows.length,
        isActive(store, workflow),
        state,
      ),
    );
  }
  return {
    active_workflow_id: store.activeWorkflow?.path ?? null,
    workflows,
    capabilities: { ...CAPABILITIES },
  };
}

export async function getWorkflow(context, payload) {
  const { store, workflow } = findWorkflow(context, payload.workflow_id);
  return describeWorkflow(context, store, workflow);
}

async function activateWorkflowObject(context, store, workflow) {
  assertStoreReady(store);
  if (!isActive(store, workflow)) {
    await ensureLoaded(workflow);
    const loaded = await context.app.loadGraphData(
      cloneJson(workflow.activeState),
      true,
      true,
      workflow,
      {
        checkForRerouteMigration: false,
        deferWarnings: true,
        skipAssetScans: true,
      },
    );
    if (loaded === false) {
      throw new WorkflowError(
        "WORKFLOW_LOAD_FAILED",
        "ComfyUI did not activate the requested workflow",
        { workflow_id: workflow.path },
      );
    }
    if (!isActive(store, workflow) && typeof store.openWorkflow === "function") {
      await store.openWorkflow(workflow);
    }
  }
  return describeWorkflow(context, store, workflow);
}

export async function activateWorkflow(context, workflowId) {
  const { store, workflow } = findWorkflow(context, workflowId);
  return activateWorkflowObject(context, store, workflow);
}

function validateTemporaryFilename(filename) {
  if (filename === undefined) return undefined;
  if (
    typeof filename !== "string" ||
    filename.length === 0 ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename === "." ||
    filename === ".."
  ) {
    throw new WorkflowError(
      "WORKFLOW_PATH_INVALID",
      "Temporary workflow filename must be a plain file name",
    );
  }
  return filename.toLowerCase().endsWith(".json") ? filename : `${filename}.json`;
}

export async function createWorkflow(context, payload = {}) {
  const store = getWorkflowStore(context);
  assertStoreReady(store);
  if (typeof store.createNewTemporary !== "function") {
    throw new WorkflowError(
      "WORKFLOW_LIFECYCLE_UNAVAILABLE",
      "This ComfyUI frontend cannot create workflow tabs",
    );
  }
  const filename = validateTemporaryFilename(payload.filename);
  const workflow = store.createNewTemporary(
    filename,
    payload.workflow === undefined ? undefined : cloneJson(payload.workflow),
  );
  return activateWorkflowObject(context, store, workflow);
}

export async function saveWorkflow(context, payload) {
  const { store, workflow } = findWorkflow(context, payload.workflow_id);
  assertStoreReady(store);
  if (workflow.isTemporary) {
    throw new WorkflowError(
      "WORKFLOW_PATH_REQUIRED",
      "Rename the temporary workflow before saving it",
      { workflow_id: workflow.path },
    );
  }
  await activateWorkflow(context, workflow.path);
  const state = await getCanvasState(context.app);
  if (state.revision !== payload.expected_revision) {
    throw new WorkflowError(
      "WORKFLOW_REVISION_CONFLICT",
      "Workflow revision has changed",
      {
        expected_revision: payload.expected_revision,
        current_revision: state.revision,
      },
    );
  }
  if (typeof store.saveWorkflow !== "function") {
    throw new WorkflowError(
      "WORKFLOW_LIFECYCLE_UNAVAILABLE",
      "This ComfyUI frontend cannot save workflow tabs",
    );
  }
  workflow.changeTracker?.prepareForSave?.();
  await store.saveWorkflow(workflow);
  return describeWorkflow(context, store, workflow);
}

export function normalizeWorkflowPath(path) {
  if (typeof path !== "string" || path.length === 0 || path.includes("\\")) {
    throw new WorkflowError("WORKFLOW_PATH_INVALID", "Workflow path is invalid");
  }
  const normalized = path.startsWith("workflows/") ? path : `workflows/${path}`;
  const segments = normalized.split("/");
  if (
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    !normalized.toLowerCase().endsWith(".json")
  ) {
    throw new WorkflowError(
      "WORKFLOW_PATH_INVALID",
      "Workflow path must stay under workflows and end in .json",
    );
  }
  return normalized;
}

export async function renameWorkflow(context, payload) {
  const { store, workflow } = findWorkflow(context, payload.workflow_id);
  assertStoreReady(store);
  const newPath = normalizeWorkflowPath(payload.new_path);
  const conflict = store.getWorkflowByPath(newPath);
  if (conflict && conflict !== workflow) {
    throw new WorkflowError(
      "WORKFLOW_PATH_CONFLICT",
      "Another workflow already uses the requested path",
      { new_path: newPath },
    );
  }
  if (newPath !== workflow.path) {
    if (typeof store.renameWorkflow !== "function") {
      throw new WorkflowError(
        "WORKFLOW_LIFECYCLE_UNAVAILABLE",
        "This ComfyUI frontend cannot rename workflow tabs",
      );
    }
    await store.renameWorkflow(workflow, newPath);
  }
  return describeWorkflow(context, store, workflow);
}

export async function closeWorkflow(context, payload) {
  const { store, workflow } = findWorkflow(context, payload.workflow_id);
  assertStoreReady(store);
  if (workflow.isModified && payload.confirm_discard !== true) {
    throw new WorkflowError(
      "WORKFLOW_DISCARD_CONFIRMATION_REQUIRED",
      "Closing a modified workflow requires discard confirmation",
      { workflow_id: workflow.path },
    );
  }
  if (typeof store.closeWorkflow !== "function") {
    throw new WorkflowError(
      "WORKFLOW_LIFECYCLE_UNAVAILABLE",
      "This ComfyUI frontend cannot close workflow tabs",
    );
  }
  if (isActive(store, workflow)) {
    const index = store.openWorkflows.indexOf(workflow);
    let next = store.openWorkflows[index + 1] ?? store.openWorkflows[index - 1];
    if (!next) {
      if (typeof store.createNewTemporary !== "function") {
        throw new WorkflowError(
          "WORKFLOW_LIFECYCLE_UNAVAILABLE",
          "The final workflow tab cannot be replaced",
        );
      }
      next = store.createNewTemporary();
    }
    await activateWorkflowObject(context, store, next);
  }
  await store.closeWorkflow(workflow);
  return listWorkflows(context);
}

export async function reorderWorkflow(context, payload) {
  const { store, workflow } = findWorkflow(context, payload.workflow_id);
  assertStoreReady(store);
  if (
    !Number.isSafeInteger(payload.index) ||
    payload.index < 0 ||
    payload.index >= store.openWorkflows.length
  ) {
    throw new WorkflowError(
      "WORKFLOW_INDEX_OUT_OF_RANGE",
      "Workflow tab index is outside the open tab range",
      { index: payload.index, count: store.openWorkflows.length },
    );
  }
  if (typeof store.reorderWorkflows !== "function") {
    throw new WorkflowError(
      "WORKFLOW_LIFECYCLE_UNAVAILABLE",
      "This ComfyUI frontend cannot reorder workflow tabs",
    );
  }
  const from = store.openWorkflows.indexOf(workflow);
  if (from !== payload.index) store.reorderWorkflows(from, payload.index);
  return listWorkflows(context);
}
