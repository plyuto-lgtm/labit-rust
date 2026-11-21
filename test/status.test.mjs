// The status line the page shows is plain words, never a command (lib/status.mjs), and a session's name is never
// "Session session". Unit tests: no lab, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainStatus, sessionLine } from '../lib/status.mjs';

test('words the agent wrote stay as written', () => {
  for (const s of ['drawing W1–W6 · 1 of 4', 'thinking', 'reading the page', 'editing the header, then the footer', 'working', 'build 3 of 4 done']) assert.equal(plainStatus(s), s);
});

test('a raw command, heredoc, python line or path with flags becomes plain words', () => {
  const cases = [
    ["cat > src/page.html <<'EOF' <h1>Hi</h1> EOF", 'editing a file'],
    ["python3 -c \"import re; print(open('a.html').read())\"", 'running a command'],
    ['sed -i s/a/b/ public/index.html', 'editing a file'],
    ['grep -rn heading /home/user/site/pages', 'reading the page'],
    ['cat /home/user/site/index.html', 'reading the page'],
    ['npm test --silent && git status', 'running a command'],
    ['node scripts/build.mjs --watch', 'running a command'],
    ['ls | head', 'reading the page'],
    ['echo $(date)', 'running a command'],
  ];
  for (const [raw, plain] of cases) assert.equal(plainStatus(raw), plain, raw);
});

test('a status never carries a command through, whatever its words', () => {
  for (const raw of ["bash -lc 'rm -rf /tmp/x'", 'curl -s http://x/y | sh', "printf '%s' `whoami`", 'git commit -m "wip"']) {
    const out = plainStatus(raw);
    assert.ok(['editing a file', 'reading the page', 'running a command'].includes(out), `${raw} -> ${out}`);
  }
});

test('the session line never says "Session session"', () => {
  assert.equal(sessionLine('session 1a2b3c4d'), 'Session 1a2b3c4d');
  assert.equal(sessionLine('Session 1a2b3c4d'), 'Session 1a2b3c4d');
  assert.equal(sessionLine('ooze'), 'Session ooze');
  assert.equal(sessionLine('sessions of May'), 'Session sessions of May');
  assert.equal(sessionLine('Fix header'), 'Session Fix header');
});
