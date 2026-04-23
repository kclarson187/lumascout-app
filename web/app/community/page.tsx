import type { Metadata } from 'next';
import Link from 'next/link';
import { apiTry } from '@/lib/api';
import { LinkButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { PostCard } from '@/components/post-card';
import { Sparkles, ArrowRight, TrendingUp } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Community — Photographers sharing spots, stories, and shoots',
  description:
    'Browse real posts, field notes, and polls from photographers around the world on LumaScout.',
  alternates: { canonical: 'https://lumascout.app/community' },
  openGraph: {
    title: 'LumaScout Community',
    description: 'Real posts from photographers around the world.',
    url: 'https://lumascout.app/community',
  },
};

export const revalidate = 60;

export default async function CommunityPage({ searchParams }: { searchParams: Promise<{ category?: string; city?: string; page?: string }> }) {
  const sp = await searchParams;
  const category = sp?.category || 'all';
  const city = sp?.city || '';
  const page = Math.max(1, parseInt(sp?.page || '1', 10) || 1);

  const qs = new URLSearchParams({ limit: '20', page: String(page) });
  if (category && category !== 'all') qs.set('category', category);
  if (city) qs.set('city', city);

  const data = await apiTry<any>(`/api/posts?${qs.toString()}`, { items: [], total: 0, pages: 1 }, { auth: false, revalidate: 60 });
  const posts: any[] = Array.isArray(data) ? data : data?.items || [];
  const total: number = data?.total ?? posts.length;
  const pages: number = data?.pages ?? 1;

  const categories = [
    { k: 'all', l: 'All' },
    { k: 'spot', l: 'Spot notes' },
    { k: 'question', l: 'Questions' },
    { k: 'critique', l: 'Critique' },
    { k: 'gear', l: 'Gear' },
    { k: 'poll', l: 'Polls' },
    { k: 'news', l: 'News' },
  ];

  return (
    <>
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-border bg-bg grain">
        <div className="pointer-events-none absolute inset-0 bg-radial-spot" aria-hidden />
        <div className="mx-auto max-w-5xl px-6 pt-36 pb-14 text-center lg:pt-44">
          <Badge tone="brand">Community</Badge>
          <h1 className="mt-6 font-display text-5xl md:text-6xl lg:text-7xl tracking-tightest leading-[1.05]">
            Field notes from photographers <span className="text-brand">everywhere.</span>
          </h1>
          <p className="mt-5 text-lg text-ink-muted max-w-2xl mx-auto">Real updates from real shoots — conditions, spot changes, gear questions, polls, and shares. Fresh from the community, every day.</p>
          <div className="mt-8 flex justify-center gap-3">
            <LinkButton href="/register">Join free</LinkButton>
            <LinkButton href="/photographers" variant="outline">Browse creators</LinkButton>
          </div>
        </div>
      </div>

      {/* Category chips */}
      <div className="sticky top-16 z-20 border-b border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-6 py-3 flex gap-2 overflow-x-auto">
          {categories.map((c) => {
            const active = category === c.k;
            return (
              <Link key={c.k} href={`/community${c.k === 'all' ? '' : `?category=${c.k}`}`}
                className={`shrink-0 inline-flex items-center rounded-full border px-3.5 py-1.5 text-xs transition ${
                  active ? 'border-brand bg-brand/10 text-brand font-semibold' : 'border-border text-ink-muted hover:text-ink hover:border-strong'
                }`}>{c.l}</Link>
            );
          })}
        </div>
      </div>

      {/* Feed */}
      <section className="mx-auto max-w-3xl px-6 py-10 lg:py-14">
        {posts.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface-1 p-14 text-center">
            <Sparkles size={20} className="mx-auto text-brand" />
            <h3 className="mt-4 font-display text-2xl tracking-tightest">No posts yet in this view.</h3>
            <p className="mt-2 text-sm text-ink-muted">Try another category or check back soon.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-5">
              <p className="text-sm text-ink-muted"><TrendingUp size={14} className="inline -mt-0.5 mr-1" />{total.toLocaleString()} posts</p>
              <Link href="/register" className="text-sm text-ink-muted hover:text-ink">Post to the community →</Link>
            </div>
            <div className="space-y-5">
              {posts.map((p: any) => <PostCard key={p.post_id || p.id} post={p} />)}
            </div>

            {/* Pagination */}
            {pages > 1 && (
              <div className="mt-10 flex items-center justify-between">
                {page > 1 ? (
                  <Link href={`/community?${new URLSearchParams({ ...Object.fromEntries(qs), page: String(page - 1) }).toString()}`} className="text-sm text-ink-muted hover:text-ink">← Newer</Link>
                ) : <span />}
                <p className="text-xs text-ink-dim">Page {page} of {pages}</p>
                {page < pages ? (
                  <Link href={`/community?${new URLSearchParams({ ...Object.fromEntries(qs), page: String(page + 1) }).toString()}`} className="text-sm text-ink-muted hover:text-ink flex items-center gap-1">Older <ArrowRight size={13} /></Link>
                ) : <span />}
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
