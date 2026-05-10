/* ============================================================
   LumaScout Web App — app.js
   Connects to existing FastAPI backend via https://photo-finder-60.emergent.host
   Auth: /api/auth/login · /api/auth/register · /api/auth/me
============================================================ */

'use strict';

// ─── Config ────────────────────────────────────────────────────────────────
const API = 'https://photo-finder-60.emergent.host';
let token = localStorage.getItem('ls_token');
let currentUser = null;
let currentView = 'explore';

// ─── Shorthand DOM helpers ──────────────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// ─── API fetch helper ───────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(API + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || 'Request failed');
  return data;
}

// ─── Toast notifications ────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const container = $('#toast-container');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ─── Modal helpers ──────────────────────────────────────────────────────────
function openModal(id) {
  const el = $('#' + id);
  if (el) { el.classList.add('open'); el.focus(); }
}
function closeModal(id) {
  const el = $('#' + id);
  if (el) el.classList.remove('open');
}

// Close modal when clicking overlay background
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

// Escape key closes modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $$('.modal-overlay.open').forEach(m => m.classList.remove('open'));
});

// ─── Mobile nav ─────────────────────────────────────────────────────────────
function toggleMobileMenu() {
  const menu = $('#mobile-menu');
  const btn = $('.nav-toggle');
  const hidden = menu.hasAttribute('hidden');
  if (hidden) { menu.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); }
  else { menu.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); }
}
function closeMobileMenu() {
  const menu = $('#mobile-menu');
  menu.setAttribute('hidden', '');
  $('.nav-toggle')?.setAttribute('aria-expanded', 'false');
}

// Sticky nav shadow
window.addEventListener('scroll', () => {
  const nav = $('#nav');
  if (nav) {
    nav.classList.toggle('scrolled', window.scrollY > 20);
  }
});

// ─── Auth: Login ────────────────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const email = $('#login-email').value.trim();
  const pw    = $('#login-pw').value;
  const err   = $('#login-err');
  const btn   = $('#login-btn');
  err.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const d = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: pw })
    });
    token = d.access_token;
    localStorage.setItem('ls_token', token);
    closeModal('login-modal');
    await loadUser();
    showToast('Welcome back!', 'success');
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

// ─── Auth: Register ─────────────────────────────────────────────────────────
async function handleRegister(e) {
  e.preventDefault();
  const name  = $('#reg-name').value.trim();
  const email = $('#reg-email').value.trim();
  const pw    = $('#reg-pw').value;
  const err   = $('#reg-err');
  const btn   = $('#reg-btn');
  err.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Creating account…';
  try {
    const d = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password: pw })
    });
    token = d.access_token;
    localStorage.setItem('ls_token', token);
    closeModal('reg-modal');
    await loadUser();
    showToast('Welcome to LumaScout!', 'success');
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
}

// ─── Load user & boot app shell ─────────────────────────────────────────────
async function loadUser() {
  try {
    currentUser = await apiFetch('/api/auth/me');
    showAppShell();
    showView('explore');
    loadExplore();
  } catch {
    token = null;
    currentUser = null;
    localStorage.removeItem('ls_token');
    showLanding();
  }
}

// ─── Logout ─────────────────────────────────────────────────────────────────
function handleLogout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('ls_token');
  showLanding();
  showToast('Signed out', 'info');
}

// ─── Show / hide landing vs app shell ───────────────────────────────────────
function showLanding() {
  $('#landing-page').removeAttribute('hidden');
  $('#app-shell').setAttribute('hidden', '');
}

function showAppShell() {
  $('#landing-page').setAttribute('hidden', '');
  $('#app-shell').removeAttribute('hidden');

  // Populate top-bar user info
  if (currentUser) {
    const initials = (currentUser.name || currentUser.email || 'U')
      .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const av = $('#user-av-top');
    if (av) av.textContent = initials;
    const name = $('#user-name-top');
    if (name) name.textContent = currentUser.name || currentUser.email?.split('@')[0] || 'Photographer';
  }
}

