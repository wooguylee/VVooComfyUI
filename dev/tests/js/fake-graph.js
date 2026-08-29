export class FakeNode {
  constructor(type, definition = {}) {
    this.id = null;
    this.type = type;
    this.title = definition.title ?? type;
    this.pos = [0, 0];
    this.size = [200, 100];
    this.properties = {};
    this.inputs = (definition.inputs ?? []).map((slot) => ({
      name: slot.name,
      type: slot.type ?? "*",
      link: null,
    }));
    this.outputs = (definition.outputs ?? []).map((slot) => ({
      name: slot.name,
      type: slot.type ?? "*",
      links: [],
    }));
    this.widgets = (definition.widgets ?? []).map((widget) => ({
      name: widget.name,
      value: structuredClone(widget.value),
      options: structuredClone(widget.options ?? {}),
      callback: widget.callback,
    }));
    this.rejectConnections = definition.rejectConnections ?? false;
    this.graph = null;
  }

  setSize(size) {
    this.size = [...size];
  }

  connect(outputIndex, target, inputIndex) {
    if (this.rejectConnections || !this.graph || target.graph !== this.graph) {
      return false;
    }
    const output = this.outputs[outputIndex];
    const input = target.inputs[inputIndex];
    if (!output || !input) {
      return false;
    }
    if (
      output.type !== "*" &&
      input.type !== "*" &&
      output.type !== input.type
    ) {
      return false;
    }
    target.disconnectInput(inputIndex);
    const id = ++this.graph.lastLinkId;
    const link = {
      id,
      origin_id: this.id,
      origin_slot: outputIndex,
      target_id: target.id,
      target_slot: inputIndex,
      type: output.type,
    };
    this.graph.links[id] = link;
    output.links.push(id);
    input.link = id;
    return link;
  }

  disconnectInput(inputIndex) {
    const input = this.inputs[inputIndex];
    if (!input || input.link == null || !this.graph) {
      return false;
    }
    const link = this.graph.links[input.link];
    if (link) {
      const source = this.graph.getNodeById(link.origin_id);
      const output = source?.outputs[link.origin_slot];
      if (output) {
        output.links = output.links.filter((id) => id !== link.id);
      }
      delete this.graph.links[link.id];
    }
    input.link = null;
    return true;
  }

  serialize() {
    return {
      id: this.id,
      type: this.type,
      title: this.title,
      pos: [...this.pos],
      size: [...this.size],
      properties: structuredClone(this.properties),
      widgets_values: this.widgets.map((widget) => structuredClone(widget.value)),
      inputs: this.inputs.map((input) => ({ ...input })),
      outputs: this.outputs.map((output) => ({
        ...output,
        links: [...output.links],
      })),
    };
  }
}

export class FakeGraph {
  constructor(registry) {
    this.registry = registry;
    this._nodes = [];
    this.links = {};
    this.lastNodeId = 0;
    this.lastLinkId = 0;
    this.dirtyCalls = [];
  }

  add(node) {
    if (node.id == null) {
      node.id = ++this.lastNodeId;
    } else {
      this.lastNodeId = Math.max(this.lastNodeId, Number(node.id) || 0);
    }
    node.graph = this;
    this._nodes.push(node);
    return node;
  }

  getNodeById(id) {
    return this._nodes.find((node) => String(node.id) === String(id)) ?? null;
  }

  remove(node) {
    for (const link of Object.values(this.links)) {
      if (link.origin_id === node.id || link.target_id === node.id) {
        const target = this.getNodeById(link.target_id);
        if (target) {
          target.disconnectInput(link.target_slot);
        }
      }
    }
    this._nodes = this._nodes.filter((candidate) => candidate !== node);
    node.graph = null;
  }

  setDirtyCanvas(foreground, background) {
    this.dirtyCalls.push([foreground, background]);
  }

  serialize() {
    return {
      last_node_id: this.lastNodeId,
      last_link_id: this.lastLinkId,
      nodes: this._nodes.map((node) => node.serialize()),
      links: Object.values(this.links)
        .sort((left, right) => left.id - right.id)
        .map((link) => [
          link.id,
          link.origin_id,
          link.origin_slot,
          link.target_id,
          link.target_slot,
          link.type,
        ]),
      groups: [],
      config: {},
      extra: {},
      version: 0.4,
    };
  }

  load(workflow) {
    this._nodes = [];
    this.links = {};
    this.lastNodeId = 0;
    this.lastLinkId = 0;
    for (const serialized of workflow.nodes ?? []) {
      const node = new FakeNode(serialized.type, this.registry[serialized.type]);
      node.id = serialized.id;
      node.title = serialized.title;
      node.pos = [...serialized.pos];
      node.size = [...serialized.size];
      node.properties = structuredClone(serialized.properties ?? {});
      this.add(node);
      for (let index = 0; index < node.widgets.length; index += 1) {
        node.widgets[index].value = structuredClone(serialized.widgets_values?.[index]);
      }
    }
    for (const serializedLink of workflow.links ?? []) {
      const [id, originId, originSlot, targetId, targetSlot, type] = serializedLink;
      const source = this.getNodeById(originId);
      const target = this.getNodeById(targetId);
      const output = source?.outputs[originSlot];
      const input = target?.inputs[targetSlot];
      if (!source || !target || !output || !input) {
        throw new Error(`Cannot restore link ${id}`);
      }
      this.lastLinkId = Math.max(this.lastLinkId, id);
      this.links[id] = {
        id,
        origin_id: originId,
        origin_slot: originSlot,
        target_id: targetId,
        target_slot: targetSlot,
        type,
      };
      output.links.push(id);
      input.link = id;
    }
    this.lastNodeId = workflow.last_node_id ?? this.lastNodeId;
    this.lastLinkId = workflow.last_link_id ?? this.lastLinkId;
  }
}

export function createFixture() {
  const registry = {
    Source: {
      outputs: [{ name: "IMAGE", type: "IMAGE" }],
      widgets: [{ name: "seed", value: 1 }],
    },
    Target: {
      inputs: [{ name: "image", type: "IMAGE" }],
      widgets: [{ name: "prompt", value: "" }],
    },
    RejectingSource: {
      outputs: [{ name: "IMAGE", type: "IMAGE" }],
      rejectConnections: true,
    },
  };
  const graph = new FakeGraph(registry);
  const liteGraph = {
    createNode(type) {
      const definition = registry[type];
      return definition ? new FakeNode(type, definition) : null;
    },
  };
  const app = {
    graph,
    canvas: { graph, setDirty: (...args) => graph.setDirtyCanvas(...args) },
    async loadGraphData(workflow) {
      graph.load(structuredClone(workflow));
      this.canvas.graph = graph;
    },
    async graphToPrompt() {
      return { output: {}, workflow: graph.serialize() };
    },
  };
  return { app, graph, liteGraph, registry };
}
