let tenant = null;
let pollTimer = null;
(function persistDemoFlag() {
  const q = new URLSearchParams(location.search).get('demo');
  if (q === '1') sessionStorage.setItem('novia_demo', '1');
  if (q === '0') sessionStorage.removeItem('novia_demo');
})();
const DEMO = new URLSearchParams(location.search).get('demo') === '1'
  || sessionStorage.getItem('novia_demo') === '1';
const DASH_PAGE = document.body.dataset.dashPage || 'home';
const DEMO_QS = DEMO ? '?demo=1' : '';

function dashHref(path) {
  return path + DEMO_QS;
}

function dashGo(page) {
  const routes = {
    home: '/dashboard.html',
    publier: '/publier.html',
    chatbot: '/chatbot.html',
    conversations: '/conversations.html',
    parametres: '/parametres.html',
  };
  if (routes[page]) location.href = dashHref(routes[page]);
}

function $(id) { return document.getElementById(id); }

function parseServices(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const parts = line.split('—').map(s => s.trim());
    return { nom: parts[0], prix: parts[1] || '', description_courte: parts[0] };
  });
}

function servicesToText(services) {
  if (!Array.isArray(services) || !services.length) return '';
  return services.map(s => (s.prix ? `${s.nom || s.description_courte} — ${s.prix}` : (s.nom || s.description_courte || ''))).filter(Boolean).join('\n');
}

function faqToText(faq) {
  if (!Array.isArray(faq) || !faq.length) return '';
  return faq.map(f => `Q: ${f.question}\nR: ${f.reponse}`).join('\n\n');
}

function policiesToText(policies) {
  if (!Array.isArray(policies) || !policies.length) return '';
  return policies.join('\n');
}

function populateSettingsForm(t) {
  if (!t) return;
  const set = (id, val) => { const el = $(id); if (el) el.value = val; };
  const setCheck = (id, val) => { const el = $(id); if (el) el.checked = val; };
  set('setBusinessName', t.business_name || '');
  set('setBusinessPhone', t.phone_forward || '');
  set('setContactEmail', t.contact_email || t.email || '');
  set('setMissedSms', t.missed_call_sms || '');
  set('setGoogleReviewUrl', t.google_review_url || '');
  set('setReviewRequestSms', t.review_request_sms || '');
  setCheck('setAutoReviewRequest', !!t.auto_review_request);
  const delay = $('setReviewDelayMinutes');
  if (delay) delay.value = t.review_request_delay_minutes || 5;
  setCheck('setWidgetEnabled', t.widget_enabled !== false);
  const revStat = $('statReviewSent');
  if (revStat) revStat.textContent = String(t.review_requests_sent || 0);
  updateWidgetEmbedUI(t);
}

function widgetEmbedCode(t) {
  if (!t || !t.widget_public_id) return 'Enregistrez vos paramètres pour générer le code.';
  const base = location.origin.replace(/\/$/, '');
  return `<script src="${base}/widget.js" data-widget-id="${t.widget_public_id}" async><\/script>`;
}

function updateWidgetEmbedUI(t) {
  const code = widgetEmbedCode(t);
  const el = document.getElementById('widgetEmbedCode');
  const el2 = document.getElementById('widgetEmbedCodeInstall');
  if (el) el.textContent = code;
  if (el2) el2.textContent = code;
}

function populateChatbotForm(t) {
  if (window.NoviaChatbot) NoviaChatbot.populateChatbotForm(t);
}

function isForwardMode(t) {
  return !!(t && t.line_mode === 'forward');
}

function publicPhoneDisplay(t) {
  if (!t) return 'Activation…';
  if (t.twilio_number && t.provisioning_status === 'active') return formatDial(t.twilio_number);
  return 'En activation…';
}

function displayPhone(t) {
  return publicPhoneDisplay(t);
}

function hasBillingSetup(t) {
  return !!(t && t.stripe_subscription_id);
}

function isPaidSubscription(t) {
  return !!(t && t.subscription_status === 'active' && hasBillingSetup(t));
}

function formatSubStatus(status) {
  const labels = {
    trialing: 'Essai gratuit',
    active: 'Actif',
    canceled: 'Annulé',
    inactive: 'Inactif',
    past_due: 'Paiement en retard',
  };
  return labels[status] || status || '—';
}

function showFlashBanner(id, html, className) {
  if (document.getElementById(id)) return;
  const banner = document.createElement('div');
  banner.id = id;
  banner.className = className || 'prov-box success';
  banner.style.marginBottom = '16px';
  banner.innerHTML = html;
  const anchor = document.getElementById('billingBanner');
  document.querySelector('.dash-main').insertBefore(banner, anchor || document.querySelector('.dash-header').nextSibling);
}

function handleBillingReturn() {
  const params = new URLSearchParams(location.search);
  if (params.get('paid') === '1') {
    sessionStorage.setItem('novia_provisioning', '1');
    showFlashBanner(
      'paidSuccessBanner',
      '<strong>Merci!</strong><p class="muted" style="margin:8px 0 0;font-size:.92rem">Votre carte est enregistrée. Activation de votre ligne en cours (~1–2 min).</p>'
    );
    history.replaceState({}, '', location.pathname);
  } else if (params.get('cancel') === '1') {
    showFlashBanner(
      'checkoutCancelBanner',
      '<strong>Paiement annulé</strong><p class="muted" style="margin:8px 0 0;font-size:.92rem">Aucun frais. Vous pouvez ajouter votre carte quand vous voulez.</p>',
      'prov-box'
    );
    history.replaceState({}, '', location.pathname);
  }
}

