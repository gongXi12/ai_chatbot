from __future__ import annotations

import unittest
from datetime import datetime, timezone

import sidecar


class ConfigTest(unittest.TestCase):
    def test_requires_target(self) -> None:
        with self.assertRaises(ValueError):
            sidecar.Config.from_env({})

    def test_defaults(self) -> None:
        config = sidecar.Config.from_env({"WECHAT_TARGET": "大号"})
        self.assertEqual(config.api_url, "http://127.0.0.1:3000/v1/chat")
        self.assertEqual(config.chat_token, "")
        self.assertEqual(config.target, "大号")
        self.assertFalse(config.dry_run)
        self.assertEqual(config.bubble_delay_ms, 1200)

    def test_rejects_negative_delay(self) -> None:
        with self.assertRaises(ValueError):
            sidecar.Config.from_env(
                {"WECHAT_TARGET": "大号", "WECHAT_BUBBLE_DELAY_MS": "-1"}
            )


class MessageFilterTest(unittest.TestCase):
    def message(self, **overrides: object) -> dict:
        base = {
            "type": "文本",
            "content": "你好",
            "sender_username": "wxid_dahao",
            "shard": "message_0.db",
            "local_id": 42,
            "create_time": 1762000000,
        }
        base.update(overrides)
        return base

    def test_accepts_text_from_other_account(self) -> None:
        self.assertTrue(sidecar.is_processable(self.message(), "wxid_xiaohao"))

    def test_skips_self_messages(self) -> None:
        self.assertFalse(sidecar.is_processable(self.message(), "wxid_dahao"))

    def test_skips_unknown_sender_to_avoid_self_loop(self) -> None:
        self.assertFalse(
            sidecar.is_processable(self.message(sender_username=""), "wxid_xiaohao")
        )

    def test_skips_non_text(self) -> None:
        self.assertFalse(
            sidecar.is_processable(self.message(type="图片"), "wxid_xiaohao")
        )

    def test_skips_blank_content(self) -> None:
        self.assertFalse(
            sidecar.is_processable(self.message(content="   "), "wxid_xiaohao")
        )


class PayloadTest(unittest.TestCase):
    def test_message_id_is_unique_per_shard(self) -> None:
        first = sidecar.message_id({"shard": "message_0.db", "local_id": 7})
        second = sidecar.message_id({"shard": "message_1.db", "local_id": 7})
        self.assertEqual(first, "wx:message_0.db:7")
        self.assertNotEqual(first, second)

    def test_build_payload(self) -> None:
        payload = sidecar.build_payload(
            {
                "shard": "message_0.db",
                "local_id": 7,
                "content": "  今天好累  ",
                "create_time": 1762000000,
            },
            "wxid_dahao",
        )
        self.assertEqual(payload["userId"], "wxid_dahao")
        self.assertEqual(payload["messageId"], "wx:message_0.db:7")
        self.assertEqual(payload["text"], "今天好累")
        self.assertEqual(
            datetime.fromisoformat(payload["receivedAt"]),
            datetime.fromtimestamp(1762000000, tz=timezone.utc),
        )

    def test_parse_bubbles_filters_empty_and_non_string(self) -> None:
        self.assertEqual(
            sidecar.parse_bubbles({"bubbles": [" 你好 ", "", None, "再见"]}),
            ["你好", "再见"],
        )

    def test_parse_bubbles_rejects_malformed_response(self) -> None:
        with self.assertRaises(ValueError):
            sidecar.parse_bubbles({"unexpected": []})


class FakeSender:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []
        self.fail_on: set[str] = set()

    def send_msg(self, text: str, who: str) -> bool:
        self.sent.append((text, who))
        return text not in self.fail_on


