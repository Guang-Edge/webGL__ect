export function validateField(value) {
  if (!value || typeof value !== 'object') throw new Error('数据必须是 JSON 对象。');
  const { width, height, domain, u, v } = value;
  if (![width, height].every(n => Number.isInteger(n) && n >= 2 && n <= 1024)) {
    throw new Error('width / height 必须是 2–1024 的整数。');
  }
  if (!Array.isArray(domain) || domain.length !== 2 || !domain.every(n => Number.isFinite(n) && n >= 1000 && n <= 1e8)) {
    throw new Error('domain 必须包含两个 1,000–100,000,000 米的边长。');
  }
  if (![u, v].every(a => Array.isArray(a) && a.length === width * height && a.every(n => Number.isFinite(n) && Math.abs(n) <= 500))) {
    throw new Error('u / v 长度必须等于 width × height，且为绝对值不超过 500 m/s 的有限数值。');
  }
  const pixels = new Float32Array(width * height * 4);
  let maxSpeed = 0;
  u.forEach((x, i) => { pixels[i * 4] = x; pixels[i * 4 + 1] = v[i]; pixels[i * 4 + 3] = 1; maxSpeed = Math.max(maxSpeed, Math.hypot(x, v[i])); });
  // Half-cell CFL-like displacement bound, capped at 30 simulated seconds.
  const step = Math.min(30, .5 * Math.min(domain[0] / width, domain[1] / height) / Math.max(maxSpeed, .001));
  if (step < 1) throw new Error('网格过细或速度过大：请增大 domain 或降低网格分辨率，使安全步长至少为 1 s。');
  return { width, height, domain, pixels, step, maxSpeed };
}