function updateProvBox() {
  const box = $('provBox');
  const title = $('provTitle');
  const msg = $('provMsg');
  const retry = $('btnRetryProv');
  if (!tenant || !box) return;

  if (tenant.line_mode === 'hosted' && tenant.hosted_status !== 'active') {
    clearInterval(pollTimer);
    box.hidden = false;
    box.className = 'prov-box';
    title.textContent = '📱 Portage de numéro en cours';
    const num = tenant.existing_business_number || tenant.phone_forward || '';
    msg.textContent = num
      ? `Nous portons ${num} sur NoviaAI. Notre équipe vous contacte sous 48h ouvrables.`
      : 'Notre équipe finalise le portage de votre ligne — vous serez avisé par courriel.';
    retry.style.display = 'none';
    return;
  }

  if (tenant.provisioning_status === 'active' && tenant.twilio_number) {
    clearInterval(pollTimer);
    sessionStorage.removeItem('novia_provisioning');
    const published = localStorage.getItem(forwardDoneKey()) === '1';
    if (published && (isPaidSubscription(tenant) || hasBillingSetup(tenant))) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.className = 'prov-box success';
    title.textContent = 'Ligne NoviaAI prête';
    msg.textContent = published
      ? (isForwardMode(tenant)
        ? 'Testez : appelez votre numéro habituel, ne répondez pas.'
        : 'Testez un appel manqué depuis un autre téléphone.')
      : (isForwardMode(tenant)
        ? 'Appelez votre fournisseur pour configurer le renvoi vers votre numéro NoviaAI.'
        : 'Copiez votre numéro et publiez-le sur Google.');
    retry.style.display = 'none';
    return;
  }

  if (tenant.provisioning_status === 'failed') {
    box.hidden = false;
    box.className = 'prov-box';
    title.textContent = 'Activation échouée';
    msg.textContent = tenant.provisioning_error || 'Erreur inconnue — cliquez Réessayer.';
    retry.style.display = 'inline-flex';
    return;
  }

  if (tenant.provisioning_status === 'provisioning' || tenant.provisioning_status === 'pending') {
    box.hidden = false;
    box.className = 'prov-box';
    title.textContent = '⏳ Activation en cours…';
    msg.textContent = 'Achat de votre numéro local (~1–2 min). Si ça traîne, cliquez Réessayer.';
    retry.style.display = 'inline-flex';
  }
}

function applyTenantToUI() {
  if (!tenant) return;
  const biz = $('bizName');
  if (biz) biz.textContent = tenant.business_name;
  const statStatus = $('statStatus');
  if (statStatus) statStatus.textContent = formatSubStatus(tenant.subscription_status);
  const statPlan = $('statPlan');
  if (statPlan) statPlan.textContent = (tenant.plan || 'pro').toUpperCase();
  const pub = publicPhoneDisplay(tenant);
  const statPhone = $('statPhone');
  if (statPhone) statPhone.textContent = pub;
  const bigPhone = $('bigPublicPhone');
  if (bigPhone) bigPhone.textContent = pub;
  const ringHint = $('cellRingHint');
  const numLabel = document.querySelector('.number-display .muted');
  if (numLabel) {
    numLabel.textContent = isForwardMode(tenant)
      ? 'Votre numéro NoviaAI (renvoi d\'appel)'
      : 'Numéro à publier en ligne';
  }
  if (ringHint) {
    if (tenant.phone_forward && tenant.provisioning_status === 'active') {
      ringHint.hidden = false;
      ringHint.textContent = isForwardMode(tenant)
        ? 'Gardez ' + formatDial(tenant.existing_business_number || tenant.phone_forward) + ' sur Google — appelez votre fournisseur pour renvoyer les appels manqués vers le numéro ci-dessus.'
        : 'Votre cellulaire sonne quand on appelle ce numéro : ' + formatDial(tenant.phone_forward);
    } else {
      ringHint.hidden = true;
    }
  }
  if (DASH_PAGE === 'parametres') populateSettingsForm(tenant);
  // Ne pas recharger le formulaire chatbot ici — ça efface les lignes ajoutées non enregistrées.
  // populateChatbotForm est appelé une fois au chargement de la page.
  updateWidgetEmbedUI(tenant);
  updateBillingUI(tenant);
  updateProvBox();
  const live = tenant.provisioning_status === 'active' && tenant.twilio_number;
  const liveBadge = $('liveStatus');
  if (liveBadge) liveBadge.style.display = live ? 'inline-flex' : 'none';
  const phoneDesc = $('phonePanelDesc');
  if (phoneDesc) {
    phoneDesc.textContent = isForwardMode(tenant)
      ? 'Vous avez reçu un numéro NoviaAI. Appelez votre fournisseur pour activer le renvoi d\'appels manqués vers ce numéro. Gardez votre numéro actuel sur Google.'
      : 'Mettez ce numéro sur Google, Facebook et votre site. Vos clients appellent ici — votre cellulaire sonne.';
  }
  const btnInstall = $('btnOpenInstall');
  if (btnInstall) btnInstall.textContent = isForwardMode(tenant) ? 'Configurer le renvoi' : 'Publier mon numéro';
  if (DASH_PAGE === 'publier') updateInstallWizard();
  if (DASH_PAGE === 'home') updateChecklist();
  if (sessionStorage.getItem('novia_show_link_guide') === '1' && live) {
    sessionStorage.removeItem('novia_show_link_guide');
    if (DASH_PAGE !== 'publier') dashGo('publier');
  }
}

