/**
 * Meta Pixel NoviaAI — PageView + helpers conversion.
 * Pixel ID public (normal). Ne pas y mettre de secrets.
 */
(function () {
  var PIXEL_ID = '1422965575850124';

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

  window.noviaEventId = function () {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  window.noviaPixelCookies = function () {
    var out = { fbp: '', fbc: '' };
    try {
      document.cookie.split(';').forEach(function (part) {
        var i = part.indexOf('=');
        if (i < 0) return;
        var k = part.slice(0, i).trim();
        var v = part.slice(i + 1).trim();
        if (k === '_fbp') out.fbp = decodeURIComponent(v);
        if (k === '_fbc') out.fbc = decodeURIComponent(v);
      });
    } catch (e) { /* ignore */ }
    return out;
  };

  /** Inscription / démarrage essai */
  window.noviaTrackSignup = function () {
    try { window.fbq('track', 'CompleteRegistration'); } catch (e) {}
  };

  window.noviaTrackViewContent = function (name) {
    try { window.fbq('track', 'ViewContent', { content_name: name || 'decouvrir' }); } catch (e) {}
  };

  /** Formulaire /decouvrir envoyé — eventID pour dédup CAPI */
  window.noviaTrackLead = function (eventID) {
    try {
      if (eventID) window.fbq('track', 'Lead', { content_name: 'qualification' }, { eventID: eventID });
      else window.fbq('track', 'Lead');
    } catch (e) {}
  };
})();
