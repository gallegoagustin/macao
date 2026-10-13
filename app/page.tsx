import { getTranslations } from 'next-intl/server';
import { HomeForm } from '@/components/HomeForm';
import { PlayingCard } from '@/components/PlayingCard';
import { SettingsPanel } from '@/components/SettingsPanel';

export default async function Home() {
  const t = await getTranslations('home');
  return (
    <main className='safe-px-5 safe-pt-10 safe-pb-10 mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center gap-10 lg:max-w-4xl'>
      <header className='relative text-center'>
        <div className='pointer-events-none mx-auto mb-2 flex h-28 w-48 items-end justify-center' aria-hidden='true'>
          <div className='-mr-8 w-20 -rotate-[14deg] origin-bottom'>
            <PlayingCard id='KH' />
          </div>
          <div className='z-10 w-20 -translate-y-2'>
            <PlayingCard id='AS' />
          </div>
          <div className='-ml-8 w-20 rotate-[14deg] origin-bottom'>
            <PlayingCard id='QD' />
          </div>
        </div>
        <h1 className="font-display text-7xl font-black tracking-tight text-brass-soft [font-variation-settings:'SOFT'_100] sm:text-8xl">
          Macao
        </h1>
        <p className='mt-2 text-lg text-cream/75'>{t('tagline')}</p>
      </header>
      {/* Móvil/tablet: una columna. Escritorio: Ajustes como columna lateral para que todo quepa sin scroll. */}
      <div className='flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-12'>
        <HomeForm />
        <SettingsPanel />
      </div>
    </main>
  );
}
