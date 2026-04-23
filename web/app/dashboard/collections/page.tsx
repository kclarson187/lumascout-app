import Link from 'next/link';
import { apiTry } from '@/lib/api';
import { DashboardHeader, EmptyState } from '@/components/dashboard-parts';
import { LinkButton } from '@/components/ui/button';
import { Folder, Lock, Globe } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function CollectionsPage() {
  const cols = await apiTry<any[]>('/api/me/collections', [], { revalidate: 0 });
  const list: any[] = Array.isArray(cols) ? cols : [];

  return (
    <>
      <DashboardHeader
        eyebrow="Organize"
        title="Collections"
        kicker="Trip plans, mood boards, and portfolio sets of your saved locations."
        right={<LinkButton href="/dashboard/saved">View saves</LinkButton>}
      />
      <div className="px-6 lg:px-10 py-10">
        {list.length === 0 ? (
          <EmptyState
            icon={Folder}
            title="No collections yet"
            body="Group your saved spots into trip plans or portfolio sets from the mobile app."
            cta={<LinkButton href="/dashboard/saved" variant="outline">Open saved</LinkButton>}
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((c: any) => (
              <div key={c.collection_id} className="group overflow-hidden rounded-2xl border border-border bg-surface-1 transition-all hover:border-strong hover:-translate-y-0.5">
                <div
                  className="aspect-[16/10] bg-[linear-gradient(135deg,#1A1206,#2B1A08)] bg-cover bg-center"
                  style={c.cover_image_url ? { backgroundImage: `url(${c.cover_image_url})` } : undefined}
                />
                <div className="p-5">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-ink line-clamp-1 flex-1">{c.name}</p>
                    {c.privacy_mode === 'private' ? <Lock size={12} className="text-ink-dim" /> : <Globe size={12} className="text-ink-dim" />}
                  </div>
                  {c.description && <p className="mt-1 text-xs text-ink-muted line-clamp-2">{c.description}</p>}
                  <div className="mt-3 flex items-center gap-3 text-xs text-ink-muted">
                    <span>{(c.count ?? (c.spot_ids?.length || 0))} spots</span>
                    {c.cities?.length > 0 && <span>· {c.cities.slice(0, 2).join(', ')}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
