// `brawl-modes dev <mode> --remote`: the same shell and mode client, but the match runs on the real local
// gateway and silo (ClearScript, Orleans, snapshots) instead of in this process.
//
// This server only serves pages. It asks the gateway's development endpoint for a match and one ticket
// per player; each player page then connects straight to /modehub with its ticket.
import http from 'node:http';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { bundleClient, bundleServer, communityRoot, loadMode } from './build.js';
import { createRequire } from 'node:module';

// npm may install the kit's dependencies next to it rather than inside it.
const requireFromKit = createRequire(import.meta.url);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export async function startRemoteDevServer({ modeName, port = 5173, playerCount, seed, gateway = 'http://localhost:5121' }) {
  const mode = await loadMode(modeName);
  const { manifest } = mode;
  const count = Math.min(manifest.players.max, Math.max(manifest.players.min, playerCount ?? 2));
  const gatewayUrl = gateway.replace(/\/+$/, '');

  // The silo loads the mode from <mode>/dist/server.bundle.js. Write it now so the server runs this source.
  const distDir = path.join(mode.dir, 'dist');
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, 'server.bundle.js'), await bundleServer(mode));

  let session = null;
  let matchNumber = 0;

  async function newSession(newSeed) {
    let response;
    try {
      response = await fetch(`${gatewayUrl}/api/dev/mode-session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modeId: manifest.id, players: count, seed: newSeed ?? null }),
      });
    } catch (error) {
      throw new Error(`Cannot reach the gateway at ${gatewayUrl} (${error.cause?.code ?? error.message}). Start the silo and the gateway first.`);
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`The gateway refused to create a session (${response.status}). ${detail}\n` +
        'It must run in Development with CommunityModes__Enabled=true.');
    }
    session = await response.json();
    matchNumber++;
    console.log(`Match ${matchNumber}: ${session.matchId} (${count} players).`);
  }

  async function serveFile(res, file) {
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  }

  function safeJoin(root, relative) {
    const full = path.normalize(path.join(root, relative));
    return full.startsWith(root + path.sep) ? full : null;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const route = url.pathname;
    const json = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(value));
    };

    if (route === '/') return serveFile(res, path.join(communityRoot, 'devkit', 'ui', 'remote.html'));
    if (route === '/player.html') return serveFile(res, path.join(communityRoot, 'devkit', 'ui', 'player.html'));

    if (route.startsWith('/shell/')) {
      const file = safeJoin(path.join(communityRoot, 'shell'), route.slice('/shell/'.length));
      return file ? serveFile(res, file) : res.writeHead(403).end();
    }

    if (route === '/vendor/signalr.js') {
      return serveFile(res, requireFromKit.resolve('@microsoft/signalr/dist/browser/signalr.min.js'));
    }

    if (route === '/api/client') {
      try {
        const html = await bundleClient(mode);
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(html);
      } catch (error) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end(error.message);
      }
    }

    // Tickets are handed to the page here. This is a development server bound to localhost.
    if (route === '/api/info') {
      return json(200, {
        manifest,
        matchNumber,
        players: session.players.map((p) => ({ id: p.id, name: p.name })),
        remote: {
          gateway: gatewayUrl,
          hubUrl: gatewayUrl + session.hub,
          matchId: session.matchId,
          tickets: Object.fromEntries(session.players.map((p) => [p.id, p.ticket])),
        },
      });
    }

    if (route === '/api/restart' && req.method === 'POST') {
      try {
        await newSession();
        return json(200, { ok: true, matchId: session.matchId });
      } catch (error) {
        return json(502, { error: error.message });
      }
    }

    res.writeHead(404).end('Not found');
  });

  await newSession(seed);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log(`\n${manifest.name} ${manifest.version} is running against ${gatewayUrl}.\nDashboard: http://localhost:${port}/\n` +
    'The silo reads the server bundle once. After editing server.js, restart the silo.\n');
  return { server, port, close: () => server.close() };
}
