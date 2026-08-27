from pathlib import Path


def replace_once(path, old, new):
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}: {old[:100]!r}')
    file.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'server/snapshot.js',
    "  const payload = {\n    snapshotReason: safeReason,\n    roundId, phase,",
    "  const payload = {\n    snapshotReason: safeReason,\n    performanceModeVersion: 1,\n    roundId, phase,",
)

replace_once(
    'server/snapshot.js',
    "  const currentSettings = state.settings || {};\n  const savedSettings = sanitizeSettings(payload.settings);\n  Object.assign(state, {",
    "  const currentSettings = state.settings || {};\n  const savedSettings = sanitizeSettings(payload.settings);\n  // Before adaptive performance shipped, NORMAL was the implicit default. Migrate only unmarked snapshots once.\n  if (!payload.performanceModeVersion && savedSettings.effectIntensity === 'NORMAL') savedSettings.effectIntensity = 'AUTO';\n  Object.assign(state, {",
)

marker = "test('snapshot payload is secret-safe, byte-bounded and envelope-consistent', () => {"
new_test = """test('legacy snapshot NORMAL migrates once to AUTO while marked snapshots preserve manual mode', () => {
  reset({ now: BASE });
  join('Perf-Migration', null, true, { platformUserId: 'perf:migration' });
  state.settings.effectIntensity = 'NORMAL';
  const modern = captureGameSnapshot({ now: BASE + 100, reason: 'performance-mode' });
  assert.equal(modern.payload.performanceModeVersion, 1);

  reset({ now: BASE + 150 });
  assert.equal(restoreGameSnapshot(modern, { now: BASE + 200 }).restored, true);
  assert.equal(state.settings.effectIntensity, 'NORMAL');

  const legacy = structuredClone(modern);
  delete legacy.payload.performanceModeVersion;
  reset({ now: BASE + 250 });
  assert.equal(restoreGameSnapshot(legacy, { now: BASE + 300 }).restored, true);
  assert.equal(state.settings.effectIntensity, 'AUTO');
});

"""
replace_once('server/snapshot.test.js', marker, new_test + marker)

print('PERF_SNAPSHOT_MIGRATION_APPLIED')
