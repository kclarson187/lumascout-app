/* ═══════════════════════════════════════════════════
   LumaScout Web App – Auth & Dashboard
   Uses existing backend endpoints only. No backend changes.
   API base: https://photo-finder-60.emergent.host
   ═══════════════════════════════════════════════════ */

const API = 'https://photo-finder-60.emergent.host';
const TOKEN_KEY = 'ls_token';

let token = localStorage.getItem(TOKEN_KEY);
let currentUser = null;
let allSpots = [];
let currentView = 'home';

/* ── API helpers ── */
async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.includes('/auth/login') && !path.includes('/auth/register')) {
      clearSession();
    }
    throw new Error(data.detail || data.message || 'Request failed');
  }
  return data;
}

/* ── Toast ── */
function showToast(msg, type = 'info') {
  const c = document.getElementById('toasts');
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  el.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/* ── Modal ── */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('open'); el.querySelector('input')?.focus(); }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}
function closeMobileNav() {
  const nav = document.getElementById('site-nav');
  const menu = document.getElementById('mobile-nav');
  if (nav) nav.classList.remove('menu-open');
  if (menu) menu.hidden = true;
}

/* ── Auth: Login ── */
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const pw = document.getElementById('login-pw').value;
  const errEl = document.getElementById('login-err');
  const btn = document.getElementById('login-submit');
  errEl.textContent = '';
  if (!email || !pw) { errEl.textContent = 'Please enter your email and password.'; return; }
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const d = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: pw })
    });
    token = d.access_token;
    localStorage.setItem(TOKEN_KEY, token);
    closeModal('login-modal');
    document.getElementById('login-form').reset();
    await loadUser();
    showToast('Welcome back!', 'success');
  } catch (ex) {
    errEl.textContent = ex.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

/* ── Auth: Register ── */
async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pw = document.getElementById('reg-pw').value;
  const errEl = document.getElementById('reg-err');
  const btn = document.getElementById('reg-submit');
  errEl.textContent = '';
  if (!name || !email || !pw) { errEl.textContent = 'Please fill in all fields.'; return; }
  if (pw.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }
  btn.disabled = true;
  btn.textContent = 'Creating account…';
  try {
    const d = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password: pw })
    });
    token = d.access_token;
    localStorage.setItem(TOKEN_KEY, token);
    closeModal('reg-modal');
    document.getElementById('reg-form').reset();
    await loadUser();
    showToast('Welcome to LumaScout!', 'success');
  } catch (ex) {
    errEl.textContent = ex.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
}

/* ── Load user session ── */
async function loadUser() {
  try {
    currentUser = await apiFetch('/api/auth/me');
    populateUserUI();
    showAppShell();
    loadDashboard();
  } catch {
    clearSession();
    showLanding();
  }
}

function populateUserUI() {
  if (!currentUser) return;
  const name = currentUser.name || currentUser.email || 'Photographer';
  const initials = name.charAt(0).toUpperCase();
  const handle = '@' + (currentUser.username || currentUser.email?.split('@')[0] || 'user');
  const stats = currentUser.stats || {};
  const plan = (currentUser.plan || 'free');

  /* Nav */
  const navAuth = document.getElementById('nav-auth');
  if (navAuth) {
    navAuth.innerHTML = `
      <button class="btn btn-ghost" onclick="handleLogout()">Sign Out</button>
      <div class="user-avatar-btn" onclick="switchView('profile',null)" title="${name}">${initials}</div>
    `;
  }

  /* App sidebar user avatar */
  const ua = document.getElementById('user-avatar');
  if (ua) { ua.textContent = initials; ua.title = name; }

  /* Dashboard greeting */
  const gEl = document.getElementById('dash-greeting');
  const nEl = document.getElementById('dash-name');
  if (gEl) gEl.textContent = 'Welcome back,';
  if (nEl) nEl.textContent = name.split(' ')[0];

  /* Rail */
  const railAv = document.getElementById('rail-avatar');
  const railName = document.getElementById('rail-name');
  const railHandle = document.getElementById('rail-handle');
  if (railAv) railAv.textContent = initials;
  if (railName) railName.textContent = name;
  if (railHandle) railHandle.textContent = handle;

  const sSpots = document.getElementById('stat-spots');
  const sSaves = document.getElementById('stat-saves');
  const sFollowers = document.getElementById('stat-followers');
  if (sSpots) sSpots.textContent = stats.spots_count ?? '—';
  if (sSaves) sSaves.textContent = stats.saves_count ?? '—';
  if (sFollowers) sFollowers.textContent = stats.followers_count ?? '—';

  const planBadge = document.getElementById('rail-plan-badge');
  if (planBadge) {
    const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1) + ' plan';
    planBadge.querySelector('.rpb-text').textContent = planLabel;
  }

  /* Profile view */
  populateProfile();
}

