const WebSocket = require('ws');

let wss = null;

function init(server) {
  wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    console.log(`[WS] Client connected from ${req.socket.remoteAddress}`);
    ws.isAlive = true;

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('close', () => { console.log('[WS] Client disconnected'); });
    ws.on('error', (err) => { console.error('[WS] Error:', err.message); });
  });

  // Heartbeat — drop stale connections
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30_000);

  wss.on('close', () => clearInterval(interval));

  console.log('[WS] WebSocket server initialised on /ws');
  return wss;
}

/**
 * Broadcast a typed event to all connected clients.
 * @param {string} type  - Event type (e.g. 'ticket_created', 'pole_state_changed')
 * @param {object} data  - Payload
 */
function broadcast(type, data) {
  if (!wss) return;
  const msg = JSON.stringify({ type, data, ts: new Date().toISOString() });
  let count = 0;
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
      count++;
    }
  });
  if (count > 0) {
    console.log(`[WS] Broadcast "${type}" to ${count} client(s)`);
  }
}

function getClientCount() {
  return wss ? wss.clients.size : 0;
}

module.exports = { init, broadcast, getClientCount };
