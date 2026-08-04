import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeTokenSheet,
  collectClassSelectors,
  hasExactConsumer,
  parseLeafRules,
  resolveLiveTokens,
} from './check-dead-css.mjs';

// #1980 blind spot 2: `maka-shell` was reported live because the substring
// check found it inside `maka-shell-astryx`. Class names extend across
// hyphens, so a prefix hit in either direction is not a consumer.
test('a longer hyphenated class name is not a consumer of its prefix', () => {
  assert.equal(hasExactConsumer('className="maka-shell-astryx"', 'maka-shell'), false);
  assert.equal(hasExactConsumer('className="maka-shell"', 'maka-shell-astryx'), false);
});

test('exact matches count as consumers regardless of surrounding syntax', () => {
  assert.equal(hasExactConsumer('className="maka-shell chat"', 'maka-shell'), true);
  assert.equal(hasExactConsumer("classes.push('maka-shell')", 'maka-shell'), true);
  assert.equal(hasExactConsumer('<div class="a maka-shell">', 'maka-shell'), true);
});

test('class selectors are collected from compact and nested rules', () => {
  const css = `
    .maka-shell { display: grid; }
    @media (min-width: 600px) { .maka-sidebar:hover, .maka-titlebar strong { color: red; } }
    /* .maka-commented { } */
  `;
  assert.deepEqual([...collectClassSelectors(css)].sort(), [
    'maka-shell',
    'maka-sidebar',
    'maka-titlebar',
  ]);
});

test('parseLeafRules flattens at-rule wrappers to selector/body pairs', () => {
  const rules = parseLeafRules(
    '@layer components { .a { color: red; } @media (x) { .b { color: blue; } } }',
  );
  assert.deepEqual(
    rules.map((rule) => rule.selector),
    ['.a', '.b'],
  );
});

// #1980 blind spot 3: --w-rail / --w-sidebar were reported live because dead
// shell rules inside the token sheet itself read them.
test('a token read only by a dead rule in the token sheet is dead', () => {
  const sheet = `
    :root { --w-rail: 240px; }
    .maka-shell { grid-template-columns: var(--w-rail) 1fr; }
  `;
  const analysis = analyzeTokenSheet(sheet, () => false);
  assert.equal(resolveLiveTokens(new Set(), analysis).has('--w-rail'), false);
});

test('the same read counts once the rule class has a consumer', () => {
  const sheet = `
    :root { --w-rail: 240px; }
    .maka-shell { grid-template-columns: var(--w-rail) 1fr; }
  `;
  const analysis = analyzeTokenSheet(sheet, (cls) => cls === 'maka-shell');
  assert.equal(resolveLiveTokens(new Set(), analysis).has('--w-rail'), true);
});

test('token-to-token derivation keeps a base token alive only via a live head', () => {
  const sheet = ':root { --derived: var(--base); --base: 4px; }';
  const analysis = analyzeTokenSheet(sheet, () => false);
  assert.equal(resolveLiveTokens(new Set(['--derived']), analysis).has('--base'), true);
  assert.equal(resolveLiveTokens(new Set(), analysis).has('--base'), false);
});

test('derivation chains resolve transitively', () => {
  const sheet = ':root { --a: var(--b); --b: var(--c); --c: 1px; }';
  const analysis = analyzeTokenSheet(sheet, () => false);
  const live = resolveLiveTokens(new Set(['--a']), analysis);
  assert.equal(live.has('--c'), true);
});

test('reads in rules without class selectors always count', () => {
  const sheet = 'body { margin: var(--space-page); }';
  const analysis = analyzeTokenSheet(sheet, () => false);
  assert.equal(resolveLiveTokens(new Set(), analysis).has('--space-page'), true);
});
