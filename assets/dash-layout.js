/** Conserve le mode démo (?demo=1) dans le menu SaaS — uniquement si l'URL le demande. */
(function () {
  const fromUrl = new URLSearchParams(location.search).get('demo') === '1';
  if (!fromUrl) {
    sessionStorage.removeItem('novia_demo');
    return;
  }
  sessionStorage.setItem('novia_demo', '1');
  document.querySelectorAll('.dash-nav a[href], .dash-sidebar a.logo').forEach((a) => {
    try {
      const url = new URL(a.getAttribute('href'), location.origin);
      if (url.origin !== location.origin) return;
      url.searchParams.set('demo', '1');
      a.href = url.pathname + url.search;
    } catch (_) { /* ignore */ }
  });
})();