// ─── Navigate views ─────────────────────────────────────────────────────────
function showView(viewName) {
  currentView = viewName;

  // Update sidebar active state
  $$('.snav-item[data-view]').forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });

  // Show/hide view panels
  $$('.view').forEach(v => v.classList.remove('active'));
  const target = $('#view-' + viewName);
  if (target) target.classList.add('active');

  // Lazy-load view data
  const loaders = {
    explore:    () => loadExplore(),
    saved:      () => loadSaved(),
    network:    () => loadNetwork(),
    community:  () => loadCommunity(),
    messages:   () => loadMessages(),
    marketplace:() => loadMarketplace(),
    profile:    () => loadProfile(),
  };
  loaders[viewName]?.();
}

// ─── Gradient palettes for spot cards ───────────────────────────────────────
const GRAD_BKGS = [
  'linear-gradient(135deg,#1a2a1a,#2d4a2d)',
  'linear-gradient(135deg,#1a1a2a,#2a2d4a)',
  'linear-gradient(135deg,#2a1a1a,#4a2d1a)',
  'linear-gradient(135deg,#1a2a2a,#1a3a3a)',
  'linear-gradient(135deg,#2a1a2a,#3a1a3a)',
  'linear-gradient(135deg,#1f1a0a,#3a3010)',
];

function spotGrad(i) { return GRAD_BKGS[i % GRAD_BKGS.length]; }

// ─── Render spot card ────────────────────────────────────────────────────────
function renderSpotCard(s, i = 0) {
  const score = s.shoot_score || s.score || Math.floor(75 + Math.random() * 25);
  const bg = s.sample_images?.[0]
    ? `background-image:url(${s.sample_images[0]});background-size:cover;background-position:center;`
    : `background:${spotGrad(i)};`;
  const saved = s.is_saved ? '❤️' : '🤍';
  const diff = s.difficulty || 'Easy';
  const bestTime = s.best_time || 'Golden Hour';

  return `
    <div class="spot-card" onclick="openSpotDetail('${s._id || s.id || ''}')">
      <div class="spot-card-img" style="${bg}">
        <span class="sc-score">${score}</span>
        <span class="sc-save" onclick="event.stopPropagation();toggleSave('${s._id || s.id || ''}', this)">${saved}</span>
      </div>
      <div class="spot-card-body">
        <div class="spot-card-title">${escHtml(s.name || 'Unnamed Spot')}</div>
        <div class="spot-card-loc">📍 ${escHtml(s.city || '')}${s.state ? ', ' + s.state : ''}</div>
        <div class="spot-card-meta">
          <span class="spot-tag">🌅 ${escHtml(bestTime)}</span>
          <span class="spot-tag">${escHtml(diff)}</span>
          ${s.is_premium ? '<span class="spot-tag" style="color:var(--gold);border-color:var(--border-gold)">⭐ Premium</span>' : ''}
        </div>
      </div>
    </div>`;
}

// ─── Explore: load spots ─────────────────────────────────────────────────────
let allSpots = [];
let exploreLoaded = false;

async function loadExplore() {
  if (exploreLoaded) return;
  const grid = $('#spots-grid');
  if (!grid) return;

  try {
    const data = await apiFetch('/api/spots/trending?limit=24');
    allSpots = data.spots || data || [];
    renderSpotGrid(allSpots);
    exploreLoaded = true;
  } catch {
    // Fallback to demo spots
    allSpots = getDemoSpots();
    renderSpotGrid(allSpots);
    exploreLoaded = true;
  }
}