function updateForwardProviderGuide() {
  if (!tenant?.twilio_number || !window.NoviaInstallGuide) return;
  const providerId = document.getElementById('forwardProvider')?.value || 'bell';
  const num = formatDial(tenant.twilio_number);
  const guide = NoviaInstallGuide.getInstructions('mobile', providerId, 'no_answer', tenant.twilio_number);
  const tip = guide.providerTip || NoviaInstallGuide.getProviderTip(providerId);
  const tipEl = document.getElementById('forwardProviderTip');
  const stepsEl = document.getElementById('forwardProviderSteps');
  const warnEl = document.getElementById('forwardIphoneWarn');
  if (tipEl && tip) {
    tipEl.innerHTML = [
      tip.note ? `<p class="forward-provider-tip-lead"><strong>${tip.label}</strong> — ${tip.note}</p>` : '',
      `<p><strong>iPhone :</strong> ${tip.iphone}</p>`,
      `<p><strong>Android :</strong> ${tip.android}</p>`,
      tip.callProvider ? `<p><strong>Soutien :</strong> ${tip.support}</p>` : '',
      tip.callProvider ? `<p class="forward-call-script"><strong>À dire au fournisseur :</strong> « Je veux activer le renvoi d'appels <em>si je ne réponds pas</em> vers ${num}. Mon téléphone doit sonner d'abord — ce n'est pas un renvoi permanent. »</p>` : '',
    ].join('');
  }
  if (stepsEl) {
    const steps = [
      'Copiez le numéro NoviaAI ci-dessus',
      ...(guide.steps || []),
      'Test : appelez votre numéro habituel depuis un autre téléphone, ne répondez pas → SMS auto au client',
    ];
    stepsEl.innerHTML = steps.map((s) => `<li>${s}</li>`).join('');
  }
  if (warnEl) {
    const needsWarn = providerId === 'bell' || providerId === 'videotron';
    warnEl.hidden = !needsWarn;
    if (needsWarn) {
      warnEl.textContent = providerId === 'bell'
        ? 'Important iPhone Bell : n\'activez pas « Renvoi d\'appel » dans Réglages — ce serait permanent. Appelez Bell ou configurez depuis un Android.'
        : 'Important iPhone Vidéotron : n\'activez pas le toggle « Renvoi d\'appel » dans Réglages — ce serait permanent. Appelez Vidéotron ou configurez depuis un Android.';
    }
  }
}

function updateInstallWizard() {
  if (!tenant || !tenant.twilio_number) return;
  const num = formatDial(tenant.twilio_number);
  const forward = isForwardMode(tenant);
  const elA = document.getElementById('installTwilioNumA');
  const elFwd = document.getElementById('installTwilioNumForward');
  const planNew = document.getElementById('installPlanNew');
  const planForward = document.getElementById('installPlanForward');
  const panelTitle = document.getElementById('installPanelTitle');
  const panelDesc = document.getElementById('installPanelDesc');
  if (elA) elA.textContent = num;
  if (elFwd) elFwd.textContent = num;
  if (planNew) planNew.hidden = forward;
  if (planForward) planForward.hidden = !forward;
  if (panelTitle) panelTitle.textContent = forward ? 'Configurer le renvoi d\'appel' : 'Publier votre numéro';
  if (panelDesc) {
    panelDesc.textContent = forward
      ? 'Copiez votre numéro NoviaAI et configurez le renvoi d\'appels manqués chez votre fournisseur — voir le guide ci-dessous.'
      : 'Copiez votre ligne NoviaAI et mettez-la où vos clients vous cherchent. Aucune config dans Réglages du téléphone.';
  }
  if (forward) updateForwardProviderGuide();
}

function markInstallDone() {
  localStorage.setItem(forwardDoneKey(), '1');
  localStorage.setItem(installPrefsKey() + '_tested', '1');
  markCheck('chk3', true);
  markCheck('chk4', true);
}

function initInstallWizard() {
  async function copyText(text, btn, okLabel) {
    try {
      await navigator.clipboard.writeText(text);
      if (btn) { btn.textContent = okLabel || 'Copié!'; setTimeout(() => { btn.textContent = 'Copier'; }, 2000); }
    } catch { alert(text); }
  }
  document.getElementById('btnCopyTwilioA')?.addEventListener('click', () => {
    copyText($('installTwilioNumA').textContent.trim(), $('btnCopyTwilioA'));
  });
  const btnCopyFwd = document.getElementById('btnCopyTwilioForward');
  if (btnCopyFwd) {
    btnCopyFwd.onclick = () => {
      copyText(document.getElementById('installTwilioNumForward').textContent.trim(), btnCopyFwd);
    };
  }
  async function copyWidgetCode(btn) {
    const code = (document.getElementById('widgetEmbedCodeInstall') || {}).textContent || '';
    if (!code || code === '—') return alert('Code widget non disponible — enregistrez vos paramètres.');
    await copyText(code, btn, 'Copié!');
  }
  const btnW = document.getElementById('btnCopyWidget');
  const btnWI = document.getElementById('btnCopyWidgetInstall');
  if (btnW) btnW.onclick = () => copyWidgetCode(btnW);
  if (btnWI) btnWI.onclick = () => copyWidgetCode(btnWI);
  document.getElementById('btnInstallDoneA').onclick = () => {
    markInstallDone();
    document.getElementById('btnInstallDoneA').textContent = 'Terminé';
    document.getElementById('btnInstallDoneA').disabled = true;
  };
  const btnDoneFwd = $('btnInstallDoneForward');
  if (btnDoneFwd) {
    btnDoneFwd.onclick = () => {
      markInstallDone();
      btnDoneFwd.textContent = 'Terminé';
      btnDoneFwd.disabled = true;
    };
  }
  const forwardProv = $('forwardProvider');
  if (forwardProv) {
    const saved = localStorage.getItem('novia_forward_provider');
    if (saved) forwardProv.value = saved;
    forwardProv.onchange = () => {
      localStorage.setItem('novia_forward_provider', forwardProv.value);
      updateForwardProviderGuide();
    };
  }
}

function installPrefsKey() {
  return tenant && tenant.id ? `novia_install_prefs_${tenant.id}` : '';
}

