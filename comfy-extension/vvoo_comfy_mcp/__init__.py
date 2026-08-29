from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from aiohttp import web
from server import PromptServer

from .bridge_state import (
    PROTOCOL_VERSION,
    BridgeError,
    BridgeState,
    load_master_token,
    require_bearer_token,
)


WEB_DIRECTORY = "./js"
NODE_CLASS_MAPPINGS: dict[str, Any] = {}
NODE_DISPLAY_NAME_MAPPINGS: dict[str, str] = {}

EVENT_NAME = "vvoo.mcp.command"
ALLOWED_COMMANDS = {
    "canvas.get",
    "canvas.apply_patch",
    "canvas.replace",
    "canvas.restore",
    "canvas.to_prompt",
}

_local_app_data = os.environ.get("LOCALAPPDATA")
if not _local_app_data:
    raise BridgeError(
        "BRIDGE_TOKEN_MISSING",
        "LOCALAPPDATA is required to locate the canvas bridge token",
        status=503,
    )
_master_token_path = Path(_local_app_data) / "VVooComfyUI" / "bridge-token"
_master_token = load_master_token(_master_token_path)
_state = BridgeState(
    socket_exists=lambda client_id: client_id in PromptServer.instance.sockets
)


def _error_status(code: str, fallback: int = 400) -> int:
    if code in {"REVISION_CONFLICT", "AMBIGUOUS_CANVAS_SESSION"}:
        return 409
    if code in {"NO_CANVAS_SESSION", "SESSION_GONE", "REQUEST_NOT_FOUND"}:
        return 404
    if code == "AUTH_FAILED":
        return 401
    if code == "BRIDGE_TIMEOUT":
        return 504
    return fallback


def _failure_response(
    error: BridgeError,
    *,
    request_id: str | None = None,
) -> web.Response:
    payload: dict[str, Any] = {"ok": False, "error": error.to_dict()}
    if request_id is not None:
        payload["request_id"] = request_id
    return web.json_response(payload, status=_error_status(error.code, error.status))


def _unexpected_failure(error: Exception) -> web.Response:
    return _failure_response(
        BridgeError(
            "INVALID_REQUEST",
            str(error),
            status=400,
        )
    )


async def _read_object(request: web.Request) -> dict[str, Any]:
    payload = await request.json()
    if not isinstance(payload, dict):
        raise BridgeError("INVALID_REQUEST", "JSON request body must be an object")
    return payload


def _require_master(request: web.Request) -> None:
    require_bearer_token(request.headers.get("Authorization"), _master_token)


routes = PromptServer.instance.routes


@routes.post("/vvoo_mcp/frontend/register")
async def frontend_register(request: web.Request) -> web.Response:
    try:
        payload = await _read_object(request)
        client_id = payload.get("client_id")
        if not isinstance(client_id, str) or not client_id:
            raise BridgeError("INVALID_REQUEST", "client_id is required")
        session_token = _state.register_session(client_id, payload)
        return web.json_response(
            {
                "ok": True,
                "protocol_version": PROTOCOL_VERSION,
                "client_id": client_id,
                "session_token": session_token,
            }
        )
    except BridgeError as error:
        return _failure_response(error)
    except Exception as error:
        return _unexpected_failure(error)


@routes.post("/vvoo_mcp/frontend/heartbeat")
async def frontend_heartbeat(request: web.Request) -> web.Response:
    try:
        payload = await _read_object(request)
        client_id = payload.get("client_id")
        session_token = payload.get("session_token")
        if not isinstance(client_id, str) or not isinstance(session_token, str):
            raise BridgeError(
                "INVALID_REQUEST",
                "client_id and session_token are required",
            )
        session = _state.heartbeat(client_id, session_token, payload)
        return web.json_response({"ok": True, "session": session.public_dict()})
    except BridgeError as error:
        return _failure_response(error)
    except Exception as error:
        return _unexpected_failure(error)


