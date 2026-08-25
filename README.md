# StarTrades Neon Royale

Battle Royale 2D visto de cima para a LIVE `@startrades01`. Personagens caminham, miram, disparam e recebem poderes acionados por presentes e comentários.

## Recursos

- Quatro personagens originais com quatro direções.
- Movimento e combate automáticos, vida, escudo, energia, eliminações e ranking.
- Poderes: rajada, escudo, suprimentos, granada, ataque aéreo, drone e meteoro.
- Tempestade progressiva, partículas, tremor de câmera, música e efeitos sonoros originais.
- Comentários: `!entrar`, `!esquerda`, `!direita`, `!cima`, `!baixo` e `!poder`.
- Painel privado, modo simulação, integração TikTool e narrador Ollama.

## Instalação no Windows

```powershell
npm install
Copy-Item .env.example .env
ollama pull llama3.2:3b
npm run dev
```

Desenvolvimento: overlay em `http://127.0.0.1:5173` e painel em `http://127.0.0.1:5173/control`.

Para o LIVE Studio:

```powershell
npm run build
npm start
```

Use `http://127.0.0.1:4173` como fonte de navegador e abra `http://127.0.0.1:4173/control` somente no seu navegador.

## LIVE real

Edite somente o `.env` local:

```env
TIKTOK_USERNAME=startrades01
TIKTOOL_API_KEY=SUA_CHAVE_LOCAL
MOCK_MODE=false
```

Nunca envie `.env`, cookies, senha do TikTok ou a chave TikTool ao GitHub/Lovable.

## Teste recomendado

1. Abra overlay e painel.
2. Clique em **Ativar áudio** no overlay.
3. Adicione os seis jogadores de teste.
4. Inicie a rodada.
5. Simule presentes de 1, 5, 10, 30, 100, 300 e 1.000 diamantes.
6. Teste pausa, tempestade e encerramento.

TikTool é um serviço terceirizado, não oficial do TikTok. Faça uma LIVE privada antes de transmitir publicamente e mantenha supervisão.
