import asyncio
import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path


PACKAGE_ROOT = (
    Path(__file__).resolve().parents[2]
    / "comfy-extension"
    / "vvoo_comfy_mcp"
)


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status
        self.text = json.dumps(payload)


class FakeRouteTableDef:
    def __init__(self):
        self.handlers = {}

    def _decorator(self, method, path):
        def register(handler):
            self.handlers[(method, path)] = handler
            return handler

        return register

    def get(self, path):
        return self._decorator("GET", path)

    def post(self, path):
        return self._decorator("POST", path)


class FakePromptServer:
    def __init__(self):
        self.routes = FakeRouteTableDef()
        self.sockets = {"canvas-a": object()}
        self.sent = []

    async def send(self, event, data, sid=None):
        self.sent.append({"event": event, "data": data, "sid": sid})


class FakeRequest:
    def __init__(self, payload=None, headers=None):
        self._payload = {} if payload is None else payload
        self.headers = {} if headers is None else headers

    async def json(self):
        return self._payload


def load_extension(local_app_data, prompt_server):
    for name in ("vvoo_comfy_mcp", "vvoo_comfy_mcp.bridge_state"):
        sys.modules.pop(name, None)

    aiohttp_module = types.ModuleType("aiohttp")
    aiohttp_module.web = types.SimpleNamespace(
        Request=FakeRequest,
        Response=FakeResponse,
        json_response=lambda payload, status=200: FakeResponse(payload, status),
    )
    server_module = types.ModuleType("server")
    server_module.PromptServer = types.SimpleNamespace(instance=prompt_server)
    sys.modules["aiohttp"] = aiohttp_module
    sys.modules["server"] = server_module

    previous = os.environ.get("LOCALAPPDATA")
    os.environ["LOCALAPPDATA"] = local_app_data
    try:
        spec = importlib.util.spec_from_file_location(
            "vvoo_comfy_mcp",
            PACKAGE_ROOT / "__init__.py",
            submodule_search_locations=[str(PACKAGE_ROOT)],
        )
        module = importlib.util.module_from_spec(spec)
        sys.modules["vvoo_comfy_mcp"] = module
        spec.loader.exec_module(module)
        return module
    finally:
        if previous is None:
            os.environ.pop("LOCALAPPDATA", None)
        else:
            os.environ["LOCALAPPDATA"] = previous


class RouteTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        token_dir = Path(self.temp.name) / "VVooComfyUI"
        token_dir.mkdir(parents=True)
        (token_dir / "bridge-token").write_text("master-secret\n", encoding="utf-8")
        self.prompt_server = FakePromptServer()
        self.extension = load_extension(self.temp.name, self.prompt_server)
        self.routes = self.prompt_server.routes.handlers

    def tearDown(self):
        self.temp.cleanup()

    async def register_frontend(self):
        response = await self.routes[("POST", "/vvoo_mcp/frontend/register")](
            FakeRequest(
                {
                    "client_id": "canvas-a",
                    "protocol_version": 1,
                    "title": "ComfyUI",
                    "url": "http://127.0.0.1:8188/",
                    "visible": True,
                    "focused": True,
                }
            )
        )
        return response

    def test_registers_all_bridge_routes_and_exports_no_nodes(self):
        self.assertEqual(self.extension.WEB_DIRECTORY, "./js")
        self.assertEqual(self.extension.NODE_CLASS_MAPPINGS, {})
        self.assertEqual(
            set(self.routes),
            {
                ("POST", "/vvoo_mcp/frontend/register"),
                ("POST", "/vvoo_mcp/frontend/heartbeat"),
                ("POST", "/vvoo_mcp/frontend/result"),
                ("GET", "/vvoo_mcp/sessions"),
                ("GET", "/vvoo_mcp/status"),
                ("POST", "/vvoo_mcp/command"),
            },
        )

    def test_allows_workflow_tab_and_viewport_commands(self):
        self.assertEqual(
            self.extension.ALLOWED_COMMANDS,
            {
                "canvas.get",
                "canvas.apply_patch",
                "canvas.replace",
                "canvas.restore",
                "canvas.to_prompt",
                "canvas.focus",
                "workflow.list",
                "workflow.get",
                "workflow.select",
                "workflow.create",
                "workflow.save",
                "workflow.rename",
                "workflow.close",
                "workflow.reorder",
            },
        )

    async def test_status_advertises_workflow_capabilities(self):
        response = await self.routes[("GET", "/vvoo_mcp/status")](
            FakeRequest(headers={"Authorization": "Bearer master-secret"})
        )

        self.assertEqual(response.status, 200)
        self.assertEqual(
            response.payload["result"]["capabilities"],
            {
                "workflow_tabs": True,
                "workflow_lifecycle": True,
                "canvas_focus": True,
                "snapshot_workflow_binding": True,
            },
        )

    async def test_frontend_registration_returns_a_session_token(self):
        response = await self.register_frontend()

        self.assertEqual(response.status, 200)
        self.assertTrue(response.payload["ok"])
        self.assertEqual(response.payload["protocol_version"], 1)
        self.assertGreater(len(response.payload["session_token"]), 20)

    async def test_master_route_rejects_an_invalid_bearer_token(self):
        response = await self.routes[("GET", "/vvoo_mcp/sessions")](
            FakeRequest(headers={"Authorization": "Bearer wrong"})
        )

        self.assertEqual(response.status, 401)
        self.assertEqual(response.payload["error"]["code"], "AUTH_FAILED")

    async def test_command_round_trip_targets_the_registered_socket(self):
        registration = await self.register_frontend()
        session_token = registration.payload["session_token"]
        command_task = asyncio.create_task(
            self.routes[("POST", "/vvoo_mcp/command")](
                FakeRequest(
                    {
                        "session_id": "canvas-a",
                        "command": "canvas.get",
                        "payload": {},
                        "timeout_ms": 1000,
                    },
                    headers={"Authorization": "Bearer master-secret"},
                )
            )
        )

        for _ in range(20):
            if self.prompt_server.sent:
                break
            await asyncio.sleep(0)
        self.assertEqual(len(self.prompt_server.sent), 1)
        sent = self.prompt_server.sent[0]
        self.assertEqual(sent["event"], "vvoo.mcp.command")
        self.assertEqual(sent["sid"], "canvas-a")

        result_response = await self.routes[("POST", "/vvoo_mcp/frontend/result")](
            FakeRequest(
                {
                    "client_id": "canvas-a",
                    "session_token": session_token,
                    "request_id": sent["data"]["request_id"],
                    "response": {
                        "ok": True,
                        "result": {"revision": "a" * 64},
                    },
                }
            )
        )
        self.assertEqual(result_response.status, 200)

        command_response = await command_task
        self.assertEqual(command_response.status, 200)
        self.assertEqual(command_response.payload["session_id"], "canvas-a")
        self.assertEqual(command_response.payload["result"]["revision"], "a" * 64)


if __name__ == "__main__":
    unittest.main()