@routes.post("/vvoo_mcp/frontend/result")
async def frontend_result(request: web.Request) -> web.Response:
    try:
        payload = await _read_object(request)
        client_id = payload.get("client_id")
        session_token = payload.get("session_token")
        request_id = payload.get("request_id")
        response = payload.get("response")
        if not all(
            isinstance(value, str)
            for value in (client_id, session_token, request_id)
        ) or not isinstance(response, dict):
            raise BridgeError(
                "INVALID_REQUEST",
                "client_id, session_token, request_id, and response are required",
            )
        _state.resolve_pending(
            client_id,
            session_token,
            request_id,
            response,
        )
        return web.json_response({"ok": True, "request_id": request_id})
    except BridgeError as error:
        return _failure_response(error)
    except Exception as error:
        return _unexpected_failure(error)


@routes.get("/vvoo_mcp/sessions")
async def list_sessions(request: web.Request) -> web.Response:
    try:
        _require_master(request)
        return web.json_response({"ok": True, "result": _state.list_sessions()})
    except BridgeError as error:
        return _failure_response(error)
    except Exception as error:
        return _unexpected_failure(error)


@routes.get("/vvoo_mcp/status")
async def bridge_status(request: web.Request) -> web.Response:
    try:
        _require_master(request)
        return web.json_response(
            {
                "ok": True,
                "result": {
                    "loaded": True,
                    "protocol_version": PROTOCOL_VERSION,
                    **_state.list_sessions(),
                },
            }
        )
    except BridgeError as error:
        return _failure_response(error)
    except Exception as error:
        return _unexpected_failure(error)


@routes.post("/vvoo_mcp/command")
async def dispatch_command(request: web.Request) -> web.Response:
    request_id: str | None = None
    try:
        _require_master(request)
        payload = await _read_object(request)
        command = payload.get("command")
        command_payload = payload.get("payload")
        session_id = payload.get("session_id")
        timeout_ms = payload.get("timeout_ms")
        if command not in ALLOWED_COMMANDS:
            raise BridgeError("INVALID_REQUEST", f"Unsupported command: {command!r}")
        if not isinstance(command_payload, dict):
            raise BridgeError("INVALID_REQUEST", "payload must be an object")
        if session_id is not None and not isinstance(session_id, str):
            raise BridgeError("INVALID_REQUEST", "session_id must be a string")
        if (
            not isinstance(timeout_ms, int)
            or isinstance(timeout_ms, bool)
            or timeout_ms < 100
            or timeout_ms > 120_000
        ):
            raise BridgeError(
                "INVALID_REQUEST",
                "timeout_ms must be an integer between 100 and 120000",
            )

        session = _state.select_session(session_id)
        request_id, future = _state.create_pending(session.client_id)
        message = {
            "protocol_version": PROTOCOL_VERSION,
            "request_id": request_id,
            "command": command,
            "payload": command_payload,
        }
        try:
            await PromptServer.instance.send(
                EVENT_NAME,
                message,
                sid=session.client_id,
            )
        except Exception as error:
            bridge_error = BridgeError(
                "SESSION_GONE",
                f"Failed to send canvas command: {error}",
                status=404,
            )
            _state.cancel_pending(request_id, bridge_error)
            try:
                await future
            except BridgeError as cancelled:
                raise cancelled

        frontend_response = await _state.wait_for_result(
            request_id,
            future,
            timeout_ms / 1000,
        )
        if frontend_response.get("ok") is True:
            return web.json_response(
                {
                    "ok": True,
                    "request_id": request_id,
                    "session_id": session.client_id,
                    "result": frontend_response.get("result"),
                }
            )
        if frontend_response.get("ok") is False and isinstance(
            frontend_response.get("error"),
            dict,
        ):
            frontend_error = frontend_response["error"]
            code = str(frontend_error.get("code", "CANVAS_COMMAND_FAILED"))
            message_text = str(
                frontend_error.get("message", "Canvas command failed")
            )
            error = BridgeError(
                code,
                message_text,
                status=_error_status(code),
                details=frontend_error.get("details"),
            )
            return _failure_response(error, request_id=request_id)
        raise BridgeError(
            "BRIDGE_PROTOCOL_ERROR",
            "Canvas frontend returned an invalid response",
            status=502,
        )
    except BridgeError as error:
        return _failure_response(error, request_id=request_id)
    except Exception as error:
        return _unexpected_failure(error)
