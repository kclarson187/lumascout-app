import { Platform } from 'react-native';
import { useEffect } from 'react';

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=Manrope:wght@300;400;500;600;700&display=swap');
:root{--gold:#F5A623;--gold-dark:#D48B1B;--bg:#0A0A0A;--s1:#141416;--s2:#1E1E21;--s3:#26262B;--border:#2A2A2E;--text:#FFFFFF;--t2:#A1A1AA;--t3:#71717A;--ff-display:'Playfair Display',Georgia,serif;--ff-body:'Manrope',system-ui,sans-serif}
html,body{background:var(--bg)!important;font-family:var(--ff-body)!important;-webkit-font-smoothing:antialiased}
::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:var(--s1)}::-webkit-scrollbar-thumb{background:var(--s3);border-radius:3px}
#ls-nav{position:fixed!important;top:0;left:0;right:0;z-index:9999;height:64px;background:rgba(10,10,10,.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 24px;gap:0;box-shadow:0 2px 24px rgba(0,0,0,.4)}
#ls-nav .logo{display:flex;align-items:center;gap:10px;font-family:var(--ff-display)!important;font-size:20px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:-.3px;flex-shrink:0}
#ls-nav .logo-icon{width:30px;height:30px;background:var(--gold);border-radius:8px;display:flex;align-items:center;justify-content:center}
#ls-nav .logo-icon svg{width:18px;height:18px}
#ls-nav .nav-links{display:flex;align-items:center;gap:4px;margin-left:20px;flex:1}
#ls-nav .nav-links a{padding:6px 14px;border-radius:8px;color:var(--t2);font-size:14px;font-weight:500;text-decoration:none;transition:color .2s,background .2s;cursor:pointer}
#ls-nav .nav-links a:hover{color:#fff;background:var(--s2)}
#ls-nav .nav-links a.active{color:var(--gold);background:rgba(245,166,35,.08)}
#ls-nav .nav-right{display:flex;align-items:center;gap:10px;flex-shrink:0;margin-left:auto}
#ls-nav .nav-search-wrap{position:relative;display:flex;align-items:center}
#ls-nav .nav-search{background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:7px 14px 7px 34px;color:var(--text);font-size:13px;width:200px;outline:none;transition:border-color .2s,width .3s;font-family:var(--ff-body)}
#ls-nav .nav-search:focus{border-color:var(--gold);width:260px}
#ls-nav .nav-search::placeholder{color:var(--t3)}
#ls-nav .search-icon{position:absolute;left:10px;color:var(--t3);pointer-events:none}
.ls-btn{padding:7px 16px;border-radius:8px;font-size:13px;font-weight:600;font-family:var(--ff-body);cursor:pointer;border:none;transition:all .2s;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.ls-btn-ghost{background:transparent;color:var(--t2);border:1px solid var(--border)}
.ls-btn-ghost:hover{color:#fff;border-color:var(--t2)}
.ls-btn-gold{background:var(--gold);color:#000}
.ls-btn-gold:hover{background:var(--gold-dark)}
#ls-sidebar{position:fixed;top:64px;left:0;bottom:0;width:220px;background:var(--s1);border-right:1px solid var(--border);z-index:1000;overflow-y:auto;padding:16px 12px;display:flex;flex-direction:column;gap:4px}
.sb-section{margin-top:16px}.sb-section:first-child{margin-top:0}
.sb-label{font-size:10px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:var(--t3);padding:4px 8px 8px;display:block}
#ls-sidebar a{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;color:var(--t2);font-size:14px;font-weight:500;text-decoration:none;transition:all .15s;cursor:pointer}
#ls-sidebar a:hover{color:#fff;background:var(--s2)}
#ls-sidebar a.active{color:var(--gold);background:rgba(245,166,35,.1)}
@media(min-width:768px){#ls-nav{display:flex}#ls-sidebar{display:flex}}
@media(max-width:767px){#ls-nav{height:52px}#ls-nav .nav-links,#ls-nav .nav-search-wrap{display:none}#ls-sidebar{display:none}}
`;

export function useWebStyles() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;
    if (document.getElementById('ls-web-styles')) return;

    const style = document.createElement('style');
    style.id = 'ls-web-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
    document.title = 'LumaScout — Find Epic Places. Plan the Perfect Shot.';

    if (!document.getElementById('ls-nav')) {
      const nav = document.createElement('nav');
      nav.id = 'ls-nav';
      nav.innerHTML = `
        <a class="logo" href="/">
          <div class="logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5">
              <circle cx="12" cy="12" r="3"/>
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/>
            </svg>
          </div>
          LumaScout
        </a>
        <div class="nav-links">
          <a class="active" data-tab="home">Home</a>
          <a data-tab="explore">Explore</a>
          <a data-tab="network">Network</a>
          <a data-tab="marketplace">Marketplace</a>
        </div>
        <div class="nav-right">
          <div class="nav-search-wrap">
            <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input class="nav-search" placeholder="Search spots, photographers..."/>
          </div>
          <button class="ls-btn ls-btn-ghost">Log in</button>
          <button class="ls-btn ls-btn-gold">Get Started</button>
        </div>
      `;
      document.body.insertBefore(nav, document.body.firstChild);
      nav.querySelectorAll('[data-tab]').forEach(el => {
        el.addEventListener('click', () => {
          const tab = (el as HTMLElement).dataset.tab || 'home';
          document.querySelectorAll('#ls-nav [data-tab], #ls-sidebar [data-tab]').forEach(a => a.classList.remove('active'));
          document.querySelectorAll('[data-tab="' + tab + '"]').forEach(a => a.classList.add('active'));
        });
      });
    }

    if (!document.getElementById('ls-sidebar')) {
      const sb = document.createElement('aside');
      sb.id = 'ls-sidebar';
      sb.innerHTML = `
        <div class="sb-section">
          <span class="sb-label">Discover</span>
          <a class="active" data-tab="home"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>Home Feed</a>
          <a data-tab="explore"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>Explore Map</a>
        </div>
        <div class="sb-section">
          <span class="sb-label">My Stuff</span>
          <a data-tab="saved"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>Collections</a>
        </div>
        <div class="sb-section">
          <span class="sb-label">Social</span>
          <a data-tab="network"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>Network</a>
          <a data-tab="marketplace"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>Marketplace</a>
        </div>
        <div class="sb-section">
          <span class="sb-label">Account</span>
          <a data-tab="profile"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>Profile</a>
        </div>
      `;
      document.body.insertBefore(sb, document.body.firstChild ? document.body.firstChild.nextSibling : null);
      sb.querySelectorAll('[data-tab]').forEach(el => {
        el.addEventListener('click', () => {
          const tab = (el as HTMLElement).dataset.tab || 'home';
          document.querySelectorAll('#ls-nav [data-tab], #ls-sidebar [data-tab]').forEach(a => a.classList.remove('active'));
          document.querySelectorAll('[data-tab="' + tab + '"]').forEach(a => a.classList.add('active'));
        });
      });
    }
  }, []);
}

export function updateWebNavTab(tab: string) {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('#ls-nav [data-tab], #ls-sidebar [data-tab]').forEach(el => {
    el.classList.toggle('active', (el as HTMLElement).dataset.tab === tab);
  });
}
