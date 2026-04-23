import { apiFetch, apiTry } from '@/lib/api';
import { DashboardHeader, EmptyState } from '@/components/dashboard-parts';
import { LinkButton } from '@/components/ui/button';
import { PostCard } from '@/components/post-card';
import { Sparkles } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function DashboardFeed() {
  // Require auth (handled by layout); still re-confirm so user object is available.
  await apiFetch<any>('/api/auth/me');

  const feed = await apiTry<any>('/api/feed/home?limit=30', { items: [] }, { revalidate: 0 });
  const posts: any[] = Array.isArray(feed) ? feed : feed?.items || feed?.posts || [];

  return (
    <>
      <DashboardHeader
        eyebrow="Community"
        title="Your feed"
        kicker="Updates from photographers you follow, nearby spots, and fresh community posts."
        right={<LinkButton href="/community" variant="outline">Explore all</LinkButton>}
      />
      <div className="px-6 lg:px-10 pb-16">
        {posts.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="Your feed is quiet"
            body="Follow photographers, save spots, and post from the mobile app to personalize this view."
            cta={<LinkButton href="/community">Browse community</LinkButton>}
          />
        ) : (
          <div className="mx-auto max-w-2xl space-y-5">
            {posts.map((p: any) => <PostCard key={p.post_id || p.id} post={p} />)}
          </div>
        )}
      </div>
    </>
  );
}
