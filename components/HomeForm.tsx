'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/client/api';
import { loadName, saveName, saveSession } from '@/lib/client/session';
import { useMsg } from '@/lib/client/useMsg';

export function HomeForm() {
  const t = useTranslations('home');
  const renderMsg = useMsg();
  const router = useRouter();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(loadName());
  }, []);

  async function run(kind: 'create' | 'join') {
    setError(null);
    const nick = name.trim();
    if (!nick) return setError(t('nickRequired'));
    if (kind === 'join' && code.length !== 4) return setError(t('codeLength'));
    setBusy(kind);
    try {
      const cred = kind === 'create' ? await api.createRoom(nick) : await api.joinRoom(code, nick);
      saveName(nick);
      saveSession(cred.code, { playerId: cred.playerId, token: cred.token });
      router.push(`/sala/${cred.code}`);
    } catch (e) {
      setError(e instanceof ApiError ? renderMsg(e.msg) : t('genericError'));
      setBusy(null);
    }
  }

  return (
    <form
      className='rise mx-auto flex w-full max-w-md flex-col gap-6'
      onSubmit={(e) => {
        e.preventDefault();
        void run(code.length === 4 ? 'join' : 'create');
      }}>
      <div>
        <label htmlFor='nick' className='mb-2 block text-sm font-semibold tracking-wide text-brass-soft uppercase'>
          {t('nickLabel')}
        </label>
        <input
          id='nick'
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          autoComplete='nickname'
          placeholder={t('nickPlaceholder')}
          className='w-full rounded-2xl border border-cream/25 bg-black/25 px-4 text-cream placeholder:text-cream/45'
        />
      </div>

      <div className='rounded-3xl border border-brass/30 bg-black/20 p-5 backdrop-blur-[2px]'>
        <p className='mb-4 text-cream/80'>{t('createPrompt')}</p>
        <button
          type='button'
          className='btn btn-brass w-full text-lg'
          disabled={busy !== null}
          onClick={() => run('create')}>
          {busy === 'create' ? t('creating') : t('create')}
        </button>
      </div>

      <div className='flex items-center gap-4 text-cream/50' aria-hidden='true'>
        <span className='h-px flex-1 bg-cream/20' />
        <span className='font-display text-sm italic'>{t('or')}</span>
        <span className='h-px flex-1 bg-cream/20' />
      </div>

      <div className='rounded-3xl border border-cream/15 bg-black/10 p-5'>
        <label htmlFor='code' className='mb-2 block text-sm font-semibold tracking-wide text-brass-soft uppercase'>
          {t('codeLabel')}
        </label>
        <div className='flex gap-3'>
          <input
            id='code'
            value={code}
            onChange={(e) =>
              setCode(
                e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z]/g, '')
                  .slice(0, 4)
              )
            }
            autoCapitalize='characters'
            autoCorrect='off'
            spellCheck={false}
            maxLength={4}
            placeholder='ABCD'
            className='font-display w-full min-w-0 rounded-2xl border border-cream/25 bg-black/25 px-4 text-center text-2xl font-bold tracking-[0.35em] text-cream placeholder:text-cream/30'
          />
          <button type='button' className='btn btn-ghost shrink-0' disabled={busy !== null} onClick={() => run('join')}>
            {busy === 'join' ? t('joining') : t('join')}
          </button>
        </div>
      </div>

      <p role='alert' className='min-h-6 text-center text-sm font-semibold text-[#ff9d8f]'>
        {error}
      </p>
    </form>
  );
}
