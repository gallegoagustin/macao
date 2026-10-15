import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RoomClient } from '@/components/RoomClient';

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const t = await getTranslations('meta');
  const values = { code: code.toUpperCase() };
  return { title: t('roomTitleWithCode', values), description: t('roomDescription', values) };
}

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <RoomClient code={code.toUpperCase()} />;
}
