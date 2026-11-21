import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const port = Number(process.env.PORT || 5173);
createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(root + sep) || path.split('/').some(p => p.startsWith('.')) || !types[extname(file)]) {
      res.writeHead(403); return res.end('Forbidden');
    }
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)], 'Cache-Control': 'no-store' });
    res.end(content);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`ATMOS ready at http://127.0.0.1:${port}`));
