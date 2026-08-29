import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BridgeClient } from "../../src/bridge-client.js";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const servers: http.Server[] = [];
const tempDirectories: string[] = [];

async function startServer(handler: Handler): Promise<URL> {
  const server = http.createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an IPv4 test server address");
  }
  return new URL(`http://127.0.0.1:${address.port}/`);
}

async function createTokenFile(value = "secret-token\n"): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vvoo-bridge-"));
  tempDirectories.push(directory);
  const tokenPath = path.join(directory, "bridge-token");
  await writeFile(tokenPath, value, "utf8");
  return tokenPath;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? undefined : (JSON.parse(text) as unknown);
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("BridgeClient", () => {
  it("trims the token and authenticates a session-list request", async () => {
    const received: { method?: string; authorization?: string } = {};
    const baseUrl = await startServer((request, response) => {
      received.method = request.method;
      received.authorization = request.headers.authorization;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          result: { sessions: [{ client_id: "canvas-a" }] },
        }),
      );
    });
    const tokenPath = await createTokenFile();
    const client = new BridgeClient({ baseUrl, tokenPath, timeoutMs: 1000 });

    await expect(client.listSessions()).resolves.toEqual({
      sessions: [{ client_id: "canvas-a" }],
    });
    expect(received).toEqual({
      method: "GET",
      authorization: "Bearer secret-token",
    });
  });

  it("sends and parses a canvas command", async () => {
    let receivedBody: unknown;
    const baseUrl = await startServer(async (request, response) => {
      receivedBody = await readBody(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          request_id: "request-1",
          session_id: "canvas-a",
          result: { revision: "b".repeat(64) },
        }),
      );
    });
    const tokenPath = await createTokenFile();
    const client = new BridgeClient({ baseUrl, tokenPath, timeoutMs: 1000 });
    const command = {
      session_id: "canvas-a",
      command: "canvas.get" as const,
      payload: {},
      timeout_ms: 1000,
    };

    await expect(client.command(command)).resolves.toEqual({
      request_id: "request-1",
      session_id: "canvas-a",
      result: { revision: "b".repeat(64) },
    });
    expect(receivedBody).toEqual(command);
  });

  it("preserves a structured bridge error returned with non-2xx status", async () => {
    const baseUrl = await startServer((_request, response) => {
      response.writeHead(409, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: false,
          error: {
            code: "REVISION_CONFLICT",
            message: "The canvas changed",
            details: { current_revision: "c".repeat(64) },
          },
        }),
      );
    });
    const tokenPath = await createTokenFile();
    const client = new BridgeClient({ baseUrl, tokenPath, timeoutMs: 1000 });

    await expect(
      client.command({
        command: "canvas.get",
        payload: {},
        timeout_ms: 1000,
      }),
    ).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
      details: { current_revision: "c".repeat(64) },
    });
  });

  it("fails clearly when the token file is missing", async () => {
    const baseUrl = await startServer((_request, response) => response.end());
    const client = new BridgeClient({
      baseUrl,
      tokenPath: path.join(os.tmpdir(), "missing-vvoo-token"),
      timeoutMs: 1000,
    });

    await expect(client.listSessions()).rejects.toMatchObject({
      code: "BRIDGE_TOKEN_MISSING",
    });
  });

  it("rejects an empty token file", async () => {
    const baseUrl = await startServer((_request, response) => response.end());
    const tokenPath = await createTokenFile("  \r\n");
    const client = new BridgeClient({ baseUrl, tokenPath, timeoutMs: 1000 });

    await expect(client.listSessions()).rejects.toMatchObject({
      code: "BRIDGE_TOKEN_MISSING",
    });
  });

  it("reports a malformed bridge response", async () => {
    const baseUrl = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ unexpected: true }));
    });
    const tokenPath = await createTokenFile();
    const client = new BridgeClient({ baseUrl, tokenPath, timeoutMs: 1000 });

    await expect(client.listSessions()).rejects.toMatchObject({
      code: "BRIDGE_PROTOCOL_ERROR",
    });
  });

  it("maps HTTP timeout to BRIDGE_TIMEOUT", async () => {
    const baseUrl = await startServer(() => undefined);
    const tokenPath = await createTokenFile();
    const client = new BridgeClient({ baseUrl, tokenPath, timeoutMs: 20 });

    await expect(client.listSessions()).rejects.toMatchObject({
      code: "BRIDGE_TIMEOUT",
    });
  });
});
