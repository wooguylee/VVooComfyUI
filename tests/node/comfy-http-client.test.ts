import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";

import { afterEach, describe, expect, it } from "vitest";

import { ComfyHttpClient } from "../../src/comfy-http-client.js";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const servers: http.Server[] = [];

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

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
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
});

describe("ComfyHttpClient", () => {
  it("parses a successful JSON response", async () => {
    const baseUrl = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ comfyui_version: "0.34.2" }));
    });
    const client = new ComfyHttpClient({ baseUrl, timeoutMs: 1000 });

    await expect(client.requestJson("/system_stats")).resolves.toEqual({
      comfyui_version: "0.34.2",
    });
  });

  it("preserves status and JSON body for non-success responses", async () => {
    const baseUrl = await startServer((_request, response) => {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "invalid prompt" }));
    });
    const client = new ComfyHttpClient({ baseUrl, timeoutMs: 1000 });

    await expect(client.requestJson("/prompt")).rejects.toMatchObject({
      code: "COMFY_HTTP_ERROR",
      details: { status: 400, body: { error: "invalid prompt" } },
    });
  });

  it("reports invalid JSON separately", async () => {
    const baseUrl = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("not-json");
    });
    const client = new ComfyHttpClient({ baseUrl, timeoutMs: 1000 });

    await expect(client.requestJson("/system_stats")).rejects.toMatchObject({
      code: "COMFY_INVALID_JSON",
    });
  });

  it("converts request expiry into COMFY_TIMEOUT", async () => {
    const baseUrl = await startServer(() => undefined);
    const client = new ComfyHttpClient({ baseUrl, timeoutMs: 20 });

    await expect(client.requestJson("/slow")).rejects.toMatchObject({
      code: "COMFY_TIMEOUT",
    });
  });

  it("submits the exact prompt payload", async () => {
    let received: { method?: string; body?: unknown } = {};
    const baseUrl = await startServer(async (request, response) => {
      received = {
        method: request.method,
        body: JSON.parse(await readBody(request)) as unknown,
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ prompt_id: "prompt-1" }));
    });
    const client = new ComfyHttpClient({ baseUrl, timeoutMs: 1000 });
    const payload = {
      prompt: { "1": { class_type: "Test", inputs: {} } },
      client_id: "canvas-a",
    };

    await expect(client.queuePrompt(payload)).resolves.toEqual({
      prompt_id: "prompt-1",
    });
    expect(received).toEqual({ method: "POST", body: payload });
  });

  it("accepts an empty successful interrupt response", async () => {
    let method: string | undefined;
    const baseUrl = await startServer((request, response) => {
      method = request.method;
      response.writeHead(200);
      response.end();
    });
    const client = new ComfyHttpClient({ baseUrl, timeoutMs: 1000 });

    await expect(client.interrupt()).resolves.toBeUndefined();
    expect(method).toBe("POST");
  });
});