function renderSpotGrid(spots) {
  const grid = $('#spots-grid');
  if (!grid) return;
  if (!spots.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🗺️</div><h3>No spots yet</h3><p>Be the first to add a location in your area.</p></div>`;
    grid.style.gridColumn = '1/-1';
    return;
  }
  grid.innerHTML = spots.map((s, i) => renderSpotCard(s, i)).join('');
}

function filterSpots() {
  const type = $('#filter-type')?.value;
  const sort = $('#filter-sort')?.value;
  let filtered = [...allSpots];
  if (type) filtered = filtered.filter(s => (s.landscape_type || s.type || '').toLowerCase().includes(type));
  if (sort === 'top_rated') filtered.sort((a, b) => (b.shoot_score || b.score || 0) - (a.shoot_score || a.score || 0));
  else if (sort === 'newest') filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  renderSpotGrid(filtered);
}

// ─── Spot detail modal ───────────────────────────────────────────────────────
async function openSpotDetail(spotId) {
  if (!spotId) return;
  openModal('spot-modal');
  const content = $('#spot-modal-content');
  content.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading spot…</p></div>';

  try {
    const s = await apiFetch(`/api/spots/${spotId}`);
    const bg = s.sample_images?.[0]
      ? `background-image:url(${s.sample_images[0]});background-size:cover;background-position:center;`
      : `background:${spotGrad(0)};`;
    const score = s.shoot_score || s.score || 88;

    content.innerHTML = `
      <div class="spot-detail-img" style="${bg}">
        <span class="spot-detail-score">${score}</span>
      </div>
      <div class="spot-detail-name">${escHtml(s.name || 'Unnamed Spot')}</div>
      <div class="spot-detail-loc">📍 ${escHtml(s.city || '')}${s.state ? ', ' + s.state : ''}</div>
      <div class="spot-detail-tags">
        ${(s.tags || []).map(t => `<span class="spot-tag">${escHtml(t)}</span>`).join('')}
        ${s.best_time ? `<span class="spot-tag">🌅 ${escHtml(s.best_time)}</span>` : ''}
        ${s.difficulty ? `<span class="spot-tag">⛰️ ${escHtml(s.difficulty)}</span>` : ''}
      </div>
      <div class="spot-detail-stats">
        <div class="spot-detail-stat"><div class="sd-stat-n">${s.lighting_rating || '—'}</div><div class="sd-stat-l">Lighting</div></div>
        <div class="spot-detail-stat"><div class="sd-stat-n">${s.accessibility_rating || '—'}</div><div class="sd-stat-l">Access</div></div>
        <div class="spot-detail-stat"><div class="sd-stat-n">${s.safety_rating || '—'}</div><div class="sd-stat-l">Safety</div></div>
      </div>
      <div class="spot-detail-desc">${escHtml(s.description || 'No description provided.')}</div>
      <div style="margin-top:20px;display:flex;gap:10px;">
        <button class="btn btn-primary" onclick="toggleSave('${s._id || s.id}', this)">
          ${s.is_saved ? '❤️ Saved' : '🤍 Save Spot'}
        </button>
        <button class="btn btn-ghost" onclick="closeModal('spot-modal')">Close</button>
      </div>`;
  } catch {
    content.innerHTML = '<div class="empty-state"><div class="empty-icon">😞</div><h3>Could not load spot</h3><p>Please try again.</p></div>';
  }
}

// ─── Save / unsave spot ──────────────────────────────────────────────────────
async function toggleSave(spotId, el) {
  if (!spotId || !token) { openModal('login-modal'); return; }
  try {
    const isSaved = el.textContent.includes('❤️') || el.textContent.includes('Saved');
    if (isSaved) {
      await apiFetch(`/api/spots/${spotId}/unsave`, { method: 'POST' });
      el.textContent = el.tagName === 'BUTTON' ? '🤍 Save Spot' : '🤍';
      showToast('Spot removed from saved', 'info');
    } else {
      await apiFetch(`/api/spots/${spotId}/save`, { method: 'POST' });
      el.textContent = el.tagName === 'BUTTON' ? '❤️ Saved' : '❤️';
      showToast('Spot saved!', 'success');
    }
    savedLoaded = false; // reset so saved view reloads
  } catch (ex) {
    showToast(ex.message, 'error');
  }
}

// ─── Saved spots ─────────────────────────────────────────────────────────────
let savedLoaded = false;

async function loadSaved() {
  if (savedLoaded) return;
  const grid = $('#saved-content');
  if (!grid) return;
  grid.innerHTML = '<div class="sk-card skeleton"></div><div class="sk-card skeleton"></div><div class="sk-card skeleton"></div>';

  try {
    const data = await apiFetch('/api/spots/saved?limit=24');
    const spots = data.spots || data || [];
    if (!spots.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">💾</div><h3>No saved spots yet</h3><p>Explore the map and save locations you love.</p></div>`;
    } else {
      grid.innerHTML = spots.map((s, i) => renderSpotCard(s, i)).join('');
    }
    savedLoaded = true;
  } catch {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">💾</div><h3>No saved spots yet</h3><p>Explore spots and heart the ones you love.</p></div>`;
    savedLoaded = true;
  }
}

