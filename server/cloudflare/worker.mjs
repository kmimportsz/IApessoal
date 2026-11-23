import { identity, officialIdentity } from './persona.mjs';
import { initiativeRoute, reviewProjects } from './initiative.mjs';
import { setupPage } from './setup.mjs';
import { describe, idPattern, interpret, providerFailure, readReceipt, replyTtl, seal, unseal } from './recovery.mjs';

const economical = '@cf/openai/gpt-oss-20b';
const advanced = '@cf/openai/gpt-oss-120b';
const models = {
  [economical]: {label: 'GPT-OSS 20B', inputRate: 18182, outputRate: 27273, maxTokens: 768},
  [advanced]: {label: 'GPT-OSS 120B', inputRate: 31818, outputRate: 68182, maxTokens: 4096},
};
const dailyCalls = 100;
const dailyNeurons = 5000;

export function selectModel(prompt, env) {
  const question = prompt.split('\n\nMensagem atual:\n').at(-1).normalize('NFD').replace(/\p{M}/gu, '');
  const complex = question.length > 460 ||
    /\b(compare|comparar|analise|analisar|estrategia|planeje|arquitetura|demonstre|prove|raciocinio|passo a passo)\b/i.test(question);
  const id = env.MODEL ?? (complex ? advanced : economical);
  return Object.hasOwn(models, id) ? {id, ...models[id]} : null;
}

function neurons(model, input, output) {
  return Math.max(1, Math.ceil((model.inputRate * input + model.outputRate * output) / 1_000_000));
}

function reservedNeurons(model, messages) {
  const bytes = new TextEncoder().encode(messages.map(message => message.content).join('')).length;
  return neurons(model, bytes + 512, model.maxTokens);
}

function json(payload, status = 200) {
  return Response.json(payload, {status, headers: {'Cache-Control': 'no-store'}});
}

function error(message, status) {
  return json({error: message}, status);
}

const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
}

async function matchesDigest(token, expected) {
  if (!tokenPattern.test(token) || !/^[a-f0-9]{64}$/.test(expected ?? '')) return false;
  const actual = await digest(token);
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function authorized(request, env) {
  const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(request.headers.get('Authorization') ?? '');
  if (!match) return false;
  const owner = env.DB && await env.DB.prepare('SELECT token_hash FROM gateway_owner WHERE singleton=1').first();
  return matchesDigest(match[1], owner?.token_hash ?? env.OWNER_SHA256);
}

async function pair(request, env) {
  if (!enabled(env) || !(Number(env.PAIR_UNTIL) > Date.now()) ||
    request.headers.get('Origin') !== new URL(request.url).origin) return error('Configuração indisponível ou expirada.', 403);
  const body = await readJson(request, 512);
  if (typeof body?.code !== 'string' || !await matchesDigest(body.code, env.PAIR_SHA256)) {
    return error('Link de configuração inválido.', 403);
  }
  const random = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(random, x => x.toString(16).padStart(2, '0')).join('');
  const result = await env.DB.prepare(`
    INSERT INTO gateway_owner(singleton,token_hash) VALUES (1,?)
    ON CONFLICT(singleton) DO NOTHING RETURNING singleton
  `).bind(await digest(token)).first();
  return result ? json({token}, 201) : error('Este link de configuração já foi usado.', 409);
}

function enabled(env) {
  return env.DEPLOYMENT_TIER === 'workers-free-confirmed' && !!env.AI && !!env.DB && !!env.INFERENCE && /^[a-f0-9]{64}$/.test(env.RECOVERY_KEY ?? '') && !!selectModel('', env);
}

async function readJson(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let raw = '';
  let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      raw += decoder.decode(value, {stream: true});
    }
    return JSON.parse(raw + decoder.decode());
  } catch { return null; }
  finally { reader.releaseLock(); }
}

async function readChat(request) {
  const data = await readJson(request, 32_768);
  if (!data || typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 6000 ||
    typeof data.id !== 'string' || !idPattern.test(data.id) ||
    !['local', 'paid'].includes(data.route)) return null;
  return {...data, id: data.id.toLowerCase()};
}