/* ── Dashboard data load ── */
async function loadDashboard() {
  loadPublicSpots();
  loadFeed();
}

async function loadFeed() {
  try {
    const feed = await apiFetch('/api/home_feed');
    if (feed.continue_planning) renderContinuePlanning(feed.continue_planning);
    if (feed.best_near_you) renderNearby(feed.best_near_you);
    if (feed.trending_this_week) renderTrending(feed.trending_this_week);
  } catch {
    /* Feed unavailable — leave skeletons replaced with empty states */
    clearFeedSkeletons();
  }
}

function clearFeedSkeletons() {
  const cg = document.getElementById('continue-grid');
  if (cg) cg.innerHTML = emptyState('Start exploring to see your in-progress spots.');
  const ns = document.getElementById('nearby-scroll');
  if (ns) ns.innerHTML = emptyState('Location access needed to show nearby spots.');
  const tl = document.getElementById('trending-list');
  if (tl) tl.innerHTML = emptyState('Trending spots loading soon.');
}

/* ── Spot backgrounds ── */
const GRADIENTS = [
  'linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)',
  'linear-gradient(135deg,#0d1f1f,#1a3333,#2d5a4e)',
  'linear-gradient(135deg,#1a0a00,#3d1a00,#5c2d00)',
  'linear-gradient(135deg,#0a001a,#1a0a3d,#2d1569)',
  'linear-gradient(135deg,#001a0a,#0a3d1a,#1a6929)',
  'linear-gradient(135deg,#1a1400,#3d3000,#665200)',
  'linear-gradient(135deg,#001a1a,#003d3d,#006666)',
  'linear-gradient(135deg,#1a000a,#3d0019,#690029)',
];
function spotBg(spot, idx = 0) {
  const imgs = spot.images || spot.image_urls || [];
  if (imgs[0]) return `url(${imgs[0]}) center/cover no-repeat`;
  return GRADIENTS[idx % GRADIENTS.length];
}

/* ── Render: Continue Planning ── */
function renderContinuePlanning(plans) {
  const grid = document.getElementById('continue-grid');
  if (!grid) return;
  if (!plans.length) {
    grid.innerHTML = emptyState('Start exploring to track your planning sessions.');
    return;
  }
  grid.innerHTML = plans.slice(0, 4).map((p, i) => `
    <div class="cont-card">
      <div class="cont-bg" style="background:${spotBg(p, i)};"></div>
      <div class="cont-ov">
        <div class="cont-pct">${p.completion_pct || Math.floor(Math.random() * 60 + 20)}%</div>
        <div class="cont-title">${escHtml(p.name || 'Untitled Spot')}</div>
        <div class="cont-meta">${p.city || ''}${p.state ? ', ' + p.state : ''}</div>
      </div>
    </div>
  `).join('');
}

