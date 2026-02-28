# KeyMod – Ephemeral Remote KM Server

A lightweight WebSocket server that lets you remotely control the keyboard and mouse of a target PC through a browser or a terminal client, routed through a temporary Cloudflare tunnel spun up inside a GitHub Actions job — no static server or open ports required.

---

## How it works

```
Browser / client_example.py
        │  WSS /ws  (JSON text frames)
        ▼
  KeyMod Server                ← runs in GitHub Actions + Cloudflare tunnel
    (server.py)
        │  WS /agent  (JSON or binary CH9329 frames)
        ▼
  agent.py                     ← runs on the target PC
        │  pynput
        ▼
  Target PC  keyboard / mouse
```

1. **GitHub Actions** starts `server.py` behind a Cloudflare quick-tunnel.
2. The tunnel URL is committed to `.tunnel-url` in the repo via `git push`.
3. **`trigger_build.py`** (or the Actions UI) dispatches the job and automatically polls for the URL — no manual log-watching needed.
4. **`agent.py`** runs on the machine you want to control and connects to `/agent`.
5. Every keystroke / mouse event typed in the browser is relayed in real-time to the agent, which replays it on the target PC using `pynput`.

---

## Repository layout

```
.
├── server.py               FastAPI WebSocket server
├── agent.py                Target-PC agent (run this on the machine to control)
├── client_example.py       Terminal keyboard client (alternative to the browser UI)
├── trigger_build.py        Local script: trigger + auto-detect tunnel URL
├── requirements.txt        Python dependencies
├── templates/
│   └── index.html          Web terminal UI (xterm.js)
└── .github/workflows/
    └── start-server.yml    GitHub Actions workflow
```

---

## Quick start

### 0 · One-time setup — create `.env`

Create a `.env` file in the project root (never committed — already in `.gitignore`):

```ini
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx   # PAT with repo + workflow scopes
GITHUB_REPO=owner/repo-name
GITHUB_WORKFLOW=start-server.yml
GITHUB_REF=main
```

Generate a token at **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens** with:
- **Repository permissions:** Contents (read/write), Actions (read/write), Workflows (read/write)

### 1 · Trigger from your local machine (recommended)

```bash
python3 trigger_build.py               # start server for default 10 min, watch for URL
python3 trigger_build.py --duration 30 # keep alive for 30 minutes
python3 trigger_build.py --no-watch    # dispatch and exit immediately
python3 trigger_build.py --watch-only  # re-attach to the latest running job
```

`trigger_build.py` requires **no third-party packages** — it uses Python 3 stdlib only.

When the tunnel is ready (~60 s after dispatch) the script prints:

```
========================================================
  HTTP URL : https://xxxx.trycloudflare.com
  WSS  URL : wss://xxxx.trycloudflare.com/ws
  Agent    : python3 agent.py wss://xxxx.trycloudflare.com/agent
========================================================
```

#### How tunnel URL detection works

The workflow writes the URL to a `.tunnel-url` file in the repo via `git push`
(using the `GITHUB_TOKEN` that `actions/checkout` already configured).
`trigger_build.py` polls `GET /repos/{owner}/{repo}/contents/.tunnel-url` once
every 6 seconds and compares the commit timestamp against the dispatch time to
ignore stale values from earlier runs.

#### All CLI flags

| Flag | Default | Description |
|---|---|---|
| `--duration N` | 10 | Keep server alive for N minutes (1–60) |
| `--repo OWNER/REPO` | `$GITHUB_REPO` | Target repository |
| `--workflow FILE` | `$GITHUB_WORKFLOW` | Workflow file name |
| `--ref BRANCH` | `$GITHUB_REF` | Git ref to run on |
| `--token TOKEN` | `$GITHUB_TOKEN` | GitHub PAT |
| `--input KEY=VALUE` | — | Extra workflow inputs (repeatable) |
| `--watch` / `--no-watch` | watch | Poll for tunnel URL after dispatch |
| `--watch-only` | — | Skip dispatch; watch latest run |

