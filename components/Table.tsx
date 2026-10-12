'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMsg } from '@/lib/client/useMsg';
import { type CardId, type Suit, RANKS, SUITS, SUIT_GLYPH, isRedSuit, parseCard } from '@/lib/rules/cards';
import { type PolacoView, checkPlay, ctxFromView } from '@/lib/rules/polaco';
import type { RoomView } from '@/lib/types';
import { ConfirmDialog } from './ConfirmDialog';
import { LocaleSwitcher } from './LocaleSwitcher';
import { CardBack, PlayingCard, useCardAriaLabel } from './PlayingCard';

interface Props {
  view: RoomView<PolacoView>;
  busy: boolean;
  send: (action: unknown) => void;
  onRematch: () => void;
  notify: (msg: string) => void;
  onLeave: () => void;
  onEnd: () => void;
}

type Chip = { key: string; node: React.ReactNode; tone?: 'warn' | 'info' };

/** Palo dentro de un chip: color según el fondo del chip para que siempre contraste. */
const Glyph = ({ suit, on }: { suit: Suit; on: 'brass' | 'ruby' }) => {
  const tCard = useTranslations('card');
  const color = on === 'ruby' ? 'text-white' : isRedSuit(suit) ? 'text-ruby' : 'text-ink';
  return (
    <span className={color} aria-label={tCard(`suit.${suit}`)}>
      {SUIT_GLYPH[suit]}
    </span>
  );
};

/**
 * Tamaño y separación de las cartas de la mano. Con muchas cartas primero se reduce el tamaño
 * (hasta un 80 %) y solo después se solapan más; la esquina (rango + palo) siempre queda a la vista.
 * Si ni así caben, la mano hace scroll horizontal.
 */
function useHandLayout(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ cardW: 74, step: 42 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const cs = getComputedStyle(el);
      const avail = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const base = window.innerWidth >= 640 ? 92 : 74;
      const smallest = Math.round(base * 0.8);
      if (count <= 1) return setLayout({ cardW: base, step: base });
      let chosen: { cardW: number; step: number } | null = null;
      for (let w = base; w >= smallest; w -= 2) {
        const fit = (avail - w) / (count - 1);
        if (fit >= w * 0.55) {
          chosen = { cardW: w, step: Math.round(Math.min(fit, w + 8)) }; // sin solape si sobra sitio
          break;
        }
      }
      if (!chosen) {
        const w = smallest;
        const minStep = Math.max(26, Math.round(w * 0.44));
        chosen = { cardW: w, step: Math.max(minStep, Math.round((avail - w) / (count - 1))) };
      }
      setLayout(chosen);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count]);
  return { ref, ...layout };
}

