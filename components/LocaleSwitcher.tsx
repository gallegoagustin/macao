'use client';

import { useTranslations } from 'next-intl';
import { locales } from '@/i18n/config';
import { useLocaleChoice } from '@/lib/client/useLocaleChoice';

/**
 * Selector ES / EN compacto para el lobby y las pantallas de paso. En Home vive dentro de Ajustes
 * (`SettingsPanel`) y en la mesa no se muestra: el idioma se elige antes de empezar.
 */
export function LocaleSwitcher({ className = '' }: { className?: string }) {
  const t = useTranslations('locale');
  const { locale, choose, pending } = useLocaleChoice();

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
          className={`h-11 min-w-11 cursor-pointer rounded-full px-3 text-xs font-bold tracking-wide uppercase transition-colors ${
            l === locale ? 'bg-brass text-[#2b1d04]' : 'text-cream/60 hover:text-cream'
          }`}>
          {l}
        </button>
      ))}
    </div>
  );
}
