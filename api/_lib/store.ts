/* Local-development fallback store.
 *
 * With Supabase configured, none of this runs — rooms live in Postgres (db.ts)
 * and rooms.ts routes there instead. This exists so the feature can be clicked
 * through locally with zero setup: one dev server, one process, one Map.
 *
 * It CANNOT work on Vercel. Each invocation is isolated, so rooms would vanish
 * between requests. `storeKind()` reports which backend is live and the Rooms
 * tab warns whenever it is this one.
 *
 * The command shape is a small subset of Redis. It is kept because the room
 * logic and its tests were written against it, and because it maps cleanly onto
 * "a key with a value that sometimes expires".
 */

type Entry = { value: unknown; expiresAt: number | null };
const mem = new Map<string, Entry>();

export function storeKind(): 'supabase' | 'memory' {
  return 'memory';
}

function live(key: string): Entry | undefined {
  const e = mem.get(key);
  if (!e) return undefined;
  if (e.expiresAt !== null && e.expiresAt < Date.now()) {
    mem.delete(key);
    return undefined;
  }
  return e;
}

/** The subset of Redis this feature uses, over a plain Map. */
export function cmd(...args: (string | number)[]): Promise<unknown> {
  const [op, key, ...rest] = args.map(String) as [string, string, ...string[]];
  const name = op.toUpperCase();

  switch (name) {
    case 'GET':
      return Promise.resolve((live(key)?.value as string) ?? null);
    case 'SET': {
      const exIdx = rest.findIndex((a) => a.toUpperCase() === 'EX');
      const ttl = exIdx >= 0 ? Number(rest[exIdx + 1]) : null;
      const nx = rest.some((a) => a.toUpperCase() === 'NX');
      if (nx && live(key)) return Promise.resolve(null);
      mem.set(key, { value: rest[0], expiresAt: ttl ? Date.now() + ttl * 1000 : null });
      return Promise.resolve('OK');
    }
    case 'DEL': {
      const existed = live(key) ? 1 : 0;
      mem.delete(key);
      return Promise.resolve(existed);
    }
    case 'EXPIRE': {
      const e = live(key);
      if (!e) return Promise.resolve(0);
      e.expiresAt = Date.now() + Number(rest[0]) * 1000;
      return Promise.resolve(1);
    }
    case 'INCR': {
      const e = live(key);
      const next = Number((e?.value as string) ?? '0') + 1;
      mem.set(key, { value: String(next), expiresAt: e?.expiresAt ?? null });
      return Promise.resolve(next);
    }
    case 'HSET': {
      const e = live(key);
      const map = (e?.value as Record<string, string>) ?? {};
      for (let i = 0; i < rest.length; i += 2) map[rest[i]] = rest[i + 1];
      mem.set(key, { value: map, expiresAt: e?.expiresAt ?? null });
      return Promise.resolve(1);
    }
    case 'HGETALL': {
      const map = (live(key)?.value as Record<string, string>) ?? {};
      return Promise.resolve(Object.entries(map).flat());
    }
    case 'HDEL': {
      const e = live(key);
      if (!e) return Promise.resolve(0);
      const map = e.value as Record<string, string>;
      let n = 0;
      for (const f of rest) if (f in map) (delete map[f], n++);
      return Promise.resolve(n);
    }
    case 'RPUSH': {
      const e = live(key);
      const list = (e?.value as string[]) ?? [];
      list.push(...rest);
      mem.set(key, { value: list, expiresAt: e?.expiresAt ?? null });
      return Promise.resolve(list.length);
    }
    case 'LRANGE': {
      const list = (live(key)?.value as string[]) ?? [];
      let [start, stop] = [Number(rest[0]), Number(rest[1])];
      if (start < 0) start = Math.max(0, list.length + start);
      if (stop < 0) stop = list.length + stop;
      return Promise.resolve(list.slice(start, stop + 1));
    }
    case 'LTRIM': {
      const e = live(key);
      if (!e) return Promise.resolve('OK');
      const list = e.value as string[];
      let [start, stop] = [Number(rest[0]), Number(rest[1])];
      if (start < 0) start = Math.max(0, list.length + start);
      if (stop < 0) stop = list.length + stop;
      e.value = list.slice(start, stop + 1);
      return Promise.resolve('OK');
    }
    default:
      throw new Error(`store: unsupported ${name}`);
  }
}

/* ------------------------------------------------------------ helpers --- */

export async function getJson<T>(key: string): Promise<T | null> {
  const raw = (await cmd('GET', key)) as string | null;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setJson(key: string, value: unknown, ttlSecs?: number): Promise<void> {
  const args: (string | number)[] = ['SET', key, JSON.stringify(value)];
  if (ttlSecs) args.push('EX', ttlSecs);
  await cmd(...args);
}

export async function hgetAll(key: string): Promise<Record<string, string>> {
  const flat = (await cmd('HGETALL', key)) as unknown;
  const out: Record<string, string> = {};
  if (Array.isArray(flat)) {
    for (let i = 0; i < flat.length; i += 2) out[String(flat[i])] = String(flat[i + 1]);
  }
  return out;
}
