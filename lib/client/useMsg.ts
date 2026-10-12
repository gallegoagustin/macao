import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { SUIT_GLYPH, type CardId, type Suit, cardLabel } from '../rules/cards';
import type { Msg, MsgParam } from '../types';

/**
 * Devuelve una función que traduce un mensaje estable del servidor (`msg.<code>`). Los parámetros `card`,
 * `cards` y `suit` se pintan como en la mesa (rango + palo); un `Msg` anidado se traduce recursivamente.
 * Acepta también un string suelto por si quedan salas guardadas con textos antiguos.
 */
export function useMsg(): (m: Msg | string) => string {
  const t = useTranslations('msg');
  return useCallback(
    function render(m: Msg | string): string {
      if (typeof m === 'string') return m;
      const values: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(m.params ?? {})) values[key] = param(key, value, render);
      return t(m.code, values);
    },
    [t]
  );
}

function param(key: string, value: MsgParam, render: (m: Msg) => string): string | number {
  if (typeof value === 'object' && !Array.isArray(value)) return render(value);
  if (key === 'card') return cardLabel(value as CardId);
  if (key === 'cards') return (value as CardId[]).map(cardLabel).join(' ');
  if (key === 'suit') return SUIT_GLYPH[value as Suit];
  return value as string | number;
}
