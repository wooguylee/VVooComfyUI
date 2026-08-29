from __future__ import annotations

import asyncio
import secrets
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


PROTOCOL_VERSION = 1


class BridgeError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status: int = 400,
        details: Any | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details

    def to_dict(self) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details is not None:
            error["details"] = self.details
        return error


@dataclass
class CanvasSession:
    client_id: str
    token: str
    title: str
    url: str
    visible: bool
    focused: bool
    protocol_version: int
    last_seen: float

    def public_dict(self) -> dict[str, Any]:
        return {
            "client_id": self.client_id,
            "title": self.title,
            "url": self.url,
            "visible": self.visible,
            "focused": self.focused,
            "protocol_version": self.protocol_version,
            "last_seen": self.last_seen,
        }


@dataclass
class PendingRequest:
    request_id: str
    client_id: str
    future: asyncio.Future[dict[str, Any]]


def require_bearer_token(
    authorization_header: str | None,
    master_token: str,
) -> None:
    expected = f"Bearer {master_token}"
    if authorization_header is None or not secrets.compare_digest(
        authorization_header,
        expected,
    ):
        raise BridgeError("AUTH_FAILED", "Invalid canvas bridge bearer token", status=401)


def load_master_token(token_path: Path) -> str:
    try:
        token = token_path.read_text(encoding="utf-8").strip()
    except OSError as error:
        raise BridgeError(
            "BRIDGE_TOKEN_MISSING",
            f"Canvas bridge token was not found at {token_path}",
            status=503,
        ) from error
    if not token:
        raise BridgeError(
            "BRIDGE_TOKEN_MISSING",
            f"Canvas bridge token is empty at {token_path}",
            status=503,
        )
    return token


