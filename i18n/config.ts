export const locales = ['es', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'es';
/** Cookie donde se guarda el idioma elegido (sin prefijo en la URL). */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (locales as readonly string[]).includes(v);
}

/** Elige el primer idioma soportado de una cabecera Accept-Language, respetando los pesos `q`. */
export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number(q.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split('-')[0], weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((x) => x.weight > 0 && isLocale(x.lang))
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  return ranked.length ? (ranked[0].lang as Locale) : null;
}
