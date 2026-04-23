import { apiTry } from '@/lib/api';
import { DashboardHeader } from '@/components/dashboard-parts';
import { LinkButton } from '@/components/ui/button';
import { MapPlanner } from '@/components/map-planner';

export const dynamic = 'force-dynamic';

export default async function MapPlannerPage() {
  // Fetch saved + public spots to populate the map.
  const [saved, my] = await Promise.all([
    apiTry<any[]>('/api/me/saved', [], { revalidate: 0 }),
    apiTry<any[]>('/api/me/spots', [], { revalidate: 0 }),
  ]);

  const normalize = (arr: any[]): any[] =>
    (Array.isArray(arr) ? arr : []).filter((s) =>
      (typeof s.lat === 'number' && typeof s.lng === 'number') ||
      (typeof s?.location?.lat === 'number' && typeof s?.location?.lng === 'number') ||
      (typeof s.latitude === 'number' && typeof s.longitude === 'number'),
    );

  const spots = [
    ...normalize(saved).map((s) => ({ ...s, _source: 'saved' })),
    ...normalize(my).map((s) => ({ ...s, _source: 'mine' })),
  ];

  // Also fetch a small set of public/featured spots so the map is never empty.
  const publicSpots = await apiTry<any[]>('/api/spots?limit=100', [], { revalidate: 300 });
  const extra = normalize(Array.isArray(publicSpots) ? publicSpots : (publicSpots as any)?.items || []).map((s) => ({ ...s, _source: 'public' }));

  const deduped = Array.from(new Map([...spots, ...extra].map((s) => [s.spot_id || `${s.lat},${s.lng}`, s])).values());

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

  return (
    <>
      <DashboardHeader
        eyebrow="Plan"
        title="Map planner"
        kicker={`${deduped.length.toLocaleString()} spots on the map. Click a pin to preview. Drag to explore.`}
        right={<LinkButton href="/dashboard/saved" variant="outline">View saves</LinkButton>}
      />
      <div className="p-0">
        <div className="relative h-[calc(100vh-220px)] min-h-[520px] border-t border-border">
          <MapPlanner token={token} spots={deduped} />
        </div>
      </div>
    </>
  );
}
