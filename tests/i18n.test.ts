import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import es from '@/messages/es.json';
import { matchAcceptLanguage } from '@/i18n/config';

/** Claves hoja en notación de puntos (`a.b.c`), ordenadas. */
function keysOf(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix];
  return Object.entries(obj as Record<string, unknown>)
    .flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k))
    .sort();
}

describe('i18n', () => {
  it('es.json y en.json tienen exactamente las mismas claves', () => {
    expect(keysOf(en)).toEqual(keysOf(es));
  });

  it('ningún texto está vacío', () => {
    const empty = (o: unknown): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
        typeof v === 'string' ? (v.trim() === '' ? [k] : []) : empty(v).map((c) => `${k}.${c}`)
      );
    expect(empty(es)).toEqual([]);
    expect(empty(en)).toEqual([]);
  });

  it('matchAcceptLanguage respeta pesos y descarta idiomas no soportados', () => {
    expect(matchAcceptLanguage('en-US,en;q=0.9')).toBe('en');
    expect(matchAcceptLanguage('fr-FR,fr;q=0.9,es;q=0.5')).toBe('es');
    expect(matchAcceptLanguage('es;q=0.4,en;q=0.8')).toBe('en');
    expect(matchAcceptLanguage('fr')).toBeNull();
    expect(matchAcceptLanguage(null)).toBeNull();
  });
});
