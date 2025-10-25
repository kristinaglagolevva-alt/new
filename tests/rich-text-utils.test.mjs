import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const tempDir = mkdtempSync(join(tmpdir(), 'rte-test-'));
const outfile = join(tempDir, 'rich-text-utils.js');

await build({
  entryPoints: ['src/components/rich-text-utils.ts'],
  outfile,
  format: 'esm',
  bundle: false,
  platform: 'node',
  target: ['es2020'],
  loader: {
    '.ts': 'ts',
  },
});

const { FONT_SIZE_STEPS, DEFAULT_FONT_SIZE, findNearestFontSize, pxToPt } = await import(
  pathToFileURL(outfile).href
);

test('pxToPt converts px to pt rounding to nearest integer', () => {
  assert.equal(pxToPt(16), 12);
  assert.equal(pxToPt(24), 18);
  assert.equal(pxToPt(0), 0);
});

test('FONT_SIZE_STEPS contains sorted numeric size steps', () => {
  const sorted = [...FONT_SIZE_STEPS].sort((a, b) => a - b);
  assert.deepEqual(FONT_SIZE_STEPS, sorted);
  assert.equal(FONT_SIZE_STEPS[0], 10);
  assert.equal(FONT_SIZE_STEPS.at(-1), 36);
});

test('findNearestFontSize returns closest available step', () => {
  assert.equal(findNearestFontSize(11), 11);
  assert.equal(findNearestFontSize(13), 12);
  assert.equal(findNearestFontSize(23), 24);
  assert.equal(findNearestFontSize(34), 32);
});

test('DEFAULT_FONT_SIZE is part of the available steps', () => {
  assert.ok(FONT_SIZE_STEPS.includes(DEFAULT_FONT_SIZE));
});

test('findNearestFontSize clamps above and below available range', () => {
  assert.equal(findNearestFontSize(4), FONT_SIZE_STEPS[0]);
  assert.equal(findNearestFontSize(100), FONT_SIZE_STEPS.at(-1));
});

rmSync(tempDir, { recursive: true, force: true });
