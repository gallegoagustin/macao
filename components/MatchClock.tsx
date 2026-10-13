'use client';

import { useEffect, useState } from 'react';
import { formatElapsed, isoDuration } from '@/lib/client/clock';

interface Props {
  /** Epoch ms del servidor en que empezó la partida. */
  startedAt: number;
  /** Si la partida terminó, el reloj se congela en esta marca. */
  finishedAt?: number | null;
  label: string;
  className?: string;
}

/**
 * Cronómetro de partida. Solo cuenta en el cliente (sin polling extra): se reprograma alineado al
 * cambio de segundo para que no "salte" dos segundos de golpe. `role="timer"` no anuncia cada tic.
 */
export function MatchClock({ startedAt, finishedAt = null, label, className = '' }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (finishedAt !== null) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const intoSecond = (((t - startedAt) % 1000) + 1000) % 1000;
      timer = setTimeout(tick, 1000 - intoSecond + 15);
    };
    tick();
    return () => clearTimeout(timer);
  }, [startedAt, finishedAt]);

  const elapsed = (finishedAt ?? now) - startedAt;
  return (
    <time role='timer' aria-label={label} dateTime={isoDuration(elapsed)} className={`tabular-nums ${className}`}>
      {formatElapsed(elapsed)}
    </time>
  );
}
