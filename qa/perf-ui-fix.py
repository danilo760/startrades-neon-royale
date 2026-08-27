from pathlib import Path


def replace_once(path, old, new):
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}: {old[:100]!r}')
    file.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'src/control/Control.jsx',
    "  const [token, setToken] = useState(() => sessionStorage.getItem('neon-admin-token') || '');\n  const [effectMode, setEffectMode] = useState(() => {\n    const stored = String(localStorage.getItem('neon-effect-mode') || '').toUpperCase();\n    if (['AUTO', 'BAIXA', 'NORMAL', 'ALTA'].includes(stored)) return stored;\n    localStorage.setItem('neon-effect-mode', 'AUTO');\n    return 'AUTO';\n  });\n  const [names, setNames] = useState('Nebula\\nCyberFox\\nLimeGuard\\nBlaze\\nNovaX\\nSpectra');",
    "  const [token, setToken] = useState(() => sessionStorage.getItem('neon-admin-token') || '');\n  const [names, setNames] = useState('Nebula\\nCyberFox\\nLimeGuard\\nBlaze\\nNovaX\\nSpectra');",
)

replace_once(
    'src/control/Control.jsx',
    "          <label>Intensidade de efeitos<select aria-label=\"Effect Intensity\" value={effectMode} onChange={(e) => { const value = e.target.value; setEffectMode(value); localStorage.setItem('neon-effect-mode', value); void run('/api/settings', { effectIntensity: value }, value === 'AUTO' ? 'Otimização automática ativada' : 'Intensidade visual atualizada'); }}><option value=\"AUTO\">AUTO · adapta ao FPS</option><option value=\"BAIXA\">BAIXA</option><option value=\"NORMAL\">NORMAL</option><option value=\"ALTA\">ALTA</option></select></label>",
    "          <label>Intensidade de efeitos<select aria-label=\"Server Effect Intensity\" value={s.settings?.effectIntensity || 'AUTO'} onChange={(e) => run('/api/settings', { effectIntensity: e.target.value }, e.target.value === 'AUTO' ? 'Otimização automática definida no servidor' : 'Intensidade visual do servidor atualizada')}><option value=\"AUTO\">AUTO · adapta ao FPS</option><option value=\"BAIXA\">BAIXA</option><option value=\"NORMAL\">NORMAL</option><option value=\"ALTA\">ALTA</option></select></label>",
)

replace_once(
    'src/main.jsx',
    "window.WebSocket = NeonWebSocket;\nif (!localStorage.getItem('neon-effect-mode')) localStorage.setItem('neon-effect-mode', 'AUTO');\n\nconst Overlay",
    "window.WebSocket = NeonWebSocket;\n\nconst Overlay",
)

print('PERF_UI_FIX_APPLIED')
