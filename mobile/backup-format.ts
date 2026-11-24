import type { Memory } from './core';
import {decodeProfiles,type ProjectProfile} from './factory.ts';

export const exportOptions = ['profileName','profileStyle','avatarChoice','portrait','voiceRate','researchMode'] as const;
const id=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const string=(v:unknown,n:number):v is string=>typeof v==='string'&&v.length<=n;
const date=(v:unknown):v is number=>Number.isSafeInteger(v)&&typeof v==='number'&&v>=0;
type Thread={id:string;title:string;archived:number};
type Message={id:string;thread_id:string;prompt:string; reply:string|null;created:number;reply_at:number|null;response_model:string|null};
type Cloud={projects:Record<string,unknown>[];events:Record<string,unknown>[]};
export type Backup={version:2;memories:Memory[];threads:Thread[];messages:Message[];options:Record<string,string>;cloud:Cloud|null;factoryProfiles?:ProjectProfile[]};

function isObject(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v);}
export function validateWorkspace(value:unknown, validateMemory:(v:unknown)=>Memory[]):Backup {
  if(!isObject(value)||value.version!==2||!Array.isArray(value.threads)||!Array.isArray(value.messages)||
     value.threads.length>100||value.messages.length>1000||!isObject(value.options)) throw Error('Backup integrado inválido.');
  const ids=new Set<string>();
  const threads=value.threads.map(row=>{
    if(!isObject(row)||typeof row.id!=='string'||(row.id!=='principal'&&!id.test(row.id))||
      ids.has(row.id)||!string(row.title,80)||!row.title.trim()||![0,1].includes(Number(row.archived))) throw Error('Conversa inválida no backup.');
    ids.add(row.id);return {id:row.id,title:row.title,archived:Number(row.archived)};
  });
  const messages=value.messages.map(row=>{
    if(!isObject(row)||typeof row.id!=='string'||!id.test(row.id)||typeof row.thread_id!=='string'||!ids.has(row.thread_id)||
      !string(row.prompt,6000)||!(row.reply===null||string(row.reply,30000))||!date(row.created)||
      !(row.reply_at===null||date(row.reply_at))||!(row.response_model===null||string(row.response_model,96))) throw Error('Mensagem inválida no backup.');
    return {id:row.id,thread_id:row.thread_id,prompt:row.prompt,reply:row.reply as string|null,
      created:row.created,reply_at:row.reply_at as number|null,response_model:row.response_model as string|null};
  });
  const options:Record<string,string>={};
  for(const key of exportOptions){const candidate=value.options[key];if(string(candidate,300)) options[key]=candidate;}
  let cloud:Cloud|null=null;
  if(value.cloud!==null){
    if(!isObject(value.cloud)||!Array.isArray(value.cloud.projects)||!Array.isArray(value.cloud.events)||
      value.cloud.projects.length>100||value.cloud.events.length>500||
      !value.cloud.projects.every(isObject)||!value.cloud.events.every(isObject)) throw Error('Histórico de projetos inválido.');
    cloud={projects:value.cloud.projects,events:value.cloud.events};
  }
  const factoryProfiles=value.factoryProfiles===undefined?undefined:decodeProfiles(JSON.stringify(value.factoryProfiles));
  return {...(factoryProfiles===undefined?{}:{factoryProfiles}),version:2,memories:validateMemory({version:1,memories:value.memories}),threads,messages,options,cloud};
}
