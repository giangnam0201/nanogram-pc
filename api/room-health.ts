/* Configuration check for Multi-Creator.
 *
 *   GET /api/room-health
 *
 * Says which pieces are configured and whether they actually work, so a broken
 * deployment can be diagnosed without reading logs or guessing.
 *
 * Openable in a browser address bar, because that is how anyone actually
 * reaches for it. Signed out it answers pass/fail only; signed in it adds the
 * detail — project URL, which kind of key is installed, the exact database
 * error — since that describes the deployment's internals.
 *
 * Never returns a secret, or any part of one.
 */

import { fail, identify, json } from './_lib/auth';
import { canDelegate } from './_lib/crypto';
import { hasRealtime, hasSupabase, mintRealtimeToken, sb, supabaseUrl } from './_lib/db';

export const config = { runtime: 'edge' };

interface Check {
  ok: boolean;
  detail: string;
}

/** Shape of a key, without revealing it. Enough to spot the classic mistakes. */
function describeKey(key: string | undefined): string {
  if (!key) return 'not set';
  if (key.startsWith('sb_secret_')) return 'new-style secret key (sb_secret_…)';
  if (key.startsWith('sb_publishable_')) {
    return 'PUBLISHABLE key — wrong one, this cannot bypass row level security';
  }
  if (key.startsWith('eyJ')) {
    // Legacy keys are JWTs whose payload names the role in the clear.
    try {
      const payload = JSON.parse(
        atob((key.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')),
      ) as { role?: string };
      if (payload.role === 'anon') {
        return 'legacy ANON key — wrong one, this cannot bypass row level security';
      }
      return `legacy ${payload.role ?? 'unknown'} key`;
    } catch {
      return 'legacy JWT key (unreadable payload)';
    }
  }
  return 'set, unrecognised format';
}

export default async function handler(req: Request): Promise<Response> {
  try {
    // Signed in is better, but not required — a config check nobody can open is
    // not much of a config check.
    let signedIn = false;
    try {
      await identify(req);
      signedIn = true;
    } catch {
      /* anonymous: pass/fail only */
    }

    const checks: Record<string, Check> = {};

    checks.nanogramAuth = {
      ok: signedIn,
      detail: signedIn
        ? 'your token verified against v2/me'
        : 'not signed in — open this from the app, or sign in, for full detail',
    };

    checks.supabaseConfigured = {
      ok: hasSupabase,
      detail: !hasSupabase
        ? 'SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY missing — rooms are using the in-memory fallback, which cannot work on a real deployment'
        : signedIn
          ? `${supabaseUrl()} · ${describeKey(process.env.SUPABASE_SERVICE_ROLE_KEY)}`
          : 'configured',
    };

    // Does the key actually reach the schema? Catches a wrong key, a project
    // that never had schema.sql run, and network problems, distinctly.
    if (hasSupabase) {
      try {
        await sb<unknown[]>('rooms', { query: 'select=id&limit=1' });
        checks.database = { ok: true, detail: 'rooms table reachable' };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const missingSchema = /does not exist|relation/i.test(message);
        checks.database = {
          ok: false,
          detail: !signedIn
            ? missingSchema
              ? 'schema not installed — run supabase/schema.sql'
              : 'could not reach the rooms table'
            : missingSchema
              ? `schema not installed — run supabase/schema.sql (${message})`
              : message,
        };
      }
    }

    const missingRealtime: string[] = [];
    if (!process.env.SUPABASE_JWT_SECRET) missingRealtime.push('SUPABASE_JWT_SECRET');
    if (!process.env.SUPABASE_ANON_KEY && !process.env.SUPABASE_PUBLISHABLE_KEY) {
      missingRealtime.push('SUPABASE_ANON_KEY');
    }
    checks.realtime = {
      ok: hasRealtime,
      detail: hasRealtime
        ? 'JWT secret and project API key both present'
        : `${missingRealtime.join(' and ')} missing — clients fall back to the SSE endpoint, which still works but polls`,
    };

    if (hasRealtime) {
      try {
        const { token } = await mintRealtimeToken('health-check', 60);
        checks.realtimeToken = {
          ok: token.split('.').length === 3,
          detail: 'signed a test subscription token',
        };
      } catch (e) {
        checks.realtimeToken = {
          ok: false,
          detail: signedIn ? (e instanceof Error ? e.message : String(e)) : 'could not sign a token',
        };
      }
    }

    checks.offlineBuilding = {
      ok: canDelegate,
      detail: canDelegate
        ? 'ROOM_DELEGATION_KEY present'
        : 'ROOM_DELEGATION_KEY missing — arming offline building is refused (optional feature)',
    };

    // Realtime and offline building are optional; only the first three block use.
    const required = ['supabaseConfigured', 'database'];
    const healthy = required.every((k) => checks[k]?.ok !== false);

    return json({ healthy, checks });
  } catch (e) {
    return fail(e);
  }
}
