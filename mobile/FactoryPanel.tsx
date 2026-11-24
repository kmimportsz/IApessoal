import React,{useEffect,useRef,useState} from 'react';
import {Pressable,Share,StyleSheet,Text,TextInput,View} from 'react-native';
import {randomUUID} from 'expo-crypto';
import * as Clipboard from 'expo-clipboard';
import type {SQLiteDatabase} from 'expo-sqlite';
import {palette} from './visual';
import {buildPrompt,quickProfile,decodeProfiles,emptyProfile,saveProfile,designPalettes,validPalette,addLesson,type DesignPalette,type ProjectLesson,type ProjectProfile,type FactoryMode,type FactorySession} from './factory';

const fields=[['name','Nome do projeto'],['purpose','Objetivo e público'],['visual','Cores, tipografia e identidade visual'],['preferences','Preferências de UX e tecnologia'],['constraints','Restrições e dados a preservar'],['criteria','Critérios de qualidade específicos']] as const;

export function FactoryPanel({db,session}:{db:SQLiteDatabase;session:FactorySession}){
  const [list,setList]=useState<ProjectProfile[]>([]);
  const [profile,setProfile]=useState<ProjectProfile|undefined>(()=>session.selected?session.drafts[session.selected]?.profile:undefined);
  const [request,setRequest]=useState(()=>session.selected?session.drafts[session.selected]?.request??'':'');
  const [mode,setMode]=useState<FactoryMode>(()=>session.selected?session.drafts[session.selected]?.mode??'new':'new');
  const [prompt,setPrompt]=useState('');
  const [advanced,setAdvanced]=useState(false);
  const [projectsOpen,setProjectsOpen]=useState(false);
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
  const atCapacity=()=>new Set([...list.map(p=>p.id),...Object.keys(session.drafts)]).size>=30;
  const creationBlocked=!profile&&atCapacity();
  function newDraft(){
    if(atCapacity()){setNotice('Limite de 30 projetos. Selecione um projeto existente.');return undefined;}
    return emptyProfile(randomUUID());
  }
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
    if(!ready||lock.current)return;
    try{
      const current=profile??newDraft();
      if(!current)return;
      const prepared=quickProfile(current,request,mode);
      edit(prepared);setPrompt(buildPrompt(prepared,request,mode));
      setNotice('Briefing provisório preparado. Confira antes de compartilhar.');
    }
    catch(e){setPrompt('');setNotice(e instanceof Error?e.message:'Falha ao gerar briefing.');}
  }
  const action=(label:string,onPress:()=>void,disabled=false)=><Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} style={[s.button,disabled&&{opacity:.5}]} onPress={onPress}><Text style={s.link}>{label}</Text></Pressable>;
  return <View style={s.card}>
    <Text style={s.title}>NEXUS Factory</Text>
    <Text style={s.muted}>Uma ideia é suficiente para começar.</Text>
    {notice?<Text accessibilityLiveRegion="polite" style={s.muted}>{notice}</Text>:null}
    {!ready?<Text style={s.muted}>Perfis locais indisponíveis ou carregando.</Text>:<>
      <View style={s.row}>
        {action((mode==='new'?'✓ ':'')+'Criar projeto',()=>{if(profile)edit(profile,request,'new');else setMode('new');},busy)}
        {action((mode==='change'?'✓ ':'')+'Alterar projeto',()=>{if(profile)edit(profile,request,'change');else setMode('change');setProjectsOpen(true);},busy)}
      </View>
      <Text style={s.muted}>{profile?.name|| (mode==='change'?'Selecione um projeto existente.':'Novo projeto')}</Text>
      {action(projectsOpen?'Ocultar projetos':'Trocar projeto',()=>setProjectsOpen(!projectsOpen),busy)}
      {projectsOpen&&<>
        <View style={s.row}>{[...list,...Object.values(session.drafts).map(d=>d.profile).filter(d=>!list.some(p=>p.id===d.id))].map(item=><View key={item.id}>{action(item.name||'Novo projeto (rascunho)',()=>{select(item);if(mode==='change'){const d=session.drafts[item.id];remember(d.profile,d.request,'change');setMode('change');}setProjectsOpen(false);},busy)}</View>)}</View>
        {action('Novo projeto em branco',()=>{const draft=newDraft();if(draft){select(draft);setMode('new');setProjectsOpen(false);}},busy||atCapacity())}
      </>}
      {creationBlocked&&<Text accessibilityRole="alert" style={s.muted}>Limite de 30 projetos. Selecione um projeto existente para continuar.</Text>}
      <Text style={s.title}>O que você quer criar ou melhorar?</Text>
      <TextInput accessibilityLabel="Pedido atual" placeholder="Ex.: Quero um sistema de agendamento para meus clientes." placeholderTextColor={palette.muted} value={request} editable={!busy&&!creationBlocked} multiline maxLength={2000} style={[s.input,{minHeight:92}]}
        onChangeText={value=>{if(profile)edit(profile,value);else {const draft=newDraft();if(draft)edit(draft,value,mode);}}}/>
      <Pressable accessibilityRole="button" accessibilityState={{disabled:busy||creationBlocked||!request.trim()}} disabled={busy||creationBlocked||!request.trim()} style={[s.primary,(busy||creationBlocked||!request.trim())&&{opacity:.5}]} onPress={()=>void generate()}><Text style={s.primaryText}>Preparar briefing</Text></Pressable>
      <Text style={s.muted}>Você aprova o design e a entrega. Esta etapa prepara o pedido; não inicia a execução das IAs.</Text>
      {prompt!==''&&<>
        <Text style={s.title}>Briefing pronto para revisão</Text>
        <Text selectable style={s.muted}>{prompt}</Text>
        {action('Copiar briefing',()=>void Clipboard.setStringAsync(prompt).then(()=>setNotice('Briefing copiado.')).catch(()=>setNotice('Não foi possível copiar.')))}
        {action('Compartilhar briefing',()=>void Share.share({message:prompt}).catch(()=>setNotice('Não foi possível compartilhar.')))}
      </>}
      {profile&&<>
        {action(advanced?'Ocultar detalhes':'Identidade e opções avançadas',()=>setAdvanced(!advanced),busy)}
        {advanced&&<>
          {fields.map(([key,label])=><View key={key}><Text style={s.muted}>{label}</Text>
            <TextInput accessibilityLabel={label} value={profile[key]} editable={!busy} multiline={key!=='name'} maxLength={key==='name'?80:1600}
              style={s.input} onChangeText={value=>edit({...profile,[key]:value})}/>
          </View>)}
          <CreativeTools key={profile.id} profile={profile} busy={busy} onChange={value=>edit(value)}/>
        </>}
        {action('Salvar perfil do projeto',()=>void save(),busy)}
      </>}
      <Text style={s.muted}>Perfis salvos neste aparelho. Rascunhos são mantidos durante a sessão. A identidade existente não será substituída automaticamente.</Text>
    </>}
  </View>;
}
function CreativeTools({profile,busy,onChange}:{profile:ProjectProfile;busy:boolean;onChange:(p:ProjectProfile)=>void}){
  const [studio,setStudio]=useState(false);
  const [knowledge,setKnowledge]=useState(false);
  const [candidate,setCandidate]=useState<DesignPalette>(profile.design??designPalettes[0].palette);
  const [lesson,setLesson]=useState<ProjectLesson>({observation:'',action:'',reference:''});
  const [notice,setNotice]=useState('');
  const control=(label:string,press:()=>void,disabled=busy)=><Pressable key={label} accessibilityRole="button" disabled={disabled} style={[s.button,disabled&&{opacity:.5}]} onPress={press}><Text style={s.link}>{label}</Text></Pressable>;
  const input=(label:string,value:string,change:(v:string)=>void,max=240)=><TextInput accessibilityLabel={label} placeholder={label} placeholderTextColor={palette.muted} value={value} onChangeText={change} editable={!busy} maxLength={max} style={s.input}/>;
  return <View style={s.card}>
    {control(studio?'Fechar Design Studio':'Design Studio · avaliar identidade',()=>setStudio(!studio))}
    {studio&&<>
      <Text style={s.muted}>Propostas provisórias. Escolha uma paleta ou personalize as cores. A decisão final de layout é sua.</Text>
      <View style={s.row}>{designPalettes.map(item=>control(item.name,()=>setCandidate({...item.palette})))}</View>
      {([['background','Fundo'],['accent','Destaque'],['text','Texto']] as const).map(([key,label])=><View key={key}><Text style={s.muted}>{label} (#RRGGBB)</Text>{input(label,candidate[key],v=>setCandidate(p=>({...p,[key]:v})),7)}</View>)}
      {validPalette(candidate)&&<View accessibilityLabel="Prévia ilustrativa de paleta" style={{backgroundColor:candidate.background,borderColor:candidate.accent,borderWidth:1,padding:16,borderRadius:12,gap:10}}>
        <Text style={{color:candidate.text,fontSize:20,fontWeight:'700'}}>{profile.name||'Seu projeto'}</Text>
        <Text style={{color:candidate.text}}>Exemplo de título, texto e destaque visual.</Text>
        <View style={{backgroundColor:candidate.accent,padding:8,borderRadius:8}}><Text style={{color:candidate.background,fontWeight:'700'}}>Ação de exemplo</Text></View>
      </View>}
      {control('Selecionar proposta no briefing',()=>onChange({...profile,design:{...candidate}}),busy||!validPalette(candidate))}
      {profile.design&&<Text style={s.muted}>Proposta selecionada: {profile.design.background} / {profile.design.accent} / {profile.design.text}. Salve o perfil para preservar.</Text>}
      {profile.design&&control('Retirar proposta',()=>onChange({...profile,design:undefined}))}
    </>}
    {control(knowledge?'Fechar Knowledge Core':'Knowledge Core · lições do projeto',()=>setKnowledge(!knowledge))}
    {knowledge&&<>
      <Text style={s.muted}>Registre erros e soluções com fonte. As lições deste projeto entrarão nos próximos briefings; não são provas verificadas automaticamente.</Text>
      {(profile.lessons??[]).map((item,i)=><View key={i} style={s.card}><Text style={s.muted}>{item.observation}</Text><Text style={s.muted}>Ação: {item.action}</Text><Text selectable style={s.muted}>{item.reference}</Text>{control('Retirar lição '+(i+1),()=>onChange({...profile,lessons:(profile.lessons??[]).filter((_,j)=>i!==j)}))}</View>)}
      {input('O que aprendemos?',lesson.observation,v=>setLesson(p=>({...p,observation:v})))}
      {input('Como evitar ou repetir?',lesson.action,v=>setLesson(p=>({...p,action:v})))}
      {input('Referência HTTPS',lesson.reference,v=>setLesson(p=>({...p,reference:v})),300)}
      {control('Adicionar lição ao perfil',()=>{try{onChange(addLesson(profile,lesson));setLesson({observation:'',action:'',reference:''});setNotice('Lição adicionada. Salve o perfil.');}catch(e){setNotice(e instanceof Error?e.message:'Não foi possível adicionar.');}},busy||(profile.lessons?.length??0)>=10)}
      {!!notice&&<Text accessibilityLiveRegion="polite" style={s.muted}>{notice}</Text>}
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
  primary:{minHeight:50,justifyContent:'center',alignItems:'center',backgroundColor:'#1B62C1',padding:12,borderRadius:12},
  primaryText:{color:'#FFFFFF',fontSize:16,fontWeight:'700'},
});
