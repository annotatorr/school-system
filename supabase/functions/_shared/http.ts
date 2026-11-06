export const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-callback-token, idempotency-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
export function options(req: Request) { return req.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders }) : null; }
export function required(name: string): string { const value = Deno.env.get(name); if (!value) throw new Error(`Missing server secret: ${name}`); return value; }
export function normalizeKenyanPhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  throw new Error('Enter a valid Kenyan mobile number, for example 0712345678.');
}
