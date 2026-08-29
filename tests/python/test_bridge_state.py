import asyncio
import sys
import unittest
from pathlib import Path


MODULE_ROOT = (
    Path(__file__).resolve().parents[2]
    / "comfy-extension"
    / "vvoo_comfy_mcp"
)
sys.path.insert(0, str(MODULE_ROOT))

from bridge_state import BridgeError, BridgeState, require_bearer_token  # noqa: E402


class BridgeStateTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.now = 100.0
        self.sockets = {"canvas-a", "canvas-b", "canvas-c"}
        self.state = BridgeState(
            socket_exists=lambda client_id: client_id in self.sockets,
            clock=lambda: self.now,
            session_ttl_seconds=15.0,
        )

    def register(self, client_id="canvas-a", **metadata):
        return self.state.register_session(
            client_id,
            {
                "protocol_version": 1,
                "title": metadata.pop("title", client_id),
                "url": metadata.pop("url", "http://127.0.0.1:8188/"),
                "visible": metadata.pop("visible", True),
                "focused": metadata.pop("focused", False),
                **metadata,
            },
        )

    def test_register_rejects_a_client_without_a_live_comfy_socket(self):
        with self.assertRaises(BridgeError) as caught:
            self.state.register_session(
                "missing",
                {"protocol_version": 1, "visible": True, "focused": True},
            )

        self.assertEqual(caught.exception.code, "SESSION_GONE")

    def test_register_rejects_an_incompatible_protocol_version(self):
        with self.assertRaises(BridgeError) as caught:
            self.state.register_session(
                "canvas-a",
                {"protocol_version": 2, "visible": True, "focused": True},
            )

        self.assertEqual(caught.exception.code, "PROTOCOL_MISMATCH")

    def test_selects_the_focused_visible_recent_session(self):
        self.register("canvas-a", focused=False, visible=True)
        self.now += 1
        self.register("canvas-b", focused=True, visible=True)

        selected = self.state.select_session(None)

        self.assertEqual(selected.client_id, "canvas-b")

    def test_explicit_session_selection_wins(self):
        self.register("canvas-a", focused=False)
        self.now += 1
        self.register("canvas-b", focused=True)

        self.assertEqual(
            self.state.select_session("canvas-a").client_id,
            "canvas-a",
        )

    def test_reports_ambiguous_sessions_with_identical_activity(self):
        self.register("canvas-a", focused=True, visible=True)
        self.register("canvas-b", focused=True, visible=True)

        with self.assertRaises(BridgeError) as caught:
            self.state.select_session(None)

        self.assertEqual(caught.exception.code, "AMBIGUOUS_CANVAS_SESSION")

    def test_heartbeat_requires_the_session_token_and_updates_activity(self):
        token = self.register("canvas-a", focused=False)

        with self.assertRaises(BridgeError) as caught:
            self.state.heartbeat("canvas-a", "wrong-token", {"focused": True})
        self.assertEqual(caught.exception.code, "AUTH_FAILED")

        self.now += 5
        session = self.state.heartbeat(
            "canvas-a",
            token,
            {"focused": True, "visible": True, "title": "Active canvas"},
        )
        self.assertTrue(session.focused)
        self.assertEqual(session.title, "Active canvas")
        self.assertEqual(session.last_seen, 105.0)

    def test_expired_and_disconnected_sessions_are_removed(self):
        self.register("canvas-a")
        self.register("canvas-b")
        self.sockets.remove("canvas-b")
        self.now += 16

        listed = self.state.list_sessions()

        self.assertEqual(listed["sessions"], [])
        self.assertIsNone(listed["active_session_id"])

    async def test_pending_result_is_resolved_by_the_owning_session(self):
        token = self.register("canvas-a")
        request_id, future = self.state.create_pending("canvas-a")

        self.state.resolve_pending(
            "canvas-a",
            token,
            request_id,
            {"ok": True, "result": {"revision": "a" * 64}},
        )

        result = await self.state.wait_for_result(request_id, future, 0.1)
        self.assertEqual(result["result"]["revision"], "a" * 64)
        self.assertEqual(self.state.pending_count, 0)

    async def test_wrong_session_cannot_resolve_a_pending_request(self):
        self.register("canvas-a")
        token_b = self.register("canvas-b")
        request_id, future = self.state.create_pending("canvas-a")

        with self.assertRaises(BridgeError) as caught:
            self.state.resolve_pending(
                "canvas-b",
                token_b,
                request_id,
                {"ok": True},
            )
        self.assertEqual(caught.exception.code, "SESSION_MISMATCH")
        self.assertFalse(future.done())
        future.cancel()

    async def test_timeout_removes_the_pending_request(self):
        self.register("canvas-a")
        request_id, future = self.state.create_pending("canvas-a")

        with self.assertRaises(BridgeError) as caught:
            await self.state.wait_for_result(request_id, future, 0.01)

        self.assertEqual(caught.exception.code, "BRIDGE_TIMEOUT")
        self.assertEqual(self.state.pending_count, 0)

    async def test_cancel_pending_removes_and_fails_the_request(self):
        self.register("canvas-a")
        request_id, future = self.state.create_pending("canvas-a")

        self.state.cancel_pending(
            request_id,
            BridgeError("SESSION_GONE", "send failed", status=404),
        )

        with self.assertRaises(BridgeError) as caught:
            await future
        self.assertEqual(caught.exception.code, "SESSION_GONE")
        self.assertEqual(self.state.pending_count, 0)

    async def test_dropping_a_session_fails_its_pending_requests(self):
        self.register("canvas-a")
        request_id, future = self.state.create_pending("canvas-a")

        self.state.drop_session("canvas-a")

        with self.assertRaises(BridgeError) as caught:
            await future
        self.assertEqual(caught.exception.code, "SESSION_GONE")
        self.assertEqual(self.state.pending_count, 0)
        self.assertNotIn(request_id, self.state.pending_request_ids)


class BearerTokenTests(unittest.TestCase):
    def test_accepts_the_exact_bearer_token(self):
        require_bearer_token("Bearer master-secret", "master-secret")

    def test_rejects_missing_or_incorrect_bearer_token(self):
        for header in (None, "", "Basic master-secret", "Bearer wrong"):
            with self.subTest(header=header):
                with self.assertRaises(BridgeError) as caught:
                    require_bearer_token(header, "master-secret")
                self.assertEqual(caught.exception.code, "AUTH_FAILED")


if __name__ == "__main__":
    unittest.main()