export const claim = `
  INSERT INTO ai_calls_v12(id, day, month, created, state, model, neurons)
  SELECT ?, ?, ?, ?, 'started', ?, ?
  WHERE NOT EXISTS (SELECT 1 FROM ai_calls WHERE id=?)
    AND (SELECT COUNT(*) FROM ai_calls_v12 WHERE day=?) < ?
    AND (SELECT COALESCE(SUM(neurons),0) FROM ai_calls_v12 WHERE day=?) + ? <= ?
  ON CONFLICT(id) DO NOTHING RETURNING id
`;

async function receipt(env, id, includeReply) {
  const row = await env.DB.prepare(readReceipt + ' WHERE c.id=?').bind(id).first();
  if (!row) return null;
  const info = describe(row, Date.now());
  if (includeReply && info.recoverable) {
    try { info.reply = await unseal(row.sealed_reply, env.RECOVERY_KEY, 'reply:' + id); }
    catch { return {...info, recoverable: false, code: 'response_unavailable'}; }
    info.modelLabel = models[row.model]?.label ?? row.model;
    info.responseSource = 'model';
  }
  return info;
}

async function chat(request, env, now, day, month) {
  const data = await readChat(request);
  if (!data) return error('Mensagem inválida. O limite é de 6.000 caracteres, incluindo contexto.', 400);
  if (data.route !== 'local' || !enabled(env)) return error('Modelo desativado no servidor.', 503);
  const previous = await receipt(env, data.id, true);
  if (previous) return json(previous, previous.state === 'processing' ? 202 : 200);
  const model = selectModel(data.prompt, env);
  const official = officialIdentity(data.prompt, model);
  if (official) return json({reply: official, route: 'local', model: null,
    modelLabel: 'Configuração verificada', responseSource: 'gateway-identity'});
  const messages = [{role: 'system', content: identity(model)}, {role: 'user', content: data.prompt}];
  const reserve = reservedNeurons(model, messages);
  const sealed = await seal(data.prompt, env.RECOVERY_KEY, 'prompt:' + data.id);
  const inserted = await env.DB.prepare(claim)
    .bind(data.id, day, month, now.getTime(), model.id, reserve, data.id, day, dailyCalls, day, reserve, dailyNeurons).first();
  if (!inserted) {
    const duplicate = await receipt(env, data.id, true);
    if (duplicate) return json(duplicate, duplicate.state === 'processing' ? 202 : 200);
    const legacy = await env.DB.prepare('SELECT id FROM ai_calls WHERE id=?').bind(data.id).first();
    return legacy ? error('Este envio antigo já está registrado.', 409) :
      error('Cota diária atingida. O limite renova às 21h em São Paulo.', 402);
  }
  try {
    await env.INFERENCE.send({id: data.id, sealed});
  } catch {
    return error('O gateway não confirmou a entrada na fila. Consulte a resposta pelo mesmo ID.', 502);
  }
  return json({id: data.id, state: 'processing', model: model.id}, 202);
}

