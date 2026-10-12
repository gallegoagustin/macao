'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

interface Props {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmación modal accesible (Escape cancela, el foco empieza en "Cancelar"). */
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }: Props) {
  const t = useTranslations('common');
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className='fixed inset-0 z-[70] grid place-items-center bg-black/65 p-5 backdrop-blur-[2px]'
      onClick={onCancel}>
      <div
        role='alertdialog'
        aria-modal='true'
        aria-labelledby='confirm-title'
        aria-describedby='confirm-body'
        className='rise w-full max-w-sm rounded-[24px] border border-brass/40 bg-felt-900 p-6 shadow-2xl'
        onClick={(e) => e.stopPropagation()}>
        <h2 id='confirm-title' className='font-display text-2xl font-black text-brass-soft'>
          {title}
        </h2>
        <p id='confirm-body' className='mt-2 text-cream/75'>
          {body}
        </p>
        <div className='mt-6 flex gap-3'>
          <button ref={cancelRef} className='btn btn-ghost flex-1' onClick={onCancel}>
            {t('cancel')}
          </button>
          <button className='btn btn-ruby flex-1' onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
