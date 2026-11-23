export const categories = ['Experiência', 'Preferência', 'Decisão', 'Erro e solução',
  'Conhecimento', 'Projeto', 'Ideia arquivada', 'Experimento'] as const;
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
