/* Configuration check for Multi-Creator.
 *
 *   GET /api/room-health
 *
 * Says which pieces are configured and whether they actually work, so a broken
 * deployment can be diagnosed without reading logs or guessing. Requires a
 * valid Nanogram sign-in: the answers describe the deployment's internals, and
 * that is not something to hand out anonymously.
 *
 * Never returns a secret, or any part of one — only whether each is present and
 * what happened when it was used.
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
    await identify(req);

    const checks: Record<string, Check> = {};

    checks.nanogramAuth = { ok: true, detail: 'your token verified against v2/me' };

    checks.supabaseConfigured = {
      ok: hasSupabase,
      detail: hasSupabase
        ? `${supabaseUrl()} · ${describeKey(process.env.SUPABASE_SERVICE_ROLE_KEY)}`
        : 'SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY missing — rooms are using the in-memory fallback, which cannot work on a real deployment',
    };

    // Does the key actually reach the schema? Catches a wrong key, a project
    // that never had schema.sql run, and network problems, distinctly.
    if (hasSupabase) {
      try {
        await sb<unknown[]>('rooms', { query: 'select=id&limit=1' });
        checks.database = { ok: true, detail: 'rooms table reachable' };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        checks.database = {
          ok: false,
          detail: /does not exist|relation/i.test(message)
            ? `schema not installed — run supabase/schema.sql (${message})`
            : message,
        };
      }
    }

    checks.realtime = {
      ok: hasRealtime,
      detail: hasRealtime
        ? 'SUPABASE_JWT_SECRET present'
        : 'SUPABASE_JWT_SECRET missing — clients fall back to the SSE endpoint, which still works but polls',
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
          detail: e instanceof Error ? e.message : String(e),
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
