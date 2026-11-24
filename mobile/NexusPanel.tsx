import React,{useState} from 'react';
import {Alert,Linking,Pressable,Share,StyleSheet,Text,TextInput,View} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {palette} from './visual';

type Mission={id:string;repository:string;status:string;revision:string|null;iteration:number;brief:{maxIterations:number;objective:string;criteria:{id:string;description:string}[]}};
type Detail={mission:Mission;version:number;events:{id:string;type:string;status:string;at:number;reason?:string}[];
  review:{gate:{blockers:{axis:string;reason:string}[]};status:string;correctionPackage?:object;
    director?:{commit:string;verified:{text:string;url:string}[];hypotheses:{text:string}[];limits:string[];
      requests:{location:string;why:string;test:string}[];model?:{state:string;neurons?:number;observations?:{path:string;line:number;problem:string;verification:string}[]}}}};
const axes=[['objective','Objetivo'],['correctness','Funcionamento'],['experience','Experiência'],
  ['security','Segurança'],['resilience','Resiliência'],['delivery','Entrega']];
const dimensions=['navegação','clareza','design','responsividade','acessibilidade','tarefas principais'];

export function NexusPanel({request}:{request:(path:string,data?:unknown)=>Promise<Response>}) {
  const [missions,setMissions]=useState<Mission[]>();
  const [detail,setDetail]=useState<Detail>();
  const [brief,setBrief]=useState('');
  const [payload,setPayload]=useState('');
  const [form,setForm]=useState<'evidence'|'revision'>();
  const [fields,setFields]=useState<Record<string,string>>({});
  const [ux,setUx]=useState<string[]>([]);
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
  function input(key:string,label:string) {
    return <TextInput key={key} accessibilityLabel={label} placeholder={label} placeholderTextColor={palette.muted}
      style={s.field} value={fields[key]??''} onChangeText={value=>setFields(current=>({...current,[key]:value}))}/>;
  }
  function chooseForm(value:'evidence'|'revision') {
    setForm(value);setFields(value==='evidence'?{axis:'experience',status:'passed'}:{priority:'P1'});setUx([]);
  }
  function evidenceLink(item:{url:string;text:string}) {
    return <Pressable accessibilityRole="link" key={item.text} style={s.button}
      onPress={()=>void run(async()=>{await Linking.openURL(item.url);})}><Text style={s.link}>{item.text}</Text></Pressable>;
  }
  const state=detail?.mission.status;
  const review=state==='AI_AUDIT'||state==='EVIDENCE_MISSING'||state==='READY_FOR_OWNER'||state==='CHANGES_REQUIRED';
  return <View style={s.card}>
    <Text style={s.title}>NEXUS · Missões de engenharia</Text>
    <Text style={s.muted}>A Diretora avalia as evidências. A passagem para ChatGPT e Codex é manual.</Text>
    {button('Consultar missões',()=>void run(async()=>setMissions((await api('/nexus/missions')).missions)))}
    {(busy||notice)&&<Text accessibilityLiveRegion="polite" style={s.muted}>{busy?'Consultando…':notice}</Text>}
    {missions && <>
      {missions.map(m=><View key={m.id}>{button(m.repository+' · '+m.status,()=>void run(async()=>{setForm(undefined);await open(m.id);}))}</View>)}
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
      {detail.review.director&&<View style={s.card}>
        <Text style={s.title}>Relatório da Diretora</Text>
        <Text style={s.muted}>Commit {detail.review.director.commit.slice(0,12)}</Text>
        <Text style={s.title}>Evidências verificadas</Text>
        {detail.review.director.verified.map(evidenceLink)}
        <Text style={s.title}>Pontos a investigar</Text>
        {detail.review.director.hypotheses.length?detail.review.director.hypotheses.map(item=>
          <Text key={item.text} style={s.muted}>{item.text}</Text>):<Text style={s.muted}>Nenhuma hipótese levantada na amostra.</Text>}
        {detail.review.director.requests.map(item=><View key={item.location}>
          <Text style={s.title}>{item.location}</Text><Text style={s.muted}>{item.why} {item.test}</Text>
        </View>)}
        {detail.review.director.limits.map(item=><Text key={item} style={s.muted}>{item}</Text>)}
        {!!detail.review.director.model&&detail.review.director.model.state!=='not_requested'&&<>
          <Text style={s.title}>Hipóteses da revisão assistida</Text>
          {detail.review.director.model.state==='completed'?<>
            <Text style={s.muted}>Consumo registrado · {detail.review.director.model.neurons} Neurons</Text>
            {detail.review.director.model.observations?.map((item,index)=><View key={index}>
              <Text style={s.title}>{item.path}:{item.line}</Text>
              <Text style={s.muted}>{item.problem} Verificação proposta: {item.verification}</Text>
            </View>)}
            {!detail.review.director.model.observations?.length&&<Text style={s.muted}>Nenhuma hipótese citável na amostra.</Text>}
          </>:<Text style={s.muted}>{({quota:'Limite da revisão assistida atingido.',no_sample:'Sem amostras elegíveis.',
            already_run:'Já existe uma tentativa neste commit.',unavailable:'Revisão assistida indisponível.'} as Record<string,string>)[detail.review.director.model.state]}</Text>}
        </>}
      </View>}
      {review&&<>
        <View style={s.row}>
          {state!=='CHANGES_REQUIRED'&&button('Registrar prova externa',()=>chooseForm('evidence'))}
          {button('Adicionar correção',()=>chooseForm('revision'))}
        </View>
        {form==='evidence'&&state!=='CHANGES_REQUIRED'&&<>
          <Text style={s.title}>Tipo de evidência</Text>
          <View style={s.row}>{[...axes,...detail.mission.brief.criteria.map(c=>['criterion:'+c.id,c.description])].map(([id,label])=>
            button((fields.axis===id?'✓ ':'')+label,()=>setFields({...fields,axis:id})))}</View>
          <View style={s.row}>
            {button((fields.status==='passed'?'✓ ':'')+'Passou',()=>setFields({...fields,status:'passed'}))}
            {button((fields.status==='failed'?'✓ ':'')+'Falhou',()=>setFields({...fields,status:'failed'}))}
          </View>
          {input('url','Link da evidência')}
          {input('reason','Resultado observado e justificativa')}
          {fields.axis==='experience'&&<>
            {input('functionalUrl','Link do teste funcional')}
            {input('visualUrl','Link da evidência visual')}
            <Text style={s.muted}>Marque as dimensões que você conferiu.</Text>
            <View style={s.row}>{dimensions.map(value=>button((ux.includes(value)?'✓ ':'')+value,
              ()=>setUx(current=>current.includes(value)?current.filter(item=>item!==value):[...current,value])))}</View>
          </>}
          {button('Salvar evidência',()=>void run(async()=>{
            const axis=fields.axis??'experience';
            await event('attest',{commit:detail.mission.revision,status:fields.status,url:fields.url,reason:fields.reason,
              ...(axis.startsWith('criterion:')?{criterion:axis.slice(10)}:{axis}),
              ...(axis==='experience'?{functionalUrl:fields.functionalUrl,visualUrl:fields.visualUrl,dimensions:ux}:{})});
            setForm(undefined);
          }))}
        </>}
        {form==='revision'&&<>
          <View style={s.row}>{['P0','P1','P2'].map(priority=>
            button((fields.priority===priority?'✓ ':'')+priority,()=>setFields({...fields,priority})))}</View>
          {input('location','Local da falha')}{input('why','Motivo da correção')}{input('expected','Resultado esperado')}
          {input('test','Teste que confirma a correção')}{input('url','Link da evidência')}
          {button('Salvar pedido de correção',()=>void run(async()=>{
            await event('revision_request',{...fields,commit:detail.mission.revision});setForm(undefined);
          }))}
        </>}
      </>}
      {['AI_AUDIT','EVIDENCE_MISSING','READY_FOR_OWNER'].includes(state??'')&&
        button('Investigar PR e gerar relatório',()=>void run(()=>event('audit')))}
      {['AI_AUDIT','EVIDENCE_MISSING','READY_FOR_OWNER'].includes(state??'')&&
        button('Investigar com revisão assistida',()=>Alert.alert('Enviar amostra para revisão?',
          'Até três amostras do código autorizado serão enviadas ao Workers AI. A revisão usa a cota gratuita e precisa de validação externa.',
          [{text:'Cancelar',style:'cancel'},{text:'Autorizar uma revisão',onPress:()=>void run(()=>event('audit',{model:true}))}]))}
      {state==='IMPLEMENTING'&&button('Vincular número do PR digitado',()=>void run(()=>event('link_pr',{pr:Number(payload)})))}
      {!['OWNER_APPROVED','CANCELLED','FAILED','PAUSED'].includes(state??'')&&<>
        {<TextInput accessibilityLabel="Número do PR ou decisão da missão" value={payload} onChangeText={setPayload} style={s.input}/>}
        {button('Registrar decisão digitada',()=>void run(()=>event('decision',{reason:payload})))}
        {button('Pausar com motivo digitado',()=>void run(()=>event('pause',{reason:payload})))}
      </>}
      {state==='READY_FOR_OWNER'&&button('Registrar minha aprovação',()=>void run(()=>event('approve',{commit:detail.mission.revision})))}
      {button('Compartilhar relatório da Diretora',()=>void run(async()=>{await Share.share({message:JSON.stringify(detail.review,null,2)});}))}
      {detail.review.correctionPackage&&button('Compartilhar pacote para o Codex',()=>void run(async()=>{
        await Share.share({message:JSON.stringify(detail.review.correctionPackage,null,2)});
      }))}
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
  field:{minHeight:44,color:palette.text,borderColor:palette.border,borderWidth:1,borderRadius:9,padding:8},
  row:{flexDirection:'row',flexWrap:'wrap',gap:6},
});
