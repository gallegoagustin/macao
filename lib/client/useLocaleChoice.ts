'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { LOCALE_COOKIE, type Locale } from '@/i18n/config';

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Idioma activo y cómo cambiarlo: guarda la cookie y refresca los Server Components. El estado del
 * cliente (sala, sesión, selección de cartas) no se pierde porque no hay navegación.
 */
export function useLocaleChoice(): { locale: Locale; choose: (next: Locale) => void; pending: boolean } {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return { locale, choose, pending };
}