/* ── Render: Nearby ── */
function renderNearby(spots) {
  const scroll = document.getElementById('nearby-scroll');
  if (!scroll) return;
  const badge = document.getElementById('nearby-count');
  if (badge && spots.length) badge.textContent = spots.length;
  if (!spots.length) {
    scroll.innerHTML = emptyState('No nearby spots found. Try exploring the map.');
    return;
  }
  scroll.innerHTML = spots.slice(0, 12).map((s, i) => `
    <div class="nb-card">
      <div class="nb-img" style="background:${spotBg(s, i)};">
        ${s.distance_mi ? `<span class="nb-dist">${s.distance_mi.toFixed(1)} mi</span>` : ''}
        <span class="nb-score">${s.shoot_score || 100}</span>
      </div>
      <div class="nb-body">
        <div class="nb-title">${escHtml(s.name)}</div>
        <div class="nb-loc">${escHtml((s.city || '') + (s.state ? ', ' + s.state : ''))}</div>
        <div class="nb-footer">
          <span class="nb-time">${escHtml(s.best_time || 'Golden Hour')}</span>
          <span class="nb-diff ${(s.difficulty || 'easy').toLowerCase()}">${capFirst(s.difficulty || 'Easy')}</span>
        </div>
      </div>
    </div>
  `).join('');
}

/* ── Render: Trending ── */
function renderTrending(spots) {
  const list = document.getElementById('trending-list');
  if (!list) return;
  if (!spots.length) {
    list.innerHTML = emptyState('No trending spots right now. Check back soon.');
    return;
  }
  list.innerHTML = spots.slice(0, 6).map((s, i) => `
    <div class="trend-item">
      <div class="trend-rank">${i + 1}</div>
      <div class="trend-thumb" style="background:${spotBg(s, i)};"></div>
      <div class="trend-info">
        <div class="trend-title">${escHtml(s.name)}</div>
        <div class="trend-loc">${escHtml((s.city || '') + (s.state ? ', ' + s.state : ''))}</div>
      </div>
      ${s.saves_count ? `<div class="trend-saves">${Number(s.saves_count).toLocaleString()} saves</div>` : ''}
    </div>
  `).join('');
}

/* ── Load public spots (landing + explore) ── */
async function loadPublicSpots() {
  try {
    const data = await apiFetch('/api/spots/trending?limit=8');
    allSpots = data.spots || (Array.isArray(data) ? data : []);
    renderSpotGrid(allSpots);
    renderExploreResults(allSpots);
  } catch {
    renderSpotGridDemo();
  }
}

const DEMO_SPOTS = [
  { name:'San Antonio River Walk', city:'San Antonio', state:'TX', shoot_score:100, difficulty:'easy', best_time:'Blue Hour' },
  { name:'Hill Country Live Oak Grove', city:'Boerne', state:'TX', shoot_score:100, difficulty:'moderate', best_time:'Sunrise' },
  { name:'Guadalupe River Cypress Stand', city:'Hunt', state:'TX', shoot_score:100, difficulty:'hard', best_time:'Golden Hour' },
  { name:'Fredericksburg Vineyard', city:'Fredericksburg', state:'TX', shoot_score:100, difficulty:'easy', best_time:'Sunset' },
  { name:'Lost Maples Fall Colors', city:'Vanderpool', state:'TX', shoot_score:100, difficulty:'moderate', best_time:'All Day' },
  { name:'Enchanted Rock Summit', city:'Fredericksburg', state:'TX', shoot_score:98, difficulty:'moderate', best_time:'Sunrise' },
  { name:'Colorado Bend Gorman Falls', city:'Bend', state:'TX', shoot_score:97, difficulty:'hard', best_time:'Midday' },
  { name:'Pedernales Falls', city:'Johnson City', state:'TX', shoot_score:96, difficulty:'easy', best_time:'Golden Hour' },
];

