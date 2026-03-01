export function createWsManager({ wsUrl, reconnectMs = 5000, onStatusChange, onOpen, onClose, onMessage }) {
  let ws = null;
  let reconnectTimer = null;

  function setStatus(state) {
    if (typeof onStatusChange === 'function') onStatusChange(state);
  }

  function connect() {
    setStatus('wait');
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setStatus('ok');
      if (typeof onOpen === 'function') onOpen();
    };

    ws.onmessage = (evt) => {
      if (typeof onMessage !== 'function') return;
      onMessage(evt);
    };

    ws.onclose = () => {
      setStatus('bad');
      if (typeof onClose === 'function') onClose();
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, reconnectMs);
    };

    ws.onerror = () => ws.close();
  }

  function getSocket() {
    return ws;
  }

  function isOpen() {
    return !!ws && ws.readyState === WebSocket.OPEN;
  }

  function sendJson(payload) {
    if (!isOpen()) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }

  function disconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (ws) ws.close();
  }

  return {
    connect,
    disconnect,
    getSocket,
    isOpen,
    sendJson,
  };
}
