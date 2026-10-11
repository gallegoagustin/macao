'use client';

import { useState } from 'react';
import type { RoomView } from '@/lib/types';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  view: RoomView;
  busy: boolean;
  onConfig: (config: Record<string, number>) => void;
  onKick: (playerId: string) => void;
  onStart: () => void;
  onLeave: () => void;
  notify: (msg: string) => void;
}

export function Lobby({ view, busy, onConfig, onKick, onStart, onLeave, notify }: Props) {
  const isHost = view.me === view.hostId;
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const playerCount = view.players.length;
  /** Máximo efectivo de un campo: recorta por `valor × jugadores <= presupuesto`. */
  const capOf = (f: RoomView['ruleSet']['config'][number]) =>
    f.perPlayerBudget ? Math.max(f.min, Math.min(f.max, Math.floor(f.perPlayerBudget / playerCount))) : f.max;
  const overCap = view.ruleSet.config.some((f) => (view.config[f.key] ?? f.default) > capOf(f));
  const canStart = playerCount >= 2 && !overCap;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      notify('No se ha podido copiar. Selecciona el código a mano.');
    }
  }

  async function share() {
    const url = `${location.origin}/sala/${view.code}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Macao', text: `Únete a mi sala de Macao con el código ${view.code}`, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    await copy(url);
  }

  return (
    <main className='mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-5 py-8'>
      {view.notice && (
        <p
          role='status'
          className='rise rounded-2xl border border-brass/40 bg-brass/10 px-4 py-3 text-center text-sm font-semibold text-brass-soft'>
          {view.notice}
        </p>
      )}
      <header className='rise text-center'>
        <p className='text-sm font-semibold tracking-widest text-brass-soft uppercase'>Código de sala</p>
        <div className='mt-3 flex justify-center gap-2' aria-label={`Código ${view.code.split('').join(' ')}`}>
          {view.code.split('').map((ch, i) => (
            <span
              key={i}
              className='font-display grid h-20 w-16 place-items-center rounded-xl border border-brass/50 bg-paper text-5xl font-black text-ink shadow-[0_3px_0_var(--color-brass-deep),0_10px_20px_rgb(0_0_0/0.4)]'>
              {ch}
            </span>
          ))}
        </div>
        <div className='mt-4 flex justify-center gap-3'>
          <button className='btn btn-ghost' onClick={() => copy(view.code)}>
            {copied ? '¡Copiado!' : 'Copiar código'}
          </button>
          <button className='btn btn-brass' onClick={share}>
            Compartir
          </button>
        </div>
      </header>

      <section className='rise rounded-3xl border border-cream/15 bg-black/20 p-5' style={{ animationDelay: '60ms' }}>
        <h2 className='font-display mb-3 text-xl font-bold'>
          Jugadores <span className='text-cream/50'>· {view.players.length}/8</span>
        </h2>
        <ul className='flex flex-col gap-2'>
          {view.players.map((p) => (
            <li key={p.id} className='flex min-h-12 items-center gap-3 rounded-2xl bg-white/5 px-4'>
              <span className='min-w-0 flex-1 truncate font-semibold'>
                {p.name}
                {p.id === view.me && <span className='ml-2 text-sm font-normal text-cream/50'>(tú)</span>}
              </span>
              {p.isHost && (
                <span className='rounded-full bg-brass/20 px-2.5 py-0.5 text-xs font-bold tracking-wide text-brass-soft uppercase'>
                  Anfitrión
                </span>
              )}
              {isHost && !p.isHost && (
                <button
                  className='grid size-11 place-items-center rounded-full text-cream/70 hover:bg-white/10'
                  aria-label={`Echar a ${p.name}`}
                  onClick={() => onKick(p.id)}
                  disabled={busy}>
                  <svg
                    viewBox='0 0 24 24'
                    className='size-5'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='2'
                    strokeLinecap='round'
                    aria-hidden='true'>
                    <path d='M6 6l12 12M18 6L6 18' />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>
        {view.players.length < 2 && (
          <p className='mt-3 text-sm text-cream/60'>Necesitas al menos otro jugador para empezar.</p>
        )}
      </section>

      <section className='rise rounded-3xl border border-cream/15 bg-black/20 p-5' style={{ animationDelay: '120ms' }}>
        <h2 className='font-display mb-3 text-xl font-bold'>Reglas</h2>
        <div className='mb-1 flex items-center gap-2'>
          {isHost ? (
            <select
              aria-label='Set de reglas'
              value={view.ruleSet.id}
              onChange={() => undefined}
              className='min-h-12 rounded-xl border border-cream/25 bg-black/30 px-3 text-base font-semibold'>
              <option value={view.ruleSet.id}>{view.ruleSet.name}</option>
            </select>
          ) : (
            <span className='font-semibold'>{view.ruleSet.name}</span>
          )}
        </div>
        <p className='mb-4 text-sm leading-relaxed text-cream/70'>{view.ruleSet.description}</p>

        {view.ruleSet.config.map((f) => {
          const value = view.config[f.key] ?? f.default;
          const cap = capOf(f);
          return (
            <div key={f.key} className='flex items-center justify-between gap-4'>
              <div className='min-w-0'>
                <p className='font-semibold'>{f.label}</p>
                {f.help && <p className='text-xs text-cream/55'>{f.help}</p>}
              </div>
              {isHost ? (
                <div className='flex shrink-0 items-center gap-1' role='group' aria-label={f.label}>
                  <button
                    className='btn btn-ghost size-12 !min-h-12 !p-0 text-2xl'
                    aria-label={`Menos ${f.label.toLowerCase()}`}
                    disabled={busy || value <= f.min}
                    onClick={() => onConfig({ ...view.config, [f.key]: value - 1 })}>
                    −
                  </button>
                  <output className='font-display w-10 text-center text-2xl font-black tabular-nums'>{value}</output>
                  <button
                    className='btn btn-ghost size-12 !min-h-12 !p-0 text-2xl'
                    aria-label={`Más ${f.label.toLowerCase()}`}
                    disabled={busy || value >= cap}
                    onClick={() => onConfig({ ...view.config, [f.key]: value + 1 })}>
                    +
                  </button>
                </div>
              ) : (
                <span className='font-display text-2xl font-black tabular-nums'>{value}</span>
              )}
            </div>
          );
        })}
        {view.ruleSet.config.map((f) => {
          const value = view.config[f.key] ?? f.default;
          const cap = capOf(f);
          if (value <= cap) return null;
          return (
            <p key={`${f.key}-warn`} role='alert' className='mt-3 text-sm font-semibold text-[#ff9d8f]'>
              Con {playerCount} jugadores el máximo es {cap}: {isHost ? 'baja' : 'que baje el anfitrión'}{' '}
              {f.label.toLowerCase()} para empezar.
            </p>
          );
        })}
      </section>

      <div className='mt-auto pt-2'>
        {isHost ? (
          <button className='btn btn-brass w-full text-lg' disabled={!canStart || busy} onClick={onStart}>
            Empezar partida
          </button>
        ) : (
          <p className='text-center text-cream/70' role='status'>
            Esperando a que el anfitrión empiece la partida…
          </p>
        )}
        <button className='btn btn-ghost mt-3 w-full' onClick={() => setConfirmLeave(true)}>
          Salir de la sala
        </button>
      </div>
      {confirmLeave && (
        <ConfirmDialog
          title='¿Salir de la sala?'
          body={
            isHost && view.players.length > 1
              ? 'El anfitrión pasará al siguiente jugador.'
              : 'Podrás volver a entrar con el código mientras la sala exista.'
          }
          confirmLabel='Salir'
          onCancel={() => setConfirmLeave(false)}
          onConfirm={() => {
            setConfirmLeave(false);
            onLeave();
          }}
        />
      )}
    </main>
  );
}