// ─── Network ─────────────────────────────────────────────────────────────────
let networkLoaded = false;
const PH_COLORS = [
  'linear-gradient(135deg,#F5A623,#C9843A)',
  'linear-gradient(135deg,#7C6BF5,#4B38D4)',
  'linear-gradient(135deg,#48BB78,#2D7A4F)',
  'linear-gradient(135deg,#63B3ED,#2B6CB0)',
  'linear-gradient(135deg,#F687B3,#B83280)',
];

async function loadNetwork() {
  if (networkLoaded) return;
  const grid = $('#network-content');
  if (!grid) return;
  grid.innerHTML = '<div class="sk-card skeleton"></div><div class="sk-card skeleton"></div><div class="sk-card skeleton"></div><div class="sk-card skeleton"></div>';

  try {
    const data = await apiFetch('/api/network/users?limit=20');
    const users = data.users || data || [];
    if (!users.length) throw new Error('empty');
    grid.innerHTML = users.map((u, i) => renderPhotographerCard(u, i)).join('');
    networkLoaded = true;
  } catch {
    // fallback demo
    const demos = getDemoPhotographers();
    grid.innerHTML = demos.map((u, i) => renderPhotographerCard(u, i)).join('');
    networkLoaded = true;
  }
}

function renderPhotographerCard(u, i = 0) {
  const initials = (u.name || u.email || 'P').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const plan = u.plan || 'free';
  const spec = u.specialties?.[0] || u.specialty || 'Photography';
  const loc = u.city ? `${u.city}${u.state ? ', ' + u.state : ''}` : 'Photographer';
  const planBadge = plan === 'elite'
    ? '<span class="badge-elite">Elite</span>'
    : plan === 'pro' ? '<span class="badge-pro">Pro</span>' : '';

  return `
    <div class="photographer-card">
      <div class="ph-card-av" style="background:${PH_COLORS[i % PH_COLORS.length]}">${initials}</div>
      <div class="ph-card-name">${escHtml(u.name || 'Photographer')}</div>
      <div class="ph-card-spec">${escHtml(spec)} · ${escHtml(loc)}</div>
      <div class="ph-card-badges">${planBadge}</div>
    </div>`;
}

// ─── Community ───────────────────────────────────────────────────────────────
let communityLoaded = false;

async function loadCommunity() {
  if (communityLoaded) return;
  const feedCol = $('#feed-content');
  if (!feedCol) return;

  try {
    const data = await apiFetch('/api/home_feed?limit=15');
    const posts = data.posts || data.feed || data || [];
    if (!posts.length) throw new Error('empty');
    feedCol.innerHTML = posts.map((p, i) => renderFeedPost(p, i)).join('');
    communityLoaded = true;
  } catch {
    const demos = getDemoPosts();
    feedCol.innerHTML = demos.map((p, i) => renderFeedPost(p, i)).join('');
    communityLoaded = true;
  }
}

