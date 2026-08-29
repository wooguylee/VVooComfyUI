import { z } from "zod";

const JsonValueSchema = z.json();
const RevisionSchema = z
  .string()
  .regex(
    /^[a-f0-9]{64}$/,
    "expected_revision must be a lowercase SHA-256 revision",
  );
const CoordinateSchema = z.number().finite();
const PositiveDimensionSchema = z.number().finite().positive();
const PositionSchema = z.tuple([CoordinateSchema, CoordinateSchema]);
const SizeSchema = z.tuple([PositiveDimensionSchema, PositiveDimensionSchema]);
const NodeModeSchema = z.number().int().min(0).max(4);
const NodeColorSchema = z.string().min(1).nullable();
const WorkflowIdSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      value.startsWith("workflows/") &&
      value.toLowerCase().endsWith(".json") &&
      !value.includes("\\") &&
      !value.split("/").some((segment) =>
        segment.length === 0 || segment === "." || segment === ".."
      ),
    "workflow_id must be a safe workflows/...json path",
  );
const WorkflowFilenameSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.includes("/") &&
      !value.includes("\\") &&
      value !== "." &&
      value !== "..",
    "filename must be a plain file name",
  );

export const NodeReferenceSchema = z.union([
  z.object({ id: z.union([z.number().int().nonnegative(), z.string().min(1)]) }).strict(),
  z.object({ ref: z.string().min(1) }).strict(),
]);

export const SlotReferenceSchema = z.union([
  z.number().int().nonnegative(),
  z.string().min(1),
]);

const AddNodeOperationSchema = z
  .object({
    op: z.literal("add_node"),
    type: z.string().min(1),
    ref: z.string().min(1),
    position: PositionSchema.optional(),
    size: SizeSchema.optional(),
    title: z.string().optional(),
    widgets: z.record(z.string(), JsonValueSchema).optional(),
    properties: z.record(z.string(), JsonValueSchema).optional(),
    mode: NodeModeSchema.optional(),
    color: NodeColorSchema.optional(),
    bgcolor: NodeColorSchema.optional(),
    collapsed: z.boolean().optional(),
  })
  .strict();

export const PatchOperationSchema = z.discriminatedUnion("op", [
  AddNodeOperationSchema,
  z.object({ op: z.literal("remove_node"), node: NodeReferenceSchema }).strict(),
  z
    .object({
      op: z.literal("move_node"),
      node: NodeReferenceSchema,
      position: PositionSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("set_mode"),
      node: NodeReferenceSchema,
      mode: NodeModeSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("set_colors"),
      node: NodeReferenceSchema,
      color: NodeColorSchema.optional(),
      bgcolor: NodeColorSchema.optional(),
    })
    .strict()
    .refine(
      (value) => value.color !== undefined || value.bgcolor !== undefined,
      "set_colors requires color or bgcolor",
    ),
  z
    .object({
      op: z.literal("set_collapsed"),
      node: NodeReferenceSchema,
      collapsed: z.boolean(),
    })
    .strict(),
  z
    .object({
      op: z.literal("resize_node"),
      node: NodeReferenceSchema,
      size: SizeSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("set_widget"),
      node: NodeReferenceSchema,
      widget: z.string().min(1),
      value: JsonValueSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("set_title"),
      node: NodeReferenceSchema,
      title: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.literal("set_properties"),
      node: NodeReferenceSchema,
      properties: z.record(z.string(), JsonValueSchema),
    })
    .strict(),
  z
    .object({
      op: z.literal("connect"),
      source: NodeReferenceSchema,
      source_slot: SlotReferenceSchema,
      target: NodeReferenceSchema,
      target_slot: SlotReferenceSchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("disconnect"),
      target: NodeReferenceSchema,
      target_slot: SlotReferenceSchema,
    })
    .strict(),
]);

const ToolAddNodeOperationSchema = AddNodeOperationSchema.omit({ type: true })
  .extend({ node_type: z.string().min(1) })
  .strict();

const ToolPatchOperationSchema = z.discriminatedUnion("op", [
  ToolAddNodeOperationSchema,
  ...PatchOperationSchema.options.slice(1),
]);

const SessionIdSchema = z.string().min(1).optional();

const applyPatchPayloadShape = {
  workflow_id: WorkflowIdSchema.optional(),
  expected_revision: RevisionSchema,
  operations: z.array(PatchOperationSchema).min(1),
  confirm_mass_delete: z.boolean().default(false),
};

