const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});

function encode(bytes) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}
function decode(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
async function key(value) {
  if (!/^[a-f0-9]{64}$/.test(value ?? '')) throw Error('Recovery key missing');
  return crypto.subtle.importKey('raw', Uint8Array.from(value.match(/../g), s => parseInt(s, 16)),
    'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(value, secret, purpose) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({name: 'AES-GCM', iv: nonce, additionalData: encoder.encode(purpose)},
    await key(secret), encoder.encode(value));
  return encode(nonce) + '.' + encode(new Uint8Array(data));
}
export async function unseal(value, secret, purpose) {
  const [iv, encrypted] = value.split('.');
  const data = await crypto.subtle.decrypt({name: 'AES-GCM', iv: decode(iv), additionalData: encoder.encode(purpose)},
    await key(secret), decode(encrypted));
  return decoder.decode(data);
}

const staleAfter = 6 * 60 * 1000;
export const replyTtl = 24 * 60 * 60 * 1000;
export const idPattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
export const readReceipt = `
 SELECT c.id, c.month, c.created, c.state AS legacy, c.model, c.neurons,
 r.phase, r.started, r.ended, r.code, r.provider_code, r.sealed_reply, r.expires
 FROM ai_calls_v12 c LEFT JOIN request_recovery r ON r.id=c.id
`;
export function describe(row, now) {
  const stale = now - (row.started ?? row.created) >= staleAfter;
  const state = row.phase === 'processing' && stale ? 'unknown' : row.phase ??
    (row.legacy === 'finished' ? 'finished' : row.legacy === 'started' && !stale ? 'processing' : 'unknown');
  const code = row.code ?? (state === 'unknown' ?
    (row.phase === 'processing' || row.legacy === 'started' ? 'no_terminal_confirmation' : 'legacy_no_diagnostic') :
    state === 'finished' && (!row.sealed_reply || row.expires <= now) ?
      (row.expires ? 'response_expired' : 'legacy_response_not_retained') : null);
  return {
    id: row.id, month: row.month, route: 'local', reserved: 0, model: row.model,
    created: row.created, durationMs: row.ended != null ? row.ended - row.started : null,
    state, code, providerCode: row.provider_code ?? null, neurons: row.neurons,
    recoverable: state === 'finished' && !!row.sealed_reply && row.expires > now,
    expiresAt: row.expires ?? null,
  };
}

export function interpret(result) {
  const choice = result?.choices?.[0];
  const finish = choice?.finish_reason ?? result?.finish_reason;
  if (finish === 'length') return {code: 'output_limit'};
  if (finish === 'content_filter') return {code: 'content_filter'};
  if (finish && finish !== 'stop') return {code: 'unexpected_finish'};
  const value = choice?.message?.content ?? result?.response;
  const reply = typeof value === 'string' ?
    value.replace(/^[\s\S]*?<\/think>\s*/i, '').replace(/<think>[\s\S]*$/i, '').trim() : '';
  if (!reply) return {code: 'empty_response'};
  if (encoder.encode(reply).length > 30_000) return {code: 'response_too_large'};
  return {reply};
}

export function providerFailure(error) {
  const scalar = [error?.status, error?.statusCode, error?.code].find(x => /^\d{3,5}$/.test(String(x ?? '')));
  return {code: scalar == null ? 'provider_error_unclassified' : scalar == 429 ? 'provider_rate_limit' : 'provider_error',
    unknown: scalar == null,
    providerCode: scalar == null ? null : String(scalar)};
}
