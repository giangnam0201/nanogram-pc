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

    /* The schema has gained columns and a table since first release, and a
       project running an older copy fails in ways that look like unrelated
       bugs — builds landing nowhere, questions never appearing, tokens never
       stored. Ask Postgres directly instead of making anyone guess whether
       they re-ran the file. */
    if (hasSupabase && checks.database?.ok) {
      const missing: string[] = [];
      const probes: [string, string][] = [
        ['rooms.session_owner_id', 'rooms?select=session_owner_id&limit=1'],
        ['room_events.options', 'room_events?select=options&limit=1'],
        ['user_tokens', 'user_tokens?select=user_id&limit=1'],
      ];
      for (const [name, query] of probes) {
        const [table, qs] = query.split('?');
        try {
          await sb<unknown[]>(table, { query: qs });
        } catch {
          missing.push(name);
        }
      }
      checks.schemaCurrent = {
        ok: missing.length === 0,
        detail:
          missing.length === 0
            ? 'schema is up to date'
            : `re-run supabase/schema.sql — missing: ${missing.join(', ')}`,
      };
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

    checks.tokenStorage = {
      ok: canDelegate,
      detail: canDelegate
        ? 'ROOM_DELEGATION_KEY present — sign-ins can be stored, so rooms build on their owner'
        : 'ROOM_DELEGATION_KEY missing — sign-ins cannot be encrypted, so nothing is stored and every member builds in their own session on their own credits',
    };

    /* Realtime and token storage both degrade rather than break: without them
       rooms still work, just by polling and on per-member credits. A stale or
       unreachable schema is the only thing that genuinely stops the feature. */
    const required = ['supabaseConfigured', 'database', 'schemaCurrent'];
    const healthy = required.every((k) => checks[k]?.ok !== false);

    return json({ healthy, checks });
  } catch (e) {
    return fail(e);
  }
}
