import type { Page, Route, Request } from '@playwright/test';

/**
 * Network-layer mock of the NestJS API.
 *
 * Matching is host-agnostic (any origin whose first path segment is a known
 * API resource), so it works regardless of what NEXT_PUBLIC_API_BASE_URL the
 * web bundle was built with. CORS preflights are answered automatically and
 * every fulfilled response carries permissive CORS headers — fulfilled
 * cross-origin responses are still subject to the browser's CORS checks.
 */

const API_PATH_RE = new RegExp(
  '^https?://[^/]+/(sessions|share|users|notion|billing|admin|blog-submissions|blog-views|support|health|topics)([/?].*)?$',
);

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
};

export function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify(body),
  });
}

/** Encode StreamEvents the way the backend's SSE endpoints do. */
export function sseBody(events: object[]): string {
  return events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
}

export function fulfillSse(route: Route, events: object[]) {
  return route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...CORS_HEADERS },
    body: sseBody(events),
  });
}

/** A promise you can resolve from the test body — used to hold a mocked request in-flight. */
export function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

type HandlerFn = (route: Route, req: Request, params: Record<string, string>) => unknown | Promise<unknown>;
/** object → fulfilled as JSON 200; number → that status with a JSON error body; fn → return a value to fulfil as JSON, or fulfil the route yourself and return undefined. */
type Handler = HandlerFn | object | number;

interface Registration { method: string; segs: string[]; handler: Handler }

function matchPath(pat: string[], segs: string[]): Record<string, string> | null {
  if (pat.length !== segs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pat.length; i++) {
    if (pat[i].startsWith(':')) params[pat[i].slice(1)] = segs[i];
    else if (pat[i] !== segs[i]) return null;
  }
  return params;
}

export class MockApi {
  readonly calls: RecordedCall[] = [];
  private routes: Registration[] = [];

  /** Register a handler, e.g. `api.on('GET /sessions/:id', fullSession())`. Later registrations win. */
  on(spec: string, handler: Handler): this {
    const [method, path] = spec.split(' ');
    this.routes.push({ method, segs: path.split('/').filter(Boolean), handler });
    return this;
  }

  /** Calls whose method+path match the spec pattern (same `:param` syntax). */
  callsTo(spec: string): RecordedCall[] {
    const [method, path] = spec.split(' ');
    const pat = path.split('/').filter(Boolean);
    return this.calls.filter(c =>
      c.method === method && matchPath(pat, c.path.split('/').filter(Boolean)) !== null);
  }

  async install(page: Page) {
    await page.route(API_PATH_RE, async route => {
      const req = route.request();
      const method = req.method();
      const url = new URL(req.url());

      // Some API prefixes collide with the web app's OWN routes (e.g. /admin and
      // /blog-submissions are real Next.js pages). The API is always a different
      // origin (port 3000/LAN), so never intercept the app's own origin (:3001).
      if (url.port === '3001') return route.continue();

      if (method === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: CORS_HEADERS });
      }

      let body: unknown = null;
      const post = req.postData();
      if (post) { try { body = JSON.parse(post); } catch { body = post; } }

      const segs = url.pathname.split('/').filter(Boolean);
      for (let i = this.routes.length - 1; i >= 0; i--) {
        const r = this.routes[i];
        if (r.method !== method) continue;
        const params = matchPath(r.segs, segs);
        if (!params) continue;

        this.calls.push({ method, path: url.pathname, body, headers: req.headers() });
        if (typeof r.handler === 'number') return fulfillJson(route, { message: `e2e mock error ${r.handler}` }, r.handler);
        if (typeof r.handler === 'function') {
          const result = await r.handler(route, req, params);
          if (result !== undefined) return fulfillJson(route, result);
          return; // the handler fulfilled (or intentionally aborted) the route itself
        }
        return fulfillJson(route, r.handler);
      }

      // Unmatched API call — fail loudly so a missing mock is obvious in the trace.
      this.calls.push({ method, path: url.pathname, body, headers: req.headers() });
      return fulfillJson(route, { error: `e2e: unmocked ${method} ${url.pathname}` }, 599);
    });
  }
}
