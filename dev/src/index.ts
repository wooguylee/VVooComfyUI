import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { BridgeClient } from "./bridge-client.js";
import { ComfyHttpClient } from "./comfy-http-client.js";
import { loadConfig } from "./config.js";
import { serializeError } from "./errors.js";
import { createMcpServer } from "./server.js";
import { createToolHandlers } from "./tool-handlers.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const comfy = new ComfyHttpClient({
    baseUrl: config.baseUrl,
    timeoutMs: config.requestTimeoutMs,
  });
  const bridge = new BridgeClient({
    baseUrl: config.baseUrl,
    tokenPath: config.tokenPath,
    timeoutMs: config.bridgeTimeoutMs,
  });
  const handlers = createToolHandlers({
    comfy,
    bridge,
    bridgeTimeoutMs: config.bridgeTimeoutMs,
  });
  const server = createMcpServer(handlers);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify(serializeError(error))}\n`);
  process.exitCode = 1;
});
