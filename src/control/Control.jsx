import React, { useEffect, useMemo, useState } from 'react';

const post = async (url, body = {}) => {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Falha ${response.status}`); return response.json();
};
const colorHex = (value = 0x75ff4d) => `#${Number(value).toString(16).padStart(6, '0')}`;
const range = (power) => power.max === null ? `${power.min}+` : power.min === power.max ? String(power.min) : `${power.min}–${power.max}`;

export function Control() {
  const [s, setS] = useState({ players: [], settings: {}, powerCatalog: [] });
  const [names, setNames] = useState('Nebula\nCyberFox\nLimeGuard\nBlaze\nNovaX\nSpectra');
  const [gift, setGift] = useState({ username: 'Nebula', giftName: 'Rosa', diamondCount: 1, repeatCount: 1 });
  const [newGift, setNewGift] = useState({ name: '', kind: 'shot', sound: '' });
  const [connected, setConnected] = useState(false), [notice, setNotice] = useState('Pronto para comandar a arena');
  useEffect(() => {
    let ws, retry, active = true;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/events`);
      ws.onopen = () => setConnected(true); ws.onclose = () => { setConnected(false); if (active) retry = setTimeout(connect, 1800); };
      ws.onmessage = ({ data }) => { const event = JSON.parse(data); if (event.state) setS({ ...event.state }); };
    };
    connect(); return () => { active = false; clearTimeout(retry); ws?.close(); };
  }, []);
  const run = async (url, body, message = 'Comando enviado') => {
    try { const result = await post(url, body); setS({ ...result.state }); setNotice(message); return result; }
    catch (error) { setNotice(`Erro: ${error.message}`); }
  };
  const testPower = (power) => {
    const next = { ...gift, giftName: power.giftExample, diamondCount: power.sample, repeatCount: 1 };
    setGift(next); run('/api/mock/gift', next, `${power.label} ativado para @${next.username}`);
  };
  const giftMapping = s.settings.giftMapping || {};
  const addMapping = () => {
    const name = newGift.name.trim(); if (!name) return;
    run('/api/settings', { giftMapping: { [name]: { kind: newGift.kind, ...(newGift.sound ? { sound: newGift.sound } : {}) } } }, `Presente ${name} configurado`);
    setNewGift({ name: '', kind: 'shot', sound: '' });
  };
  const simulateMapping = (name) => run('/api/mock/gift', { username: gift.username || 'Nebula', giftName: name, diamondCount: 1, repeatCount: 1 }, `${name} simulado`);
  const removeMapping = (name) => run('/api/settings', { removeGift: name }, `Mapeamento ${name} removido`);
  const alive = s.players.filter((p) => p.alive), catalog = s.powerCatalog || [];
  const selectedPower = useMemo(() => catalog.find((p) => gift.diamondCount * gift.repeatCount >= p.min && (p.max === null || gift.diamondCount * gift.repeatCount <= p.max)), [catalog, gift]);

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
      <div><span>TEMPESTADE</span><b>{s.storm || 0}%</b><em>fechamento da zona</em></div>
    </section>

    <section className="commandGrid">
      <article className="commandCard battleCard"><div className="cardTitle"><span>01</span><div><h2>Controle da batalha</h2><p>Comandos principais da rodada</p></div></div>
        <div className="battleButtons"><button className="primary" onClick={() => run('/api/battle/start', {}, 'Batalha iniciada')}>▶ INICIAR</button><button onClick={() => run('/api/battle/pause', {}, 'Estado da pausa alterado')}>Ⅱ PAUSAR / RETOMAR</button><button className="danger" onClick={() => run('/api/battle/end', {}, 'Batalha encerrada e campeão anunciado')}>■ ENCERRAR</button><button className="ghost" onClick={() => confirm('Zerar jogadores e iniciar uma nova rodada?') && run('/api/battle/reset', {}, 'Nova rodada preparada')}>↻ ZERAR RODADA</button></div>
        <div className="battleMode"><label className="toggle"><span><b>Modo de Times</b><em>Azul vs Vermelho • fogo amigo bloqueado</em></span><input type="checkbox" checked={s.settings.teamMode ?? false} onChange={(e) => run('/api/settings', { teamMode: e.target.checked }, e.target.checked ? 'Modo de Times ativado' : 'Modo individual ativado')}/></label><div className="bountyStatus"><span>ALVO BOUNTY</span><b>{s.bountyTargetId ? `👑 @${s.bountyTargetId}` : 'SEM ALVO NESTA RODADA'}</b></div></div>
      </article>
      <article className="commandCard"><div className="cardTitle"><span>02</span><div><h2>Jogadores de teste</h2><p>Um nome por linha</p></div></div><textarea value={names} onChange={(e) => setNames(e.target.value)} rows="6"/><button className="primary full" onClick={() => run('/api/test/players', { names: names.split(/\n|,/).map((x) => x.trim()).filter(Boolean) }, 'Jogadores adicionados à arena')}>+ ADICIONAR COMBATENTES</button></article>
      <article className="commandCard"><div className="cardTitle"><span>03</span><div><h2>Tempestade</h2><p>Controle manual da zona</p></div></div><div className="stormValue">{s.storm || 0}<small>%</small></div><input className="stormRange" type="range" min="0" max="100" value={s.storm || 0} onChange={(e) => run('/api/storm', { value: Number(e.target.value) }, `Tempestade ajustada para ${e.target.value}%`)}/><div className="rangeLabels"><span>SEGURA</span><span>CRÍTICA</span></div></article>
    </section>

    <section className="powerSection">
      <div className="sectionHeading"><div><small>MAPA DE INTERAÇÕES</small><h2>Presente → Poder na arena</h2><p>O valor total do presente define automaticamente o efeito. Clique em testar durante uma batalha.</p></div><span className="legendBadge">7 PODERES CONFIGURADOS</span></div>
      <div className="powerGrid">{catalog.map((power, index) => <article className={`powerCard power-${power.kind}`} key={power.id} style={{ '--power': colorHex(power.color) }}>
        <div className="powerTop"><span className="powerIcon">{power.icon}</span><div><small>NÍVEL {index + 1}</small><h3>{power.label}</h3></div><b>{range(power)}<em>moedas</em></b></div>
        <p>{power.summary}</p><div className="powerMeta"><span>EXEMPLO: {power.giftExample}</span><strong>{power.damage ? `${power.damage} DANO` : power.heal ? `+${power.heal} VIDA` : `+${power.shield} ESCUDO`}</strong></div>
        <button onClick={() => testPower(power)}>TESTAR {power.icon}</button>
      </article>)}</div>
    </section>

    <section className="mappingSection">
      <div className="sectionHeading"><div><small>CONFIGURAÇÃO DA LIVE</small><h2>Presente específico → poder específico</h2><p>Cadastre o nome exato que aparece no TikTok. O mapeamento tem prioridade sobre a faixa de moedas.</p></div><span className="legendBadge">EDIÇÃO EM TEMPO REAL</span></div>
      <div className="mappingForm"><label>Nome exibido no TikTok<input value={newGift.name} placeholder="ex: Coroa, Leão, Foguete" onChange={(e) => setNewGift({ ...newGift, name: e.target.value })}/></label><label>Poder ativado<select value={newGift.kind} onChange={(e) => setNewGift({ ...newGift, kind: e.target.value })}>{catalog.map((p) => <option key={p.kind} value={p.kind}>{p.icon} {p.label}</option>)}</select></label><label>Som<select value={newGift.sound} onChange={(e) => setNewGift({ ...newGift, sound: e.target.value })}><option value="">Som do poder</option><option value="laser">Laser</option><option value="shield">Escudo</option><option value="heal">Cura</option><option value="explosion">Explosão</option><option value="airstrike">Ataque aéreo</option></select></label><button className="primary" onClick={addMapping}>SALVAR MAPA</button></div>
      <div className="mappingList">{Object.keys(giftMapping).length === 0 && <span className="empty">Nenhum mapeamento personalizado. O cálculo por moedas continua ativo.</span>}{Object.entries(giftMapping).map(([name, cfg]) => <div className="mappingRow" key={name}><b>{name}</b><span>{catalog.find((p) => p.kind === cfg.kind)?.icon || '✦'} {catalog.find((p) => p.kind === cfg.kind)?.label || cfg.kind}</span><em>{cfg.sound || 'padrão'}</em><button onClick={() => simulateMapping(name)}>TESTAR</button><button className="remove" onClick={() => removeMapping(name)}>REMOVER</button></div>)}</div>
    </section>

    <section className="lowerGrid">
      <article className="commandCard simulator"><div className="cardTitle"><span>04</span><div><h2>Simulador personalizado</h2><p>Teste qualquer valor e quantidade</p></div></div>
        <div className="formGrid"><label>Jogador<select value={gift.username} onChange={(e) => setGift({ ...gift, username: e.target.value })}>{s.players.length ? s.players.map((p) => <option key={p.id}>{p.id}</option>) : <option>Nebula</option>}</select></label><label>Nome do presente<input value={gift.giftName} onChange={(e) => setGift({ ...gift, giftName: e.target.value })}/></label><label>Moedas por presente<input min="1" value={gift.diamondCount} type="number" onChange={(e) => setGift({ ...gift, diamondCount: Math.max(1, Number(e.target.value)) })}/></label><label>Quantidade<input min="1" value={gift.repeatCount} type="number" onChange={(e) => setGift({ ...gift, repeatCount: Math.max(1, Number(e.target.value)) })}/></label></div>
        <div className="powerPreview"><span>{selectedPower?.icon || '✦'}</span><div><small>RESULTADO PREVISTO</small><b>{selectedPower?.label || 'RAJADA ESTELAR'}</b></div><em>{gift.diamondCount * gift.repeatCount} moedas</em></div><button className="primary full" onClick={() => run('/api/mock/gift', gift, `${selectedPower?.label || 'Poder'} simulado`)}>ATIVAR PODER NA ARENA</button>
      </article>
      <article className="commandCard narrator"><div className="cardTitle"><span>05</span><div><h2>Apresentador e áudio</h2><p>Personalidade da transmissão</p></div></div>
        <label className="toggle"><span><b>Apresentador automático</b><em>Narra entradas, poderes e eliminações</em></span><input type="checkbox" checked={s.settings.agentEnabled ?? true} onChange={(e) => run('/api/settings', { agentEnabled: e.target.checked }, 'Apresentador atualizado')}/></label>
        <div className="formGrid"><label>Voz<select value={s.settings.voiceMode || 'male'} onChange={(e) => run('/api/settings', { voiceMode: e.target.value }, 'Voz atualizada')}><option value="male">Masculina grave</option><option value="female">Feminina energética</option></select></label><label>Estilo<select value={s.settings.narratorStyle || 'explosive'} onChange={(e) => run('/api/settings', { narratorStyle: e.target.value }, 'Estilo do narrador atualizado')}><option value="explosive">Arena explosiva</option><option value="esports">Caster e-sports</option><option value="cinematic">Trailer cinematográfico</option></select></label><label>Intensidade<select value={s.settings.voiceIntensity || 3} onChange={(e) => run('/api/settings', { voiceIntensity: Number(e.target.value) }, 'Intensidade da voz atualizada')}><option value="1">1 — Controlada</option><option value="2">2 — Animada</option><option value="3">3 — Emoção máxima</option></select></label></div>
        <div className="audioToggles"><label className="toggle compact"><span><b>Trilha eletrônica</b></span><input type="checkbox" checked={s.settings.music ?? true} onChange={(e) => run('/api/settings', { music: e.target.checked }, 'Música atualizada')}/></label><label className="toggle compact"><span><b>Efeitos sonoros</b></span><input type="checkbox" checked={s.settings.sound ?? true} onChange={(e) => run('/api/settings', { sound: e.target.checked }, 'Efeitos atualizados')}/></label></div>
      </article>
      <article className="commandCard rosterCard"><div className="cardTitle"><span>06</span><div><h2>Combatentes</h2><p>Telemetria em tempo real</p></div></div><div className="roster">{s.players.length ? s.players.map((p, i) => <div key={p.id} className={`${p.alive ? '' : 'dead'} team-${p.team || 'blue'}`}><b><i>{i + 1}</i>{s.bountyTargetId === p.id ? '👑 ' : ''}@{p.id}</b><span>{s.settings.teamMode && <em>{p.team === 'red' ? 'VERMELHO' : 'AZUL'}</em>}<em>{p.hp} HP</em><em>{p.shield} ESC</em><em>{p.eliminations} KO</em></span></div>) : <p className="empty">Nenhum combatente adicionado.</p>}</div></article>
    </section>
  </main>;
}
