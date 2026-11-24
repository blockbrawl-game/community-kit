// `brawl-modes dev` for an offline mode: serves the shell and the mode client. There is no match to run.
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { bundleClient, communityRoot, loadMode } from './build.js';

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mode dev kit (offline)</title>
<style>
  html, body { height: 100%; margin: 0; background: #14161c; color: #e8eaf0; font: 13px/1.4 system-ui, sans-serif; display: flex; flex-direction: column; }
  header { display: flex; gap: 12px; align-items: center; padding: 8px 12px; border-bottom: 1px solid #2a2f39; }
  header b { flex: 1; }
  button { font: inherit; color: inherit; background: #1e222b; border: 1px solid #2a2f39; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
  iframe { flex: 1; width: min(100%, 420px); margin: 0 auto; border: 0; }
</style>
</head>
<body>
<header><b id="title"></b><span id="status">loading</span><button id="reload">Restart</button></header>
<iframe id="mode" title="Mode client"></iframe>
<script type="module">
import { createOfflineShell } from '/shell/shell.js';

const info = await (await fetch('/api/info')).json();
document.getElementById('title').textContent = info.manifest.name + ' ' + info.manifest.version + ' (offline)';
const status = document.getElementById('status');
const response = await fetch('/api/client');
const modeHtml = await response.text();
if (!response.ok) { status.textContent = 'Client build failed: ' + modeHtml; throw new Error(modeHtml); }

const you = 'p1';
createOfflineShell({
  frame: document.getElementById('mode'),
  modeHtml,
  info: { modeId: info.manifest.id, version: info.manifest.version, you, players: [{ id: you, name: 'Player 1', isBot: false }] },
  onEvent(event, detail) {
    if (event === 'sync') status.textContent = 'running';
    if (event === 'result') status.textContent = 'result: score ' + detail.score;
    if (event === 'exit') status.textContent = 'the mode asked to exit';
    if (event === 'blocked') status.textContent = 'blocked: ' + detail.reason;
  },
});
document.getElementById('reload').addEventListener('click', () => location.reload());
</script>
</body>
</html>`;

export async function startOfflineDevServer({ modeName, port = 5173 }) {
  const mode = await loadMode(modeName);
  const shellRoot = path.join(communityRoot, 'shell');

  const server = http.createServer(async (req, res) => {
    const route = new URL(req.url, `http://${req.headers.host}`).pathname;
    const send = (status, type, body) => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };

    if (route === '/') return send(200, 'text/html; charset=utf-8', PAGE);
    if (route === '/api/info') return send(200, 'application/json', JSON.stringify({ manifest: mode.manifest }));

    // Rebuilt on every request so a browser reload picks up edits.
    if (route === '/api/client') {
      try {
        return send(200, 'text/plain; charset=utf-8', await bundleClient(mode));
      } catch (error) {
        console.error(`[client build] ${error.message}`);
        return send(500, 'text/plain; charset=utf-8', error.message);
      }
    }

    if (route.startsWith('/shell/')) {
      const file = path.normalize(path.join(shellRoot, route.slice('/shell/'.length)));
      if (!file.startsWith(shellRoot + path.sep)) return send(403, 'text/plain', 'Forbidden');
      try {
        return send(200, 'text/javascript; charset=utf-8', await readFile(file));
      } catch {
        return send(404, 'text/plain', 'Not found');
      }
    }

    send(404, 'text/plain', 'Not found');
  });

  await new Promise((resolve) => server.listen(port, resolve));
  console.log(`${mode.manifest.name} ${mode.manifest.version} (offline): http://localhost:${port}`);
}
