import { readFile } from "node:fs/promises";

import {
  BridgeFailureSchema,
  BridgeSuccessSchema,
  type CanvasCommand,
} from "./canvas-protocol.js";
import { ComfyHttpClient } from "./comfy-http-client.js";
import { ComfyMcpError, isComfyMcpError } from "./errors.js";

export interface BridgeClientOptions {
  baseUrl: URL;
  tokenPath: string;
  timeoutMs: number;
}

export interface BridgeCommandResult<T = unknown> {
  request_id?: string;
  session_id?: string;
  result: T;
}

interface HttpErrorDetails {
  status?: number;
  body?: unknown;
}

function bridgeErrorFromPayload(payload: unknown): ComfyMcpError | undefined {
  const parsed = BridgeFailureSchema.safeParse(payload);
  if (!parsed.success) {
    return undefined;
  }
  const { code, message, details } = parsed.data.error;
  return details === undefined
    ? new ComfyMcpError(code, message)
    : new ComfyMcpError(code, message, details);
}

export class BridgeClient {
  private readonly http: ComfyHttpClient;
  private tokenPromise?: Promise<string>;

  public constructor(private readonly options: BridgeClientOptions) {
    this.http = new ComfyHttpClient({
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
    });
  }

  private async getToken(): Promise<string> {
    this.tokenPromise ??= readFile(this.options.tokenPath, "utf8")
      .then((value) => value.trim())
      .then((value) => {
        if (!value) {
          throw new ComfyMcpError(
            "BRIDGE_TOKEN_MISSING",
            `Canvas bridge token is empty at ${this.options.tokenPath}`,
          );
        }
        return value;
      })
      .catch((error: unknown) => {
        if (isComfyMcpError(error)) {
          throw error;
        }
        throw new ComfyMcpError(
          "BRIDGE_TOKEN_MISSING",
          `Canvas bridge token was not found at ${this.options.tokenPath}`,
        );
      });
    return this.tokenPromise;
  }

  private async requestBridge<T>(
    route: string,
    init: RequestInit = {},
  ): Promise<BridgeCommandResult<T>> {
    const token = await this.getToken();
    let payload: unknown;
    try {
      payload = await this.http.requestJson(route, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers).entries()),
          authorization: `Bearer ${token}`,
        },
      });
    } catch (error) {
      if (isComfyMcpError(error) && error.code === "COMFY_HTTP_ERROR") {
        const details = error.details as HttpErrorDetails | undefined;
        const bridgeError = bridgeErrorFromPayload(details?.body);
        if (bridgeError) {
          throw bridgeError;
        }
      }
      if (isComfyMcpError(error) && error.code === "COMFY_TIMEOUT") {
        throw new ComfyMcpError(
          "BRIDGE_TIMEOUT",
          `Canvas bridge request timed out after ${this.options.timeoutMs}ms`,
        );
      }
      throw error;
    }

    const bridgeFailure = bridgeErrorFromPayload(payload);
    if (bridgeFailure) {
      throw bridgeFailure;
    }

    const parsed = BridgeSuccessSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ComfyMcpError(
        "BRIDGE_PROTOCOL_ERROR",
        `Canvas bridge returned an invalid response for ${route}`,
        { issues: parsed.error.issues },
      );
    }

    const result: BridgeCommandResult<T> = {
      result: parsed.data.result as T,
    };
    if (parsed.data.request_id !== undefined) {
      result.request_id = parsed.data.request_id;
    }
    if (parsed.data.session_id !== undefined) {
      result.session_id = parsed.data.session_id;
    }
    return result;
  }

  public async listSessions<T = unknown>(): Promise<T> {
    const response = await this.requestBridge<T>("/vvoo_mcp/sessions");
    return response.result;
  }

  public command<T = unknown>(
    command: CanvasCommand,
  ): Promise<BridgeCommandResult<T>> {
    return this.requestBridge<T>("/vvoo_mcp/command", {
      method: "POST",
      body: JSON.stringify(command),
    });
  }
}
