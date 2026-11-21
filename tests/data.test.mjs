import test from 'node:test';
import assert from 'node:assert/strict';
import { validateField } from '../src/data.js';
const valid = () => ({ width: 2, height: 2, domain: [600000, 400000], u: [18, 18, 18, 18], v: [6, 6, 6, 6] });
test('packs u/v in row-major RGBA32F with physical time step', () => {
  const result = validateField(valid());
  assert.deepEqual([...result.pixels.slice(0, 8)], [18, 6, 0, 1, 18, 6, 0, 1]);
  assert.equal(result.step, 30); assert.ok(Math.abs(result.maxSpeed - Math.hypot(18, 6)) < 1e-10);
});
test('rejects malformed input before GPU upload', () => {
  for (const data of [null, {}, { ...valid(), width: 2.5 }, { ...valid(), u: [1] }, { ...valid(), v: [NaN, 1, 1, 1] }, { ...valid(), domain: [0, 1] }, { ...valid(), u: [501, 1, 1, 1] }]) assert.throws(() => validateField(data));
});
test('restricts the step to half a cell and rejects impractical grids', () => {
  assert.equal(validateField({ ...valid(), domain: [1000, 1000], u: [100, 100, 100, 100], v: [0, 0, 0, 0] }).step, 2.5);
  assert.throws(() => validateField({ ...valid(), domain: [1000, 1000], u: [500, 500, 500, 500] }));
});
