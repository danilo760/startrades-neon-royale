import React, { useEffect, useMemo, useState } from 'react';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const wsUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/events`;
const tokenNow = () => sessionStorage.getItem('neon-admin-token') || '';

async function requestJson(url, options = {}) {
  const token = tokenNow();
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      'x-neon-qa-lab': '1',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

const post = (url, body = {}) => requestJson(url, { method: 'POST', body: JSON.stringify(body) });

function readState(timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl());
    const timer = setTimeout(() => { socket.close(); reject(new Error('websocket-timeout')); }, timeoutMs);
    socket.onmessage = ({ data }) => {
      let event;
      try { event = JSON.parse(data); } catch { return; }
      if (!event.state) return;
      clearTimeout(timer);
      socket.close();
      resolve(event.state);
    };
    socket.onerror = () => { clearTimeout(timer); reject(new Error('websocket-error')); };
  });
}

function namesFor(count, prefix = 'QA-LAB') {
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(3, '0')}`);
}

export function QALab() {
  const [config, setConfig] = useState({ mock: false, adminConfigured: false });
  const [busy, setBusy] = useState('');
  const [report, setReport] = useState({ name: 'Nenhum teste executado', result: 'IDLE', durationMs: 0, failures: 0, warnings: [], rounds: 0, detail: 'Aguardando cenário.' });

  useEffect(() => {
    fetch('/api/config').then((response) => response.json()).then(setConfig).catch(() => setConfig({ mock: false, adminConfigured: false }));
  }, []);

  const locked = !config.mock;
  const canRun = config.mock && config.adminConfigured;
  const badge = useMemo(() => locked ? 'LOCKED LIVE' : canRun ? 'SAFE MOCK' : 'TOKEN REQUIRED', [locked, canRun]);

  const runCase = async (name, fn) => {
    if (locked) {
      setReport({ name, result: 'BLOCKED', durationMs: 0, failures: 0, warnings: ['MOCK_MODE=false'], rounds: 0, detail: 'Cenário bloqueado fora do ambiente de teste.' });
      return;
    }
    if (!tokenNow()) {
      setReport({ name, result: 'BLOCKED', durationMs: 0, failures: 0, warnings: ['ADMIN_TOKEN ausente no painel'], rounds: 0, detail: 'Digite o token administrativo acima antes de executar o QA Lab.' });
      return;
    }
    const started = performance.now();
    setBusy(name);
    try {
      const output = await fn();
      setReport({ name, result: output?.result || 'PASS', durationMs: Math.round(performance.now() - started), failures: output?.failures || 0, warnings: output?.warnings || [], rounds: output?.rounds || 0, detail: output?.detail || 'Cenário concluído.' });
    } catch (error) {
      setReport({ name, result: 'FAIL', durationMs: Math.round(performance.now() - started), failures: 1, warnings: [], rounds: 0, detail: String(error?.message || error).slice(0, 180) });
    } finally {
      setBusy('');
    }
  };

  const resetArena = async () => { await post('/api/battle/reset'); await sleep(320); };
  const spawnPlayers = async (count) => {
    const all = namesFor(count);
    for (let offset = 0; offset < all.length; offset += 30) {
      await post('/api/test/players', { names: all.slice(offset, offset + 30) });
      await sleep(320);
    }
    const state = await readState();
    if (state.players.length < count) throw new Error(`esperados ${count} jogadores, recebidos ${state.players.length}`);
    return state;
  };
  const prepareRunning = async (count = 10) => {
    await resetArena();
    await spawnPlayers(count);
    await post('/api/battle/start');
    await sleep(360);
    return readState();
  };

  const playerScenario = (count) => runCase(`TESTE ${count} JOGADORES`, async () => {
    await resetArena();
    const state = await spawnPlayers(count);
    return { detail: `${state.players.length} combatentes carregados no lobby sem bypass do rate limit.` };
  });

  const giftStorm = () => runCase('GIFT STORM', async () => {
    let state = await readState();
    if (state.phase !== 'running' || !state.players.some((player) => player.alive)) state = await prepareRunning(10);
    const catalog = await requestJson('/api/admin/gift-mappings');
    const enabled = (catalog.mappings || []).filter((mapping) => mapping.enabled).slice(0, 6);
    if (!enabled.length) throw new Error('nenhum mapping de Gift habilitado');
    const target = state.players.find((player) => player.alive);
    let applied = 0;
    const warnings = [];
    for (const mapping of enabled) {
      try {
        await post('/api/admin/gift', { targetPlayerId: target.id, giftId: mapping.giftId });
        applied += 1;
      } catch (error) {
        warnings.push(`${mapping.giftName || mapping.giftId}: ${String(error.message).slice(0, 60)}`);
      }
      await sleep(320);
    }
    return { result: applied ? 'PASS' : 'WARN', warnings, detail: `${applied}/${enabled.length} Gifts passaram pelo pipeline administrativo real.` };
  });

  const bossScenario = (phase) => runCase(`BOSS FASE ${phase}`, async () => {
    await prepareRunning(10);
    await post('/api/admin/boss');
    await sleep(420);
    if (phase > 1) await post('/api/storm', { value: phase === 2 ? 60 : 85 });
    const state = await readState();
    if (!state.boss?.active) throw new Error('Colossus não ficou ativo');
    const warnings = phase > 1 ? [`A API atual não força HP/fase. O cenário prepara pressão para alcançar a Fase ${phase} por gameplay, sem bypass autoritativo.`] : [];
    return { result: phase > 1 ? 'WARN' : 'PASS', warnings, detail: `Colossus ativo com ${Math.ceil(state.boss.hp || 0)} HP.` };
  });

  const overload = () => runCase('OVERLOAD', async () => {
    await prepareRunning(10);
    await post('/api/admin/boss');
    await sleep(320);
    await post('/api/storm', { value: 95 });
    return { result: 'WARN', warnings: ['Overload real depende da Fase 3/HP crítico; o painel não falsifica HP do boss.'], detail: 'Boss + storm crítica preparados para progressão natural até overload.' };
  });

  const suddenDeath = () => runCase('MORTE SÚBITA', async () => {
    await prepareRunning(2);
    await post('/api/storm', { value: 75 });
    await sleep(1400);
    const state = await readState();
    return { result: state.suddenDeath?.active ? 'PASS' : 'WARN', warnings: state.suddenDeath?.active ? [] : ['Morte súbita não ativou dentro da janela curta; o tick autoritativo continuará avaliando.'], detail: `storm=${state.storm}% · suddenDeath=${Boolean(state.suddenDeath?.active)}` };
  });

  const websocketReconnect = () => runCase('WEBSOCKET RECONNECT', async () => {
    const first = await readState();
    await sleep(120);
    const second = await readState();
    if (!first.roundId || !second.roundId) throw new Error('state inicial não recebido após reconnect');
    return { detail: `Reconexão recebeu state; round ${second.roundId}.` };
  });

  const chaos = () => runCase('CHAOS TEST', async () => {
    await prepareRunning(100);
    await post('/api/storm', { value: 85 });
    await sleep(320);
    await post('/api/admin/boss');
    await sleep(320);
    await post('/api/battle/pause');
    await sleep(320);
    await post('/api/battle/pause');
    const state = await readState();
    return { warnings: ['Cenário do painel é limitado. O ChaosBot CLI continua sendo o teste agressivo completo.'], detail: `${state.players.length} jogadores + storm ${state.storm}% + boss=${Boolean(state.boss?.active)} + pause/resume.` };
  });

  const infoCase = (name, detail) => runCase(name, async () => ({ result: 'INFO', warnings: ['Execução pesada permanece isolada da UI para não contornar proteções de produção.'], detail }));

  return <section className="qaLab" aria-label="QA LAB">
    <div className="qaLabHeading"><div><small>ETAPA 10 · TEST OPERATIONS</small><h2>QA LAB</h2><p>Central protegida para reproduzir cenários, estressar integrações e preparar capturas visuais sem conectar ao TikTok real.</p></div><span className={`qaBadge ${locked ? 'locked' : canRun ? 'safe' : 'token'}`}>{badge}</span></div>
    <div className="qaReport" data-testid="qa-report"><div><span>ÚLTIMO TESTE</span><b>{report.name}</b></div><div><span>RESULTADO</span><b className={`qa-${report.result.toLowerCase()}`}>{report.result}</b></div><div><span>TEMPO</span><b>{report.durationMs} ms</b></div><div><span>FALHAS</span><b>{report.failures}</b></div><div><span>RODADAS</span><b>{report.rounds}</b></div></div>
    <p className="qaDetail">{report.detail}</p>
    {report.warnings.length > 0 && <div className="qaWarnings"><strong>WARNINGS</strong>{report.warnings.map((warning, index) => <span key={`${warning}-${index}`}>{warning}</span>)}</div>}
    <div className="qaActions">
      <button disabled={Boolean(busy) || locked} onClick={() => playerScenario(10)}>TESTE 10 JOGADORES</button>
      <button disabled={Boolean(busy) || locked} onClick={() => playerScenario(50)}>TESTE 50 JOGADORES</button>
      <button disabled={Boolean(busy) || locked} onClick={() => playerScenario(100)}>TESTE 100 JOGADORES</button>
      <button disabled={Boolean(busy) || locked} onClick={giftStorm}>GIFT STORM</button>
      <button disabled={Boolean(busy) || locked} onClick={() => bossScenario(1)}>BOSS FASE 1</button>
      <button disabled={Boolean(busy) || locked} onClick={() => bossScenario(2)}>BOSS FASE 2</button>
      <button disabled={Boolean(busy) || locked} onClick={() => bossScenario(3)}>BOSS FASE 3</button>
      <button disabled={Boolean(busy) || locked} onClick={overload}>OVERLOAD</button>
      <button disabled={Boolean(busy) || locked} onClick={suddenDeath}>MORTE SÚBITA</button>
      <button disabled={Boolean(busy) || locked} onClick={websocketReconnect}>WEBSOCKET RECONNECT</button>
      <button className="danger" disabled={Boolean(busy) || locked} onClick={chaos}>CHAOS TEST</button>
      <button disabled={Boolean(busy) || locked} onClick={() => infoCase('100 RODADAS', 'Use npm run test:gameplay:100 ou o workflow manual; a UI não dispara carga longa contra o servidor.')}>100 RODADAS</button>
      <button disabled={Boolean(busy) || locked} onClick={() => infoCase('REPLAY BUG', 'Replays ficam em .qa-replays/ e são reproduzidos com npm run replay -- <arquivo.json>.')}>REPLAY BUG</button>
      <button disabled={Boolean(busy) || locked} onClick={() => { window.open('/?broadcast=vertical', '_blank', 'noopener,noreferrer'); void infoCase('SCREENSHOT TEST', 'O Playwright captura lobby, running, storm, Gift, boss, winner e vertical e anexa as imagens na CI.'); }}>SCREENSHOT TEST</button>
    </div>
    {busy && <div className="qaRunning">EXECUTANDO · {busy}</div>}
    <footer>Proteções ativas: MOCK_MODE · ADMIN_TOKEN · rate limit administrativo · sem bypass de HP/fase · sem TikTok real.</footer>
  </section>;
}