function digitsOnly(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function formatDial(raw) {
  const d = digitsOnly(raw);
  if (d.length === 11 && d.startsWith('1')) {
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw || '—';
}

function forwardDoneKey() {
  return tenant && tenant.id ? `novia_forward_done_${tenant.id}` : '';
}

function needsForwardSetup() {
  return !!(tenant && tenant.twilio_number && tenant.provisioning_status === 'active');
}

function updateChecklist() {
  if (!tenant) return;
  markCheck('chk1', tenant.onboarding_done);
  markCheck('chk2', tenant.provisioning_status === 'active' && tenant.twilio_number);
  markCheck('chk3', !needsForwardSetup() || localStorage.getItem(forwardDoneKey()) === '1');
  markCheck('chk4', localStorage.getItem(installPrefsKey() + '_tested') === '1');
}

function updateBillingUI(t) {
  if (!t || DEMO) return;
  const box = document.getElementById('billingBanner');
  const title = document.getElementById('billingTitle');
  const msg = document.getElementById('billingMsg');
  const btnSub = document.getElementById('btnSubscribe');
  const btnPortal = document.getElementById('btnManageBilling');
  if (!box) return;

  const status = t.subscription_status || 'trialing';
  const hasBilling = hasBillingSetup(t);
  const planLabel = (t.plan || 'pro').toUpperCase();
  const trialEnd = t.trial_ends_at ? new Date(t.trial_ends_at) : null;
  const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd - Date.now()) / 86400000)) : 14;
  const trialEndStr = trialEnd
    ? trialEnd.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  if (btnSub) {
    btnSub.hidden = false;
    btnSub.disabled = false;
  }
  if (btnPortal) btnPortal.hidden = true;

  if (isPaidSubscription(t)) {
    box.hidden = false;
    box.className = 'prov-box success billing-banner-compact';
    title.textContent = 'Abonnement actif';
    msg.textContent = `Forfait ${planLabel} · Gérez votre carte et vos factures dans Stripe.`;
    if (btnSub) btnSub.hidden = true;
    if (btnPortal) btnPortal.hidden = false;
    return;
  }

  if (status === 'trialing' && hasBilling) {
    box.hidden = false;
    box.className = 'prov-box success';
    title.textContent = daysLeft <= 3 ? `Essai — ${daysLeft} jour(s) restant(s)` : 'Essai gratuit — carte enregistrée';
    msg.textContent = trialEndStr
      ? `Forfait ${planLabel} · Premier prélèvement après le ${trialEndStr}.`
      : `Forfait ${planLabel} · Votre carte est enregistrée pour la fin de l'essai.`;
    if (btnSub) btnSub.hidden = true;
    if (btnPortal) btnPortal.hidden = false;
    return;
  }

  box.hidden = false;
  if (['canceled', 'inactive', 'past_due'].includes(status)) {
    box.className = 'prov-box billing-urgent';
    title.textContent = status === 'past_due' ? 'Paiement en retard' : 'Abonnement inactif';
    msg.textContent = status === 'past_due'
      ? 'Mettez à jour votre carte pour éviter la suspension de votre ligne.'
      : 'Votre ligne NoviaAI est suspendue. Réactivez votre forfait pour continuer.';
    if (btnSub) {
      btnSub.hidden = false;
      btnSub.textContent = hasBilling ? 'Mettre à jour la carte' : 'Réactiver mon abonnement';
    }
    if (btnPortal) btnPortal.hidden = !hasBilling;
    return;
  }

  box.className = daysLeft <= 3 ? 'prov-box billing-urgent' : 'prov-box success';
  title.textContent = daysLeft <= 3 ? `Essai — ${daysLeft} jour(s) restant(s)` : 'Essai gratuit actif';
  msg.textContent = trialEndStr
    ? `Forfait ${planLabel} · Ajoutez votre carte avant le ${trialEndStr}.`
    : `Forfait ${planLabel} · Ajoutez votre carte pour continuer après l'essai.`;
  if (btnSub) {
    btnSub.hidden = false;
    btnSub.textContent = 'Ajouter ma carte';
  }
}

async function startCheckout() {
  if (tenant && hasBillingSetup(tenant) && !['canceled', 'inactive'].includes(tenant.subscription_status)) {
    return openBillingPortal();
  }
  const plan = (tenant && tenant.plan) || 'pro';
  const res = await NoviaApp.api('api-stripe-checkout', {
    method: 'POST',
    body: JSON.stringify({ plan }),
  });
  if (res.error) throw new Error(res.error);
  if (res.url) location.href = res.url;
}

async function openBillingPortal() {
  const res = await NoviaApp.api('api-stripe-portal', { method: 'POST', body: '{}' });
  if (res.error) throw new Error(res.error);
  if (res.url) location.href = res.url;
}

function loadDemoData() {
  tenant = {
    business_name: 'Salon Éclat',
    business_type: 'Salon de coiffure',
    welcome_sms: 'Bonjour! Ici Léa, du Salon Éclat. Comment puis-je vous aider?',
    onboarding_done: true,
    provisioning_status: 'active',
    website_url: 'https://exemple-saloneclat.ca',
    existing_business_number: '+1 (581) 909-5332',
    twilio_number: '+1 (418) 555-0142',
    phone_forward: '581-909-5332',
    area_code: '418',
    contact_email: 'contact@saloneclat.ca',
    agent_name: 'Léa',
    agent_tone: 'Français québécois, chaleureux et professionnel',
    services: [
      { nom: 'Coupe femme', prix: 'à partir de 45 $', description_courte: 'Coupe femme' },
      { nom: 'Balayage', prix: 'à partir de 120 $', description_courte: 'Balayage' },
    ],
    reservation_url: 'https://calendly.com/exemple',
    address_line: '245, rue Principale',
    city: 'Lévis',
    faq: [{ question: 'Faut-il un rendez-vous?', reponse: 'Oui, on fonctionne sur rendez-vous.' }],
    hours: {
      lundi: { ouvert: true, debut: '9h', fin: '18h' },
      mardi: { ouvert: true, debut: '9h', fin: '18h' },
      mercredi: { ouvert: true, debut: '9h', fin: '18h' },
      jeudi: { ouvert: true, debut: '9h', fin: '21h' },
      vendredi: { ouvert: true, debut: '9h', fin: '21h' },
      samedi: { ouvert: true, debut: '9h', fin: '16h' },
      dimanche: { ouvert: false, debut: '9h', fin: '16h' },
    },
    policies: ['Annulation 24h à l\'avance', 'Paiement: carte, argent, Interac'],
    missed_call_sms: 'Bonjour! Désolée, on a manqué votre appel à Salon Éclat 😊',
    subscription_status: 'trialing',
    plan: 'pro',
    avg_client_value: 75,
  };
  applyTenantToUI();
  markCheck('chk1', true);
  markCheck('chk2', true);
  markCheck('chk3', true);
  markCheck('chk4', true);
  const roiBox = $('roiBox');
  if (roiBox) roiBox.style.display = 'block';
  const roiVal = $('roiVal');
  if (roiVal) roiVal.textContent = '1 125 $ – 2 850 $';
  const statMsgs = $('statMsgs');
  if (statMsgs) statMsgs.textContent = '47';
  const missed = $('missedCount');
  if (missed) missed.textContent = '12';
  const leads = $('leadCount');
  if (leads) leads.textContent = '8';
  if (DASH_PAGE === 'conversations') {
  inboxData = [
    { caller_phone: '+1 (418) 555-7821', last_preview: 'Oui jeudi 15 h pour une coupe', has_lead: true, missed_calls: 1, last_at: new Date().toISOString(), lead_summary: 'RDV jeudi 15 h — coupe femme' },
    { caller_phone: '+1 (581) 555-3390', last_preview: 'C\'est combien un balayage?', has_lead: false, missed_calls: 2, last_at: new Date(Date.now() - 86400000).toISOString() },
    { caller_phone: '+1 (514) 555-9012', last_preview: 'Merci, je passe samedi', has_lead: true, missed_calls: 0, last_at: new Date(Date.now() - 172800000).toISOString(), lead_summary: 'Visite samedi AM' },
  ];
  renderInboxList();
  openThreadDemo('+1 (418) 555-7821');
  }
  if (!document.getElementById('demoBanner')) {
    const banner = document.createElement('div');
    banner.id = 'demoBanner';
    banner.className = 'prov-box success';
    banner.style.marginBottom = '16px';
    banner.innerHTML = '<strong>Mode démo</strong><p class="muted" style="margin:8px 0 0;font-size:.92rem">Données fictives pour voir le SaaS complet. <a href="/signup.html?plan=pro">Créer un vrai compte →</a></p>';
    document.querySelector('.dash-main').insertBefore(banner, document.querySelector('.dash-main').firstChild.nextSibling);
  }
}

