'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { togglePostLike, voteOnPoll, reportPost } from '@/app/community/_actions';
import { Heart, MessageCircle, ShieldCheck, MapPin, BarChart3, MoreHorizontal, Flag, Loader2 } from 'lucide-react';

function timeAgo(iso?: string) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

export function PostCard({ post, showFollow = true, compact = false }: { post: any; showFollow?: boolean; compact?: boolean }) {
  const id = post.post_id || post.id;
  const author = post.author || { name: post.author_name, username: post.author_username, avatar_url: post.author_avatar_url, verification_status: post.author_verification_status };
  const type = (post.type || (Array.isArray(post.poll_options) && post.poll_options.length ? 'poll' : 'post')).toLowerCase();
  const [liked, setLiked] = useState(!!post.liked_by_viewer || !!post.viewer_liked);
  const [likes, setLikes] = useState<number>(post.like_count ?? post.likes_count ?? 0);
  const [menu, setMenu] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [_, startTransition] = useTransition();

  function onLike() {
    const wasLiked = liked;
    setLiked(!wasLiked); setLikes((n) => n + (wasLiked ? -1 : 1)); setErr(null);
    startTransition(async () => {
      try { await togglePostLike(id, wasLiked); }
      catch (e: any) { setLiked(wasLiked); setLikes((n) => n + (wasLiked ? 1 : -1)); setErr(e?.message || 'Sign in to like'); }
    });
  }

  function onReport() {
    const reason = prompt('Why report this post?');
    if (!reason) return;
    startTransition(async () => {
      try { await reportPost(id, reason); alert('Thanks for reporting — our team will review it.'); }
      catch (e: any) { alert(e?.message || 'Could not report.'); }
    });
  }

  const city = [post.city, post.state].filter(Boolean).join(', ');
  const images: any[] = post.images || post.photos || [];
  const cover = images[0];

  return (
    <article className={`rounded-2xl border border-border bg-surface-1 overflow-hidden ${compact ? '' : 'hover:border-strong transition-colors'}`}>
      {/* Header */}
      <header className="flex items-center gap-3 px-5 pt-4">
        <Link href={author.username ? `/u/${author.username}` : '#'}
          className="h-10 w-10 shrink-0 rounded-full bg-surface-2 bg-cover bg-center"
          style={author.avatar_url ? { backgroundImage: `url(${author.avatar_url})` } : undefined}
          aria-label={author.name || 'Photographer'} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link href={author.username ? `/u/${author.username}` : '#'} className="truncate text-sm font-semibold text-ink hover:text-brand">
              {author.name || `@${author.username || 'user'}`}
            </Link>
            {author.verification_status === 'verified' && <ShieldCheck size={12} className="text-brand shrink-0" />}
            {type === 'poll' && <span className="text-[10px] uppercase tracking-widest text-ink-muted border border-border rounded-full px-2 py-0.5 ml-1"><BarChart3 size={9} className="inline -mt-0.5 mr-1" />Poll</span>}
          </div>
          <p className="truncate text-xs text-ink-muted">@{author.username || '—'}{city && <> · <MapPin size={10} className="inline -mt-0.5" /> {city}</>} · {timeAgo(post.created_at)}</p>
        </div>
        <div className="relative">
          <button aria-label="More" onClick={() => setMenu((m) => !m)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-surface-2 text-ink-muted">
            <MoreHorizontal size={16} />
          </button>
          {menu && (
            <div onMouseLeave={() => setMenu(false)} className="absolute right-0 top-9 z-10 min-w-[160px] rounded-xl border border-border bg-bg/95 backdrop-blur shadow-glass">
              <button onClick={() => { setMenu(false); onReport(); }} className="flex items-center gap-2 w-full text-left px-3 py-2 text-xs text-ink-muted hover:text-danger hover:bg-surface-2">
                <Flag size={12} /> Report
              </button>
              {showFollow && author.username && (
                <Link href={`/u/${author.username}`} className="block px-3 py-2 text-xs text-ink-muted hover:text-ink hover:bg-surface-2">View profile</Link>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Body */}
      <Link href={`/post/${id}`} className="block">
        {post.title && <h3 className="px-5 mt-3 font-display text-xl tracking-tighter text-ink">{post.title}</h3>}
        {(post.content || post.text || post.caption) && (
          <p className={`px-5 mt-2 text-sm text-ink-muted ${compact ? 'line-clamp-3' : 'line-clamp-5'} whitespace-pre-wrap`}>{post.content || post.text || post.caption}</p>
        )}

        {/* Cover / images */}
        {cover?.image_url && (
          <div className="mt-4 aspect-[16/9] bg-[linear-gradient(135deg,#1A1206,#2B1A08)] bg-cover bg-center" style={{ backgroundImage: `url(${cover.image_url})` }} />
        )}

        {/* Poll */}
        {type === 'poll' && Array.isArray(post.poll_options) && (
          <PollOptions postId={id} options={post.poll_options} voted={post.viewer_voted_index} totalVotes={post.poll_total_votes ?? 0} />
        )}
      </Link>

      {/* Footer */}
      <footer className="flex items-center gap-4 px-5 py-3 border-t border-border">
        <button onClick={onLike} className={`inline-flex items-center gap-1.5 text-xs transition-colors ${liked ? 'text-danger' : 'text-ink-muted hover:text-ink'}`}>
          <Heart size={14} className={liked ? 'fill-danger' : ''} /> {likes.toLocaleString()}
        </button>
        <Link href={`/post/${id}`} className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink">
          <MessageCircle size={14} /> {(post.comment_count ?? post.comments_count ?? 0).toLocaleString()}
        </Link>
        {err && <span className="text-xs text-danger ml-auto">{err}</span>}
      </footer>
    </article>
  );
}

function PollOptions({ postId, options, voted, totalVotes }: { postId: string; options: any[]; voted?: number; totalVotes: number }) {
  const [localVoted, setLocalVoted] = useState<number | undefined>(voted);
  const [busy, startT] = useTransition();
  return (
    <div className="mt-4 px-5 pb-1 space-y-2">
      {options.map((opt, i) => {
        const count = opt.votes ?? opt.vote_count ?? 0;
        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        const isMine = localVoted === i;
        const hasVoted = localVoted !== undefined;
        return (
          <button key={i} disabled={busy || hasVoted}
            onClick={(e) => { e.preventDefault(); if (hasVoted) return; setLocalVoted(i); startT(async () => { try { await voteOnPoll(postId, i); } catch { setLocalVoted(undefined); } }); }}
            className={`relative w-full rounded-xl border text-left px-4 py-2.5 text-sm overflow-hidden transition ${
              isMine ? 'border-brand/60 bg-brand/5 text-ink' : hasVoted ? 'border-border bg-surface-2 text-ink-muted' : 'border-border bg-surface-2 text-ink hover:border-strong'
            }`}>
            {hasVoted && <span className="absolute inset-y-0 left-0 bg-brand/10" style={{ width: `${pct}%` }} />}
            <span className="relative flex items-center justify-between">
              <span>{opt.label || opt.text || opt}</span>
              {hasVoted && <span className="text-xs text-ink-muted">{pct}%</span>}
            </span>
          </button>
        );
      })}
      <p className="text-[11px] text-ink-dim">{totalVotes.toLocaleString()} vote{totalVotes === 1 ? '' : 's'}</p>
    </div>
  );
}
