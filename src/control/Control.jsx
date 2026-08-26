import React, { useEffect, useMemo, useState } from 'react';

const post = async (url, body = {}, token = '') => {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Falha ${response.status}`);
  return data;
};
const EFFECT_LABELS = {
  'entry-boost': 'Bônus de entrada 1.2x / 5s',
  'tactical-shield': 'Cura leve + escudo curto',
  speed: 'Impulso Neon balanceado',
  'extra-projectile': 'Projétil extra com cooldown',
  meteor: 'Meteoro telegrafado / alvo neutro',
  'star-power': 'Star Power + Hype / score x1',
  colossus: 'Evento cooperativo Colossus',
};
const giftLabel = (gift) => `${gift.aliases?.[0] || gift.giftId} · ${gift.tier} · ${EFFECT_LABELS[gift.effect] || gift.effect}`;

export function Control() {
  const [s, setS] = useState({ players: [], settings: {}, giftCatalog: [], boss: { active: false } });
  const [config, setConfig] = useState({ mock: true, adminConfigured: false });
  const [token, setToken] = useState(() => sessionStorage.getItem('neon-admin-token') || '');
  const [names, setNames] = useState('Nebula\nCyberFox\nLimeGuard\nBlaze\nNovaX\nSpectra');
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [selectedGiftId, setSelectedGiftId] = useState('5655');
  const [connected, setConnected] = useState(false), [notice, setNotice] = useState('Digite o token administrativo para operar o painel'), [mapPending, setMapPending] = useState(false), [clock, setClock] = useState(Date.now());

  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then((data) => { setConfig(data); if (data.giftCatalog?.length) setS((prev) => ({ ...prev, giftCatalog: data.giftCatalog })); }).catch(() => setNotice('Não foi possível ler a configuração do servidor'));
    const timer = setInterval(() => setClock(Date.now()), 1000);
    let ws, retry, active = true;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/events`);
      ws.onopen = () => setConnected(true); ws.onclose = () => { setConnected(false); if (active) retry = setTimeout(connect, 1800); };
      ws.onmessage = ({ data }) => { const event = JSON.parse(data); if (event.state) setS({ ...event.state }); };
    };
    connect(); return () => { active = false; clearInterval(timer); clearTimeout(retry); ws?.close(); };
  }, []);

  const alive = useMemo(() => s.players.filter((p) => p.alive), [s.players]);
  const selectedGift = useMemo(() => (s.giftCatalog || []).find((g) => String(g.giftId) === String(selectedGiftId)) || null, [s.giftCatalog, selectedGiftId]);
  useEffect(() => { if (!alive.some((p) => p.id === selectedPlayerId)) setSelectedPlayerId(alive[0]?.id || ''); }, [alive, selectedPlayerId]);
  useEffect(() => { if (s.giftCatalog?.length && !s.giftCatalog.some((g) => String(g.giftId) === String(selectedGiftId))) setSelectedGiftId(String(s.giftCatalog[0].giftId)); }, [s.giftCatalog, selectedGiftId]);

  const saveToken = (value) => { setToken(value); sessionStorage.setItem('neon-admin-token', value); };
  const run = async (url, body = {}, message = 'Comando enviado') => {
    try { const result = await post(url, body, token); if (result.state) setS({ ...result.state }); setNotice(message); return result; }
    catch (error) { setNotice(`Erro: ${error.message}`); return null; }
  };
  const changeMap = async (arenaBackground) => { setMapPending(true); try { await run('/api/settings', { arenaBackground }, `Mapa ${arenaBackground} ativado`); } finally { setMapPending(false); } };
  const simulateGift = () => selectedPlayerId && selectedGiftId && run('/api/admin/gift', { targetPlayerId: selectedPlayerId, giftId: selectedGiftId }, `Simulado: ${selectedGift ? EFFECT_LABELS[selectedGift.effect] || selectedGift.effect : 'Gift'}`);
  const invokeBoss = () => run('/api/admin/boss', {}, 'Pedido de Colossus Neon enviado');
  const boss = s.boss || { active: false }, bossCooldownMs = Math.max(0, (s.bossCooldownUntil || boss.cooldownUntil || 0) - clock);
  const bossStatus = boss.active ? `${Math.ceil(boss.hp || 0)} / ${boss.maxHp || 0} HP` : bossCooldownMs > 0 ? `Cooldown ${Math.ceil(bossCooldownMs / 1000)}s` : 'Disponível';

  return <main className="control">
    <header className="controlHeader">
      <div className="brand"><span className="brandMark">S</span><div><small>LIVE OPERATIONS</small><h1>STARTRADES COMMAND</h1></div></div>
      <div className="headerActions"><span className={`connection ${connected ? 'online' : ''}`}><i/>{connected ? 'SERVIDOR ONLINE' : 'RECONECTANDO'}</span><a href="/" target="_blank" rel="noreferrer">ABRIR ARENA ↗</a></div>
    </header>

    <div className="notice"><span>STATUS</span>{notice}</div>
    <section className="stats">
      <div><span>ESTADO</span><b className={s.phase}>{s.phase || 'lobby'}</b><em>controle da partida</em></div>
      <div><span>COMBATENTES VIVOS</span><b>{alive.length}<small> / {s.players.length}</small></b><em>na arena agora</em></div>
      <div><span>RODADA</span><b>#{s.round || 1}</b><em>sessão atual</em></div>
      <div><span>COLOSSUS</span><b>{boss.active ? 'ATIVO' : 'INATIVO'}</b><em>{bossStatus}</em></div>
    </section>

    <section className="commandGrid">
      <article className="commandCard battleCard"><div className="cardTitle"><span>01</span><div><h2>Controle da batalha</h2><p>Comandos administrativos autenticados</p></div></div>
        <div className="formGrid"><label>Token administrativo<input type="password" autoComplete="off" value={token} placeholder={config.adminConfigured ? 'ADMIN_TOKEN configurado no servidor' : 'ADMIN_TOKEN ausente no servidor'} onChange={(e) => saveToken(e.target.value)}/></label></div>
        {!config.adminConfigured && <p><strong>PAINEL BLOQUEADO:</strong> configure ADMIN_TOKEN no servidor antes de usar comandos.</p>}
        <div className="battleButtons"><button className="primary" onClick={() => run('/api/battle/start', {}, 'Batalha iniciada')}>▶ INICIAR</button><button onClick={() => run('/api/battle/pause', {}, 'Estado da pausa alterado')}>Ⅱ PAUSAR / RETOMAR</button><button className="danger" onClick={() => run('/api/battle/end', {}, 'Batalha encerrada')}>■ ENCERRAR</button><button className="ghost" onClick={() => confirm('Zerar jogadores e iniciar uma nova rodada?') && run('/api/battle/reset', {}, 'Nova rodada preparada')}>↻ ZERAR RODADA</button></div>
        <div className="battleMode"><label className="toggle"><span><b>Modo de Times</b><em>Azul vs Vermelho • fogo amigo bloqueado</em></span><input type="checkbox" checked={s.settings?.teamMode ?? false} onChange={(e) => run('/api/settings', { teamMode: e.target.checked }, e.target.checked ? 'Modo de Times ativado' : 'Modo individual ativado')}/></label><label className="mapSelector"><span>MAPA DA ARENA</span><select value={s.settings?.arenaBackground || 'default'} disabled={mapPending} onChange={(e) => changeMap(e.target.value)}><option value="default">Neon padrão</option><option value="cyberpunk">Cyberpunk</option><option value="space">Espaço</option><option value="retro">Retrô</option></select></label><div className="bountyStatus"><span>ALVO BOUNTY</span><b>{s.bountyTargetId ? `👑 ${s.players.find((p) => p.id === s.bountyTargetId)?.username || s.bountyTargetId}` : 'SEM ALVO NESTA RODADA'}</b></div></div>
      </article>

      <article className="commandCard"><div className="cardTitle"><span>02</span><div><h2>Jogadores de teste</h2><p>Disponível somente em MOCK_MODE</p></div></div><textarea value={names} onChange={(e) => setNames(e.target.value)} rows="6"/><button className="primary full" disabled={!config.mock} onClick={() => run('/api/test/players', { names: names.split(/\n|,/).map((x) => x.trim()).filter(Boolean) }, 'Jogadores adicionados à arena')}>+ ADICIONAR COMBATENTES</button></article>

      <article className="commandCard"><div className="cardTitle"><span>03</span><div><h2>Tempestade</h2><p>Controle manual da zona</p></div></div><div className="stormValue">{s.storm || 0}<small>%</small></div><input className="stormRange" type="range" min="0" max="100" value={s.storm || 0} onChange={(e) => setS((prev) => ({ ...prev, storm: Number(e.target.value) }))} onMouseUp={(e) => run('/api/storm', { value: Number(e.currentTarget.value) }, `Tempestade ajustada para ${e.currentTarget.value}%`)} onTouchEnd={(e) => run('/api/storm', { value: Number(e.currentTarget.value) }, `Tempestade ajustada para ${e.currentTarget.value}%`)}/><div className="rangeLabels"><span>SEGURA</span><span>CRÍTICA</span></div></article>
    </section>

    <section className="mappingSection">
      <div className="sectionHeading"><div><small>SIMULADOR ADMINISTRATIVO</small><h2>MODO DE TESTE — Gifts balanceados</h2><p>O cliente escolhe somente jogador e Gift allowlisted. Magnitude, duração, alvo do meteoro e efeitos competitivos são decididos no servidor.</p></div><span className="legendBadge">MODO DE TESTE</span></div>
      <div className="mappingForm"><label>Jogador por ID<select value={selectedPlayerId} onChange={(e) => setSelectedPlayerId(e.target.value)}>{alive.length ? alive.map((p) => <option key={p.id} value={p.id}>@{p.username || p.id} · ID {p.id}</option>) : <option value="">Nenhum jogador ativo</option>}</select></label><label>Gift allowlisted<select value={selectedGiftId} onChange={(e) => setSelectedGiftId(e.target.value)}>{(s.giftCatalog || []).map((g) => <option key={g.giftId} value={String(g.giftId)}>{giftLabel(g)}</option>)}</select></label><button className="primary" disabled={!config.mock || !selectedPlayerId || !selectedGiftId} onClick={simulateGift}>SIMULAR GIFT</button><button className="primary" disabled={!config.mock || !alive.length} onClick={invokeBoss}>INVOCAR COLOSSUS NEON</button></div>
      <div className="mappingList"><div className="mappingRow"><b>EFEITO SELECIONADO</b><span>{selectedGift ? EFFECT_LABELS[selectedGift.effect] || selectedGift.effect : '—'}</span><em>{selectedGift ? `${selectedGift.durationMs || 0}ms · cooldown ${selectedGift.cooldownMs || 0}ms` : '—'}</em><span>{selectedGift?.effect === 'star-power' ? 'Hype/status apenas • score x1' : selectedGift?.effect === 'meteor' ? 'Área avisada • não causa morte inevitável' : 'Servidor autoritativo'}</span></div><div className="mappingRow"><b>COLOSSUS NEON</b><span>{boss.active ? `${Math.ceil(boss.hp)} / ${boss.maxHp} HP` : 'INATIVO'}</span><em>{bossStatus}</em><span>{boss.active && boss.expiresAt ? `${Math.max(0, Math.ceil((boss.expiresAt - clock) / 1000))}s restantes` : '45s por invocação'}</span></div></div>
      <p><strong>SIMULAÇÃO:</strong> esses eventos usam <code>source: control-panel</code> e não representam receita, Gifts reais ou qualquer prêmio de valor econômico.</p>
    </section>

    <section className="lowerGrid">
      <article className="commandCard narrator"><div className="cardTitle"><span>04</span><div><h2>Apresentador e áudio</h2><p>Personalidade da transmissão</p></div></div>
        <label className="toggle"><span><b>Apresentador automático</b><em>Fila com prioridade e limite programático de 16 palavras</em></span><input type="checkbox" checked={s.settings?.agentEnabled ?? true} onChange={(e) => run('/api/settings', { agentEnabled: e.target.checked }, 'Apresentador atualizado')}/></label>
        <div className="formGrid"><label>Voz<select value={s.settings?.voiceMode || 'male'} onChange={(e) => run('/api/settings', { voiceMode: e.target.value }, 'Voz atualizada')}><option value="male">Masculina grave</option><option value="female">Feminina energética</option></select></label><label>Estilo<select value={s.settings?.narratorStyle || 'explosive'} onChange={(e) => run('/api/settings', { narratorStyle: e.target.value }, 'Estilo atualizado')}><option value="explosive">Arena explosiva</option><option value="esports">Caster e-sports</option><option value="cinematic">Trailer cinematográfico</option></select></label><label>Intensidade<select value={s.settings?.voiceIntensity || 3} onChange={(e) => run('/api/settings', { voiceIntensity: Number(e.target.value) }, 'Intensidade atualizada')}><option value="1">1 — Controlada</option><option value="2">2 — Animada</option><option value="3">3 — Emoção máxima</option></select></label></div>
        <div className="audioToggles"><label className="toggle compact"><span><b>Trilha eletrônica</b></span><input type="checkbox" checked={s.settings?.music ?? true} onChange={(e) => run('/api/settings', { music: e.target.checked }, 'Música atualizada')}/></label><label className="toggle compact"><span><b>Efeitos sonoros</b></span><input type="checkbox" checked={s.settings?.sound ?? true} onChange={(e) => run('/api/settings', { sound: e.target.checked }, 'Efeitos atualizados')}/></label></div>
      </article>

      <article className="commandCard rosterCard"><div className="cardTitle"><span>05</span><div><h2>Combatentes</h2><p>IDs estáveis, Hype e telemetria do servidor</p></div></div><div className="roster">{s.players.length ? s.players.map((p, i) => <div key={p.id} className={`${p.alive ? '' : 'dead'} team-${p.team || 'blue'}`}><b><i>{i + 1}</i>{s.bountyTargetId === p.id ? '👑 ' : ''}{p.starPowerUntil ? '⭐ ' : ''}@{p.username || p.id}</b><span>{s.settings?.teamMode && <em>{p.team === 'red' ? 'VERMELHO' : 'AZUL'}</em>} ID {p.id}</span><strong>{Math.ceil(p.hp || 0)} HP · {Math.ceil(p.shield || 0)} ESC · {p.score || 0} PTS · {p.hype || 0} HYPE</strong></div>) : <span className="empty">Nenhum combatente na arena.</span>}</div></article>
    </section>
  </main>;
}
