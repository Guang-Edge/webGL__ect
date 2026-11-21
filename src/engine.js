import * as shaders from './shaders.js';

export class WindEngine {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false });
    if (!gl) throw new Error('此浏览器未启用 WebGL2，请使用支持硬件加速的 Chrome、Edge 或 Firefox。');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('设备不支持 EXT_color_buffer_float，无法运行浮点纹理计算。');
    this.programs = {};
    for (const [name, vertex, fragment] of [
      ['field', shaders.quad, shaders.field], ['update', shaders.quad, shaders.update],
      ['particle', shaders.particleVertex, shaders.particleFragment],
      ['arrows', shaders.arrowsVertex, shaders.arrowsFragment],
      ['fade', shaders.quad, shaders.fade], ['composite', shaders.quad, shaders.composite],
    ]) this.programs[name] = this.program(vertex, fragment);
    gl.bindVertexArray(gl.createVertexArray());
    this.domain = [600000, 400000]; this.preset = 0; this.time = 0; this.fieldTime = 0;
    this.method = 1; this.evolve = true; this.vectors = true; this.trail = 1.8;
    this.zoom = 1; this.tilt = 0; this.yaw = 0; this.pan = [0, 0]; this.step = 30;
    this.imported = false; this.wind = this.target(128, 128, true);
    this.setParticles(256); this.resize(); this.updateField();
  }
  program(vertex, fragment) {
    const gl = this.gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(log); }
      return shader;
    };
    const program = gl.createProgram(), vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    return { program, locations: new Map() };
  }
  target(width, height, float, pixels = null) {
    const gl = this.gl;
    if (Math.max(width, height) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error('纹理尺寸超出设备上限。');
    const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, float ? gl.RGBA32F : gl.RGBA8, width, height, 0, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, pixels);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { gl.deleteTexture(texture); gl.deleteFramebuffer(fbo); throw new Error('无法分配 GPU 帧缓冲，请减少粒子数量或窗口尺寸。'); }
    return { texture, fbo, width, height };
  }
  remove(target) { if (target) { this.gl.deleteTexture(target.texture); this.gl.deleteFramebuffer(target.fbo); } }
  use(name, target = null) {
    const gl = this.gl; this.current = this.programs[name]; gl.useProgram(this.current.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fbo ?? null);
    gl.viewport(0, 0, target?.width ?? this.canvas.width, target?.height ?? this.canvas.height);
    gl.disable(gl.BLEND);
  }
  uniform(name, value, integer = false) {
    const gl = this.gl, p = this.current;
    if (!p.locations.has(name)) p.locations.set(name, gl.getUniformLocation(p.program, name));
    const location = p.locations.get(name);
    if (Array.isArray(value)) gl.uniform2fv(location, value);
    else if (integer) gl.uniform1i(location, value); else gl.uniform1f(location, value);
  }
  texture(name, target, unit) {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit); this.gl.bindTexture(this.gl.TEXTURE_2D, target.texture); this.uniform(name, unit, true);
  }
  quad() { this.gl.drawArrays(this.gl.TRIANGLES, 0, 3); }
  setParticles(side) {
    const data = new Float32Array(side * side * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = Math.random(); data[i + 1] = Math.random(); data[i + 2] = Math.random() * 22000; data[i + 3] = Math.random(); }
    const next = [this.target(side, side, true, data), this.target(side, side, true)];
    this.states?.forEach(t => this.remove(t)); this.states = next; this.side = side; this.clearTrails();
  }
  resize() {
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * this.pixelRatio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * this.pixelRatio));
    if (this.canvas.width === width && this.canvas.height === height && this.trails) return;
    this.canvas.width = width; this.canvas.height = height;
    this.trails?.forEach(t => this.remove(t)); this.trails = [this.target(width, height, false), this.target(width, height, false)]; this.clearTrails();
  }
  clearTrails() {
    const gl = this.gl;
    this.trails?.forEach(t => { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); });
  }
  updateField() {
    if (this.imported) return;
    this.use('field', this.wind); this.uniform('time', this.fieldTime); this.uniform('preset', this.preset, true); this.quad();
  }
  setPreset(preset) {
    this.remove(this.wind); this.wind = this.target(128, 128, true);
    this.preset = preset; this.imported = false; this.domain = [600000, 400000]; this.step = 30; this.time = 0; this.fieldTime = 0;
    this.updateField(); this.setParticles(this.side);
  }
  setField(data) {
    const next = this.target(data.width, data.height, true, data.pixels);
    this.remove(this.wind); this.wind = next; this.domain = data.domain; this.step = data.step;
    this.imported = true; this.time = 0; this.fieldTime = 0; this.setParticles(this.side);
  }
  advance(dt) {
    if (this.evolve) this.fieldTime += dt;
    this.updateField(); this.use('update', this.states[1]);
    this.texture('state', this.states[0], 0); this.texture('wind', this.wind, 1);
    this.uniform('domain', this.domain); this.uniform('dt', dt); this.uniform('time', this.time); this.uniform('method', this.method, true);
    this.quad(); this.states.reverse(); this.time += dt;
  }
  camera() {
    this.uniform('viewport', [this.canvas.width, this.canvas.height]); this.uniform('domain', this.domain);
    this.uniform('pan', this.pan); this.uniform('zoom', this.zoom); this.uniform('tilt', this.tilt); this.uniform('yaw', this.yaw);
  }
  render(elapsed, moving = true) {
    const gl = this.gl; this.resize();
    if (moving || this.dirty) {
      this.use('fade', this.trails[1]); this.texture('previous', this.trails[0], 0); this.uniform('retention', Math.exp(-elapsed / this.trail)); this.quad();
      this.use('particle', this.trails[1]); this.texture('state', this.states[0], 0); this.texture('wind', this.wind, 1);
      this.uniform('side', this.side, true); this.uniform('pixelRatio', this.pixelRatio); this.camera();
      this.uniform('opacity', Math.max(.025, Math.min(.4, .22 * Math.min(1, this.canvas.width * this.canvas.height / 700000) * (256 / this.side) * Math.min(2, elapsed * 60))));
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.drawArrays(gl.POINTS, 0, this.side * this.side);
      this.trails.reverse(); this.dirty = false;
    }
    this.use('composite'); this.texture('trails', this.trails[0], 0); this.uniform('resolution', [this.canvas.width, this.canvas.height]); this.quad();
    if (this.vectors) {
      this.use('arrows'); this.texture('wind', this.wind, 0); this.camera();
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.drawArrays(gl.LINES, 0, 24 * 16 * 6);
    }
  }
}
