// In-machine HTTP server. Deliberately plain Node ESM, zero npm deps — this
// runs inside the Fly Machine image (Dockerfile, same dir), so keeping it
// dependency-free means the image only needs `npm i -g @anthropic-ai/claude-code`
// plus openvscode-server, no `npm install` step of its own.
//
// This is the ONLY public service on the sandbox app (see fly-provider.ts's
// single-service machine config): everything under /__forkai/* is this
// process's own control-plane API (bearer-authed on /__forkai/run); every
// other request — and every WebSocket upgrade — is reverse-proxied to
// openvscode-server on 127.0.0.1:3000, which is why openvscode is bound to
// loopback only (see ensureVscode) instead of 0.0.0.0. This collapses what
// used to be two public Fly services (which required a dedicated IPv4) into
// one, so the app only needs a shared IPv4 — see README.md.
//
// git-diff logic below is a minimal reimplementation of
// apps/code-api/src/agent/local/git-diff.ts's parseNumstat/parseNameStatus/
// assembleDiffSummary — that file can't be imported directly since it runs in
// a completely different process (this one, inside the sandbox container).

import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';

const RUN_TOKEN = process.env.RUN_TOKEN;
const VSCODE_TOKEN = process.env.VSCODE_TOKEN;
const WORKDIR = '/workspace/repo';
const CLAUDE_TIMEOUT_MS = 10 * 60 * 1000;
const PUSH_TIMEOUT_MS = 30 * 1000;
const VSCODE_PORT = 3000;

let vscodeStarted = false;

// repoUrl may embed a token (https://<token>@github.com/...) — never let it
// reach a log line, including inside error messages bubbled up from git.
function redact(text) {
  return text.replace(/https:\/\/[^@/\s]+@/g, 'https://***@');
}

// Env for anything the sandbox user can reach (openvscode-server and every
// terminal it spawns): no platform ANTHROPIC_API_KEY, no RUN_TOKEN. The key
// arrives per-run in the POST /run body (TLS + bearer-authed), lives only in
// this process, and is handed ONLY to the spawned claude process — a user
// poking around their own sandbox mid-run must never be able to read the
// shared platform key out of a child env.
function sanitizedEnv() {
  const { ANTHROPIC_API_KEY: _key, RUN_TOKEN: _runToken, ...rest } = process.env;
  return rest;
}

function sseSend(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

// `timeoutMs` (optional, not a real spawn option — stripped before passing
// through) kills the child and rejects rather than hanging forever; used by
// the push step so a stalled network call can't hang the whole run.
function run(cmd, args, opts = {}) {
  const { timeoutMs, ...spawnOpts } = opts;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, spawnOpts);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, timeoutMs)
      : null;
    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) return reject(new Error(redact(`${cmd} ${args.join(' ')} timed out after ${timeoutMs}ms`)));
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(redact(`${cmd} ${args.join(' ')} exited ${code}: ${stderr || stdout}`)));
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const sock = net.createConnection({ port, host: '127.0.0.1' }, () => {
        sock.end();
        resolve(true);
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() > deadline) return resolve(false);
        setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

// Started lazily on the first /run call (not at boot) so a machine that only
// ever gets healthz-polled never pays the openvscode startup cost. Bound to
// 127.0.0.1: it is no longer a direct public Fly service, only reachable
// through this process's own reverse proxy (see the header comment).
async function ensureVscode(res) {
  if (vscodeStarted) return;
  vscodeStarted = true;
  spawn(
    '/opt/openvscode/bin/openvscode-server',
    ['--host', '127.0.0.1', '--port', String(VSCODE_PORT), '--connection-token', VSCODE_TOKEN, '--default-folder', WORKDIR],
    { stdio: 'ignore', detached: true, env: sanitizedEnv() },
  ).unref();
  const up = await waitForPort(VSCODE_PORT, 30_000);
  sseSend(res, up ? { type: 'vscode-ready' } : { type: 'warn', message: 'openvscode-server did not come up within 30s' });
}

// --- minimal port of git-diff.ts's numstat/name-status/assemble logic ---

const STATUS_WORDS = { A: 'added', M: 'modified', D: 'deleted' };

function resolveRenamePath(raw) {
  const brace = raw.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (brace) return `${brace[1]}${brace[3]}${brace[4]}`;
  const arrow = raw.indexOf(' => ');
  return arrow === -1 ? raw : raw.slice(arrow + 4).trim();
}

function parseNumstat(output) {
  return output
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const [addRaw, delRaw, ...pathParts] = line.split('\t');
      return {
        path: resolveRenamePath(pathParts.join('\t')),
        additions: addRaw === '-' ? 0 : parseInt(addRaw, 10),
        deletions: delRaw === '-' ? 0 : parseInt(delRaw, 10),
      };
    });
}

function parseNameStatus(output) {
  return output
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const parts = line.split('\t');
      const code = parts[0][0];
      if (code === 'R' || code === 'C') return { path: parts[2], status: code === 'R' ? 'renamed' : 'copied' };
      return { path: parts[1], status: STATUS_WORDS[code] ?? 'modified' };
    });
}