function renderFeedPost(p, i = 0) {
  const initials = (p.author_name || p.user_name || 'U')
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const color = PH_COLORS[i % PH_COLORS.length];
  const time = p.created_at ? timeAgo(p.created_at) : 'recently';
  const tagLabel = p.post_type === 'tip' ? '💡 Tip'
    : p.post_type === 'win' ? '🏆 Win'
    : p.post_type === 'question' ? '❓ Question'
    : '📸 Update';

  return `
    <div class="feed-post">
      <div class="feed-post-header">
        <div class="feed-av" style="background:${color}">${initials}</div>
        <div>
          <div class="feed-author">${escHtml(p.author_name || p.user_name || 'Photographer')}</div>
          <div class="feed-time">${time}</div>
        </div>
      </div>
      <div class="feed-body">${escHtml(p.content || p.body || 'Shared a post')}</div>
      <span class="feed-post-tag">${tagLabel}</span>
    </div>`;
}

// ─── Messages ─────────────────────────────────────────────────────────────────
let messagesLoaded = false;

async function loadMessages() {
  if (messagesLoaded) return;
  const list = $('#messages-list');
  if (!list) return;
  messagesLoaded = true;
  // Already has empty state from HTML; could load real threads here
  // For now, show a polished "coming soon" state if no messages
  try {
    const data = await apiFetch('/api/messages/threads?limit=20');
    const threads = data.threads || data || [];
    if (threads.length) {
      list.innerHTML = threads.map(t => `
        <div class="snav-item" style="border-radius:0;border-bottom:1px solid var(--border);">
          <div class="user-av" style="background:${PH_COLORS[0]}">${(t.other_user_name||'?')[0]}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;color:var(--text)">${escHtml(t.other_user_name||'User')}</div>
            <div style="font-size:11px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(t.last_message||'')}</div>
          </div>
        </div>`).join('');
    }
  } catch { /* keep default */ }
}

// ─── Marketplace ─────────────────────────────────────────────────────────────
let marketplaceLoaded = false;

async function loadMarketplace() {
  if (marketplaceLoaded) return;
  const grid = $('#marketplace-content');
  if (!grid) return;

  const MK_COLORS = [
    'linear-gradient(135deg,#1a1a2a,#2a2d4a)',
    'linear-gradient(135deg,#1f1a0a,#3a3010)',
    'linear-gradient(135deg,#1a2a1a,#2d4a2d)',
    'linear-gradient(135deg,#2a1a2a,#3a1a3a)',
  ];

  try {
    const data = await apiFetch('/api/marketplace/products?limit=12&status=active');
    const products = data.products || data || [];
    if (!products.length) throw new Error('empty');
    grid.innerHTML = products.map((p, i) => `
      <div class="marketplace-card">
        <div class="mk-card-img" style="background:${MK_COLORS[i%MK_COLORS.length]}"></div>
        <div class="mk-card-body">
          <div class="mk-card-title">${escHtml(p.title || 'Product')}</div>
          <div class="mk-card-type">${escHtml(p.type || 'Guide')}</div>
          <div class="mk-card-price">${p.price_cents === 0 ? 'Free' : '$' + (p.price_cents / 100).toFixed(2)}</div>
        </div>
      </div>`).join('');
    marketplaceLoaded = true;
  } catch {
    // Show demo marketplace products
    const demoProducts = [
      { title: 'Texas Hill Country Location Pack', type: 'Location Guide', price: '$12.00', color: MK_COLORS[0] },
      { title: 'Golden Hour Planning Presets', type: 'Presets', price: '$8.00', color: MK_COLORS[1] },
      { title: 'Austin Urban Spots Collection', type: 'Spot Pack', price: '$15.00', color: MK_COLORS[2] },
      { title: '1-on-1 Scouting Session', type: 'Mentorship', price: '$75.00', color: MK_COLORS[3] },
    ];
    grid.innerHTML = demoProducts.map(p => `
      <div class="marketplace-card">
        <div class="mk-card-img" style="background:${p.color}"></div>
        <div class="mk-card-body">
          <div class="mk-card-title">${p.title}</div>
          <div class="mk-card-type">${p.type}</div>
          <div class="mk-card-price">${p.price}</div>
        </div>
      </div>`).join('');
    marketplaceLoaded = true;
  }
}

