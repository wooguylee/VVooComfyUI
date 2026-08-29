import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

import {
  dispatchCanvasCommand,
  serializeCommandError,
} from "./canvas-runtime.js";
import { SnapshotStore } from "./graph-state.js";

const EXTENSION_NAME = "VVoo.ComfyMCP.CanvasBridge";
const PROTOCOL_VERSION = 1;
const HEARTBEAT_INTERVAL_MS = 5_000;
const CLIENT_ID_WAIT_MS = 10_000;

const state = {
  clientId: null,
  sessionToken: null,
  registrationPromise: null,
  commandChain: Promise.resolve(),
};

const context = {
  app,
  liteGraph: globalThis.LiteGraph,
  snapshots: new SnapshotStore(10),
};

function metadata() {
  return {
    protocol_version: PROTOCOL_VERSION,
    title: document.title,
    url: window.location.href,
    visible: document.visibilityState === "visible",
    focused: document.hasFocus(),
  };
}

async function postJson(route, body) {
  const response = await api.fetchApi(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || payload?.ok === false) {
    const error = new Error(
      payload?.error?.message ??
        `Canvas bridge request failed with HTTP ${response.status}`,
    );
    error.status = response.status;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload;
}

async function waitForClientId() {
  const deadline = Date.now() + CLIENT_ID_WAIT_MS;
  while (!api.clientId && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!api.clientId) {
    throw new Error("ComfyUI WebSocket client ID was not assigned");
  }
  return api.clientId;
}

async function registerSession() {
  const clientId = await waitForClientId();
  const response = await postJson("/vvoo_mcp/frontend/register", {
    client_id: clientId,
    ...metadata(),
  });
  if (
    response?.protocol_version !== PROTOCOL_VERSION ||
    typeof response?.session_token !== "string"
  ) {
    throw new Error("Canvas bridge returned an invalid registration response");
  }
  state.clientId = clientId;
  state.sessionToken = response.session_token;
}

async function ensureSession(force = false) {
  if (
    !force &&
    state.sessionToken &&
    state.clientId === api.clientId
  ) {
    return;
  }
  if (!state.registrationPromise) {
    state.registrationPromise = registerSession().finally(() => {
      state.registrationPromise = null;
    });
  }
  await state.registrationPromise;
}

async function heartbeat() {
  try {
    await ensureSession();
    await postJson("/vvoo_mcp/frontend/heartbeat", {
      client_id: state.clientId,
      session_token: state.sessionToken,
      ...metadata(),
    });
  } catch (error) {
    state.sessionToken = null;
    try {
      await ensureSession(true);
    } catch (registrationError) {
      console.warn(
        `[${EXTENSION_NAME}] session heartbeat failed`,
        error,
        registrationError,
      );
    }
  }
}

function protocolFailure(detail) {
  if (detail?.protocol_version !== PROTOCOL_VERSION) {
    return {
      code: "PROTOCOL_MISMATCH",
      message: `Canvas protocol ${String(detail?.protocol_version)} is not supported`,
      details: { supported_protocol_version: PROTOCOL_VERSION },
    };
  }
  if (
    typeof detail?.request_id !== "string" ||
    typeof detail?.command !== "string" ||
    detail?.payload === null ||
    typeof detail?.payload !== "object"
  ) {
    return {
      code: "BRIDGE_PROTOCOL_ERROR",
      message: "Canvas command envelope is invalid",
    };
  }
  return null;
}

async function postCommandResult(requestId, response) {
  await ensureSession();
  const body = {
    client_id: state.clientId,
    session_token: state.sessionToken,
    request_id: requestId,
    response,
  };
  try {
    await postJson("/vvoo_mcp/frontend/result", body);
  } catch (error) {
    if (error.status !== 401 && error.code !== "AUTH_FAILED") throw error;
    await ensureSession(true);
    await postJson("/vvoo_mcp/frontend/result", {
      ...body,
      client_id: state.clientId,
      session_token: state.sessionToken,
    });
  }
}

async function handleCommand(detail) {
  const invalid = protocolFailure(detail);
  const requestId =
    typeof detail?.request_id === "string" ? detail.request_id : null;
  if (!requestId) {
    console.warn(`[${EXTENSION_NAME}] ignored command without request_id`);
    return;
  }

  let response;
  if (invalid) {
    response = { ok: false, error: invalid };
  } else {
    try {
      response = {
        ok: true,
        result: await dispatchCanvasCommand(
          context,
          detail.command,
          detail.payload,
        ),
      };
    } catch (error) {
      response = { ok: false, error: serializeCommandError(error) };
    }
  }
  await postCommandResult(requestId, response);
}

app.registerExtension({
  name: EXTENSION_NAME,
  async setup() {
    if (!context.liteGraph) {
      throw new Error("LiteGraph is not available in this ComfyUI frontend");
    }

    api.addEventListener("vvoo.mcp.command", ({ detail }) => {
      state.commandChain = state.commandChain
        .then(() => handleCommand(detail))
        .catch((error) => {
          console.error(`[${EXTENSION_NAME}] command response failed`, error);
        });
    });
    api.addEventListener("reconnected", () => {
      state.sessionToken = null;
      void heartbeat();
    });
    window.addEventListener("focus", () => void heartbeat());
    window.addEventListener("blur", () => void heartbeat());
    document.addEventListener("visibilitychange", () => void heartbeat());
    window.setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);

    await ensureSession();
  },
});
