import { createWsManager } from './modules/ws.js';
import { createKeyboardModule } from './modules/keyboard.js';
import { createScreenshotModule } from './modules/screenshot.js';
import { createMacrosModule } from './modules/macros.js';

(() => {
  /* ------------------------------------------------------------------ */
  /* UI helpers                                                         */
  /* ------------------------------------------------------------------ */
  function focusPrimaryInput() {
    const masked = document.getElementById('masked-input');
    const plain = document.getElementById('text-input');
    const target = (masked && masked.style.display !== 'none') ? masked : plain;
    if (target) target.focus();
  }

  function banner(line) {
    const plain = String(line || '')
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/\r\n?|\n/g, ' ')
      .trim();
    if (plain) console.debug('[KeyMod]', plain);
  }

  const KEY_DEBUG = true;
  function keyLog(...args) {
    if (!KEY_DEBUG) return;
    console.debug('[KM-KEY]', ...args);
  }

  /* ------------------------------------------------------------------ */
  /* Stats                                                              */
  /* ------------------------------------------------------------------ */
  let sentCount = 0;
  let connectedAt = null;
  let prevAgentCount = -1;

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
  /* Status UI                                                          */
  /* ------------------------------------------------------------------ */
  const serverPill = document.getElementById('server-pill');
  const serverLabel = document.getElementById('server-label');
  const agentPill = document.getElementById('agent-pill');
  const agentLabel = document.getElementById('agent-label');
  const sbReconnect = document.getElementById('sb-reconnect');

  function setServerStatus(state) {
    serverPill.className = 'pill ' + state;
    sbReconnect.style.display = (state === 'bad') ? '' : 'none';
    if (state === 'ok') serverLabel.textContent = 'Connected';
    if (state === 'bad') serverLabel.textContent = 'Disconnected';
    if (state === 'wait') serverLabel.textContent = 'Connecting…';
  }

  function setAgentStatus(count) {
    const active = count > 0;
    agentPill.className = 'pill' + (active ? ' active' : '');
    agentLabel.textContent = active ? 'Agent ×' + count : 'No agent';

    if (prevAgentCount !== -1) {
      if (count > 0 && prevAgentCount === 0) {
        banner('\r\n\x1b[1;32m  ✔ Agent connected – keyboard control is live.\x1b[0m\r');
      } else if (count === 0 && prevAgentCount > 0) {
        banner('\r\n\x1b[1;33m  ⚠ Agent disconnected.\x1b[0m\r');
      }
    }
    prevAgentCount = count;
  }

  /* ------------------------------------------------------------------ */
  /* Session countdown                                                   */
  /* ------------------------------------------------------------------ */
  let _countdownTimer = null;
  let _warnedAt5 = false;
  let _warnedAt1 = false;

  function initCountdown(expiresAt) {
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
        banner('\r\n\x1b[1;31m  ⚠ Session has ended – the GitHub Actions runner has stopped.\x1b[0m\r');
        return;
      }

      el.textContent = mm + ':' + ss;
      if (remaining <= 120) {
        el.className = 'urgent';
        if (!_warnedAt1) {
          _warnedAt1 = true;
          banner('\r\n\x1b[1;31m  ⚠ Less than 2 minutes left in this session!\x1b[0m\r');
        }
      } else if (remaining <= 300) {
        el.className = 'warn';
        if (!_warnedAt5) {
          _warnedAt5 = true;
          banner('\r\n\x1b[1;33m  ⚠ 5 minutes remaining in this session.\x1b[0m\r');
        }
      } else {
        el.className = 'ok';
      }
    }

    tick();
    _countdownTimer = setInterval(tick, 1000);
  }

  function fetchSessionInfo() {
    fetch('/session-info')
      .then(r => r.json())
      .then(d => { if (d.expires_at) initCountdown(d.expires_at); })
      .catch(() => {});
  }

  /* ------------------------------------------------------------------ */
  /* Ack                                                                 */
  /* ------------------------------------------------------------------ */
  let _msgId = 0;
  const _pendingAck = new Map();
  let _ackHideTimer = null;

  function nextMsgId() {
    return 'k' + (++_msgId);
  }

  function showAck() {
    const el = document.getElementById('sb-ack');
    el.style.display = '';
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    clearTimeout(_ackHideTimer);
    _ackHideTimer = setTimeout(() => { el.style.display = 'none'; }, 2200);
  }

  /* ------------------------------------------------------------------ */
  /* Shared state + modules                                             */
  /* ------------------------------------------------------------------ */
  let targetOS = localStorage.getItem('km_target_os') || 'unknown';
  let wsManager;
  let keyboardModule;

  function getWs() {
    return wsManager ? wsManager.getSocket() : null;
  }

  function sendRaw(data) {
    if (!wsManager || !wsManager.isOpen()) return;
    const id = nextMsgId();
    keyLog('tx key', { id, data });
    wsManager.sendJson({ type: 'key', data, id });
    _pendingAck.set(id, true);
    incSent();
    if (keyboardModule) keyboardModule.flashVkByRawData(data);
  }

  function sendHotkey(combo) {
    if (!wsManager || !wsManager.isOpen()) return;
    const id = nextMsgId();
    keyLog('tx hotkey', { id, combo });
    wsManager.sendJson({ type: 'hotkey', combo, id });
    _pendingAck.set(id, true);
    incSent();
    if (keyboardModule) keyboardModule.flashVkByCombo(combo);
  }

  const screenshotModule = createScreenshotModule({
    getWs,
    incSent,
    focusPrimaryInput,
  });

  const macrosModule = createMacrosModule({
    getTargetOS: () => targetOS,
    sendRaw,
    sendHotkey,
    banner,
  });

  keyboardModule = createKeyboardModule({
    getWs,
    sendRaw,
    sendHotkey,
    focusPrimaryInput,
    keyLog,
    getTargetOS: () => targetOS,
    setTargetOS: (os) => { targetOS = os; },
    applyDefaultMacrosForOS: macrosModule.applyDefaultMacrosForOS,
  });

  /* ------------------------------------------------------------------ */
  /* WebSocket dispatcher                                               */
  /* ------------------------------------------------------------------ */
  function handleWindowTitleMessage(msg) {
    const wb = document.getElementById('sb-window');
    const wt = document.getElementById('sb-window-title');
    if (msg.title) {
      wt.textContent = msg.title;
      wb.style.display = '';
    } else {
      wb.style.display = 'none';
    }
  }

  function handleWsMessage(msg) {
    switch (msg.type) {
      case 'ping':
        wsManager.sendJson({ type: 'pong' });
        break;
      case 'agent_status':
        setAgentStatus(msg.count);
        break;
      case 'agent_platform': {
        const switched = keyboardModule.handleAgentPlatform(msg.platform);
        if (switched) banner(`\r\n\x1b[0;36m  ✓ Switched to ${targetOS.toUpperCase()} shortcuts\x1b[0m\r\n`);
        break;
      }
      case 'session_info':
        initCountdown(msg.expires_at);
        break;
      case 'window_title':
        handleWindowTitleMessage(msg);
        break;
      case 'ack':
        if (_pendingAck.has(msg.id)) {
          _pendingAck.delete(msg.id);
          showAck();
        }
        break;
      case 'screenshot':
        screenshotModule.onScreenshot(msg);
        break;
      case 'screenshot_error':
        screenshotModule.onScreenshotError(msg);
        break;
      default:
        break;
    }
  }

  const wsUrl = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws';
  wsManager = createWsManager({
    wsUrl,
    onStatusChange: setServerStatus,
    onOpen: () => {
      connectedAt = Date.now();
      prevAgentCount = -1;
      banner('\r\n\x1b[1;32m ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m');
      banner('\x1b[1;32m ┃  KeyMod – Remote KM Control   ┃\x1b[0m');
      banner('\x1b[1;32m ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\x1b[0m');
      banner('\x1b[90m  Server connected. Type to send keystrokes to the target PC.\x1b[0m');
      banner('\x1b[90m  Press \x1b[37mF1\x1b[90m for help.\x1b[0m\r');
      fetchSessionInfo();
    },
    onClose: () => {
      connectedAt = null;
      document.getElementById('sb-uptime').textContent = '--:00';
      setAgentStatus(0);
      banner('\r\n\x1b[1;31m  ✖ Connection lost. Reconnecting in 5 s…\x1b[0m\r');
    },
    onMessage: (evt) => {
      if (typeof evt.data !== 'string') return;
      try { handleWsMessage(JSON.parse(evt.data)); } catch (_) {}
    },
  });
  wsManager.connect();

  /* ------------------------------------------------------------------ */
  /* Basic overlays                                                      */
  /* ------------------------------------------------------------------ */
  const helpOverlay = document.getElementById('help-overlay');
  document.getElementById('btn-help').onclick = () => { helpOverlay.classList.add('show'); };
  document.getElementById('btn-help-close').onclick = () => { helpOverlay.classList.remove('show'); focusPrimaryInput(); };
  helpOverlay.addEventListener('click', (e) => {
    if (e.target !== helpOverlay) return;
    helpOverlay.classList.remove('show');
    focusPrimaryInput();
  });

  /* ------------------------------------------------------------------ */
  /* Panels collapse                                                     */
  /* ------------------------------------------------------------------ */
  const _PANEL_DEFAULTS = {
    'sec-qkeys': true,
    'sec-send': true,
    'sec-hist': true,
    'sec-macros': true,
  };

  function initPanels() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('km_panels') || '{}'); } catch (_) {}
    const state = Object.assign({}, _PANEL_DEFAULTS, saved);
    Object.keys(_PANEL_DEFAULTS).forEach(id => {
      const sec = document.getElementById(id);
      if (!sec) return;
      if (!state[id]) sec.classList.add('collapsed');
    });
  }

  window.toggleSection = function toggleSection(id) {
    const sec = document.getElementById(id);
    if (!sec) return;
    sec.classList.toggle('collapsed');
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('km_panels') || '{}'); } catch (_) {}
    saved[id] = !sec.classList.contains('collapsed');
    localStorage.setItem('km_panels', JSON.stringify(saved));
  };

  /* ------------------------------------------------------------------ */
  /* History                                                             */
  /* ------------------------------------------------------------------ */
  const MAX_HISTORY = 20;
  let sendHistory = [];
  try { sendHistory = JSON.parse(localStorage.getItem('km_history') || '[]'); } catch (_) {}

  function fmtTime(ts) {
    const d = new Date(ts);
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  }

  function renderHistory() {
    const list = document.getElementById('hist-list');
    const cnt = document.getElementById('hist-count');
    list.innerHTML = '';
    cnt.textContent = sendHistory.length ? sendHistory.length : '';
    if (!sendHistory.length) {
      list.innerHTML = '<div id="hist-empty">No history yet</div>';
      return;
    }

    [...sendHistory].reverse().forEach(entry => {
      const row = document.createElement('div');
      row.className = 'hist-item';
      row.innerHTML =
        `<span class="hist-ts">${fmtTime(entry.ts)}</span>` +
        `<span class="hist-text" title="${entry.text.replace(/"/g,'&quot;')}">${entry.text}</span>` +
        `<button class="hist-resend" title="Re-send">↑</button>`;
      row.querySelector('.hist-resend').addEventListener('click', () => {
        const data = entry.text.replace(/\r?\n/g, '\r');
        sendRaw(data);
        banner('\x1b[90m  ↑ Re-sent: ' + entry.text.slice(0, 40).replace(/\r/g, '↵') + '\x1b[0m');
      });
      list.appendChild(row);
    });
  }

  function pushHistory(text) {
    sendHistory = sendHistory.filter(e => e.text !== text);
    sendHistory.push({ ts: Date.now(), text });
    if (sendHistory.length > MAX_HISTORY) sendHistory.shift();
    try { localStorage.setItem('km_history', JSON.stringify(sendHistory)); } catch (_) {}
    renderHistory();
  }

  /* ------------------------------------------------------------------ */
  /* Send text + templates + mask                                        */
  /* ------------------------------------------------------------------ */
  const textInput = document.getElementById('text-input');
  const maskedInput = document.getElementById('masked-input');
  const btnSendText = document.getElementById('btn-send-text');
  const btnMask = document.getElementById('btn-mask');
  const tplSelect = document.getElementById('tpl-select');

  let maskOn = false;

  function sendText() {
    const activeInput = maskOn ? maskedInput : textInput;
    const raw = activeInput.value.trim();
    if (!raw || !wsManager.isOpen()) return;
    const data = raw.replace(/\r?\n/g, '\r');
    activeInput.value = '';
    activeInput.focus();
    sendRaw(data);
    if (!maskOn) pushHistory(raw);
  }

  btnSendText.addEventListener('click', sendText);
  textInput.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      sendText();
    }
  });
  textInput.addEventListener('keydown', (e) => e.stopPropagation());

  maskedInput.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      sendText();
    }
    e.stopPropagation();
  });

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

  const TEMPLATES = [
    { label: 'IP addr', text: '192.168.1.' },
    { label: 'sudo …', text: 'sudo ' },
    { label: 'apt install', text: 'sudo apt-get install -y ' },
    { label: 'SSH connect', text: 'ssh user@host' },
    { label: 'python3 run', text: 'python3 script.py' },
    { label: 'docker ps', text: 'docker ps -a' },
    { label: 'Win+R: cmd', text: 'cmd' },
    { label: 'Win+R: notepad', text: 'notepad' },
  ];

  TEMPLATES.forEach(t => {
    const o = document.createElement('option');
    o.value = t.text;
    o.textContent = t.label;
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
  /* Init modules + final boot                                           */
  /* ------------------------------------------------------------------ */
  screenshotModule.init();
  macrosModule.init();
  keyboardModule.init({
    onF1: () => helpOverlay.classList.toggle('show'),
  });

  initPanels();
  renderHistory();
  focusPrimaryInput();
})();
