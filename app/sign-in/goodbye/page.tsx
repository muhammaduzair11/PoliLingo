import type { Metadata } from 'next';
import { AuthFrame } from '@/components/account/auth-frame';
import { Goodbye } from '@/components/account/goodbye';

export const metadata: Metadata = {
  title: 'Goodbye for now',
  robots: { index: false, follow: false },
};

/**
 * Where deleteMyAccount (app/account/actions.ts) sends someone once their
 * account is gone. It lives under /sign-in, outside the proxy's matcher, so
 * it renders for a visitor who is now signed out; nothing here reads the
 * session or the database.
 */
export default async function GoodbyePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reason } = await searchParams;
  return (
    <AuthFrame back={{ href: '/learn', label: 'Back to your map' }} hardBack>
      <Goodbye reason={reason === 'age' ? 'age' : 'deleted'} />
    </AuthFrame>
  );
}
