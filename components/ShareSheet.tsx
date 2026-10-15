'use client';

import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useRef, useState } from 'react';

interface Props {
  code: string;
  onClose: () => void;
}

const OPTION = 'btn btn-ghost w-full justify-start gap-3 px-4 text-left';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox='0 0 24 24'
      className='size-5 shrink-0'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'>
      {children}
    </svg>
  );
}

/**
 * Hoja para compartir el enlace directo a la sala: bottom sheet en móvil, diálogo centrado en escritorio.
 * Escape, clic fuera y botón cerrar la cierran; el foco vuelve al disparador al desmontarse.
 */
export function ShareSheet({ code, onClose }: Props) {
  const t = useTranslations('lobby.shareSheet');
  const tLobby = useTranslations('lobby');
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLAnchorElement>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [canNativeShare] = useState(() => typeof navigator !== 'undefined' && typeof navigator.share === 'function');

  // Se monta solo tras un clic, así que `location` ya existe.
  const url = `${location.origin}/sala/${code}`;
  const text = tLobby('shareText', { code });
  const waHref = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
  const tgHref = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input');
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    if (!copiedLink) return;
    const id = setTimeout(() => setCopiedLink(false), 1800);
    return () => clearTimeout(id);
  }, [copiedLink]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyFailed(false);
      setCopiedLink(true);
    } catch {
      setCopiedLink(false);
      setCopyFailed(true);
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: 'Macao', text, url });
      onClose();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setCopyFailed(true);
    }
  }

  return (
    <div
      className='fixed inset-0 z-[70] flex items-end justify-center bg-black/65 backdrop-blur-[2px] sm:items-center sm:p-5'
      onClick={onClose}>
      <div
        ref={dialogRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby='share-title'
        className='rise safe-pb-6 w-full max-w-md rounded-t-[24px] border border-brass/40 bg-felt-900 p-5 shadow-2xl sm:rounded-[24px] sm:p-6'
        onClick={(e) => e.stopPropagation()}>
        <div className='flex items-center justify-between gap-3'>
          <h2 id='share-title' className='font-display text-2xl font-black text-brass-soft'>
            {t('title')}
          </h2>
          <button
            type='button'
            className='grid size-11 shrink-0 place-items-center rounded-full text-cream/70 hover:bg-white/10'
            aria-label={t('close')}
            onClick={onClose}>
            <Icon>
              <path d='M6 6l12 12M18 6L6 18' />
            </Icon>
          </button>
        </div>

        <div className='mt-4 flex flex-col gap-2'>
          <a ref={firstRef} className={OPTION} href={waHref} target='_blank' rel='noopener noreferrer'>
            <Icon>
              <path d='M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5z' />
              <path d='M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 .8a4 4 0 0 1-2-2l.8-1-1-2-1.3.2z' />
            </Icon>
            {t('whatsapp')}
            <span className='sr-only'> {t('newTab')}</span>
          </a>
          <a className={OPTION} href={tgHref} target='_blank' rel='noopener noreferrer'>
            <Icon>
              <path d='M21 4L3 11l6 2.2L11 20l3-4.5 4.5 3.5L21 4z' />
              <path d='M9 13.2L21 4' />
            </Icon>
            {t('telegram')}
            <span className='sr-only'> {t('newTab')}</span>
          </a>
          <button type='button' className={OPTION} onClick={copyLink}>
            <Icon>
              {copiedLink ? (
                <path d='M5 12.5l4.5 4.5L19 7.5' />
              ) : (
                <>
                  <rect x='9' y='9' width='11' height='11' rx='2' />
                  <path d='M5 15V6a2 2 0 0 1 2-2h9' />
                </>
              )}
            </Icon>
            {copiedLink ? t('linkCopied') : t('copyLink')}
          </button>
          {canNativeShare && (
            <button type='button' className={OPTION} onClick={nativeShare}>
              <Icon>
                <circle cx='6' cy='12' r='2' />
                <circle cx='18' cy='6' r='2' />
                <circle cx='18' cy='18' r='2' />
                <path d='M8 11l8-4M8 13l8 4' />
              </Icon>
              {t('more')}
            </button>
          )}
        </div>

        <label className='mt-4 block'>
          <span className='text-sm font-semibold text-cream/70'>{t('linkLabel')}</span>
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className='mt-1 w-full rounded-xl border border-cream/25 bg-black/30 px-3 text-base text-cream/90'
          />
        </label>
        <p role='status' className='mt-2 min-h-5 text-sm font-semibold text-brass-soft'>
          {copiedLink ? t('linkCopied') : ''}
          {copyFailed ? <span className='text-[#ff9d8f]'>{t('copyFailed')}</span> : ''}
        </p>
      </div>
    </div>
  );
}
