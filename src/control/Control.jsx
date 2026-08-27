import React, { useEffect, useMemo, useState } from 'react';

const requestJson = async (url, options = {}, token = '') => {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Falha ${response.status}`);
  return data;
};
const post = (url, body = {}, token = '') => requestJson(url, { method: 'POST', body: JSON.stringify(body) }, token);
const TARGET_LABELS = {
  SELF: 'Quem enviou', TARGET_PLAYER: 'Jogador escolhido', RANDOM_PLAYER: 'Jogador aleatório', ALLY_LOWEST_HP: 'Aliado com menos HP',
  ENEMY: 'Inimigo', LEADER: 'Líder', RANDOM_ENEMY: 'Inimigo aleatório', ALL_PLAYERS: 'Todos os jogadores', GLOBAL: 'Arena global', BOSS: 'Boss',
};
const giftLabel = (mapping) => `${mapping.giftName || mapping.giftId} · ${mapping.enabled ? 'ATIVO' : 'DESATIVADO'} · ${mapping.powerId}`;
const blankMapping = { giftId: '', giftName: '', enabled: true, powerId: 'tactical-shield', targetMode: 'SELF', magnitude: 10, durationMs: 3000, cooldownMs: 8000, visualPreset: 'shield-burst', soundPreset: 'shield', narrationPreset: 'hype' };

export function Control() {
  const [s, setS] = useState({ players: [], settings: {}, giftCatalog: [], boss: { active: false } });
  const [config, setConfig] = useState({ mock: true, adminConfigured: false, powerCatalog: [] });
  const [token, setToken] = useState(() => sessionStorage.getItem('neon-admin-token') || '');
  const [names, setNames] = useState('Nebula\nCyberFox\nLimeGuard\nBlaze\nNovaX\nSpectra');
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [mappings, setMappings] = useState([]);
  const [powers, setPowers] = useState([]);
  const [selectedGiftId, setSelectedGiftId] = useState('5655');
  const [draft, setDraft] = useState(blankMapping);
  const [connected, setConnected] = useState(false), [notice, setNotice] = useState('Digite o token administrativo para operar o painel'), [mapPending, setMapPending] = useState(false), [clock, setClock] = useState(Date.now());

  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then((data) => {
      setConfig(data);
      if (data.giftCatalog?.length) setS((prev) => ({ ...prev, giftCatalog: data.giftCatalog }));
      if (data.powerCatalog?.length) setPowers(data.powerCatalog);
    }).catch(() => setNotice('Não foi possível ler a configuração do servidor'));
    const timer = setInterval(() => setClock(Date.now()), 1000);
    let ws, retry, active = true;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/events`);
      ws.onopen = () => setConnected(true); ws.onclose = () => { setConnected(false); if (active) retry = setTimeout(connect, 1800); };
      ws.onmessage = ({ data }) => { const event = JSON.parse(data); if (event.state) setS({ ...event.state }); if (event.type === 'gift-mapping:updated' && token) void loadMappings(token); };
    };
    connect(); return () => { active = false; clearInterval(timer); clearTimeout(retry); ws?.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alive = useMemo(() => s.players.filter((p) => p.alive), [s.players]);
  const selectedMapping = useMemo(() => mappings.find((mapping) => mapping.giftId === selectedGiftId) || null, [mappings, selectedGiftId]);
  const selectedPower = useMemo(() => powers.find((power) => power.id === draft.powerId) || null, [powers, draft.powerId]);
  useEffect(() => { if (!alive.some((p) => p.id === selectedPlayerId)) setSelectedPlayerId(alive[0]?.id || ''); }, [alive, selectedPlayerId]);
  useEffect(() => { if (selectedMapping) setDraft({ ...selectedMapping }); }, [selectedMapping]);

  const saveToken = (value) => { setToken(value); sessionStorage.setItem('neon-admin-token', value); };
  const run = async (url, body = {}, message = 'Comando enviado') => {
    try { const result = await post(url, body, token); if (result.state) setS({ ...result.state }); setNotice(message); return result; }
    catch (error) { setNotice(`Erro: ${error.message}`); return null; }
  };
  const loadMappings = async (adminToken = token) => {
    if (!adminToken) return null;
    try {
      const data = await requestJson('/api/admin/gift-mappings', {}, adminToken);
      setMappings(data.mappings || []); setPowers(data.powers || []);
      const nextId = (data.mappings || []).some((mapping) => mapping.giftId === selectedGiftId) ? selectedGiftId : data.mappings?.[0]?.giftId || '';
      if (nextId) setSelectedGiftId(nextId);
      setNotice(data.persistence?.persistenceAvailable === false ? 'Mappings carregados com fallback em memória' : 'Presentes e poderes sincronizados');
      return data;
    } catch (error) { setNotice(`Erro: ${error.message}`); return null; }
  };
  useEffect(() => { if (token && config.adminConfigured) void loadMappings(token); }, [token, config.adminConfigured]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeMap = async (arenaBackground) => { setMapPending(true); try { await run('/api/settings', { arenaBackground }, `Mapa ${arenaBackground} ativado`); } finally { setMapPending(false); } };
  const simulateGift = () => selectedPlayerId && draft.giftId && run('/api/admin/gift', { targetPlayerId: selectedPlayerId, giftId: draft.giftId }, `Teste real do pipeline: ${draft.giftName || draft.giftId}`);
  const saveMapping = async () => {
    const result = await run('/api/admin/gift-mappings', draft, `Mapping ${draft.giftName || draft.giftId} salvo sem restart`);
    if (result) { await loadMappings(); setSelectedGiftId(result.mapping?.giftId || draft.giftId); }
  };
  const disableMapping = async () => {
    if (!draft.giftId) return;
    const result = await run(`/api/admin/gift-mappings/${encodeURIComponent(draft.giftId)}/disable`, {}, `${draft.giftName || draft.giftId} desativado`);
    if (result) await loadMappings();
  };
  const newMapping = () => { setSelectedGiftId(''); setDraft({ ...blankMapping, giftId: '', giftName: '' }); };
  const invokeBoss = () => run('/api/admin/boss', {}, 'Pedido de Colossus Neon enviado');
  const boss = s.boss || { active: false }, bossCooldownMs = Math.max(0, (s.bossCooldownUntil || boss.cooldownUntil || 0) - clock);
  const bossStatus = boss.active ? `${Math.ceil(boss.hp || 0)} / ${boss.maxHp || 0} HP · FASE ${boss.phase || 1}` : bossCooldownMs > 0 ? `Cooldown ${Math.ceil(bossCooldownMs / 1000)}s` : 'Disponível';

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
      <div className="sectionHeading"><div><small>POWER SYSTEM 2.0</small><h2>PRESENTES E PODERES</h2><p>Altere Gift → Power no servidor e teste pelo mesmo pipeline usado pelo TikTok, sem restart e sem novo deploy.</p></div><span className="legendBadge">SERVER AUTHORITATIVE</span></div>
      <div className="mappingForm">
        <label>Presente<select value={selectedGiftId} onChange={(e) => setSelectedGiftId(e.target.value)}><option value="">Novo mapping</option>{mappings.map((mapping) => <option key={mapping.giftId} value={mapping.giftId}>{giftLabel(mapping)}</option>)}</select></label>
        <label>Gift ID<input value={draft.giftId} onChange={(e) => setDraft((prev) => ({ ...prev, giftId: e.target.value }))} placeholder="5655"/></label>
        <label>Nome do Gift<input value={draft.giftName} onChange={(e) => setDraft((prev) => ({ ...prev, giftName: e.target.value }))} placeholder="Rose"/></label>
        <label className="toggle compact"><span><b>Mapping habilitado</b><em>Desative sem apagar a configuração</em></span><input type="checkbox" checked={Boolean(draft.enabled)} onChange={(e) => setDraft((prev) => ({ ...prev, enabled: e.target.checked }))}/></label>
        <label>Poder<select value={draft.powerId} onChange={(e) => { const power = powers.find((item) => item.id === e.target.value); setDraft((prev) => ({ ...prev, powerId: e.target.value, targetMode: power?.targetModes?.includes(prev.targetMode) ? prev.targetMode : power?.targetModes?.[0] || 'GLOBAL', magnitude: power?.defaultMagnitude ?? prev.magnitude, durationMs: power?.defaultDurationMs ?? prev.durationMs, cooldownMs: power?.cooldownMs ?? prev.cooldownMs, visualPreset: power?.visualPreset || prev.visualPreset, soundPreset: power?.audioPreset || prev.soundPreset, narrationPreset: power?.narrationPreset || prev.narrationPreset })); }}><option value="">Escolha</option>{powers.map((power) => <option key={power.id} value={power.id}>{power.name} · {power.category}</option>)}</select></label>
        <label>Alvo<select value={draft.targetMode} onChange={(e) => setDraft((prev) => ({ ...prev, targetMode: e.target.value }))}>{(selectedPower?.targetModes || []).map((mode) => <option key={mode} value={mode}>{TARGET_LABELS[mode] || mode}</option>)}</select></label>
        <label>Intensidade<input type="number" step="0.05" value={draft.magnitude} onChange={(e) => setDraft((prev) => ({ ...prev, magnitude: Number(e.target.value) }))}/></label>
        <label>Duração (ms)<input type="number" min="0" value={draft.durationMs} onChange={(e) => setDraft((prev) => ({ ...prev, durationMs: Number(e.target.value) }))}/></label>
        <label>Cooldown (ms)<input type="number" min="0" value={draft.cooldownMs} onChange={(e) => setDraft((prev) => ({ ...prev, cooldownMs: Number(e.target.value) }))}/></label>
        <label>VFX<input value={draft.visualPreset} onChange={(e) => setDraft((prev) => ({ ...prev, visualPreset: e.target.value }))}/></label>
        <label>Som<input value={draft.soundPreset} onChange={(e) => setDraft((prev) => ({ ...prev, soundPreset: e.target.value }))}/></label>
        <label>Narração<input value={draft.narrationPreset} onChange={(e) => setDraft((prev) => ({ ...prev, narrationPreset: e.target.value }))}/></label>
        <label>Jogador para TESTAR<select value={selectedPlayerId} onChange={(e) => setSelectedPlayerId(e.target.value)}>{alive.length ? alive.map((p) => <option key={p.id} value={p.id}>@{p.username || p.id} · {p.id}</option>) : <option value="">Nenhum jogador ativo</option>}</select></label>
      </div>
      <div className="battleButtons"><button className="primary" disabled={!config.mock || !selectedPlayerId || !draft.giftId} onClick={simulateGift}>TESTAR</button><button className="primary" disabled={!draft.giftId || !draft.powerId} onClick={saveMapping}>SALVAR</button><button className="danger" disabled={!draft.giftId} onClick={disableMapping}>DESATIVAR</button><button className="ghost" onClick={newMapping}>NOVO MAPPING</button><button className="primary" disabled={!config.mock || !alive.length} onClick={invokeBoss}>INVOCAR COLOSSUS</button></div>
      <div className="mappingList"><div className="mappingRow"><b>PODER SELECIONADO</b><span>{selectedPower?.name || '—'}</span><em>{selectedPower ? `máx. ${selectedPower.maxMagnitude} · duração máx. ${selectedPower.maxDurationMs}ms` : '—'}</em><span>O servidor aplica clamp mesmo se o painel enviar valores absurdos.</span></div><div className="mappingRow"><b>COLOSSUS NEON</b><span>{boss.active ? `${Math.ceil(boss.hp)} / ${boss.maxHp} HP` : 'INATIVO'}</span><em>{bossStatus}</em><span>{boss.active ? `${Math.max(0, Math.ceil((boss.expiresAt - clock) / 1000))}s restantes` : 'Fases e Overload são autoritativos no servidor'}</span></div></div>
      <p><strong>SIMULAÇÃO:</strong> TESTAR usa <code>source: control-panel</code>, mas atravessa o mesmo GiftMappingService e PowerExecutor do Gift real.</p>
    </section>

    <section className="lowerGrid">
      <article className="commandCard narrator"><div className="cardTitle"><span>04</span><div><h2>Apresentador, áudio e efeitos</h2><p>Presets seguros definidos pelo servidor</p></div></div>
        <label className="toggle"><span><b>Apresentador automático</b><em>Fast Path local + AI Path somente para momentos grandes</em></span><input type="checkbox" checked={s.settings?.agentEnabled ?? true} onChange={(e) => run('/api/settings', { agentEnabled: e.target.checked, narratorEnabled: e.target.checked }, 'Apresentador atualizado')}/></label>
        <div className="formGrid">
          <label>Voz<select value={s.settings?.voiceMode || 'male'} onChange={(e) => run('/api/settings', { voiceMode: e.target.value }, 'Voz atualizada')}><option value="male">Masculina grave</option><option value="female">Feminina energética</option></select></label>
          <label>Personalidade<select value={s.settings?.narratorPersonality || 'HYPE'} onChange={(e) => run('/api/settings', { narratorPersonality: e.target.value, personality: e.target.value }, 'Personalidade atualizada')}><option value="ESPORTS">ESPORTS</option><option value="HYPE">HYPE</option><option value="CINEMATIC">CINEMATIC</option><option value="CHAOTIC">CHAOTIC</option><option value="SARCASTIC">SARCASTIC</option></select></label>
          <label>Intensidade<select value={s.settings?.narratorIntensity ?? 80} onChange={(e) => run('/api/settings', { narratorIntensity: Number(e.target.value), intensity: Number(e.target.value) }, 'Intensidade atualizada')}><option value="40">40%</option><option value="60">60%</option><option value="80">80%</option><option value="100">100%</option></select></label>
          <label>Frequência<select value={s.settings?.narratorFrequency ?? 60} onChange={(e) => run('/api/settings', { narratorFrequency: Number(e.target.value), frequency: Number(e.target.value) }, 'Frequência atualizada')}><option value="30">30%</option><option value="60">60%</option><option value="80">80%</option></select></label>
          <label>Volume<select value={s.settings?.narratorVolume ?? 100} onChange={(e) => run('/api/settings', { narratorVolume: Number(e.target.value), volume: Number(e.target.value) }, 'Volume do narrador atualizado')}><option value="50">50%</option><option value="75">75%</option><option value="100">100%</option></select></label>
          <label>Intensidade de efeitos<select aria-label="Server Effect Intensity" value={s.settings?.effectIntensity || 'AUTO'} onChange={(e) => run('/api/settings', { effectIntensity: e.target.value }, e.target.value === 'AUTO' ? 'Otimização automática definida no servidor' : 'Intensidade visual do servidor atualizada')}><option value="AUTO">AUTO · adapta ao FPS</option><option value="BAIXA">BAIXA</option><option value="NORMAL">NORMAL</option><option value="ALTA">ALTA</option></select></label>
        </div>
        <div className="audioToggles"><label className="toggle compact"><span><b>Trilha eletrônica</b></span><input type="checkbox" checked={s.settings?.music ?? true} onChange={(e) => run('/api/settings', { music: e.target.checked }, 'Música atualizada')}/></label><label className="toggle compact"><span><b>Efeitos sonoros</b></span><input type="checkbox" checked={s.settings?.sound ?? true} onChange={(e) => run('/api/settings', { sound: e.target.checked }, 'Efeitos atualizados')}/></label></div>
      </article>

      <article className="commandCard rosterCard"><div className="cardTitle"><span>05</span><div><h2>Combatentes</h2><p>IDs estáveis, Hype e telemetria do servidor</p></div></div><div className="roster">{s.players.length ? s.players.map((p, i) => <div key={p.id} className={`${p.alive ? '' : 'dead'} team-${p.team || 'blue'}`}><b><i>{i + 1}</i>{s.bountyTargetId === p.id ? '👑 ' : ''}{p.starPowerUntil ? '⭐ ' : ''}@{p.username || p.id}</b><span>{s.settings?.teamMode && <em>{p.team === 'red' ? 'VERMELHO' : 'AZUL'}</em>} ID {p.id}</span><strong>{Math.ceil(p.hp || 0)} HP · {Math.ceil(p.shield || 0)} ESC · {p.score || 0} PTS · {p.hype || 0} HYPE</strong></div>) : <span className="empty">Nenhum combatente na arena.</span>}</div></article>
    </section>
  </main>;
}
