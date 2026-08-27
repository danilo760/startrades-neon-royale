import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './cinematic.css';

const NativeWebSocket = window.WebSocket;
const WS_HEARTBEAT_MS = 4 * 60 * 1000;
class NeonWebSocket extends NativeWebSocket {
  constructor(...args) {
    super(...args);
    let heartbeat = null;
    const sendHeartbeat = () => {
      if (this.readyState !== NativeWebSocket.OPEN) return;
      try { this.send(JSON.stringify({ type: 'client:heartbeat', at: Date.now() })); } catch {}
    };
    this.addEventListener('open', () => {
      sendHeartbeat();
      heartbeat = window.setInterval(sendHeartbeat, WS_HEARTBEAT_MS);
    }, { once: true });
    this.addEventListener('close', () => {
      if (heartbeat) window.clearInterval(heartbeat);
      heartbeat = null;
    }, { once: true });
  }
}
window.WebSocket = NeonWebSocket;

const Overlay = lazy(() =>
  import('./overlay/Overlay.jsx').then((module) => ({
    default: module.Overlay,
  }))
);

const Control = lazy(() =>
  import('./control/Control.jsx').then((module) => ({
    default: module.Control,
  }))
);

createRoot(document.getElementById('root')).render(
  <Suspense fallback={<div>Loading...</div>}>
    {location.pathname.startsWith('/control') ? <Control /> : <Overlay />}
  </Suspense>
);
