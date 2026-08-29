function normalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJson(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeJson(value[key])]),
    );
  }
  return value;
}

export function cloneJson(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export function canonicalJson(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Workflow must be JSON serializable");
  }
  return JSON.stringify(normalizeJson(JSON.parse(serialized)));
}

export function getRootGraph(app) {
  return app.rootGraph ?? app.graph;
}

export async function revisionForWorkflow(workflow) {
  const bytes = new TextEncoder().encode(canonicalJson(workflow));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export class SnapshotStore {
  constructor(limit = 10) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new TypeError("Snapshot limit must be a positive integer");
    }
    this.limit = limit;
    this.snapshots = new Map();
  }

  add(workflow, workflowRef = null) {
    const backupId = globalThis.crypto.randomUUID();
    this.snapshots.set(backupId, {
      workflow_id: workflowRef?.path ?? null,
      workflow_ref: workflowRef,
      workflow: cloneJson(workflow),
    });
    while (this.snapshots.size > this.limit) {
      const oldest = this.snapshots.keys().next().value;
      this.snapshots.delete(oldest);
    }
    return backupId;
  }

  get(backupId) {
    const snapshot = this.snapshots.get(backupId);
    if (snapshot === undefined) return undefined;
    return {
      workflow_id: snapshot.workflow_id,
      workflow_ref: snapshot.workflow_ref,
      workflow: cloneJson(snapshot.workflow),
    };
  }
}

function serializedLinks(workflow) {
  if (Array.isArray(workflow?.links)) {
    return workflow.links.map((link) => {
      if (Array.isArray(link)) {
        return {
          id: link[0],
          source_node: link[1],
          source_slot: link[2],
          target_node: link[3],
          target_slot: link[4],
          type: link[5],
        };
      }
      return {
        id: link.id,
        source_node: link.origin_id,
        source_slot: link.origin_slot,
        target_node: link.target_id,
        target_slot: link.target_slot,
        type: link.type,
      };
    });
  }
  return Object.values(workflow?.links ?? {}).map((link) => ({
    id: link.id,
    source_node: link.origin_id,
    source_slot: link.origin_slot,
    target_node: link.target_id,
    target_slot: link.target_slot,
    type: link.type,
  }));
}

export function summarizeSerializedWorkflow(workflow) {
  const nodes = [...(workflow?.nodes ?? [])]
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title ?? node.type,
      position: Array.from(node.pos ?? [0, 0]),
      size: Array.from(node.size ?? [0, 0]),
      mode: node.mode ?? 0,
      flags: cloneJson(node.flags ?? {}),
      color: node.color ?? null,
      bgcolor: node.bgcolor ?? null,
      collapsed: node.flags?.collapsed === true,
      widgets: cloneJson(node.widgets_values ?? []),
      properties: cloneJson(node.properties ?? {}),
    }));
  const links = serializedLinks(workflow).sort((left, right) =>
    String(left.id).localeCompare(String(right.id), undefined, { numeric: true }),
  );
  return { nodes, links };
}

export async function getSerializedWorkflowState(workflow) {
  const cloned = cloneJson(workflow);
  return {
    workflow: cloned,
    summary: summarizeSerializedWorkflow(cloned),
    revision: await revisionForWorkflow(cloned),
    root_canvas_visible: false,
  };
}

function graphLinks(graph) {
  if (graph.links instanceof Map) {
    return [...graph.links.values()];
  }
  return Object.values(graph.links ?? {});
}

function summarizeNode(node) {
  return {
    id: node.id,
    type: node.type,
    title: node.title ?? node.type,
    position: Array.from(node.pos ?? [0, 0]),
    size: Array.from(node.size ?? [0, 0]),
    mode: node.mode ?? 0,
    flags: cloneJson(node.flags ?? {}),
    color: node.color ?? null,
    bgcolor: node.bgcolor ?? null,
    collapsed: node.flags?.collapsed === true,
    widgets: Object.fromEntries(
      (node.widgets ?? []).map((widget) => [
        widget.name,
        cloneJson(widget.value),
      ]),
    ),
    properties: cloneJson(node.properties ?? {}),
  };
}

function summarizeLink(link) {
  return {
    id: link.id,
    source_node: link.origin_id,
    source_slot: link.origin_slot,
    target_node: link.target_id,
    target_slot: link.target_slot,
    type: link.type,
  };
}

export async function getCanvasState(app) {
  const graph = getRootGraph(app);
  if (!graph || typeof graph.serialize !== "function") {
    throw new TypeError("ComfyUI root graph is not available");
  }
  const workflow = cloneJson(graph.serialize());
  const nodes = [...(graph._nodes ?? [])]
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .map(summarizeNode);
  const links = graphLinks(graph)
    .sort((left, right) => Number(left.id) - Number(right.id))
    .map(summarizeLink);

  return {
    workflow,
    summary: { nodes, links },
    revision: await revisionForWorkflow(workflow),
    root_canvas_visible:
      app.canvas?.graph === undefined || app.canvas.graph === graph,
    workflow_id:
      app.extensionManager?.workflow?.activeWorkflow?.path ?? null,
  };
}
