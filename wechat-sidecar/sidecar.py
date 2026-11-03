"""Bridge a personal WeChat account to CompanionService's HTTP chat API.

The module deliberately has no ``wechatauto`` import at import time so the
filtering, payload and delivery logic can be unit tested without WeChat
running. ``main.py`` wires in the real database listener and sender.
"""

from __future__ import annotations

import json
import logging
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Mapping

log = logging.getLogger("wechat-sidecar")

TEXT_MESSAGE_TYPE = "文本"
FILEHELPER_ALIASES = {"文件传输助手", "filehelper"}


@dataclass(frozen=True)
class Config:
    api_url: str
    chat_token: str
    target: str
    dry_run: bool
    bubble_delay_ms: int
    request_timeout_s: float = 45.0

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "Config":
        target = (env.get("WECHAT_TARGET") or "").strip()
        if not target:
            raise ValueError("WECHAT_TARGET is required")

        try:
            bubble_delay_ms = int(env.get("WECHAT_BUBBLE_DELAY_MS", "1200"))
        except ValueError as error:
            raise ValueError("WECHAT_BUBBLE_DELAY_MS must be an integer") from error
        if bubble_delay_ms < 0:
            raise ValueError("WECHAT_BUBBLE_DELAY_MS must not be negative")

        return cls(
            api_url=env.get("COMPANION_API_URL", "http://127.0.0.1:3000/v1/chat"),
            chat_token=env.get("COMPANION_CHAT_TOKEN", ""),
            target=target,
            dry_run=env.get("WECHAT_DRY_RUN", "0").lower() in {"1", "true", "yes", "on"},
            bubble_delay_ms=bubble_delay_ms,
            request_timeout_s=float(env.get("COMPANION_TIMEOUT_S", "45")),
        )


def is_processable(message: Mapping[str, Any], self_username: str) -> bool:
    """Only reply to newly received text from another known account.

    An empty ``sender_username`` is rejected: the sender is then unknown and
    replying could echo the bot's own message back into the model.
    """
    sender = message.get("sender_username") or ""
    return (
        message.get("type") == TEXT_MESSAGE_TYPE
        and bool(str(message.get("content") or "").strip())
        and bool(sender)
        and sender != self_username
    )


def message_id(message: Mapping[str, Any]) -> str:
    """Stable ID across restarts; (shard, local_id) is unique in WeChat 4.x."""
    return f"wx:{message['shard']}:{message['local_id']}"


def build_payload(message: Mapping[str, Any], target_username: str) -> dict[str, str]:
    return {
        "userId": target_username,
        "messageId": message_id(message),
        "text": str(message["content"]).strip(),
        "receivedAt": datetime.fromtimestamp(
            float(message["create_time"]), tz=timezone.utc
        ).isoformat(),
    }


def post_chat(
    url: str,
    token: str,
    payload: Mapping[str, Any],
    timeout: float = 45.0,
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"content-type": "application/json"},
    )
    if token:
        request.add_header("x-chat-token", token)
    with opener(request, timeout=timeout) as response:
        body = response.read().decode("utf-8")
    parsed = json.loads(body)
    if not isinstance(parsed, dict):
        raise ValueError("companion API returned a non-object response")
    return parsed


def parse_bubbles(response: Mapping[str, Any]) -> list[str]:
    bubbles = response.get("bubbles")
    if not isinstance(bubbles, list):
        raise ValueError("companion API response is missing a bubbles list")
    return [bubble.strip() for bubble in bubbles if isinstance(bubble, str) and bubble.strip()]


def resolve_target(db: Any, raw: str) -> str:
    """Resolve a nickname, remark or wxid to a WeChat username.

    Searches use LIKE, so only exact field matches are accepted; an ambiguous
    result fails loudly instead of replying to the wrong contact.
    """
    raw = raw.strip()
    if raw.lower() in FILEHELPER_ALIASES or raw in FILEHELPER_ALIASES:
        return "filehelper"

    sessions = {session["username"] for session in db.get_sessions(limit=500)}
    if raw in sessions:
        return raw

    hits = db.search_contact(raw)
    exact = [
        hit
        for hit in hits
        if raw in {hit.get("username"), hit.get("nick_name"), hit.get("remark")}
    ]
    if len(exact) == 1:
        return exact[0]["username"]
    if len(exact) > 1:
        candidates = exact
    elif len(hits) == 1:
        return hits[0]["username"]
    elif not hits:
        raise ValueError(f"no contact or session matches {raw!r}")
    else:
        candidates = hits

    names = ", ".join(
        f"{(hit.get('remark') or hit.get('nick_name') or '?')}({hit['username']})"
        for hit in candidates[:5]
    )
    raise ValueError(f"{raw!r} is ambiguous; use a remark or wxid: {names}")


class Sidecar:
    def __init__(
        self,
        config: Config,
        target_username: str,
        self_username: str,
        sender: Any,
        post: Callable[[Mapping[str, Any]], Mapping[str, Any]],
        sleep: Callable[[float], Any],
    ) -> None:
        self.config = config
        self.target_username = target_username
        self.self_username = self_username
        self.sender = sender
        self.post = post
        self.sleep = sleep

    def handle_message(self, message: Mapping[str, Any], _listener: Any = None) -> None:
        """Listener callback. Never raises: the listener retries failed
        callbacks, which would duplicate replies."""
        try:
            if not is_processable(message, self.self_username):
                return

            payload = build_payload(message, self.target_username)
            log.info(
                "received: message=%s text=%s",
                payload["messageId"],
                payload["text"],
            )
            bubbles = parse_bubbles(self.post(payload))
            if not bubbles:
                log.info("no reply: message=%s (duplicate or empty)", payload["messageId"])
                return

            if self.config.dry_run:
                log.info("dry run: message=%s -> %s", payload["messageId"], bubbles)
                return

            for index, bubble in enumerate(bubbles):
                if index and self.config.bubble_delay_ms:
                    self.sleep(self.config.bubble_delay_ms / 1000)
                try:
                    if self.sender.send_msg(bubble, self.config.target):
                        log.info(
                            "replied: message=%s bubble=%d/%d text=%s",
                            payload["messageId"],
                            index + 1,
                            len(bubbles),
                            bubble,
                        )
                    else:
                        log.warning(
                            "send failed: message=%s bubble=%d/%d text=%s",
                            payload["messageId"],
                            index + 1,
                            len(bubbles),
                            bubble,
                        )
                except Exception:
                    log.exception(
                        "send error: message=%s bubble=%d/%d text=%s",
                        payload["messageId"],
                        index + 1,
                        len(bubbles),
                        bubble,
                    )
        except Exception:
            log.exception("message handling failed")
