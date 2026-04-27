import { Platform } from 'react-native';
import { useEffect } from 'react';

const CSS = [
  "@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=Manrope:wght@300;400;500;600;700&display=swap');",
  ":root{--gold:#F5A623;--gold-dark:#D48B1B;--bg:#0A0A0A;--s1:#141416;--s2:#1E1E21;--s3:#26262B;--border:#2A2A2E;--text:#FFFFFF;--t2:#A1A1AA;--t3:#71717A;--ff-display:'Playfair Display',Georgia,serif;--ff-body:'Manrope',system-ui,sans-serif;}",
  "html,body{background:var(--bg)!important;font-family:var(--ff-body)!important;-webkit-font-smoothing:antialiased;}",
  "::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:var(--s1)}::-webkit-scrollbar-thumb{background:var(--s3);border-radius:3px}",
  "::selection{background:rgba(245,166,35,0.25)}",
  "#ls-nav{position:fixed!important;top:0;left:0;right:0;z-index:9999;height:64px;background:rgba(10,10,10,.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 24px;gap:0;box-shadow:0 2px 24px rgba(0,0,0,.4)}",
  "#ls-nav .logo{display:flex;align-items:center;gap:10px;font-family:var(--ff-display)!important;font-size:20px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:-.3px;flex-shrink:0}",
  "#ls-nav .logo-icon{width:30px;height:30px;background:var(--gold);border-radius:8px;display:flex;align-items:center;justify-content:center}",
  "#ls-nav .logo-icon svg{width:18px;height:18px}",
  "#ls-nav .nav-links{display:flex;align-items:center;gap:4px;margin-left:20px;flex:1}",
  "#ls-nav .nav-links a{padding:6px 14px;border-radius:8px;color:var(--t2);font-size:14px;font-weight:500;text-decoration:none;transition:color .2s,background .2s;cursor:pointer}",
  "#ls-nav .nav-links a:hover{color:#fff;background:var(--s2)}",
  "#ls-nav .nav-links a.active{color:var(--gold);background:rgba(245,166,35,.08)}",
  "#ls-nav .nav-right{display:flex;align-items:center;gap:10px;flex-shrink:0;margin-left:auto}",
  "#ls-nav .nav-search-wrap{position:relative;display:flex;align-items:center}",
  "#ls-nav .nav-search{background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:7px 14px 7px 34px;color:var(--text);font-size:13px;width:200px;outline:none;transition:border-color .2s,width .3s;font-family:var(--ff-body)}",
  "#ls-nav .nav-search:focus{border-color:var(--gold);width:250px}",
  "#ls-nav .nav-search::placeholder{color:var(--t3)}",
  "#ls-nav .nav-search-icon{position:absolute;left:10px;color:var(--t3);font-size:12px;pointer-events:none}",
  ".ls-btn{padding:7px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid var(--border);transition:all .2s;font-family:var(--ff-body)}",
  ".ls-btn-ghost{background:transparent;color:var(--t2)}.ls-btn-ghost:hover{background:var(--s2);color:#fff}",
  ".ls-btn-primary{background:var(--gold);color:#000;border-color:var(--gold)}.ls-btn-primary:hover{background:var(--gold-dark)}",
  ".ls-avatar{width:34px;height:34px;border-radius:50%;background:var(--gold);color:#000;font-size:13px;font-weight:700;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}",
  "@media(min-width:769px){#root>div:first-child{padding-top:64px!important}}",
  "@media(max-width:768px){#ls-nav .nav-links,#ls-nav .nav-search-wrap{display:none!important}#ls-nav{height:56px}#ls-nav .logo{font-size:17px}#ls-sidebar{display:none!important}}",
  "#ls-sidebar{position:fixed;top:64px;left:0;width:220px;height:calc(100vh - 64px);background:var(--s1);border-right:1px solid var(--border);padding:16px 10px;overflow-y:auto;z-index:100;display:none}",
  "@media(min-width:1024px){#ls-sidebar{display:block}}",
  "#ls-sidebar .sb-section{margin-bottom:20px}",
  "#ls-sidebar .sb-label{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--t3);padding:0 8px;margin-bottom:6px;display:block}",
  "#ls-sidebar a{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;color:var(--t2);font-size:14px;font-weight:500;text-decoration:none;margin-bottom:1px;transition:background .2s,color .2s;cursor:pointer}",
  "#ls-sidebar a:hover{background:var(--s2);color:#fff}",
  "#ls-sidebar a.active{background:rgba(245,166,35,.1);color:var(--gold)}",
  "@media(min-width:1024px){.ls-main{margin-left:220px!important;max-width:none!important}}",
  "@keyframes fadeInUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}",
  ".ls-fade-in{animation:fadeInUp .35s ease forwards}",
  "button:focus-visible,a:focus-visible{outline:2px solid var(--gold);outline-offset:2px}",
  "h1,h2,h3{letter-spacing:-.3px}",
].join('\n');

