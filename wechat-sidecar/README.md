# WeChat Sidecar

让 AI 以**你自己的微信小号**身份，回复大号发来的消息。

链路：

```
微信 PC（登录小号）
  ├─ WeChatDB.Listener   只读本地数据库，轮询大号的新消息
  └─ WeChatGUI.send_msg  UIA 优先、OCR 兜底，以小号身份发送
            │
            │ POST /v1/chat
            ▼
     CompanionService（人设/安全/记忆/幂等）
            │ { bubbles }
            ▼
     逐条发回，气泡间隔可配置
```

本项目使用 [wechatauto-replica](https://github.com/fanyuantaier/wechatauto-replica)（Apache-2.0，固定 1.2.9）。

## 前置条件

- Windows 10/11
- 微信 PC 4.1.12+（`wechatauto-replica` 1.2.9 已在 4.1.15.56 验证）
- Python 3.12
- 主项目已启动：`npm run dev`（默认 `http://127.0.0.1:3000`）
- 微信 PC 登录**小号**，主窗口保持可见、不要最小化
- 重新登录后主窗口可能缩回登录尺寸；sidecar 会在启动和每次发送前自动放大到至少 1000×720，避免侧栏识别失败
- 大号在手机上登录，给小号发消息

## 安装

```powershell
cd wechat-sidecar
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 配置

PowerShell：

```powershell
$env:WECHAT_TARGET = "大号的备注名"
$env:COMPANION_API_URL = "http://127.0.0.1:3000/v1/chat"
$env:COMPANION_CHAT_TOKEN = ""
$env:WECHAT_DRY_RUN = "1"
$env:WECHAT_BUBBLE_DELAY_MS = "1200"
```

Git Bash：

```bash
export WECHAT_TARGET="大号的备注名"
export COMPANION_API_URL="http://127.0.0.1:3000/v1/chat"
export COMPANION_CHAT_TOKEN=""
export WECHAT_DRY_RUN=1
export WECHAT_BUBBLE_DELAY_MS=1200
```

`WECHAT_TARGET` 可填备注名、昵称或 `wxid_...`。名字有歧义时程序会退出并列出候选，不会猜。

## 首跑（不发送）

先确认 `npm run dev` 已启动，然后：

```powershell
cd wechat-sidecar
.\.venv\Scripts\python.exe main.py
```

看到 `ready: account=... target=... dry_run=True` 后，用大号发一条「你好」。终端应打印：

```
dry run: message wx:message_0.db:123 -> ['...']
```

这说明监听、HTTP、回复生成都通了。

## 正式回复

关掉 dry-run 再启动：

```powershell
$env:WECHAT_DRY_RUN = "0"
.\.venv\Scripts\python.exe main.py
```

大号再发消息，小号会自动逐条回复。

## 测试

```powershell
.\.venv\Scripts\python.exe -m unittest -v test_sidecar
```

21 项纯逻辑测试，不启动微信。

## 注意

- **封号风险**：库会向 `Weixin.dll` 运行时写入 1 个字节（Qt accessibility gate）以物化 UIA 树。不是注入 DLL，但属于进程内存改写。只在小号、低频使用，不要群发或加好友。
- 发送会抢占前台焦点。运行期间不要同时操作 PC 微信。
- 微信升级后若 UIA/OCR 布局失效，等 `wechatauto-replica` 适配，或把依赖固定回已验证版本。
- 只监听 `WECHAT_TARGET` 一个会话。群里 @ 小号不会触发。
