/** Ajoute ?demo=1 aux liens du menu app si mode démo. */
(function () {
  if (new URLSearchParams(location.search).get('demo') !== '1') return;
  document.querySelectorAll('.dash-nav a[href]').forEach((a) => {
    const url = new URL(a.getAttribute('href'), location.origin);
    url.searchParams.set('demo', '1');
    a.href = url.pathname + url.search;
  });
})();
