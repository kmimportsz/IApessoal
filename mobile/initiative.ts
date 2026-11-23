import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

export const trackingGateway = 'https://iapessoal-gateway-v15.km-prospect-ai-app.workers.dev';
export type Project = {id:string; title:string; pending:string; due:number; active:number; description?:string;objective?:string;priority?:string;status?:string;frequencyDays?:number};
export type Initiative = Project & {cycle?:number; occurred:number; state:'new'|'read'|'dismissed'; urgency:string; origin:string; confidence:string};
type Tracking = {enabled:boolean; projects: Project[]; initiatives: Initiative[]};

export function useInitiatives(url: string, token: string, connected: boolean | null) {
  const [tracking,setTracking] = useState<Tracking>();
  const request = useCallback(async (path: string, method = 'GET', value?: object) => {
    if (url !== trackingGateway || !token || connected === false) throw Error('Conecte-se ao gateway da IA Pessoal para acompanhar objetivos.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url + path, {method, headers:{
        Authorization:'Bearer ' + token, 'Content-Type':'application/json',
      }, body:value && JSON.stringify(value), signal: controller.signal});
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? 'O acompanhamento está indisponível.');
      return data;
    } finally {clearTimeout(timer);}
  },[url,token,connected]);

  useEffect(() => {
    let live = true;
    let inProgress = false;
    async function refresh() {
      if (inProgress || ['background','inactive'].includes(AppState.currentState ?? 'active')) return;
      inProgress = true;
      try {const data = await request('/initiative'); if(live) setTracking(data);}
      catch { /* Retry at the next foreground poll. */ }
      finally { inProgress = false; }
    }
    if (url !== trackingGateway || !token) {setTracking(undefined); return;}
    void refresh();
    const timer = setInterval(() => void refresh(), 45_000);
    const sub = AppState.addEventListener('change', state => {if(state==='active') void refresh();});
    return () => {live=false;clearInterval(timer);sub.remove();};
  },[request,url,token]);

  async function change(path:string,method:string,value:object) {
    await request(path,method,value);
    setTracking(await request('/initiative'));
  }
  return {tracking,change};
}
