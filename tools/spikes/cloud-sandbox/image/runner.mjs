// In-machine HTTP server. Deliberately plain Node ESM, zero npm deps — this
// runs inside the Fly Machine image (image/Dockerfile), so keeping it
// dependency-free means the image only needs `npm i -g @anthropic-ai/claude-code`
// plus openvscode-server, no `npm install` step of its own.
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

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, opts);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
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
// ever gets healthz-polled never pays the openvscode startup cost.
async function ensureVscode(res) {
  if (vscodeStarted) return;
  vscodeStarted = true;
  spawn(
    '/opt/openvscode/bin/openvscode-server',
    ['--host', '0.0.0.0', '--port', '3000', '--connection-token', VSCODE_TOKEN, '--default-folder', WORKDIR],
    { stdio: 'ignore', detached: true, env: sanitizedEnv() },
  ).unref();
  const up = await waitForPort(3000, 30_000);
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
  const { repoUrl, branch, baseRef, instruction, anthropicApiKey } = body;
  if (!repoUrl || !branch || !instruction) {
    sseSend(res, { type: 'error', message: 'repoUrl, branch, and instruction are required' });
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

  try {
    await run('git', ['clone', repoUrl, WORKDIR]);
  } catch (err) {
    sseSend(res, { type: 'error', message: `clone failed: ${err.message}` });
    return res.end();
  }

  // Fire-and-forget — emits its own vscode-ready/warn event whenever it settles.
  ensureVscode(res);

  if (baseRef) {
    try {
      await run('git', ['checkout', baseRef], { cwd: WORKDIR });
    } catch (err) {
      sseSend(res, { type: 'warn', message: `baseRef checkout failed (${err.message}), staying on clone HEAD` });
    }
  } else {
    sseSend(res, { type: 'warn', message: 'no baseRef given, using clone HEAD' });
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
      sseSend(res, { type: 'result', sha, baseSha, diffSummary, exitCode: exitCode ?? -1 });
    } catch (err) {
      sseSend(res, { type: 'error', message: err.message });
    }
    res.end();
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${RUN_TOKEN}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unauthorized' }));
  }

  if (req.method === 'POST' && req.url === '/run') {
    handleRun(req, res).catch((err) => {
      // Only reachable if something threw before writeHead — the /run body
      // itself catches its own errors and always ends the SSE stream cleanly.
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(8080, () => {
  console.log('runner listening on :8080');
});
