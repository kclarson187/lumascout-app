'use client';

import Link from 'next/link';
import { FormEvent, useState, useTransition } from 'react';
import { commentOnPost } from '@/app/community/_actions';
import { Loader2, Send, ShieldCheck } from 'lucide-react';

function timeAgo(iso?: string) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

export function CommentsClient({ postId, initialComments, authed }: { postId: string; initialComments: any[]; authed: boolean }) {
  const [comments, setComments] = useState(initialComments);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, startT] = useTransition();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setErr(null);
    startT(async () => {
      try {
        const c: any = await commentOnPost(postId, text);
        const optimistic = c?.comment_id ? c : { comment_id: `tmp_${Date.now()}`, text: text.trim(), created_at: new Date().toISOString(), author: { name: 'You' } };
        setComments((prev) => [optimistic, ...prev]);
        setText('');
      } catch (e: any) { setErr(e?.message || 'Could not post'); }
    });
  }

  return (
    <>
      {authed && (
        <form onSubmit={submit} className="px-5 pt-4 pb-4 border-b border-border flex items-start gap-3">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Add a comment…"
            className="flex-1 rounded-xl border border-border bg-bg px-4 py-3 text-sm text-ink placeholder:text-ink-dim outline-none focus:border-strong resize-y" />
          <button disabled={busy || !text.trim()} className="inline-flex items-center gap-1.5 rounded-full bg-brand text-black font-semibold px-4 py-2.5 text-sm disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Post
          </button>
        </form>
      )}
      {err && <p className="px-5 pt-3 text-xs text-danger">{err}</p>}

      {comments.length === 0 ? (
        <div className="p-10 text-center text-sm text-ink-muted">Be the first to comment.</div>
      ) : (
        <ul className="divide-y divide-border">
          {comments.map((c: any) => {
            const a = c.author || { name: c.author_name, username: c.author_username, avatar_url: c.author_avatar_url, verification_status: c.author_verification_status };
            return (
              <li key={c.comment_id} className="px-5 py-4 flex items-start gap-3">
                <Link href={a.username ? `/u/${a.username}` : '#'} className="h-9 w-9 shrink-0 rounded-full bg-surface-2 bg-cover bg-center"
                  style={a.avatar_url ? { backgroundImage: `url(${a.avatar_url})` } : undefined} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Link href={a.username ? `/u/${a.username}` : '#'} className="truncate text-sm font-semibold text-ink hover:text-brand">{a.name || `@${a.username || 'user'}`}</Link>
                    {a.verification_status === 'verified' && <ShieldCheck size={11} className="text-brand shrink-0" />}
                    <span className="text-xs text-ink-dim ml-1">{timeAgo(c.created_at)}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink whitespace-pre-wrap">{c.text || c.content}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
