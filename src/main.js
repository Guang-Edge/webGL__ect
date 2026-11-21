import { WindEngine } from './engine.js';
import { validateField } from './data.js';

const $ = id => document.getElementById(id);
const canvas = $('wind');
let engine, running = true, accumulator = 0, previous = performance.now(), frames = 0, fpsTime = previous;
const showError = error => { $('error').hidden = false; $('error').textContent = error.message; $('run-state').textContent = '模拟已停止'; running = false; };

try { engine = new WindEngine(canvas); } catch (error) { showError(error); }

if (engine) {
  const invalidate = () => { engine.clearTrails(); engine.dirty = true; };
  const resetCamera = () => { engine.zoom = 1; engine.pan = [0, 0]; engine.yaw = 0; invalidate(); };
  const guarded = fn => (...args) => { try { fn(...args); } catch (error) { showError(error); } };
  $('particles').addEventListener('change', guarded(() => {
    engine.setParticles(Number($('particles').value)); engine.dirty = true;
    const count = (engine.side ** 2).toLocaleString('en-US'); $('particle-output').textContent = count; $('stat-particles').textContent = count;
  }));
  $('integrator').addEventListener('change', () => {
    engine.method = Number($('integrator').value);
    document.querySelector('.pipeline').innerHTML = `RGBA32F <em> / </em> ${engine.method ? 'RK2' : 'Euler'}`;
  });
  $('speed').addEventListener('input', () => { $('speed-output').textContent = Number($('speed').value).toLocaleString('en-US') + '×'; });
  $('trail').addEventListener('input', () => { engine.trail = Number($('trail').value); $('trail-output').textContent = engine.trail.toFixed(1) + ' s'; });
  $('vectors').addEventListener('change', () => { engine.vectors = $('vectors').checked; });
  $('evolve').addEventListener('change', () => { engine.evolve = $('evolve').checked; });
  $('pause').addEventListener('click', () => {
    running = !running; accumulator = 0;
    $('pause').textContent = running ? '暂停模拟' : '继续模拟'; $('run-state').textContent = running ? '● 正在模拟' : 'Ⅱ 已暂停';
  });
  $('reset').addEventListener('click', guarded(() => { engine.setParticles(engine.side); engine.dirty = true; }));
  $('reset-view').addEventListener('click', resetCamera);
  function view(tilt) {
    engine.tilt = tilt; resetCamera();
    $('view-2d').classList.toggle('active', !tilt); $('view-3d').classList.toggle('active', !!tilt);
    $('camera-hint').textContent = tilt ? '拖动旋转 · 滚轮缩放' : '滚轮缩放 · 拖动平移';
  }
  $('view-2d').addEventListener('click', () => view(0));
  $('view-3d').addEventListener('click', () => view(.8));
  const descriptions = ['两个反向旋转的涡旋叠加背景风，观察粒子在剪切流中的轨迹。', '周期性的高速风带与横向扰动，观察剪切和平流运动。', '恒定速度 u = 18、v = 6 m/s，可作为积分与采样的基准。'];
  $('preset').addEventListener('change', guarded(() => {
    engine.setPreset(Number($('preset').value)); accumulator = 0; resetCamera();
    $('scene-name').textContent = ['双涡旋风场', '西风急流', '均匀风场'][engine.preset];
    $('field-description').textContent = descriptions[engine.preset]; $('source-label').textContent = 'SYNTHETIC FIELD';
    $('evolve').disabled = false; $('domain-label').textContent = '600 × 400 km'; $('grid-label').textContent = '128 × 128';
    $('notice').textContent = '支持规则网格 u / v 分量，单位 m/s。';
  }));
  $('data-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('文件请控制在 32 MB 以内。');
      const data = validateField(JSON.parse(await file.text()));
      engine.setField(data); accumulator = 0; resetCamera();
      $('preset').selectedIndex = -1; $('scene-name').textContent = file.name; $('source-label').textContent = 'IMPORTED FIELD';
      $('evolve').disabled = true; $('field-description').textContent = '已载入静态规则网格。数据按周期边界采样，网格点位于单元中心。';
      $('domain-label').textContent = data.domain.map(n => (n / 1000).toLocaleString()).join(' × ') + ' km';
      $('grid-label').textContent = `${data.width} × ${data.height}`;
      $('notice').textContent = `导入成功 · 最大风速 ${data.maxSpeed.toFixed(1)} m/s · 步长 ${data.step.toFixed(2)} s`;
    } catch (error) { $('notice').textContent = '导入失败：' + error.message; }
    event.target.value = '';
  });
  let drag = null;
  canvas.addEventListener('pointerdown', event => { drag = [event.clientX, event.clientY]; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', event => {
    if (!drag) return;
    const dx = event.clientX - drag[0], dy = event.clientY - drag[1]; drag = [event.clientX, event.clientY];
    if (engine.tilt) { engine.yaw += dx * .006; engine.tilt = Math.max(.1, Math.min(1.2, engine.tilt + dy * .004)); }
    else { engine.pan[0] += dx / canvas.clientWidth * 2; engine.pan[1] -= dy / canvas.clientHeight * 2; }
    invalidate();
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('wheel', event => { event.preventDefault(); engine.zoom = Math.min(4, Math.max(.4, engine.zoom * Math.exp(-event.deltaY * .001))); invalidate(); }, { passive: false });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); showError(new Error('GPU 上下文已丢失，请刷新页面重新初始化。')); });
  new ResizeObserver(() => { engine.dirty = true; }).observe(canvas);
  document.addEventListener('visibilitychange', () => { previous = performance.now(); accumulator = 0; frames = 0; fpsTime = previous; });
  function tick(now) {
    if ($('error').hidden === false) return;
    const elapsed = Math.min((now - previous) / 1000, .1); previous = now;
    try {
      if (!document.hidden) {
        if (running) {
          accumulator += elapsed * Number($('speed').value);
          let steps = 0;
          while (accumulator >= engine.step && steps < 8) { engine.advance(engine.step); accumulator -= engine.step; steps++; }
          // Slow simulation under load instead of increasing dt or retaining an unbounded backlog.
          if (steps === 8 && accumulator >= engine.step) accumulator %= engine.step;
        }
        engine.render(elapsed, running);
        frames++;
        if (now - fpsTime >= 500) { $('fps').textContent = Math.round(frames * 1000 / (now - fpsTime)); frames = 0; fpsTime = now; }
        const t = Math.floor(engine.time); $('sim-time').textContent = [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map(n => String(n).padStart(2, '0')).join(':');
      }
      requestAnimationFrame(tick);
    } catch (error) { showError(error); }
  }
  requestAnimationFrame(tick);
  // Explicit opt-in diagnostics for GPU readback tests. Never read pixels in the normal frame loop.
  if (new URLSearchParams(location.search).has('debug')) window.windLab = { engine, pause() { if (running) $('pause').click(); } };
}