function rejectDuplicateNodeRefs(
  value: { operations: Array<{ op: string; ref?: string }> },
  context: z.RefinementCtx,
): void {
    const refs = new Set<string>();
    value.operations.forEach((operation, index) => {
      if (operation.op !== "add_node" || operation.ref === undefined) {
        return;
      }
      if (refs.has(operation.ref)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate add_node ref: ${operation.ref}`,
          path: ["operations", index, "ref"],
        });
      }
      refs.add(operation.ref);
    });
}

const ApplyPatchPayloadSchema = z
  .object(applyPatchPayloadShape)
  .strict()
  .superRefine(rejectDuplicateNodeRefs);

export const ApplyPatchInputSchema = z
  .object({
    session_id: SessionIdSchema,
    workflow_id: WorkflowIdSchema.optional(),
    expected_revision: RevisionSchema,
    operations: z.array(ToolPatchOperationSchema).min(1),
    confirm_mass_delete: z.boolean().default(false),
  })
  .strict()
  .superRefine(rejectDuplicateNodeRefs);

export const ReplaceCanvasInputSchema = z
  .object({
    session_id: SessionIdSchema,
    workflow_id: WorkflowIdSchema.optional(),
    expected_revision: RevisionSchema,
    workflow: JsonValueSchema,
    confirm_replace: z.literal(true, {
      error: "confirm_replace must be true to replace the canvas",
    }),
  })
  .strict();

export const RestoreCanvasInputSchema = z
  .object({
    session_id: SessionIdSchema,
    workflow_id: WorkflowIdSchema.optional(),
    expected_revision: RevisionSchema,
    backup_id: z.string().min(1),
  })
  .strict();

export const CanvasGetInputSchema = z
  .object({
    session_id: SessionIdSchema,
    workflow_id: WorkflowIdSchema.optional(),
  })
  .strict();

export const QueueCurrentInputSchema = z
  .object({
    session_id: SessionIdSchema,
    workflow_id: WorkflowIdSchema.optional(),
    front: z.boolean().optional(),
    number: z.number().finite().optional(),
  })
  .strict();

const WorkflowListPayloadSchema = z.object({}).strict();
const WorkflowTargetPayloadSchema = z
  .object({ workflow_id: WorkflowIdSchema })
  .strict();
const WorkflowCreatePayloadSchema = z
  .object({
    filename: WorkflowFilenameSchema.optional(),
    workflow: JsonValueSchema.optional(),
  })
  .strict();
const WorkflowSavePayloadSchema = z
  .object({
    workflow_id: WorkflowIdSchema,
    expected_revision: RevisionSchema,
  })
  .strict();
const WorkflowRenamePayloadSchema = z
  .object({
    workflow_id: WorkflowIdSchema,
    new_path: WorkflowIdSchema,
  })
  .strict();
const WorkflowClosePayloadSchema = z
  .object({
    workflow_id: WorkflowIdSchema,
    confirm_discard: z.boolean().default(false),
  })
  .strict();
const WorkflowReorderPayloadSchema = z
  .object({
    workflow_id: WorkflowIdSchema,
    index: z.number().int().nonnegative(),
  })
  .strict();
const CanvasFocusPayloadSchema = z
  .object({
    workflow_id: WorkflowIdSchema.optional(),
    node_ids: z
      .array(z.union([z.number().int().nonnegative(), z.string().min(1)]))
      .default([]),
    select: z.boolean().default(true),
    fit: z.enum(["selection", "all"]).default("selection"),
  })
  .strict()
  .refine(
    (value) => value.fit === "all" || value.node_ids.length > 0,
    "node_ids are required when fit is selection",
  );

export const WorkflowListInputSchema = z
  .object({ session_id: SessionIdSchema })
  .strict();
export const WorkflowGetInputSchema = z
  .object({ session_id: SessionIdSchema, workflow_id: WorkflowIdSchema })
  .strict();
export const WorkflowSelectInputSchema = WorkflowGetInputSchema;
export const WorkflowCreateInputSchema = z
  .object({
    session_id: SessionIdSchema,
    filename: WorkflowFilenameSchema.optional(),
    workflow: JsonValueSchema.optional(),
  })
  .strict();
export const WorkflowSaveInputSchema = z
  .object({
    session_id: SessionIdSchema,
    workflow_id: WorkflowIdSchema,
    expected_revision: RevisionSchema,
  })
  .strict();
export const WorkflowRenameInputSchema = z
  .object({
    session_id: SessionIdSchema,
    workflow_id: WorkflowIdSchema,
    new_path: WorkflowIdSchema,
  })
  .strict();
export const WorkflowCloseInputSchema = z
  .object({
    session_id: SessionIdSchema,
    workflow_id: WorkflowIdSchema,
    confirm_discard: z.boolean().default(false),
  })
  .strict();
export const WorkflowReorderInputSchema = z
  .object({
    session_id: SessionIdSchema,
    workflow_id: WorkflowIdSchema,
    index: z.number().int().nonnegative(),
  })
  .strict();
export const CanvasFocusInputSchema = z
  .object({
    session_id: SessionIdSchema,
    workflow_id: WorkflowIdSchema.optional(),
    node_ids: z
      .array(z.union([z.number().int().nonnegative(), z.string().min(1)]))
      .default([]),
    select: z.boolean().default(true),
    fit: z.enum(["selection", "all"]).default("selection"),
  })
  .strict()
  .refine(
    (value) => value.fit === "all" || value.node_ids.length > 0,
    "node_ids are required when fit is selection",
  );

export const NodeTypesInputSchema = z
  .object({ node_class: z.string().min(1).optional() })
  .strict();

export const HistoryInputSchema = z
  .object({ prompt_id: z.string().min(1).optional() })
  .strict();

const CommandTimeoutSchema = z.number().int().min(100).max(120_000);
const commandBase = {
  session_id: z.string().min(1).optional(),
  timeout_ms: CommandTimeoutSchema,
};

export const CanvasCommandSchema = z.discriminatedUnion("command", [
  z
    .object({
      ...commandBase,
      command: z.literal("canvas.get"),
      payload: z.object({ workflow_id: WorkflowIdSchema.optional() }).strict(),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      command: z.literal("canvas.apply_patch"),
      payload: ApplyPatchPayloadSchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      command: z.literal("canvas.replace"),
      payload: ReplaceCanvasInputSchema.omit({ session_id: true }),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      command: z.literal("canvas.restore"),
      payload: RestoreCanvasInputSchema.omit({ session_id: true }),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      command: z.literal("canvas.to_prompt"),
      payload: z.object({ workflow_id: WorkflowIdSchema.optional() }).strict(),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      command: z.literal("canvas.focus"),
      payload: CanvasFocusPayloadSchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      command: z.literal("workflow.list"),
      payload: WorkflowListPayloadSchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      command: z.literal("workflow.get"),
      payload: WorkflowTargetPayloadSchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      command: z.literal("workflow.select"),
      payload: WorkflowTargetPayloadSchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      command: z.literal("workflow.create"),
      payload: WorkflowCreatePayloadSchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      command: z.literal("workflow.save"),
      payload: WorkflowSavePayloadSchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      command: z.literal("workflow.rename"),
      payload: WorkflowRenamePayloadSchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      command: z.literal("workflow.close"),
      payload: WorkflowClosePayloadSchema,
    })
    .strict(),
  z
    .object({
      ...commandBase,
      command: z.literal("workflow.reorder"),
      payload: WorkflowReorderPayloadSchema,
    })
    .strict(),
]);

export const BridgeSuccessSchema = z
  .object({
    ok: z.literal(true),
    request_id: z.string().min(1).optional(),
    session_id: z.string().min(1).optional(),
    result: z.unknown(),
  })
  .passthrough();

export const BridgeFailureSchema = z
  .object({
    ok: z.literal(false),
    request_id: z.string().min(1).optional(),
    error: z.object({
      code: z.string().min(1),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .passthrough();

export type NodeReference = z.infer<typeof NodeReferenceSchema>;
export type SlotReference = z.infer<typeof SlotReferenceSchema>;
export type PatchOperation = z.infer<typeof PatchOperationSchema>;
export type ApplyPatchInput = z.input<typeof ApplyPatchInputSchema>;
export type ReplaceCanvasInput = z.infer<typeof ReplaceCanvasInputSchema>;
export type RestoreCanvasInput = z.infer<typeof RestoreCanvasInputSchema>;
export type CanvasCommand = z.infer<typeof CanvasCommandSchema>;
