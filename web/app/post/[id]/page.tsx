import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiTry } from '@/lib/api';
import { cookies } from 'next/headers';
import { PostCard } from '@/components/post-card';
import { CommentsClient } from './_client';
import { Badge } from '@/components/ui/primitives';
import { LinkButton } from '@/components/ui/button';
import { MessageCircle, ArrowLeft } from 'lucide-react';

export const revalidate = 30;

async function fetchPost(id: string) {
  return await apiTry<any>(`/api/posts/${encodeURIComponent(id)}`, null, { revalidate: 30 });
}

async function fetchComments(id: string) {
  return await apiTry<any>(`/api/posts/${encodeURIComponent(id)}/comments?limit=200`, { items: [] }, { revalidate: 0 });
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const post = await fetchPost(id);
  if (!post) return { title: 'Post not found', robots: { index: false, follow: false } };
  const title = post.title || (post.content || post.text || 'Post').slice(0, 70);
  const desc = (post.content || post.text || '').slice(0, 160) || 'Photographer field note on LumaScout.';
  const img = (post.images || [])[0]?.image_url;
  return {
    title,
    description: desc,
    alternates: { canonical: `https://lumascout.app/post/${id}` },
    openGraph: { title, description: desc, url: `https://lumascout.app/post/${id}`, images: img ? [{ url: img }] : undefined },
  };
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [post, comments, authed] = await Promise.all([
    fetchPost(id),
    fetchComments(id),
    (async () => {
      const c = await cookies();
      return !!c.get(process.env.AUTH_COOKIE_NAME || 'lumascout_session')?.value;
    })(),
  ]);
  if (!post || (!post.post_id && !post.id)) return notFound();

  const list: any[] = Array.isArray(comments) ? comments : comments?.items || [];

  return (
    <>
      <div className="border-b border-border bg-bg">
        <div className="mx-auto max-w-3xl px-6 pt-28 pb-6">
          <Link href="/community" className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink">
            <ArrowLeft size={12} /> Back to community
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-6 py-10 space-y-8">
        <PostCard post={post} compact={false} />

        {/* Comments */}
        <section className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold flex items-center gap-2"><MessageCircle size={14} className="text-ink-muted" /> Comments <span className="text-ink-dim font-normal">({list.length})</span></h2>
            {!authed && <LinkButton href={`/login?next=/post/${id}`} variant="outline">Sign in to reply</LinkButton>}
          </div>

          <CommentsClient postId={id} initialComments={list} authed={authed} />
        </section>

        {!authed && (
          <div className="rounded-2xl border border-brand/30 bg-brand/5 p-6 text-center">
            <Badge tone="brand">Join the conversation</Badge>
            <h3 className="mt-3 font-display text-2xl tracking-tightest">Create a free account</h3>
            <p className="mt-2 text-sm text-ink-muted">Like, comment, and follow photographers from iOS, Android, and the web.</p>
            <div className="mt-4 flex justify-center gap-3">
              <LinkButton href="/register">Join free</LinkButton>
              <LinkButton href={`/login?next=/post/${id}`} variant="outline">Sign in</LinkButton>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
