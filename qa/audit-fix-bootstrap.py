from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path, old, new):
    text = read(path)
    if text.count(old) != 1:
        raise RuntimeError(f'{path}: expected exactly one match, got {text.count(old)} for {old[:80]!r}')
    write(path, text.replace(old, new, 1))


def replace_between(path, start_marker, end_marker, replacement):
    # The workflow's temporary amendment originally removed pickOutcome. Keep it:
    # replay fixtures already use this canonical result shape, and mapped powers should too.
    if path == 'qa/replay-runner.js' and start_marker == 'const pickOutcome':
        return
    text = read(path)
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    write(path, text[:start] + replacement + text[end:])


base_path = Path('qa/audit-fix-bootstrap-base.py')
base_source = base_path.read_text(encoding='utf-8')
namespace = {'__file__': str(base_path), '__name__': '__main__'}
exec(compile(base_source, str(base_path), 'exec'), namespace)

# Replay runner can now replay both legacy GIFT and mapped PowerExecutor GIFT paths.
runner = read('qa/replay-runner.js')
old = '            assertExpected(event, result);'
replacements = [
    '            assertExpected(pickOutcome(result), payload.expected, `SHOT#${event.seq}`);',
    '            assertExpected(pickOutcome(result), payload.expected, `DAMAGE#${event.seq}`);',
    '            assertExpected(pickOutcome(result), payload.expected, `GIFT#${event.seq}`);',
    '            assertExpected(pickOutcome(result), payload.expected, `BOSS#${event.seq}`);',
]
for replacement in replacements:
    if old not in runner:
        raise RuntimeError('qa/replay-runner.js: missing replay assertion placeholder')
    runner = runner.replace(old, replacement, 1)
round_anchor = '  reset();\n  return withDeterministicRuntime(replay.roundSeed, replay.startedAt, (runtime) => {'
round_replacement = '  reset();\n  state.round = replay.round;\n  state.roundId = replay.roundId;\n  return withDeterministicRuntime(replay.roundSeed, replay.startedAt, (runtime) => {'
if runner.count(round_anchor) != 1:
    raise RuntimeError(f'qa/replay-runner.js: expected one replay round anchor, got {runner.count(round_anchor)}')
runner = runner.replace(round_anchor, round_replacement, 1)
write('qa/replay-runner.js', runner)

Path(__file__).unlink(missing_ok=True)
