
const API = 'https://photo-finder-60.emergent.host';
let token = localStorage.getItem('ls_token');
let currentUser = null;

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

async function apiFetch(path, opts = {}) {
  const headers = {'Content-Type': 'application/json'};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(API + path, {...opts, headers: {...headers, ...(opts.headers || {})}});
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || 'Request failed');
  return data;
}

function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = (type === 'success' ? '&#10003; ' : type === 'error' ? '&#215; ' : 'i ') + msg;
  $('.toast-container').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function openModal(id) { $('#' + id).classList.add('open'); }
function closeModal(id) { $('#' + id).classList.remove('open'); }

$$('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});

async function handleLogin(e) {
  e.preventDefault();
  const email = $('#login-email').value;
  const pw = $('#login-pw').value;
  const err = $('#login-err');
  err.textContent = '';
  try {
    const d = await apiFetch('/api/auth/login', {method:'POST', body: JSON.stringify({email, password: pw})});
    token = d.access_token;
    localStorage.setItem('ls_token', token);
    closeModal('login-modal');
    await loadUser();
    showToast('Welcome back!', 'success');
  } catch(ex) { err.textContent = ex.message; }
}

async function handleRegister(e) {
  e.preventDefault();
  const name = $('#reg-name').value;
  const email = $('#reg-email').value;
  const pw = $('#reg-pw').value;
  const err = $('#reg-err');
  err.textContent = '';
  try {
    const d = await apiFetch('/api/auth/register', {method:'POST', body: JSON.stringify({name, email, password: pw})});
    token = d.access_token;
    localStorage.setItem('ls_token', token);
    closeModal('reg-modal');
    await loadUser();
    showToast('Welcome to LumaScout!', 'success');
  } catch(ex) { err.textContent = ex.message; }
}

async function loadUser() {
  try {
    currentUser = await apiFetch('/api/auth/me');
    updateNavForUser();
    showAppShell();
    loadFeed();
  } catch(ex) {
    token = null;
    localStorage.removeItem('ls_token');
    currentUser = null;
    showLanding();
  }
}

function updateNavForUser() {
  if (!currentUser) return;
  const initials = (currentUser.name || currentUser.email || 'U').charAt(0).toUpperCase();
  $('#nav-auth').innerHTML = `
    <button class="btn btn-ghost" onclick="handleLogout()">Sign Out</button>
    <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#F5A623,#D48B1B);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;color:#000;cursor:pointer;">${initials}</div>
  `;
  const name = currentUser.name || currentUser.email || 'Photographer';
  $('.feed-greeting') && ($('.feed-greeting').textContent = 'Welcome back,');
  $('.feed-title') && ($('.feed-title').textContent = name.split(' ')[0]);
  
  const rv = $('.rail-av');
  if (rv) rv.textContent = initials;
  const rn = $('.rail-name');
  if (rn) rn.textContent = currentUser.name || currentUser.email;
  const rh = $('.rail-handle');
  if (rh) rh.textContent = '@' + (currentUser.username || currentUser.email.split('@')[0]);
  
  const stats = currentUser.stats || {};
  const sns = $$('.rail-stat-n');
  if (sns[0]) sns[0].textContent = stats.spots_count || 0;
  if (sns[1]) sns[1].textContent = stats.saves_count || 0;
  if (sns[2]) sns[2].textContent = stats.followers_count || 0;
}

function handleLogout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('ls_token');
  showLanding();
  $('#nav-auth').innerHTML = `
    <button class="btn btn-ghost" onclick="openModal('login-modal')">Log in</button>
    <button class="btn btn-primary" onclick="openModal('reg-modal')">Get Started</button>
  `;
  showToast('Signed out', 'info');
}

function showAppShell() {
  $('.app-shell').classList.add('visible');
  $('.landing').classList.add('hidden');
}

function showLanding() {
  $('.app-shell').classList.remove('visible');
  $('.landing').classList.remove('hidden');
}

async function loadFeed() {
  try {
    const feed = await apiFetch('/api/home_feed');
    if (feed.continue_planning) renderContinuePlanning(feed.continue_planning);
    if (feed.best_near_you) renderNearby(feed.best_near_you);
    if (feed.trending_this_week) renderTrending(feed.trending_this_week);
  } catch(ex) {
    console.log('Feed load error:', ex.message);
  }
}

