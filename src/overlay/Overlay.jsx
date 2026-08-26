import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { GameScene } from '../game/GameScene.js';
import { cleanupSpeech, prepareSpeech, setMusic, setSound, speak, unlockAudio } from '../audio.js';

const wsUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/events`;

export function Overlay() {
  const host = useRef(null), sceneRef = useRef(null), powerTimer = useRef(null);
  const [state, setState] = useState({ players: [], feed: [], settings: {}, powerCatalog: [] });
  const [speech, setSpeech] = useState('Ative o áudio para ouvir o apresentador da arena.');
  const [emotion, setEmotion] = useState('hype'), [audio, setAudio] = useState(false), [connected, setConnected] = useState(false), [activePower, setActivePower] = useState(null);
  useEffect(() => {
    prepareSpeech();
    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const bridge = { unlock: () => {}, combat: (x) => post('/api/game/combat', x), stormDamage: (targetId, damage) => post('/api/game/storm-damage', { targetId, damage }), positions: (players) => post('/api/game/positions', { players }) };
    const scene = new GameScene(bridge); sceneRef.current = scene;
    const game = new Phaser.Game({ type: Phaser.AUTO, width: 1280, height: 720, parent: host.current, transparent: true, physics: { default: 'arcade' }, scene: [scene], render: { antialias: true, roundPixels: false }, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH } });
    let socket, retry, mounted = true;
    const showPower = (payload) => { setActivePower(payload); clearTimeout(powerTimer.current); powerTimer.current = setTimeout(() => setActivePower(null), payload.power.kind === 'meteor' ? 3300 : 2400); };
    const connect = () => {
      socket = new WebSocket(wsUrl()); socket.onopen = () => setConnected(true); socket.onclose = () => { setConnected(false); if (mounted) retry = setTimeout(connect, 1800); };
      socket.onmessage = ({ data }) => {
        const event = JSON.parse(data), next = event.state;
        if (next) { setState({ ...next }); scene.syncState(next); setMusic(next.settings?.music !== false); setSound(next.settings?.sound !== false); }
        if (event.type === 'power') { scene.triggerPower(event.payload); showPower(event.payload); }
        if (event.type === 'battle-start') scene.battleStart();
        if (event.type === 'battle-end') scene.battleEnd(event.payload?.winner);
        if (event.type === 'storm') scene.stormSurge(event.payload?.value ?? next?.storm ?? 0);
        if (event.type === 'like' && event.payload?.bonus) scene.likeBurst();
        if (event.type === 'agent') {
          const currentSettings = next?.settings || {};
          setSpeech(event.payload.text); setEmotion(event.payload.emotion || 'hype');
          speak(event.payload.text, { mode: currentSettings.voiceMode || 'male', emotion: event.payload.emotion || 'hype', intensity: currentSettings.voiceIntensity || 3, style: currentSettings.narratorStyle || 'explosive', priority: event.payload.priority });
        }
      };
    };
    connect(); return () => { mounted = false; clearTimeout(retry); clearTimeout(powerTimer.current); socket?.close(); cleanupSpeech(); game.destroy(true); };
  }, []);
  const enable = () => {
    unlockAudio(); setAudio(true); setMusic(state.settings?.music !== false); setSound(state.settings?.sound !== false);
    const text = 'Som ativado! Prepare-se, porque a arena vai tremer!'; setSpeech(text); setEmotion('battle');
    speak(text, { mode: state.settings?.voiceMode || 'male', emotion: 'battle', intensity: state.settings?.voiceIntensity || 3, style: state.settings?.narratorStyle || 'explosive', priority: true });
  };
  const alive = state.players.filter((p) => p.alive), feed = (state.feed || []).slice(0, 4);
  const blue = state.teamScores?.blue || { score: 0, survivors: 0 }, red = state.teamScores?.red || { score: 0, survivors: 0 };
  const winnerLabel = state.winner?.type === 'team' ? state.winner.label : state.winner?.id ? `@${state.winner.id}` : '';
  return <main className="overlay">
    <div className="broadcastFrame"/>
    <header className="overlayHeader"><div className="overlayBrand"><span className="brandMark">S</span><div><small>@STARTRADES01 APRESENTA</small><h1>NEON <em>ROYALE</em></h1></div></div><div className="liveCluster"><span className={`serverDot ${connected ? 'online' : ''}`}/><div className={`live ${state.phase}`}><i/> {String(state.phase || 'lobby').toUpperCase()}</div></div></header>
    {state.settings?.teamMode && <section className="teamScoreboard"><div className="blueTeam"><small>TIME AZUL</small><strong>{blue.survivors}</strong><span>{blue.score} PTS</span></div><b>VS</b><div className="redTeam"><small>TIME VERMELHO</small><strong>{red.survivors}</strong><span>{red.score} PTS</span></div></section>}
    <div className="game" ref={host}/>
    <section className="hud">
      <div><span>COMBATENTES</span><strong>{alive.length}<small>/{state.players.length}</small></strong></div><div><span>RODADA</span><strong>#{state.round || 1}</strong></div><div className={state.storm >= 60 ? 'dangerStat' : ''}><span>TEMPESTADE</span><strong>{state.storm || 0}%</strong><i><b style={{ width: `${state.storm || 0}%` }}/></i></div><div><span>META DE LIKES</span><strong>{state.likes || 0}<small>/500</small></strong></div>
    </section>
    <aside className="ranking"><div className="panelHeading"><span>CLASSIFICAÇÃO</span><b>AO VIVO</b></div>{state.players.slice(0, 6).map((p, i) => <div className={`rankRow ${!p.alive ? 'eliminated' : ''}`} key={p.id}><b>{i + 1}</b><span><strong>@{p.id}</strong><small>{p.eliminations} eliminações</small></span><em>{p.score}</em></div>)}</aside>
    <section className="eventFeed">{feed.map((item) => <div key={item.id} className={item.tone}><i/>{item.text}</div>)}</section>
    <section className={`agent emotion-${emotion}`}><div className="agentOrb"><span>N</span><i/><i/><i/></div><div><small>APRESENTADOR NOVA</small><p>{speech}</p></div>{!audio && <button onClick={enable}>ATIVAR SOM</button>}</section>
    {activePower && <section className={`powerBanner power-${activePower.power.kind}`} style={{ '--power': `#${activePower.power.color.toString(16).padStart(6, '0')}` }}><span>{activePower.power.icon}</span><div><small>@{activePower.playerId} LIBEROU</small><strong>{activePower.power.label}</strong><em>{activePower.giftName} • {activePower.total} moedas</em></div><b>POWER UP</b></section>}
    {state.phase === 'lobby' && <div className="callout"><small>ENTRE NA PRÓXIMA BATALHA</small><b>Digite <em>!entrar</em></b><span>Envie presentes para liberar poderes especiais</span><i/></div>}
    {state.winner && <div className={`winner team-${state.winner.team || 'solo'}`}><div className="winnerCrown">✦</div><small>{state.winner.type === 'team' ? 'EQUIPE CAMPEÃ' : 'CAMPEÃO'} DA RODADA {state.round}</small><strong>{winnerLabel}</strong><span>{state.winner.survivors != null ? `${state.winner.survivors} sobreviventes • ` : ''}{state.winner.eliminations} eliminações • {state.winner.score} pontos</span><div className="winnerLine"/></div>}
  </main>;
}
