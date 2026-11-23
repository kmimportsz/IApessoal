export const categories = ['Experiência', 'Preferência', 'Decisão', 'Erro e solução',
  'Conhecimento', 'Projeto', 'Ideia arquivada', 'Experimento', 'Perfil', 'Objetivo', 'Compromisso', 'Aprendizado', 'Importante'] as const;
export type Category = typeof categories[number];
export type Route = 'local' | 'paid';
export type Memory = { id: string; kind: Category; body: string; private: number; updated: number; version: number };

function normalize(value: string): string {
  return value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '');
}

export function matches(body: string, query: string, version: number): boolean {
  if (version === 1) return body.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'));
  return normalize(query).trim().split(/\s+/).every(word => normalize(body).includes(word));
}

const cases: [string, string, boolean][] = [
  ['Revisão do orçamento', 'revisao', true],
  ['Linguiça e pão', 'PAO', true],
  ['Plano de leitura para junho', 'junho plano', true],
  ['Migrar cadastro', 'migrar pagamento', false],
  ['Decidir roteiro', 'DECIDIR', true],
  ['Livro de receitas', 'laboratório', false],
];

export function experiment() {
  const started = Date.now();
  const versions = [1, 2].map(version => ({
    version,
    cases: cases.map(([body, query, expected]) => ({
      body, query, expected, actual: matches(body, query, version),
    })),
  })).map(result => ({
    ...result,
    passed: result.cases.filter(item => item.expected === item.actual).length,
  }));
  return { at: new Date().toISOString(), ms: Date.now() - started, versions };
}

export function eligible(result: ReturnType<typeof experiment>): boolean {
  const [baseline, candidate] = result.versions;
  return candidate.passed === candidate.cases.length && candidate.passed > baseline.passed;
}

export function endpoint(raw: string): string {
  const value = new URL(raw.trim());
  if (value.protocol !== 'https:' || value.username || value.password || value.search || value.hash) {
    throw new Error('Informe uma URL HTTPS sem credenciais, parâmetros ou fragmento.');
  }
  return value.href.replace(/\/$/, '');
}

/** Only explicit, short preferences are offered for review. The candidate remains in memory. */
export function preferenceCandidate(text: string): string | undefined {
  const value = text.trim();
  if (!/^prefiro\s+.{3,100}$/iu.test(value) || /[@\d\n]|\b(senha|cpf|conta|cartão|segredo|endereço|telefone|saúde)\b/iu.test(value)) return;
  return value;
}

export type Connection = 'unconfigured' | 'offline' | 'checking' | 'unreachable' | 'disabled' | 'auth' | 'online';
export function connectionState(configured: boolean, connected: boolean | null, status: number | undefined,
  routeEnabled?: boolean): Connection {
  if (connected === false) return 'offline';
  if (!configured) return 'unconfigured';
  if (status === undefined) return 'checking';
  if (status === 401 || status === 403) return 'auth';
  if (status !== 200 || typeof routeEnabled !== 'boolean') return 'unreachable';
  return routeEnabled ? 'online' : 'disabled';
}

export function messageForQueue(prompt: string, context: string): string {
  const message = prompt.trim();
  if (!context) return message;
  return 'Contexto escolhido pelo usuário:\n' + context + '\n\nMensagem atual:\n' + message;
}

const ignored = new Set('para sobre como qual quais quero quando minha minhas meu meus nossa isso esse essa seria pode usar ainda mais muito que uma tenho'.split(' '));

export function memoryKey(value: string) {
  return normalize(value).replace(/[\p{P}\p{Z}\s]+/gu, ' ').trim();
}

export function relevantMemory(prompt: string, memories: Memory[]): Memory | undefined {
  const terms = Array.from(new Set(memoryKey(prompt).split(' ').filter(word => word.length >= 4 && !ignored.has(word))));
  if (!terms.length) return undefined;
  return memories.filter(memory => !memory.private && memory.body.length <= 1200)
    .map(memory => {
      const words = new Set(memoryKey(memory.body).split(' '));
      const hits = terms.filter(term => words.has(term));
      const score = hits.length >= 2 || (terms.length === 1 && hits.some(term => term.length >= 7))
        ? hits.length / Math.sqrt(Math.max(words.size, 1)) : 0;
      return {memory, score};
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.memory.updated - a.memory.updated)[0]?.memory;
}

/** A short, explicit continuation uses a single recent exchange without inherited memory context. */
export function recentContext(question: string, previous?: {prompt:string;reply:string|null;memory_id:string|null;reply_at:number|null}, now = Date.now()) {
  if (!/^(?:continue\b|voltando\b|sobre isso\b|e se\b|por que\b|como assim\b)/iu.test(question.trim()) ||
      !previous?.reply || !previous.reply_at || now - previous.reply_at > 3_600_000 || previous.memory_id ||
      previous.prompt.startsWith('Contexto escolhido pelo usuário:')) return undefined;
  return ('Mensagem anterior: ' + previous.prompt.slice(0, 450) + '\nResposta anterior: ' + previous.reply.slice(0, 750));
}

export function validateMemoryBackup(value: unknown): Memory[] {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 ||
      !('memories' in value) || !Array.isArray(value.memories) || value.memories.length > 500) throw Error('Formato de backup inválido.');
  return value.memories.map(row => {
    if (!row || !categories.includes(row.kind) || typeof row.body !== 'string' ||
        !row.body.trim() || row.body.length > 6000 || ![0,1].includes(row.private) ||
        !Number.isSafeInteger(row.updated) || row.updated < 0) throw Error('O backup contém uma memória inválida.');
    return {id:'',kind:row.kind,body:row.body.trim(),private:row.private,updated:row.updated,version:1};
  });
}
