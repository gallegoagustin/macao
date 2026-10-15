import { useTranslations } from 'next-intl';
import { SuitMark } from './PlayingCard';

/**
 * Firma discreta de la home. El corazón es el mismo palo de las cartas (SuitMark 'H') en latón,
 * puramente decorativo: el texto lo aportan `footer.before` / `footer.after`.
 */
export function SiteFooter() {
  const t = useTranslations('footer');
  return (
    <footer className='rise safe-px-5 safe-pb-3 relative z-1' style={{ animationDelay: '160ms' }}>
      <p className='group flex flex-wrap items-center justify-center gap-x-1.5 text-xs text-cream/60'>
        <span>{t('before')}</span>
        <svg
          viewBox='0 0 24 24'
          className='size-3.5 text-brass transition-transform duration-200 ease-out group-hover:scale-115 motion-reduce:transition-none'
          aria-hidden='true'
          focusable='false'>
          <SuitMark suit='H' x={12} y={12} size={24} />
        </svg>
        <span>{t('after')}</span>
        <a
          href='https://jetforgelabs.com'
          target='_blank'
          rel='noopener noreferrer'
          className='inline-flex min-h-11 items-center font-semibold text-cream/80 underline decoration-cream/25 underline-offset-4 transition-colors duration-150 hover:text-brass-soft hover:decoration-brass-soft/60'>
          Jetforge Labs
        </a>
      </p>
    </footer>
  );
}