function assembleDiffSummary(numstat, nameStatus) {
  const statusByPath = new Map(nameStatus.map((f) => [f.path, f.status]));
  const files = numstat.map((f) => ({
    path: f.path,
    status: statusByPath.get(f.path) ?? 'modified',
    additions: f.additions,
    deletions: f.deletions,
  }));
  return {
    filesChanged: files.length,
    additions: files.reduce((s, f) => s + f.additions, 0),
    deletions: files.reduce((s, f) => s + f.deletions, 0),
    files,
  };
}

async function diffSummaryBetween(baseSha, headSha) {
  const [{ stdout: numstatOut }, { stdout: nameStatusOut }] = await Promise.all([
    run('git', ['diff', '--numstat', baseSha, headSha], { cwd: WORKDIR }),
    run('git', ['diff', '--name-status', baseSha, headSha], { cwd: WORKDIR }),
  ]);
  return assembleDiffSummary(parseNumstat(numstatOut), parseNameStatus(nameStatusOut));
}

// v1.1 push-back (ADR-0002 amendment): reuse the "origin" remote git itself
// configured at clone time (the embedded x-access-token@ credential for
// private repos) — never build a new URL, never touch a new secret. A
// 'new'-project run (git init, no clone) never gets an origin remote, so this
// is a no-op for that case rather than an error. Never force-pushes: a
// non-fast-forward rejection is treated like any other push failure (warn +
// continue), not force-resolved.
async function pushToOrigin(res, branch) {
  const hasOrigin = await run('git', ['remote', 'get-url', 'origin'], { cwd: WORKDIR })
    .then(() => true)
    .catch(() => false);
  if (!hasOrigin) return { pushed: false };
  try {
    await run('git', ['push', 'origin', branch], { cwd: WORKDIR, timeoutMs: PUSH_TIMEOUT_MS });
    return { pushed: true };
  } catch (err) {
    // err.message is already redact()-ed by run() above.
    sseSend(res, { type: 'warn', message: `push to origin failed: ${err.message}` });
    return { pushed: false, pushError: err.message };
  }
}

// --- /run handler ---

async function checkoutBranch(res, branch) {
  const { stdout: currentOut } = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: WORKDIR });
  if (currentOut.trim() === branch) return;
  const exists = await run('git', ['rev-parse', '--verify', branch], { cwd: WORKDIR })
    .then(() => true)
    .catch(() => false);
  if (exists) {
    sseSend(res, { type: 'warn', message: `branch ${branch} already exists, checking it out (not creating)` });
    await run('git', ['checkout', branch], { cwd: WORKDIR });
  } else {
    await run('git', ['checkout', '-b', branch], { cwd: WORKDIR });
  }
}

