import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({
  ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
  headless: true,
  args: ['--enable-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto('http://127.0.0.1:5173/?debug', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.windLab || !document.getElementById('error').hidden);
  assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error').textContent());
  await page.waitForFunction(() => window.windLab.engine.time > 0);
  await page.evaluate(() => window.windLab.pause());
  const before = await page.locator('#sim-time').textContent();
  await page.waitForTimeout(120);
  assert.equal(await page.locator('#sim-time').textContent(), before, 'pause freezes simulated time');
  const numerical = await page.evaluate(() => {
    const e = window.windLab.engine, gl = e.gl;
    e.setPreset(2);
    const state = new Float32Array(e.side * e.side * 4);
    for (let i = 0; i < state.length; i += 4) { state[i] = .9999; state[i + 1] = .5; state[i + 2] = 0; state[i + 3] = .5; }
    const results = [];
    for (const method of [0, 1]) {
      gl.bindTexture(gl.TEXTURE_2D, e.states[0].texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, e.side, e.side, gl.RGBA, gl.FLOAT, state);
      e.method = method; e.advance(30);
      gl.bindFramebuffer(gl.FRAMEBUFFER, e.states[0].fbo);
      const pixel = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, pixel);
      results.push([...pixel]);
    }
    return { results, error: gl.getError() };
  });
  assert.equal(numerical.error, 0);
  for (const pixel of numerical.results) {
    assert.ok(Math.abs(pixel[0] - .0008) < 2e-7, `periodic x boundary: ${pixel[0]}`);
    assert.ok(Math.abs(pixel[1] - .50045) < 2e-7, 'physical m/s advection');
    assert.equal(pixel[2], 30);
  }
  console.log('PASS: real GPU readback validates Euler / RK2 uniform advection and periodic wrapping');
  const convergence = await page.evaluate(async () => {
    const { validateField } = await import('/src/data.js');
    const e = window.windLab.engine, gl = e.gl;
    const u = [], v = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { u.push((x + .5) / 8 * 60); v.push(-(y + .5) / 8 * 40); }
    e.setField(validateField({ width: 8, height: 8, domain: [600000, 400000], u, v }));
    const state = new Float32Array(e.side * e.side * 4);
    for (let i = 0; i < state.length; i += 4) { state[i] = .5; state[i + 1] = .5; state[i + 3] = .5; }
    const errors = [];
    for (const method of [0, 1]) {
      gl.bindTexture(gl.TEXTURE_2D, e.states[0].texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, e.side, e.side, gl.RGBA, gl.FLOAT, state);
      e.method = method;
      for (let step = 0; step < 10; step++) e.advance(30);
      gl.bindFramebuffer(gl.FRAMEBUFFER, e.states[0].fbo);
      const pixel = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, pixel);
      errors.push(Math.hypot(pixel[0] - .5 * Math.exp(.03), pixel[1] - .5 * Math.exp(-.03)));
    }
    return errors;
  });
  assert.ok(convergence[1] < convergence[0] / 20, `RK2 improves nonuniform-flow error: ${convergence}`);
  console.log('PASS: GPU RK2 error is at least 20× smaller than Euler on a linear strain field', convergence);
  await page.selectOption('#preset', '0');
  await page.selectOption('#particles', '512');
  await page.click('#view-3d');
  await page.click('#pause');
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('#stat-particles').textContent(), '262,144');
  assert.equal(await page.locator('#error').isVisible(), false);
  assert.equal(await page.evaluate(() => window.windLab.engine.gl.getError()), 0);
  await page.setInputFiles('#data-file', 'data/uniform.json');
  await page.waitForFunction(() => document.getElementById('notice').textContent.startsWith('导入成功'));
  assert.equal(await page.locator('#evolve').isDisabled(), true);
  await page.setInputFiles('#data-file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"width":0}') });
  await page.waitForFunction(() => document.getElementById('notice').textContent.startsWith('导入失败'));
  assert.equal(await page.evaluate(() => window.windLab.engine.imported), true);
  await page.selectOption('#preset', '0'); await page.selectOption('#particles', '256'); await page.click('#view-2d');
  await page.waitForTimeout(1800);
  const imageStats = await page.evaluate(() => {
    const e = window.windLab.engine, gl = e.gl;
    e.render(.016); const bytes = new Uint8Array(e.canvas.width * e.canvas.height * 4);
    gl.readPixels(0, 0, e.canvas.width, e.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    let lit = 0;
    for (let i = 0; i < bytes.length; i += 4) if (bytes[i + 1] > 70) lit++;
    return { lit, error: gl.getError() };
  });
  assert.ok(imageStats.lit > 500, 'canvas contains visible particles'); assert.equal(imageStats.error, 0);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile has no horizontal overflow');
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  assert.deepEqual(errors.filter(e => !e.includes('favicon.ico')), []);
  console.log('PASS: 262,144 particles, 3D view, pause, import validation, rendered pixels, mobile layout, no browser errors');
} finally { await browser.close(); }
