import React,{useEffect,useRef,useState} from 'react';
import {Pressable,Share,StyleSheet,Text,TextInput,View} from 'react-native';
import {randomUUID} from 'expo-crypto';
import * as Clipboard from 'expo-clipboard';
import type {SQLiteDatabase} from 'expo-sqlite';
import {palette} from './visual';
import {buildPrompt,decodeProfiles,emptyProfile,saveProfile,type ProjectProfile,type FactoryMode,type FactorySession} from './factory';

const fields=[['name','Nome do projeto'],['purpose','Objetivo e público'],['visual','Cores, tipografia e identidade visual'],['preferences','Preferências de UX e tecnologia'],['constraints','Restrições e dados a preservar'],['criteria','Critérios de qualidade específicos']] as const;

export function FactoryPanel({db,session}:{db:SQLiteDatabase;session:FactorySession}){
  const [list,setList]=useState<ProjectProfile[]>([]);
  const [profile,setProfile]=useState<ProjectProfile|undefined>(()=>session.selected?session.drafts[session.selected]?.profile:undefined);
  const [request,setRequest]=useState(()=>session.selected?session.drafts[session.selected]?.request??'':'');
  const [mode,setMode]=useState<FactoryMode>(()=>session.selected?session.drafts[session.selected]?.mode??'new':'new');
  const [prompt,setPrompt]=useState('');
  const [notice,setNotice]=useState('');
  const [ready,setReady]=useState(false);
  const [busy,setBusy]=useState(false);
  const lock=useRef(false);
  useEffect(()=>{
    let active=true;
    void (async()=>{
      try{
        await db.execAsync('CREATE TABLE IF NOT EXISTS nexus_factory_profiles_v1 (id INTEGER PRIMARY KEY CHECK(id=1), record TEXT NOT NULL)');
        const row=await db.getFirstAsync<{record:string}>('SELECT record FROM nexus_factory_profiles_v1 WHERE id=1');
        const saved=decodeProfiles(row?.record??null);
        if(active){setList(saved);setReady(true);}
      }catch(e){if(active)setNotice(e instanceof Error?e.message:'Não foi possível carregar perfis.');}
    })();
    return()=>{active=false;};
  },[db]);
  function remember(next:ProjectProfile,ask:string,kind:FactoryMode){
    session.selected=next.id;session.drafts[next.id]={profile:{...next},request:ask,mode:kind};
  }
  const select=(value:ProjectProfile)=>{
    if(lock.current)return;
    const draft=session.drafts[value.id]??{profile:value,request:'',mode:'new' as FactoryMode};
    remember(draft.profile,draft.request,draft.mode);
    setProfile({...draft.profile});setRequest(draft.request);setMode(draft.mode);setPrompt('');setNotice('');
  };
  function edit(next:ProjectProfile,ask=request,kind=mode){
    remember(next,ask,kind);setProfile(next);setRequest(ask);setMode(kind);setPrompt('');
  }
  async function save(){
    if(!profile||!ready||lock.current)return;
    lock.current=true;setBusy(true);
    try{
      const next=saveProfile(list,profile);
      await db.runAsync('INSERT INTO nexus_factory_profiles_v1 (id,record) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record',JSON.stringify(next));
      setList(next);setNotice('Perfil salvo neste aparelho.');
    }catch(e){setNotice(e instanceof Error?e.message:'Falha ao salvar perfil.');}
    finally{lock.current=false;setBusy(false);}
  }
  async function generate(){
    if(!profile||!ready||lock.current)return;
    try{setPrompt(buildPrompt(profile,request,mode));setNotice('Briefing preparado. Revise antes de compartilhar.');}
    catch(e){setPrompt('');setNotice(e instanceof Error?e.message:'Falha ao gerar briefing.');}
  }
  const action=(label:string,onPress:()=>void,disabled=false)=><Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} style={[s.button,disabled&&{opacity:.5}]} onPress={onPress}><Text style={s.link}>{label}</Text></Pressable>;
  return <View style={s.card}>
    <Text style={s.title}>NEXUS Factory</Text>
    <Text style={s.muted}>Crie um perfil por projeto. Reutilize sua identidade e regras sem misturar marcas.</Text>
    {notice?<Text accessibilityLiveRegion="polite" style={s.muted}>{notice}</Text>:null}
    {!ready?<Text style={s.muted}>Perfis locais indisponíveis ou carregando.</Text>:<>
      <View style={s.row}>{[...list,...Object.values(session.drafts).map(d=>d.profile).filter(d=>!list.some(p=>p.id===d.id))].map(item=><View key={item.id}>{action(item.name||'Novo projeto (rascunho)',()=>select(item),busy)}</View>)}</View>
      {action('Novo projeto',()=>select(emptyProfile(randomUUID())),busy||new Set([...list.map(p=>p.id),...Object.keys(session.drafts)]).size>=30)}
      {profile&&<>
        <Text style={s.title}>O que vamos fazer?</Text>
        <View style={s.row}>{action((mode==='new'?'✓ ':'')+'Criar projeto',()=>edit(profile,request,'new'),busy)}
        {action((mode==='change'?'✓ ':'')+'Laboratório de alterações',()=>edit(profile,request,'change'),busy)}</View>
        <Text style={s.muted}>{mode==='change'?'O briefing exige uma versão isolada e comparação antes/depois.':'O briefing expande seu pedido em uma proposta completa.'} Você decide o design e aprova o resultado final.</Text>
        <TextInput accessibilityLabel="Pedido atual" value={request} editable={!busy} multiline maxLength={2000} style={s.input}
          onChangeText={value=>edit(profile,value)}/>
        {fields.map(([key,label])=><View key={key}><Text style={s.muted}>{label}</Text>
          <TextInput accessibilityLabel={label} value={profile[key]} editable={!busy} multiline={key!=='name'} maxLength={key==='name'?80:1600}
            style={s.input} onChangeText={value=>edit({...profile,[key]:value})}/>
        </View>)}
        {action('Salvar perfil do projeto',()=>void save(),busy)}
        {action('Preparar briefing',()=>void generate(),busy||!request.trim())}
        {prompt!==''&&<>
          <Text selectable style={s.muted}>{prompt}</Text>
          {action('Copiar briefing',()=>void Clipboard.setStringAsync(prompt).then(()=>setNotice('Briefing copiado.')).catch(()=>setNotice('Não foi possível copiar.')))}
          {action('Compartilhar briefing',()=>void Share.share({message:prompt}).catch(()=>setNotice('Não foi possível compartilhar.')))}
        </>}
        <Text style={s.muted}>Perfis salvos apenas neste aparelho. Rascunhos sobrevivem à troca de aba durante a sessão, mas não ao encerramento do app. O briefing não inicia o Codex nem envia informações automaticamente. Registre a versão acordada no repositório.</Text>
      </>}
    </>}
  </View>;
}
const s=StyleSheet.create({
  card:{padding:14,gap:10,borderRadius:16,backgroundColor:palette.panel,borderColor:palette.border,borderWidth:1},
  title:{color:palette.text,fontSize:17,fontWeight:'700'},
  muted:{color:palette.muted,fontSize:13,lineHeight:19},
  link:{color:'#AAD0FF',fontSize:14,fontWeight:'600'},
  button:{minHeight:44,justifyContent:'center',padding:10,borderRadius:9,borderWidth:1,borderColor:palette.border},
  input:{minHeight:44,color:palette.text,borderColor:palette.border,borderWidth:1,borderRadius:9,padding:8},
  row:{flexDirection:'row',flexWrap:'wrap',gap:8},
});