class BridgeState:
    def __init__(
        self,
        *,
        socket_exists: Callable[[str], bool],
        clock: Callable[[], float] = time.monotonic,
        session_ttl_seconds: float = 15.0,
    ) -> None:
        self._socket_exists = socket_exists
        self._clock = clock
        self._session_ttl_seconds = session_ttl_seconds
        self._sessions: dict[str, CanvasSession] = {}
        self._pending: dict[str, PendingRequest] = {}

    @property
    def pending_count(self) -> int:
        return len(self._pending)

    @property
    def pending_request_ids(self) -> tuple[str, ...]:
        return tuple(self._pending)

    def register_session(self, client_id: str, metadata: dict[str, Any]) -> str:
        if not client_id or not self._socket_exists(client_id):
            raise BridgeError(
                "SESSION_GONE",
                f"ComfyUI WebSocket session {client_id!r} is not connected",
                status=404,
            )
        protocol_version = metadata.get("protocol_version")
        if protocol_version != PROTOCOL_VERSION:
            raise BridgeError(
                "PROTOCOL_MISMATCH",
                f"Canvas protocol {protocol_version!r} is not supported",
                status=409,
                details={"supported_protocol_version": PROTOCOL_VERSION},
            )

        token = secrets.token_urlsafe(32)
        self._sessions[client_id] = CanvasSession(
            client_id=client_id,
            token=token,
            title=str(metadata.get("title", "")),
            url=str(metadata.get("url", "")),
            visible=bool(metadata.get("visible", False)),
            focused=bool(metadata.get("focused", False)),
            protocol_version=protocol_version,
            last_seen=self._clock(),
        )
        return token

    def _authenticate_session(self, client_id: str, token: str) -> CanvasSession:
        session = self._sessions.get(client_id)
        if session is None or not secrets.compare_digest(session.token, token):
            raise BridgeError(
                "AUTH_FAILED",
                "Invalid canvas session token",
                status=401,
            )
        if not self._socket_exists(client_id):
            self.drop_session(client_id)
            raise BridgeError(
                "SESSION_GONE",
                f"ComfyUI WebSocket session {client_id!r} disconnected",
                status=404,
            )
        return session

    def heartbeat(
        self,
        client_id: str,
        token: str,
        metadata: dict[str, Any],
    ) -> CanvasSession:
        session = self._authenticate_session(client_id, token)
        if "title" in metadata:
            session.title = str(metadata["title"])
        if "url" in metadata:
            session.url = str(metadata["url"])
        if "visible" in metadata:
            session.visible = bool(metadata["visible"])
        if "focused" in metadata:
            session.focused = bool(metadata["focused"])
        session.last_seen = self._clock()
        return session

    def _prune_sessions(self) -> None:
        now = self._clock()
        expired = [
            client_id
            for client_id, session in self._sessions.items()
            if now - session.last_seen > self._session_ttl_seconds
            or not self._socket_exists(client_id)
        ]
        for client_id in expired:
            self.drop_session(client_id)

    @staticmethod
    def _sort_key(session: CanvasSession) -> tuple[bool, bool, float]:
        return (session.focused, session.visible, session.last_seen)

    def list_sessions(self) -> dict[str, Any]:
        self._prune_sessions()
        sessions = sorted(
            self._sessions.values(),
            key=self._sort_key,
            reverse=True,
        )
        active_session_id: str | None = None
        ambiguous = False
        if sessions:
            if len(sessions) > 1 and self._sort_key(sessions[0]) == self._sort_key(
                sessions[1]
            ):
                ambiguous = True
            else:
                active_session_id = sessions[0].client_id
        return {
            "protocol_version": PROTOCOL_VERSION,
            "sessions": [session.public_dict() for session in sessions],
            "active_session_id": active_session_id,
            "ambiguous": ambiguous,
        }

    def select_session(self, client_id: str | None) -> CanvasSession:
        self._prune_sessions()
        if client_id is not None:
            session = self._sessions.get(client_id)
            if session is None:
                raise BridgeError(
                    "NO_CANVAS_SESSION",
                    f"Canvas session {client_id!r} is not registered",
                    status=404,
                )
            return session

        sessions = sorted(
            self._sessions.values(),
            key=self._sort_key,
            reverse=True,
        )
        if not sessions:
            raise BridgeError(
                "NO_CANVAS_SESSION",
                "No live ComfyUI canvas session is registered",
                status=404,
            )
        if len(sessions) > 1 and self._sort_key(sessions[0]) == self._sort_key(
            sessions[1]
        ):
            raise BridgeError(
                "AMBIGUOUS_CANVAS_SESSION",
                "More than one equally active ComfyUI canvas session is registered",
                status=409,
                details={
                    "session_ids": [sessions[0].client_id, sessions[1].client_id]
                },
            )
        return sessions[0]

    def create_pending(
        self,
        client_id: str,
    ) -> tuple[str, asyncio.Future[dict[str, Any]]]:
        if client_id not in self._sessions or not self._socket_exists(client_id):
            raise BridgeError(
                "SESSION_GONE",
                f"Canvas session {client_id!r} is not connected",
                status=404,
            )
        request_id = uuid.uuid4().hex
        future: asyncio.Future[dict[str, Any]] = (
            asyncio.get_running_loop().create_future()
        )
        self._pending[request_id] = PendingRequest(
            request_id=request_id,
            client_id=client_id,
            future=future,
        )
        return request_id, future

    def resolve_pending(
        self,
        client_id: str,
        token: str,
        request_id: str,
        result: dict[str, Any],
    ) -> None:
        self._authenticate_session(client_id, token)
        pending = self._pending.get(request_id)
        if pending is None:
            raise BridgeError(
                "REQUEST_NOT_FOUND",
                f"Canvas request {request_id!r} is not pending",
                status=404,
            )
        if pending.client_id != client_id:
            raise BridgeError(
                "SESSION_MISMATCH",
                "Canvas response came from a different session",
                status=409,
            )
        self._pending.pop(request_id, None)
        if not pending.future.done():
            pending.future.set_result(result)

    async def wait_for_result(
        self,
        request_id: str,
        future: asyncio.Future[dict[str, Any]],
        timeout_seconds: float,
    ) -> dict[str, Any]:
        try:
            return await asyncio.wait_for(asyncio.shield(future), timeout_seconds)
        except TimeoutError as error:
            pending = self._pending.pop(request_id, None)
            if pending is not None and not pending.future.done():
                pending.future.cancel()
            raise BridgeError(
                "BRIDGE_TIMEOUT",
                f"Canvas request timed out after {timeout_seconds:g} seconds",
                status=504,
            ) from error
        finally:
            self._pending.pop(request_id, None)

    def cancel_pending(self, request_id: str, error: BridgeError) -> None:
        pending = self._pending.pop(request_id, None)
        if pending is not None and not pending.future.done():
            pending.future.set_exception(error)

    def drop_session(self, client_id: str) -> None:
        self._sessions.pop(client_id, None)
        matching_ids = [
            request_id
            for request_id, pending in self._pending.items()
            if pending.client_id == client_id
        ]
        for request_id in matching_ids:
            pending = self._pending.pop(request_id)
            if not pending.future.done():
                pending.future.set_exception(
                    BridgeError(
                        "SESSION_GONE",
                        f"Canvas session {client_id!r} disconnected",
                        status=404,
                    )
                )
