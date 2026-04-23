'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import Link from 'next/link';
import { MapPin, X, Camera } from 'lucide-react';

type Spot = any;

function getCoords(s: Spot): [number, number] | null {
  const lat = s.lat ?? s.latitude ?? s?.location?.lat;
  const lng = s.lng ?? s.longitude ?? s?.location?.lng;
  if (typeof lat === 'number' && typeof lng === 'number') return [lng, lat];
  return null;
}

export function MapPlanner({ token, spots }: { token: string; spots: Spot[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [selected, setSelected] = useState<Spot | null>(null);
  const [filter, setFilter] = useState<'all' | 'saved' | 'mine' | 'public'>('all');

  useEffect(() => {
    if (!containerRef.current || !token) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-98.5, 39.8],
      zoom: 3,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers: mapboxgl.Marker[] = [];
    const filtered = filter === 'all' ? spots : spots.filter((s) => s._source === filter);

    const bounds = new mapboxgl.LngLatBounds();
    filtered.forEach((s) => {
      const coords = getCoords(s);
      if (!coords) return;
      const el = document.createElement('button');
      el.className = 'ls-marker';
      el.setAttribute('aria-label', s.name || s.title || 'Spot');
      el.innerHTML = `<span></span>`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setSelected(s);
        map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 10), speed: 1.2 });
      });
      const m = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat(coords).addTo(map);
      markers.push(m);
      bounds.extend(coords);
    });

    if (filtered.length >= 1 && !bounds.isEmpty()) {
      try { map.fitBounds(bounds, { padding: 80, maxZoom: 8, duration: 600 }); } catch { /* noop */ }
    }

    return () => { markers.forEach((m) => m.remove()); };
  }, [spots, filter]);

  if (!token) {
    return (
      <div className="grid h-full place-items-center bg-surface-1 p-10">
        <div className="text-center max-w-md">
          <MapPin size={32} className="mx-auto text-brand" />
          <h3 className="mt-4 font-display text-2xl">Mapbox token missing</h3>
          <p className="mt-2 text-sm text-ink-muted">Set <code className="text-brand">NEXT_PUBLIC_MAPBOX_TOKEN</code> in <code>/app/web/.env.local</code> to enable the map.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Filter chips */}
      <div className="absolute top-4 left-4 flex gap-2 rounded-full border border-border bg-bg/80 backdrop-blur p-1 shadow-glass">
        {([
          { k: 'all', l: 'All' },
          { k: 'saved', l: 'Saved' },
          { k: 'mine', l: 'My spots' },
          { k: 'public', l: 'Public' },
        ] as const).map((t) => (
          <button
            key={t.k}
            onClick={() => setFilter(t.k)}
            className={`px-3 py-1.5 text-xs rounded-full transition ${
              filter === t.k ? 'bg-brand text-black font-semibold' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {t.l}
          </button>
        ))}
      </div>

      {/* Spot preview panel */}
      {selected && (
        <div className="absolute bottom-4 left-4 right-4 md:right-auto md:w-96 rounded-2xl border border-border bg-bg/90 backdrop-blur shadow-glass overflow-hidden">
          <div
            className="aspect-[16/10] bg-[linear-gradient(135deg,#1A1206,#2B1A08)] bg-cover bg-center"
            style={(() => {
              const img = (selected.images || []).find((im: any) => im.is_cover) || (selected.images || [])[0];
              return img?.image_url ? { backgroundImage: `url(${img.image_url})` } : undefined;
            })()}
          />
          <button
            onClick={() => setSelected(null)}
            aria-label="Close"
            className="absolute top-3 right-3 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-ink hover:bg-black/80"
          >
            <X size={14} />
          </button>
          <div className="p-4">
            <p className="font-display text-xl tracking-tighter">{selected.name || selected.title || 'Spot'}</p>
            <p className="mt-1 text-xs text-ink-muted">{[selected.city, selected.state, selected.country].filter(Boolean).join(', ')}</p>
            {selected.description && <p className="mt-3 text-sm text-ink-muted line-clamp-3">{selected.description}</p>}
            <div className="mt-4 flex gap-2">
              <Link href={`/spots/${selected.slug || selected.spot_id}`} className="flex-1 text-center rounded-full bg-brand text-black text-sm font-semibold px-4 py-2 hover:bg-brand-600">
                View details
              </Link>
              <button className="rounded-full border border-border px-3 py-2 text-ink-muted hover:text-ink" aria-label="Photo">
                <Camera size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .ls-marker {
          border: 0;
          padding: 0;
          background: transparent;
          cursor: pointer;
          display: block;
          width: 18px;
          height: 18px;
          position: relative;
        }
        .ls-marker span {
          position: absolute;
          inset: 0;
          border-radius: 999px;
          background: radial-gradient(circle at 30% 30%, #F5A623, #E06400);
          box-shadow: 0 0 0 3px rgba(245,166,35,0.22), 0 4px 20px -4px rgba(245,166,35,0.6);
          transition: transform .15s ease, box-shadow .15s ease;
        }
        .ls-marker:hover span { transform: scale(1.2); box-shadow: 0 0 0 5px rgba(245,166,35,0.28), 0 8px 24px -4px rgba(245,166,35,0.8); }
        .mapboxgl-canvas:focus { outline: none; }
        .mapboxgl-ctrl-attrib { background: rgba(10,10,10,0.6) !important; color: rgba(255,255,255,0.5) !important; }
        .mapboxgl-ctrl-attrib a { color: rgba(255,255,255,0.7) !important; }
      `}</style>
    </div>
  );
}
