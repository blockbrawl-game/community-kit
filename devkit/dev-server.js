// `brawl-modes dev`: runs one match of a mode locally and serves the shell, the mode client and a dashboard.
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { bundleClient, bundleServer, communityRoot, loadMode } from './build.js';
import { pathToFileURL } from 'node:url';
import { MatchHost, devPlayers } from './match.js';
import { ModeError } from './sandbox.js';
import { makeRng } from './test.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
};

export async function startDevServer({ modeName, port = 5173, host: listenHost = '127.0.0.1', playerCount, seed, bots = 0, botDelayMs = 700 }) {
  const mode = await loadMode(modeName);
  const { manifest } = mode;
  const count = Math.min(manifest.players.max, Math.max(manifest.players.min, playerCount ?? 2));
  const players = devPlayers(count);
  // `--bots N`: the last N players are played by the mode's own fuzz generator (tests/fuzz.js), through a client
  // model fed with the same messages a real client gets. So one person can play a two-player mode, on a phone too.
  const botCount = Math.max(0, Math.min(count - 1, bots));
  const botIds = new Set(players.slice(count - botCount).map((p) => p.id));
  for (const p of players) if (botIds.has(p.id)) { p.name = `Bot ${p.name.split(' ')[1]}`; p.isBot = true; }
  let botKit = null;
  if (botCount > 0) {
    if (!manifest.fuzz) throw new Error('--bots needs a "fuzz" file in mode.json: the bots play with its nextAction.');
    const { createModel } = await import(pathToFileURL(path.join(mode.dir, manifest.clientModel)).href);
    const { nextAction } = await import(pathToFileURL(path.join(mode.dir, manifest.fuzz)).href);
    botKit = { createModel, nextAction, rng: makeRng((seed ?? 1) ^ 0x5bd1e995) };
  }
  const botState = new Map();

  /** @type {MatchHost} */
  let host;
  let startedAt = 0;
  let ticker = null;
  let running = false;
  let matchNumber = 0;

  // Per-player connection and simulated network conditions.
  const conns = new Map(players.map((p) => [p.id, { res: null, latencyMs: 0, dropRate: 0, everConnected: false }]));
  const dashboards = new Set();

  function toDashboards(event) {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of dashboards) res.write(line);
  }

  function botThink(playerId) {
    const bot = botState.get(playerId);
    if (!bot || bot.timer || host.ended) return;
    bot.timer = setTimeout(() => {
      bot.timer = null;
      if (botState.get(playerId) !== bot || host.ended) return;
      const action = botKit.nextAction(bot.model, playerId, botKit.rng);
      if (action == null) return;
      guard(() => {
        if (running) startedAt += host.advanceTo(hostNow());
        host.action(playerId, `bot${++bot.actions}`, action, running ? hostNow() : host.timeMs);
      });
    }, botDelayMs);
  }

  function toBot(playerId, message) {
    const bot = botState.get(playerId);
    if (!bot) return;
    if (message.kind === 'sync') bot.model.applySync(message.steps, message.info);
    else if (message.kind === 'steps') bot.model.applySteps(message);
    else if (message.kind === 'rejected') bot.model.onRejected?.(message.actionId, message.reason);
    if (message.kind === 'sync' || message.kind === 'steps' || message.kind === 'rejected') botThink(playerId);
  }

  function deliver(playerId, message) {
    if (botIds.has(playerId)) return toBot(playerId, message);
    const conn = conns.get(playerId);
    const index = players.findIndex((p) => p.id === playerId);
    const bytes = JSON.stringify(message).length;
    // Only step batches are dropped: that is the case the shell's gap detection exists for.
    const dropped = message.kind === 'steps' && Math.random() < conn.dropRate;
    toDashboards({ type: 'out', player: index, kind: message.kind, seq: message.seq, steps: message.steps?.length, bytes, dropped, message });
    if (dropped || !conn.res) return;
    const res = conn.res;
    const write = () => { if (conn.res === res) res.write(`data: ${JSON.stringify(message)}\n\n`); };
    if (conn.latencyMs > 0) setTimeout(write, conn.latencyMs);
    else write();
  }

  let guardedCalls = 0;

  function guard(fn) {
    try {
      fn();
      // The state size limit is checked now and then, since measuring it means serializing the state.
      if (++guardedCalls % 25 === 0 && !host.ended) host.checkStateSize();
    } catch (error) {
      if (!(error instanceof ModeError)) throw error;
      console.error(`\n[mode error] ${error.message}`);
      if (error.details?.stack) console.error(error.details.stack);
      toDashboards({ type: 'error', message: error.message });
      stopTicker();
    }
    flushLogs();
    if (host.ended) stopTicker();
    // Any call can change when the mode wants its next tick (ctx.sleepUntil, or an action waking it).
    else armTicker();
  }

  function flushLogs() {
    for (const line of host.sandbox.logs.splice(0)) {
      console.log(`[mode] ${line}`);
      toDashboards({ type: 'log', message: line });
    }
  }

  // Host match time: milliseconds since the match clock was anchored, as on the server.
  const hostNow = () => Date.now() - startedAt;

  function stopTicker() {
    if (ticker) clearTimeout(ticker);
    ticker = null;
    running = false;
  }

  // One timer on the 50 ms grid (devkit/clock.js), re-armed for the next due tick, as the server's match grain does.
  function armTicker() {
    if (ticker) clearTimeout(ticker);
    ticker = null;
    if (!running || host.ended) return;
    const delay = host.msToNextTick(hostNow());
    if (delay !== Infinity) ticker = setTimeout(onTicker, delay);
  }

  function onTicker() {
    ticker = null;
    guard(() => { startedAt += host.advanceTo(hostNow()); });
  }

  function startTicker() {
    if (running || host.ended) return;
    startedAt = Date.now() - host.timeMs;
    running = true;
    armTicker();
  }

  async function newMatch(newSeed) {
    stopTicker();
    const bundle = await bundleServer(mode);
    matchNumber++;
    host = new MatchHost({
      manifest,
      bundle,
      players,
      seed: newSeed ?? Math.floor(Math.random() * 0x7fffffff),
      onSend: deliver,
    });
    for (const bot of botState.values()) clearTimeout(bot.timer);
    botState.clear();
    for (const id of botIds) botState.set(id, { model: botKit.createModel(), timer: null, actions: 0 });
    guard(() => host.start());
    for (const id of botIds) guard(() => host.sync(id));
    toDashboards({ type: 'match', matchNumber, seed: host.seed });
    console.log(`Match ${matchNumber} started (seed ${host.seed}, ${players.length} players).`);
    // Ticking starts when the first player connects, so turn timers do not run against an empty room.
    if ([...conns.values()].some((c) => c.res)) startTicker();
  }

  async function serveFile(res, file, extraHeaders = {}) {
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
        ...extraHeaders,
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  }

  function safeJoin(root, relative) {
    const full = path.normalize(path.join(root, relative));
    return full.startsWith(root + path.sep) || full === root ? full : null;
  }

  function readJson(req) {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; if (body.length > 65536) req.destroy(); });
      req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve(null); } });
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const route = url.pathname;
    const playerId = url.searchParams.get('player');
    const json = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(value));
    };

    if (route === '/') return serveFile(res, path.join(communityRoot, 'devkit', 'ui', 'index.html'));
    if (route === '/player.html') return serveFile(res, path.join(communityRoot, 'devkit', 'ui', 'player.html'));

    if (route.startsWith('/shell/')) {
      const file = safeJoin(path.join(communityRoot, 'shell'), route.slice('/shell/'.length));
      return file ? serveFile(res, file) : res.writeHead(403).end();
    }

    // The mode client, rebuilt on every request so a browser reload picks up edits.
    if (route === '/api/client') {
      try {
        const html = await bundleClient(mode);
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(html);
      } catch (error) {
        console.error(`[client build] ${error.message}`);
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end(error.message);
      }
    }

    if (route === '/api/info') {
      return json(200, { manifest, players, seed: host.seed, matchNumber });
    }

    if (route === '/api/state') {
      let state = null;
      try { state = JSON.parse(host.exportState()); } catch { /* sandbox is gone after an abort */ }
      const times = host.sandbox.callTimes.slice(-500).sort((a, b) => a - b);
      return json(200, {
        matchNumber,
        seed: host.seed,
        timeMs: host.timeMs,
        result: host.result,
        aborted: host.aborted,
        state: state?.state ?? null,
        stateBytes: state ? JSON.stringify(state.state).length : 0,
        stats: host.stats,
        callMs: times.length ? { p50: times[Math.floor(times.length * 0.5)], p99: times[Math.floor(times.length * 0.99)] } : null,
        net: players.map((p) => ({ connected: !!conns.get(p.id).res, latencyMs: conns.get(p.id).latencyMs, dropRate: conns.get(p.id).dropRate })),
      });
    }

    if (route === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'match', matchNumber, seed: host.seed })}\n\n`);
      dashboards.add(res);
      req.on('close', () => dashboards.delete(res));
      return;
    }

    if (route === '/api/stream') {
      const conn = conns.get(playerId);
      if (!conn) return json(404, { error: 'unknown player' });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(':ok\n\n');
      conn.res?.end();
      conn.res = res;
      if (conn.everConnected) guard(() => host.setStatus(playerId, 'reconnected'));
      conn.everConnected = true;
      startTicker();
      const forMatch = matchNumber;
      req.on('close', () => {
        if (conn.res !== res) return;
        conn.res = null;
        if (forMatch === matchNumber) guard(() => host.setStatus(playerId, 'disconnected'));
      });
      return;
    }

    if (route === '/api/send' && req.method === 'POST') {
      const conn = conns.get(playerId);
      const message = await readJson(req);
      if (!conn || !message) return json(400, { error: 'bad request' });
      const handle = () => guard(() => {
        if (message.kind === 'sync') host.sync(playerId);
        else if (message.kind === 'action') {
          // A tick that is due runs first; the action keeps its exact time.
          if (running) startedAt += host.advanceTo(hostNow());
          host.action(playerId, message.actionId, message.action, running ? hostNow() : host.timeMs);
        }
      });
      if (conn.latencyMs > 0) setTimeout(handle, conn.latencyMs);
      else handle();
      return json(200, { ok: true });
    }

    if (route === '/api/net' && req.method === 'POST') {
      const body = await readJson(req);
      const conn = players[body?.player] && conns.get(players[body.player].id);
      if (!conn) return json(400, { error: 'bad request' });
      if (Number.isFinite(body.latencyMs)) conn.latencyMs = Math.max(0, Math.min(2000, body.latencyMs));
      if (Number.isFinite(body.dropRate)) conn.dropRate = Math.max(0, Math.min(0.9, body.dropRate));
      return json(200, { ok: true });
    }

    if (route === '/api/forfeit' && req.method === 'POST') {
      const body = await readJson(req);
      if (!players[body?.player]) return json(400, { error: 'bad request' });
      guard(() => host.setStatus(players[body.player].id, 'forfeited'));
      return json(200, { ok: true });
    }

    if (route === '/api/restart' && req.method === 'POST') {
      const body = await readJson(req);
      for (const conn of conns.values()) conn.everConnected = false;
      await newMatch(Number.isInteger(body?.seed) ? body.seed : undefined);
      return json(200, { ok: true, seed: host.seed });
    }

    res.writeHead(404).end('Not found');
  });

  await newMatch(seed);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, listenHost, resolve);
  });
  console.log(`\n${manifest.name} ${manifest.version} is running.\nDashboard: http://localhost:${port}/\n`);
  const humans = players.filter((p) => !botIds.has(p.id));
  if (botCount > 0) console.log(`${botCount} bot${botCount > 1 ? 's' : ''} playing. One player's view:`);
  else console.log("One player's view (for a phone or a webview):");
  for (const p of humans) console.log(`  http://${listenHost === '0.0.0.0' ? '<this-computer-ip>' : 'localhost'}:${port}/player.html?player=${p.id}`);
  if (listenHost === '127.0.0.1') console.log('Add --host 0.0.0.0 to open it from another device on your network.');
  console.log('');
  return { server, port, close: () => { stopTicker(); server.close(); } };
}
