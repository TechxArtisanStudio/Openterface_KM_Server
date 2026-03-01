(() => {
  /* ------------------------------------------------------------------ */
  /* UI helpers                                                           */
  /* ------------------------------------------------------------------ */
  function focusPrimaryInput() {
    const masked = document.getElementById('masked-input');
    const plain = document.getElementById('text-input');
    const target = (masked && masked.style.display !== 'none') ? masked : plain;
    if (target) target.focus();
  }

  function banner(line) {
    const plain = String(line || '').replace(/\x1b\[[0-9;]*m/g, '').replace(/\r\n?|\n/g, ' ').trim();
    if (plain) console.debug('[KeyMod]', plain);
  }

  /* ------------------------------------------------------------------ */
  /* Stats                                                                */
  /* ------------------------------------------------------------------ */
  let sentCount  = 0;
  let connectedAt = null;
  let prevAgentCount = -1;   // -1 = unknown (fresh load)

  setInterval(() => {
    if (!connectedAt) return;
    const s = Math.floor((Date.now() - connectedAt) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    document.getElementById('sb-uptime').textContent = mm + ':' + ss;
  }, 1000);

  function incSent() {
    sentCount++;
    document.getElementById('sb-sent').textContent = sentCount;
  }

  /* ------------------------------------------------------------------ */
  /* WebSocket                                                            */
  /* ------------------------------------------------------------------ */
  const wsUrl = (location.protocol === 'https:' ? 'wss' : 'ws')
                + '://' + location.host + '/ws';
  let ws;
  let reconnectTimer;

  const serverPill  = document.getElementById('server-pill');
  const serverLabel = document.getElementById('server-label');
  const agentPill   = document.getElementById('agent-pill');
  const agentLabel  = document.getElementById('agent-label');
  const sbReconnect = document.getElementById('sb-reconnect');

  function setServerStatus(state) {   // 'ok' | 'bad' | 'wait'
    serverPill.className = 'pill ' + state;
    sbReconnect.style.display = (state === 'bad') ? '' : 'none';
    if (state === 'ok')   serverLabel.textContent = 'Connected';
    if (state === 'bad')  serverLabel.textContent = 'Disconnected';
    if (state === 'wait') serverLabel.textContent = 'Connecting\u2026';
  }

  function setAgentStatus(count) {
    const active = count > 0;
    agentPill.className = 'pill' + (active ? ' active' : '');
    agentLabel.textContent = active ? 'Agent \u00d7' + count : 'No agent';

    // only print banner on actual transitions, not on the initial status push
    if (prevAgentCount !== -1) {
      if (count > 0 && prevAgentCount === 0) {
        banner('\r\n\x1b[1;32m  \u2714 Agent connected \u2013 keyboard control is live.\x1b[0m\r');
      } else if (count === 0 && prevAgentCount > 0) {
        banner('\r\n\x1b[1;33m  \u26a0 Agent disconnected.\x1b[0m\r');
      }
    }
    prevAgentCount = count;
  }

  function connect() {
    setServerStatus('wait');
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      connectedAt = Date.now();
      prevAgentCount = -1;   // reset so next agent_status is treated as initial
      setServerStatus('ok');
      banner('\r\n\x1b[1;32m \u250f\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2513\x1b[0m');
      banner('\x1b[1;32m \u2503  KeyMod \u2013 Remote KM Control   \u2503\x1b[0m');
      banner('\x1b[1;32m \u2517\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u251b\x1b[0m');
      banner('\x1b[90m  Server connected. Type to send keystrokes to the target PC.\x1b[0m');
      banner('\x1b[90m  Press \x1b[37mF1\x1b[90m for help, \x1b[37mCtrl+L\x1b[90m to clear.\x1b[0m\r');
      // Fetch session timing (fallback for reconnects / direct page-load)
      fetchSessionInfo();
    };

    ws.onmessage = (evt) => {
      if (typeof evt.data !== 'string') return;
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'ping') {
          // reply to keepalive so the server knows we're still here
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:'pong'}));
          return;
        }
        if (msg.type === 'agent_status') {
          setAgentStatus(msg.count);
        } else if (msg.type === 'agent_platform') {
          // Agent has connected from a specific OS - auto-select it and update System tab
          const newOS = msg.platform;
          if (newOS && newOS !== 'unknown' && newOS !== targetOS) {
            targetOS = newOS;
            localStorage.setItem('km_target_os', targetOS);
            // Force a visual refresh of the System tab
            if (typeof renderSysTab !== 'undefined') {
              renderSysTab();
            }
            // Reset built-in macros to match the agent OS
            applyDefaultMacrosForOS(targetOS);
            // Update virtual keyboard Win/Cmd/Super label
            if (window._vkUpdateMetaLabel) window._vkUpdateMetaLabel();
            banner(`\r\n\x1b[0;36m  ✓ Switched to ${targetOS.toUpperCase()} shortcuts\x1b[0m\r\n`);
          }
        } else if (msg.type === 'session_info') {
          initCountdown(msg.expires_at, msg.duration_minutes);
        } else if (msg.type === 'window_title') {
          const wb = document.getElementById('sb-window');
          const wt = document.getElementById('sb-window-title');
          if (msg.title) {
            wt.textContent = msg.title;
            wb.style.display = '';
          } else {
            wb.style.display = 'none';
          }
        } else if (msg.type === 'ack') {
          if (_pendingAck.has(msg.id)) { _pendingAck.delete(msg.id); showAck(); }
        } else if (msg.type === 'screenshot') {
          const overlay = document.getElementById('screenshot-overlay');
          const img     = document.getElementById('screenshot-img');
          const spinner = document.getElementById('screenshot-spinner');
          const errDiv  = document.getElementById('screenshot-err');
          const meta    = document.getElementById('screenshot-meta');
          spinner.style.display = 'none';
          errDiv.style.display  = 'none';
          img.src = msg.data;
          img.style.display = 'block';
          meta.textContent = msg.width + '×' + msg.height;
          lastScreenshotData = msg;
          renderPinnedScreenshot(msg);
          img.style.display = 'block';
          meta.textContent = msg.width + '\u00d7' + msg.height;
          overlay.classList.add('show');
          lastScreenshotData = msg;  // store for pinning
        } else if (msg.type === 'screenshot_error') {
          const overlay = document.getElementById('screenshot-overlay');
          const spinner = document.getElementById('screenshot-spinner');
          const pinnedEmpty = document.getElementById('screenshot-pinned-empty');
          const pinnedMeta = document.getElementById('screenshot-pinned-meta');
          if (pinnedEmpty) {
            pinnedEmpty.textContent = '⚠ ' + (msg.error || 'Screenshot failed');
            pinnedEmpty.style.display = 'block';
          }
          if (pinnedMeta) pinnedMeta.textContent = '';
          overlay.classList.remove('show');
          spinner.style.display = 'none';
          errDiv.textContent    = '\u26a0 ' + (msg.error || 'Screenshot failed');
          errDiv.style.display  = 'block';
          overlay.classList.add('show');
        }
      } catch (_) {}
    };

    ws.onclose = () => {
      setServerStatus('bad');
      connectedAt = null;
      document.getElementById('sb-uptime').textContent = '\u2013\u2013:00';
      setAgentStatus(0);
      banner('\r\n\x1b[1;31m  \u2716 Connection lost. Reconnecting in 5 s\u2026\x1b[0m\r');
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 5000);
    };

    ws.onerror = () => ws.close();
  }

  connect();

  /* ------------------------------------------------------------------ */
  /* Toolbar buttons                                                      */
  /* ------------------------------------------------------------------ */

  const helpOverlay = document.getElementById('help-overlay');
  // Screenshot
  const screenshotOverlay = document.getElementById('screenshot-overlay');
  let lastScreenshotData  = null;  // store current screenshot for pinning

  function renderPinnedScreenshot(data) {
    const pinnedImg   = document.getElementById('screenshot-pinned-img');
    const pinnedMeta  = document.getElementById('screenshot-pinned-meta');
    const pinnedEmpty = document.getElementById('screenshot-pinned-empty');
    if (!pinnedImg || !pinnedMeta || !pinnedEmpty || !data) return;
    pinnedImg.src = data.data;
    pinnedImg.style.display = 'block';
    pinnedMeta.textContent = data.width + '×' + data.height;
    pinnedEmpty.style.display = 'none';
  }

  function clearPinnedScreenshot(message = 'Click Refresh to retrieve target screen') {
    const pinnedImg   = document.getElementById('screenshot-pinned-img');
    const pinnedMeta  = document.getElementById('screenshot-pinned-meta');
    const pinnedEmpty = document.getElementById('screenshot-pinned-empty');
    if (pinnedImg) {
      pinnedImg.removeAttribute('src');
      pinnedImg.style.display = 'none';
    }
    if (pinnedMeta) pinnedMeta.textContent = '';
    if (pinnedEmpty) {
      pinnedEmpty.textContent = message;
      pinnedEmpty.style.display = 'block';
    }
  }
  
  function requestPinnedScreenshot() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    clearPinnedScreenshot('Retrieving screenshot…');
    screenshotOverlay.classList.remove('show');
    ws.send(JSON.stringify({ type: 'screenshot_request' }));
    incSent();
  }
  document.getElementById('btn-screenshot').onclick = requestPinnedScreenshot;
  document.getElementById('btn-screenshot-refresh').onclick = requestPinnedScreenshot;
  
  // Pin button: copy screenshot to pinned section and close modal
  document.getElementById('btn-screenshot-pin').onclick = () => {
    if (!lastScreenshotData) return;
    renderPinnedScreenshot(lastScreenshotData);
    screenshotOverlay.classList.remove('show');
    focusPrimaryInput();
  };
  
  // Clear button: clear only the current image, keep top panel visible
  document.getElementById('btn-screenshot-unpin').onclick = () => {
    clearPinnedScreenshot();
    focusPrimaryInput();
  };
  
  // Refresh button in pinned section
  document.getElementById('btn-screenshot-refresh-pinned').onclick = requestPinnedScreenshot;
  document.getElementById('btn-screenshot-close').onclick = () => { screenshotOverlay.classList.remove('show'); focusPrimaryInput(); };
  screenshotOverlay.addEventListener('click', (e) => { if (e.target === screenshotOverlay) { screenshotOverlay.classList.remove('show'); focusPrimaryInput(); } });

  document.getElementById('btn-help').onclick      = () => { helpOverlay.classList.add('show'); };
  document.getElementById('btn-help-close').onclick = () => { helpOverlay.classList.remove('show'); focusPrimaryInput(); };
  helpOverlay.addEventListener('click', (e) => { if (e.target === helpOverlay) { helpOverlay.classList.remove('show'); focusPrimaryInput(); } });

  /* ------------------------------------------------------------------ */
  /* Global keyboard shortcuts                                            */
  /* ------------------------------------------------------------------ */
  const KEY_DEBUG = true;
  function keyLog(...args) {
    if (!KEY_DEBUG) return;
    console.debug('[KM-KEY]', ...args);
  }

  function isEditableTarget(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    if (el.isContentEditable) return true;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  function keyToToken(e) {
    const key = e.key;
    if (!key) return null;
    const lower = key.toLowerCase();

    if (/^f([1-9]|1[0-2])$/.test(lower)) return lower;

    const special = {
      control: 'ctrl',
      shift: 'shift',
      alt: 'alt',
      meta: 'meta',
      arrowup: 'up',
      arrowdown: 'down',
      arrowleft: 'left',
      arrowright: 'right',
      escape: 'esc',
      enter: 'enter',
      tab: 'tab',
      backspace: 'backspace',
      delete: 'delete',
      home: 'home',
      end: 'end',
      pageup: 'pgup',
      pagedown: 'pgdn',
      insert: 'insert',
      ' ': 'space',
    };
    if (special[lower]) return special[lower];
    if (key.length === 1) return lower;
    return null;
  }

  window.addEventListener('keydown', (e) => {
    keyLog('keydown', {
      key: e.key,
      code: e.code,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      shift: e.shiftKey,
      meta: e.metaKey,
      target: e.target && e.target.tagName,
    });

    if (e.key === 'F1') {
      e.preventDefault();
      helpOverlay.classList.toggle('show');
      keyLog('handled: help toggle');
      return;
    }

    if (isEditableTarget(e.target)) {
      keyLog('ignored: editable target');
      return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      keyLog('ignored: websocket not open', ws ? ws.readyState : 'no-ws');
      return;
    }

    const token = keyToToken(e);
    if (!token) {
      keyLog('ignored: no token mapping for key', e.key);
      return;
    }
    if (token === 'shift' || token === 'ctrl' || token === 'alt' || token === 'meta') {
      flashVkByToken(token);
      keyLog('ignored: modifier-only key', token);
      return;
    }

    const mods = [];
    if (e.ctrlKey) mods.push('ctrl');
    if (e.altKey) mods.push('alt');
    if (e.metaKey) mods.push('win');
    if (e.shiftKey && token.length > 1) mods.push('shift');

    if (mods.length > 0) {
      e.preventDefault();
      const combo = mods.concat(token).join('+');
      keyLog('sendHotkey from keydown', combo);
      sendHotkey(combo);
      return;
    }

    if (e.key.length === 1) {
      e.preventDefault();
      keyLog('sendRaw from keydown', JSON.stringify(e.key));
      sendRaw(e.key);
      return;
    }

    e.preventDefault();
    keyLog('sendHotkey from keydown', token);
    sendHotkey(token);
  }, true);

  /* ------------------------------------------------------------------ */
  /* Quick Keys                                                           */
  /* ------------------------------------------------------------------ */
  const QUICK_KEYS = {
    nav: [
      { label: '↑',    data: '\x1b[A' },
      { label: '↓',    data: '\x1b[B' },
      { label: '←',    data: '\x1b[D' },
      { label: '→',    data: '\x1b[C' },
      { label: 'Home', data: '\x1b[H' },
      { label: 'End',  data: '\x1b[F' },
      { label: 'PgUp', data: '\x1b[5~' },
      { label: 'PgDn', data: '\x1b[6~' },
      { label: 'Esc',  data: '\x1b'   },
      { label: 'Tab',  data: '\t'     },
      { label: '↵',    data: '\r',    title: 'Enter' },
      { label: '⌫',    data: '\x7f',  title: 'Backspace' },
    ],
    edit: [
      { label: 'Ctrl+C', data: '\x03' },
      { label: 'Ctrl+V', data: '\x16' },
      { label: 'Ctrl+X', data: '\x18' },
      { label: 'Ctrl+Z', data: '\x1a' },
      { label: 'Ctrl+A', data: '\x01' },
      { label: 'Ctrl+S', data: '\x13' },
      { label: 'Del',    data: '\x1b[3~' },
      { label: 'Ins',    data: '\x1b[2~' },
    ],
  };

  /* ------------------------------------------------------------------ */
  /* OS-specific System shortcuts                                        */
  /* ------------------------------------------------------------------ */
  const SYS_KEYS_BY_OS = {
    windows: [
      { label: 'Win',     hotkey: 'win',          title: 'Windows key' },
      { label: 'Win+D',   hotkey: 'win+d',        title: 'Show Desktop' },
      { label: 'Win+R',   hotkey: 'win+r',        title: 'Run dialog' },
      { label: 'Win+L',   hotkey: 'win+l',        title: 'Lock screen' },
      { label: 'Win+E',   hotkey: 'win+e',        title: 'File Explorer' },
      { label: 'Win+Tab', hotkey: 'win+tab',      title: 'Task View' },
      { label: 'C+A+D',   hotkey: 'ctrl+alt+del', title: 'Ctrl+Alt+Del' },
      { label: 'Alt+F4',  hotkey: 'alt+f4',       title: 'Close window' },
    ],
    macos: [
      { label: '\u2318Space',  hotkey: 'cmd+space',   title: 'Spotlight' },
      { label: '\u2318Tab',    hotkey: 'cmd+tab',     title: 'App Switcher' },
      { label: '\u2318Q',      hotkey: 'cmd+q',       title: 'Quit app' },
      { label: '\u2318H',      hotkey: 'cmd+h',       title: 'Hide window' },
      { label: '\u2318M',      hotkey: 'cmd+m',       title: 'Minimize' },
      { label: '\u2318W',      hotkey: 'cmd+w',       title: 'Close window' },
      { label: '\u2303\u2318Q', hotkey: 'ctrl+cmd+q', title: 'Lock screen' },
      { label: '\u2318\u2325Esc', hotkey: 'cmd+opt+esc', title: 'Force Quit' },
    ],
    linux: [
      { label: 'Super',   hotkey: 'super',        title: 'Activities / launcher' },
      { label: 'Super+D', hotkey: 'super+d',      title: 'Show Desktop' },
      { label: 'C+A+T',   hotkey: 'ctrl+alt+t',   title: 'Open Terminal' },
      { label: 'C+A+L',   hotkey: 'ctrl+alt+l',   title: 'Lock screen' },
      { label: 'C+A+D',   hotkey: 'ctrl+alt+del', title: 'Log out' },
      { label: 'Alt+F4',  hotkey: 'alt+f4',       title: 'Close window' },
      { label: 'Alt+Tab', hotkey: 'alt+tab',      title: 'Switch windows' },
      { label: 'PrtSc',   hotkey: 'prtsc',        title: 'Screenshot' },
    ],
  };

  let targetOS = localStorage.getItem('km_target_os') || 'unknown';

  /* ------------------------------------------------------------------ */
  /* Session countdown                                                    */
  /* ------------------------------------------------------------------ */
  let _countdownTimer = null;
  let _warnedAt5 = false;
  let _warnedAt1 = false;

  function initCountdown(expiresAt, durationMinutes) {
    const expiry = new Date(expiresAt).getTime();
    if (isNaN(expiry)) return;
    document.getElementById('sb-session-wrap').style.display = '';
    clearInterval(_countdownTimer);
    _warnedAt5 = false;
    _warnedAt1 = false;

    function tick() {
      const remaining = Math.max(0, Math.round((expiry - Date.now()) / 1000));
      const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
      const ss = String(remaining % 60).padStart(2, '0');
      const el = document.getElementById('sb-session');

      if (remaining <= 0) {
        el.textContent = 'Ended';
        el.className = 'ended';
        clearInterval(_countdownTimer);
        banner('\r\n\x1b[1;31m  ⚠  Session has ended – the GitHub Actions runner has stopped.\x1b[0m\r');
        return;
      }

      el.textContent = mm + ':' + ss;

      if (remaining <= 120) {
        el.className = 'urgent';
        if (!_warnedAt1) {
          _warnedAt1 = true;
          banner('\r\n\x1b[1;31m  ⚠  Less than 2 minutes left in this session!\x1b[0m\r');
        }
      } else if (remaining <= 300) {
        el.className = 'warn';
        if (!_warnedAt5) {
          _warnedAt5 = true;
          banner('\r\n\x1b[1;33m  ⚠  5 minutes remaining in this session.\x1b[0m\r');
        }
      } else {
        el.className = 'ok';
      }
    }

    tick();
    _countdownTimer = setInterval(tick, 1000);
  }

  /* Fallback: fetch /session-info once after connecting (catches page-reload case) */
  function fetchSessionInfo() {
    fetch('/session-info').then(r => r.json()).then(d => {
      if (d.expires_at) initCountdown(d.expires_at, d.duration_minutes);
    }).catch(() => {});
  }

  /* ------------------------------------------------------------------ */
  /* Panel collapse / expand (VS Code-style)                             */
  /* ------------------------------------------------------------------ */
  const _PANEL_DEFAULTS = {
    'sec-qkeys': true,
    'sec-send':  true,
    'sec-hist':  true,
    'sec-macros':true,
  };

  function initPanels() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('km_panels') || '{}'); } catch(e) {}
    const state = Object.assign({}, _PANEL_DEFAULTS, saved);
    Object.keys(_PANEL_DEFAULTS).forEach(id => {
      const sec = document.getElementById(id);
      if (!sec) return;
      if (!state[id]) sec.classList.add('collapsed');
    });
  }

  // Exposed globally so inline onclick="toggleSection(...)" handlers can reach it
  window.toggleSection = function toggleSection(id) {
    const sec = document.getElementById(id);
    if (!sec) return;
    sec.classList.toggle('collapsed');
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('km_panels') || '{}'); } catch(e) {}
    saved[id] = !sec.classList.contains('collapsed');
    localStorage.setItem('km_panels', JSON.stringify(saved));
  };

  let _msgId = 0;
  const _pendingAck = new Map();
  let _ackHideTimer = null;

  function nextMsgId() { return 'k' + (++_msgId); }

  function showAck() {
    const el = document.getElementById('sb-ack');
    el.style.display = '';
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    clearTimeout(_ackHideTimer);
    _ackHideTimer = setTimeout(() => { el.style.display = 'none'; }, 2200);
  }

  function flashVkByToken(token) {
    if (!token) return;
    const t = String(token).trim().toLowerCase();
    const vkbd = document.getElementById('vkbd');
    if (!vkbd) return;

    let nodes = [];
    if (t === 'win' || t === 'super' || t === 'cmd' || t === 'meta') {
      nodes = [...vkbd.querySelectorAll('.vkbd-key[data-mod="meta"]')];
    } else if (t === 'ctrl') {
      nodes = [...vkbd.querySelectorAll('.vkbd-key[data-mod="ctrl"]')];
    } else if (t === 'alt' || t === 'opt' || t === 'option') {
      nodes = [...vkbd.querySelectorAll('.vkbd-key[data-mod="alt"]')];
    } else if (t === 'shift') {
      nodes = [...vkbd.querySelectorAll('.vkbd-key[data-mod="shift"]')];
    } else {
      const normalized = (t === 'space') ? ' ' : t;
      const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(normalized) : normalized;
      nodes = [...vkbd.querySelectorAll(`.vkbd-key[data-key="${escaped}"]`)];
      if (!nodes.length && normalized.length === 1) {
        const lower = normalized.toLowerCase();
        const escapedLower = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(lower) : lower;
        nodes = [...vkbd.querySelectorAll(`.vkbd-key[data-key="${escapedLower}"]`)];
      }
    }

    nodes.forEach((el) => {
      el.classList.add('active');
      setTimeout(() => el.classList.remove('active'), 130);
    });
  }

  function flashVkByCombo(combo) {
    if (!combo) return;
    String(combo)
      .split('+')
      .map(s => s.trim())
      .filter(Boolean)
      .forEach(flashVkByToken);
  }

  function flashVkByRawData(data) {
    const raw = String(data ?? '');
    const map = {
      '\x1b[A': ['up'],
      '\x1b[B': ['down'],
      '\x1b[C': ['right'],
      '\x1b[D': ['left'],
      '\x1b[H': ['home'],
      '\x1b[F': ['end'],
      '\x1b[5~': ['pgup'],
      '\x1b[6~': ['pgdn'],
      '\x1b[3~': ['delete'],
      '\x1b[2~': ['insert'],
      '\x1b': ['esc'],
      '\t': ['tab'],
      '\r': ['enter'],
      '\x7f': ['backspace'],
    };
    if (map[raw]) {
      map[raw].forEach(flashVkByToken);
      return;
    }
    if (raw.length === 1) flashVkByToken(raw);
  }

  function sendRaw(data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const id = nextMsgId();
    keyLog('tx key', { id, data });
    ws.send(JSON.stringify({ type: 'key', data, id }));
    _pendingAck.set(id, true);
    incSent();
    flashVkByRawData(data);
  }

  function sendHotkey(combo) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const id = nextMsgId();
    keyLog('tx hotkey', { id, combo });
    ws.send(JSON.stringify({ type: 'hotkey', combo, id }));
    _pendingAck.set(id, true);
    incSent();
    flashVkByCombo(combo);
  }

  function buildQuickGrid(tabId, keys) {
    const grid = document.getElementById('qtab-' + tabId);
    keys.forEach(k => {
      const btn = document.createElement('button');
      btn.className = 'qkey';
      btn.textContent = k.label;
      if (k.title) btn.title = k.title;
      btn.addEventListener('click', () => {
        if (k.hotkey) sendHotkey(k.hotkey);
        else          sendRaw(k.data);
        focusPrimaryInput();
      });
      grid.appendChild(btn);
    });
  }

  function renderSysTab() {
    const osSel = document.getElementById('os-selector');
    const grid  = document.getElementById('qtab-sys-grid');

    // Rebuild OS selector pills
    osSel.innerHTML = '';
    [['windows', '\uD83E\uDEDF Windows'], ['macos', '\uD83C\uDF4E macOS'], ['linux', '\uD83D\uDC27 Linux']].forEach(([id, lbl]) => {
      const btn = document.createElement('button');
      btn.className = 'os-pill' + (targetOS === id ? ' active' : '');
      btn.textContent = lbl;
      btn.addEventListener('click', () => {
        targetOS = id;
        localStorage.setItem('km_target_os', targetOS);
        applyDefaultMacrosForOS(targetOS);
        renderSysTab();
        if (window._vkUpdateMetaLabel) window._vkUpdateMetaLabel();
        focusPrimaryInput();
      });
      osSel.appendChild(btn);
    });

    // Rebuild key grid
    grid.innerHTML = '';
    
    // If we haven't detected the platform yet, show a placeholder
    if (targetOS === 'unknown') {
      const msg = document.createElement('div');
      msg.style.padding = '20px';
      msg.style.textAlign = 'center';
      msg.style.color = '#888';
      msg.textContent = 'Select your OS or connect an agent to auto-detect\u2026';
      grid.appendChild(msg);
      return;
    }
    
    (SYS_KEYS_BY_OS[targetOS] || []).forEach(k => {
      const btn = document.createElement('button');
      btn.className = 'qkey';
      btn.textContent = k.label;
      if (k.title) btn.title = k.title;
      btn.addEventListener('click', () => {
        if (k.hotkey) sendHotkey(k.hotkey);
        else          sendRaw(k.data);
        focusPrimaryInput();
      });
      grid.appendChild(btn);
    });
  }

  ['nav', 'edit'].forEach(id => buildQuickGrid(id, QUICK_KEYS[id]));
  renderSysTab();

  document.querySelectorAll('.qtab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.qtab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.quick-grid, .sys-panel').forEach(g => g.classList.add('hidden'));
      tab.classList.add('active');
      document.getElementById('qtab-' + tab.dataset.tab).classList.remove('hidden');
    });
  });

        focusPrimaryInput();
  /* Send history                                                         */
  /* ------------------------------------------------------------------ */
  const MAX_HISTORY = 20;
  let sendHistory = [];
  try { sendHistory = JSON.parse(localStorage.getItem('km_history') || '[]'); } catch (_) {}

  function fmtTime(ts) {
    const d = new Date(ts);
    return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
  }

  function renderHistory() {
    const list = document.getElementById('hist-list');
    const cnt  = document.getElementById('hist-count');
    list.innerHTML = '';
    cnt.textContent = sendHistory.length ? sendHistory.length : '';
    if (!sendHistory.length) {
      list.innerHTML = '<div id="hist-empty">No history yet</div>';
      return;
    }
    // newest first
    [...sendHistory].reverse().forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'hist-item';
      row.innerHTML =
        `<span class="hist-ts">${fmtTime(entry.ts)}</span>` +
        `<span class="hist-text" title="${entry.text.replace(/"/g,'&quot;')}">${entry.text}</span>` +
        `<button class="hist-resend" title="Re-send">↑</button>`;
      row.querySelector('.hist-resend').addEventListener('click', () => {
        const data = entry.text.replace(/\r?\n/g, '\r');
        sendRaw(data);
        banner('\x1b[90m  ↑ Re-sent: ' + entry.text.slice(0,40).replace(/\r/g,'↵') + '\x1b[0m');
      });
      list.appendChild(row);
    });
  }

  function pushHistory(text) {
    // Deduplicate: move to top if already exists
    sendHistory = sendHistory.filter(e => e.text !== text);
    sendHistory.push({ ts: Date.now(), text });
    if (sendHistory.length > MAX_HISTORY) sendHistory.shift();
    try { localStorage.setItem('km_history', JSON.stringify(sendHistory)); } catch (_) {}
    renderHistory();
  }

  renderHistory();

  /* ------------------------------------------------------------------ */
  /* Input templates                                                      */
  /* ------------------------------------------------------------------ */
  const TEMPLATES = [
    { label: 'IP addr',        text: '192.168.1.' },
    { label: 'sudo …',          text: 'sudo ' },
    { label: 'apt install',    text: 'sudo apt-get install -y ' },
    { label: 'SSH connect',    text: 'ssh user@host' },
    { label: 'python3 run',    text: 'python3 script.py' },
    { label: 'docker ps',      text: 'docker ps -a' },
    { label: 'Win+R: cmd',     text: 'cmd' },
    { label: 'Win+R: notepad', text: 'notepad' },
  ];

  const tplSelect = document.getElementById('tpl-select');
  TEMPLATES.forEach(t => {
    const o = document.createElement('option');
    o.value = t.text; o.textContent = t.label;
    tplSelect.appendChild(o);
  });
  tplSelect.addEventListener('change', () => {
    if (!tplSelect.value) return;
    const target = maskOn ? maskedInput : textInput;
    target.value = tplSelect.value;
    target.focus();
    target.setSelectionRange(target.value.length, target.value.length);
    tplSelect.value = '';
  });

  /* ------------------------------------------------------------------ */
  /* Mask mode                                                            */
  /* ------------------------------------------------------------------ */
  const maskedInput = document.getElementById('masked-input');
  const btnMask     = document.getElementById('btn-mask');
  let maskOn = false;

  btnMask.addEventListener('click', () => {
    maskOn = !maskOn;
    btnMask.classList.toggle('on', maskOn);
    btnMask.title = maskOn ? 'Disable password mask' : 'Enable password mask';
    if (maskOn) {
      maskedInput.value = textInput.value;
      textInput.style.display = 'none';
      maskedInput.style.display = '';
      maskedInput.focus();
    } else {
      textInput.value = maskedInput.value;
      maskedInput.style.display = 'none';
      textInput.style.display = '';
      textInput.focus();
    }
  });

  maskedInput.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); sendText(); }
    e.stopPropagation();
  });

  /* ------------------------------------------------------------------ */
  /* Macros                                                               */
  /* ------------------------------------------------------------------ */
  const DEFAULT_MACROS_BY_OS = {
    windows: [
      { id:'dm1', name:'Show Desktop',  steps:[{t:'hotkey',v:'win+d'}] },
      { id:'dm2', name:'Open Run…',     steps:[{t:'hotkey',v:'win+r'}] },
      { id:'dm3', name:'Open Notepad',  steps:[{t:'hotkey',v:'win+r'},{t:'wait',v:'500'},{t:'key',v:'notepad\r'}] },
      { id:'dm4', name:'Open Terminal', steps:[{t:'hotkey',v:'win+r'},{t:'wait',v:'500'},{t:'key',v:'cmd\r'}] },
      { id:'dm5', name:'Lock Screen',   steps:[{t:'hotkey',v:'win+l'}] },
    ],
    macos: [
      { id:'dm1', name:'Spotlight',     steps:[{t:'hotkey',v:'cmd+space'}] },
      { id:'dm2', name:'App Switcher',  steps:[{t:'hotkey',v:'cmd+tab'}] },
      { id:'dm3', name:'Open Terminal', steps:[{t:'hotkey',v:'cmd+space'},{t:'wait',v:'500'},{t:'key',v:'terminal\r'}] },
      { id:'dm4', name:'Lock Screen',   steps:[{t:'hotkey',v:'ctrl+cmd+q'}] },
      { id:'dm5', name:'Force Quit',    steps:[{t:'hotkey',v:'cmd+opt+esc'}] },
    ],
    linux: [
      { id:'dm1', name:'Show Desktop',  steps:[{t:'hotkey',v:'super+d'}] },
      { id:'dm2', name:'Open Terminal', steps:[{t:'hotkey',v:'ctrl+alt+t'}] },
      { id:'dm3', name:'Lock Screen',   steps:[{t:'hotkey',v:'ctrl+alt+l'}] },
      { id:'dm4', name:'App Launcher',  steps:[{t:'hotkey',v:'super'}] },
      { id:'dm5', name:'Switch Window', steps:[{t:'hotkey',v:'alt+tab'}] },
    ],
  };

  function getDefaultMacros(os) {
    return (DEFAULT_MACROS_BY_OS[os] || DEFAULT_MACROS_BY_OS.windows).map(m => ({...m, steps: m.steps.map(s => ({...s}))}));
  }

  let macros = [];
  try { macros = JSON.parse(localStorage.getItem('km_macros') || 'null') || getDefaultMacros(targetOS === 'unknown' ? 'windows' : targetOS); }
  catch (_) { macros = getDefaultMacros(targetOS === 'unknown' ? 'windows' : targetOS); }

  // Replace built-in default macros (id starts with 'dm') with OS-specific ones,
  // preserving any user-added macros
  function applyDefaultMacrosForOS(os) {
    const newDefaults = getDefaultMacros(os);
    const userMacros = macros.filter(m => !m.id.startsWith('dm'));
    macros = [...newDefaults, ...userMacros];
    saveMacroData();
    renderMacroList();
  }

  function saveMacroData() {
    try { localStorage.setItem('km_macros', JSON.stringify(macros)); } catch (_) {}
  }

  function escForEdit(s)   { return s.replace(/\r/g,'\\r').replace(/\t/g,'\\t'); }
  function unescFromEdit(s){ return s.replace(/\\r/g,'\r').replace(/\\t/g,'\t').replace(/\\n/g,'\r'); }

  function renderMacroList() {
    const list = document.getElementById('macro-list');
    list.innerHTML = '';
    if (!macros.length) {
      list.innerHTML = '<div class="macro-empty">No macros yet</div>';
      return;
    }
    macros.forEach(m => {
      const row = document.createElement('div');
      row.className = 'macro-row';
      row.innerHTML =
        `<button class="macro-run" title="Run: ${m.name}">${m.name}</button>` +
        `<button class="macro-icon-btn" title="Edit">✎</button>` +
        `<button class="macro-icon-btn" title="Delete" style="color:var(--accent)">×</button>`;
      row.querySelector('.macro-run').addEventListener('click', () => runMacroById(m.id));
      row.querySelectorAll('.macro-icon-btn')[0].addEventListener('click', () => openMacroEditor(m));
      row.querySelectorAll('.macro-icon-btn')[1].addEventListener('click', () => {
        if (!confirm(`Delete macro "${m.name}"?`)) return;
        macros = macros.filter(x => x.id !== m.id);
        saveMacroData(); renderMacroList();
      });
      list.appendChild(row);
    });
  }

  async function runMacroById(id) {
    const m = macros.find(x => x.id === id);
    if (!m) return;
    banner(`\x1b[90m  ▶ ${m.name}\x1b[0m`);
    for (const step of m.steps) {
      if      (step.t === 'key')    sendRaw(step.v);
      else if (step.t === 'hotkey') sendHotkey(step.v);
      else if (step.t === 'wait')   await new Promise(r => setTimeout(r, Math.max(0, Number(step.v) || 500)));
    }
    banner(`\x1b[90m  \u2714 Done: ${m.name}\x1b[0m`);
  }

  // ----- Macro editor -----
  const macroOverlay = document.getElementById('macro-overlay');
  let macroEditId = null;

  function openMacroEditor(macro) {
    macroEditId = macro ? macro.id : null;
    document.getElementById('macro-modal-title').textContent = macro ? 'Edit Macro' : 'New Macro';
    document.getElementById('macro-name').value = macro ? macro.name : '';
    const stepsEl = document.getElementById('msteps-list');
    stepsEl.innerHTML = '';
    if (macro) {
      macro.steps.forEach(s => addMstepRow(s.t, s.t === 'key' ? escForEdit(s.v) : s.v));
    } else {
      addMstepRow('hotkey', 'win+r');
      addMstepRow('wait', '400');
      addMstepRow('key', '');
    }
    macroOverlay.classList.add('show');
    document.getElementById('macro-name').focus();
  }

  function closeMacroEditor() { macroOverlay.classList.remove('show'); macroEditId = null; }

  function addMstepRow(type, value) {
    const stepsEl = document.getElementById('msteps-list');
    const row = document.createElement('div'); row.className = 'mstep';
    const sel = document.createElement('select'); sel.className = 'mstep-type';
    [{v:'key',l:'Key text'},{v:'hotkey',l:'Hotkey'},{v:'wait',l:'Wait ms'}].forEach(o => {
      const opt = document.createElement('option'); opt.value = o.v; opt.textContent = o.l;
      if (o.v === type) opt.selected = true;
      sel.appendChild(opt);
    });
    const inp = document.createElement('input'); inp.className = 'mstep-val'; inp.type = 'text';
    const placeholders = { key:'hello world\\r', hotkey:'win+r', wait:'500' };
    inp.placeholder = placeholders[type] || '';
    inp.value = value || '';
    sel.addEventListener('change', () => { inp.placeholder = placeholders[sel.value] || ''; });
    const del = document.createElement('button'); del.className = 'mstep-del'; del.textContent = '×';
    del.addEventListener('click', () => row.remove());
    row.append(sel, inp, del);
    stepsEl.appendChild(row);
  }

  document.getElementById('btn-macro-new').addEventListener('click', () => openMacroEditor(null));
  document.getElementById('btn-macro-close').addEventListener('click', closeMacroEditor);
  document.getElementById('btn-macro-cancel').addEventListener('click', closeMacroEditor);
  macroOverlay.addEventListener('click', e => { if (e.target === macroOverlay) closeMacroEditor(); });
  document.getElementById('mstep-add-key').addEventListener('click', () => addMstepRow('key', ''));
  document.getElementById('mstep-add-hotkey').addEventListener('click', () => addMstepRow('hotkey', ''));
  document.getElementById('mstep-add-wait').addEventListener('click', () => addMstepRow('wait', '500'));

  document.getElementById('btn-macro-save').addEventListener('click', () => {
    const name = document.getElementById('macro-name').value.trim();
    if (!name) { alert('Please enter a macro name.'); return; }
    const stepRows = document.querySelectorAll('#msteps-list .mstep');
    const steps = [];
    stepRows.forEach(row => {
      const t = row.querySelector('.mstep-type').value;
      const v = row.querySelector('.mstep-val').value;
      if (!v) return;
      steps.push({ t, v: t === 'key' ? unescFromEdit(v) : v });
    });
    if (!steps.length) { alert('Add at least one step with a value.'); return; }
    if (macroEditId) {
      const idx = macros.findIndex(m => m.id === macroEditId);
      if (idx >= 0) macros[idx] = { id: macroEditId, name, steps };
    } else {
      macros.push({ id: 'u' + Date.now(), name, steps });
    }
    saveMacroData(); renderMacroList(); closeMacroEditor();
  });

  initPanels();
  renderMacroList();

  /* ------------------------------------------------------------------ */
  /* Send-text panel                                                      */
  /* ------------------------------------------------------------------ */
  const textInput   = document.getElementById('text-input');
  const btnSendText = document.getElementById('btn-send-text');

  function sendText() {
    const activeInput = maskOn ? maskedInput : textInput;
    const raw = activeInput.value.trim();
    if (!raw || !ws || ws.readyState !== WebSocket.OPEN) return;
    const data = raw.replace(/\r?\n/g, '\r');
    activeInput.value = '';   // clear immediately so UI feels responsive
    activeInput.focus();
    sendRaw(data);
    if (!maskOn) pushHistory(raw);  // never save passwords to history
  }

  btnSendText.addEventListener('click', sendText);

  textInput.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); sendText(); }
  });

  // Prevent global shortcuts while textarea is focused
  textInput.addEventListener('keydown', (e) => e.stopPropagation());

  /* auto-focus input on load */
  focusPrimaryInput();

  /* ------------------------------------------------------------------ */
  /* Virtual Keyboard                                                     */
  /* ------------------------------------------------------------------ */
  (function initVirtualKeyboard() {
    // Active modifier keys (ctrl, shift, alt, meta)
    const _vkMods = new Set();

    // Modifier key mappings per OS
    const META_LABEL = () => {
      if (targetOS === 'macos')  return '⌘ Cmd';
      if (targetOS === 'linux')  return '❖ Super';
      return '⊞ Win';
    };

    function updateMetaLabel() {
      document.querySelectorAll('.vkbd-key[data-mod="meta"]').forEach(el => {
        el.textContent = META_LABEL();
      });
    }

    function toggleMod(modName) {
      if (_vkMods.has(modName)) {
        // Second click on an already-staged modifier → send it as a standalone
        // key press (e.g. Alt alone to open a menu bar) then clear.
        _vkMods.delete(modName);
        refreshModHighlights();
        const agentKey = modName === 'meta' ? 'win' : modName;
        sendHotkey(agentKey);
      } else {
        _vkMods.add(modName);
        refreshModHighlights();
      }
    }

    function refreshModHighlights() {
      document.querySelectorAll('.vkbd-key[data-mod]').forEach(el => {
        const mod = el.dataset.mod;
        el.classList.toggle('mod-on', _vkMods.has(mod));
      });
    }

    function sendVkKey(keyName) {
      if (!keyName) return;
      const parts = [..._vkMods];
      // map 'meta' → agent-recognised name
      const mapped = parts.map(m => m === 'meta' ? 'win' : m);
      mapped.push(keyName === ' ' ? 'space' : keyName);
      const combo = mapped.join('+');
      sendHotkey(combo);
      // auto-release mods after use (non-caps)
      _vkMods.clear();
      refreshModHighlights();
    }

    // Attach click handlers to all virtual keys
    function attachVkHandlers() {
      const vkbd = document.getElementById('vkbd');
      if (!vkbd) return;

      vkbd.querySelectorAll('.vkbd-key').forEach(el => {
        el.addEventListener('click', () => {
          const mod = el.dataset.mod;
          if (mod) {
            toggleMod(mod);
          } else {
            const key = el.dataset.key;
            // If shift is active and key has a shift label, use shifted char
            if (_vkMods.has('shift') && el.dataset.shift) {
              _vkMods.delete('shift');
              sendHotkey(el.dataset.shift);
              refreshModHighlights();
            } else {
              sendVkKey(key);
            }
          }
        });

        // Show shift label if key has one
        if (el.dataset.shift) {
          const mainLabel = el.dataset.label || el.dataset.key;
          el.innerHTML = `<span class="vkbd-shift-label">${el.dataset.shift}</span>${mainLabel}`;
        } else {
          el.textContent = el.dataset.label || el.dataset.key || '';
        }
      });
    }

    // Keyboard-first default layout (terminal stays hidden)
    const vkbdEl  = document.getElementById('vkbd');

    let handlersAttached = false;

    if (vkbdEl) {
      vkbdEl.classList.remove('hidden');
      updateMetaLabel();
      if (!handlersAttached) {
        attachVkHandlers();
        handlersAttached = true;
      }
      refreshModHighlights();
    }

    // Re-label Win/Cmd/Super when OS changes
    const _origRenderSysTab = typeof renderSysTab === 'function' ? renderSysTab : null;
    window._vkUpdateMetaLabel = updateMetaLabel;
  })();
})();