export function useWebStyles() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const id = 'ls-web-styles';
    if (!document.getElementById(id)) {
      const s = document.createElement('style');
      s.id = id;
      s.textContent = CSS;
      document.head.insertBefore(s, document.head.firstChild);
    }
    document.title = 'LumaScout — Find Epic Places. Plan the Perfect Shot.';
    if (!document.querySelector('link[rel="icon"]')) {
      const ico = document.createElement('link');
      ico.rel = 'icon';
      ico.type = 'image/svg+xml';
      ico.href = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%23F5A623'/%3E%3Cpath d='M50 15L15 35l35 20 35-20L50 15zM15 65l35 20 35-20M15 50l35 20 35-20' stroke='%23000' stroke-width='6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";
      document.head.appendChild(ico);
    }
    const metas = [
      ['name','description','LumaScout is the AI-powered photography scouting app. Discover epic locations, plan perfect shots, and connect with creators.'],
      ['property','og:title','LumaScout — Photography Scouting App'],
      ['property','og:description','Find epic places. Plan the perfect shot.'],
      ['name','theme-color','#0A0A0A'],
    ];
    metas.forEach(([k,v,c]) => {
      if (!document.querySelector(`meta[${k}="${v}"]`)) {
        const m = document.createElement('meta');
        m.setAttribute(k, v);
        m.content = c;
        document.head.appendChild(m);
      }
    });
  }, []);
}

export function injectWebNav(user: any, onLogin: () => void, onSignup: () => void, onTab: (t: string) => void) {
  if (typeof document === 'undefined') return;
  if (document.getElementById('ls-nav')) return;
  
  const nav = document.createElement('div');
  nav.id = 'ls-nav';
  const initials = user ? (user.name || user.email || 'U')[0].toUpperCase() : '';
  nav.innerHTML = `
    <a class="logo" href="#" onclick="return false;">
      <div class="logo-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
      </div>
      LumaScout
    </a>
    ${user ? `
      <div class="nav-links" id="ls-nav-links">
        <a class="active" data-tab="home" href="#" onclick="return false;">Home</a>
        <a data-tab="explore" href="#" onclick="return false;">Explore</a>
        <a data-tab="network" href="#" onclick="return false;">Network</a>
        <a data-tab="marketplace" href="#" onclick="return false;">Marketplace</a>
      </div>
    ` : ''}
    <div class="nav-right">
      ${user ? `
        <div class="nav-search-wrap">
          <span class="nav-search-icon">&#128269;</span>
          <input class="nav-search" placeholder="Search spots, cities..." type="search">
        </div>
        <button class="ls-avatar" data-tab="profile">${initials}</button>
      ` : `
        <button class="ls-btn ls-btn-ghost" id="ls-nav-login">Log in</button>
        <button class="ls-btn ls-btn-primary" id="ls-nav-signup">Get Started</button>
      `}
    </div>
  `;
  document.body.insertBefore(nav, document.body.firstChild);
  
  if (!user) {
    const loginBtn = document.getElementById('ls-nav-login');
    const signupBtn = document.getElementById('ls-nav-signup');
    if (loginBtn) loginBtn.onclick = onLogin;
    if (signupBtn) signupBtn.onclick = onSignup;
  } else {
    nav.querySelectorAll('[data-tab]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = (el as HTMLElement).dataset.tab || 'home';
        nav.querySelectorAll('[data-tab]').forEach(a => a.classList.remove('active'));
        el.classList.add('active');
        onTab(tab);
      });
    });
  }
}

export function injectWebSidebar(user: any, onTab: (t: string) => void) {
  if (!user || typeof document === 'undefined') return;
  if (document.getElementById('ls-sidebar')) return;
  
  const sb = document.createElement('div');
  sb.id = 'ls-sidebar';
  sb.innerHTML = `
    <div class="sb-section">
      <span class="sb-label">Discover</span>
      <a class="active" data-tab="home">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        Home Feed
      </a>
      <a data-tab="explore">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        Explore
      </a>
      <a data-tab="trending">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
        Trending
      </a>
    </div>
    <div class="sb-section">
      <span class="sb-label">My Stuff</span>
      <a data-tab="saved">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        Collections
      </a>
    </div>
    <div class="sb-section">
      <span class="sb-label">Social</span>
      <a data-tab="network">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Network
      </a>
      <a data-tab="marketplace">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
        Marketplace
      </a>
    </div>
    <div class="sb-section">
      <span class="sb-label">Account</span>
      <a data-tab="profile">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Profile
      </a>
    </div>
  `;
  document.body.insertBefore(sb, document.body.firstChild.nextSibling || null);
  
  sb.querySelectorAll('[data-tab]').forEach(el => {
    el.addEventListener('click', () => {
      const tab = (el as HTMLElement).dataset.tab || 'home';
      sb.querySelectorAll('[data-tab]').forEach(a => a.classList.remove('active'));
      document.querySelectorAll('#ls-nav [data-tab]').forEach(a => a.classList.remove('active'));
      el.classList.add('active');
      onTab(tab);
    });
  });
}

export function updateWebNavTab(tab: string) {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('#ls-nav [data-tab], #ls-sidebar [data-tab]').forEach(el => {
    el.classList.toggle('active', (el as HTMLElement).dataset.tab === tab);
  });
}
