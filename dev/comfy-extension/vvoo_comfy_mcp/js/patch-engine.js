import { cloneJson, getCanvasState, getRootGraph } from "./graph-state.js";
import { activateWorkflow } from "./workflow-runtime.js";

export class CanvasError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CanvasError";
    this.code = code;
    this.details = details;
  }
}

function assertRootCanvas(app) {
  const graph = getRootGraph(app);
  if (app.canvas?.graph !== undefined && app.canvas.graph !== graph) {
    throw new CanvasError(
      "SUBGRAPH_UNSUPPORTED",
      "Canvas writes are allowed only while the root graph is visible",
    );
  }
}

async function assertRevision(app, expectedRevision) {
  const state = await getCanvasState(app);
  if (state.revision !== expectedRevision) {
    throw new CanvasError("REVISION_CONFLICT", "Canvas revision has changed", {
      expected_revision: expectedRevision,
      current_revision: state.revision,
    });
  }
  return state;
}

function resolveNode(graph, refs, selector) {
  let node;
  if (selector?.ref !== undefined) {
    node = refs.get(selector.ref);
  } else if (selector?.id !== undefined) {
    node = graph.getNodeById(selector.id);
  }
  if (!node) {
    throw new CanvasError("NODE_NOT_FOUND", "Canvas node was not found", {
      node: cloneJson(selector),
    });
  }
  return node;
}

function resolveSlot(node, direction, selector) {
  const slots = direction === "output" ? node.outputs ?? [] : node.inputs ?? [];
  const index =
    typeof selector === "number"
      ? selector
      : slots.findIndex((slot) => slot.name === selector);
  if (!Number.isSafeInteger(index) || index < 0 || index >= slots.length) {
    throw new CanvasError("SLOT_NOT_FOUND", "Node slot was not found", {
      node_id: node.id,
      direction,
      slot: selector,
    });
  }
  return index;
}

async function setWidget(node, name, value) {
  const widget = (node.widgets ?? []).find((candidate) => candidate.name === name);
  if (!widget) {
    throw new CanvasError("WIDGET_NOT_FOUND", "Node widget was not found", {
      node_id: node.id,
      widget: name,
    });
  }
  widget.value = cloneJson(value);
  if (typeof widget.callback === "function") {
    await widget.callback(widget.value, node, widget);
  }
}

function markDirty(app) {
  const graph = getRootGraph(app);
  if (typeof graph?.setDirtyCanvas === "function") {
    graph.setDirtyCanvas(true, true);
  } else if (typeof app.canvas?.setDirty === "function") {
    app.canvas.setDirty(true, true);
  }
}

function captureActiveWorkflow(app) {
  const tracker = app.extensionManager?.workflow?.activeWorkflow?.changeTracker;
  tracker?.captureCanvasState?.();
}

async function loadIntoActiveWorkflow(app, workflow) {
  const activeWorkflow = app.extensionManager?.workflow?.activeWorkflow;
  const tracker = activeWorkflow?.changeTracker;
  const previousRestoringState = tracker?._restoringState;
  const previousState =
    tracker?.activeState === undefined
      ? undefined
      : cloneJson(tracker.activeState);
  let loaded;
  if (tracker) tracker._restoringState = true;
  try {
    if (!activeWorkflow) {
      loaded = await app.loadGraphData(cloneJson(workflow));
    } else {
      loaded = await app.loadGraphData(
        cloneJson(workflow),
        true,
        true,
        activeWorkflow,
        {
          checkForRerouteMigration: false,
          deferWarnings: true,
          skipAssetScans: true,
        },
      );
    }
    if (loaded === false) {
      throw new CanvasError(
        "CANVAS_LOAD_FAILED",
        "ComfyUI did not load the requested workflow state",
      );
    }
    if (tracker) {
      tracker.activeState = cloneJson(workflow);
      tracker.updateModified?.(previousState);
    }
  } finally {
    if (tracker) tracker._restoringState = previousRestoringState ?? false;
  }
  return loaded;
}