function showOfflineBanner() {
  if (DEMO) return;
  if (document.getElementById('offlineBanner')) return;
  const banner = document.createElement('div');
  banner.id = 'offlineBanner';
  banner.className = 'prov-box';
  banner.style.marginBottom = '16px';
  banner.style.borderColor = 'var(--err, #c0392b)';
  banner.innerHTML = '<strong>Connexion impossible</strong><p class="muted" style="margin:8px 0 0;font-size:.92rem">Rechargez la page ou reconnectez-vous. <a href="/login.html">Connexion</a></p>';
  document.querySelector('.dash-main').prepend(banner);
}

function openThreadDemo(phone) {
  selectedPhone = phone;
  renderInboxList();
  const thread = $('inboxThread');
  if (!thread) return;
  const msgs = phone.includes('7821') ? [
    { direction: 'outbound', body: 'Bonjour! Désolée, on a manqué votre appel à Salon Éclat 😊 On peut vous aider par texto — qu\'est-ce que vous cherchiez?', created_at: new Date(Date.now() - 3600000).toISOString() },
    { direction: 'inbound', body: 'C\'est combien une coupe femme?', created_at: new Date(Date.now() - 3500000).toISOString() },
    { direction: 'outbound', body: 'Coupe femme à partir de 45 $. On a des places jeudi PM — voulez-vous qu\'on vous réserve?', created_at: new Date(Date.now() - 3400000).toISOString() },
    { direction: 'inbound', body: 'Oui jeudi 15 h', created_at: new Date(Date.now() - 3300000).toISOString() },
    { direction: 'outbound', body: 'Parfait! Je note jeudi 15 h. Quel est votre prénom?', created_at: new Date(Date.now() - 3200000).toISOString() },
  ] : [
    { direction: 'outbound', body: 'Bonjour! Salon Éclat ici — comment puis-je vous aider?', created_at: new Date().toISOString() },
    { direction: 'inbound', body: 'Horaires samedi?', created_at: new Date().toISOString() },
  ];
  thread.innerHTML = msgs.map(m => {
    const cls = m.direction === 'inbound' ? 'in' : 'out';
    const label = m.direction === 'inbound' ? 'Client' : 'NoviaAI';
    return `<div class="inbox-bubble ${cls}"><small class="muted">${label} · ${new Date(m.created_at).toLocaleString('fr-CA')}</small><br>${m.body.replace(/</g,'&lt;')}</div>`;
  }).join('');
}

(async () => {
  try {
    if (window.NoviaChatbot && DASH_PAGE === 'chatbot') {
      NoviaChatbot.initChatbotPanel({
        demo: DEMO,
        onSaved: (t) => { tenant = t || tenant; applyTenantToUI(); },
      });
    }
    if (DEMO) {
      loadDemoData();
      if (DASH_PAGE === 'chatbot') populateChatbotForm(tenant);
      initPageHandlers();
      if (DASH_PAGE === 'publier') initInstallWizard();
      return;
    }
    const session = await NoviaApp.requireAuth('/login.html');
    if (!session) return;
    await loadTenant();
    handleBillingReturn();
    const params = new URLSearchParams(location.search);
    if (DASH_PAGE === 'home' && params.get('checkout') === '1') {
      history.replaceState({}, '', location.pathname);
      if (tenant && !tenant.stripe_subscription_id) {
        try { await startCheckout(); } catch (e) { console.warn('checkout', e); }
      }
    }
    if (DASH_PAGE === 'home' || DASH_PAGE === 'conversations') await loadStats();
    if (DASH_PAGE === 'home') {
      if (params.get('activating') === '1' || sessionStorage.getItem('novia_provisioning')) {
        if (tenant && tenant.stripe_subscription_id) startProvisioningPoll();
        else if (tenant && tenant.onboarding_done && !tenant.stripe_subscription_id) {
          showFlashBanner('checkoutNeededBanner', '<strong>Presque fini!</strong><p class="muted" style="margin:8px 0 0;font-size:.92rem">Ajoutez votre carte pour activer votre ligne NoviaAI (essai 14 jours).</p>');
        }
      } else if (sessionStorage.getItem('novia_provisioning') && tenant?.stripe_subscription_id) {
        startProvisioningPoll();
      }
    }
    if (DASH_PAGE === 'publier') initInstallWizard();
    if (DASH_PAGE === 'chatbot' && tenant) populateChatbotForm(tenant);
    if (DASH_PAGE === 'parametres' && tenant) populateSettingsForm(tenant);
    initPageHandlers();
  } catch (ex) {
    console.error(ex);
    if (!DEMO) {
      showOfflineBanner();
      const biz = $('bizName');
      if (biz) biz.textContent = 'Connexion impossible';
    }
  }
})();