async function handleRun(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sseSend(res, { type: 'error', message: 'invalid JSON body' });
    return res.end();
  }
  const { repoUrl, init, branch, baseRef, instruction, anthropicApiKey } = body;
  if ((!repoUrl && !init) || !branch || !instruction) {
    sseSend(res, { type: 'error', message: '(repoUrl or init), branch, and instruction are required' });
    return res.end();
  }
  // Body key preferred (see sanitizedEnv above); the machine-env fallback keeps
  // the original spike client (run-spike.ts, which still sets the key as
  // machine env) working. Product clients must send it in the body.
  const claudeKey = anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  if (!claudeKey) {
    sseSend(res, { type: 'error', message: 'no anthropicApiKey in body and no ANTHROPIC_API_KEY in env' });
    return res.end();
  }

  if (repoUrl) {
    try {
      await run('git', ['clone', repoUrl, WORKDIR]);
    } catch (err) {
      sseSend(res, { type: 'error', message: `clone failed: ${err.message}` });
      return res.end();
    }
  } else {
    // 'new'-project mode: no real repo exists anywhere yet (see
    // nodes.service.ts's resolveRunRepo) — git-init one and make an empty
    // initial commit, so there's a real baseSha to diff the agent's work
    // against, same as a freshly-cloned repo would have.
    try {
      await run('mkdir', ['-p', WORKDIR]);
      await run('git', ['init', '-b', init.defaultBranch], { cwd: WORKDIR });
      await run(
        'git',
        ['-c', 'user.name=forkai agent', '-c', 'user.email=agent@forkai.dev', 'commit', '--allow-empty', '-m', 'Initial commit'],
        { cwd: WORKDIR },
      );
    } catch (err) {
      sseSend(res, { type: 'error', message: `repo init failed: ${err.message}` });
      return res.end();
    }
  }

  // Fire-and-forget — emits its own vscode-ready/warn event whenever it settles.
  ensureVscode(res);

  if (baseRef) {
    try {
      await run('git', ['checkout', baseRef], { cwd: WORKDIR });
    } catch (err) {
      sseSend(res, { type: 'warn', message: `baseRef checkout failed (${err.message}), staying on repo HEAD` });
    }
  } else {
    sseSend(res, { type: 'warn', message: 'no baseRef given, using repo HEAD' });
  }

  try {
    await checkoutBranch(res, branch);
  } catch (err) {
    sseSend(res, { type: 'error', message: `branch checkout failed: ${err.message}` });
    return res.end();
  }

  const { stdout: baseShaOut } = await run('git', ['rev-parse', 'HEAD'], { cwd: WORKDIR });
  const baseSha = baseShaOut.trim();

  const child = spawn(
    'claude',
    ['-p', instruction, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--max-turns', '40'],
    { cwd: WORKDIR, env: { ...sanitizedEnv(), ANTHROPIC_API_KEY: claudeKey } },
  );

  let resultText = '';
  const killTimer = setTimeout(() => child.kill('SIGKILL'), CLAUDE_TIMEOUT_MS);

  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'result' && typeof parsed.result === 'string') resultText = parsed.result;
        sseSend(res, { type: 'claude', line: parsed });
      } catch {
        sseSend(res, { type: 'claude-raw', text: line });
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    sseSend(res, { type: 'stderr', text: chunk.toString('utf8') });
  });

  child.on('close', async (exitCode) => {
    clearTimeout(killTimer);
    try {
      await run('git', ['add', '-A'], { cwd: WORKDIR });
      const { stdout: status } = await run('git', ['status', '--porcelain'], { cwd: WORKDIR });
      let sha = baseSha;
      if (status.trim()) {
        const message = (resultText.split('\n')[0] || instruction.split('\n')[0]).slice(0, 72);
        await run(
          'git',
          ['-c', 'user.name=forkai agent', '-c', 'user.email=agent@forkai.dev', 'commit', '-m', message],
          { cwd: WORKDIR },
        );
        const { stdout: shaOut } = await run('git', ['rev-parse', 'HEAD'], { cwd: WORKDIR });
        sha = shaOut.trim();
      }
      const diffSummary =
        sha === baseSha ? { filesChanged: 0, additions: 0, deletions: 0, files: [] } : await diffSummaryBetween(baseSha, sha);

      // Only attempt a push when the agent actually produced a new commit —
      // never block/fail the run on the push itself (see pushToOrigin).
      let pushed = false;
      let pushError;
      if (sha !== baseSha) {
        ({ pushed, pushError } = await pushToOrigin(res, branch));
      }

      sseSend(res, { type: 'result', sha, baseSha, diffSummary, exitCode: exitCode ?? -1, pushed, ...(pushError ? { pushError } : {}) });
    } catch (err) {
      sseSend(res, { type: 'error', message: err.message });
    }
    res.end();
  });
}

// --- reverse proxy to openvscode (plain http.request, no deps) ---

// End-to-end headers (Host, Cookie, Authorization, ...) pass through
// unmodified — only the hop-by-hop set (RFC 7230 §6.1) is stripped, since
// forwarding those verbatim would fight Node's own connection handling on
// the proxy leg.
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

function stripHopByHop(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) out[key] = value;
  }
  return out;
}

// openvscode gates itself via its own ?tkn=/cookie auth, which the browser
// CAN attach on a plain navigation — unlike RUN_TOKEN (a bearer header the
// browser has no way to send), so this proxy leg deliberately does not
// re-check RUN_TOKEN. It's reachable only because openvscode is bound to
// 127.0.0.1, not because this path is otherwise protected.
function proxyToVscode(req, res) {
  const proxyReq = http.request(
    { host: '127.0.0.1', port: VSCODE_PORT, method: req.method, path: req.url, headers: stripHopByHop(req.headers) },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, stripHopByHop(proxyRes.headers));
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', (err) => {
    // Reachable if openvscode hasn't started yet (ensureVscode only fires on
    // the first /__forkai/run) or has crashed — surface as a clean 502
    // instead of letting the client hang.
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `vscode proxy error: ${err.message}` }));
  });
  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  if (req.url === '/__forkai/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.url?.startsWith('/__forkai/')) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${RUN_TOKEN}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'unauthorized' }));
    }
    if (req.method === 'POST' && req.url === '/__forkai/run') {
      handleRun(req, res).catch((err) => {
        // Only reachable if something threw before writeHead — the /run body
        // itself catches its own errors and always ends the SSE stream cleanly.
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'not found' }));
  }

  proxyToVscode(req, res);
});

// vscode's own terminals/live-edit protocol runs over WebSocket — without
// forwarding the upgrade, the proxy would leave openvscode functionally
// read-only (no terminal, no live typing). Spliced as raw sockets rather than
// through http.request, which has no upgrade support.
server.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/__forkai/')) {
    socket.destroy();
    return;
  }
  const proxySocket = net.connect(VSCODE_PORT, '127.0.0.1', () => {
    const requestLines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [key, value] of Object.entries(req.headers)) {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) if (v !== undefined) requestLines.push(`${key}: ${v}`);
    }
    proxySocket.write(requestLines.join('\r\n') + '\r\n\r\n');
    if (head?.length) proxySocket.write(head);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });
  proxySocket.on('error', () => socket.destroy());
  socket.on('error', () => proxySocket.destroy());
});

server.listen(8080, () => {
  console.log('runner listening on :8080');
});
