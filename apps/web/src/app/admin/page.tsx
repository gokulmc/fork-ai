import { AdminDashboard } from '@/components/admin/AdminDashboard';

export const metadata = { title: 'Admin', robots: { index: false, follow: false } };

// Auth-gated client dashboard — never statically prerender it (a build-time
// static HTML hydrating against a live session caused hosted-only blank pages).
export const dynamic = 'force-dynamic';

export default function AdminPage() {
  return <AdminDashboard />;
}
