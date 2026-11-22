import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(repoRoot, 'index.html'), 'utf8');

// Extract the pure-logic block embedded in index.html so it can be unit-tested in Node.
const pureMatch = html.match(/\/\/ ==PURE-BEGIN==([\s\S]*?)\/\/ ==PURE-END==/);
assert.ok(pureMatch, 'index.html must contain a PURE-BEGIN/END marked logic block');

const { summarizeResults, formatLatency, withTimeout, finalizeResults } = new Function(
  `${pureMatch[1]}\nreturn { summarizeResults, formatLatency, withTimeout, finalizeResults };`
)();

test('summarizeResults returns null best for empty results', () => {
  const summary = summarizeResults([]);
  assert.equal(summary.best, null);
  assert.deepEqual(summary.reachable, []);
  assert.deepEqual(summary.unreachable, []);
});

test('summarizeResults returns null best when every mirror failed', () => {
  const summary = summarizeResults([
    { id: 'a', ok: false, latencyMs: null },
    { id: 'b', ok: false, latencyMs: null },
  ]);
  assert.equal(summary.best, null);
  assert.deepEqual(summary.reachable, []);
  assert.equal(summary.unreachable.length, 2);
});

test('summarizeResults picks the reachable mirror with the lowest latency', () => {
  const summary = summarizeResults([
    { id: 'a', ok: true, latencyMs: 300 },
    { id: 'b', ok: false, latencyMs: null },
    { id: 'c', ok: true, latencyMs: 120 },
  ]);
  assert.deepEqual(summary.best, { id: 'c', ok: true, latencyMs: 120 });
});

test('summarizeResults keeps input order when latencies tie', () => {
  const summary = summarizeResults([
    { id: 'a', ok: true, latencyMs: 100 },
    { id: 'b', ok: true, latencyMs: 100 },
  ]);
  assert.equal(summary.best.id, 'a');
});

test('summarizeResults sorts reachable mirrors by ascending latency', () => {
  const summary = summarizeResults([
    { id: 'a', ok: true, latencyMs: 400 },
    { id: 'b', ok: true, latencyMs: 80 },
    { id: 'c', ok: true, latencyMs: 250 },
    { id: 'd', ok: false, latencyMs: null },
  ]);
  assert.deepEqual(summary.reachable.map((m) => m.id), ['b', 'c', 'a']);
  assert.deepEqual(summary.unreachable.map((m) => m.id), ['d']);
});

test('formatLatency rounds to a 10 ms granularity with a 10 ms floor', () => {
  assert.equal(formatLatency(5), '10 ms');
  assert.equal(formatLatency(87), '90 ms');
  assert.equal(formatLatency(123), '120 ms');
});

test('withTimeout resolves with settled value when promise finishes in time', async () => {
  const outcome = await withTimeout(Promise.resolve('ok'), 50);
  assert.deepEqual(outcome, { status: 'settled', value: 'ok' });
});

test('withTimeout reports timeout when promise does not settle in time', async () => {
  const never = new Promise(() => {});
  const outcome = await withTimeout(never, 20);
  assert.deepEqual(outcome, { status: 'timeout' });
});

test('withTimeout reports timeout when the promise rejects', async () => {
  const outcome = await withTimeout(Promise.reject(new Error('blocked')), 50);
  assert.deepEqual(outcome, { status: 'timeout' });
});

test('finalizeResults fills pending slots with an unreachable result and reports them', () => {
  const fin = finalizeResults(
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    [{ id: 'a', ok: true, latencyMs: 120 }, null, { id: 'c', ok: false, latencyMs: null }]
  );
  assert.deepEqual(fin.results, [
    { id: 'a', ok: true, latencyMs: 120 },
    { id: 'b', ok: false, latencyMs: null },
    { id: 'c', ok: false, latencyMs: null },
  ]);
  assert.deepEqual(fin.timedOutIds, ['b']);
});

test('finalizeResults reports every slot when nothing settled', () => {
  const fin = finalizeResults([{ id: 'a' }, { id: 'b' }], [null, null]);
  assert.deepEqual(fin.results.map((r) => r.ok), [false, false]);
  assert.deepEqual(fin.timedOutIds, ['a', 'b']);
});

test('the HTTP-only mirror is configured for manual access only', () => {
  const block = html.match(/\{[^}]*biotree[^}]*\}/);
  assert.ok(block, 'biotree mirror configuration must exist');
  assert.match(block[0], /auto:\s*false/);
});

test('the noscript fallback lists every mirror and the issue tracker', () => {
  const noscript = html.match(/<noscript>\s*<section[\s\S]*?<\/noscript>/);
  assert.ok(noscript, 'body-level noscript fallback must exist');
  assert.match(noscript[0], /shiny\.zhoulab\.ac\.cn\/ImmunoFusion\//);
  assert.match(noscript[0], /lisom\.work\/shinyapps\/ImmunoFusion\//);
  assert.match(noscript[0], /biotree\.top:38124\/ImmunoFusion\//);
  assert.match(noscript[0], /OncoHarmony-Network\/ImmunoFusion\/issues/);
});
