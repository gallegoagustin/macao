'use client';

import { useTranslations } from 'next-intl';
import { type Locale, locales } from '@/i18n/config';
import { type HandOrder, HAND_ORDERS, useHandOrder } from '@/lib/client/handOrder';
import { useLocaleChoice } from '@/lib/client/useLocaleChoice';
import { Segmented } from './Segmented';

const ORDER_HINT: Record<HandOrder, string> = { suit: '♠ ♥ ♣ ♦', asc: 'A → K', desc: 'K → A' };

/** Ajustes locales del jugador (no se envían al servidor): orden de la mano e idioma. */
export function SettingsPanel() {
  const t = useTranslations('settings');
  const tLocale = useTranslations('locale');
  const [order, setOrder] = useHandOrder();
  const { locale, choose, pending } = useLocaleChoice();

  return (
    <section
      aria-labelledby='settings-title'
      // -mt-8 compensa el hueco reservado para el error del formulario; en escritorio, columna con filete a la izquierda.
      className='rise mx-auto -mt-8 flex w-full max-w-md flex-col gap-5 border-t border-cream/15 pt-6 lg:mt-0 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8'
      style={{ animationDelay: '80ms' }}>
      <h2 id='settings-title' className='font-display text-xl font-bold'>
        {t('title')}
      </h2>
      <Segmented<HandOrder>
        legend={t('handOrder')}
        value={order}
        onChange={setOrder}
        options={HAND_ORDERS.map((o) => ({ value: o, label: t(`order.${o}`), hint: ORDER_HINT[o] }))}
      />
      <Segmented<Locale>
        legend={t('language')}
        value={locale}
        onChange={choose}
        disabled={pending}
        options={locales.map((l) => ({ value: l, label: tLocale(`name.${l}`), lang: l }))}
      />
    </section>
  );
}
