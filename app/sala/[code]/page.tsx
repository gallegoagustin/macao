import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RoomClient } from '@/components/RoomClient';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return { title: t('roomTitle') };
}

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <RoomClient code={code.toUpperCase()} />;
}