async function consume(env, body) {
  if (!idPattern.test(body?.id ?? '') || typeof body.sealed !== 'string') return;
  const {id} = body;
  const call = await env.DB.prepare("SELECT model, created, neurons FROM ai_calls_v12 WHERE id=? AND state='started'")
    .bind(id).first();
  if (!call) return;
  const started = Date.now();
  const marker = await env.DB.prepare(`
    INSERT INTO request_recovery(id,phase,started) VALUES (?,'processing',?)
    ON CONFLICT(id) DO NOTHING RETURNING id
  `).bind(id, started).first();
  if (!marker) return;
  const model = {id: call.model, ...models[call.model]};
  let outcome;
  let accounted = call.neurons;
  let encrypted = null;
  if (!enabled(env) || !Object.hasOwn(models, call.model)) outcome = {code: 'gateway_disabled'};
  else if (started - call.created > 5 * 60 * 1000) outcome = {code: 'queue_expired'};
  else {
    let prompt;
    try { prompt = await unseal(body.sealed, env.RECOVERY_KEY, 'prompt:' + id); }
    catch { outcome = {code: 'queue_payload_invalid'}; }
    if (prompt !== undefined) {
      let result;
      let timer;
      try {
        const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('deadline')), 180_000); });
        const messages = [{role: 'system', content: identity(model)}, {role: 'user', content: prompt}];
        result = await Promise.race([env.AI.run(model.id, {messages, max_tokens: model.maxTokens, temperature: 0.6, stream: false}), deadline]);
        outcome = interpret(result);
        const input = result?.usage?.prompt_tokens;
        const output = result?.usage?.completion_tokens;
        if (Number.isSafeInteger(input) && input > 0 && Number.isSafeInteger(output) && output > 0) accounted = neurons(model, input, output);
      } catch (failure) {
        outcome = failure?.message === 'deadline' ? {code: 'inference_deadline', unknown: true} : providerFailure(failure);
      } finally { clearTimeout(timer); }
      if (outcome.reply) {
        try { encrypted = await seal(outcome.reply, env.RECOVERY_KEY, 'reply:' + id); }
        catch { outcome = {code: 'response_storage_error', unknown: true}; }
      }
    }
  }
  const ended = Date.now();
  const phase = encrypted ? 'finished' : outcome.unknown ? 'unknown' : 'failed';
  await env.DB.batch([
    env.DB.prepare('UPDATE request_recovery SET phase=?, ended=?, code=?, provider_code=?, sealed_reply=?, expires=? WHERE id=?')
      .bind(phase, ended, outcome.code ?? null, outcome.providerCode ?? null, encrypted, encrypted ? ended + replyTtl : null, id),
    env.DB.prepare('UPDATE ai_calls_v12 SET state=?, neurons=? WHERE id=?')
      .bind(encrypted ? 'finished' : 'uncertain', accounted, id),
  ]);
}

export default {
  async fetch(request, env) {
    const {pathname} = new URL(request.url);

    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const month = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit'})
      .formatToParts(now).filter(part => part.type !== 'literal').map(part => part.value).join('-');
    try {
      if (request.method === 'GET' && pathname === '/setup') {
        return new Response(setupPage, {headers: {
          'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
        }});
      }
      if (request.method === 'POST' && pathname === '/pair') return await pair(request, env);
      if (!await authorized(request, env)) return error('Credencial inválida.', 401);
      if (pathname === '/initiative' || pathname.startsWith('/initiative/')) {
        return await initiativeRoute({path: pathname, method: request.method, db: env.DB,
          read: limit => readJson(request, limit), now: now.getTime()});
      }
      if (request.method === 'GET' && pathname === '/status') {
        const usage = env.DB && await env.DB.prepare(
          'SELECT COUNT(*) AS attempts, COALESCE(SUM(neurons),0) AS neurons FROM ai_calls_v12 WHERE day=?'
        ).bind(day).first();
        return json({month, limit: 2000, reserved: 0, inputTokens: 0, outputTokens: 0,
          paid: false, local: enabled(env), localLabel: 'IA gratuita · seleção automática',
          dailyLimit: dailyCalls, dailyUsed: usage?.attempts ?? 0, neuronLimit: dailyNeurons,
          neuronsUsed: usage?.neurons ?? 0});
      }
      if (request.method === 'GET' && pathname === '/audit' && env.DB) {
        const rows = await env.DB.prepare(readReceipt.replace('r.sealed_reply', 'CASE WHEN r.sealed_reply IS NOT NULL THEN 1 END AS sealed_reply') + ' ORDER BY c.created DESC LIMIT 50').all();
        return json(rows.results.map(row => describe(row, now.getTime())));
      }
      if (request.method === 'GET' && pathname.startsWith('/requests/')) {
        const id = pathname.slice('/requests/'.length).toLowerCase();
        if (!idPattern.test(id)) return error('Identificador inválido.', 400);
        const result = await receipt(env, id, true);
        return result ? json(result) : error('Não há registro recuperável para este ID.', 404);
      }
      if (request.method === 'POST' && pathname === '/chat') return await chat(request, env, now, day, month);
      return error('Rota inexistente.', 404);
    } catch {
      return error('O gateway não confirmou a operação. Confira a auditoria antes de repetir.', 502);
    }
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      await consume(env, message.body);
      message.ack();
    }
  },
  async scheduled(_event, env) {
    await reviewProjects(env.DB, Date.now());
    await env.DB.prepare('UPDATE request_recovery SET sealed_reply=NULL WHERE expires <= ? AND sealed_reply IS NOT NULL')
      .bind(Date.now()).run();
  }
};