async function rollback(app, workflow, backupId, error, fallbackCode) {
  try {
    await loadIntoActiveWorkflow(app, workflow);
  } catch (rollbackError) {
    throw new CanvasError(
      "PATCH_ROLLBACK_FAILED",
      "Canvas operation failed and the original workflow could not be restored",
      {
        backup_id: backupId,
        cause: error instanceof Error ? error.message : String(error),
        rollback_cause:
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError),
      },
    );
  }

  if (error instanceof CanvasError) {
    error.details = {
      ...error.details,
      backup_id: backupId,
      rolled_back: true,
    };
    throw error;
  }
  throw new CanvasError(
    fallbackCode,
    error instanceof Error ? error.message : String(error),
    { backup_id: backupId, rolled_back: true },
  );
}

function assertMassDeleteAllowed(graph, operations, confirmed) {
  const removals = new Set(
    operations
      .filter((operation) => operation.op === "remove_node")
      .map((operation) => JSON.stringify(operation.node)),
  ).size;
  const nodeCount = graph._nodes?.length ?? 0;
  if (nodeCount > 0 && removals >= nodeCount / 2 && !confirmed) {
    throw new CanvasError(
      "MASS_DELETE_CONFIRMATION_REQUIRED",
      "Removing at least half of the canvas nodes requires confirmation",
      { removal_count: removals, node_count: nodeCount },
    );
  }
}

async function applyOperation(context, refs, operation) {
  const { app, liteGraph } = context;
  const graph = getRootGraph(app);

  switch (operation.op) {
    case "add_node": {
      const node = liteGraph.createNode(operation.type);
      if (!node) {
        throw new CanvasError(
          "NODE_TYPE_NOT_FOUND",
          "ComfyUI node type was not found",
          { type: operation.type },
        );
      }
      if (operation.position !== undefined) node.pos = [...operation.position];
      if (operation.size !== undefined) node.setSize?.([...operation.size]);
      if (operation.title !== undefined) node.title = operation.title;
      if (operation.mode !== undefined) node.mode = operation.mode;
      if (operation.color !== undefined) node.color = operation.color;
      if (operation.bgcolor !== undefined) node.bgcolor = operation.bgcolor;
      if (operation.collapsed !== undefined) {
        node.flags = { ...(node.flags ?? {}), collapsed: operation.collapsed };
      }
      if (operation.properties !== undefined) {
        node.properties = {
          ...(node.properties ?? {}),
          ...cloneJson(operation.properties),
        };
      }
      graph.add(node);
      if (operation.ref !== undefined) refs.set(operation.ref, node);
      for (const [name, value] of Object.entries(operation.widgets ?? {})) {
        await setWidget(node, name, value);
      }
      return;
    }
    case "remove_node": {
      graph.remove(resolveNode(graph, refs, operation.node));
      return;
    }
    case "move_node": {
      resolveNode(graph, refs, operation.node).pos = [...operation.position];
      return;
    }
    case "resize_node": {
      const node = resolveNode(graph, refs, operation.node);
      if (typeof node.setSize === "function") node.setSize([...operation.size]);
      else node.size = [...operation.size];
      return;
    }
    case "set_widget": {
      await setWidget(
        resolveNode(graph, refs, operation.node),
        operation.widget,
        operation.value,
      );
      return;
    }
    case "set_title": {
      resolveNode(graph, refs, operation.node).title = operation.title;
      return;
    }
    case "set_properties": {
      const node = resolveNode(graph, refs, operation.node);
      node.properties = {
        ...(node.properties ?? {}),
        ...cloneJson(operation.properties),
      };
      return;
    }
    case "set_mode": {
      resolveNode(graph, refs, operation.node).mode = operation.mode;
      return;
    }
    case "set_colors": {
      const node = resolveNode(graph, refs, operation.node);
      if (Object.hasOwn(operation, "color")) node.color = operation.color;
      if (Object.hasOwn(operation, "bgcolor")) node.bgcolor = operation.bgcolor;
      return;
    }
    case "set_collapsed": {
      const node = resolveNode(graph, refs, operation.node);
      node.flags = { ...(node.flags ?? {}), collapsed: operation.collapsed };
      return;
    }
    case "connect": {
      const source = resolveNode(graph, refs, operation.source);
      const target = resolveNode(graph, refs, operation.target);
      const sourceSlot = resolveSlot(source, "output", operation.source_slot);
      const targetSlot = resolveSlot(target, "input", operation.target_slot);
      const result = source.connect(sourceSlot, target, targetSlot);
      if (result === false || result == null) {
        throw new CanvasError(
          "CONNECTION_REJECTED",
          "ComfyUI rejected the requested node connection",
          {
            source_node: source.id,
            source_slot: sourceSlot,
            target_node: target.id,
            target_slot: targetSlot,
          },
        );
      }
      return;
    }
    case "disconnect": {
      const target = resolveNode(graph, refs, operation.target);
      const targetSlot = resolveSlot(target, "input", operation.target_slot);
      target.disconnectInput(targetSlot);
      return;
    }
    default:
      throw new CanvasError("UNKNOWN_OPERATION", "Unknown canvas operation", {
        operation: operation.op,
      });
  }
}