function spotBg(spot) {
  const imgs = spot.images || spot.image_urls || [];
  if (imgs.length > 0) return 'url(' + imgs[0] + ')';
  const colors = ['linear-gradient(135deg,#1a1a2e,#0f3460)','linear-gradient(135deg,#0d1f1f,#2d5a4e)','linear-gradient(135deg,#1a0a00,#5c2d00)','linear-gradient(135deg,#0a001a,#2d1569)'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function renderContinuePlanning(plans) {
  const grid = $('.cont-grid');
  if (!grid || !plans.length) return;
  grid.innerHTML = plans.slice(0, 4).map(p => `
    <div class="cont-card" onclick="openSpot('${p._id || p.id}')">
      <div class="cont-bg" style="background:${spotBg(p)};background-size:cover;"></div>
      <div class="cont-ov">
        <div class="cont-pct">${p.completion_pct || Math.floor(Math.random()*60+20)}%</div>
        <div class="cont-title">${p.name || 'Untitled Plan'}</div>
        <div class="cont-meta">${p.stops_count || p.spot_count || 0} stops</div>
      </div>
    </div>
  `).join('');
}

function renderNearby(spots) {
  const scroll = $('.nearby-scroll');
  if (!scroll || !spots.length) return;
  const diffs = ['easy', 'moderate', 'hard'];
  scroll.innerHTML = spots.slice(0, 10).map(s => `
    <div class="nb-card" onclick="openSpot('${s._id || s.id}')">
      <div class="nb-img" style="background:${spotBg(s)};background-size:cover;">
        <span class="nb-dist">${s.distance_mi ? s.distance_mi.toFixed(1) + ' mi' : 'Nearby'}</span>
        <span class="nb-score">${s.shoot_score || 100}</span>
      </div>
      <div class="nb-body">
        <div class="nb-title">${s.name}</div>
        <div class="nb-loc">${s.city || ''}${s.state ? ', ' + s.state : ''}</div>
        <div class="nb-footer">
          <span class="nb-time">${s.best_time || 'Golden Hour'}</span>
          <span class="nb-diff ${s.difficulty || diffs[Math.floor(Math.random()*3)]}">${(s.difficulty || 'Easy').charAt(0).toUpperCase() + (s.difficulty || 'easy').slice(1)}</span>
        </div>
      </div>
    </div>
  `).join('');
}

function renderTrending(spots) {
  const list = $('.trend-list');
  if (!list || !spots.length) return;
  list.innerHTML = spots.slice(0, 5).map((s, i) => `
    <div class="trend-item" onclick="openSpot('${s._id || s.id}')">
      <div class="trend-rank">${i+1}</div>
      <div class="trend-thumb" style="background:${spotBg(s)};"></div>
      <div class="trend-info">
        <div class="trend-title">${s.name}</div>
        <div class="trend-loc">${s.city || ''}${s.state ? ', ' + s.state : ''}</div>
      </div>
      <div class="trend-saves">${s.saves_count ? s.saves_count.toLocaleString() + ' saves' : ''}</div>
    </div>
  `).join('');
}

function openSpot(id) {
  if (!id) return;
  showToast('Opening spot...', 'info');
}

window.addEventListener('scroll', () => {
  const nav = $('nav');
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 40);
});

$$('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => btn.closest('.modal-overlay').classList.remove('open'));
});

$('#login-form')?.addEventListener('submit', handleLogin);
$('#reg-form')?.addEventListener('submit', handleRegister);

const switchToReg = () => { closeModal('login-modal'); openModal('reg-modal'); };
const switchToLogin = () => { closeModal('reg-modal'); openModal('login-modal'); };
window.switchToReg = switchToReg;
window.switchToLogin = switchToLogin;
window.openModal = openModal;
window.closeModal = closeModal;
window.handleLogout = handleLogout;
window.openSpot = openSpot;

document.addEventListener('DOMContentLoaded', async () => {
  if (token) await loadUser();
  loadPublicSpots();
});

