import Link from 'next/link';
import { apiTry } from '@/lib/api';
import { DashboardHeader, EmptyState } from '@/components/dashboard-parts';
import { LinkButton } from '@/components/ui/button';
import { Bookmark, Camera, MapPin } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function SavedSpotsPage() {
  const saved = await apiTry<any[]>('/api/me/saved', [], { revalidate: 0 });
  const list: any[] = Array.isArray(saved) ? saved : [];

  return (
    <>
      <DashboardHeader
        eyebrow="Library"
        title="Saved spots"
        kicker="Every location you’ve bookmarked for a future shoot."
        right={<LinkButton href="/dashboard/map">Open map planner</LinkButton>}
      />
      <div className="px-6 lg:px-10 py-10">
        {list.length === 0 ? (
          <EmptyState
            icon={Bookmark}
            title="No saves yet"
            body="Tap the bookmark icon on any spot in the app or map planner to save it here."
            cta={<LinkButton href="/dashboard/map">Discover spots</LinkButton>}
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {list.map((spot: any, i: number) => {
              const cover = (spot.images || []).find((im: any) => im.is_cover) || (spot.images || [])[0] || {};
              const loc = [spot.city, spot.state].filter(Boolean).join(', ');
              return (
                <Link
                  key={spot.spot_id || i}
                  href={`/spots/${spot.slug || spot.spot_id}`}
                  className="group overflow-hidden rounded-2xl border border-border bg-surface-1 transition-all hover:border-strong hover:-translate-y-0.5"
                >
                  <div
                    className="aspect-[4/3] bg-[linear-gradient(135deg,#1A1206,#2B1A08)] bg-cover bg-center grid place-items-center"
                    style={cover.image_url ? { backgroundImage: `url(${cover.image_url})` } : undefined}
                  >
                    {!cover.image_url && <Camera size={28} className="text-ink-dim" />}
                  </div>
                  <div className="p-4">
                    <p className="font-semibold text-ink line-clamp-1">{spot.name || spot.title}</p>
                    {loc && <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted"><MapPin size={11} />{loc}</p>}
                    {spot.type_tag && (
                      <p className="mt-3 inline-block text-[10px] uppercase tracking-widest text-ink-dim border border-border rounded-full px-2.5 py-1">
                        {spot.type_tag}
                      </p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
