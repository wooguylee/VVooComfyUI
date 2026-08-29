import { ComfyMcpError, isComfyMcpError } from "./errors.js";

export interface ComfyHttpClientOptions {
  baseUrl: URL;
  timeoutMs: number;
}

export interface QueuePromptPayload {
  prompt: Record<string, unknown>;
  client_id?: string;
  extra_data?: Record<string, unknown>;
  front?: boolean;
  number?: number;
}

export interface QueuePromptResponse {
  prompt_id: string;
  number?: number;
  node_errors?: Record<string, unknown>;
}

function parseResponseBody(text: string): unknown {
  if (text === "") {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

export class ComfyHttpClient {
  public constructor(private readonly options: ComfyHttpClientOptions) {}

  public async requestJson<T = unknown>(
    route: string,
    init: RequestInit = {},
  ): Promise<T> {
    const url = new URL(route.replace(/^\//, ""), this.options.baseUrl);
    const headers = new Headers(init.headers);
    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(this.options.timeoutMs),
      });
      const text = await response.text();
      const body = parseResponseBody(text);

      if (!response.ok) {
        throw new ComfyMcpError(
          "COMFY_HTTP_ERROR",
          `ComfyUI returned HTTP ${response.status} for ${route}`,
          { status: response.status, body },
        );
      }
      if (text !== "" && typeof body === "string") {
        throw new ComfyMcpError(
          "COMFY_INVALID_JSON",
          `ComfyUI returned invalid JSON for ${route}`,
          { body },
        );
      }

      return body as T;
    } catch (error) {
      if (isComfyMcpError(error)) {
        throw error;
      }
      if (isTimeoutError(error)) {
        throw new ComfyMcpError(
          "COMFY_TIMEOUT",
          `ComfyUI request timed out after ${this.options.timeoutMs}ms`,
        );
      }
      throw new ComfyMcpError(
        "COMFY_UNAVAILABLE",
        `Unable to reach ComfyUI at ${this.options.baseUrl.href}`,
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  public getSystemStats<T = unknown>(): Promise<T> {
    return this.requestJson<T>("/system_stats");
  }

  public getQueue<T = unknown>(): Promise<T> {
    return this.requestJson<T>("/queue");
  }

  public getObjectInfo<T = unknown>(nodeClass?: string): Promise<T> {
    return this.requestJson<T>(
      nodeClass === undefined
        ? "/object_info"
        : `/object_info/${encodeURIComponent(nodeClass)}`,
    );
  }

  public getHistory<T = unknown>(promptId?: string): Promise<T> {
    return this.requestJson<T>(
      promptId === undefined
        ? "/history"
        : `/history/${encodeURIComponent(promptId)}`,
    );
  }

  public queuePrompt(
    payload: QueuePromptPayload,
  ): Promise<QueuePromptResponse> {
    return this.requestJson<QueuePromptResponse>("/prompt", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  public interrupt(): Promise<void> {
    return this.requestJson<void>("/interrupt", { method: "POST" });
  }
}
