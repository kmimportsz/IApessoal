import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar,
  StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useNetInfo } from '@react-native-community/netinfo';
import * as Clipboard from 'expo-clipboard';
import { Avatar, Atmosphere, Icon, IconButton, palette, type AvatarState, type IconName } from './visual';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Speech from 'expo-speech';
import { randomUUID } from 'expo-crypto';
import { requireOptionalNativeModule } from 'expo';
import type { ExpoSpeechRecognitionModule as VoiceModule } from 'expo-speech-recognition';
import { categories, connectionState, eligible, endpoint, experiment, matches, messageForQueue, preferenceCandidate, type Category, type Memory, type Route } from './core';
import { audit, initialize } from './storage';
import { claimJobSql } from './outbox';

const voice = requireOptionalNativeModule<typeof VoiceModule>('ExpoSpeechRecognition');
const tabs = ['Conversa', 'Memórias', 'Laboratório', 'Ajustes'] as const;
type Tab = typeof tabs[number];
type Job = { id: string; prompt: string; route: Route; url: string; state: string; reply: string | null; created: number; reply_at: number | null; memory_id: string | null; memory_version: number | null };
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

const tabIcons: Record<Tab, IconName> = {Conversa: 'chat', Memórias: 'layers', Laboratório: 'flask', Ajustes: 'settings'};
const connectionLabels = {unconfigured: 'Modo local', offline: 'Offline', checking: 'Verificando modelo',
  unreachable: 'Servidor indisponível', disabled: 'Modelo desativado', auth: 'Credencial recusada', online: 'Gateway online'};
type ChatRow = { key: string; date: number; kind: 'date' | 'prompt' | 'reply'; job?: Job };
type MemoryRevision = {memory_id: string; version: number; changed: number};
const time = (stamp: number) => new Date(stamp).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});
const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDate = (timestamp: number) => new Date(timestamp).toLocaleDateString('pt-BR');

export default function App() {
  return <SafeAreaProvider><PersonalApp /></SafeAreaProvider>;
}

