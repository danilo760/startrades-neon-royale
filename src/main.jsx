import React, { Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './cinematic.css';
import './vertical.css';
import './performance.css';
import './qa-lab.css';

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
if (!localStorage.getItem('neon-effect-mode')) localStorage.setItem('neon-effect-mode', 'AUTO');

const Overlay = lazy(() => import('./overlay/Overlay.jsx').then((module) => ({ default: module.Overlay })));
const Control = lazy(() => import('./control/Control.jsx').then((module) => ({ default: module.Control })));
const QALab = lazy(() => import('./control/QALab.jsx').then((module) => ({ default: module.QALab })));

function BroadcastModeToolbar() {
  const [effects, setEffects] = useState(() => localStorage.getItem('neon-effect-mode') || 'AUTO');
  useEffect(() => { localStorage.setItem('neon-effect-mode', effects); }, [effects]);
  return <nav className="broadcastModeToolbar" aria-label="Broadcast Mode">
    <span>BROADCAST MODE</span>
    <a href="/?broadcast=landscape" target="_blank" rel="noreferrer">LANDSCAPE ↗</a>
    <a href="/?broadcast=vertical" target="_blank" rel="noreferrer">VERTICAL_TIKTOK ↗</a>
    <label className="performanceModeControl">FPS<select aria-label="Effect Intensity" value={effects} onChange={(event) => setEffects(event.target.value)}>
      <option value="AUTO">AUTO</option><option value="ALTA">HIGH</option><option value="NORMAL">NORMAL</option><option value="BAIXA">LOW</option>
    </select></label>
  </nav>;
}

function PerformanceDiagnostics() {
  const enabled = new URLSearchParams(location.search).get('debug') === 'performance';
  const [diagnostics, setDiagnostics] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => setDiagnostics(window.__NEON_PERF__ ? { ...window.__NEON_PERF__ } : null), 500);
    return () => clearInterval(timer);
  }, [enabled]);
  if (!enabled) return null;
  return <aside className="performanceDiagnostics" aria-label="Performance Diagnostics">
    <strong>PERFORMANCE</strong>
    <span>FPS <b>{diagnostics?.fps ?? '—'}</b></span><span>FRAME <b>{diagnostics?.frameTimeMs ?? '—'} ms</b></span>
    <span>QUALITY <b>{diagnostics?.effectiveLevel ?? '—'}</b></span><span>MODE <b>{diagnostics?.requestedMode ?? '—'}</b></span>
    <span>PLAYERS <b>{diagnostics?.players ?? '—'}</b></span><span>PROJECTILES <b>{diagnostics?.projectiles ?? '—'}</b></span>
    <span>VFX <b>{diagnostics?.vfx ?? '—'}</b></span>{diagnostics?.memoryMb != null && <span>MEM <b>{diagnostics.memoryMb} MB</b></span>}
  </aside>;
}

const isControl = location.pathname.startsWith('/control');
createRoot(document.getElementById('root')).render(
  <Suspense fallback={<div>Loading...</div>}>
    {isControl ? <><BroadcastModeToolbar/><Control/><QALab/></> : <><Overlay/><PerformanceDiagnostics/></>}
  </Suspense>
);