async function loadPublicSpots() {
  try {
    const data = await apiFetch('/api/spots/trending?limit=8');
    const spots = data.spots || data || [];
    renderPublicSpots(spots);
  } catch(ex) {
    renderPublicSpotsDemo();
  }
}

const DEMO_SPOTS = [
  {name:'San Antonio River Walk',city:'San Antonio',state:'TX',shoot_score:100,difficulty:'easy',best_time:'Blue Hour'},
  {name:'Hill Country Live Oak Grove',city:'Boerne',state:'TX',shoot_score:100,difficulty:'moderate',best_time:'Sunrise'},
  {name:'Guadalupe River Cypress Stand',city:'Hunt',state:'TX',shoot_score:100,difficulty:'hard',best_time:'Golden Hour'},
  {name:'Fredericksburg Vineyard',city:'Fredericksburg',state:'TX',shoot_score:100,difficulty:'easy',best_time:'Sunset'},
  {name:'Lost Maples Fall Colors',city:'Vanderpool',state:'TX',shoot_score:100,difficulty:'moderate',best_time:'All Day'},
  {name:'Enchanted Rock Summit',city:'Fredericksburg',state:'TX',shoot_score:98,difficulty:'moderate',best_time:'Sunrise'},
  {name:'Colorado Bend Gorman Falls',city:'Bend',state:'TX',shoot_score:97,difficulty:'hard',best_time:'Midday'},
  {name:'Pedernales Falls',city:'Johnson City',state:'TX',shoot_score:96,difficulty:'easy',best_time:'Golden Hour'},
];

const GRAD_BKGS = [
  'linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)',
  'linear-gradient(135deg,#0d1f1f,#1a3333,#2d5a4e)',
  'linear-gradient(135deg,#1a0a00,#3d1a00,#5c2d00)',
  'linear-gradient(135deg,#0a001a,#1a0a3d,#2d1569)',
  'linear-gradient(135deg,#001a0a,#0a3d1a,#1a6929)',
  'linear-gradient(135deg,#1a1400,#3d3000,#665200)',
  'linear-gradient(135deg,#001a1a,#003d3d,#006666)',
  'linear-gradient(135deg,#1a000a,#3d0019,#690029)',
];

function renderPublicSpots(spots) {
  const grid = $('.spots-grid');
  if (!grid) return;
  if (!spots.length) { renderPublicSpotsDemo(); return; }
  grid.innerHTML = spots.map((s, i) => `
    <div class="spot-card">
      <div class="spot-img" style="background:${GRAD_BKGS[i % GRAD_BKGS.length]};background-size:cover;">
        <div class="spot-score">${s.shoot_score || 100}</div>
        ${s.is_premium ? '<div class="spot-prem">Premium</div>' : ''}
      </div>
      <div class="spot-body">
        <div class="spot-title">${s.name}</div>
        <div class="spot-loc">${s.city || ''}${s.state ? ', ' + s.state : ''}</div>
        <div class="spot-meta">
          <span>&#9728; ${s.best_time || 'Golden Hour'}</span>
          <span>&#127981; ${s.temperature || '72'}&#176;F</span>
          <span class="${(s.difficulty || 'easy').toLowerCase()}">${(s.difficulty || 'Easy').charAt(0).toUpperCase() + (s.difficulty || 'easy').slice(1)}</span>
        </div>
      </div>
    </div>
  `).join('');
}

function renderPublicSpotsDemo() {
  const grid = $('.spots-grid');
  if (!grid) return;
  grid.innerHTML = DEMO_SPOTS.map((s, i) => `
    <div class="spot-card">
      <div class="spot-img" style="background:${GRAD_BKGS[i % GRAD_BKGS.length]};">
        <div class="spot-score">${s.shoot_score}</div>
      </div>
      <div class="spot-body">
        <div class="spot-title">${s.name}</div>
        <div class="spot-loc">${s.city}, ${s.state}</div>
        <div class="spot-meta">
          <span>&#9728; ${s.best_time}</span>
          <span class="${s.difficulty}">${s.difficulty.charAt(0).toUpperCase() + s.difficulty.slice(1)}</span>
        </div>
      </div>
    </div>
  `).join('');
}