function markCheck(id, done) {
  const el = $(id);
  if (!el) return;
  if (done) { el.classList.add('done'); el.querySelector('.check').textContent = '✓'; }
}

let provRetrySent = false;

async function tickProvisioning() {
  await loadTenant();
  if (tenant && tenant.provisioning_status === 'active' && tenant.twilio_number) {
    updateProvBox();
    updateChecklist();
    if (sessionStorage.getItem('novia_provisioning') && DASH_PAGE !== 'publier') {
      dashGo('publier');
      return;
    }
    return;
  }
  if (tenant && tenant.provisioning_status === 'failed') {
    updateProvBox();
    return;
  }
  if (tenant && ['pending', 'provisioning'].includes(tenant.provisioning_status) && !provRetrySent) {
    provRetrySent = true;
    try {
      await NoviaApp.api('api-provision', { method: 'POST', body: '{}' });
      await loadTenant();
    } catch (e) {
      console.warn('provision retry', e);
    }
  }
  updateProvBox();
}

function startProvisioningPoll() {
  const box = $('provBox');
  if (box) box.hidden = false;
  tickProvisioning();
  pollTimer = setInterval(tickProvisioning, 5000);
}

async function loadTenant() {
  const data = await NoviaApp.api('api-tenant');
  if (!data.tenant) return;
  tenant = data.tenant;
  if (!tenant.onboarding_done) { location.href = '/onboarding.html'; return; }

  applyTenantToUI();

  if (['pending', 'provisioning'].includes(tenant.provisioning_status) && !pollTimer) {
    startProvisioningPoll();
  }
}

async function loadStats() {
  const s = await NoviaApp.api('api-stats');
  if (s.error) return;
  const statMsgs = $('statMsgs');
  if (statMsgs) statMsgs.textContent = s.messages_30d || 0;
  const missedEl = $('missedCount');
  if (missedEl) missedEl.textContent = s.missed_calls_30d || 0;
  const leadEl = $('leadCount');
  if (leadEl) leadEl.textContent = s.leads_total || 0;
  if (s.roi_estimated) {
    const roiBox = $('roiBox');
    if (roiBox) roiBox.style.display = 'block';
    const roiVal = $('roiVal');
    if (roiVal) roiVal.textContent = s.roi_estimated.low + ' $ – ' + s.roi_estimated.high + ' $';
  }
  if ($('inboxList')) {
    const msgs = await NoviaApp.api('api-messages');
    renderMsgs(msgs.messages || []);
    await loadInbox();
  }
}

let inboxData = [];
let selectedPhone = null;

async function loadInbox() {
  const data = await NoviaApp.api('api-conversations');
  inboxData = data.conversations || [];
  renderInboxList();
}

function renderInboxList() {
  const list = $('inboxList');
  if (!list) return;
  if (!inboxData.length) {
    list.innerHTML = '<div class="inbox-empty">Aucune conversation.<br>Partagez votre numéro NoviaAI.</div>';
    return;
  }
  list.innerHTML = inboxData.map(c => {
    const active = selectedPhone === c.caller_phone ? ' active' : '';
    const badge = c.has_lead ? '<span class="inbox-badge lead">Lead</span>' : '';
    const missed = c.missed_calls ? `<span class="inbox-badge">${c.missed_calls} appel(s)</span>` : '';
    const when = c.last_at ? new Date(c.last_at).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' }) : '';
    return `<div class="inbox-item${active}" data-phone="${c.caller_phone.replace(/"/g,'')}">
      <div class="phone">${c.caller_phone}</div>
      <div class="preview">${(c.last_preview || c.lead_summary || '…').replace(/</g,'&lt;')}</div>
      <div class="meta">${badge}${missed}<span>${when}</span></div>
    </div>`;
  }).join('');
  list.querySelectorAll('.inbox-item').forEach(el => {
    el.onclick = () => openThread(el.dataset.phone);
  });
}

async function openThread(phone) {
  if (DEMO) { openThreadDemo(phone); return; }
  selectedPhone = phone;
  renderInboxList();
  const thread = document.getElementById('inboxThread');
  thread.innerHTML = '<div class="inbox-empty">Chargement…</div>';
  const data = await NoviaApp.api('api-conversations?phone=' + encodeURIComponent(phone));
  const msgs = (data.conversation && data.conversation.messages) || [];
  renderThread(phone, msgs);
}

