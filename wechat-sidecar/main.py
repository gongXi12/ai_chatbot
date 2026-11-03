"""Run the WeChat personal-account sidecar.

Usage:
    python main.py

Requires WeChat PC 4.1.12+ to be running and logged in to the account the
bot should speak as. The target chat is the account the bot talks to.
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import time
from types import FrameType

import win32api
import win32con
import win32gui

import sidecar

log = logging.getLogger("wechat-sidecar")

MIN_WINDOW_WIDTH = 1000
MIN_WINDOW_HEIGHT = 720


def ensure_usable_window(gui):
    """Re-login can leave WeChat at its tiny login size; automation then fails
    to resolve sidebar coordinates. Enlarge it and re-attach the GUI."""
    if not gui.is_alive():
        from wechatauto import WeChatGUI

        return WeChatGUI()

    hwnd = gui.main_hwnd
    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    if right - left >= MIN_WINDOW_WIDTH and bottom - top >= MIN_WINDOW_HEIGHT:
        return gui
    screen_width = win32api.GetSystemMetrics(0)
    screen_height = win32api.GetSystemMetrics(1)
    width = max(MIN_WINDOW_WIDTH, right - left)
    height = max(MIN_WINDOW_HEIGHT, bottom - top)
    left = max(0, min(left, screen_width - width))
    top = max(0, min(top, screen_height - height))

    log.warning(
        "WeChat window too small (%dx%d), resizing to %dx%d",
        right - left,
        bottom - top,
        width,
        height,
    )
    win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
    win32gui.SetWindowPos(
        hwnd,
        0,
        left,
        top,
        width,
        height,
        win32con.SWP_NOZORDER | win32con.SWP_SHOWWINDOW,
    )
    from wechatauto import WeChatGUI

    return WeChatGUI()


class HealingSender:
    def __init__(self, gui):
        self.gui = gui

    def send_msg(self, text: str, who: str):
        self.gui = ensure_usable_window(self.gui)
        return self.gui.send_msg(text, who)


def main() -> int:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    try:
        config = sidecar.Config.from_env(os.environ)
    except ValueError as error:
        log.error("configuration error: %s", error)
        return 2

    try:
        from wechatauto import WeChatDB, WeChatGUI
        from wechatauto.db import Listener

        db = WeChatDB()
        info = db.get_self_info()
        self_username = info.get("username") or ""
        if not self_username:
            log.error("could not read the logged-in WeChat account; is WeChat running?")
            return 1

        target_username = sidecar.resolve_target(db, config.target)
        target_name = db.get_nickname(target_username)
        gui = ensure_usable_window(WeChatGUI())

        def post(payload: dict) -> dict:
            return sidecar.post_chat(
                config.api_url,
                config.chat_token,
                payload,
                timeout=config.request_timeout_s,
            )

        bridge = sidecar.Sidecar(
            config=config,
            target_username=target_username,
            self_username=self_username,
            sender=HealingSender(gui),
            post=post,
            sleep=time.sleep,
        )

        listener = Listener(db, interval=1.0)
        listener.add_listener(target_username, bridge.handle_message)
        listener.start()
    except Exception:
        log.exception("startup failed")
        return 1

    log.info(
        "ready: account=%s target=%s(%s) dry_run=%s",
        info.get("nick_name") or self_username,
        target_name,
        target_username,
        config.dry_run,
    )

    stopping = False

    def stop(_signum: int, _frame: FrameType | None) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    try:
        while not stopping:
            time.sleep(1)
    finally:
        listener.stop()
        log.info("stopped")

    return 0


if __name__ == "__main__":
    sys.exit(main())