function renderSpotGrid(spots) {
  const grid = document.getElementById('spots-grid');
  if (!grid) return;
  const list = spots.length ? spots : DEMO_SPOTS;
  grid.innerHTML = list.slice(0, 8).map((s, i) => `
    <div class="spot-card">
      <div class="spot-img" style="background:${spotBg(s, i)};">
        <div class="spot-score">${s.shoot_score || 100}</div>
        ${s.is_premium ? '<div class="spot-prem">Premium</div>' : ''}
      </div>
      <div class="spot-body">
        <div class="spot-title">${escHtml(s.name)}</div>
        <div class="spot-loc">${escHtml((s.city || '') + (s.state ? ', ' + s.state : ''))}</div>
        <div class="spot-meta">
          <span>☀ ${escHtml(s.best_time || 'Golden Hour')}</span>
          <span class="${(s.difficulty || 'easy').toLowerCase()}">${capFirst(s.difficulty || 'Easy')}</span>
        </div>
      </div>
    </div>
  `).join('');
}

function renderSpotGridDemo() {
  allSpots = DEMO_SPOTS;
  renderSpotGrid(DEMO_SPOTS);
  renderExploreResults(DEMO_SPOTS);
}

/* ── Explore view rendering ── */
function renderExploreResults(spots) {
  const container = document.getElementById('explore-results');
  if (!container) return;
  if (!spots.length) {
    container.innerHTML = `<div class="coming-soon-state" style="min-height:200px;"><div class="cs-icon">◉</div><div class="cs-title">No spots found</div></div>`;
    return;
  }
  container.innerHTML = spots.map((s, i) => `
    <div class="explore-spot-row">
      <div class="explore-spot-thumb" style="background:${spotBg(s, i)};"></div>
      <div class="explore-spot-info">
        <div class="explore-spot-name">${escHtml(s.name)}</div>
        <div class="explore-spot-loc">${escHtml((s.city || '') + (s.state ? ', ' + s.state : ''))}</div>
        <div class="explore-spot-time">${escHtml(s.best_time || 'Golden Hour')} · <span class="${(s.difficulty || 'easy').toLowerCase()}">${capFirst(s.difficulty || 'Easy')}</span></div>
      </div>
    </div>
  `).join('');
}

/* ── Filter: search text ── */
function filterSpots(query) {
  const q = query.toLowerCase().trim();
  const filtered = allSpots.filter(s =>
    !q ||
    s.name?.toLowerCase().includes(q) ||
    s.city?.toLowerCase().includes(q) ||
    s.state?.toLowerCase().includes(q)
  );
  renderExploreResults(filtered);
}

/* ── Filter: specialty chip ── */
function filterByType(btn, type) {
  document.querySelectorAll('.xchip').forEach(c => c.classList.remove('xchip-active'));
  btn.classList.add('xchip-active');
  const filtered = type
    ? allSpots.filter(s => {
        const tags = (s.shoot_types || s.tags || []).map(t => t.toLowerCase());
        return tags.some(t => t.includes(type.toLowerCase()));
      })
    : allSpots;
  renderExploreResults(filtered.length ? filtered : allSpots);
}

/* ── Load network (use existing users/nearby endpoint) ── */
async function loadNetwork() {
  const container = document.getElementById('network-content');
  if (!container) return;
  try {
    const data = await apiFetch('/api/users/nearby?limit=10').catch(() => null)
      || await apiFetch('/api/users?limit=10').catch(() => null);
    const users = (data?.users || data || []).slice(0, 10);
    if (!users.length) throw new Error('No users');
    const avatarColors = ['#F5A623','#60A5FA','#10B981','#D04848','#A78BFA','#F472B6'];
    container.innerHTML = users.map((u, i) => {
      const initials = (u.name || u.email || 'P').charAt(0).toUpperCase();
      const color = avatarColors[i % avatarColors.length];
      return `
        <div class="network-person">
          <div class="np-avatar" style="background:${color};">${initials}</div>
          <div class="np-info">
            <div class="np-name">${escHtml(u.name || u.email || 'Photographer')}</div>
            <div class="np-spec">${escHtml((u.specialties || []).join(', ') || u.location || 'LumaScout member')}</div>
          </div>
          <button class="np-follow-btn">Follow</button>
        </div>
      `;
    }).join('');
  } catch {
    container.innerHTML = `
      <div class="coming-soon-state" style="min-height:300px;">
        <div class="cs-icon">◈</div>
        <div class="cs-title">Discover photographers</div>
        <div class="cs-sub">Connect with photographers in your area. Use the mobile app for the full network experience.</div>
        <div class="cs-badge">Network expanding</div>
      </div>
    `;
  }
}

