/**
 * Formulaire court /decouvrir — validation, UTM, envoi, confirmation.
 */
(function () {
  var form = document.getElementById('captureForm');
  if (!form) return;

  var API = '/.netlify/functions/api-qualification-lead';
  var formError = document.getElementById('formError');
  var submitBtn = document.getElementById('submitBtn');
  var formScreen = document.getElementById('formScreen');
  var confirmScreen = document.getElementById('confirmScreen');
  var demoBtn = document.getElementById('demoBtn');

  form.addEventListener('change', function (e) {
    var input = e.target;
    if (input.type !== 'radio') return;
    form.querySelectorAll('[name="' + input.name + '"]').forEach(function (radio) {
      radio.closest('.qualif-choice').classList.toggle('is-selected', radio.checked);
    });
  });

  function errorNode(name) {
    return form.querySelector('[data-error-for="' + name + '"]');
  }

  function clearErrors() {
    form.querySelectorAll('.qualif-error').forEach(function (p) { p.textContent = ''; });
    form.querySelectorAll('.is-invalid').forEach(function (i) { i.classList.remove('is-invalid'); });
  }

  function setError(name, message) {
    var node = errorNode(name);
    if (node) node.textContent = message;
    var input = form.querySelector('[name="' + name + '"]');
    if (input && input.classList.contains('qualif-input')) input.classList.add('is-invalid');
  }

  function value(name) {
    var el = form.elements[name];
    if (!el) return '';
    if (!el.tagName) return el.value || '';
    return (el.value || '').trim();
  }

  function isEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v);
  }

  function isPhone(v) {
    var digits = v.replace(/\D/g, '');
    return digits.length === 10 || (digits.length === 11 && digits.charAt(0) === '1');
  }

  function validate() {
    clearErrors();
    var fields = [
      ['firstName', 'Entrez votre prénom.'],
      ['businessName', "Entrez le nom de l'entreprise."],
      ['inboundChannel', 'Choisissez une réponse.'],
      ['phone', 'Entrez un numéro à 10 chiffres.'],
      ['email', 'Entrez un courriel valide.'],
    ];
    var firstBad = null;

    fields.forEach(function (pair) {
      var name = pair[0];
      var emptyMsg = pair[1];
      var v = value(name);
      var msg = '';
      if (!v) msg = emptyMsg;
      else if (name === 'firstName' && v.length < 2) msg = 'Prénom trop court.';
      else if (name === 'businessName' && v.length < 2) msg = 'Nom trop court.';
      else if (name === 'email' && !isEmail(v)) msg = 'Courriel invalide.';
      else if (name === 'phone' && !isPhone(v)) msg = 'Entrez un numéro à 10 chiffres.';
      if (msg) {
        setError(name, msg);
        if (!firstBad) firstBad = name;
      }
    });

    if (firstBad) {
      var node = errorNode(firstBad) || form.querySelector('[name="' + firstBad + '"]');
      if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    return true;
  }

  function readQueryUtm() {
    var q = new URLSearchParams(window.location.search);
    return {
      source: q.get('utm_source') || '',
      medium: q.get('utm_medium') || '',
      campaign: q.get('utm_campaign') || '',
      content: q.get('utm_content') || '',
      term: q.get('utm_term') || '',
      fbclid: q.get('fbclid') || '',
      ttclid: q.get('ttclid') || '',
      igshid: q.get('igshid') || '',
      referrer: document.referrer || '',
      landing_page: window.location.pathname,
    };
  }

  function hasAttribution(utm) {
    return !!(utm.source || utm.medium || utm.campaign || utm.fbclid || utm.ttclid || utm.igshid);
  }

  function attribution() {
    var fresh = readQueryUtm();
    var stored = {};
    try { stored = JSON.parse(sessionStorage.getItem('novia_utm') || '{}'); } catch (e) { stored = {}; }
    var utm = hasAttribution(fresh) ? fresh : Object.assign({}, stored, {
      referrer: stored.referrer || fresh.referrer,
      landing_page: fresh.landing_page,
    });
    if (hasAttribution(fresh)) {
      try { sessionStorage.setItem('novia_utm', JSON.stringify(utm)); } catch (e) { /* ignore */ }
    }
    return utm;
  }

  // Capture UTM dès l'arrivée, avant que le visiteur recharge sans query.
  attribution();

  function setDemoLink(firstName, business, email) {
    if (!demoBtn) return;
    var mailto = 'mailto:noviaai.contact@gmail.com'
      + '?subject=' + encodeURIComponent('Démo NoviaAI — ' + (business || ''))
      + '&body=' + encodeURIComponent(
        'Bonjour,\n\nJe souhaite une courte démo NoviaAI.\n'
        + 'Prénom : ' + (firstName || '') + '\n'
        + 'Entreprise : ' + (business || '') + '\n'
        + 'Courriel : ' + (email || '') + '\n'
      );
    demoBtn.href = mailto;

    fetch('/.netlify/functions/api-config')
      .then(function (res) { return res.json().catch(function () { return {}; }); })
      .then(function (cfg) {
        var url = (cfg && cfg.demoBookingUrl) || '';
        if (!url) return;
        try {
          var u = new URL(url, window.location.origin);
          if (firstName) u.searchParams.set('name', firstName);
          if (email) u.searchParams.set('email', email);
          demoBtn.href = u.toString();
        } catch (e) {
          demoBtn.href = url;
        }
      })
      .catch(function () { /* mailto déjà en place */ });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validate()) return;

    formError.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Envoi…';

    var payload = {
      formVariant: 'capture',
      firstName: value('firstName'),
      businessName: value('businessName'),
      inboundChannel: value('inboundChannel'),
      phone: value('phone'),
      email: value('email'),
      siteWeb: value('siteWeb'),
      utm: attribution(),
    };

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.error || 'Envoi impossible');
          return data;
        });
      })
      .then(function () {
        if (typeof window.noviaTrackLead === 'function') window.noviaTrackLead();
        setDemoLink(payload.firstName, payload.businessName, payload.email);
        formScreen.classList.add('qualif-hidden');
        confirmScreen.classList.remove('qualif-hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      })
      .catch(function (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Voir comment NoviaAI peut aider mon entreprise';
        formError.textContent = err.message === 'Failed to fetch'
          ? 'Connexion interrompue. Réessayez.'
          : (err.message || 'Une erreur est survenue. Réessayez.');
      });
  });
})();
