/**
 * Formulaire de qualification /potentiel — étapes, validation, envoi, estimation.
 * Le barème vient de revenue-estimate.js (même source que le serveur).
 */
(function () {
  var E = window.NoviaEstimate;
  var form = document.getElementById('qualifForm');
  if (!form || !E) return;

  var API = '/.netlify/functions/api-qualification-lead';
  var TOTAL_STEPS = 3;

  var steps = Array.prototype.slice.call(form.querySelectorAll('.qualif-step'));
  var progressFill = document.getElementById('progressFill');
  var stepNow = document.getElementById('stepNow');
  var formError = document.getElementById('formError');
  var submitBtn = document.getElementById('submitBtn');
  var formScreen = document.getElementById('formScreen');
  var confirmScreen = document.getElementById('confirmScreen');
  var resultScreen = document.getElementById('resultScreen');
  var revealBtn = document.getElementById('revealBtn');

  var LABELS = {
    sector: 'Secteur',
    callsPerMonth: "Appels reçus par mois",
    missedCalls: 'Appels manqués par mois',
    clientValue: "Valeur d'un nouveau client",
    intent: 'Intérêt',
  };

  var REQUIRED_BY_STEP = {
    1: ['sector', 'callsPerMonth', 'missedCalls', 'clientValue'],
    2: ['intent'],
    3: ['firstName', 'lastName', 'businessName', 'phone', 'email', 'consent'],
  };

  var lastEstimate = null;

  /* ---------- Navigation ---------- */

  function showStep(n) {
    steps.forEach(function (s) {
      s.classList.toggle('is-active', Number(s.dataset.step) === n);
    });
    progressFill.style.width = (n / TOTAL_STEPS) * 100 + '%';
    stepNow.textContent = String(n);
    clearErrors();
    formError.textContent = '';
    scrollToCard();
  }

  function scrollToCard() {
    var top = formScreen.getBoundingClientRect().top + window.pageYOffset - 20;
    window.scrollTo({ top: top < 0 ? 0 : top, behavior: 'smooth' });
  }

  // État visuel des choix en JS aussi : les webviews Facebook/Instagram anciennes
  // ignorent :has(), et un choix qui ne s'allume pas fait abandonner le formulaire.
  form.addEventListener('change', function (e) {
    var input = e.target;
    if (input.type !== 'radio') return;
    form.querySelectorAll('[name="' + input.name + '"]').forEach(function (radio) {
      radio.closest('.qualif-choice').classList.toggle('is-selected', radio.checked);
    });
  });

  form.addEventListener('click', function (e) {
    var next = e.target.closest('[data-next]');
    if (next) {
      var target = Number(next.dataset.next);
      if (validateStep(target - 1)) showStep(target);
      return;
    }
    var back = e.target.closest('[data-back]');
    if (back) showStep(Number(back.dataset.back));
  });

  /* ---------- Validation ---------- */

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
    // Sans tagName, c'est une RadioNodeList : sa propriété value donne l'option cochée.
    if (!el.tagName) return el.value || '';
    if (el.type === 'checkbox') return el.checked ? '1' : '';
    return (el.value || '').trim();
  }

  function isEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v);
  }

  function isPhone(v) {
    // 10 chiffres (Amérique du Nord), avec ou sans le 1 devant.
    var digits = v.replace(/\D/g, '');
    return digits.length === 10 || (digits.length === 11 && digits.charAt(0) === '1');
  }

  function validateStep(n) {
    clearErrors();
    var fields = REQUIRED_BY_STEP[n] || [];
    var firstBad = null;

    fields.forEach(function (name) {
      var v = value(name);
      var msg = '';

      if (!v) {
        if (name === 'consent') msg = 'Veuillez accepter pour recevoir votre estimation.';
        else if (LABELS[name]) msg = 'Choisissez une réponse.';
        else msg = 'Ce champ est requis.';
      } else if (name === 'email' && !isEmail(v)) {
        msg = 'Courriel invalide.';
      } else if (name === 'phone' && !isPhone(v)) {
        msg = 'Entrez un numéro à 10 chiffres.';
      }

      if (msg) {
        setError(name, msg);
        if (!firstBad) firstBad = name;
      }
    });

    if (firstBad) {
      var node = errorNode(firstBad);
      if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    return true;
  }

  /* ---------- Attribution ---------- */

  function attribution() {
    var q = new URLSearchParams(window.location.search);
    return {
      source: q.get('utm_source') || '',
      medium: q.get('utm_medium') || '',
      campaign: q.get('utm_campaign') || '',
      content: q.get('utm_content') || '',
      term: q.get('utm_term') || '',
      fbclid: q.get('fbclid') || '',
      referrer: document.referrer || '',
      landing_page: window.location.pathname,
    };
  }

  /* ---------- Envoi ---------- */

  attribution();

  if (typeof window.noviaTrackViewContent === 'function') {
    window.noviaTrackViewContent('potentiel');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validateStep(3)) return;

    formError.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Calcul en cours…';

    var eventId = typeof window.noviaEventId === 'function' ? window.noviaEventId() : '';
    var cookies = typeof window.noviaPixelCookies === 'function' ? window.noviaPixelCookies() : {};
    var payload = {
      firstName: value('firstName'),
      lastName: value('lastName'),
      businessName: value('businessName'),
      phone: value('phone'),
      email: value('email'),
      sector: value('sector'),
      callsPerMonth: value('callsPerMonth'),
      missedCalls: value('missedCalls'),
      clientValue: value('clientValue'),
      intent: value('intent'),
      consent: value('consent') === '1',
      siteWeb: value('siteWeb'),
      utm: attribution(),
      eventId: eventId,
      fbp: cookies.fbp || '',
      fbc: cookies.fbc || '',
    };

    lastEstimate = E.estimate(payload.missedCalls, payload.clientValue);

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
        if (typeof window.noviaTrackLead === 'function') window.noviaTrackLead(eventId);
        showConfirm(payload.firstName);
      })
      .catch(function (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Voir mon estimation';
        formError.textContent = err.message === 'Failed to fetch'
          ? 'Connexion interrompue. Réessayez.'
          : (err.message || 'Une erreur est survenue. Réessayez.');
      });
  });

  /* ---------- Écrans de sortie ---------- */

  function showConfirm(firstName) {
    document.getElementById('confirmName').textContent = firstName || 'merci';
    formScreen.classList.add('qualif-hidden');
    confirmScreen.classList.remove('qualif-hidden');
    scrollToTop();
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  revealBtn.addEventListener('click', function () {
    renderResult(lastEstimate);
    confirmScreen.classList.add('qualif-hidden');
    resultScreen.classList.remove('qualif-hidden');
    scrollToTop();
  });

  function renderResult(est) {
    if (!est || !est.valid) est = { monthly: 0, low: 0, high: 0, yearly: 0, missedCalls: 0, clientValue: 0, ratePct: 25 };

    document.getElementById('resultAmount').textContent = E.formatCad(est.monthly);
    document.getElementById('resultRange').textContent =
      'Fourchette réaliste : ' + E.formatCad(est.low) + ' à ' + E.formatCad(est.high)
      + ' par mois · environ ' + E.formatCad(est.yearly) + ' par année.';

    var rows = [
      ['Appels manqués estimés', est.missedCalls + ' / mois'],
      ['Valeur moyenne d\'un client', E.formatCad(est.clientValue)],
      ['Taux de récupération appliqué', est.ratePct + ' %'],
    ];

    var list = document.getElementById('resultDetail');
    list.textContent = '';
    rows.forEach(function (row) {
      var li = document.createElement('li');
      var label = document.createElement('span');
      label.textContent = row[0];
      var val = document.createElement('strong');
      val.textContent = row[1];
      li.appendChild(label);
      li.appendChild(val);
      list.appendChild(li);
    });
  }
})();
