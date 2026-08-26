import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { GameScene } from '../game/GameScene.js';
import { cleanupSpeech, prepareSpeech, setMusic, setSound, speak, unlockAudio } from '../audio.js';

const wsUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/events`;
const bannerPriority = (payload = {}) => payload.tier === 'premium' ? 5 : payload.tier === 'event' ? 4 : payload.status === 'pending' ? 2 : 1;
const tierColor = (payload = {}) => payload.tier === 'premium' ? '#ffd24d' : payload.tier === 'event' ? '#ff9f2f' : payload.tier === 'boost' ? '#2cefff' : '#75ff7b';

export function Overlay() {
  const host = useRef(null), sceneRef = useRef(null), giftTimer = useRef(null), activeGiftRef = useRef(null);
  const [state, setState] = useState({ players: [], feed: [], settings: {}, giftCatalog: [] });
  const [speech, setSpeech] = useState('Ative o áudio para ouvir o apresentador da arena.');
  const [emotion, setEmotion] = useState('hype'), [audio, setAudio] = useState(false), [connected, setConnected] = useState(false), [activeGift, setActiveGift] = useState(null);
  useEffect(() => {
    prepareSpeech();
    const bridge = { unlock: () => {} };
    const scene = new GameScene(bridge); sceneRef.current = scene;
    const game = new Phaser.Game({ type: Phaser.AUTO, width: 1280, height: 720, parent: host.current, transparent: true, physics: { default: 'arcade' }, scene: [scene], render: { antialias: true, roundPixels: false }, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH } });
    let socket, retry, mounted = true;
    const clearBanner = () => { activeGiftRef.current = null; setActiveGift(null); };
    const showGift = (payload) => {
      const next = { ...payload, priority: bannerPriority(payload) }, current = activeGiftRef.current;
      if (current && current.priority > next.priority) return;
      activeGiftRef.current = next; setActiveGift(next); clearTimeout(giftTimer.current);
      giftTimer.current = setTimeout(clearBanner, next.priority >= 4 ? 3800 : 2400);
    };
    const connect = () => {
      socket = new WebSocket(wsUrl()); socket.onopen = () => setConnected(true); socket.onclose = () => { setConnected(false); if (mounted) retry = setTimeout(connect, 1800); };
      socket.onmessage = ({ data }) => {
        const event = JSON.parse(data), next = event.state;
        if (next) { setState({ ...next }); scene.syncState(next); setMusic(next.settings?.music !== false); setSound(next.settings?.sound !== false); }
        if (event.type === 'gift:applied') { scene.triggerGift(event.payload); showGift({ ...event.payload, status: 'applied' }); }
        if (event.type === 'gift:pending') showGift({ ...event.payload, status: 'pending' });
        if (event.type === 'gift:rejected' && event.payload?.visualOnly) showGift({ ...event.payload, status: 'neutral', giftName: event.payload.giftName || 'Gift desconhecido' });
        if (event.type === 'combat:shot') scene.renderCombatShot(event.payload);
        if (event.type === 'battle-start') scene.battleStart();
        if (event.type === 'battle-end') scene.battleEnd(event.payload?.winner);
        if (event.type === 'storm') scene.stormSurge(event.payload?.value ?? next?.storm ?? 0);
        if (event.type === 'like' && event.payload?.bonus) scene.likeBurst();
        if (event.type === 'agent') {
          const currentSettings = next?.settings || {};
          setSpeech(event.payload.text); setEmotion(event.payload.emotion || 'hype');
          speak(event.payload.text, {
            mode: currentSettings.voiceMode || 'male',
            emotion: event.payload.emotion || 'hype',
            priority: event.payload.priority,
            priorityLevel: event.payload.priorityLevel,
            path: event.payload.path,
            eventType: event.payload.eventType,
            createdAt: event.payload.createdAt,
          });
        }
      };
    };
    connect(); return () => { mounted = false; clearTimeout(retry); clearTimeout(giftTimer.current); socket?.close(); cleanupSpeech(); game.destroy(true); };
  }, []);
  const enable = () => {
    unlockAudio(); setAudio(true); setMusic(state.settings?.music !== false); setSound(state.settings?.sound !== false);
    const text = 'Som ativado! Prepare-se, porque a arena vai tremer!'; setSpeech(text); setEmotion('battle');
    speak(text, { mode: state.settings?.voiceMode || 'male', emotion: 'battle', priority: true, eventType: 'audio:enabled' });
  };
  const alive = state.players.filter((p) => p.alive), feed = (state.feed || []).slice(0, 4);
  const blue = state.teamScores?.blue || { score: 0, survivors: 0 }, red = state.teamScores?.red || { score: 0, survivors: 0 };
  const winnerLabel = state.winner?.type === 'team' ? state.winner.label : state.winner?.username ? `@${state.winner.username}` : '';
  const boss = state.boss || {};
  const giftText = activeGift?.status === 'applied'
    ? `@${activeGift.senderUsername} enviou ${activeGift.giftName}${activeGift.repeatCount > 1 ? ` x${activeGift.repeatCount}` : ''} — efeito ativado em @${activeGift.targetUsername}`
    : activeGift?.status === 'pending'
      ? `@${activeGift.senderUsername} enviou ${activeGift.giftName || 'Gift'} — bônus aguardando a próxima entrada`
      : activeGift ? `@${activeGift.senderUsername || 'espectador'} enviou ${activeGift.giftName || 'Gift'} — efeito não configurado` : '';
  return <main className="overlay">
    <div className="broadcastFrame"/>
    <header className="overlayHeader"><div className="overlayBrand"><span className="brandMark">S</span><div><small>@STARTRADES01 APRESENTA</small><h1>NEON <em>ROYALE</em></h1></div></div><div className="liveCluster"><span className={`serverDot ${connected ? 'online' : ''}`}/><div className={`live ${state.phase}`}><i/> {String(state.phase || 'lobby').toUpperCase()}</div></div></header>
    {state.settings?.teamMode && <section className="teamScoreboard"><div className="blueTeam"><small>TIME AZUL</small><strong>{blue.survivors}</strong><span>{blue.score} PTS</span></div><b>VS</b><div className="redTeam"><small>TIME VERMELHO</small><strong>{red.survivors}</strong><span>{red.score} PTS</span></div></section>}
    <div className="game" ref={host}/>
    <section className="hud">
      <div><span>COMBATENTES</span><strong>{alive.length}<small>/{state.players.length}</small></strong></div><div><span>RODADA</span><strong>#{state.round || 1}</strong></div><div className={state.storm >= 60 ? 'dangerStat' : ''}><span>TEMPESTADE</span><strong>{state.storm || 0}%</strong><i><b style={{ width: `${state.storm || 0}%` }}/></i></div><div><span>{boss.active ? 'COLOSSUS' : 'META DE LIKES'}</span><strong>{boss.active ? Math.ceil(boss.hp || 0) : state.likes || 0}<small>/{boss.active ? boss.maxHp || 0 : 500}</small></strong></div>
    </section>
    <aside className="ranking"><div className="panelHeading"><span>CLASSIFICAÇÃO</span><b>AO VIVO</b></div>{state.players.slice(0, 6).map((p, i) => <div className={`rankRow ${!p.alive ? 'eliminated' : ''}`} key={p.id}><b>{i + 1}</b><span><strong>@{p.username || p.id}</strong><small>{p.eliminations} eliminações</small></span><em>{p.score}</em></div>)}</aside>
    <section className="eventFeed">{feed.map((item) => <div key={item.id} className={item.tone}><i/>{item.text}</div>)}</section>
    <section className={`agent emotion-${emotion}`}><div className="agentOrb"><span>N</span><i/><i/><i/></div><div><small>APRESENTADOR NOVA</small><p>{speech}</p></div>{!audio && <button onClick={enable}>ATIVAR SOM</button>}</section>
    {activeGift && <section className="powerBanner" style={{ '--power': tierColor(activeGift) }}><span>{activeGift.tier === 'premium' ? '✦' : activeGift.status === 'neutral' ? '·' : '◆'}</span><div><small>{activeGift.status === 'pending' ? 'GIFT PENDENTE' : activeGift.status === 'neutral' ? 'GIFT RECEBIDO' : 'INTERAÇÃO DA LIVE'}</small><strong>{giftText}</strong><em>{activeGift.source === 'control-panel' ? 'SIMULAÇÃO • NÃO É RECEITA REAL' : 'TIKTOK LIVE'}</em></div><b>{activeGift.tier === 'premium' ? 'PREMIUM' : 'GIFT'}</b></section>}
    {state.phase === 'lobby' && <div className="callout"><small>ENTRE NA PRÓXIMA BATALHA</small><b>Digite <em>!entrar</em></b><span>Gifts ativam efeitos de entretenimento sem prêmio real</span><i/></div>}
    {state.winner && <div className={`winner team-${state.winner.team || 'solo'}`}><div className="winnerCrown">✦</div><small>{state.winner.type === 'team' ? 'EQUIPE CAMPEÃ' : 'CAMPEÃO'} DA RODADA {state.round}</small><strong>{winnerLabel}</strong><span>{state.winner.survivors != null ? `${state.winner.survivors} sobreviventes • ` : ''}{state.winner.eliminations} eliminações • {state.winner.score} pontos</span><div className="winnerLine"/></div>}
  </main>;
}