function renderThread(phone, msgs) {
  const thread = document.getElementById('inboxThread');
  const isWeb = String(phone).startsWith('web:');
  const canReview = !isWeb && tenant && tenant.google_review_url;
  const bubbles = msgs.length
    ? msgs.map(m => {
        const cls = m.direction === 'inbound' ? 'in' : 'out';
        const label = m.direction === 'inbound' ? 'Client' : 'NoviaAI';
        return `<div class="inbox-bubble ${cls}"><small class="muted">${label} · ${new Date(m.created_at).toLocaleString('fr-CA')}</small><br>${m.body.replace(/</g,'&lt;')}</div>`;
      }).join('')
    : '<div class="inbox-empty" style="padding:24px">Aucun message — écrivez au client ci-dessous.</div>';
  const reviewBtn = canReview
    ? `<div style="padding:8px 12px;border-top:1px solid var(--line)"><button type="button" class="btn btn-ghost btn-sm" id="btnSendReview">Demander un avis Google</button></div>`
    : '';
  const replyForm = isWeb
    ? '<p class="muted" style="padding:12px;font-size:.85rem">Conversation web — le client peut aussi vous texter sur votre ligne NoviaAI.</p>'
    : `<form class="inbox-reply" id="inboxReplyForm">
        <input type="text" id="inboxReplyInput" placeholder="Répondre par SMS…" maxlength="1600" required autocomplete="off">
        <button type="submit" class="btn btn-accent btn-sm">Envoyer</button>
      </form>`;
  thread.innerHTML = `
    <div class="inbox-thread-wrap">
      <div class="inbox-messages" id="inboxMessages">${bubbles}</div>
      ${reviewBtn}
      ${replyForm}
    </div>`;
  const box = document.getElementById('inboxMessages');
  if (box) box.scrollTop = box.scrollHeight;
  const reviewEl = document.getElementById('btnSendReview');
  if (reviewEl) {
    reviewEl.onclick = async () => {
      reviewEl.disabled = true;
      try {
        const res = await NoviaApp.api('api-review-request', {
          method: 'POST',
          body: JSON.stringify({ phone }),
        });
        if (res.error) throw new Error(res.error);
        alert('Demande d\'avis envoyée!');
        await openThread(phone);
        await loadTenant();
      } catch (ex) {
        alert(ex.message || 'Envoi impossible');
      } finally {
        reviewEl.disabled = false;
      }
    };
  }
  const replyFormEl = document.getElementById('inboxReplyForm');
  if (replyFormEl) replyFormEl.onsubmit = async (e) => {
    e.preventDefault();
    const input = document.getElementById('inboxReplyInput');
    const text = input.value.trim();
    if (!text || !phone) return;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const res = await NoviaApp.api('api-sms-reply', {
        method: 'POST',
        body: JSON.stringify({ phone, body: text }),
      });
      if (res.error) throw new Error(res.error);
      input.value = '';
      await openThread(phone);
      await loadInbox();
    } catch (ex) {
      alert(ex.message || 'Envoi échoué');
    } finally {
      btn.disabled = false;
    }
  };
}

function renderMsgs(msgs) {
  /* legacy flat list â€” inbox preferred */
}

function initClientSim() {
  const card = $('clientSimCard');
  // Simulation réservée au mode démo — comptes réels utilisent Conversations / Chatbot
  if (!DEMO) {
    if (card) card.hidden = true;
    return;
  }
  if (card) card.hidden = false;

  const form = $('simForm');
  const msgsEl = $('simMsgs');
  const input = $('simInput');
  const chips = $('simChips');
  const resetBtn = $('btnSimReset');
  if (!form || !msgsEl || !input) return;

  const SUGGESTIONS = [
    'C\'est combien?',
    'Vous êtes ouverts demain?',
    'Je veux un rendez-vous',
    'Où êtes-vous situés?',
  ];

  let history = [];
  let sending = false;

  function agentName() {
    return (tenant && tenant.agent_name) || 'Léa';
  }

  function businessName() {
    return (tenant && tenant.business_name) || 'votre commerce';
  }

  function welcomeText() {
    if (tenant && tenant.missed_call_sms) return tenant.missed_call_sms;
    return `Bonjour! On a manqué votre appel chez ${businessName()}. Ici ${agentName()} — comment puis-je vous aider?`;
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function appendBubble(role, text, extraClass) {
    const div = document.createElement('div');
    div.className = 'client-sim-bubble ' + (role === 'user' ? 'client' : 'agent') + (extraClass ? ' ' + extraClass : '');
    div.innerHTML = escHtml(text);
    msgsEl.appendChild(div);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return div;
  }

  function renderChips() {
    if (!chips) return;
    chips.innerHTML = '';
    SUGGESTIONS.forEach((label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.onclick = () => sendMessage(label);
      chips.appendChild(b);
    });
  }

  function resetSim() {
    history = [];
    msgsEl.innerHTML = '';
    const welcome = welcomeText();
    appendBubble('assistant', welcome);
    history.push({ role: 'assistant', content: welcome });
    renderChips();
    input.value = '';
    input.focus();
  }

  function demoReply(message) {
    const t = String(message || '').toLowerCase();
    if (/prix|combien|co[uû]t|\$/.test(t)) {
      return 'Coupe femme à partir de 45 $, coupe homme à partir de 30 $, balayage à partir de 120 $. Voulez-vous réserver? https://exemple-saloneclat.ca/reservation';
    }
    if (/ouvert|horaire|demain|samedi/.test(t)) {
      return 'Oui! Demain on est ouverts 9 h – 18 h. Réservez ici : https://exemple-saloneclat.ca/reservation';
    }
    if (/rendez|rdv|r[eé]serv/.test(t)) {
      return 'Parfait! Réservez en ligne : https://exemple-saloneclat.ca/reservation — l\'équipe confirmera ensuite.';
    }
    if (/o[uù]|adress|situ/.test(t)) {
      return 'On est au 245, rue Principale à Lévis. Stationnement gratuit derrière le salon.';
    }
    return 'Avec plaisir! Prix, horaires ou rendez-vous — je peux vous aider. Que cherchez-vous?';
  }

  async function sendMessage(text) {
    const message = (text || input.value || '').trim();
    if (!message || sending) return;
    sending = true;
    input.value = '';
    const sendBtn = $('simSend');
    if (sendBtn) sendBtn.disabled = true;

    appendBubble('user', message);
    history.push({ role: 'user', content: message });

    const typing = appendBubble('assistant', '…', 'typing');

    try {
      let reply;
      if (DEMO) {
        const histForApi = history.slice(0, -1).map((m) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
        }));
        try {
          const res = await fetch('/.netlify/functions/api-demo-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, history: histForApi }),
          });
          const data = await res.json();
          reply = data.reply || demoReply(message);
        } catch {
          reply = demoReply(message);
        }
      } else {
        const histForApi = history.slice(0, -1).map((m) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
        }));
        const res = await NoviaApp.api('api-knowledge', {
          method: 'POST',
          body: JSON.stringify({ action: 'test', question: message, history: histForApi }),
        });
        if (res.error) throw new Error(res.error);
        reply = res.reply || 'Désolée, je n\'ai pas pu répondre. Réessayez ou configurez le chatbot.';
      }
      typing.remove();
      appendBubble('assistant', reply);
      history.push({ role: 'assistant', content: reply });
    } catch (ex) {
      typing.remove();
      appendBubble('assistant', ex.message || 'Erreur — réessayez dans un instant.');
    } finally {
      sending = false;
      if (sendBtn) sendBtn.disabled = false;
      input.focus();
    }
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    sendMessage();
  };
  if (resetBtn) resetBtn.onclick = () => resetSim();

  // Liens démo dans le menu
  const linkChatbot = document.querySelector('a[href="/chatbot.html"]');
  if (DEMO && linkChatbot) linkChatbot.href = dashHref('/chatbot.html');

  resetSim();
}

