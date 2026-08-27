from pathlib import Path


def replace_once(path, old, new):
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}: {old[:90]!r}')
    file.write_text(text.replace(old, new, 1), encoding='utf-8')


def replace_exact_count(path, old, new, expected):
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{path}: expected {expected} matches, found {count}: {old[:90]!r}')
    file.write_text(text.replace(old, new), encoding='utf-8')


# 1) The live overlay must instantiate the extended scene that owns the watchdog.
replace_once(
    'src/overlay/Overlay.jsx',
    "import { GameScene } from '../game/GameScene.js';",
    "import { GameScene } from '../game/NeonRoyaleScene.js';",
)

# 2) Collapse bursty full-state WebSocket messages to at most one React/Phaser sync per animation frame.
replace_once(
    'src/overlay/Overlay.jsx',
    "    let musicEnabled = null;\n    let soundEnabled = null;\n    const killTimerMap = killTimers.current;",
    "    let musicEnabled = null;\n    let soundEnabled = null;\n    let pendingState = null;\n    let stateFrame = 0;\n    const killTimerMap = killTimers.current;",
)
replace_once(
    'src/overlay/Overlay.jsx',
    "    const syncAudioSettings = (settings = {}) => {\n      const nextMusic = settings.music !== false;\n      const nextSound = settings.sound !== false;\n      if (nextMusic !== musicEnabled) { musicEnabled = nextMusic; setMusic(nextMusic); }\n      if (nextSound !== soundEnabled) { soundEnabled = nextSound; setSound(nextSound); }\n    };\n\n    const connect = () => {",
    "    const syncAudioSettings = (settings = {}) => {\n      const nextMusic = settings.music !== false;\n      const nextSound = settings.sound !== false;\n      if (nextMusic !== musicEnabled) { musicEnabled = nextMusic; setMusic(nextMusic); }\n      if (nextSound !== soundEnabled) { soundEnabled = nextSound; setSound(nextSound); }\n    };\n    const flushState = () => {\n      stateFrame = 0;\n      const latest = pendingState;\n      pendingState = null;\n      if (!latest || !mounted) return;\n      setState(latest);\n      scene.syncState(latest);\n      syncAudioSettings(latest.settings);\n    };\n    const queueState = (next) => {\n      pendingState = next;\n      if (!stateFrame) stateFrame = requestAnimationFrame(flushState);\n    };\n\n    const connect = () => {",
)
replace_once(
    'src/overlay/Overlay.jsx',
    "        if (next && event.type !== 'combat:shot') {\n          setState(next);\n          scene.syncState(next);\n          syncAudioSettings(next.settings);\n        }",
    "        if (next && event.type !== 'combat:shot') queueState(next);",
)
replace_once(
    'src/overlay/Overlay.jsx',
    "      clearTimeout(retry);\n      clearTimeout(giftTimer.current);",
    "      clearTimeout(retry);\n      clearTimeout(giftTimer.current);\n      if (stateFrame) cancelAnimationFrame(stateFrame);\n      pendingState = null;",
)

# 3) AUTO is the default adaptive mode. Explicit LOW/HIGH/manual modes still win.
replace_once(
    'src/game/NeonRoyaleScene.js',
    "  const stored = typeof localStorage !== 'undefined' ? String(localStorage.getItem('neon-effect-mode') || '').toUpperCase() : '';\n  const mode = ['AUTO', 'BAIXA', 'NORMAL', 'ALTA', 'LOW', 'HIGH', 'EMERGENCY'].includes(stored)\n    ? stored\n    : String(scene.state?.settings?.effectIntensity || 'AUTO').toUpperCase();",
    "  const stored = typeof localStorage !== 'undefined' ? String(localStorage.getItem('neon-effect-mode') || '').toUpperCase() : '';\n  const serverModeRaw = String(scene.state?.settings?.effectIntensity || 'AUTO').toUpperCase();\n  const serverMode = ['AUTO', 'BAIXA', 'NORMAL', 'ALTA', 'LOW', 'HIGH', 'EMERGENCY'].includes(serverModeRaw) ? serverModeRaw : 'AUTO';\n  const mode = ['AUTO', 'BAIXA', 'NORMAL', 'ALTA', 'LOW', 'HIGH', 'EMERGENCY'].includes(stored)\n    ? stored\n    : serverMode;",
)

# 4) Make AUTO a first-class server setting and snapshot value.
replace_exact_count(
    'server/index.js',
    "state.settings.effectIntensity ||= 'NORMAL';",
    "state.settings.effectIntensity ||= 'AUTO';",
    2,
)
replace_once(
    'server/index.js',
    "  if (['BAIXA', 'NORMAL', 'ALTA'].includes(String(req.body.effectIntensity || '').toUpperCase())) state.settings.effectIntensity = String(req.body.effectIntensity).toUpperCase();",
    "  if (['AUTO', 'BAIXA', 'NORMAL', 'ALTA'].includes(String(req.body.effectIntensity || '').toUpperCase())) state.settings.effectIntensity = String(req.body.effectIntensity).toUpperCase();",
)
replace_once(
    'server/snapshot.js',
    "  const effectIntensity = ['BAIXA', 'NORMAL', 'ALTA'].includes(String(settings.effectIntensity || '').toUpperCase()) ? String(settings.effectIntensity).toUpperCase() : 'NORMAL';",
    "  const effectIntensity = ['AUTO', 'BAIXA', 'NORMAL', 'ALTA'].includes(String(settings.effectIntensity || '').toUpperCase()) ? String(settings.effectIntensity).toUpperCase() : 'AUTO';",
)

# 5) Control panel persists the client-side performance mode so broadcast tabs on the same origin use it.
replace_once(
    'src/control/Control.jsx',
    "  const [token, setToken] = useState(() => sessionStorage.getItem('neon-admin-token') || '');\n  const [names, setNames] = useState('Nebula\\nCyberFox\\nLimeGuard\\nBlaze\\nNovaX\\nSpectra');",
    "  const [token, setToken] = useState(() => sessionStorage.getItem('neon-admin-token') || '');\n  const [effectMode, setEffectMode] = useState(() => {\n    const stored = String(localStorage.getItem('neon-effect-mode') || '').toUpperCase();\n    if (['AUTO', 'BAIXA', 'NORMAL', 'ALTA'].includes(stored)) return stored;\n    localStorage.setItem('neon-effect-mode', 'AUTO');\n    return 'AUTO';\n  });\n  const [names, setNames] = useState('Nebula\\nCyberFox\\nLimeGuard\\nBlaze\\nNovaX\\nSpectra');",
)
replace_once(
    'src/control/Control.jsx',
    "          <label>Intensidade de efeitos<select value={s.settings?.effectIntensity || 'NORMAL'} onChange={(e) => run('/api/settings', { effectIntensity: e.target.value }, 'Intensidade visual atualizada')}><option value=\"BAIXA\">BAIXA</option><option value=\"NORMAL\">NORMAL</option><option value=\"ALTA\">ALTA</option></select></label>",
    "          <label>Intensidade de efeitos<select aria-label=\"Effect Intensity\" value={effectMode} onChange={(e) => { const value = e.target.value; setEffectMode(value); localStorage.setItem('neon-effect-mode', value); void run('/api/settings', { effectIntensity: value }, value === 'AUTO' ? 'Otimização automática ativada' : 'Intensidade visual atualizada'); }}><option value=\"AUTO\">AUTO · adapta ao FPS</option><option value=\"BAIXA\">BAIXA</option><option value=\"NORMAL\">NORMAL</option><option value=\"ALTA\">ALTA</option></select></label>",
)

print('PERF_FIX_APPLIED')
