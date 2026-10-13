/** Tiempo transcurrido como `mm:ss` o `h:mm:ss` a partir de una hora. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Valor para el atributo `datetime` de `<time>` (duración ISO 8601, p. ej. `PT1H2M3S`). */
export function isoDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `PT${Math.floor(total / 3600)}H${Math.floor((total % 3600) / 60)}M${total % 60}S`;
}