### 2 · Trigger from the GitHub Actions UI (alternative)

1. Go to **Actions → Start Ephemeral Server → Run workflow**.
2. Optionally set `duration_minutes` (1–60, default 10).
3. Watch the job log — the URL appears under the **Start Cloudflare tunnel** step:
   ```
   PUBLIC HTTP URL : https://xxxx.trycloudflare.com
   PUBLIC WSS URL  : wss://xxxx.trycloudflare.com/ws
   ```

### 3 · Run the agent on the target PC

```bash
pip install websockets pynput

python agent.py wss://xxxx.trycloudflare.com/agent
```

The agent reconnects automatically if the connection drops.

### 4 · Control from a browser

Open `https://xxxx.trycloudflare.com` in any browser. The xterm.js web terminal loads automatically. Once the agent connects, the **Agent ×1** badge turns green and every keystroke is forwarded to the target machine in real time.

### 4b · Control from the terminal (alternative)

```bash
pip install websockets

python client_example.py wss://xxxx.trycloudflare.com/ws
```

Every key you press is sent immediately — no Enter required. Press **Ctrl+Q** or **Ctrl+C** to quit.

---

## Running locally (development)

```bash
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```

Then open `http://localhost:8000` in a browser, and run the agent pointing at `ws://localhost:8000`.

---

## Wire protocol

### Browser / client → Server (`/ws`)

JSON text frames:

| Type | Fields | Description |
|---|---|---|
| `key` | `data: str` | Keystroke or escape sequence (xterm.js format) |
| `mouse_move` | `x, y: int` | Move cursor to absolute pixel position |
| `mouse_click` | `x, y: int`, `button: "left"\|"right"\|"middle"` | Click at position |
| `mouse_scroll` | `x, y: int`, `dx, dy: int` | Scroll at position |
| `pong` | — | Reply to server keepalive `ping` |

The server also accepts **raw binary CH9329 frames** from native apps (e.g. the KeyMod Qt app):

```
[0x57][0xAB][addr][cmd][len][payload...][checksum]
```

| CMD | Description | Payload |
|---|---|---|
| `0x02` | Keyboard | 8-byte HID report: modifier, 0x00, key×6 |
| `0x05` | Relative mouse | buttons, dx, dy, wheel (signed bytes) |
| `0x06` | Absolute mouse | buttons, x\_lo, x\_hi, y\_lo, y\_hi, wx, wy |

### Server → Browser

| Type | Fields | Description |
|---|---|---|
| `echo` | `data: str` | Echo of the keystroke for local display |
| `agent_status` | `count: int` | Number of connected agents |
| `ping` | — | Keepalive (reply with `pong`) |

---

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Web terminal UI |
| `GET` | `/status` | JSON: `{ "controllers": N, "agents": N }` |
| `WS` | `/ws` | Browser / client connection |
| `WS` | `/agent` | Target-PC agent connection |

---

## Dependencies

| Package | Used by |
|---|---|
| `fastapi` | Server |
| `uvicorn[standard]` | Server ASGI runner |
| `websockets` | Agent & client |
| `pynput` | Agent (keyboard/mouse input injection) |

Install all at once:
```bash
pip install -r requirements.txt
```

---

## Supported keys (agent)

- All printable characters and symbols
- Enter, Backspace, Tab, Escape, Space
- Arrow keys, Home, End, Page Up/Down, Delete
- F1–F12
- Ctrl+A through Ctrl+Z
- Modifier combos: Ctrl, Shift, Alt, Cmd (via CH9329 modifier byte)

> **macOS note:** `Insert` and `Num Lock` do not exist as pynput keys on macOS and are silently ignored.

---

## Security

This server is intentionally **ephemeral and unauthenticated** — it is designed to run for a short, controlled session inside a GitHub Actions job. Do **not** expose it permanently or on a public network without adding authentication.
