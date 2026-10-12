'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/client/api';
import { type Session, clearSession, loadName, loadSession, saveName, saveSession } from '@/lib/client/session';
import { useMsg } from '@/lib/client/useMsg';
import type { PolacoView } from '@/lib/rules/polaco';
import type { RoomView } from '@/lib/types';
import { LocaleSwitcher } from './LocaleSwitcher';
import { Lobby } from './Lobby';
import { Table } from './Table';

type Fatal = 'not_found' | 'kicked' | null;

const POLL_MS = 1000;

export function RoomClient({ code }: { code: string }) {
  const t = useTranslations('room');
  const renderMsg = useMsg();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [view, setView] = useState<RoomView | null>(null);
  const [fatal, setFatal] = useState<Fatal>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const versionRef = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // El polling no debe reiniciarse al cambiar de idioma: lee el traductor vigente desde una ref.
  const renderMsgRef = useRef(renderMsg);
  useEffect(() => {
    renderMsgRef.current = renderMsg;
  }, [renderMsg]);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    setSession(loadSession(code));
  }, [code]);

  const apply = useCallback((v: RoomView) => {
    if (v.version >= versionRef.current) {
      versionRef.current = v.version;
      setView(v);
    }
  }, []);

  const token = session?.token;

  // Polling cada ~1 s; en pausa con la pestaña oculta y se recupera al volver.
  useEffect(() => {
    if (!token) return;
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (!stopped && !document.hidden) timer = setTimeout(tick, POLL_MS);
    };

    async function tick() {
      if (stopped || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const r = await api.getRoom(code, token as string, versionRef.current || undefined);
        if (!('unchanged' in r)) apply(r);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          clearSession(code);
          setFatal('kicked');
          stopped = true;
          return;
        }
        if (e instanceof ApiError && e.status === 404) {
          setFatal('not_found');
          stopped = true;
          return;
        }
        if (e instanceof ApiError && e.code === 'error.network') notify(renderMsgRef.current(e.msg));
      } finally {
        inFlight = false;
      }
      schedule();
    }

    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
      } else {
        clearTimeout(timer);
        void tick();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [code, token, apply, notify]);

  const run = useCallback(
    async (fn: () => Promise<RoomView>) => {
      setBusy(true);
      try {
        apply(await fn());
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          clearSession(code);
          setFatal('kicked');
        } else {
          notify(e instanceof ApiError ? renderMsg(e.msg) : t('genericError'));
        }
      } finally {
        setBusy(false);
      }
    },
    [apply, code, notify, renderMsg, t]
  );

  const leave = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      await api.leave(code, token);
    } catch (e) {
      // Si ya no eras miembro (401) o la sala ya no existe, igualmente te vas.
      if (!(e instanceof ApiError && (e.status === 401 || e.status === 404))) {
        notify(e instanceof ApiError ? renderMsg(e.msg) : t('leaveFailed'));
        setBusy(false);
        return;
      }
    }
    clearSession(code);
    router.push('/');
  }, [code, token, notify, router, renderMsg, t]);

  /* ---------------------------- estados sin partida --------------------------- */

  if (fatal) {
    return (
      <Centered>
        <h1 className='font-display text-3xl font-black text-brass-soft'>
          {fatal === 'kicked' ? t('kickedTitle') : t('notFoundTitle')}
        </h1>
        <p className='mt-2 text-cream/70'>{fatal === 'kicked' ? t('kickedBody') : t('notFoundBody')}</p>
        <Link href='/' className='btn btn-brass mt-6'>
          {t('backHome')}
        </Link>
      </Centered>
    );
  }

  if (session === undefined)
    return (
      <Centered>
        <p className='text-cream/60'>{t('loading')}</p>
      </Centered>
    );

  if (session === null) {
    return <JoinGate code={code} onJoined={(s) => setSession(s)} />;
  }

  if (!view)
    return (
      <Centered>
        <p className='text-cream/60' role='status'>
          {t('entering', { code })}
        </p>
      </Centered>
    );

  return (
    <>
      {view.phase === 'lobby' || !view.game ? (
        <Lobby
          view={view}
          busy={busy}
          notify={notify}
          onConfig={(config) => run(() => api.setConfig(code, session.token, view.ruleSet.id, config))}
          onKick={(id) => run(() => api.kick(code, session.token, id))}
          onStart={() => run(() => api.start(code, session.token))}
          onLeave={leave}
        />
      ) : (
        <Table
          view={view as RoomView<PolacoView>}
          busy={busy}
          send={(action) => run(() => api.action(code, session.token, action))}
          onRematch={() => run(() => api.start(code, session.token))}
          notify={notify}
          onLeave={leave}
          onEnd={() => run(() => api.end(code, session.token))}
        />
      )}
      <div
        role='status'
        aria-live='polite'
        className={`pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-4 transition-all duration-200 ${
          toast ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'
        }`}>
        {toast && (
          <p className='max-w-sm rounded-2xl border border-[#ff9d8f]/40 bg-[#2a0f12] px-4 py-3 text-center text-sm font-semibold text-[#ffd2cb] shadow-xl'>
            {toast}
          </p>
        )}
      </div>
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className='mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center'>
      <LocaleSwitcher className='absolute top-4 right-4' />
      {children}
    </main>
  );
}

function JoinGate({ code, onJoined }: { code: string; onJoined: (s: Session) => void }) {
  const t = useTranslations('room');
  const renderMsg = useMsg();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(loadName());
  }, []);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError(t('nickRequired'));
    setBusy(true);
    setError(null);
    try {
      const cred = await api.joinRoom(code, name.trim());
      saveName(name.trim());
      const s = { playerId: cred.playerId, token: cred.token };
      saveSession(code, s);
      onJoined(s);
    } catch (err) {
      setError(err instanceof ApiError ? renderMsg(err.msg) : t('genericError'));
      setBusy(false);
    }
  }

  return (
    <Centered>
      <p className='text-sm font-semibold tracking-widest text-brass-soft uppercase'>{t('roomLabel')}</p>
      <h1 className='font-display mb-6 text-6xl font-black tracking-[0.2em] text-brass-soft'>{code}</h1>
      <form onSubmit={join} className='flex w-full flex-col gap-4 text-left'>
        <label htmlFor='join-name' className='text-sm font-semibold tracking-wide text-brass-soft uppercase'>
          {t('nickLabel')}
        </label>
        <input
          id='join-name'
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          autoComplete='nickname'
          placeholder={t('nickPlaceholder')}
          className='w-full rounded-2xl border border-cream/25 bg-black/25 px-4 text-cream placeholder:text-cream/45'
        />
        <button className='btn btn-brass w-full text-lg' disabled={busy}>
          {busy ? t('joining') : t('joinRoom')}
        </button>
        <p role='alert' className='min-h-6 text-center text-sm font-semibold text-[#ff9d8f]'>
          {error}
        </p>
      </form>
      <Link href='/' className='mt-2 text-sm text-cream/60 underline underline-offset-4'>
        {t('backHome')}
      </Link>
    </Centered>
  );
}
