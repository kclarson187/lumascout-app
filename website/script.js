(() => {
  /* ── Sticky nav scroll state ── */
  const nav = document.getElementById('site-nav');
  const onScroll = () => {
    if (!nav) return;
    nav.classList.toggle('scrolled', window.scrollY > 12);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ── Mobile hamburger toggle ── */
  const toggle = document.getElementById('nav-toggle');
  const mobileNav = document.getElementById('mobile-nav');
  if (toggle && mobileNav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('menu-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      mobileNav.hidden = !open;
    });
    mobileNav.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        nav.classList.remove('menu-open');
        toggle.setAttribute('aria-expanded', 'false');
        mobileNav.hidden = true;
      });
    });
  }

  /* ── Escape key closes modals ── */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    }
  });

  /* ── Reveal on scroll ── */
  const revealSelectors = [
    '.feat-card', '.step-card', '.benefit-item',
    '.price-card', '.t-card', '.spot-card',
    '.section-head', '.desktop-copy', '.desktop-visual',
    '.hero-trust', '.benefits-list',
  ];
  if ('IntersectionObserver' in window) {
    const targets = document.querySelectorAll(revealSelectors.join(','));
    targets.forEach(el => el.classList.add('reveal'));
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    targets.forEach(el => io.observe(el));
  }

  /* ── Smooth nav link scroll ── */
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const href = a.getAttribute('href');
      if (href === '#' || href === '#top') return;
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        const navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 64;
        window.scrollTo({ top: target.offsetTop - navH, behavior: 'smooth' });
      }
    });
  });
})();
