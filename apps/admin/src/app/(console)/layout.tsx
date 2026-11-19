import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Shell } from '@/components/shell';
import { COOKIE } from '@/lib/session';

/** Every console page requires a staff session; the admin API re-checks the token and RBAC on each call. */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  if (!(await cookies()).get(COOKIE)) redirect('/login');
  return <Shell>{children}</Shell>;
}
