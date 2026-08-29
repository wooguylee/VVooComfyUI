import path from "node:path";

import { describe, expect, it } from "vitest";

import { assertLoopbackBaseUrl, loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  it("uses the local ComfyUI and token defaults", () => {
    const config = loadConfig({ LOCALAPPDATA: "C:\\Local" });

    expect(config.baseUrl.href).toBe("http://127.0.0.1:8188/");
    expect(config.tokenPath).toBe(
      path.join("C:\\Local", "VVooComfyUI", "bridge-token"),
    );
    expect(config.requestTimeoutMs).toBe(10_000);
    expect(config.bridgeTimeoutMs).toBe(15_000);
  });

  it("accepts an explicit loopback HTTP URL", () => {
    const config = loadConfig({
      LOCALAPPDATA: "C:\\Local",
      COMFY_BASE_URL: "http://localhost:9000",
    });

    expect(config.baseUrl.href).toBe("http://localhost:9000/");
  });

  it.each([
    "https://example.com",
    "http://192.168.0.10:8188",
    "ftp://127.0.0.1:8188",
    "http://user:pass@127.0.0.1:8188",
    "http://127.0.0.1:8188/path",
    "http://127.0.0.1:8188/?token=secret",
    "http://127.0.0.1:8188/#fragment",
  ])("rejects unsafe ComfyUI URL %s", (value) => {
    expect(() => assertLoopbackBaseUrl(value)).toThrow(/loopback|root|credentials|query|fragment/i);
  });

  it("requires positive integer timeouts", () => {
    expect(() =>
      loadConfig({
        LOCALAPPDATA: "C:\\Local",
        COMFY_REQUEST_TIMEOUT_MS: "1.5",
      }),
    ).toThrow(/timeout/i);

    expect(
      loadConfig({
        LOCALAPPDATA: "C:\\Local",
        COMFY_REQUEST_TIMEOUT_MS: "2500",
        COMFY_BRIDGE_TIMEOUT_MS: "3500",
      }),
    ).toMatchObject({ requestTimeoutMs: 2500, bridgeTimeoutMs: 3500 });
  });

  it("requires LOCALAPPDATA when no token path override is provided", () => {
    expect(() => loadConfig({})).toThrow(/LOCALAPPDATA/i);
  });
});
