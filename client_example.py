#!/usr/bin/env python3
"""
KeyMod – raw WebSocket test client (for debugging only).

For normal use, open the server URL in a browser – the web terminal UI
is served automatically at GET /.

To run the target-PC agent instead, use agent.py:
  python agent.py wss://xxxx.trycloudflare.com

Usage (raw test client)
-----------------------
  pip install websockets

  python client_example.py wss://xxxx.trycloudflare.com/ws
  # or for local:
  python client_example.py ws://localhost:8000/ws

JSON commands you can paste to test:
  {"type": "key", "data": "hello"}
  {"type": "mouse_move", "x": 500, "y": 300}
  {"type": "mouse_click", "x": 500, "y": 300, "button": "left"}

Type  /quit  or press Ctrl-C to exit.
"""

import asyncio
import sys
import threading

import websockets


async def receive_loop(ws: websockets.WebSocketClientProtocol) -> None:
    """Print incoming messages from the server."""
    try:
        async for message in ws:
            print(f"\n[server] {message}")
            print("> ", end="", flush=True)
    except websockets.ConnectionClosed:
        print("\n[connection closed by server]")


async def send_loop(ws: websockets.WebSocketClientProtocol) -> None:
    """Read stdin lines and send them to the server."""
    loop = asyncio.get_event_loop()
    while True:
        # read_line runs in a thread so it doesn't block the event loop
        line: str = await loop.run_in_executor(None, lambda: input("> "))
        line = line.strip()
        if line.lower() == "/quit":
            await ws.close()
            break
        if line:
            await ws.send(line)


async def main(url: str) -> None:
    print(f"Connecting to {url} …")
    try:
        async with websockets.connect(url) as ws:
            print("Connected!  Type a message and press Enter.  /quit to exit.\n")
            await asyncio.gather(
                receive_loop(ws),
                send_loop(ws),
                return_exceptions=True,
            )
    except (websockets.WebSocketException, OSError) as exc:
        print(f"[error] {exc}")
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    asyncio.run(main(sys.argv[1]))
