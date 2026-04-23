'use client';

import { useState, useTransition } from 'react';
import { moderateCommunity, deletePost } from '../_actions';
import { Trash2, Lock, Star, ShieldBan, Loader2, AlertTriangle, MessageSquare, BarChart3, MessageCircle } from 'lucide-react';

export function CommunityModerationClient({ initialItems }: { initialItems: any[] }) {
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [_, startTransition] = useTransition();

  async function runAction(id: string, label: string, fn: () => Promise<any>, removeOnSuccess = false) {
    setBusy(`${id}:${label}`); setErr(null);
    try {
      await fn();
      if (removeOnSuccess) setItems((prev) => prev.filter((p) => (p.post_id || p.poll_id || p.comment_id || p.id) !== id));
    } catch (e: any) { setErr(e?.message || 'Action failed'); } finally { setBusy(null); }
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface-1 p-14 text-center">
        <p className="font-display text-xl tracking-tighter">Nothing to moderate.</p>
        <p className="mt-2 text-sm text-ink-muted">The community is quiet — or well-behaved.</p>
      </div>
    );
  }

  return (
    <>
      {err && (
        <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 text-danger text-sm px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={14} /> {err}
        </div>
      )}
      <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        <ul className="divide-y divide-border">
          {items.map((i) => {
            const type = (i.type || (i.post_id ? 'post' : i.poll_id ? 'poll' : 'comment')).toLowerCase();
            const id = i.post_id || i.poll_id || i.comment_id || i.id;
            const TypeIcon = type === 'poll' ? BarChart3 : type === 'comment' ? MessageCircle : MessageSquare;
            const flagged = (i.flag_count ?? i.flagged ?? 0) > 0;
            return (
              <li key={id} className="px-5 py-4">
                <div className="flex items-start gap-4">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${flagged ? 'border-danger/30 bg-danger/10 text-danger' : 'border-border bg-surface-2 text-ink-muted'}`}><TypeIcon size={14} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] uppercase tracking-widest text-ink-muted border border-border rounded-full px-2 py-0.5">{type}</span>
                      {flagged && <span className="text-[10px] uppercase tracking-widest text-danger border border-danger/30 bg-danger/10 rounded-full px-2 py-0.5">{(i.flag_count ?? 1)} flag{(i.flag_count ?? 1) > 1 ? 's' : ''}</span>}
                      <span className="text-xs text-ink-dim">@{i.author_username || i.user_username || 'user'}</span>
                    </div>
                    <p className="mt-2 text-sm text-ink line-clamp-3">{i.content || i.text || i.caption || i.question || '—'}</p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {type === 'post' ? (
                      <>
                        <Action onClick={() => startTransition(() => runAction(id, 'feature', () => moderateCommunity({ target_type: 'post', target_id: id, action: 'feature' })))} busy={busy === `${id}:feature`} icon={Star}>Feature</Action>
                        <Action onClick={() => startTransition(() => runAction(id, 'lock', () => moderateCommunity({ target_type: 'post', target_id: id, action: 'lock_comments' })))} busy={busy === `${id}:lock`} icon={Lock}>Lock comments</Action>
                        <Action tone="danger" onClick={() => { const reason = prompt('Reason?') || ''; startTransition(() => runAction(id, 'delete', () => deletePost(id, reason), true)); }} busy={busy === `${id}:delete`} icon={Trash2}>Remove</Action>
                      </>
                    ) : (
                      <Action tone="danger" onClick={() => { const reason = prompt('Reason?') || ''; startTransition(() => runAction(id, 'delete', () => moderateCommunity({ target_type: type, target_id: id, action: 'remove', reason }), true)); }} busy={busy === `${id}:delete`} icon={Trash2}>Remove</Action>
                    )}
                    <Action tone="danger" onClick={() => { const reason = prompt('Suspend author: reason?') || 'policy violation'; startTransition(() => runAction(id, 'suspend', () => moderateCommunity({ target_type: 'user', target_id: i.author_user_id || i.user_id, action: 'suspend', reason }))); }} busy={busy === `${id}:suspend`} icon={ShieldBan}>Suspend author</Action>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

function Action({ children, onClick, busy, tone, icon: Icon }: any) {
  const toneClass = tone === 'danger' ? 'border-danger/30 bg-danger/10 text-danger hover:bg-danger/20' :
                   tone === 'success' ? 'border-success/30 bg-success/10 text-success hover:bg-success/20' :
                   'border-border bg-surface-2 text-ink hover:border-strong';
  return (
    <button onClick={onClick} disabled={busy} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold disabled:opacity-60 transition ${toneClass}`}>
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
      {children}
    </button>
  );
}
