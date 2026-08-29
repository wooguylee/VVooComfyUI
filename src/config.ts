import path from "node:path";

import { ComfyMcpError } from "./errors.js";

export interface AppConfig {
  baseUrl: URL;
  tokenPath: string;
  requestTimeoutMs: number;
  bridgeTimeoutMs: number;
}

function configurationError(message: string): ComfyMcpError {
  return new ComfyMcpError("INVALID_CONFIG", message);
}

export function assertLoopbackBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw configurationError("ComfyUI URL must be a valid loopback HTTP URL");
  }

  if (url.protocol !== "http:") {
    throw configurationError("ComfyUI URL must use HTTP on a loopback host");
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw configurationError("ComfyUI URL must use the 127.0.0.1 or localhost loopback host");
  }
  if (url.username || url.password) {
    throw configurationError("ComfyUI URL must not contain credentials");
  }
  if (url.pathname !== "/") {
    throw configurationError("ComfyUI URL must point to the server root");
  }
  if (url.search) {
    throw configurationError("ComfyUI URL must not contain a query string");
  }
  if (url.hash) {
    throw configurationError("ComfyUI URL must not contain a fragment");
  }

  return url;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw configurationError(`${name} timeout must be a positive integer`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const baseUrl = assertLoopbackBaseUrl(
    env.COMFY_BASE_URL ?? "http://127.0.0.1:8188",
  );

  let tokenPath = env.COMFY_BRIDGE_TOKEN_PATH;
  if (!tokenPath) {
    if (!env.LOCALAPPDATA) {
      throw configurationError(
        "LOCALAPPDATA is required when COMFY_BRIDGE_TOKEN_PATH is not set",
      );
    }
    tokenPath = path.join(env.LOCALAPPDATA, "VVooComfyUI", "bridge-token");
  }

  return {
    baseUrl,
    tokenPath,
    requestTimeoutMs: parsePositiveInteger(
      env.COMFY_REQUEST_TIMEOUT_MS,
      10_000,
      "ComfyUI request",
    ),
    bridgeTimeoutMs: parsePositiveInteger(
      env.COMFY_BRIDGE_TIMEOUT_MS,
      15_000,
      "Canvas bridge",
    ),
  };
}