// ─── Profile ─────────────────────────────────────────────────────────────────
let profileLoaded = false;

async function loadProfile() {
  if (profileLoaded || !currentUser) return;
  const headerSection = $('#profile-header-section');
  const contentSection = $('#profile-content');
  if (!headerSection) return;

  const initials = (currentUser.name || currentUser.email || 'U')
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const plan = currentUser.plan || 'free';
  const planLabel = plan === 'elite' ? '⭐ Elite Member' : plan === 'pro' ? '⭐ Pro Member' : 'Free Member';

  headerSection.innerHTML = `
    <div class="profile-banner"></div>
    <div class="profile-info">
      <div class="profile-av-wrap">
        <div class="profile-av">${initials}</div>
      </div>
      <div class="profile-meta">
        <div class="profile-name">${escHtml(currentUser.name || 'Photographer')}</div>
        <div class="profile-plan">${planLabel}</div>
        <div class="profile-stats">
          <div class="profile-stat"><div class="profile-stat-n">${currentUser.spot_count || 0}</div><div class="profile-stat-l">Saved Spots</div></div>
          <div class="profile-stat"><div class="profile-stat-n">${currentUser.follower_count || 0}</div><div class="profile-stat-l">Followers</div></div>
          <div class="profile-stat"><div class="profile-stat-n">${currentUser.following_count || 0}</div><div class="profile-stat-l">Following</div></div>
        </div>
      </div>
    </div>`;

  // Show plan details
  contentSection.innerHTML = `
    <div class="feed-post" style="max-width:600px">
      <h4 style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:14px">Account Details</h4>
      <div class="benefit-item" style="padding:12px 0">
        <div class="benefit-icon">📧</div>
        <div><h4>Email</h4><p>${escHtml(currentUser.email || '')}</p></div>
      </div>
      <div class="benefit-item" style="padding:12px 0">
        <div class="benefit-icon">🏅</div>
        <div><h4>Plan</h4><p>${planLabel} · <a href="#pricing" onclick="showLanding();return false" style="color:var(--gold)">View plans</a></p></div>
      </div>
      ${currentUser.bio ? `<div class="benefit-item" style="padding:12px 0"><div class="benefit-icon">📝</div><div><h4>Bio</h4><p>${escHtml(currentUser.bio)}</p></div></div>` : ''}
    </div>`;

  profileLoaded = true;
}

