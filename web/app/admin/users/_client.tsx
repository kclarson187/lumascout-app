'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { updateUser, grantPlan, sanctionUser, unsanctionUser } from '../_actions';
import { Search, ShieldCheck, Crown, Loader2, AlertTriangle, Gem, User as UserIcon, Ban, RotateCw } from 'lucide-react';

export function UsersClient({ initialUsers, initialQ, initialFilter }: { initialUsers: any[]; initialQ: string; initialFilter: string }) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [q, setQ] = useState(initialQ);
  const [filter, setFilter] = useState(initialFilter);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [_, startTransition] = useTransition();

  function search(e?: React.FormEvent) {
    e?.preventDefault();
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (filter !== 'all') params.set('filter', filter);
    router.push(`/admin/users${params.toString() ? '?' + params.toString() : ''}`);
  }

  async function runAction(userId: string, label: string, fn: () => Promise<any>, optimisticPatch?: Record<string, any>) {
    setBusy(`${userId}:${label}`); setErr(null);
    try {
      await fn();
      if (optimisticPatch) setUsers((prev) => prev.map((u) => (u.user_id === userId ? { ...u, ...optimisticPatch } : u)));
    } catch (e: any) { setErr(e?.message || 'Action failed'); } finally { setBusy(null); }
  }

  return (
    <>
      {/* Search + filter */}
      <form onSubmit={search} className="mb-6 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-full border border-border bg-surface-1 px-4 py-2.5 min-w-[280px] flex-1">
          <Search size={14} className="text-ink-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email, or username…" className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-dim outline-none" />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-full border border-border bg-surface-1 px-4 py-2.5 text-sm text-ink">
          <option value="all">All users</option>
          <option value="admin">Admins</option>
          <option value="verified">Verified</option>
          <option value="flagged">Flagged</option>
          <option value="suspended">Suspended</option>
          <option value="pro">Pro</option>
          <option value="elite">Elite</option>
        </select>
        <button type="submit" className="rounded-full bg-brand text-black font-semibold px-4 py-2.5 text-sm hover:bg-brand-600">Search</button>
      </form>

      {err && <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 text-danger text-sm px-4 py-3 flex items-center gap-2"><AlertTriangle size={14} /> {err}</div>}

      <section className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        {users.length === 0 ? (
          <div className="p-14 text-center">
            <UserIcon size={20} className="mx-auto text-ink-dim" />
            <p className="mt-3 font-display text-xl tracking-tighter">No users match.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 border-b border-border">
                <tr className="text-left text-[10px] uppercase tracking-widest text-ink-dim">
                  <th className="px-5 py-3 font-semibold">User</th>
                  <th className="px-5 py-3 font-semibold">Plan</th>
                  <th className="px-5 py-3 font-semibold">Role</th>
                  <th className="px-5 py-3 font-semibold">Trust</th>
                  <th className="px-5 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u: any) => {
                  const verified = u.verification_status === 'verified';
                  const suspended = !!u.suspended || u.status === 'suspended';
                  const plan = (u.plan || 'free').toLowerCase();
                  const role = (u.role || '').toLowerCase();
                  return (
                    <tr key={u.user_id} className="hover:bg-surface-2 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-9 w-9 shrink-0 rounded-full bg-surface-2 bg-center bg-cover"
                            style={u.avatar_url ? { backgroundImage: `url(${u.avatar_url})` } : undefined} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <Link href={u.username ? `/u/${u.username}` : '#'} className="truncate font-semibold text-ink hover:text-brand">{u.name || u.username || '—'}</Link>
                              {verified && <ShieldCheck size={12} className="text-brand shrink-0" />}
                              {suspended && <Ban size={12} className="text-danger shrink-0" />}
                            </div>
                            <p className="truncate text-xs text-ink-muted">@{u.username || '—'} · {u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-block text-[10px] uppercase tracking-widest rounded-full px-2 py-0.5 border ${plan === 'elite' ? 'border-brand/30 text-brand bg-brand/5' : plan === 'pro' ? 'border-success/30 text-success bg-success/5' : 'border-border text-ink-muted'}`}>{plan}</span>
                      </td>
                      <td className="px-5 py-3">
                        {role ? <span className="inline-block text-[10px] uppercase tracking-widest rounded-full px-2 py-0.5 border border-danger/30 text-danger bg-danger/5">{role.replace('_', ' ')}</span> : <span className="text-ink-dim">—</span>}
                      </td>
                      <td className="px-5 py-3 text-ink-muted">
                        <span>{typeof u.trust_score === 'number' ? u.trust_score.toFixed(2) : '—'}</span>
                        {(u.flag_count ?? 0) > 0 && <span className="ml-2 text-[10px] uppercase tracking-widest text-danger">{u.flag_count} flag{u.flag_count > 1 ? 's' : ''}</span>}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <RowBtn disabled={busy === `${u.user_id}:verify`} onClick={() => startTransition(() => runAction(u.user_id, 'verify', () => updateUser(u.user_id, { verification_status: verified ? 'unverified' : 'verified' }), { verification_status: verified ? 'unverified' : 'verified' }))} icon={ShieldCheck} tone={verified ? 'neutral' : 'brand'}>{verified ? 'Unverify' : 'Verify'}</RowBtn>
                          <RowBtn disabled={busy === `${u.user_id}:pro`} onClick={() => startTransition(() => runAction(u.user_id, 'pro', () => grantPlan(u.user_id, 'pro', 30, 'comp'), { plan: 'pro' }))} icon={Gem} tone="neutral">Comp Pro</RowBtn>
                          <RowBtn disabled={busy === `${u.user_id}:elite`} onClick={() => startTransition(() => runAction(u.user_id, 'elite', () => grantPlan(u.user_id, 'elite', 30, 'comp'), { plan: 'elite' }))} icon={Crown} tone="brand">Comp Elite</RowBtn>
                          {suspended ? (
                            <RowBtn disabled={busy === `${u.user_id}:unsus`} onClick={() => startTransition(() => runAction(u.user_id, 'unsus', () => unsanctionUser(u.user_id), { suspended: false, status: 'active' }))} icon={RotateCw} tone="success">Reactivate</RowBtn>
                          ) : (
                            <RowBtn disabled={busy === `${u.user_id}:sus`} onClick={() => { const reason = prompt('Suspend reason?') || ''; if (!reason) return; startTransition(() => runAction(u.user_id, 'sus', () => sanctionUser(u.user_id, { action: 'suspend', reason, duration_hours: 168 }), { suspended: true, status: 'suspended' })); }} icon={Ban} tone="danger">Suspend</RowBtn>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function RowBtn({ children, onClick, disabled, icon: Icon, tone }: any) {
  const toneClass = tone === 'success' ? 'border-success/30 bg-success/5 text-success hover:bg-success/10' :
                   tone === 'danger' ? 'border-danger/30 bg-danger/5 text-danger hover:bg-danger/10' :
                   tone === 'brand' ? 'border-brand/30 bg-brand/5 text-brand hover:bg-brand/10' :
                   'border-border bg-surface-1 text-ink-muted hover:text-ink hover:border-strong';
  return (
    <button onClick={onClick} disabled={disabled} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-60 transition ${toneClass}`}>
      {disabled ? <Loader2 size={11} className="animate-spin" /> : <Icon size={11} />} {children}
    </button>
  );
}
