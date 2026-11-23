import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import * as Updates from 'expo-updates';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { checkDue } from './update-policy';

const timestampKey = 'updates.lastCheck';
const enabled = Updates.isEnabled && !__DEV__ &&
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

export function useAppUpdate(db: SQLiteDatabase | undefined, connected: boolean | null) {
  const { isUpdatePending } = Updates.useUpdates();
  const offline = connected === false;
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'applying'>('idle');
  const [failure, setFailure] = useState('');
  const working = useRef(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!db || !enabled || offline || isUpdatePending || available) return;
    const store = db;
    let active = true;

    async function check() {
      if (working.current || ['background', 'inactive'].includes(AppState.currentState ?? 'active')) return;
      working.current = true;
      try {
        const now = Date.now();
        const row = await store.getFirstAsync<{ value: string }>('SELECT value FROM options WHERE key=?', timestampKey);
        if (!active || (row && !checkDue(now, Number(row.value)))) return;
        await store.runAsync('INSERT OR REPLACE INTO options VALUES (?,?)', timestampKey, String(now));
        if (!active) return;
        const result = await Updates.checkForUpdateAsync();
        if (active && (result.isAvailable || result.isRollBackToEmbedded)) setAvailable(true);
      } catch {
        // Network and manifest errors leave the current bundle running.
      } finally {
        working.current = false;
      }
    }

    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void check();
    });
    void check();
    return () => { active = false; listener.remove(); };
  }, [db, offline, isUpdatePending, available]);

  async function download() {
    if (!enabled || working.current || offline || isUpdatePending) return;
    working.current = true;
    setPhase('downloading');
    setFailure('');
    try {
      const result = await Updates.fetchUpdateAsync();
      if (!result.isNew && !result.isRollBackToEmbedded) setAvailable(false);
    } catch {
      setFailure('Falha ao baixar. Você pode tentar novamente.');
    } finally {
      working.current = false;
      setPhase('idle');
    }
  }

  async function apply(canRestart: () => boolean, restarting: { current: boolean }) {
    if (!enabled || working.current || !isUpdatePending || !canRestart()) return;
    working.current = true;
    restarting.current = true;
    setPhase('applying');
    setFailure('');
    try {
      await Updates.reloadAsync();
    } catch {
      restarting.current = false;
      working.current = false;
      setPhase('idle');
      setFailure('Falha ao reiniciar. A versão atual continua em uso.');
    }
  }

  return {
    enabled,
    channel: Updates.channel,
    runtimeVersion: Updates.runtimeVersion,
    emergencyLaunch: Updates.isEmergencyLaunch,
    available,
    pending: isUpdatePending,
    phase, failure, download, apply,
  };
}
