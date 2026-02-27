#!/usr/bin/env python3
"""
Mock agent – connects to /agent and acts like a terminal.
Accumulates keystrokes, executes commands on Enter, sends output back to browser.
"""

import asyncio
import json
import sys
import subprocess
import os
from pathlib import Path

SERVER_URL = "ws://localhost:8000/agent"


class SimpleTerminal:
    """Simulates a simple shell that executes commands and captures output."""
    
    def __init__(self):
        self.command_buffer = ""
        self.cwd = str(Path.home())
    
    def process_key(self, data: str) -> tuple[bool, str]:
        """
        Process a single keystroke.
        Returns (is_command_complete, output_to_send)
        
        Special keys:
          '\\r' or '\\n' = Enter → execute command
          '\\x7f' or '\\x08' = Backspace → remove last char
          '\\x03' = Ctrl+C → cancel line
        """
        # Handle special keys
        if data == '\x7f' or data == '\x08':  # Backspace
            if self.command_buffer:
                self.command_buffer = self.command_buffer[:-1]
                return False, '\x08 \x08'  # Backspace + space + backspace to erase
        elif data == '\x03':  # Ctrl+C
            self.command_buffer = ""
            return False, '^C\r\n'
        elif data in ('\r', '\n', '\r\n'):  # Enter
            cmd = self.command_buffer
            self.command_buffer = ""
            output = self.execute_command(cmd)
            return True, output
        elif data == '\t':  # Tab – ignored for simplicity
            return False, ""
        else:
            # Regular character – add to buffer
            self.command_buffer += data
            return False, data  # Echo back for display
    
    def execute_command(self, cmd: str) -> str:
        """Execute a shell command and return output."""
        if not cmd.strip():
            return self.get_prompt()
        
        try:
            # Simple approach: run common shell commands
            if cmd.strip() == 'pwd':
                return f"{self.cwd}\n{self.get_prompt()}"
            elif cmd.strip() == 'clear':
                return '\x1b[2J\x1b[H'  # ANSI clear screen
            elif cmd.startswith('cd '):
                new_dir = cmd[3:].strip()
                if new_dir == '~':
                    new_dir = str(Path.home())
                try:
                    os.chdir(new_dir)
                    self.cwd = os.getcwd()
                    return self.get_prompt()
                except (FileNotFoundError, OSError) as e:
                    return f"cd: {e}\n{self.get_prompt()}"
            elif cmd.strip() == 'whoami':
                return f"{os.getenv('USER', 'user')}\n{self.get_prompt()}"
            elif cmd.strip() == 'ls' or cmd.startswith('ls '):
                try:
                    result = subprocess.run(
                        cmd,
                        shell=True,
                        cwd=self.cwd,
                        capture_output=True,
                        text=True,
                        timeout=3
                    )
                    output = (result.stdout or "") + (result.stderr or "")
                    return output + self.get_prompt()
                except Exception as e:
                    return f"Error: {e}\n{self.get_prompt()}"
            else:
                # Try to execute as shell command
                try:
                    result = subprocess.run(
                        cmd,
                        shell=True,
                        cwd=self.cwd,
                        capture_output=True,
                        text=True,
                        timeout=3
                    )
                    output = (result.stdout or "") + (result.stderr or "")
                    if not output:
                        output = f"\n"
                    return output + self.get_prompt()
                except subprocess.TimeoutExpired:
                    return f"Command timed out\n{self.get_prompt()}"
                except Exception as e:
                    return f"{cmd}: command not found\n{self.get_prompt()}"
        except Exception as e:
            return f"Error: {e}\n{self.get_prompt()}"
    
    def get_prompt(self) -> str:
        """Return the shell prompt."""
        user = os.getenv('USER', 'user')
        host = os.getenv('HOSTNAME', 'agent')
        cwd_short = self.cwd.replace(str(Path.home()), '~')
        return f"{user}@{host}:{cwd_short}$ "


async def run(url: str):
    """Connect to server and handle terminal interaction."""
    try:
        import websockets
    except ImportError:
        print("ERROR: 'websockets' package not found.  Run: pip install websockets")
        sys.exit(1)

    terminal = SimpleTerminal()
    
    print(f"Connecting to {url} …")
    try:
        async with websockets.connect(url) as ws:
            print("Connected as terminal agent.  Type commands (Ctrl-C to quit).\n")
            
            # Send initial prompt
            initial = terminal.get_prompt()
            await ws.send(json.dumps({"type": "terminal_output", "data": initial}))
            
            async for message in ws:
                if isinstance(message, str):
                    try:
                        obj = json.loads(message)
                        msg_type = obj.get("type")
                        
                        if msg_type == "ping":
                            # Reply to keepalive ping
                            await ws.send(json.dumps({"type": "pong"}))
                        
                        elif msg_type == "key":
                            # Process keystroke
                            data = obj.get("data", "")
                            is_complete, output = terminal.process_key(data)
                            
                            if output:
                                # Send output back to browser
                                await ws.send(json.dumps({
                                    "type": "terminal_output",
                                    "data": output
                                }))
                        
                        elif msg_type == "agent_status":
                            # Status message – ignore
                            pass
                        
                        else:
                            print(f"Unknown message type: {msg_type}")
                    
                    except json.JSONDecodeError:
                        pass
                
                elif isinstance(message, bytes):
                    # Binary message – ignore for terminal mode
                    pass
    
    except (OSError, Exception) as exc:
        print(f"Error: {exc}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nDisconnected.")


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else SERVER_URL
    asyncio.run(run(url))
