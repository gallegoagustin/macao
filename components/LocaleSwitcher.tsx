'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { LOCALE_COOKIE, type Locale, locales } from '@/i18n/config';

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Selector ES / EN. Guarda la elección en la cookie y refresca los Server Components: el estado del
 * cliente (sala, sesión, selección de cartas) no se pierde porque no hay navegación.
 */
export function LocaleSwitcher({ className = '' }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations('locale');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <div
      role='group'
      aria-label={t('label')}
      aria-busy={pending}
      className={`inline-flex rounded-full border border-cream/15 bg-black/20 p-0.5 ${className}`}>
      {locales.map((l) => (
        <button
          key={l}
          type='button'
          lang={l}
          aria-pressed={l === locale}
          aria-label={t(`name.${l}`)}
          disabled={pending}
          onClick={() => choose(l)}
          className={`h-9 min-w-10 cursor-pointer rounded-full px-2.5 text-xs font-bold tracking-wide uppercase transition-colors ${
            l === locale ? 'bg-brass text-[#2b1d04]' : 'text-cream/60 hover:text-cream'
          }`}>
          {l}
        </button>
      ))}
    </div>
  );
}
