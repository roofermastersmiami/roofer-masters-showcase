import { createClient } from '@supabase/supabase-js';
import type { ToolContext } from '@lovable.dev/mcp-js';
import { ToolError } from '@lovable.dev/mcp-js';
import type { Database } from '@/integrations/supabase/types';
import { requireReadAccess, type ReadCapability } from './access';

function runtimeEnv(name: string): string | undefined {
  const runtime = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } };
  return runtime.process?.env?.[name];
}
function projectUrl() {
  const url = runtimeEnv('SUPABASE_URL') ?? import.meta.env['VITE_SUPABASE_URL'];
  if (!url) throw new ToolError('The connection service is not configured.');
  return url;
}
function publishableKey() {
  const direct = runtimeEnv('SUPABASE_PUBLISHABLE_KEY') ?? import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'];
  if (direct) return direct;
  try {
    const parsed: unknown = JSON.parse(runtimeEnv('SUPABASE_PUBLISHABLE_KEYS') ?? '{}');
    if (parsed && typeof parsed === 'object') {
      const key = Object.values(parsed).find((value): value is string => typeof value === 'string' && value.startsWith('sb_publishable_'));
      if (key) return key;
    }
  } catch { /* Try the established legacy publishable key. */ }
  const legacy = runtimeEnv('SUPABASE_ANON_KEY') ?? import.meta.env['VITE_SUPABASE_ANON_KEY'];
  if (!legacy) throw new ToolError('The connection service is not configured.');
  return legacy;
}
export function supabaseForUser(ctx: ToolContext) {
  const token = ctx.getToken();
  if (!token || !ctx.isAuthenticated()) throw new ToolError('Sign in and approve this connection first.');
  return createClient<Database>(projectUrl(), publishableKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function authorizedClient(ctx: ToolContext, capability: ReadCapability) {
  const client = supabaseForUser(ctx);
  const userId = ctx.getUserId();
  if (!userId) throw new ToolError('Sign in and approve this connection first.');
  const { data, error } = await client.from('user_roles').select('role').eq('user_id', userId).abortSignal(ctx.signal);
  if (error) throw new ToolError('Could not verify your team permissions. Try again.');
  requireReadAccess((data ?? []).map(row => row.role), capability);
  return client;
}