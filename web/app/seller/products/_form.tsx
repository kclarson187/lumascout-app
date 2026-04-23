'use client';

import { FormEvent, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createProduct, updateProduct } from '../_actions';
import { Loader2, AlertTriangle, Save, Plus } from 'lucide-react';

const TYPES: { value: string; label: string }[] = [
  { value: 'preset', label: 'Lightroom Preset' },
  { value: 'spot_pack', label: 'Spot Pack' },
  { value: 'city_guide', label: 'City Guide' },
  { value: 'route_pack', label: 'Route Pack' },
  { value: 'lut', label: 'LUT' },
  { value: 'template', label: 'Template' },
  { value: 'mentorship', label: 'Mentorship Call' },
];

export function ProductForm({ mode, initial }: { mode: 'create' | 'edit'; initial?: any }) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title || '');
  const [type, setType] = useState(initial?.type || 'preset');
  const [description, setDescription] = useState(initial?.description || '');
  const [price, setPrice] = useState<string>(initial?.price_cents !== undefined ? (initial.price_cents / 100).toFixed(2) : '');
  const [thumbnail, setThumbnail] = useState(initial?.thumbnail_url || '');
  const [contentsUrl, setContentsUrl] = useState(initial?.contents_url || '');
  const [tags, setTags] = useState((initial?.tags || []).join(', '));
  const [category, setCategory] = useState(initial?.category || '');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [_, startTransition] = useTransition();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const priceCents = Math.round(parseFloat(price || '0') * 100);
    if (!title || title.length < 4) return setErr('Title must be at least 4 characters.');
    if (!thumbnail) return setErr('A thumbnail image URL is required.');
    if (isNaN(priceCents) || priceCents < 0) return setErr('Price must be a valid amount.');

    const payload = {
      title: title.trim(),
      type,
      description: description.trim(),
      price_cents: priceCents,
      thumbnail_url: thumbnail.trim(),
      contents_url: contentsUrl.trim() || undefined,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      category: category.trim() || undefined,
    };
    setLoading(true);
    startTransition(async () => {
      try {
        if (mode === 'create') {
          const created: any = await createProduct(payload);
          router.push(`/seller/products/${created.product_id || ''}`);
          router.refresh();
        } else {
          await updateProduct(initial.product_id, payload);
          router.push('/seller/products');
          router.refresh();
        }
      } catch (e: any) {
        setErr(e?.message || 'Could not save product');
      } finally { setLoading(false); }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3 space-y-6">
        {err && <div className="rounded-xl border border-danger/30 bg-danger/10 text-danger text-sm px-4 py-3 flex items-center gap-2"><AlertTriangle size={14} /> {err}</div>}

        <Section title="Basics">
          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={4} maxLength={140} placeholder="e.g. Patagonia Winter Pack" className="w-full rounded-xl border border-border bg-bg px-4 py-3 text-ink placeholder:text-ink-dim outline-none focus:border-strong" />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Type">
              <select value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-xl border border-border bg-bg px-4 py-3 text-ink outline-none focus:border-strong">
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Category (optional)" hint="Shown as a chip on the storefront.">
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Landscape, Astro" className="w-full rounded-xl border border-border bg-bg px-4 py-3 text-ink placeholder:text-ink-dim outline-none focus:border-strong" />
            </Field>
          </div>
          <Field label="Description" hint="Markdown-friendly. Describe what’s included and who it’s for.">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} placeholder="Describe your pack…" className="w-full rounded-xl border border-border bg-bg px-4 py-3 text-ink placeholder:text-ink-dim outline-none focus:border-strong resize-y" />
          </Field>
          <Field label="Tags" hint="Comma-separated keywords to help buyers find you.">
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="astro, winter, alpine" className="w-full rounded-xl border border-border bg-bg px-4 py-3 text-ink placeholder:text-ink-dim outline-none focus:border-strong" />
          </Field>
        </Section>

        <Section title="Delivery">
          <Field label="Contents URL" hint="Private download link sent to buyers after purchase (zip, pdf, calendly, etc.).">
            <input value={contentsUrl} onChange={(e) => setContentsUrl(e.target.value)} placeholder="https://dropbox.com/… or https://calendly.com/…" className="w-full rounded-xl border border-border bg-bg px-4 py-3 text-ink placeholder:text-ink-dim outline-none focus:border-strong" />
          </Field>
        </Section>
      </div>

      <div className="lg:col-span-2 space-y-6 lg:sticky lg:top-6 self-start">
        <Section title="Media">
          <Field label="Thumbnail URL" hint="16:10 works best. Hosted image (png/jpg/webp).">
            <input value={thumbnail} onChange={(e) => setThumbnail(e.target.value)} required placeholder="https://…" className="w-full rounded-xl border border-border bg-bg px-4 py-3 text-ink placeholder:text-ink-dim outline-none focus:border-strong" />
          </Field>
          {thumbnail && (
            <div className="mt-3 aspect-[16/10] rounded-xl bg-[linear-gradient(135deg,#1A1206,#2B1A08)] bg-cover bg-center border border-border"
              style={{ backgroundImage: `url(${thumbnail})` }} />
          )}
        </Section>

        <Section title="Pricing">
          <Field label="Price (USD)" hint="You keep 85%. LumaScout + Stripe fees are 15%.">
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-dim">$</span>
              <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" step="0.01" min="0" max="100000" placeholder="0.00" className="w-full rounded-xl border border-border bg-bg pl-8 pr-4 py-3 text-ink placeholder:text-ink-dim outline-none focus:border-strong" />
            </div>
            {price && (
              <p className="mt-2 text-xs text-ink-muted">You'll earn about <span className="text-success font-semibold">${(parseFloat(price || '0') * 0.85).toFixed(2)}</span> per sale.</p>
            )}
          </Field>
        </Section>

        <button type="submit" disabled={loading} className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-brand text-black font-semibold px-5 py-3.5 transition hover:bg-brand-600 disabled:opacity-60">
          {loading ? <Loader2 size={16} className="animate-spin" /> : mode === 'create' ? <Plus size={16} /> : <Save size={16} />}
          {mode === 'create' ? 'Create product' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface-1 p-6">
      <p className="text-[10px] uppercase tracking-widest text-ink-dim font-semibold">{title}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      {hint && <span className="block text-xs text-ink-muted mt-0.5">{hint}</span>}
      <div className="mt-2">{children}</div>
    </label>
  );
}
