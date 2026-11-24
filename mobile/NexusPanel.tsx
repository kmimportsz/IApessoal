import React,{useState} from 'react';
import {Pressable,Share,StyleSheet,Text,TextInput,View} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {palette} from './visual';

type Mission={id:string;repository:string;status:string;revision:string|null;iteration:number;brief:{maxIterations:number;objective:string}};
type Detail={mission:Mission;version:number;events:{id:string;type:string;status:string;at:number;reason?:string}[];
  review:{gate:{blockers:{axis:string;reason:string}[]};status:string}};
const dimensions=['navegação','clareza','design','responsividade','acessibilidade','tarefas principais'];

export function NexusPanel({request}:{request:(path:string,data?:unknown)=>Promise<Response>}) {
  const [missions,setMissions]=useState<Mission[]>();
  const [detail,setDetail]=useState<Detail>();
  const [brief,setBrief]=useState('');
  const [payload,setPayload]=useState('');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  async function api(path:string,data?:unknown) {
    const response=await request(path,data);
    const value=await response.json();
    if(!response.ok)throw Error(value.error??'NEXUS indisponível.');
    return value;
  }
  async function run(action:()=>Promise<void>) {
    if(busy)return;
    setBusy(true);setNotice('');
    try {await action();} catch(error){setNotice(error instanceof Error?error.message:'A operação falhou.');}
    finally {setBusy(false);}
  }
  async function open(id:string) {setDetail(await api('/nexus/missions/'+id));}
  async function event(type:string,value?:unknown) {
    if(!detail)return;
    await api('/nexus/missions/'+detail.mission.id+'/events',{id:randomUUID(),type,version:detail.version,payload:value});
    await open(detail.mission.id);
  }
  function button(label:string,onPress:()=>void) {
    return <Pressable key={label} accessibilityRole="button" disabled={busy} style={s.button} onPress={onPress}><Text style={s.link}>{label}</Text></Pressable>;
  }
  const state=detail?.mission.status;
  const review=state==='AI_AUDIT'||state==='EVIDENCE_MISSING'||state==='READY_FOR_OWNER'||state==='CHANGES_REQUIRED';
  return <View style={s.card}>
    <Text style={s.title}>NEXUS · Missões de engenharia</Text>
    <Text style={s.muted}>A Diretora avalia as evidências. A passagem para ChatGPT e Codex é manual.</Text>
    {button('Consultar missões',()=>void run(async()=>setMissions((await api('/nexus/missions')).missions)))}
    {(busy||notice)&&<Text accessibilityLiveRegion="polite" style={s.muted}>{busy?'Consultando…':notice}</Text>}
    {missions && <>
      {missions.map(m=>button(m.repository+' · '+m.status,()=>void run(()=>open(m.id))))}
      <Text style={s.muted}>Cole o brief JSON acordado no Issue e no PR.</Text>
      <TextInput accessibilityLabel="Brief JSON da missão" multiline value={brief} onChangeText={setBrief} autoCapitalize="none" style={s.input}/>
      {button('Importar brief',()=>void run(async()=>{
        const result=await api('/nexus/missions',JSON.parse(brief));
        setBrief('');await open(result.mission.id);setMissions((await api('/nexus/missions')).missions);
      }))}
    </>}
    {detail && <>
      <Text style={s.title}>{detail.mission.repository}</Text>
      <Text style={s.muted}>{detail.mission.brief.objective}</Text>
      <Text selectable style={s.muted}>{detail.mission.id} · {state} · {detail.mission.iteration}/{detail.mission.brief.maxIterations}</Text>
      <Text selectable style={s.muted}>Commit {detail.mission.revision??'aguardando verificação do PR'}</Text>
      {detail.review.gate.blockers.map(item=><Text key={item.axis+item.reason} style={s.muted}>{item.reason}</Text>)}
      {state==='IDEA'&&button('Confirmar especificação',()=>void run(()=>event('spec_ready')))}
      {['SPEC_READY','CHANGES_REQUIRED'].includes(state??'')&&button('Registrar início da implementação',()=>void run(()=>event('start')))}
      {['IMPLEMENTING','CI_PENDING','AI_AUDIT','EVIDENCE_MISSING','READY_FOR_OWNER'].includes(state??'')&&
        button('Conferir Issue, PR e CI',()=>void run(()=>event('sync')))}
      {review&&<>
        <Text style={s.muted}>Teste de Realidade. Examine navegação, clareza, design, responsividade, acessibilidade e conclusão das tarefas. Registre provas funcionais e visuais.</Text>
        <View style={s.row}>
          {button('Modelo de evidência UX',()=>setPayload(JSON.stringify({axis:'experience',commit:detail.mission.revision,status:'passed',
            url:'',functionalUrl:'',visualUrl:'',dimensions,reason:''},null,2)))}
          {button('Modelo de pedido de correção',()=>setPayload(JSON.stringify({commit:detail.mission.revision,priority:'P1',
            location:'',why:'',expected:'',test:'',url:''},null,2)))}
        </View>
        <TextInput accessibilityLabel="Registro JSON de evidência ou revisão" multiline value={payload} onChangeText={setPayload} autoCapitalize="none" style={s.input}/>
        {state!=='CHANGES_REQUIRED'&&button('Atestar evidência examinada',()=>void run(()=>event('attest',JSON.parse(payload))))}
        {button('Registrar pedido de correção',()=>void run(()=>event('revision_request',JSON.parse(payload))))}
      </>}
      {['AI_AUDIT','EVIDENCE_MISSING','READY_FOR_OWNER'].includes(state??'')&&
        button('Executar avaliação da Diretora',()=>void run(()=>event('audit')))}
      {state==='IMPLEMENTING'&&button('Vincular número do PR digitado',()=>void run(()=>event('link_pr',{pr:Number(payload)})))}
      {!['OWNER_APPROVED','CANCELLED','FAILED','PAUSED'].includes(state??'')&&<>
        {!review&&<TextInput accessibilityLabel="Número do PR ou decisão da missão" value={payload} onChangeText={setPayload} style={s.input}/>}
        {button('Registrar decisão digitada',()=>void run(()=>event('decision',{reason:payload})))}
        {button('Pausar com motivo digitado',()=>void run(()=>event('pause',{reason:payload})))}
      </>}
      {state==='READY_FOR_OWNER'&&button('Registrar minha aprovação',()=>void run(()=>event('approve',{commit:detail.mission.revision})))}
      {button('Compartilhar relatório da Diretora',()=>void run(async()=>{await Share.share({message:JSON.stringify(detail.review,null,2)});}))}
      {detail.events.map(item=><Text key={item.id} style={s.muted}>{new Date(item.at).toLocaleString('pt-BR')} · {item.type} · {item.status}{item.reason?' · '+item.reason:''}</Text>)}
    </>}
  </View>;
}
const s=StyleSheet.create({
  card:{padding:14,gap:8,borderRadius:16,backgroundColor:palette.panel,borderColor:palette.border,borderWidth:1},
  title:{color:palette.text,fontSize:17,fontWeight:'700'},
  muted:{color:palette.muted,fontSize:13,lineHeight:19},
  link:{color:'#AAD0FF',fontSize:14,fontWeight:'600'},
  button:{minHeight:44,justifyContent:'center',paddingHorizontal:9,borderRadius:9,borderWidth:1,borderColor:palette.border},
  input:{minHeight:90,color:palette.text,borderColor:palette.border,borderWidth:1,borderRadius:9,padding:8},
  row:{flexDirection:'row',flexWrap:'wrap',gap:6},
});