function PersonalApp() {
  const [db, setDb] = useState<SQLiteDatabase>();
  const [tab, setTab] = useState<Tab>('Conversa');
  const [notice, setNotice] = useState('');
  const [prompt, setPrompt] = useState('');
  const [context, setContext] = useState('');
  const [contextMemory, setContextMemory] = useState<Memory>();
  const [preference, setPreference] = useState<string>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [chatQuery, setChatQuery] = useState('');
  const [menu, setMenu] = useState(false);
  const [inputHeight, setInputHeight] = useState(43);
  const [speaking, setSpeaking] = useState(false);
  const [filter, setFilter] = useState<Category>();
  const [oldest, setOldest] = useState(false);
  const [revisions, setRevisions] = useState<MemoryRevision[]>([]);
  const [probe, setProbe] = useState<{code: number; usage?: Usage}>();
  const net = useNetInfo();
  const connected = net.isConnected === false || net.isInternetReachable === false ? false : net.isConnected;
  const chat = useRef<FlatList<ChatRow>>(null);
  const panels = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const nearEnd = useRef(true);
  const queueLock = useRef(false);
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
  const [portrait, setPortrait] = useState(palette.blueDark);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const networkLock = useRef(false);
  const startup = useRef<Promise<SQLiteDatabase> | null>(null);

  const refresh = useCallback(async (store: SQLiteDatabase) => {
    const [mem, queue, log, runs, options, history] = await Promise.all([
      store.getAllAsync<Memory>('SELECT * FROM memory ORDER BY updated DESC'),
      store.getAllAsync<Job>('SELECT * FROM outbox ORDER BY created, id'),
      store.getAllAsync<Entry>('SELECT * FROM audit ORDER BY id DESC LIMIT 25'),
      store.getAllAsync<{id: number; result: string}>('SELECT * FROM experiments ORDER BY id DESC LIMIT 20'),
      store.getAllAsync<{key: string; value: string}>('SELECT * FROM options'),
      store.getAllAsync<MemoryRevision>('SELECT * FROM memory_history ORDER BY changed DESC'),
    ]);
    const prefs = Object.fromEntries(options.map(item => [item.key, item.value]));
    setMemories(mem); setJobs(queue); setEntries(log); setResults(runs); setRevisions(history);
    setVersion(Number(prefs.search ?? 1));
    setPortrait(prefs.portrait ?? palette.blueDark);
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
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

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

  useEffect(() => {
    setProbe(undefined);
    if (!settings.url || !settings.token || connected === false) return;
    let active = true;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      if (AppState.currentState === 'background' || AppState.currentState === 'inactive') return;
      controller?.abort();
      const current = new AbortController();
      controller = current;
      const timeout = setTimeout(() => current.abort(), 6000);
      try {
        const response = await fetch(settings.url + '/status', {
          headers: {Authorization: 'Bearer ' + settings.token}, signal: current.signal,
        });
        const value = response.ok ? await response.json() as Usage : undefined;
        if (active && controller === current) setProbe({code: response.status, usage: value});
      } catch {
        if (active && controller === current) setProbe({code: 0});
      } finally { clearTimeout(timeout); }
    }
    void check();
    timer = setInterval(() => void check(), 30000);
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void check();
      else { controller?.abort(); controller = undefined; }
    });
    return () => { active = false; controller?.abort(); clearInterval(timer); sub.remove(); };
  }, [settings, connected]);

  const state = connectionState(Boolean(settings.url && settings.token), connected, probe?.code,
    route === 'paid' ? probe?.usage?.paid : probe?.usage?.local);
  const avatarState: AvatarState = listening ? 'listening' : busy ? 'thinking' : speaking ? 'speaking' :
    state === 'offline' || state === 'unreachable' ? 'offline' : 'neutral';
  const rows = useMemo(() => {
    const items: ChatRow[] = [];
    for (const job of jobs) {
      if (chatQuery.trim() && !matches(job.prompt + ' ' + (job.reply ?? ''), chatQuery.trim(), 2)) continue;
      items.push({key: job.id + ':p', kind: 'prompt', date: job.created, job});
      if (job.reply) items.push({key: job.id + ':r', kind: 'reply', date: job.reply_at ?? job.created, job});
    }
    items.sort((a, b) => a.date - b.date);
    const result: ChatRow[] = [];
    let previous = '';
    for (const item of items) {
      const day = formatDate(item.date);
      if (day !== previous) result.push({key: day, date: item.date, kind: 'date'});
      result.push(item);
      previous = day;
    }
    return result;
  }, [jobs, chatQuery]);

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
    setEdit(undefined); setBody(''); setPrivateFlag(true); setEditor(false);
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

  function clearContext() { setContext(''); setContextMemory(undefined); }

  function confirmSend(job: Job) {
    confirm('Enviar mensagem?', job.route === 'paid'
      ? 'O texto exibido na conversa, incluindo o contexto, irá ao gateway e à OpenAI. A chamada pode consumir seu orçamento.'
      : 'O texto exibido na conversa, incluindo o contexto, irá ao gateway configurado para processamento no Ollama.',
    () => send(job));
  }

  async function queue() {
    if (!db || !prompt.trim() || queueLock.current) return;
    const message = messageForQueue(prompt, context);
    if (message.length > 6000) throw new Error('O total da mensagem e do contexto deve ter até 6.000 caracteres.');
    queueLock.current = true;
    try {
      if (contextMemory) {
        const current = await db.getFirstAsync<Memory>('SELECT * FROM memory WHERE id=?', contextMemory.id);
        if (!current || current.private || current.version !== contextMemory.version) {
          clearContext();
          throw new Error('A memória escolhida mudou ou ficou privada. Selecione o contexto novamente.');
        }
      }
      const job: Job = {id: randomUUID(), prompt: message, route, url: settings.url, state: 'queued',
        created: Date.now(), reply: null, reply_at: null, memory_id: contextMemory?.id ?? null,
        memory_version: contextMemory?.version ?? null};
      await db.runAsync('INSERT INTO outbox(id,prompt,route,url,created,memory_id,memory_version) VALUES (?,?,?,?,?,?,?)',
        job.id, job.prompt, job.route, job.url, job.created, job.memory_id, job.memory_version);
      setPreference(preferenceCandidate(prompt));
      setPrompt(''); clearContext();
      nearEnd.current = true;
      await audit(db, 'Mensagem adicionada à fila');
      await refresh(db);
      if (state === 'online') confirmSend(job);
    } finally { queueLock.current = false; }
  }

  async function send(job: Job) {
    if (!db || networkLock.current) return;
    if (!settings.url || !settings.token) throw new Error('Configure o gateway em Ajustes.');
    if (connected === false) throw new Error('Sem conexão. A mensagem continua na fila.');
    if (job.url && settings.url !== job.url) throw new Error('Restaure o gateway original para enviar esta mensagem.');
    networkLock.current = true;
    setBusy(true);
    try {
      const claim = await db.runAsync(claimJobSql, settings.url, job.id);
      if (!claim.changes) {
        if (job.memory_id) setNotice('O contexto da memória foi alterado ou revogado. Crie uma nova mensagem com o contexto atual.');
        return;
      }
      setJobs(current => current.map(item => item.id === job.id ? {...item, state: 'sending', url: settings.url} : item));
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
        await db.runAsync("UPDATE outbox SET state='done', reply=?, reply_at=? WHERE id=?", data.reply, Date.now(), job.id);
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

  const [editor, setEditor] = useState(false);
  useEffect(() => { panels.current?.scrollTo({y: 0, animated: false}); }, [tab, editor]);
  const chart = useMemo(() => results.map(item => ({
    id: item.id, ...JSON.parse(item.result) as ReturnType<typeof experiment>,
  })), [results]);

  function go(to: Tab) {
    if (to === 'Conversa') nearEnd.current = true;
    setTab(to);
    setMenu(false);
    setNotice('');
  }

  function newMemory(category: Category, draft = '') {
    setEdit(undefined); setKind(category); setBody(draft); setPrivateFlag(true);
    setEditor(true); go('Memórias');
  }

  function speak(reply: string) {
    void Speech.stop().then(() => {
      Speech.speak(reply, {language: 'pt-BR', onStart: () => setSpeaking(true),
        onDone: () => setSpeaking(false), onStopped: () => setSpeaking(false),
        onError: () => { setSpeaking(false); setNotice('Voz indisponível no aparelho.'); },
      });
    }).catch(() => setNotice('Voz indisponível no aparelho.'));
  }

  if (!db) return <SafeAreaView style={[s.screen, s.center]}><StatusBar barStyle="light-content" />
    {notice ? <Text style={s.text}>{notice}</Text> : <ActivityIndicator color={palette.blue} />}
  </SafeAreaView>;

  function useMemory(item: Memory) {
    setContext(item.body); setContextMemory(item); go('Conversa');
  }

  function renderChat({item}: {item: ChatRow}) {
    if (item.kind === 'date') return <View style={s.day}><View style={s.rule} /><Text style={s.dayText}>
      {formatDate(item.date) === formatDate(Date.now()) ? 'Hoje' : formatDate(item.date)}
    </Text><View style={s.rule} /></View>;
    const job = item.job!;
    const isReply = item.kind === 'reply';
    const content = isReply ? job.reply! : job.prompt;
    const jobLabel = job.state === 'queued' && connected === false ? 'Aguardando conexão' : labels[job.state];
    function actions() {
      const copy = {text: 'Copiar', onPress: () => void perform(async () => { await Clipboard.setStringAsync(content); setNotice('Mensagem copiada.'); })};
      const cancel = {text: 'Cancelar', style: 'cancel' as const};
      if (isReply) {
        Alert.alert('Resposta', undefined, [copy, {text: 'Continuar conversa', onPress: () => {
          const source = job.memory_id ? memories.find(memory => memory.id === job.memory_id) : undefined;
          if (job.memory_id && (!source || source.private || source.version !== job.memory_version)) {
            setNotice('O contexto original mudou ou foi revogado. Escolha um novo contexto.');
            return;
          }
          setContext((job.prompt + '\n\nResposta anterior:\n' + content).slice(-4000)); setContextMemory(source);
        }}, cancel]);
        return;
      }
      Alert.alert('Mensagem', 'ID ' + job.id.slice(0, 8), [copy, {text: 'Excluir conversa', style: 'destructive', onPress: () => {
        if (networkLock.current) { setNotice('Aguarde o envio em andamento.'); return; }
        confirm('Excluir conversa?', 'O aparelho removerá a mensagem e a resposta salvas.', async () => {
          await db!.runAsync("DELETE FROM outbox WHERE id=? AND state!='sending'", job.id);
          await audit(db!, 'Conversa excluída'); await refresh(db!);
        });
      }}, cancel]);
    }
    return <View style={[s.messageRow, !isReply && s.userRow]}>
      {isReply && <Avatar small ring={palette.blueDark} />}
      <View style={[s.bubble, isReply ? s.assistantBubble : s.userBubble]}>
        <Text style={s.message} selectable>{content}</Text>
        <View style={s.bubbleMeta}>
          <Text style={s.muted}>{!isReply && job.state !== 'done' ? jobLabel + ' · ' : ''}{time(item.date)}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Ações da mensagem" onPress={actions} style={s.messageAction}>
            <Icon name="more" size={19} />
          </Pressable>
        </View>
        {isReply && <Pressable accessibilityRole="button" onPress={() => speak(content)} style={s.inlineAction}>
          <Text style={s.link}>Ouvir resposta</Text></Pressable>}
        {!isReply && job.state === 'queued' && <Pressable accessibilityRole="button" disabled={busy || connected === false || !settings.url}
          style={s.inlineAction} onPress={() => confirmSend(job)}>
          <Text style={s.link}>{!settings.url ? 'Configure um gateway para enviar' : connected === false ? 'Envio disponível ao reconectar' :
            'Enviar · ' + (job.route === 'paid' ? 'OpenAI' : 'Ollama')}</Text>
        </Pressable>}
        {!isReply && job.state === 'uncertain' && <View style={s.row}>
          <Button label="Auditoria" onPress={() => go('Ajustes')} />
          <Button label="Recolocar na fila" disabled={busy} onPress={() =>
            confirm('Recolocar na fila?', 'O gateway usa o mesmo identificador para evitar chamadas duplicadas.', async () => {
              await db!.runAsync("UPDATE outbox SET state='queued' WHERE id=? AND state='uncertain'", job.id);
              await audit(db!, 'Envio incerto recolocado na fila com o mesmo ID'); await refresh(db!);
            })} />
        </View>}
      </View>
    </View>;
  }

  const connection = listening ? 'Escutando' : busy ? 'Processando' : speaking ? 'Respondendo por voz' : connectionLabels[state];
  const shortcuts: {name: IconName; label: string; action: () => void}[] = [
    {name: 'layers', label: 'Nova memória', action: () => newMemory('Experiência')},
    {name: 'folder', label: 'Novo projeto', action: () => newMemory('Projeto')},
    {name: 'chart', label: 'Análise', action: () => go('Laboratório')},
    {name: 'idea', label: 'Ideia', action: () => newMemory('Ideia arquivada')},
  ];
  const visibleMemories = memories.filter(item => (!filter || item.kind === filter) &&
    matches(item.kind + ' ' + item.body, query.trim(), version));
  if (oldest) visibleMemories.reverse();

  return <SafeAreaView style={s.screen} edges={['top', 'bottom', 'left', 'right']}>
    <StatusBar barStyle="light-content" />
    <Atmosphere />
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.header}>
        <Avatar state={avatarState} ring={portrait} />
        <View style={s.headerCopy}>
          <Text style={s.brand}>IA Pessoal</Text>
          <View style={s.status}><View style={[s.statusDot, state === 'online' && s.onlineDot]} />
            <Text style={s.muted} accessibilityLiveRegion="polite">{connection}</Text></View>
        </View>
        <IconButton name="search" label="Pesquisar" onPress={() => {
          if (tab === 'Conversa') { setSearchOpen(!searchOpen); setChatQuery(''); }
          else go('Memórias');
        }} />
        <IconButton name="settings" label="Abrir ajustes" onPress={() => go('Ajustes')} />
      </View>
      <View style={s.tabs} accessibilityRole="tablist">{tabs.map(name =>
        <Pressable key={name} accessibilityRole="tab" accessibilityState={{selected: tab === name}}
          onPress={() => go(name)} style={[s.tab, tab === name && s.selected]}>
          <Icon name={tabIcons[name]} color={tab === name ? '#57A0FF' : palette.muted} size={20} />
          <Text style={tab === name ? s.tabActive : s.tabLabel}>{name}</Text>
        </Pressable>)}</View>
      {!!notice && <Pressable onPress={() => setNotice('')} accessibilityHint="Toque para dispensar">
        <Text style={s.notice} accessibilityLiveRegion="polite">{notice}</Text>
      </Pressable>}
      {tab === 'Conversa' ? <View style={s.flex}>
        {searchOpen && <TextInput style={[s.input, s.search]} autoFocus accessibilityLabel="Pesquisar conversas"
          placeholder="Buscar nas conversas" placeholderTextColor={palette.muted} value={chatQuery} onChangeText={setChatQuery} />}
        <FlatList ref={chat} style={s.flex} data={rows} keyExtractor={item => item.key} renderItem={renderChat}
          keyboardShouldPersistTaps="handled" contentContainerStyle={s.timeline}
          onScroll={({nativeEvent: e}) => { nearEnd.current = e.contentSize.height - e.layoutMeasurement.height - e.contentOffset.y < 105; }}
          onContentSizeChange={() => { if (nearEnd.current && !chatQuery) chat.current?.scrollToEnd({animated: false}); }}
          onLayout={() => { if (nearEnd.current && !chatQuery) chat.current?.scrollToEnd({animated: false}); }}
          scrollEventThrottle={32}
          ListEmptyComponent={<View style={s.empty}>
            {chatQuery ? <Text style={s.section}>Nenhuma mensagem encontrada</Text> : <>
              <Icon name="chat" color="#57A0FF" size={28} />
              <Text style={s.emptyTitle}>Por onde começamos?</Text>
              <Text style={s.muted}>{state === 'online' ? 'Escreva uma mensagem ou adicione contexto das suas memórias.'
                : 'Explore as memórias ou deixe uma mensagem na fila para enviar quando o modelo estiver disponível.'}</Text>
            </>}
          </View>}
          ListFooterComponent={<View style={s.timelineFooter}>
            {suggestion && <View style={s.card}>
              <Text style={s.kicker}>IDEIA PARA REVISITAR</Text><Text style={s.text}>{suggestion.body}</Text>
              <Text style={s.muted}>Origem: memórias locais · {formatDate(suggestion.updated)}</Text>
              <View style={s.row}><Button label="Usar na conversa" onPress={() => void perform(async () => {
                await option('dismissed:' + suggestion.id, 'yes'); await audit(db, 'Sugestão aceita');
                useMemory(suggestion); await refresh(db);
              })} /><Button label="Dispensar" onPress={() => void perform(async () => {
                await option('dismissed:' + suggestion.id, 'yes'); await audit(db, 'Sugestão dispensada'); await refresh(db);
              })} /></View>
            </View>}
            {!!preference && <View style={s.card}>
              <Text style={s.section}>Guardar esta preferência?</Text>
              <Text style={s.text}>{preference}</Text>
              <View style={s.row}><Button label="Revisar e salvar" onPress={() => {
                newMemory('Preferência', preference); setPreference(undefined);
              }} /><Button label="Agora não" onPress={() => setPreference(undefined)} /></View>
            </View>}
            {!!context && <View style={s.card}>
              <Text style={s.kicker}>CONTEXTO DO PRÓXIMO ENVIO</Text>
              <Text style={s.text} selectable>{context}</Text>
              <Button label="Remover contexto" onPress={clearContext} />
            </View>}
          </View>} />
        <View style={s.bottom}>
          {menu && <View style={s.card}>
            <Text style={s.label}>Modelo do próximo envio</Text>
            <View style={s.row}>
              <Button label="Ollama" primary={route === 'local'} onPress={() => { setRoute('local'); setMenu(false); }} />
              <Button label="OpenAI · pago" primary={route === 'paid'} onPress={() => { setRoute('paid'); setMenu(false); }} />
              <Button label="Usar uma memória" onPress={() => go('Memórias')} />
            </View>
          </View>}
          {!keyboardOpen && <View style={s.shortcuts}>{shortcuts.map(item => <Pressable key={item.label} onPress={item.action}
            accessibilityRole="button" style={s.shortcut}>
            <Icon name={item.name} color="#4E9AFF" size={21} /><Text style={s.shortcutText}>{item.label}</Text>
          </Pressable>)}</View>}
          <View style={s.composer}>
            <IconButton name="plus" label={menu ? 'Fechar ações' : 'Mais ações'} onPress={() => setMenu(!menu)} />
            <TextInput style={[s.composeInput, {height: inputHeight}]} accessibilityLabel="Digite sua mensagem"
              placeholder="Digite sua mensagem…" placeholderTextColor={palette.muted} multiline maxLength={6000}
              value={prompt} onChangeText={setPrompt}
              onContentSizeChange={event => setInputHeight(Math.min(102, Math.max(43, event.nativeEvent.contentSize.height + 7)))} />
            <IconButton name="mic" label={listening ? 'Parar ditado' : 'Ditar'} onPress={() => listening ? voice?.stop() : void perform(dictate)} />
            <IconButton name="send" label={state === 'online' ? 'Preparar envio' : 'Adicionar à fila'}
              accent disabled={!prompt.trim()} onPress={() => void perform(queue)} />
          </View>
        </View>
      </View> : <ScrollView ref={panels} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
      {tab === 'Memórias' && <>
        <View style={s.pageHeading}><Text style={s.title}>Memórias</Text>
          <IconButton name="plus" label="Nova memória" accent onPress={() => newMemory('Experiência')} /></View>
        <TextInput accessibilityLabel="Buscar memórias no aparelho" placeholder="Buscar no aparelho"
          placeholderTextColor={palette.muted} style={s.input} value={query} onChangeText={setQuery} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.filterRow}>
          <Button label="Todas" primary={!filter} onPress={() => setFilter(undefined)} />
          {categories.map(category => <Button key={category} label={category}
            primary={category === filter} onPress={() => setFilter(category)} />)}
        </ScrollView>
        <View style={s.pageHeading}><Text style={s.muted}>{visibleMemories.length} {visibleMemories.length === 1 ? 'memória' : 'memórias'}</Text>
          <Button label={oldest ? 'Mais antigas' : 'Mais recentes'} onPress={() => setOldest(!oldest)} /></View>
        {editor && <View style={s.card}>
          <Text style={s.section}>{edit ? 'Editar memória' : 'Nova memória'}</Text>
          <View style={s.row}>{categories.map(category =>
            <Button key={category} label={category} primary={category === kind} onPress={() => setKind(category)} />)}</View>
          <Field label="Conteúdo" value={body} change={setBody} multiline />
          <View style={s.row}>
            <Button label={privateFlag ? 'Privada' : 'Disponível para uso autorizado'} onPress={() => setPrivateFlag(!privateFlag)} />
            <Button label="Salvar" primary disabled={!body.trim()} onPress={() => void perform(saveMemory)} />
            <Button label="Cancelar" onPress={() => { setEditor(false); setEdit(undefined); setBody(''); }} />
          </View>
        </View>}
        {!visibleMemories.length && !editor && <View style={s.empty}>
          <Icon name="layers" color="#57A0FF" size={29} />
          <Text style={s.section}>{query || filter ? 'Nenhuma memória encontrada' : 'Suas memórias aparecem aqui'}</Text>
        </View>}
        {visibleMemories.map(item => <View key={item.id} style={s.card}>
          <View style={s.memoryMeta}><Text style={s.kicker}>{item.kind}</Text>
            {!!item.private && <><Icon name="lock" size={14} /><Text style={s.muted}>Privada</Text></>}
            <Text style={s.muted}>{formatDate(item.updated)}</Text>
          </View>
          <Text style={s.text} selectable>{item.body}</Text>
          {item.version > 1 && <Text style={s.muted}>Versão {item.version}{revisions.filter(entry => entry.memory_id === item.id)
            .slice(0, 3).map(entry => ' · v' + entry.version + ' ' + formatDate(entry.changed)).join('')}</Text>}
          <View style={s.row}>
            <Button label="Editar" onPress={() => {
              setEdit(item); setBody(item.body); setKind(item.kind); setPrivateFlag(!!item.private); setEditor(true);
            }} />
            {!item.private && <Button label="Usar na conversa" onPress={() => useMemory(item)} />}
            <Button label="Excluir" onPress={() => confirm('Excluir memória?', 'A memória e o histórico local de alterações serão removidos.', () => removeMemory(item))} />
          </View>
        </View>)}
      </>}
      {tab === 'Laboratório' && <>
        <Text style={s.title}>Laboratório</Text>
        <View style={s.card}>
          <Text style={s.kicker}>EXPERIMENTO DISPONÍVEL</Text>
          <Text style={s.section}>Busca de memórias</Text>
          <Text style={s.muted}>A bateria compara a busca literal com a busca que tolera acentos e termos fora de ordem.</Text>
          <View style={s.row}>
            <Button label="Executar experimento" primary onPress={() => void perform(run)} />
            {version === 1 && !!chart[0] && eligible(chart[0]) &&
              <Button label="Aprovar busca v2" onPress={() => confirm('Ativar versão candidata?', 'A bateria será executada novamente antes da ativação.', activate)} />}
            {version === 2 && <Button label="Restaurar busca v1" onPress={() => void perform(async () => {
              await option('search', '1'); await audit(db, 'Busca v1 restaurada'); await refresh(db);
            })} />}
          </View>
        </View>
        <View style={s.card}>
          <Text style={s.section}>Árvore de habilidades</Text>
          <Text style={s.text}>Memórias · Disponível</Text>
          <Text style={s.muted}>↳ Busca v{version} · Em uso</Text>
          {version === 1 && <Text style={s.muted}>↳ Busca v2 · Experimental</Text>}
          <Text style={s.text}>Conversa · Gateway necessário</Text>
          <Text style={s.muted}>↳ Ollama e OpenAI · Integrações disponíveis</Text>
          <Text style={s.muted}>↳ Pesquisa autônoma · Não implementada</Text>
        </View>
        {!chart.length ? <View style={s.empty}>
          <Icon name="flask" color="#57A0FF" size={29} />
          <Text style={s.section}>Nenhum experimento executado</Text>
          <Text style={s.muted}>Faça a primeira execução para comparar as versões.</Text>
        </View> : <>
          <View style={s.card}><Text style={s.section}>Resultados medidos</Text>
            <Text style={s.muted}>{chart.length} {chart.length === 1 ? 'execução recente' : 'execuções recentes'} · média de {(chart.reduce((sum, run) => sum + run.ms, 0) / chart.length).toLocaleString('pt-BR', {maximumFractionDigits: 1})} ms</Text>
            {[0, 1].map(index => {
              const builds = chart.map(run => run.versions[index]).filter(Boolean);
              const passed = builds.reduce((sum, item) => sum + item.passed, 0);
              const total = builds.reduce((sum, item) => sum + item.cases.length, 0);
              const percent = total ? Math.round(100 * passed / total) : 0;
              return <View key={index}>
                <Text style={s.label}>Busca v{index + 1} · {percent}% · {passed}/{total} casos</Text>
                <View style={s.track}><View style={[s.bar, {width: `${percent}%`}]} /></View>
              </View>;
            })}
          </View>
          <Text style={s.section}>Histórico de execuções</Text>
          {chart.map(result => <View key={result.id} style={s.card}>
            <Text style={s.label}>{new Date(result.at).toLocaleString('pt-BR')} · {result.ms} ms</Text>
            {result.versions.map(build => <View key={build.version}>
              <Text style={s.text}>Busca v{build.version} · {build.passed}/{build.cases.length} casos</Text>
              <View style={s.track}><View style={[s.bar, {width: `${100 * build.passed / build.cases.length}%`}]} /></View>
              {build.cases.filter(check => check.actual !== check.expected).map(check =>
                <Text key={check.query} style={s.muted}>Falhou em “{check.query}”</Text>)}
            </View>)}
          </View>)}
        </>}
        {entries.some(entry => /Busca v[12]/.test(entry.event)) && <View style={s.card}>
          <Text style={s.section}>Histórico de ativações</Text>
          {entries.filter(entry => /Busca v[12]/.test(entry.event)).map(entry =>
            <Text key={entry.id} style={s.muted}>{formatDate(entry.created)} · {entry.event}</Text>)}
        </View>}
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
          <View style={s.row}>{[['Azul', palette.blueDark], ['Verde', '#BDEA9D'], ['Lavanda', '#CFB6FF'], ['Pêssego', '#FFC9AC']].map(([name, color]) =>
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
      </ScrollView>}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  screen: {flex: 1, backgroundColor: palette.base}, flex: {flex: 1},
  center: {justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20},
  header: {paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 10},
  headerCopy: {flex: 1}, brand: {color: palette.text, fontSize: 25, fontWeight: '700', letterSpacing: -.6},
  status: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3},
  statusDot: {height: 6, width: 6, borderRadius: 3, backgroundColor: '#8999B4'}, onlineDot: {backgroundColor: '#54CDA4'},
  tabs: {flexDirection: 'row', borderWidth: 1, borderColor: '#23354E', borderRadius: 23, padding: 4,
    marginHorizontal: 13, marginBottom: 8, backgroundColor: '#0C1420', gap: 2},
  tab: {flex: 1, minHeight: 55, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 18, paddingHorizontal: 2},
  selected: {backgroundColor: '#0D284D', borderWidth: 1, borderColor: '#24578F'},
  tabActive: {color: palette.text, fontWeight: '700', fontSize: 11, textAlign: 'center'},
  tabLabel: {color: palette.muted, fontWeight: '600', fontSize: 11, textAlign: 'center'},
  timeline: {paddingHorizontal: 15, paddingVertical: 12, width: '100%', maxWidth: 760, alignSelf: 'center', flexGrow: 1, gap: 13},
  timelineFooter: {gap: 10}, day: {flexDirection: 'row', alignItems: 'center', gap: 11, marginVertical: 5, paddingHorizontal: 25},
  rule: {flex: 1, height: 1, backgroundColor: '#1D365D'},
  dayText: {color: palette.muted, fontSize: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 14, paddingVertical: 4, paddingHorizontal: 12},
  messageRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 8},
  userRow: {justifyContent: 'flex-end'},
  bubble: {maxWidth: '87%', paddingTop: 11, paddingHorizontal: 13, paddingBottom: 3, borderRadius: 18, borderWidth: 1},
  assistantBubble: {backgroundColor: palette.assistant, borderColor: '#263649', borderTopLeftRadius: 7},
  userBubble: {backgroundColor: palette.user, borderColor: '#205694', borderTopRightRadius: 7},
  bubbleMeta: {flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5, flexWrap: 'wrap'},
  message: {color: palette.text, fontSize: 16, lineHeight: 23}, messageAction: {minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center'},
  inlineAction: {minHeight: 44, justifyContent: 'center'}, link: {color: '#A2CCFF', fontSize: 13, fontWeight: '600'},
  empty: {padding: 19, minHeight: 125, alignItems: 'center', justifyContent: 'center', gap: 10},
  emptyTitle: {color: palette.text, fontSize: 23, fontWeight: '700', letterSpacing: -.5, textAlign: 'center'},
  bottom: {gap: 9, paddingHorizontal: 12, paddingTop: 7, paddingBottom: 5, backgroundColor: '#080B12E8'},
  shortcuts: {flexDirection: 'row', gap: 6},
  shortcut: {flex: 1, minHeight: 52, padding: 4, gap: 4, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0C1726', borderRadius: 14, borderWidth: 1, borderColor: '#223650'},
  shortcutText: {color: '#C7D7ED', fontSize: 10, fontWeight: '600', textAlign: 'center'},
  composer: {flexDirection: 'row', gap: 5, alignItems: 'flex-end', padding: 5, borderWidth: 1, borderColor: '#284B75',
    borderRadius: 21, backgroundColor: '#0D1724'},
  composeInput: {flex: 1, minWidth: 40, color: palette.text, fontSize: 16, paddingHorizontal: 3,
    paddingTop: 10, paddingBottom: 8, textAlignVertical: 'top'},
  search: {marginHorizontal: 15, marginBottom: 4},
  content: {padding: 16, paddingBottom: 30, gap: 14, width: '100%', maxWidth: 760, alignSelf: 'center'},
  pageHeading: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8},
  filterRow: {gap: 7, paddingBottom: 2},
  title: {color: palette.text, fontSize: 31, fontWeight: '700', letterSpacing: -.8},
  section: {color: palette.text, fontSize: 18, fontWeight: '700'},
  text: {color: palette.text, fontSize: 15, lineHeight: 22},
  muted: {color: palette.muted, fontSize: 12, lineHeight: 18},
  label: {color: '#C6D4E8', fontSize: 13, fontWeight: '600'},
  kicker: {color: '#88B9FF', fontSize: 11, fontWeight: '700', letterSpacing: .6},
  memoryMeta: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8},
  card: {padding: 14, borderRadius: 17, gap: 9, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.panel},
  field: {gap: 7},
  input: {color: palette.text, borderColor: palette.border, borderWidth: 1, borderRadius: 13,
    padding: 11, backgroundColor: '#0D1420', minHeight: 46, fontSize: 16},
  multiline: {minHeight: 95, textAlignVertical: 'top'},
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 6},
  button: {minHeight: 44, paddingVertical: 8, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 12,
    backgroundColor: '#162335', borderWidth: 1, borderColor: '#26394F'},
  primary: {backgroundColor: '#1B62C1', borderColor: '#3387FB'},
  disabled: {opacity: .46},
  buttonText: {color: '#DDE8F8', fontSize: 12, fontWeight: '600'},
  primaryText: {color: palette.text},
  notice: {color: '#F7DCAC', backgroundColor: '#2C241B', marginHorizontal: 15, marginBottom: 4, padding: 10, borderRadius: 9},
  track: {height: 7, backgroundColor: '#263247', borderRadius: 7, marginVertical: 7},
  bar: {height: 7, borderRadius: 7, backgroundColor: palette.blue},
});
