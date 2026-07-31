/**
 * Meta Pixel NoviaAI — PageView + helpers conversion.
 * Pixel ID public (normal). Ne pas y mettre de secrets.
 */
(function () {
  var PIXEL_ID = '2225416118303851';

  if (typeof window === 'undefined') return;
  if (window.fbq) {
    try { window.fbq('track', 'PageView'); } catch (e) {}
    return;
  }

  !(function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = !0;
    n.version = '2.0';
    n.queue = [];
    t = b.createElement(e);
    t.async = !0;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

  window.fbq('init', PIXEL_ID);
  window.fbq('track', 'PageView');

  /** Inscription / démarrage essai */
  window.noviaTrackSignup = function () {
    try { window.fbq('track', 'CompleteRegistration'); } catch (e) {}
  };

  /** Clic CTA principal (démo / essai) */
  window.noviaTrackLead = function () {
    try { window.fbq('track', 'Lead'); } catch (e) {}
  };
})();
