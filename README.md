# StarTrades Neon Royale

Battle Royale 2D visto de cima para TikTok LIVE, com backend Node/Express/WS autoritativo e frontend React + Phaser 3.

## Arquitetura atual

- GitHub: desenvolvimento na branch `codex/neon-royale`.
- Render: ambiente oficial de execução e preview do projeto.
- Supabase: serviço externo de persistência do ranking, configurado por variáveis de ambiente no Render.
- TikTok/TikTool: conector da LIVE quando `MOCK_MODE=false`.
- Ollama: narrador opcional; se `OLLAMA_URL` não estiver acessível no Render, o servidor usa fallback local de texto.

## Recursos

- Modo individual e Azul vs Vermelho.
- Movimento, combate, vida, escudo, eliminações e ranking autoritativos no servidor.
- Bounty/coroa do líder com pontuação tripla na eliminação do alvo.
- Quatro mapas procedurais.
- Avatares circulares.
- Gifts centralizados por `giftId`, com allowlist, cooldown, limites e idempotência.
- Rosa: bônus de entrada leve de `1.2x` por até 5 segundos; fora da arena vira bônus pendente.
- Escudo tático: cura limitada + escudo curto, sem invulnerabilidade longa.
- Meteoro: alvo neutro escolhido pelo servidor, área telegrafada e dano não letal.
- Star Power: Hype + aura dourada por até 60 segundos, sem multiplicar score competitivo.
- Colossus Neon cooperativo e autoritativo.
- Painel administrativo protegido por `ADMIN_TOKEN`.
- Narrador com prioridade, TTL, fallback e limite programático de 16 palavras.

## Desenvolvimento local

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Frontend local: `http://127.0.0.1:5173`

Painel local: `http://127.0.0.1:5173/control`

Servidor de produção local:

```powershell
npm run build
npm start
```

## Render

O `render.yaml` usa:

- branch `codex/neon-royale`;
- build `npm ci && npm run build`;
- start `npm start`;
- health check `/api/health`;
- Node 22;
- encerramento gracioso para deploy/restart.

Variáveis sensíveis devem continuar configuradas no **Render Dashboard**, nunca commitadas no GitHub:

```env
ADMIN_TOKEN=
TIKTOOL_API_KEY=
SUPABASE_URL=
SUPABASE_SECRET_KEY=
MOCK_MODE=
```

`MOCK_MODE=true` mantém o simulador administrativo. `MOCK_MODE=false` habilita o conector real e exige `TIKTOOL_API_KEY` válida.

O `render.yaml` declara essas variáveis com `sync: false`, portanto os valores existentes no Render permanecem fora do repositório.

## Supabase

O servidor lê `SUPABASE_URL` e `SUPABASE_SECRET_KEY` exclusivamente do ambiente do Render. Nenhuma migration ou alteração de banco é aplicada automaticamente por este repositório nesta etapa.

Se essas variáveis não estiverem disponíveis, o ranking possui fallback em memória; isso serve apenas para resiliência e teste.

## Segurança operacional

- Nunca envie `.env`, cookies, senha do TikTok ou tokens ao GitHub.
- O cliente nunca define magnitude, duração ou dano de Gift.
- O simulador funciona somente com autenticação administrativa e em `MOCK_MODE`.
- Use uma LIVE de teste antes de ativar o conector real em produção.