/* ── Load marketplace ── */
async function loadMarketplace() {
  const container = document.getElementById('marketplace-content');
  if (!container) return;
  try {
    const data = await apiFetch('/api/marketplace?limit=8');
    const items = data.items || data.packs || data || [];
    if (!items.length) throw new Error('empty');
    const thumbColors = [
      'linear-gradient(135deg,#2d1b69,#7c3aed)',
      'linear-gradient(135deg,#1e3a4f,#0ea5e9)',
      'linear-gradient(135deg,#3d1414,#dc2626)',
      'linear-gradient(135deg,#1a2e1a,#16a34a)',
    ];
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">
        ${items.slice(0, 8).map((item, i) => `
          <div class="trend-item" style="flex-direction:column;align-items:flex-start;padding:16px;">
            <div style="width:100%;height:120px;border-radius:10px;background:${thumbColors[i % thumbColors.length]};margin-bottom:12px;"></div>
            <div class="trend-title" style="font-size:15px;">${escHtml(item.name || item.title || 'Location Pack')}</div>
            <div class="trend-loc">${escHtml(item.creator_name || item.seller || 'Verified Creator')}</div>
            <div style="margin-top:8px;font-size:16px;font-weight:700;color:#F5A623;">$${item.price || '9'}</div>
          </div>
        `).join('')}
      </div>
    `;
  } catch {
    container.innerHTML = `
      <div class="coming-soon-state" style="min-height:300px;">
        <div class="cs-icon">△</div>
        <div class="cs-title">Marketplace</div>
        <div class="cs-sub">Discover curated location packs, presets, and tools from verified photographers. Full marketplace experience available in the mobile app.</div>
        <div class="cs-badge">Coming soon to desktop</div>
      </div>
    `;
  }
}

/* ── Load saved spots ── */
async function loadSaved() {
  const container = document.getElementById('saved-content');
  if (!container) return;
  try {
    const data = await apiFetch('/api/saved?limit=12');
    const spots = data.spots || data.saved || data || [];
    if (!spots.length) throw new Error('empty');
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;">
        ${spots.slice(0, 12).map((s, i) => `
          <div class="spot-card">
            <div class="spot-img" style="background:${spotBg(s, i)};height:140px;">
              <div class="spot-score">${s.shoot_score || 100}</div>
            </div>
            <div class="spot-body">
              <div class="spot-title">${escHtml(s.name)}</div>
              <div class="spot-loc">${escHtml((s.city || '') + (s.state ? ', ' + s.state : ''))}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch {
    container.innerHTML = `
      <div class="coming-soon-state" style="min-height:300px;">
        <div class="cs-icon">☆</div>
        <div class="cs-title">Your saved spots live here.</div>
        <div class="cs-sub">Save spots while exploring to build your personal scouting library. They'll appear here, organized by your collections.</div>
        <button class="btn btn-primary" onclick="switchView('explore',null)" style="margin-top:8px;">Start exploring</button>
      </div>
    `;
  }
}

/* ── Profile view ── */
function populateProfile() {
  const container = document.getElementById('profile-content');
  if (!container || !currentUser) return;
  const name = currentUser.name || currentUser.email || 'Photographer';
  const initials = name.charAt(0).toUpperCase();
  const handle = '@' + (currentUser.username || currentUser.email?.split('@')[0] || 'user');
  const stats = currentUser.stats || {};
  const plan = capFirst(currentUser.plan || 'free');
  container.innerHTML = `
    <div class="profile-card">
      <div class="profile-big-avatar">${initials}</div>
      <div class="profile-info">
        <div class="profile-name">${escHtml(name)}</div>
        <div class="profile-handle">${escHtml(handle)}</div>
        <div class="profile-plan"><span class="feat-tag">${escHtml(plan)} plan</span></div>
        <div class="profile-stats">
          <div class="profile-stat"><div class="profile-stat-num">${stats.spots_count ?? '—'}</div><div class="profile-stat-lbl">Spots</div></div>
          <div class="profile-stat"><div class="profile-stat-num">${stats.saves_count ?? '—'}</div><div class="profile-stat-lbl">Saves</div></div>
          <div class="profile-stat"><div class="profile-stat-num">${stats.followers_count ?? '—'}</div><div class="profile-stat-lbl">Followers</div></div>
        </div>
      </div>
    </div>
    ${currentUser.bio ? `<div style="background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:20px;font-size:14px;color:var(--text2);line-height:1.7;">${escHtml(currentUser.bio)}</div>` : ''}
    <div style="margin-top:20px;padding:16px;background:var(--s1);border:1px solid rgba(245,166,35,.15);border-radius:14px;display:flex;align-items:center;justify-content:space-between;">
      <div><div style="font-size:14px;font-weight:600;">For the full profile experience</div><div style="font-size:13px;color:var(--text2);margin-top:3px;">Edit profile, manage settings, and more in the mobile app.</div></div>
    </div>
  `;
}

/* ── View switching ── */
function switchView(viewId, linkEl) {
  if (linkEl) {
    document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('sb-active'));
    linkEl.classList?.add('sb-active');
  }
  document.querySelectorAll('.view-panel').forEach(p => p.classList.add('hidden'));
  const panel = document.getElementById('view-' + viewId);
  if (panel) panel.classList.remove('hidden');
  currentView = viewId;
  // Lazy load data for each view
  if (viewId === 'explore') loadPublicSpots();
  if (viewId === 'network') loadNetwork();
  if (viewId === 'marketplace') loadMarketplace();
  if (viewId === 'saved') loadSaved();
  return false;
}

