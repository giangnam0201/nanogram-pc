/* Dev-only: run the `api/*.ts` Vercel Edge functions inside the Vite dev server.
 *
 * In production Vercel routes /api/<name> to api/<name>.ts and calls its default
 * export with a Web `Request`. `vite dev` knows nothing about that, so without
 * this plugin every CDN-proxied image, thumbnail and game iframe 404s locally.
 *
 * This adapts Node's req/res to the Web Request/Response the handlers expect.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import type { Connect, Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

type EdgeHandler = (req: Request) => Response | Promise<Response>;

/** Buffer a Node request body, or undefined for bodiless methods. */
function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return Promise.resolve(undefined);
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => ok(chunks.length ? Buffer.concat(chunks) : undefined));
    req.on('error', fail);
  });
}

function toWebRequest(req: IncomingMessage, origin: string): Promise<Request> | Request {
  const url = origin + (req.url ?? '/');
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one);
  }
  const body = readBody(req);
  return Promise.resolve(body).then(
    (b) =>
      new Request(url, {
        method: req.method ?? 'GET',
        headers,
        body: b as unknown as BodyInit | undefined,
        // Node bodies are streams; Request needs this for non-GET with a body.
        ...(b ? { duplex: 'half' } : {}),
      } as RequestInit),
  );
}

/** The handlers set `Secure` cookies. Over plain http (phone on the LAN hitting
 *  http://192.168.x.x) the browser silently drops those, so dev serves them
 *  without the flag. localhost would be fine either way; a LAN IP is not. */
function relaxCookie(value: string, secure: boolean): string {
  return secure ? value : value.replace(/;\s*Secure/gi, '');
}

async function sendWebResponse(
  webRes: Response,
  res: ServerResponse,
  secure: boolean,
): Promise<void> {
  const setCookies =
    typeof (webRes.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (webRes.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [];

  webRes.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return;
    res.setHeader(key, value);
  });
  if (setCookies.length) {
    res.setHeader('Set-Cookie', setCookies.map((c) => relaxCookie(c, secure)));
  }

  res.statusCode = webRes.status;
  if (!webRes.body) return void res.end();

  const reader = webRes.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

export function devApi(): Plugin {
  return {
    name: 'nanogram-dev-api',
    apply: 'serve',

    /* Vercel hands its functions the project's environment variables. Vite only
       exposes VITE_-prefixed ones, and only to client code via import.meta.env,
       so without this the handlers would silently ignore .env.local — an
       unset UPSTASH_/ROOM_DELEGATION_KEY looks identical to a missing feature. */
    config(_config, { mode }) {
      const env = loadEnv(mode, process.cwd(), '');
      for (const [key, value] of Object.entries(env)) {
        // A real shell variable always wins over the file.
        if (process.env[key] === undefined) process.env[key] = value;
      }
    },

    configureServer(server: ViteDevServer) {
      const middleware: Connect.NextHandleFunction = (req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        if (!path.startsWith('/api/')) return next();

        const name = path.slice('/api/'.length).replace(/\/+$/, '');
        // No nested routes today; keep it to a flat, safe filename.
        if (!/^[a-z0-9-]+$/i.test(name)) return next();

        const file = resolve(process.cwd(), 'api', name + '.ts');
        if (!existsSync(file)) return next();

        void (async () => {
          try {
            const mod = (await server.ssrLoadModule(file)) as { default?: EdgeHandler };
            if (typeof mod.default !== 'function') return next();

            // Vite's dev server is http; a Request still needs an absolute URL.
            const host = req.headers.host ?? 'localhost';
            const secure = (req.socket as { encrypted?: boolean }).encrypted === true;
            const origin = (secure ? 'https://' : 'http://') + host;

            const webRes = await mod.default(await toWebRequest(req, origin));
            await sendWebResponse(webRes, res, secure);
          } catch (err) {
            server.config.logger.error(`[dev-api] ${name} failed: ${String(err)}`);
            if (!res.headersSent) res.statusCode = 500;
            res.end(JSON.stringify({ error: 'dev api handler threw' }));
          }
        })();
      };

      // Ahead of Vite's own middleware so /api/* never falls through to the SPA.
      server.middlewares.use(middleware);
    },
  };
}
