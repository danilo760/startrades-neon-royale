import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { GameScene } from '../game/GameScene.js';
import { setMusic, speak, unlockAudio } from '../audio.js';

export function Overlay() {
  const host = useRef(null), sceneRef = useRef(null); const [state, setState] = useState({ players: [], feed: [], settings: {} }); const [speech, setSpeech] = useState('Clique em ATIVAR ÁUDIO antes da LIVE'); const [audio, setAudio] = useState(false);
  useEffect(() => {
    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const bridge = { unlock: () => {}, combat: (x) => post('/api/game/combat', x), stormDamage: (targetId, damage) => post('/api/game/storm-damage', { targetId, damage }), positions: (players) => post('/api/game/positions', { players }) };
    const scene = new GameScene(bridge); sceneRef.current = scene; const game = new Phaser.Game({ type: Phaser.AUTO, width: 1280, height: 720, parent: host.current, transparent: true, physics: { default: 'arcade' }, scene: [scene], render: { antialias: true } });
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/events`);
    socket.onmessage = ({ data }) => { const e = JSON.parse(data); if (e.state) { setState({ ...e.state }); scene.syncState(e.state); setMusic(e.state.settings?.music !== false); } if (e.type === 'power') scene.triggerPower(e.payload); if (e.type === 'agent') { setSpeech(e.payload.text); speak(e.payload.text, e.state?.settings?.voiceMode || 'male'); } };
    return () => { socket.close(); game.destroy(true); };
  }, []);
  const enable = () => { unlockAudio(); setAudio(true); setMusic(state.settings?.music !== false); setSpeech('Áudio ativado. A arena está pronta!'); speak('Áudio ativado. A arena está pronta!', state.settings?.voiceMode); };
  const alive = state.players.filter((p) => p.alive);
  return <main className="overlay"><header><div><small>STARTRADES01 APRESENTA</small><h1>NEON ROYALE</h1></div><div className={`live ${state.phase}`}>{String(state.phase || 'lobby').toUpperCase()}</div></header><div className="game" ref={host}/><section className="hud"><div><span>VIVOS</span><strong>{alive.length}</strong></div><div><span>RODADA</span><strong>{state.round || 1}</strong></div><div><span>TEMPESTADE</span><strong>{state.storm || 0}%</strong></div><div><span>CURTIDAS</span><strong>{state.likes || 0}/500</strong></div></section><aside className="ranking"><h3>TOP ARENA</h3>{state.players.slice(0, 5).map((p, i) => <p key={p.id}><b>{i + 1}</b> @{p.id}<em>{p.score} pts</em></p>)}</aside><section className="agent"><div className="agentOrb">N</div><p>{speech}</p>{!audio && <button onClick={enable}>ATIVAR ÁUDIO</button>}</section>{state.phase === 'lobby' && <div className="callout"><b>Digite !entrar</b><span>Presentes liberam poderes</span></div>}{state.winner && <div className="winner"><small>CAMPEÃO DA RODADA</small><strong>@{state.winner.id}</strong><span>{state.winner.eliminations} eliminações</span></div>}</main>;
}
