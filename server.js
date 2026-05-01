const express = require('express');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
const { AutoScroller } = require('./autoscroller');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Auto-scroller instance
let scroller = null;
let clients = new Set();

const idleStatus = () => ({
  state: 'idle',
  platform: null,
  scrollCount: 0,
  sessionTime: 0,
  interval: 5,
});

// Broadcast to all connected WebSocket clients
function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach(ws => {
    if (ws.readyState === 1) ws.send(msg);
  });
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('[WS] Client connected');

  // Send current status
  ws.send(JSON.stringify({
    type: 'status',
    data: scroller ? scroller.getStatus() : idleStatus()
  }));

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);
      console.log('[WS] Received:', msg.type);

      switch (msg.type) {
        case 'start': {
          if (scroller && scroller.isRunning()) {
            const oldScroller = scroller;
            scroller = null;
            await oldScroller.stop();
          }
          const nextScroller = new AutoScroller({
            platform: msg.platform || 'youtube',
            interval: msg.interval || 5,
            browserType: msg.browserType || 'chromium',
            onStatusUpdate: (status) => broadcast({ type: 'status', data: status }),
            onLog: (log) => broadcast({ type: 'log', data: log }),
          });
          scroller = nextScroller;
          await nextScroller.start();
          break;
        }
        case 'stop': {
          if (scroller) {
            const currentScroller = scroller;
            scroller = null;
            broadcast({ type: 'status', data: idleStatus() });
            await currentScroller.stop();
          }
          broadcast({ type: 'status', data: idleStatus() });
          break;
        }
        case 'pause': {
          if (scroller) scroller.pause();
          break;
        }
        case 'resume': {
          if (scroller) scroller.resume();
          break;
        }
        case 'set_interval': {
          if (scroller) scroller.setInterval(msg.interval);
          break;
        }
        case 'skip': {
          if (scroller) await scroller.scrollNext();
          break;
        }
      }
    } catch (err) {
      console.error('[WS] Error:', err.message);
      ws.send(JSON.stringify({ type: 'error', data: err.message }));
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log('[WS] Client disconnected');
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down...');
  if (scroller) {
    const currentScroller = scroller;
    scroller = null;
    await currentScroller.stop();
  }
  server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[Server] Terminating...');
  if (scroller) {
    const currentScroller = scroller;
    scroller = null;
    await currentScroller.stop();
  }
  server.close();
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 AutoScroller Dashboard: http://localhost:${PORT}\n`);
});
