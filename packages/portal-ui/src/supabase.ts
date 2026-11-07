import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const supabasePublicKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
let portalAccessToken: string | null = null;

export function setSupabasePortalAccessToken(token: string | null): void {
  portalAccessToken = token;
}

const portalFetch: typeof fetch = (input, init) => {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));

  if (
    portalAccessToken &&
    url &&
    new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      .origin === new URL(url).origin
  ) {
    headers.set('Authorization', `Bearer ${portalAccessToken}`);
  }

  return fetch(input, { ...init, headers });
};

export const supabase = url && supabasePublicKey
  ? createClient(url, supabasePublicKey, { global: { fetch: portalFetch } })
  : null;
export const supabaseReady = Boolean(supabase);