/* ── Show/hide app shell vs landing ── */
function showAppShell() {
  const shell = document.getElementById('app-shell');
  const landing = document.querySelector('.landing');
  const footer = document.getElementById('site-footer');
  if (shell) shell.classList.add('visible');
  if (landing) landing.classList.add('hidden');
  if (footer) footer.classList.add('hidden');
}

function showLanding() {
  const shell = document.getElementById('app-shell');
  const landing = document.querySelector('.landing');
  const footer = document.getElementById('site-footer');
  if (shell) shell.classList.remove('visible');
  if (landing) landing.classList.remove('hidden');
  if (footer) footer.classList.remove('hidden');
}

/* ── Logout ── */
function handleLogout() {
  clearSession();
  showLanding();
  const navAuth = document.getElementById('nav-auth');
  if (navAuth) {
    navAuth.innerHTML = `
      <button class="btn btn-ghost" onclick="openModal('login-modal')">Sign In</button>
      <button class="btn btn-primary" onclick="openModal('reg-modal')">Get Started</button>
    `;
  }
  showToast('Signed out successfully.', 'info');
}

function clearSession() {
  token = null;
  currentUser = null;
  localStorage.removeItem(TOKEN_KEY);
}

/* ── Utilities ── */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function capFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
function emptyState(msg) {
  return `<div style="padding:24px;text-align:center;font-size:13px;color:var(--text3);">${msg}</div>`;
}

/* ── Modal backdrop click ── */
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => {
    if (e.target === m) m.classList.remove('open');
  });
});

/* ── Form submit handlers ── */
document.getElementById('login-form')?.addEventListener('submit', handleLogin);
document.getElementById('reg-form')?.addEventListener('submit', handleRegister);

/* ── Expose globals ── */
window.openModal = openModal;
window.closeModal = closeModal;
window.closeMobileNav = closeMobileNav;
window.handleLogout = handleLogout;
window.switchView = switchView;
window.filterSpots = filterSpots;
window.filterByType = filterByType;

/* ── Boot ── */
document.addEventListener('DOMContentLoaded', async () => {
  if (token) {
    await loadUser();
  }
  loadPublicSpots();
});
