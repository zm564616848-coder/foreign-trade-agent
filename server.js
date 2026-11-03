import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createTrackingService, TrackingError } from './tracking.js';
import { createAgentRouter } from './agent-routes.js';

const root = path.resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
export function createServer({ track = createTrackingService(), enableTracking = false, agentService } = {}) {
  const agentRouter=createAgentRouter(agentService?{service:agentService}:{});
  const requests = new Map();
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if(await agentRouter(req,res,url))return;
    if (url.pathname === '/api/track') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      if (!enableTracking) { res.writeHead(410); return res.end(JSON.stringify({ error: '当前已切换为官网直达查询，本页轨迹接口已停用' })); }
      if (req.method !== 'POST') { res.writeHead(405); return res.end(JSON.stringify({ error: '请使用 POST 查询' })); }
      try {
        // Do not trust client-supplied forwarding headers for rate limits.
        const ip = req.socket.remoteAddress;
        const now = Date.now();
        for (const [key, value] of requests) if (now - value.start >= 60000) requests.delete(key);
        const bucket = requests.get(ip) || { start: now, count: 0 };
        requests.set(ip, bucket);
        if (++bucket.count > 10) throw new TrackingError(429, '查询过于频繁，请一分钟后再试');
        if (!req.headers['content-type']?.startsWith('application/json')) throw new TrackingError(415, '请求需要 JSON 格式');
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 2048) throw new TrackingError(413, '查询请求过大');
        }
        let input;
        try { input = JSON.parse(body); } catch { throw new TrackingError(400, '请求格式错误'); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TrackingError(400, '请求格式错误');
        const result = await track(input);
        return res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(error instanceof TrackingError ? error.status : 500);
        return res.end(JSON.stringify({ error: error instanceof TrackingError ? error.message : '查询暂时失败，请稍后重试' }));
      }
    }
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', mode: 'official-links', carriers: 19 }));
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    try {
      const pathname = decodeURIComponent(url.pathname);
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://*.supabase.co; media-src 'self' blob: https://*.supabase.co; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, '0.0.0.0', () => console.log(`LogiHub listening on port ${port}`));
}
