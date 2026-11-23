import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, ScrollView, StatusBar,
  StyleSheet, Text, TextInput, View } from 'react-native';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Speech from 'expo-speech';
import { randomUUID } from 'expo-crypto';
import { requireOptionalNativeModule } from 'expo';
import type { ExpoSpeechRecognitionModule as VoiceModule } from 'expo-speech-recognition';
import { categories, eligible, endpoint, experiment, matches, type Category, type Memory, type Route } from './core';
import { audit, initialize } from './storage';

const voice = requireOptionalNativeModule<typeof VoiceModule>('ExpoSpeechRecognition');
const tabs = ['Conversa', 'Memórias', 'Laboratório', 'Ajustes'] as const;
type Tab = typeof tabs[number];
type Job = { id: string; prompt: string; route: Route; url: string; state: string; reply: string | null };
type Entry = { id: number; created: number; event: string };
type Usage = { month: string; limit: number; reserved: number; inputTokens: number; outputTokens: number; paid: boolean; local: boolean };
const labels: Record<string, string> = { queued: 'Na fila', sending: 'Enviando', uncertain: 'Envio incerto',
  done: 'Respondido', rejected: 'Recusado' };

function Button({ label, onPress, primary = false, disabled = false }: {
  label: string; onPress: () => void; primary?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={[s.button, primary && s.primary, disabled && s.disabled]}>
    <Text style={[s.buttonText, primary && s.primaryText]}>{label}</Text>
  </Pressable>;
}

function Field({ label, value, change, multiline = false, secret = false, max = 6000 }: {
  label: string; value: string; change: (value: string) => void; multiline?: boolean;
  secret?: boolean; max?: number;
}) {
  return <View style={s.field}>
    <Text style={s.label}>{label}</Text>
    <TextInput accessibilityLabel={label} style={[s.input, multiline && s.multiline]} value={value}
      onChangeText={change} multiline={multiline} secureTextEntry={secret} maxLength={max}
      autoCapitalize={secret ? 'none' : 'sentences'} placeholderTextColor="#A4A3AE" />
  </View>;
}

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDate = (timestamp: number) => new Date(timestamp).toLocaleDateString('pt-BR');

export default function App() {
  const [db, setDb] = useState<SQLiteDatabase>();
  const [tab, setTab] = useState<Tab>('Conversa');
  const [notice, setNotice] = useState('');
  const [prompt, setPrompt] = useState('');
  const [context, setContext] = useState('');
  const [route, setRoute] = useState<Route>('local');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<Category>('Experiência');
  const [privateFlag, setPrivateFlag] = useState(true);
  const [edit, setEdit] = useState<Memory>();
  const [results, setResults] = useState<{ id: number; result: string }[]>([]);
  const [version, setVersion] = useState(1);
  const [initiative, setInitiative] = useState(false);
  const [suggestion, setSuggestion] = useState<Memory>();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [settings, setSettings] = useState({ url: '', token: '' });
  const [usage, setUsage] = useState<Usage>();
  const [remoteAudit, setRemoteAudit] = useState<{id: string; state: string; reserved: number}[]>([]);
  const [portrait, setPortrait] = useState('#BDEA9D');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const networkLock = useRef(false);
  const startup = useRef<Promise<SQLiteDatabase> | null>(null);

  const refresh = useCallback(async (store: SQLiteDatabase) => {
    const [mem, queue, log, runs, options] = await Promise.all([
      store.getAllAsync<Memory>('SELECT * FROM memory ORDER BY updated DESC'),
      store.getAllAsync<Job>('SELECT * FROM outbox ORDER BY created DESC LIMIT 50'),
      store.getAllAsync<Entry>('SELECT * FROM audit ORDER BY id DESC LIMIT 25'),
      store.getAllAsync<{id: number; result: string}>('SELECT * FROM experiments ORDER BY id DESC LIMIT 20'),
      store.getAllAsync<{key: string; value: string}>('SELECT * FROM options'),
    ]);
    const prefs = Object.fromEntries(options.map(item => [item.key, item.value]));
    setMemories(mem); setJobs(queue); setEntries(log); setResults(runs);
    setVersion(Number(prefs.search ?? 1));
    setPortrait(prefs.portrait ?? '#BDEA9D');
    setInitiative(prefs.initiative === 'yes');
    const week = 7 * 24 * 60 * 60 * 1000;
    setSuggestion(prefs.initiative === 'yes'
      ? mem.find(item => !item.private && item.kind === 'Ideia arquivada' &&
        Date.now() - item.updated >= week && !prefs['dismissed:' + item.id])
      : undefined);
  }, []);

  useEffect(() => {
    let active = true;
    startup.current ??= openDatabaseAsync('ipe.db').then(async store => {
      await initialize(store);
      return store;
    });
    startup.current.then(async store => {
      const saved = await SecureStore.getItemAsync('gatewayCredentials');
      if (!active) return;
      if (saved) {
        const credentials = JSON.parse(saved) as { url: string; token: string };
        setUrl(credentials.url); setToken(credentials.token); setSettings(credentials);
      }
      await refresh(store);
      if (active) setDb(store);
    }).catch(() => active && setNotice('Falha ao abrir o armazenamento do aparelho.'));
    return () => { active = false; };
  }, [refresh]);

  useEffect(() => {
    if (!db) return;
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh(db).catch(() => setNotice('Falha ao atualizar os dados locais.'));
    });
    return () => sub.remove();
  }, [db, refresh]);

  useEffect(() => {
    if (!voice) return;
    const subscriptions = [
      voice.addListener('result', event => {
        if (event.isFinal && event.results[0]?.transcript) setPrompt(event.results[0].transcript);
      }),
      voice.addListener('end', () => setListening(false)),
      voice.addListener('error', () => { setListening(false); setNotice('O ditado local falhou neste aparelho.'); }),
    ];
    return () => subscriptions.forEach(sub => sub.remove());
  }, []);

  async function perform(action: () => Promise<void>) {
    try { await action(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'A operação falhou.'); }
  }

  function confirm(title: string, detail: string, action: () => Promise<void>) {
    Alert.alert(title, detail, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Confirmar', onPress: () => void perform(action) },
    ]);
  }

  async function option(key: string, value: string) {
    if (!db) return;
    await db.runAsync('INSERT OR REPLACE INTO options VALUES (?,?)', key, value);
  }

  async function saveMemory() {
    if (!db || !body.trim()) return;
    if (edit) {
      const update = await db.runAsync(
        'UPDATE memory SET kind=?,body=?,private=?,updated=?,version=version+1 WHERE id=? AND version=?',
        kind, body.trim(), Number(privateFlag), Date.now(), edit.id, edit.version,
      );
      if (!update.changes) throw new Error('A memória mudou. Abra a versão mais recente para editar.');
    } else {
      await db.runAsync('INSERT INTO memory VALUES (?,?,?,?,?,1)',
        randomUUID(), kind, body.trim(), Number(privateFlag), Date.now());
    }
    await audit(db, edit ? 'Memória corrigida' : 'Memória criada');
    setEdit(undefined); setBody(''); setPrivateFlag(true);
    await refresh(db);
  }

  async function removeMemory(item: Memory) {
    if (!db) return;
    const deletion = await db.runAsync('DELETE FROM memory WHERE id=? AND version=?', item.id, item.version);
    if (!deletion.changes) throw new Error('A memória mudou. Confira a versão mais recente.');
    await audit(db, 'Memória excluída');
    if (edit?.id === item.id) { setEdit(undefined); setBody(''); }
    await refresh(db);
  }

  async function request(path: string, data?: unknown) {
    if (!settings.url || !settings.token) throw new Error('Configure o gateway HTTPS em Ajustes.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55_000);
    try {
      return await fetch(settings.url + path, {
        method: data ? 'POST' : 'GET',
        headers: { Authorization: 'Bearer ' + settings.token, 'Content-Type': 'application/json' },
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal,
      });
    } finally { clearTimeout(timer); }
  }

  async function queue() {
    if (!db || !prompt.trim()) return;
    if (!settings.url) throw new Error('Configure o gateway em Ajustes antes de enfileirar.');
    const message = context ? 'Contexto escolhido pelo usuário:\n' + context + '\n\nMensagem atual:\n' + prompt.trim() : prompt.trim();
    if (message.length > 6000) throw new Error('Reduza a mensagem ou remova o contexto. O total deve ter até 6.000 caracteres.');
    await db.runAsync('INSERT INTO outbox(id,prompt,route,url,created) VALUES (?,?,?,?,?)',
      randomUUID(), message, route, settings.url, Date.now());
    await audit(db, 'Mensagem adicionada à fila');
    setPrompt(''); setContext('');
    await refresh(db);
  }

  async function send(job: Job) {
    if (!db || networkLock.current) return;
    if (settings.url !== job.url) throw new Error('Restaure o gateway original para enviar esta mensagem.');
    networkLock.current = true;
    setBusy(true);
    try {
      const claim = await db.runAsync("UPDATE outbox SET state='sending' WHERE id=? AND state='queued'", job.id);
      if (!claim.changes) return;
      let response: Response;
      let data: { reply?: string; error?: string };
      try {
        response = await request('/chat', { id: job.id, prompt: job.prompt, route: job.route });
        data = await response.json();
      } catch {
        await db.runAsync("UPDATE outbox SET state='uncertain' WHERE id=?", job.id);
        await audit(db, 'Envio sem confirmação');
        setNotice('Envio incerto. A fila mantém o texto e não repete a chamada automaticamente.');
        return;
      }
      if (response.ok && typeof data.reply === 'string') {
        await db.runAsync("UPDATE outbox SET state='done', reply=? WHERE id=?", data.reply, job.id);
        await audit(db, 'Resposta do modelo recebida');
      } else {
        const state = [401, 402, 503].includes(response.status) ? 'queued' :
          [409, 502].includes(response.status) ? 'uncertain' : 'rejected';
        await db.runAsync('UPDATE outbox SET state=? WHERE id=?', state, job.id);
        await audit(db, 'Envio recusado ou sem confirmação');
        setNotice(data.error ?? 'O gateway recusou a mensagem.');
      }
    } finally {
      networkLock.current = false;
      setBusy(false);
      await refresh(db);
    }
  }

  async function run() {
    if (!db) return;
    const result = experiment();
    await db.runAsync('INSERT INTO experiments(result) VALUES (?)', JSON.stringify(result));
    await audit(db, 'Experimento de busca executado');
    await refresh(db);
  }

  async function activate() {
    if (!db) return;
    if (!eligible(experiment())) throw new Error('A versão candidata falhou na verificação técnica.');
    await option('search', '2');
    await audit(db, 'Busca v2 aprovada e habilitada');
    await refresh(db);
  }

  async function dictate() {
    if (!voice || !voice.supportsOnDeviceRecognition()) {
      throw new Error('Ditado local indisponível aqui. Use o ditado do teclado conforme suas preferências.');
    }
    const permission = await voice.requestPermissionsAsync();
    if (!permission.granted) throw new Error('Permissão de microfone ou reconhecimento não concedida.');
    setListening(true);
    voice.start({ lang: 'pt-BR', requiresOnDeviceRecognition: true, interimResults: false });
  }

  if (!db) return <View style={[s.screen, s.center]}><StatusBar barStyle="light-content" />
    {notice ? <Text style={s.text}>{notice}</Text> : <ActivityIndicator color="#BDEA9D" />}
  </View>;

  return <View style={s.screen}>
    <StatusBar barStyle="light-content" />
    <View style={s.header}>
      <View style={[s.avatar, { backgroundColor: portrait }, listening && s.avatarListening]} accessibilityLabel={listening ? 'Ouvindo' : 'Assistente'}>
        <View style={s.eyes}><View style={s.eye} /><View style={s.eye} /></View>
        <View style={[s.mouth, (listening || busy) && s.openMouth]} />
      </View>
      <View style={s.headerCopy}><Text style={s.brand}>Inteligência Pessoal</Text>
        <Text style={s.muted}>{listening ? 'Ouvindo' : busy ? 'Aguardando o modelo' : settings.url ? 'Gateway configurado' : 'Modo local'}</Text>
      </View>
    </View>
    <View style={s.tabs}>{tabs.map(name => <Pressable key={name} accessibilityRole="tab"
      accessibilityState={{ selected: tab === name }} onPress={() => { setTab(name); setNotice(''); }}
      style={[s.tab, tab === name && s.selected]}>
      <Text style={tab === name ? s.tabActive : s.muted}>{name}</Text>
    </Pressable>)}</View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
      {!!notice && <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text>}
      {tab === 'Conversa' && <>
        <Text style={s.title}>Por onde começamos?</Text>
        {suggestion && <View style={s.card}><Text style={s.label}>Ideia arquivada há pelo menos sete dias</Text>
          <Text style={s.text}>{suggestion.body}</Text>
          <Button label="Dispensar sugestão" onPress={() => void perform(async () => {
            await option('dismissed:' + suggestion.id, 'yes'); await audit(db, 'Sugestão dispensada'); await refresh(db);
          })} /></View>}
        {!!context && <View style={s.card}><Text style={s.label}>Contexto incluído no próximo envio</Text>
          <Text style={s.text} selectable>{context}</Text>
          <Button label="Remover contexto" onPress={() => setContext('')} />
        </View>}
        <Field label="Sua mensagem" value={prompt} change={setPrompt} multiline />
        <View style={s.row}>
          <Button label="Ollama" primary={route === 'local'} onPress={() => setRoute('local')} />
          <Button label="OpenAI · pago" primary={route === 'paid'} onPress={() => setRoute('paid')} />
          <Button label={listening ? 'Parar ditado' : 'Ditar'} onPress={() => listening ? voice?.stop() : void perform(dictate)} />
          <Button label="Adicionar à fila" disabled={!prompt.trim()} onPress={() => void perform(queue)} />
        </View>
        {!!jobs.length && <Text style={s.section}>Conversas e fila</Text>}
        {jobs.map(job => <View key={job.id} style={s.card}>
          <Text style={s.label}>{labels[job.state]} · {job.id.slice(0, 8)} · {job.route === 'paid' ? 'OpenAI' : 'Ollama'}</Text>
          <Text style={s.text}>{job.prompt}</Text>
          {job.reply && <><Text style={s.answer}>{job.reply}</Text><Button label="Ouvir resposta" onPress={() => {
            void Speech.stop().then(() => Speech.speak(job.reply!, { language: 'pt-BR', onError: () => setNotice('Voz indisponível no aparelho.') }));
          }} /></>}
          <View style={s.row}>
            {job.state === 'queued' && <Button label="Enviar" primary disabled={busy} onPress={() =>
              confirm('Enviar mensagem?', job.route === 'paid'
                ? 'A mensagem irá ao gateway e à OpenAI. Esta chamada pode consumir seu orçamento.'
                : 'A mensagem irá ao gateway configurado para processamento no Ollama.', () => send(job))} />}
            {job.reply && <Button label="Continuar conversa" onPress={() => {
              setContext((job.prompt + '\n\nResposta anterior:\n' + job.reply).slice(-4000));
            }} />}
            {job.state === 'uncertain' && <>
              <Button label="Consultar auditoria" onPress={() => setTab('Ajustes')} />
              <Button label="Recolocar na fila" disabled={busy} onPress={() =>
                confirm('Recolocar na fila?', 'O gateway só aceita este identificador uma vez. Se já o registrou, recusará o envio repetido.', async () => {
                  await db.runAsync("UPDATE outbox SET state='queued' WHERE id=? AND state='uncertain'", job.id);
                  await audit(db, 'Envio incerto recolocado na fila com o mesmo ID'); await refresh(db);
                })} />
            </>}
            <Button label="Excluir da lista" disabled={busy} onPress={() => confirm('Excluir conversa?', 'O aparelho removerá a mensagem e a resposta salvas.', async () => {
              await db.runAsync('DELETE FROM outbox WHERE id=?', job.id); await audit(db, 'Conversa excluída'); await refresh(db);
            })} />
          </View>
        </View>)}
      </>}
      {tab === 'Memórias' && <>
        <Text style={s.title}>Memórias</Text>
        <Field label="Buscar no aparelho" value={query} change={setQuery} />
        <View style={s.card}>
          <Text style={s.section}>{edit ? 'Corrigir memória' : 'Nova memória'}</Text>
          <View style={s.row}>{categories.map(category =>
            <Button key={category} label={category} primary={category === kind} onPress={() => setKind(category)} />)}</View>
          <Field label="Conteúdo" value={body} change={setBody} multiline />
          <View style={s.row}>
            <Button label={privateFlag ? 'Privada · tocar para permitir sugestões' : 'Disponível para sugestões locais'}
              onPress={() => setPrivateFlag(!privateFlag)} />
            <Button label="Salvar" primary disabled={!body.trim()} onPress={() => void perform(saveMemory)} />
            {edit && <Button label="Cancelar edição" onPress={() => { setEdit(undefined); setBody(''); setPrivateFlag(true); }} />}
          </View>
        </View>
        {memories.filter(item => matches(item.kind + ' ' + item.body, query.trim(), version)).map(item =>
          <View key={item.id} style={s.card}>
            <Text style={s.label}>{item.kind} · {item.private ? 'Privada' : 'Local'} · {formatDate(item.updated)}</Text>
            <Text style={s.text}>{item.body}</Text>
            <View style={s.row}><Button label="Editar" onPress={() => {
              setEdit(item); setBody(item.body); setKind(item.kind); setPrivateFlag(!!item.private);
            }} />{!item.private && <Button label="Usar na conversa" onPress={() => {
              setContext(item.body); setTab('Conversa');
            }} />}
            <Button label="Excluir" onPress={() => confirm('Excluir memória?', 'A memória será removida do banco local.', () => removeMemory(item))} /></View>
          </View>)}
      </>}
      {tab === 'Laboratório' && <>
        <Text style={s.title}>Laboratório</Text>
        <View style={s.card}>
          <Text style={s.section}>Capacidades</Text>
          <Text style={s.text}>Memória › Busca v{version} em uso</Text>
          <Text style={s.text}>Memória › Busca v2 com tolerância a acentos e ordem das palavras</Text>
          <Text style={s.text}>Conversa › Ollama e OpenAI via gateway</Text>
          <Text style={s.muted}>Hipótese: normalizar acentos e aceitar termos fora de ordem melhora a busca nesta bateria.</Text>
          <View style={s.row}>
            <Button label="Executar experimento" primary onPress={() => void perform(run)} />
            {version === 1 && !!results[0] && eligible(JSON.parse(results[0].result)) &&
              <Button label="Aprovar busca v2" onPress={() => confirm('Ativar versão candidata?', 'A bateria será executada novamente antes da ativação.', activate)} />}
            {version === 2 && <Button label="Restaurar busca v1" onPress={() => void perform(async () => {
              await option('search', '1'); await audit(db, 'Busca v1 restaurada'); await refresh(db);
            })} />}
          </View>
        </View>
        {results.map(item => {
          const result = JSON.parse(item.result) as ReturnType<typeof experiment>;
          return <View key={item.id} style={s.card}>
            <Text style={s.label}>{new Date(result.at).toLocaleString('pt-BR')} · {result.ms} ms</Text>
            {result.versions.map(build => <View key={build.version}>
              <Text style={s.text}>Busca v{build.version} · {build.passed}/{build.cases.length} casos</Text>
              <View style={s.track}><View style={[s.bar, { width: `${100 * build.passed / build.cases.length}%` }]} /></View>
              {build.cases.filter(check => check.actual !== check.expected).map(check =>
                <Text key={check.query} style={s.muted}>Falhou em “{check.query}”</Text>)}
            </View>)}
          </View>;
        })}
      </>}
      {tab === 'Ajustes' && <>
        <Text style={s.title}>Ajustes</Text>
        <View style={s.card}><Text style={s.section}>Gateway de modelos</Text>
          <Field label="Endereço HTTPS" value={url} change={setUrl} max={500} />
          <Field label="Credencial do proprietário" value={token} change={setToken} secret max={300} />
          <View style={s.row}>
            <Button label="Salvar conexão" primary onPress={() => void perform(async () => {
              const address = endpoint(url);
              const owner = token.trim();
              if (owner.length < 32) throw new Error('Informe a credencial do gateway com pelo menos 32 caracteres.');
              const credentials = { url: address, token: owner };
              await SecureStore.setItemAsync('gatewayCredentials', JSON.stringify(credentials));
              setSettings(credentials); setUsage(undefined); setRemoteAudit([]);
              await audit(db, 'Conexão configurada'); await refresh(db);
            })} />
            <Button label="Consultar consumo e auditoria" onPress={() => void perform(async () => {
              const [status, log] = await Promise.all([request('/status'), request('/audit')]);
              if (!status.ok || !log.ok) throw new Error('O gateway recusou a consulta.');
              setUsage(await status.json()); setRemoteAudit(await log.json());
            })} />
          </View>
          {usage && <Text style={s.text}>{usage.month} · {money(usage.reserved)} reservados de {money(usage.limit)}
            {'\n'}OpenAI informou {usage.inputTokens} tokens de entrada e {usage.outputTokens} de saída.
            {'\n'}Ollama {usage.local ? 'habilitado' : 'desativado'} · OpenAI {usage.paid ? 'habilitada' : 'desativada'}</Text>}
          {remoteAudit.map(line => <Text key={line.id} style={s.muted}>
            {line.id.slice(0, 8)} · {line.state} · {money(line.reserved)}
          </Text>)}
        </View>
        <View style={s.card}><Text style={s.section}>Aparência da personagem</Text>
          <View style={s.row}>{[['Verde', '#BDEA9D'], ['Lavanda', '#CFB6FF'], ['Pêssego', '#FFC9AC']].map(([name, color]) =>
            <Button key={name} label={name} primary={portrait === color} onPress={() => void perform(async () => {
              await option('portrait', color);
              await refresh(db);
            })} />)}</View>
        </View>
        <View style={s.card}><Text style={s.section}>Autonomia</Text>
          <Text style={s.text}>Livre · Busca local e bateria de testes com dados fixos.</Text>
          <Text style={s.text}>Pré-autorizada · Sugerir ideias antigas elegíveis ao abrir o aplicativo.</Text>
          <Text style={s.text}>Aprovação obrigatória · Enviar mensagens ao gateway ou ativar uma habilidade.</Text>
          <Button label={initiative ? 'Desativar sugestões locais' : 'Autorizar sugestões locais'}
            onPress={() => void perform(async () => {
              await option('initiative', initiative ? 'no' : 'yes');
              await audit(db, initiative ? 'Sugestões revogadas' : 'Sugestões autorizadas');
              await refresh(db);
            })} />
        </View>
        <View style={s.card}><Text style={s.section}>Auditoria local</Text>
          {entries.map(entry => <Text key={entry.id} style={s.muted}>{formatDate(entry.created)} · {entry.event}</Text>)}
        </View>
      </>}
    </ScrollView>
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111318', paddingTop: 54 },
  center: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  header: { paddingHorizontal: 20, paddingBottom: 19, flexDirection: 'row', alignItems: 'center', gap: 14 },
  headerCopy: { flex: 1 },
  brand: { color: '#F6F5F2', fontSize: 19, fontWeight: '700' },
  avatar: { width: 48, height: 48, borderRadius: 18, backgroundColor: '#BDEA9D', justifyContent: 'center', gap: 5, alignItems: 'center' },
  avatarListening: { backgroundColor: '#CFB6FF' },
  eyes: { flexDirection: 'row', gap: 8 },
  eye: { width: 5, height: 7, borderRadius: 3, backgroundColor: '#222A1D' },
  mouth: { width: 12, height: 4, borderBottomWidth: 2, borderColor: '#222A1D', borderBottomLeftRadius: 7, borderBottomRightRadius: 7 },
  openMouth: { height: 7, backgroundColor: '#222A1D', borderRadius: 5 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', borderBottomWidth: 1, borderColor: '#363943', paddingHorizontal: 10 },
  tab: { minHeight: 46, flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  selected: { borderBottomWidth: 2, borderColor: '#BDEA9D' },
  tabActive: { color: '#BDEA9D', fontWeight: '700' },
  content: { padding: 20, paddingBottom: 48, gap: 15, width: '100%', maxWidth: 730, alignSelf: 'center' },
  title: { color: '#F8F7F2', fontSize: 32, fontWeight: '700', letterSpacing: -1 },
  section: { color: '#F6F5F2', fontSize: 19, fontWeight: '700' },
  text: { color: '#F6F5F2', fontSize: 16, lineHeight: 23 },
  answer: { color: '#D0EDBA', fontSize: 16, lineHeight: 23 },
  muted: { color: '#B6B9C7', fontSize: 13, lineHeight: 19 },
  label: { color: '#CBCEDB', fontSize: 13, fontWeight: '600' },
  card: { padding: 15, borderRadius: 17, gap: 10, borderWidth: 1, borderColor: '#343744', backgroundColor: '#1D2029' },
  field: { gap: 7 },
  input: { color: '#F6F5F2', borderColor: '#444856', borderWidth: 1, borderRadius: 11, padding: 12, backgroundColor: '#13151C', minHeight: 48, fontSize: 16 },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 9, backgroundColor: '#313644' },
  primary: { backgroundColor: '#BDEA9D' },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#F6F5F2', fontSize: 14, fontWeight: '600' },
  primaryText: { color: '#182016' },
  notice: { color: '#FFDA9F', backgroundColor: '#34291C', padding: 12, borderRadius: 9 },
  track: { height: 8, backgroundColor: '#373C4A', borderRadius: 8, marginVertical: 7 },
  bar: { height: 8, borderRadius: 8, backgroundColor: '#BDEA9D' },
});
