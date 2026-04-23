import { apiTry } from '@/lib/api';
import { DashboardHeader, EmptyState } from '@/components/dashboard-parts';
import { LinkButton } from '@/components/ui/button';
import { MessageSquareText } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

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

export default async function MessagesPage() {
  const convos = await apiTry<any[]>('/api/me/conversations', [], { revalidate: 0 });
  const list: any[] = Array.isArray(convos) ? convos : convos?.items || [];

  return (
    <>
      <DashboardHeader
        eyebrow="Inbox"
        title="Messages"
        kicker="Direct conversations with photographers, buyers, and mentees."
        right={<LinkButton href="/photographers" variant="outline">Start a DM</LinkButton>}
      />
      <div className="px-6 lg:px-10 py-10">
        {list.length === 0 ? (
          <EmptyState
            icon={MessageSquareText}
            title="No conversations yet"
            body="Messaging live on iOS, Android, and web. Say hi to another photographer."
            cta={<LinkButton href="/photographers">Find photographers</LinkButton>}
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-surface-1 divide-y divide-border">
            {list.map((c: any, i: number) => {
              const other = c.other_user || c.peer || {};
              const preview = c.last_message_preview || c.last_message || '';
              const unread = c.unread_count || 0;
              return (
                <Link
                  key={c.conversation_id || i}
                  href={`/dashboard/messages/${c.conversation_id || ''}`}
                  className="group flex items-center gap-4 px-4 py-4 hover:bg-surface-2 transition-colors"
                >
                  <div
                    className="h-11 w-11 shrink-0 rounded-full bg-surface-2 bg-cover bg-center"
                    style={other.avatar_url ? { backgroundImage: `url(${other.avatar_url})` } : undefined}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-ink">{other.name || other.username || 'Photographer'}</p>
                      <span className="shrink-0 text-xs text-ink-dim">{timeAgo(c.last_message_at || c.updated_at)}</span>
                    </div>
                    <p className="truncate text-sm text-ink-muted mt-0.5">{preview || 'No messages yet'}</p>
                  </div>
                  {unread > 0 && (
                    <span className="shrink-0 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand text-black text-[10px] font-semibold px-1.5">
                      {unread}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
        <p className="mt-6 text-xs text-ink-dim">
          Full DM experience — compose, voice notes, image sharing — lives in the iOS and Android apps.
        </p>
      </div>
    </>
  );
}
