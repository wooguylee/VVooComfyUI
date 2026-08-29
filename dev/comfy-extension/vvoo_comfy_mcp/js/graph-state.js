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

  add(workflow) {
    const backupId = globalThis.crypto.randomUUID();
    this.snapshots.set(backupId, cloneJson(workflow));
    while (this.snapshots.size > this.limit) {
      const oldest = this.snapshots.keys().next().value;
      this.snapshots.delete(oldest);
    }
    return backupId;
  }

  get(backupId) {
    const workflow = this.snapshots.get(backupId);
    return workflow === undefined ? undefined : cloneJson(workflow);
  }
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
  const graph = app.graph;
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
      app.canvas?.graph === undefined || app.canvas.graph === app.graph,
  };
}
