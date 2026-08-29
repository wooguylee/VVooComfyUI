export class ComfyMcpError extends Error {
  public readonly name = "ComfyMcpError";

  public constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function isComfyMcpError(error: unknown): error is ComfyMcpError {
  return error instanceof ComfyMcpError;
}

export function serializeError(error: unknown): {
  code: string;
  message: string;
  details?: unknown;
} {
  if (isComfyMcpError(error)) {
    return error.details === undefined
      ? { code: error.code, message: error.message }
      : { code: error.code, message: error.message, details: error.details };
  }

  return {
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}