class SidecarTest(unittest.TestCase):
    def setUp(self) -> None:
        self.message = {
            "type": "文本",
            "content": "在吗",
            "sender_username": "wxid_dahao",
            "shard": "message_0.db",
            "local_id": 9,
            "create_time": 1762000000,
        }
        self.config = sidecar.Config(
            api_url="http://127.0.0.1:3000/v1/chat",
            chat_token="token",
            target="大号",
            dry_run=False,
            bubble_delay_ms=0,
        )
        self.sender = FakeSender()
        self.sleeps: list[float] = []

    def make_sidecar(self, post):
        return sidecar.Sidecar(
            config=self.config,
            target_username="wxid_dahao",
            self_username="wxid_xiaohao",
            sender=self.sender,
            post=post,
            sleep=self.sleeps.append,
        )

    def test_replies_with_all_bubbles(self) -> None:
        posted = []
        sidecar_instance = self.make_sidecar(
            lambda payload: posted.append(payload) or {"bubbles": ["在的", "怎么了"]}
        )

        sidecar_instance.handle_message(self.message)

        self.assertEqual(posted[0]["messageId"], "wx:message_0.db:9")
        self.assertEqual(self.sender.sent, [("在的", "大号"), ("怎么了", "大号")])

    def test_dry_run_does_not_send(self) -> None:
        self.config = sidecar.Config(
            api_url=self.config.api_url,
            chat_token="",
            target="大号",
            dry_run=True,
            bubble_delay_ms=0,
        )
        sidecar_instance = self.make_sidecar(lambda _payload: {"bubbles": ["在的"]})

        sidecar_instance.handle_message(self.message)

        self.assertEqual(self.sender.sent, [])

    def test_api_error_does_not_raise_or_send(self) -> None:
        def failing_post(_payload):
            raise OSError("connection refused")

        sidecar_instance = self.make_sidecar(failing_post)
        sidecar_instance.handle_message(self.message)
        self.assertEqual(self.sender.sent, [])

    def test_send_failure_continues_with_next_bubble(self) -> None:
        self.sender.fail_on.add("第一条")
        sidecar_instance = self.make_sidecar(
            lambda _payload: {"bubbles": ["第一条", "第二条"]}
        )

        sidecar_instance.handle_message(self.message)

        self.assertEqual(self.sender.sent, [("第一条", "大号"), ("第二条", "大号")])

    def test_duplicate_response_without_bubbles_sends_nothing(self) -> None:
        sidecar_instance = self.make_sidecar(
            lambda _payload: {"duplicate": True, "bubbles": []}
        )
        sidecar_instance.handle_message(self.message)
        self.assertEqual(self.sender.sent, [])


class ResolveTargetTest(unittest.TestCase):
    class FakeDB:
        def __init__(self, sessions, contacts):
            self.sessions = sessions
            self.contacts = contacts

        def get_sessions(self, limit=500):
            return [{"username": item} for item in self.sessions]

        def search_contact(self, keyword):
            return [
                contact
                for contact in self.contacts
                if keyword in contact["nick_name"] or keyword in contact["remark"]
            ]

    def test_exact_remark_match(self) -> None:
        db = self.FakeDB(
            ["wxid_dahao"],
            [{"username": "wxid_dahao", "nick_name": "恭喜大号", "remark": "大号"}],
        )
        self.assertEqual(sidecar.resolve_target(db, "大号"), "wxid_dahao")

    def test_ambiguous_match_raises(self) -> None:
        db = self.FakeDB(
            [],
            [
                {"username": "wxid_a", "nick_name": "大号", "remark": ""},
                {"username": "wxid_b", "nick_name": "大号", "remark": ""},
            ],
        )
        with self.assertRaises(ValueError):
            sidecar.resolve_target(db, "大号")

    def test_not_found_raises(self) -> None:
        with self.assertRaises(ValueError):
            sidecar.resolve_target(self.FakeDB([], []), "不存在")

    def test_filehelper_alias(self) -> None:
        self.assertEqual(sidecar.resolve_target(self.FakeDB([], []), "文件传输助手"), "filehelper")


if __name__ == "__main__":
    unittest.main()