// ─── Demo data fallbacks ─────────────────────────────────────────────────────
function getDemoSpots() {
  return [
    { _id: 'd1', name: 'Enchanted Rock', city: 'Fredericksburg', state: 'TX', shoot_score: 96, best_time: 'Golden Hour', difficulty: 'Moderate', tags: ['nature','granite','hiking'] },
    { _id: 'd2', name: 'Pedernales Falls', city: 'Johnson City', state: 'TX', shoot_score: 91, best_time: 'Blue Hour', difficulty: 'Easy', tags: ['water','rocks','sunset'] },
    { _id: 'd3', name: 'Barton Creek Greenbelt', city: 'Austin', state: 'TX', shoot_score: 88, best_time: 'Morning', difficulty: 'Easy', tags: ['urban','creek','trees'] },
    { _id: 'd4', name: 'Palo Duro Canyon', city: 'Canyon', state: 'TX', shoot_score: 94, best_time: 'Sunrise', difficulty: 'Moderate', tags: ['canyon','desert','dramatic'] },
    { _id: 'd5', name: 'Hamilton Pool', city: 'Dripping Springs', state: 'TX', shoot_score: 92, best_time: 'Midday', difficulty: 'Easy', tags: ['waterfall','grotto','lush'] },
    { _id: 'd6', name: 'Big Bend National Park', city: 'Study Butte', state: 'TX', shoot_score: 98, best_time: 'Blue Hour', difficulty: 'Hard', tags: ['desert','mountains','stargazing'] },
    { _id: 'd7', name: 'Hueco Tanks', city: 'El Paso', state: 'TX', shoot_score: 87, best_time: 'Morning', difficulty: 'Moderate', tags: ['boulders','rockart','desert'] },
    { _id: 'd8', name: 'Lost Maples State Park', city: 'Vanderpool', state: 'TX', shoot_score: 89, best_time: 'Fall Morning', difficulty: 'Easy', tags: ['foliage','fall','creek'] },
  ];
}

function getDemoPhotographers() {
  return [
    { name: 'Maya Chen', specialty: 'Portrait', city: 'Austin', state: 'TX', plan: 'elite' },
    { name: 'Sam Rivera', specialty: 'Landscape', city: 'Houston', state: 'TX', plan: 'pro' },
    { name: 'Jordan Lee', specialty: 'Wedding', city: 'Dallas', state: 'TX', plan: 'pro' },
    { name: 'Alex Torres', specialty: 'Commercial', city: 'San Antonio', state: 'TX', plan: 'elite' },
    { name: 'Riley Park', specialty: 'Documentary', city: 'Austin', state: 'TX', plan: 'free' },
    { name: 'Morgan Davis', specialty: 'Street', city: 'Houston', state: 'TX', plan: 'pro' },
    { name: 'Casey Kim', specialty: 'Wildlife', city: 'Fort Worth', state: 'TX', plan: 'free' },
    { name: 'Drew Thompson', specialty: 'Aerial', city: 'Austin', state: 'TX', plan: 'elite' },
  ];
}

function getDemoPosts() {
  return [
    { author_name: 'Maya Chen', content: 'Just got back from scouting Pedernales Falls at sunrise — absolutely worth the early alarm. The mist over the water creates magic about 20 minutes after the sun breaks the horizon. Highly recommend bringing a wide-angle!', post_type: 'tip', created_at: new Date(Date.now() - 1000*60*45).toISOString() },
    { author_name: 'Sam Rivera', content: 'Huge win — booked a full-day elopement at Enchanted Rock after sharing my LumaScout location guide with the couple! The client portal feature made it so easy to present the spots professionally.', post_type: 'win', created_at: new Date(Date.now() - 1000*60*60*3).toISOString() },
    { author_name: 'Jordan Lee', content: 'Does anyone know good permit-free options in the Hill Country for a 10-person group session? Looking for something with good parking and not too crowded on weekday mornings.', post_type: 'question', created_at: new Date(Date.now() - 1000*60*60*5).toISOString() },
    { author_name: 'Alex Torres', content: 'PSA: Hamilton Pool is requiring advance permits again this summer. Book at least 2 weeks out or plan to shoot earlier in the week. Got some incredible shots this morning though — empty by 7am!', post_type: 'tip', created_at: new Date(Date.now() - 1000*60*60*8).toISOString() },
    { author_name: 'Riley Park', content: 'Just dropped a new location guide for the Palo Duro Canyon area in the marketplace — includes 12 spots with GPS coordinates, best times, and sample shots from all 4 seasons. Check it out!', post_type: 'update', created_at: new Date(Date.now() - 1000*60*60*24).toISOString() },
  ];
}

// ─── Utilities ───────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

// ─── Boot ────────────────────────────────────────────────────────────────────
async function init() {
  if (token) {
    await loadUser();
  } else {
    showLanding();
  }

  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