function initPageHandlers() {
  const logout = $('logout');
  if (logout) {
    logout.onclick = (e) => {
      e.preventDefault();
      if (DEMO) {
        sessionStorage.removeItem('novia_demo');
        location.href = '/portail.html';
      } else NoviaApp.signOut();
    };
  }
  const btnOpenSettings = $('btnOpenSettings');
  if (btnOpenSettings) btnOpenSettings.onclick = (e) => { e.preventDefault(); dashGo('parametres'); };
  const btnOpenChatbot = $('btnOpenChatbot');
  if (btnOpenChatbot) btnOpenChatbot.onclick = (e) => { e.preventDefault(); dashGo('chatbot'); };
  const btnOpenInstall = $('btnOpenInstall');
  if (btnOpenInstall) btnOpenInstall.addEventListener('click', (e) => { e.preventDefault(); dashGo('publier'); });

  async function copyWidgetCode(btn) {
    const code = ($('widgetEmbedCode') || $('widgetEmbedCodeInstall') || {}).textContent || '';
    if (!code || code === '—' || code === 'Chargement…') return alert('Code widget non disponible — enregistrez vos paramètres.');
    try {
      await navigator.clipboard.writeText(code);
      if (btn) { btn.textContent = 'Copié!'; setTimeout(() => { btn.textContent = 'Copier'; }, 2000); }
    } catch { alert(code); }
  }
  const btnW = $('btnCopyWidget');
  if (btnW) btnW.onclick = () => copyWidgetCode(btnW);

  if (DASH_PAGE === 'home') initClientSim(); // no-op si compte réel (!DEMO)

  if (DEMO) {
    const settingsForm = $('settingsForm');
    if (settingsForm) {
      settingsForm.onsubmit = (e) => {
        e.preventDefault();
        const ok = $('settingsOk');
        if (ok) ok.hidden = false;
      };
    }
    return;
  }

  const btnSub = $('btnSubscribe');
  if (btnSub) {
    btnSub.onclick = async () => {
      btnSub.disabled = true;
      try {
        if (tenant && hasBillingSetup(tenant) && !['canceled', 'inactive', 'past_due'].includes(tenant.subscription_status)) {
          await openBillingPortal();
          return;
        }
        await startCheckout();
      } catch (ex) {
        alert(ex.message || 'Erreur Stripe');
      } finally {
        btnSub.disabled = false;
      }
    };
  }
  const btnPortal = $('btnManageBilling');
  if (btnPortal) btnPortal.onclick = async () => {
    try { await openBillingPortal(); } catch (ex) { alert(ex.message || 'Erreur portail'); }
  };
  const btnRetry = $('btnRetryProv');
  if (btnRetry) {
    btnRetry.onclick = async () => {
      provRetrySent = false;
      const t = $('provTitle');
      const m = $('provMsg');
      if (t) t.textContent = '⏳ Activation en cours…';
      if (m) m.textContent = 'Nouvelle tentative…';
      await NoviaApp.api('api-provision', { method: 'POST', body: '{}' });
      if (!pollTimer) startProvisioningPoll();
      else await tickProvisioning();
    };
  }
  const settingsForm = $('settingsForm');
  if (settingsForm) {
    settingsForm.onsubmit = async (e) => {
      e.preventDefault();
      const ok = $('settingsOk');
      const err = $('settingsErr');
      if (ok) ok.hidden = true;
      if (err) err.hidden = true;
      if (!$('setBusinessName').value.trim() || !$('setBusinessPhone').value.trim()) {
        if (err) { err.textContent = 'Nom du commerce et numéro de téléphone sont requis.'; err.hidden = false; }
        return;
      }
      try {
        const payload = {
          settings: true,
          business_name: $('setBusinessName').value.trim(),
          phone_forward: $('setBusinessPhone').value.trim(),
          contact_email: $('setContactEmail').value.trim(),
          missed_call_sms: $('setMissedSms').value.trim(),
          google_review_url: $('setGoogleReviewUrl').value.trim(),
          review_request_sms: $('setReviewRequestSms').value.trim(),
          auto_review_request: $('setAutoReviewRequest').checked,
          review_request_delay_minutes: parseInt($('setReviewDelayMinutes').value, 10) || 5,
          widget_enabled: $('setWidgetEnabled').checked,
        };
        const res = await NoviaApp.api('api-tenant', { method: 'PATCH', body: JSON.stringify(payload) });
        if (res.error) throw new Error(res.error);
        tenant = res.tenant || tenant;
        applyTenantToUI();
        if (ok) ok.hidden = false;
        if (DASH_PAGE === 'home' || DASH_PAGE === 'conversations') loadStats();
      } catch (ex) {
        if (err) { err.textContent = ex.message || 'Erreur enregistrement'; err.hidden = false; }
      }
    };
  }
  const btnDelete = $('btnDeleteAccount');
  if (btnDelete) {
    btnDelete.onclick = async () => {
      if (!confirm('Supprimer définitivement votre compte NoviaAI? Cette action est irréversible.')) return;
      const typed = prompt('Tapez SUPPRIMER pour confirmer');
      if (typed !== 'SUPPRIMER') return;
      try {
        await NoviaApp.api('api-delete-account', { method: 'DELETE' });
        await NoviaApp.signOut();
      } catch (ex) {
        alert(ex.message || 'Suppression impossible');
      }
    };
  }
}