async function activateRequestedWorkflow(context, request) {
  if (request.workflow_id !== undefined) {
    await activateWorkflow(context, request.workflow_id);
  }
}

function activeWorkflowIdentity(app) {
  return app.extensionManager?.workflow?.activeWorkflow ?? getRootGraph(app);
}

export async function applyPatchTransaction(context, request) {
  const { app, snapshots } = context;
  await activateRequestedWorkflow(context, request);
  assertRootCanvas(app);
  const before = await assertRevision(app, request.expected_revision);
  assertMassDeleteAllowed(
    getRootGraph(app),
    request.operations,
    request.confirm_mass_delete === true,
  );
  const backupId = snapshots.add(before.workflow, activeWorkflowIdentity(app));
  const refs = new Map();

  try {
    for (const operation of request.operations) {
      await applyOperation(context, refs, operation);
    }
    captureActiveWorkflow(app);
    markDirty(app);
    return {
      ...(await getCanvasState(app)),
      backup_id: backupId,
      refs: Object.fromEntries(
        [...refs.entries()].map(([ref, node]) => [ref, node.id]),
      ),
    };
  } catch (error) {
    return rollback(app, before.workflow, backupId, error, "PATCH_FAILED_ROLLED_BACK");
  }
}

export async function replaceWorkflowTransaction(context, request) {
  const { app, snapshots } = context;
  await activateRequestedWorkflow(context, request);
  assertRootCanvas(app);
  if (request.confirm_replace !== true) {
    throw new CanvasError(
      "REPLACE_CONFIRMATION_REQUIRED",
      "Replacing the entire canvas requires confirmation",
    );
  }
  const before = await assertRevision(app, request.expected_revision);
  const backupId = snapshots.add(before.workflow, activeWorkflowIdentity(app));
  try {
    await loadIntoActiveWorkflow(app, request.workflow);
    markDirty(app);
    return { ...(await getCanvasState(app)), backup_id: backupId };
  } catch (error) {
    return rollback(app, before.workflow, backupId, error, "CANVAS_LOAD_FAILED");
  }
}

export async function restoreSnapshotTransaction(context, request) {
  const { app, snapshots } = context;
  await activateRequestedWorkflow(context, request);
  assertRootCanvas(app);
  const before = await assertRevision(app, request.expected_revision);
  const target = snapshots.get(request.backup_id);
  if (target === undefined) {
    throw new CanvasError("BACKUP_NOT_FOUND", "Canvas snapshot was not found", {
      backup_id: request.backup_id,
    });
  }
  const activeIdentity = activeWorkflowIdentity(app);
  if (target.workflow_ref !== activeIdentity) {
    throw new CanvasError(
      "SNAPSHOT_WORKFLOW_MISMATCH",
      "Canvas snapshot belongs to a different workflow tab",
      {
        backup_id: request.backup_id,
        snapshot_workflow_id: target.workflow_id,
        active_workflow_id: activeIdentity?.path ?? null,
      },
    );
  }
  const backupId = snapshots.add(before.workflow, activeIdentity);
  try {
    await loadIntoActiveWorkflow(app, target.workflow);
    markDirty(app);
    return {
      ...(await getCanvasState(app)),
      backup_id: backupId,
      restored_backup_id: request.backup_id,
    };
  } catch (error) {
    return rollback(app, before.workflow, backupId, error, "CANVAS_LOAD_FAILED");
  }
}
