'use client';

import { useId } from 'react';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Pista visual corta bajo la etiqueta (p. ej. `A → K`); decorativa, no se lee. */
  hint?: string;
  lang?: string;
}

interface Props<T extends string> {
  legend: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/**
 * Control segmentado sobre radios nativos (flechas para moverse, un solo tab-stop, legend como nombre).
 * La opción activa usa el latón de los botones primarios; el foco de teclado se dibuja en el segmento.
 */
export function Segmented<T extends string>({ legend, options, value, onChange, disabled = false }: Props<T>) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className='min-w-0'>
      <legend className='mb-2 text-sm font-semibold tracking-wide text-brass-soft uppercase'>{legend}</legend>
      <div
        className='grid gap-1 rounded-2xl border border-cream/15 bg-black/25 p-1'
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <label
              key={o.value}
              lang={o.lang}
              className={`flex min-h-12 cursor-pointer flex-col items-center justify-center rounded-xl px-1.5 py-1.5 text-center transition-[background-color,color,transform] duration-150 ease-out select-none active:scale-[0.97] has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brass-soft ${
                active
                  ? 'bg-brass text-[#2b1d04] shadow-[0_2px_0_var(--color-brass-deep)]'
                  : 'text-cream/75 hover:bg-white/5 hover:text-cream'
              }`}>
              <input
                type='radio'
                name={name}
                value={o.value}
                checked={active}
                onChange={() => onChange(o.value)}
                className='sr-only'
              />
              <span className='text-[13px] leading-tight font-bold sm:text-sm'>{o.label}</span>
              {o.hint && (
                <span
                  aria-hidden='true'
                  className={`mt-0.5 text-xs leading-none font-semibold tracking-wide ${active ? 'text-[#2b1d04]/75' : 'text-cream/50'}`}>
                  {o.hint}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