export function Table({ view, busy, send, onRematch, notify, onLeave, onEnd }: Props) {
  const t = useTranslations('table');
  const tMeta = useTranslations('meta');
  const turnTitle = tMeta('turnTitle');
  const idleTitle = tMeta('title');
  const renderMsg = useMsg();
  const cardAriaLabel = useCardAriaLabel();
  const game = view.game as PolacoView;
  const me = view.me;
  const nameOf = useMemo(() => new Map(game.players.map((p) => [p.id, p.name])), [game.players]);
  const finished = game.winnerId !== null;
  const myTurn = !finished && game.actorId === me;
  const [picker, setPicker] = useState<{ cards: CardId[]; kind: 'J' | 'A' } | null>(null);
  const [selected, setSelected] = useState<CardId[]>([]);
  const [confirm, setConfirm] = useState<'leave' | 'end' | null>(null);
  const lastTap = useRef<{ card: CardId; at: number } | null>(null);
  const isHost = view.hostId === me;

  // Aviso de turno: vibración suave y título de la pestaña.
  const wasMyTurn = useRef(false);
  useEffect(() => {
    if (myTurn && !wasMyTurn.current) navigator.vibrate?.(35);
    wasMyTurn.current = myTurn;
    document.title = myTurn ? turnTitle : idleTitle;
    return () => {
      document.title = idleTitle;
    };
  }, [myTurn, turnTitle, idleTitle]);

  // Si cambia el contexto (p. ej. te han saltado), se cierra el selector.
  useEffect(() => {
    if (!myTurn) {
      setPicker(null);
      setSelected([]);
    }
  }, [myTurn]);

  // La selección solo puede contener cartas que sigues teniendo.
  useEffect(() => {
    setSelected((sel) => (sel.every((c) => game.hand.includes(c)) ? sel : sel.filter((c) => game.hand.includes(c))));
  }, [game.hand]);

  const sortedHand = useMemo(() => {
    const sIdx = (s: Suit) => SUITS.indexOf(s);
    return [...game.hand].sort((a, b) => {
      const ca = parseCard(a);
      const cb = parseCard(b);
      return sIdx(ca.suit) - sIdx(cb.suit) || RANKS.indexOf(ca.rank) - RANKS.indexOf(cb.rank);
    });
  }, [game.hand]);

  const hand = useHandLayout(sortedHand.length);
  const playable = useMemo(() => new Set(game.legal.plays), [game.legal.plays]);
  const opponents = game.players.filter((p) => p.id !== me);
  const meSeat = game.players.find((p) => p.id === me);

  const ctx = useMemo(() => ctxFromView(game), [game]);
  const check = useMemo(() => (selected.length ? checkPlay(ctx, selected) : null), [ctx, selected]);

  /** Estado visual de cada carta: qué puede empezar una jugada o ampliar la selección. */
  function stateOf(card: CardId): 'selected' | 'playable' | 'blocked' | 'idle' {
    if (!myTurn) return 'idle';
    if (selected.includes(card)) return 'selected';
    if (selected.length === 0) return playable.has(card) ? 'playable' : 'blocked';
    return checkPlay(ctx, [...selected, card], { partial: true }).ok ? 'playable' : 'blocked';
  }

  function submit(cards: CardId[]) {
    const c = checkPlay(ctx, cards);
    if (!c.ok) return notify(renderMsg(c.error));
    setSelected([]);
    if (c.needsDemand) return setPicker({ cards, kind: c.needsDemand === 'rank' ? 'J' : 'A' });
    send({ type: 'play', cards });
  }

  function tapCard(card: CardId) {
    if (finished || busy) return;
    if (!myTurn) return notify(t('notYourTurnYet'));
    const now = Date.now();
    const prev = lastTap.current;
    lastTap.current = { card, at: now };
    // Doble toque sobre una carta jugable: se tira directamente.
    if (prev && prev.card === card && now - prev.at < 350 && selected.length === 1 && selected[0] === card) {
      lastTap.current = null;
      return submit([card]);
    }
    if (selected.includes(card)) return setSelected(selected.filter((c) => c !== card));
    const next = [...selected, card];
    const partial = checkPlay(ctx, next, { partial: true });
    if (!partial.ok) return notify(renderMsg(partial.error));
    setSelected(next);
  }

  /* ---- Estado de la mesa (chips) ---- */
  const chips: Chip[] = [];
  const p = game.pending;
  if (p?.kind === 'draw') chips.push({ key: 'draw', node: <>{t('chip.draw', { amount: p.amount })}</>, tone: 'warn' });
  if (p?.kind === 'skip') chips.push({ key: 'skip', node: <>{t('chip.skip', { count: p.count })}</>, tone: 'warn' });
  if (p?.kind === 'king') {
    const suit = parseCard(p.card).suit;
    chips.push({
      key: 'king',
      tone: 'warn',
      node:
        p.target === me
          ? t.rich('chip.kingYou', { suit: () => <Glyph suit={suit} on='ruby' /> })
          : t.rich('chip.kingOther', { suit: () => <Glyph suit={suit} on='ruby' />, name: nameOf.get(p.target) ?? '?' })
    });
  }
  const d = game.demand;
  if (d?.kind === 'rank') {
    chips.push({
      key: 'dr',
      tone: 'info',
      node: (
        <>
          {t('chip.demandRank', { rank: d.rank })}
          <Left n={d.turnsLeft} />
        </>
      )
    });
  }
  if (d?.kind === 'suit') {
    chips.push({
      key: 'ds',
      tone: 'info',
      node: (
        <>
          {t.rich('chip.demandSuit', { suit: () => <Glyph suit={d.suit} on='brass' /> })}
          <Left n={d.turnsLeft} />
        </>
      )
    });
  }
  if (game.freePlay) {
    chips.push({
      key: 'q',
      tone: 'info',
      node: myTurn ? <>{t('chip.freeYou')}</> : <>{t('chip.freeOther', { name: nameOf.get(game.actorId) ?? '?' })}</>
    });
  }
  if (game.drawn && myTurn) {
    chips.push({ key: 'drawn', tone: 'info', node: <>{t('chip.drawn')}</> });
  }

  const acceptLabel =
    p?.kind === 'draw'
      ? t('accept.draw', { amount: p.amount })
      : p?.kind === 'skip'
        ? p.count > 1
          ? t('accept.skipChain', { rest: p.count - 1 })
          : t('accept.skip')
        : p?.kind === 'king'
          ? t('accept.king')
          : t('accept.plain');

  const actorName = nameOf.get(game.actorId) ?? '?';
  const turnLine = finished
    ? t('turn.finished')
    : myTurn
      ? p?.kind === 'king'
        ? t('turn.answerKing')
        : t('turn.yours')
      : p?.kind === 'king'
        ? t('turn.waitingKing', { name: actorName })
        : t('turn.of', { name: actorName });

  return (
    <main className='mx-auto flex min-h-dvh w-full max-w-5xl flex-col'>
      {/* Cabecera */}
      <header className='flex items-center justify-between gap-2 px-4 pt-3 pb-1 text-sm text-cream/60'>
        <div className='flex items-center gap-3'>
          <span className='font-display tracking-[0.25em]'>{view.code}</span>
          <LocaleSwitcher />
        </div>
        <div className='flex items-center gap-2'>
          {isHost && !finished && (
            <button className='btn btn-ghost !min-h-10 !px-3 text-xs' onClick={() => setConfirm('end')}>
              {t('endGame')}
            </button>
          )}
          <button className='btn btn-ghost !min-h-10 !px-3 text-xs' onClick={() => setConfirm('leave')}>
            {t('leave')}
          </button>
        </div>
      </header>

      {/* Rivales + mesa, centrados juntos en el espacio libre */}
      <div className='flex flex-1 flex-col justify-center gap-5 py-3'>
        <section aria-label={t('opponents')} className='flex flex-wrap justify-center gap-2 px-3'>
          {opponents.map((o) => {
            const active = !finished && game.actorId === o.id;
            return (
              <div
                key={o.id}
                className={`flex w-[104px] flex-col items-center gap-1 rounded-2xl border px-2 py-2 text-center ${
                  active ? 'turn-pulse border-brass bg-brass/15' : 'border-cream/10 bg-black/25'
                }`}>
                <span className='w-full truncate text-sm font-bold'>{o.name}</span>
                <div className='flex items-center gap-1.5'>
                  <div className='relative h-8 w-6' aria-hidden='true'>
                    <CardBack className='absolute inset-0 -rotate-6' />
                    <CardBack className='absolute inset-0 rotate-6' />
                  </div>
                  <span className='font-display text-2xl leading-none font-black tabular-nums'>{o.cards}</span>
                  <span className='sr-only'>{t('cardsWord')}</span>
                </div>
                {o.cards === 1 && <MacaoBadge />}
                {active && <span className='text-[11px] font-semibold text-brass-soft'>{t('thinking')}</span>}
              </div>
            );
          })}
        </section>

        {/* Centro: mazo y descarte */}
        <section className='flex flex-col items-center justify-center gap-4 px-4' aria-label={t('table')}>
          <div className='flex items-center gap-8'>
            <div className='flex flex-col items-center gap-2'>
              <button
                onClick={() => send({ type: 'draw' })}
                disabled={!game.legal.canDraw || busy}
                aria-label={t('drawOne')}
                className={`relative w-[84px] rounded-lg transition-transform active:scale-95 sm:w-[104px] ${
                  game.legal.canDraw ? 'turn-pulse cursor-pointer' : 'opacity-80'
                }`}>
                <CardBack className='absolute inset-0 translate-x-1 translate-y-1 opacity-70' />
                <CardBack className='absolute inset-0 translate-x-0.5 translate-y-0.5' />
                <CardBack className='relative' />
              </button>
              <span className='text-xs font-semibold text-cream/70'>
                {game.legal.canDraw ? t('draw') : t('deck', { count: game.deckCount })}
              </span>
            </div>

            <div className='flex flex-col items-center gap-2'>
              <div key={game.top} className='drop-in w-[84px] sm:w-[104px]'>
                <PlayingCard id={game.top} />
              </div>
              <span className='text-xs font-semibold text-cream/70'>{t('tableLabel')}</span>
            </div>
          </div>

          <ul className='flex min-h-9 flex-wrap justify-center gap-2' aria-label={t('status')}>
            {chips.map((c) => (
              <li
                key={c.key}
                className={`rounded-full px-3.5 py-1.5 text-sm font-bold ${
                  c.tone === 'warn'
                    ? 'bg-ruby text-white shadow-[0_2px_0_var(--color-ruby-deep)]'
                    : 'bg-brass-soft text-[#2b1d04] shadow-[0_2px_0_var(--color-brass-deep)]'
                }`}>
                {c.node}
              </li>
            ))}
          </ul>

          <ol
            role='log'
            aria-live='polite'
            className='w-full max-w-sm space-y-0.5 text-center text-[13px] leading-snug'>
            {game.log.map((line, i) => {
              const text = renderMsg(line);
              return (
                <li
                  key={`${i}-${text}`}
                  className={i === game.log.length - 1 ? 'font-semibold text-cream' : 'text-cream/50'}>
                  {text}
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      {/* Zona del jugador */}
      <section className='sticky bottom-0 rounded-t-[28px] border-t border-brass/25 bg-felt-950/85 px-3 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] backdrop-blur-md'>
        <div className='mb-2 flex items-center justify-between gap-3 px-1'>
          <p className='min-w-0 truncate text-sm' aria-live='polite'>
            <span className={`font-bold ${myTurn ? 'text-brass-soft' : 'text-cream/80'}`}>{turnLine}</span>
            <span className='text-cream/50'> · {t('cardsCount', { count: meSeat?.cards ?? 0 })}</span>
          </p>
          {meSeat?.cards === 1 && <MacaoBadge />}
        </div>

        {myTurn && (game.legal.canAccept || game.legal.canPass || p === null) && (
          <div className='mb-2 flex flex-col gap-2 sm:flex-row'>
            {game.legal.canAccept && (
              <button
                className='btn btn-ruby w-full text-center text-[15px] leading-tight'
                disabled={busy}
                onClick={() => send({ type: 'accept' })}>
                {acceptLabel}
              </button>
            )}
            {p === null && (
              <button
                className='btn btn-ghost w-full'
                disabled={busy || !game.legal.canDraw}
                onClick={() => send({ type: 'draw' })}>
                {t('draw')}
              </button>
            )}
            {game.legal.canPass && (
              <button className='btn btn-ghost w-full' disabled={busy} onClick={() => send({ type: 'pass' })}>
                {t('pass')}
              </button>
            )}
          </div>
        )}

        {myTurn && selected.length > 0 && check && (
          <div className='mb-1 flex flex-col gap-1.5'>
            <div className='flex gap-2'>
              <button className='btn btn-brass flex-1' disabled={busy || !check.ok} onClick={() => submit(selected)}>
                {check.ok ? renderMsg(check.label) : t('play')}
              </button>
              <button className='btn btn-ghost' onClick={() => setSelected([])} aria-label={t('clearSelection')}>
                {t('clear')}
              </button>
            </div>
            {!check.ok && (
              <p role='status' className='px-1 text-[13px] leading-snug font-semibold text-[#ffb4a8]'>
                {renderMsg(check.error)}
              </p>
            )}
          </div>
        )}

        <div
          ref={hand.ref}
          className='hand-scroll flex overflow-x-auto px-3 pt-11 pb-3'
          style={{ justifyContent: 'safe center' }}
          role='group'
          aria-label={t('yourHand')}>
          {sortedHand.map((card, i) => {
            const st = stateOf(card);
            const order = selected.indexOf(card) + 1;
            return (
              <button
                key={card}
                className='hand-card'
                style={{
                  width: hand.cardW,
                  marginLeft: i === 0 ? 0 : hand.step - hand.cardW,
                  borderRadius: hand.cardW * 0.09
                }}
                data-state={st}
                data-overlap={i > 0 && hand.step < hand.cardW}
                aria-pressed={st === 'selected'}
                aria-label={
                  st === 'selected'
                    ? t('cardSelected', { card: cardAriaLabel(card), order })
                    : st !== 'playable' && myTurn
                      ? t('cardUnplayable', { card: cardAriaLabel(card) })
                      : cardAriaLabel(card)
                }
                onClick={() => tapCard(card)}>
                {order > 0 && (
                  <span
                    aria-hidden='true'
                    className='font-display pointer-events-none absolute -top-[26px] left-1/2 z-10 grid size-6 -translate-x-1/2 place-items-center rounded-full bg-brass text-[13px] font-black text-[#2b1d04] shadow-[0_2px_0_var(--color-brass-deep)]'>
                    {order}
                  </span>
                )}
                <PlayingCard id={card} />
              </button>
            );
          })}
        </div>
      </section>

      {picker && (
        <DemandPicker
          kind={picker.kind}
          onCancel={() => setPicker(null)}
          onPickRank={(rank) => {
            send({ type: 'play', cards: picker.cards, demandRank: rank });
            setPicker(null);
          }}
          onPickSuit={(suit) => {
            send({ type: 'play', cards: picker.cards, demandSuit: suit });
            setPicker(null);
          }}
        />
      )}

      {confirm === 'leave' && (
        <ConfirmDialog
          title={t('leaveTitle')}
          body={t('leaveBody')}
          confirmLabel={t('leaveConfirm')}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            onLeave();
          }}
        />
      )}
      {confirm === 'end' && (
        <ConfirmDialog
          title={t('endTitle')}
          body={t('endBody')}
          confirmLabel={t('endConfirm')}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            onEnd();
          }}
        />
      )}

      {finished && (
        <div
          className='fixed inset-0 z-40 grid place-items-center bg-black/60 p-5 backdrop-blur-[3px]'
          role='dialog'
          aria-modal='true'
          aria-labelledby='winner-title'>
          <div className='rise w-full max-w-sm rounded-[28px] border border-brass/50 bg-felt-900 p-7 text-center shadow-2xl'>
            <p className='text-sm font-semibold tracking-widest text-brass-soft uppercase'>{t('gameOver')}</p>
            <h2 id='winner-title' className='font-display mt-2 text-4xl font-black text-brass-soft'>
              {game.winnerId === me ? t('youWon') : t('winner', { name: nameOf.get(game.winnerId as string) ?? '?' })}
            </h2>
            <p className='mt-2 text-cream/70'>{game.winnerId === me ? t('youWonBody') : t('winnerBody')}</p>
            <div className='mt-6'>
              {isHost ? (
                <button className='btn btn-brass w-full text-lg' disabled={busy} onClick={onRematch}>
                  {t('rematch')}
                </button>
              ) : (
                <p className='text-cream/70' role='status'>
                  {t('waitingRematch')}
                </p>
              )}
              <button className='btn btn-ghost mt-3 w-full' onClick={onLeave}>
                {t('leaveRoom')}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/** Indicador automático (sin acción del jugador): aparece cuando a alguien le queda 1 carta. */
function MacaoBadge() {
  const t = useTranslations('table');
  return (
    <span className='rise shrink-0 rounded-full bg-brass px-2.5 py-0.5 text-[11px] font-extrabold tracking-wide text-[#2b1d04] uppercase shadow-[0_2px_0_var(--color-brass-deep)]'>
      {t('macao')}
    </span>
  );
}

function Left({ n }: { n: number }) {
  const t = useTranslations('table');
  return <span className='ml-1 text-xs font-semibold opacity-70'>· {t('turnsLeft', { count: n })}</span>;
}

function DemandPicker({
  kind,
  onCancel,
  onPickRank,
  onPickSuit
}: {
  kind: 'J' | 'A';
  onCancel: () => void;
  onPickRank: (rank: '5' | '6' | '7' | '8' | '9' | '10' | null) => void;
  onPickSuit: (suit: Suit) => void;
}) {
  const t = useTranslations('table');
  const tCommon = useTranslations('common');
  const tCard = useTranslations('card');
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className='fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-[2px]'
      onClick={onCancel}>
      <div
        role='dialog'
        aria-modal='true'
        aria-label={kind === 'J' ? t('pickRankAria') : t('pickSuitAria')}
        className='rise w-full max-w-md rounded-t-[28px] border-t border-brass/40 bg-felt-900 px-5 pt-5 pb-[max(env(safe-area-inset-bottom),20px)]'
        onClick={(e) => e.stopPropagation()}>
        <h2 className='font-display mb-4 text-center text-2xl font-black text-brass-soft'>
          {kind === 'J' ? t('pickRankTitle') : t('pickSuitTitle')}
        </h2>
        {kind === 'J' ? (
          <>
            <div className='grid grid-cols-3 gap-3'>
              {(['5', '6', '7', '8', '9', '10'] as const).map((r, i) => (
                <button
                  key={r}
                  ref={i === 0 ? firstRef : undefined}
                  className='btn btn-ghost font-display !min-h-16 text-3xl font-black'
                  onClick={() => onPickRank(r)}>
                  {r}
                </button>
              ))}
            </div>
            <button className='btn btn-brass mt-3 w-full' onClick={() => onPickRank(null)}>
              {t('pickNone')}
            </button>
          </>
        ) : (
          <div className='grid grid-cols-2 gap-3'>
            {SUITS.map((s, i) => (
              <button
                key={s}
                ref={i === 0 ? firstRef : undefined}
                className='btn btn-ghost !min-h-16 flex-col !gap-0 text-sm'
                onClick={() => onPickSuit(s)}>
                <span
                  className={`text-3xl leading-none ${isRedSuit(s) ? 'text-[#ff8a85]' : 'text-cream'}`}
                  aria-hidden='true'>
                  {SUIT_GLYPH[s]}
                </span>
                <span>{tCard(`suit.${s}`)}</span>
              </button>
            ))}
          </div>
        )}
        <button className='btn mt-3 w-full text-cream/70' onClick={onCancel}>
          {tCommon('cancel')}
        </button>
      </div>
    </div>
  );
}
