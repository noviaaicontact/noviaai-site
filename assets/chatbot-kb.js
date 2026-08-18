// Panneau Chatbot — services, FAQ, horaires, import URL, testeur.
// v3 — fix boutons ajouter service/FAQ

const HOUR_DAYS = [
  { key: 'lundi', label: 'Lundi' },
  { key: 'mardi', label: 'Mardi' },
  { key: 'mercredi', label: 'Mercredi' },
  { key: 'jeudi', label: 'Jeudi' },
  { key: 'vendredi', label: 'Vendredi' },
  { key: 'samedi', label: 'Samedi' },
  { key: 'dimanche', label: 'Dimanche' },
];

const QUALIFICATION_BY_WORKFLOW = {
  appointment: [
    { key: 'nom', label: 'Nom du client', enabled: true, required: true },
    { key: 'telephone', label: 'Téléphone', enabled: true, required: false },
    { key: 'service_souhaite', label: 'Service désiré', enabled: true, required: true },
    { key: 'preferences', label: 'Préférences du client', enabled: false, required: false },
    { key: 'disponibilites', label: 'Disponibilités', enabled: true, required: true },
    { key: 'creneau_confirme', label: 'Créneau souhaité', enabled: false, required: false },
  ],
  field_service: [
    { key: 'nom', label: 'Nom du client', enabled: true, required: true },
    { key: 'telephone', label: 'Téléphone', enabled: true, required: false },
    { key: 'probleme', label: 'Type de problème', enabled: true, required: true },
    { key: 'urgence', label: 'Urgence', enabled: false, required: false },
    { key: 'depuis_quand', label: 'Depuis quand', enabled: false, required: false },
    { key: 'adresse', label: 'Adresse', enabled: true, required: false },
    { key: 'disponibilite_rappel', label: 'Meilleur moment pour rappeler', enabled: true, required: true },
  ],
};

/** Champs montrés en vue simple (le reste reste dans « Ajuster »). */
const QUAL_SIMPLE_KEYS = {
  appointment: ['nom', 'telephone', 'service_souhaite', 'disponibilites'],
  field_service: ['nom', 'telephone', 'probleme', 'adresse', 'disponibilite_rappel'],
};

const TONE_PRESETS = {
  chaleureux: 'Français québécois, chaleureux, amical et professionnel',
  professionnel: 'Français québécois, professionnel, clair et courtois',
  direct: 'Français québécois, direct, simple et efficace',
};

const APPOINTMENT_KEYWORDS = [
  'salon', 'coiffure', 'coiffeur', 'esthétique', 'esthetique', 'beauté', 'beaute',
  'spa', 'clinique', 'dentiste', 'physio', 'massoth', 'vétérinaire', 'veterinaire',
  'avocat', 'comptable', 'notaire', 'barbier', 'onglerie', 'cabinet',
];
const FIELD_SERVICE_KEYWORDS = [
  'plombier', 'plomberie', 'électricien', 'electricien', 'garage', 'mécanique',
  'mecanique', 'toiture', 'couvreur', 'chauffage', 'hvac', 'déneigement', 'deneigement',
  'serrurier', 'paysag', 'dépannage', 'depannage',
];

function detectWorkflowClient(businessType, businessName) {
  const blob = `${businessType || ''} ${businessName || ''}`.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (APPOINTMENT_KEYWORDS.some((kw) => blob.includes(kw.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))) {
    return 'appointment';
  }
  if (FIELD_SERVICE_KEYWORDS.some((kw) => blob.includes(kw.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))) {
    return 'field_service';
  }
  return 'field_service';
}

function selectedWorkflow() {
  const checked = document.querySelector('input[name="qualWorkflow"]:checked');
  if (checked && (checked.value === 'appointment' || checked.value === 'field_service')) {
    return checked.value;
  }
  const type = document.getElementById('setBusinessType')?.value || '';
  return detectWorkflowClient(type, '');
}

function setSelectedWorkflow(wf) {
  const value = wf === 'appointment' ? 'appointment' : 'field_service';
  document.querySelectorAll('input[name="qualWorkflow"]').forEach((radio) => {
    radio.checked = radio.value === value;
    radio.closest('.workflow-card')?.classList.toggle('is-selected', radio.checked);
  });
}

function defaultQualificationFieldsForContext() {
  const wf = selectedWorkflow();
  return (QUALIFICATION_BY_WORKFLOW[wf] || QUALIFICATION_BY_WORKFLOW.field_service)
    .map((f) => ({ ...f }));
}

function tonePresetFromValue(tone) {
  const t = String(tone || '').trim();
  if (!t) return 'chaleureux';
  const hit = Object.keys(TONE_PRESETS).find((k) => TONE_PRESETS[k] === t);
  return hit || 'custom';
}

function applyTonePreset(preset) {
  const custom = document.getElementById('setAgentTone');
  const isCustom = preset === 'custom';
  document.querySelectorAll('input[name="agentTonePreset"]').forEach((radio) => {
    radio.checked = radio.value === preset;
    radio.closest('.tone-preset')?.classList.toggle('is-selected', radio.checked);
  });
  if (custom) {
    custom.hidden = !isCustom;
    if (!isCustom) custom.value = TONE_PRESETS[preset] || TONE_PRESETS.chaleureux;
  }
}

function collectAgentTone() {
  const preset = document.querySelector('input[name="agentTonePreset"]:checked')?.value || 'chaleureux';
  if (preset === 'custom') {
    return (document.getElementById('setAgentTone')?.value || '').trim() || TONE_PRESETS.chaleureux;
  }
  return TONE_PRESETS[preset] || TONE_PRESETS.chaleureux;
}

/** @deprecated — utiliser defaultQualificationFieldsForContext */
const DEFAULT_QUALIFICATION_FIELDS = QUALIFICATION_BY_WORKFLOW.field_service;

const DEFAULT_HOURS = {
  lundi: { ouvert: true, debut: '9h', fin: '17h' },
  mardi: { ouvert: true, debut: '9h', fin: '17h' },
  mercredi: { ouvert: true, debut: '9h', fin: '17h' },
  jeudi: { ouvert: true, debut: '9h', fin: '17h' },
  vendredi: { ouvert: true, debut: '9h', fin: '17h' },
  samedi: { ouvert: false, debut: '9h', fin: '16h' },
  dimanche: { ouvert: false, debut: '9h', fin: '17h' },
};

let _demo = false;
let _chatbotBound = false;
let _refreshTestWelcome = null;
let _tenant = null;

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function linkify(text) {
  const escapedParts = String(text || '').split(/(https?:\/\/[^\s]+)/gi).map((part) => {
    if (/^https?:\/\//i.test(part)) {
      const url = part.replace(/[.,);:!?]+$/g, '');
      const trailing = part.slice(url.length);
      return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>${esc(trailing)}`;
    }
    return esc(part).replace(/\n/g, '<br>');
  });
  return escapedParts.join('');
}

function renderHours(hours) {
  const h = hours || DEFAULT_HOURS;
  const el = document.getElementById('hoursGrid');
  if (!el) return;
  el.innerHTML = HOUR_DAYS.map(({ key, label }) => {
    const row = h[key] || { ouvert: false, debut: '9h', fin: '17h' };
    const open = row.ouvert !== false;
    return `<div class="hours-row" data-day="${key}">
      <label class="hours-check"><input type="checkbox" class="hours-open" ${open ? 'checked' : ''}> ${label}</label>
      <input type="text" class="hours-debut" value="${esc(row.debut || '9h')}" placeholder="9h" ${open ? '' : 'disabled'}>
      <span class="hours-sep">–</span>
      <input type="text" class="hours-fin" value="${esc(row.fin || '17h')}" placeholder="17h" ${open ? '' : 'disabled'}>
    </div>`;
  }).join('');
  el.querySelectorAll('.hours-open').forEach((cb) => {
    cb.onchange = () => {
      const row = cb.closest('.hours-row');
      const on = cb.checked;
      row.querySelector('.hours-debut').disabled = !on;
      row.querySelector('.hours-fin').disabled = !on;
    };
  });
}

function collectHours() {
  const out = {};
  document.querySelectorAll('#hoursGrid .hours-row').forEach((row) => {
    const key = row.dataset.day;
    out[key] = {
      ouvert: row.querySelector('.hours-open').checked,
      debut: row.querySelector('.hours-debut').value.trim() || '9h',
      fin: row.querySelector('.hours-fin').value.trim() || '17h',
    };
  });
  return out;
}

function serviceRowHtml(s, idx) {
  const mode = s.booking_mode || '';
  const duration = Number(s.duration_minutes) || 30;
  const durations = [15, 30, 45, 60, 90, 120, 180, 240];
  if (!durations.includes(duration)) durations.push(duration);
  durations.sort((a, b) => a - b);
  const durationOpts = durations.map((m) =>
    `<option value="${m}" ${Number(duration) === m ? 'selected' : ''}>${m} min</option>`).join('');
  return `<div class="kb-row kb-row-service" data-idx="${idx}">
    <input type="text" class="svc-name" placeholder="Nom du service" value="${esc(s.nom || s.description_courte || '')}">
    <input type="text" class="svc-price" placeholder="Prix" value="${esc(s.prix || '')}">
    <select class="svc-mode" aria-label="Action du service">
      <option value="" ${!mode ? 'selected' : ''}>Automatique</option>
      <option value="calendar" ${mode === 'calendar' ? 'selected' : ''}>Agenda Google</option>
      <option value="estimate" ${mode === 'estimate' ? 'selected' : ''}>Estimation (agenda)</option>
      <option value="external_link" ${mode === 'external_link' ? 'selected' : ''}>Lien externe</option>
      <option value="human" ${mode === 'human' ? 'selected' : ''}>Rappel humain</option>
    </select>
    <select class="svc-duration" aria-label="Durée">${durationOpts}</select>
    <input type="url" class="svc-url" placeholder="https://fresha.com/… ou Calendly / Jobber" value="${esc(s.booking_url || '')}">
    <input type="hidden" class="svc-notify-owner" value="${s.notify_owner === false ? '0' : '1'}">
    <button type="button" class="btn btn-ghost btn-sm kb-remove" title="Supprimer">&times;</button>
  </div>`;
}

function syncServiceRowFields(row) {
  if (!row) return;
  const mode = (row.querySelector('.svc-mode') || {}).value || '';
  const dur = row.querySelector('.svc-duration');
  const url = row.querySelector('.svc-url');
  if (dur) dur.hidden = !(mode === 'calendar' || mode === 'estimate');
  if (url) url.hidden = mode !== 'external_link';
}

function bindServiceModeToggles(container) {
  if (!container) return;
  container.querySelectorAll('.kb-row-service').forEach((row) => {
    syncServiceRowFields(row);
    const sel = row.querySelector('.svc-mode');
    if (sel && !sel.dataset.bound) {
      sel.dataset.bound = '1';
      sel.onchange = () => syncServiceRowFields(row);
    }
  });
}

function renderServices(services) {
  const el = document.getElementById('servicesList');
  if (!el) return;
  const list = Array.isArray(services) && services.length ? services : [{ nom: '', prix: '' }];
  el.innerHTML = list.map((s, i) => serviceRowHtml(s, i)).join('');
  bindRemoveButtons(el);
  bindServiceModeToggles(el);
}

function collectServices() {
  return Array.from(document.querySelectorAll('#servicesList .kb-row-service')).map((row) => {
    const mode = (row.querySelector('.svc-mode') && row.querySelector('.svc-mode').value) || '';
    const duration = parseInt(row.querySelector('.svc-duration') && row.querySelector('.svc-duration').value, 10) || 30;
    const url = (row.querySelector('.svc-url') && row.querySelector('.svc-url').value.trim()) || '';
    const nom = row.querySelector('.svc-name').value.trim();
    const out = {
      nom,
      prix: row.querySelector('.svc-price').value.trim(),
      description_courte: nom,
    };
    if (mode) out.booking_mode = mode;
    if (mode === 'calendar' || mode === 'estimate') out.duration_minutes = duration;
    if (mode === 'external_link' && url) out.booking_url = url;
    if ((row.querySelector('.svc-notify-owner') || {}).value === '0') out.notify_owner = false;
    return out;
  }).filter((s) => s.nom);
}

function faqRowHtml(f, idx) {
  return `<div class="kb-row kb-row-faq" data-idx="${idx}">
    <input type="text" class="faq-q" placeholder="Question" value="${esc(f.question || '')}">
    <textarea class="faq-a" rows="2" placeholder="Réponse">${esc(f.reponse || '')}</textarea>
    <button type="button" class="btn btn-ghost btn-sm kb-remove" title="Supprimer">&times;</button>
  </div>`;
}

function renderFaq(faq) {
  const el = document.getElementById('faqList');
  if (!el) return;
  const list = Array.isArray(faq) && faq.length ? faq : [{ question: '', reponse: '' }];
  el.innerHTML = list.map((f, i) => faqRowHtml(f, i)).join('');
  bindRemoveButtons(el);
}

function collectFaq() {
  return Array.from(document.querySelectorAll('#faqList .kb-row')).map((row) => ({
    question: row.querySelector('.faq-q').value.trim(),
    reponse: row.querySelector('.faq-a').value.trim(),
  })).filter((f) => f.question && f.reponse);
}

function favoriteRowHtml(f, idx) {
  const favId = f.id || '';
  return `<div class="kb-row kb-row-fav" data-idx="${idx}" data-fav-id="${esc(favId)}">
    <input type="text" class="fav-label" placeholder="Libellé (ex. Promo mars)" value="${esc(f.label || '')}">
    <textarea class="fav-content" rows="2" placeholder="Ce que l'agent doit retenir et utiliser">${esc(f.content || '')}</textarea>
    <button type="button" class="btn btn-ghost btn-sm kb-remove" title="Supprimer">&times;</button>
  </div>`;
}

function renderFavorites(favorites) {
  const el = document.getElementById('favoritesList');
  if (!el) return;
  const list = Array.isArray(favorites) && favorites.length ? favorites : [{ label: '', content: '' }];
  el.innerHTML = list.map((f, i) => favoriteRowHtml(f, i)).join('');
  bindRemoveButtons(el);
}

function collectFavorites() {
  return Array.from(document.querySelectorAll('#favoritesList .kb-row')).map((row, i) => ({
    id: row.dataset.favId || `fav-${i}-${Date.now()}`,
    label: row.querySelector('.fav-label').value.trim(),
    content: row.querySelector('.fav-content').value.trim(),
  })).filter((f) => f.content);
}

function addFavoriteRow() {
  const el = document.getElementById('favoritesList');
  if (!el) return false;
  el.insertAdjacentHTML('beforeend', favoriteRowHtml({ label: '', content: '' }, el.children.length));
  bindRemoveButtons(el);
  const inputs = el.querySelectorAll('.fav-content');
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
  return true;
}

function normalizeQualificationFieldsClient(raw) {
  const defaults = defaultQualificationFieldsForContext();
  const byKey = new Map(defaults.map((f) => [f.key, { ...f }]));
  if (Array.isArray(raw)) {
    raw.forEach((item) => {
      if (!item || !byKey.has(item.key)) return;
      const base = byKey.get(item.key);
      byKey.set(item.key, {
        ...base,
        label: String(item.label || base.label).trim() || base.label,
        enabled: item.enabled !== false,
        required: item.required != null ? !!item.required : base.required,
      });
    });
  }
  return defaults.map((f) => byKey.get(f.key));
}

function qualificationFieldRowHtml(f) {
  return `<div class="qual-field-row" data-key="${esc(f.key)}">
    <label class="qual-field-check"><input type="checkbox" class="qual-enabled" ${f.enabled !== false ? 'checked' : ''}> Collecter</label>
    <input type="text" class="qual-label" value="${esc(f.label)}" placeholder="Libellé affiché">
    <label class="qual-field-req"><input type="checkbox" class="qual-required" ${f.required ? 'checked' : ''}> Requis</label>
  </div>`;
}

function renderQualificationSimple(fields) {
  const el = document.getElementById('qualificationSimple');
  if (!el) return;
  const list = normalizeQualificationFieldsClient(fields);
  const wf = selectedWorkflow();
  const keys = QUAL_SIMPLE_KEYS[wf] || QUAL_SIMPLE_KEYS.field_service;
  const byKey = new Map(list.map((f) => [f.key, f]));
  el.innerHTML = keys.map((key) => {
    const f = byKey.get(key);
    if (!f) return '';
    return `<label class="qual-simple-chip">
      <input type="checkbox" class="qual-simple-enabled" data-key="${esc(f.key)}" ${f.enabled !== false ? 'checked' : ''}>
      <span>${esc(f.label)}</span>
    </label>`;
  }).join('');

  el.querySelectorAll('.qual-simple-enabled').forEach((input) => {
    input.onchange = () => {
      const row = document.querySelector(`#qualificationFieldsList .qual-field-row[data-key="${input.dataset.key}"]`);
      const adv = row?.querySelector('.qual-enabled');
      if (adv) adv.checked = input.checked;
    };
  });
}

function renderQualificationFields(fields) {
  const el = document.getElementById('qualificationFieldsList');
  if (!el) return;
  const list = normalizeQualificationFieldsClient(fields);
  el.innerHTML = list.map((f) => qualificationFieldRowHtml(f)).join('');
  el.querySelectorAll('.qual-enabled').forEach((input) => {
    input.onchange = () => {
      const key = input.closest('.qual-field-row')?.dataset.key;
      const simple = document.querySelector(`.qual-simple-enabled[data-key="${key}"]`);
      if (simple) simple.checked = input.checked;
    };
  });
  renderQualificationSimple(list);
}

function collectQualificationFields() {
  return Array.from(document.querySelectorAll('#qualificationFieldsList .qual-field-row')).map((row) => ({
    key: row.dataset.key,
    label: row.querySelector('.qual-label').value.trim(),
    enabled: row.querySelector('.qual-enabled').checked,
    required: row.querySelector('.qual-required').checked,
  }));
}

function applyWorkflowChange(wf, { resetFields = true } = {}) {
  setSelectedWorkflow(wf);
  if (resetFields) {
    renderQualificationFields(QUALIFICATION_BY_WORKFLOW[wf] || QUALIFICATION_BY_WORKFLOW.field_service);
  } else {
    renderQualificationFields(collectQualificationFields());
  }
}

function bindRemoveButtons(container) {
  if (!container) return;
  container.querySelectorAll('.kb-remove').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const row = btn.closest('.kb-row');
      if (!row) return;
      const parent = row.parentElement;
      if (parent && parent.querySelectorAll('.kb-row').length > 1) row.remove();
    };
  });
}

function addServiceRow() {
  const el = document.getElementById('servicesList');
  if (!el) return false;
  el.insertAdjacentHTML('beforeend', serviceRowHtml({ nom: '', prix: '', booking_mode: 'calendar', duration_minutes: 30 }, el.children.length));
  bindRemoveButtons(el);
  bindServiceModeToggles(el);
  const inputs = el.querySelectorAll('.svc-name');
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
  return true;
}

function addFaqRow() {
  const el = document.getElementById('faqList');
  if (!el) return false;
  el.insertAdjacentHTML('beforeend', faqRowHtml({ question: '', reponse: '' }, el.children.length));
  bindRemoveButtons(el);
  const inputs = el.querySelectorAll('.faq-q');
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
  return true;
}

function reservationLinkRowHtml(link, idx) {
  return `<div class="kb-row kb-row-link" data-idx="${idx}">
    <input type="text" class="link-label" placeholder="Libellé (ex. Coupe)" value="${esc(link.label || '')}">
    <input type="url" class="link-url" placeholder="https://…/soumission" value="${esc(link.url || '')}">
    <button type="button" class="btn btn-ghost btn-sm kb-remove" title="Supprimer">&times;</button>
  </div>`;
}

function normalizeLinksFromTenant(t) {
  if (!t) return [{ label: '', url: '' }];
  if (Array.isArray(t.reservation_links) && t.reservation_links.length) {
    return t.reservation_links.map((l) => ({
      label: (l && (l.label || l.nom)) || '',
      url: (l && l.url) || '',
    })).filter((l) => l.url || l.label);
  }
  if (t.reservation_url) return [{ label: '', url: t.reservation_url }];
  return [{ label: '', url: '' }];
}

function renderReservationLinks(links) {
  const el = document.getElementById('reservationLinksList');
  if (!el) return;
  const list = Array.isArray(links) && links.length ? links : [{ label: '', url: '' }];
  el.innerHTML = list.map((l, i) => reservationLinkRowHtml(l, i)).join('');
  bindRemoveButtons(el);
}

function collectReservationLinks() {
  return Array.from(document.querySelectorAll('#reservationLinksList .kb-row')).map((row) => ({
    label: row.querySelector('.link-label').value.trim(),
    url: row.querySelector('.link-url').value.trim(),
  })).filter((l) => l.url);
}

function addReservationLinkRow() {
  const el = document.getElementById('reservationLinksList');
  if (!el) return false;
  el.insertAdjacentHTML('beforeend', reservationLinkRowHtml({ label: '', url: '' }, el.children.length));
  bindRemoveButtons(el);
  const inputs = el.querySelectorAll('.link-url');
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
  return true;
}

function policiesToLines(policies) {
  if (!Array.isArray(policies) || !policies.length) return '';
  return policies.join('\n');
}

function parsePoliciesLines(text) {
  return String(text || '').split('\n').map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
}

function populateChatbotForm(t) {
  if (!t) return;
  _tenant = t;
  const set = (id, val) => {
    const node = document.getElementById(id);
    if (node) node.value = val;
  };
  set('setAgentName', t.agent_name || 'Léa');
  set('setBusinessType', t.business_type || '');
  set('setAgentTone', t.agent_tone || TONE_PRESETS.chaleureux);
  set('setAgentInstructions', t.agent_instructions || '');
  set('setWelcomeSms', t.welcome_sms || '');
  set('setMissedSms', t.missed_call_sms || '');
  set('setWebsiteUrl', t.website_url || '');
  set('setPublicPhone', t.public_phone || '');
  set('setAddress', t.address_line || '');
  set('setCity', t.city || '');
  set('setPolicies', policiesToLines(t.policies));
  applyTonePreset(tonePresetFromValue(t.agent_tone || TONE_PRESETS.chaleureux));
  if (tonePresetFromValue(t.agent_tone || '') === 'custom') {
    set('setAgentTone', t.agent_tone || '');
  }
  const wf = (t.qualification_workflow === 'appointment' || t.qualification_workflow === 'field_service')
    ? t.qualification_workflow
    : detectWorkflowClient(t.business_type, t.business_name);
  setSelectedWorkflow(wf);
  renderHours(t.hours || DEFAULT_HOURS);
  renderServices(t.services);
  renderFaq(t.faq);
  renderFavorites(t.agent_favorites);
  renderQualificationFields(t.qualification_fields);
  renderReservationLinks(normalizeLinksFromTenant(t));
  const favDetails = document.getElementById('favoritesDetails');
  if (favDetails && Array.isArray(t.agent_favorites) && t.agent_favorites.some((f) => f && f.content)) {
    favDetails.open = true;
  }
  const adv = document.getElementById('agentAdvanced');
  if (adv) {
    const hasExtra = (Array.isArray(t.services) && t.services.length)
      || (Array.isArray(t.faq) && t.faq.length)
      || (Array.isArray(t.policies) && t.policies.length)
      || !!(t.address_line || t.city);
    if (hasExtra) adv.open = true;
  }
  if (!_demo) loadKnowledgeSources();
  if (typeof _refreshTestWelcome === 'function') _refreshTestWelcome();
}

async function loadKnowledgeSources() {
  const el = document.getElementById('kbSourcesList');
  const warn = document.getElementById('kbMigrationWarn');
  if (!el) return;
  el.innerHTML = '<li class="muted">Chargement…</li>';
  try {
    const data = await NoviaApp.api('api-knowledge');
    if (data.migration_required) {
      if (warn) warn.hidden = false;
      el.innerHTML = '<li class="muted">Import URL disponible après migration Supabase (schema-v6).</li>';
      return;
    }
    if (warn) warn.hidden = true;
    const sources = data.sources || [];
    if (!sources.length) {
      el.innerHTML = '<li class="muted">Aucune source — ajoutez l\'URL de votre site ci-dessus.</li>';
      return;
    }
    el.innerHTML = sources.map((s) => {
      const statusCls = s.status === 'ready' ? 'ok' : s.status === 'failed' ? 'err' : 'pending';
      const isFile = s.source_type === 'file';
      const label = isFile
        ? (s.file_name || s.title || 'Document')
        : (s.source_url || s.title || 'Source');
      const link = isFile
        ? `<span>${esc(label)}</span>`
        : `<a href="${esc(s.source_url)}" target="_blank" rel="noopener">${esc(label)}</a>`;
      const typeBadge = isFile ? '<span class="kb-type">fichier</span>' : '<span class="kb-type">web</span>';
      return `<li class="kb-source-item">
        <div>
          ${link}
          ${typeBadge}
          <span class="kb-status ${statusCls}">${s.status}</span>
          ${s.chunk_count ? `<span class="muted">${s.chunk_count} extraits</span>` : ''}
          ${s.error_message ? `<span class="err">${esc(s.error_message)}</span>` : ''}
        </div>
        <button type="button" class="btn btn-ghost btn-sm kb-del-source" data-id="${s.id}">Supprimer</button>
      </li>`;
    }).join('');
    el.querySelectorAll('.kb-del-source').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm('Supprimer cette source?')) return;
        await NoviaApp.api('api-knowledge', { method: 'DELETE', body: JSON.stringify({ source_id: btn.dataset.id }) });
        loadKnowledgeSources();
      };
    });
  } catch (ex) {
    el.innerHTML = `<li class="err">${esc(ex.message)}</li>`;
  }
}

function bindUiClicks() {
  if (_chatbotBound) return;
  _chatbotBound = true;
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#btnAddService')) {
      e.preventDefault();
      e.stopPropagation();
      addServiceRow();
      return;
    }
    if (t.closest('#btnAddFaq')) {
      e.preventDefault();
      e.stopPropagation();
      addFaqRow();
      return;
    }
    if (t.closest('#btnAddReservationLink')) {
      e.preventDefault();
      e.stopPropagation();
      addReservationLinkRow();
      return;
    }
    if (t.closest('#btnAddFavorite')) {
      e.preventDefault();
      e.stopPropagation();
      addFavoriteRow();
      const det = document.getElementById('favoritesDetails');
      if (det) det.open = true;
    }
  });

  document.querySelectorAll('input[name="qualWorkflow"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      applyWorkflowChange(radio.value, { resetFields: true });
    });
  });

  document.querySelectorAll('input[name="agentTonePreset"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      applyTonePreset(radio.value);
      if (radio.value === 'custom') {
        const custom = document.getElementById('setAgentTone');
        if (custom) {
          custom.hidden = false;
          custom.focus();
        }
      }
    });
  });

  const typeEl = document.getElementById('setBusinessType');
  if (typeEl) {
    typeEl.addEventListener('change', () => {
      // Suggestion seulement si aucun choix explicite n'a encore été forcé par l'utilisateur
      // (on détecte via data-user-picked).
      const cards = document.getElementById('workflowCards');
      if (cards?.dataset.userPicked === '1') return;
      const suggested = detectWorkflowClient(typeEl.value, '');
      applyWorkflowChange(suggested, { resetFields: true });
    });
  }
  document.getElementById('workflowCards')?.addEventListener('click', () => {
    const cards = document.getElementById('workflowCards');
    if (cards) cards.dataset.userPicked = '1';
  });
}

function initChatbotPanel(opts) {
  _demo = !!(opts && opts.demo);
  bindUiClicks();
  const form = document.getElementById('chatbotForm');
  if (!form) return;

  const btnAnalyzeSite = document.getElementById('btnAnalyzeWebsite');
  if (btnAnalyzeSite) {
    btnAnalyzeSite.onclick = async () => {
      if (_demo) { alert('Mode démo — connectez-vous pour analyser un site.'); return; }
      const url = document.getElementById('setWebsiteUrl').value.trim();
      if (!url) {
        setWebsiteAnalyzeStatus('Entrez d’abord l’URL du site web.', 'err');
        return;
      }
      await startWebsiteDeepAnalyze(url);
    };
  }

  const btnImportUrl = document.getElementById('btnImportUrl');
  if (btnImportUrl) {
    btnImportUrl.onclick = async () => {
      if (_demo) { alert('Mode démo — connectez-vous pour importer une URL.'); return; }
      const url = document.getElementById('kbUrlInput').value.trim();
      const err = document.getElementById('kbImportErr');
      err.hidden = true;
      if (!url) { err.textContent = 'Entrez une URL.'; err.hidden = false; return; }
      btnImportUrl.disabled = true;
      btnImportUrl.textContent = 'Analyse…';
      try {
        const res = await NoviaApp.api('api-knowledge', {
          method: 'POST',
          body: JSON.stringify({ action: 'import_url', url, deep: true, replace: false }),
        });
        if (res.error) throw new Error(res.error);
        document.getElementById('kbUrlInput').value = '';
        await loadKnowledgeSources();
        if (res.pages_indexed != null) {
          err.className = 'ok';
          err.textContent = `Analysé : ${res.pages_indexed} page(s), ${res.chunks || 0} extraits.`;
          err.hidden = false;
        }
      } catch (ex) {
        err.className = 'err';
        err.textContent = ex.message || 'Analyse échouée';
        err.hidden = false;
      } finally {
        btnImportUrl.disabled = false;
        btnImportUrl.textContent = 'Analyser URL';
      }
    };
  }

  const btnImportFile = document.getElementById('btnImportFile');
  if (btnImportFile) {
    btnImportFile.onclick = async () => {
      if (_demo) { alert('Mode démo — connectez-vous pour uploader un fichier.'); return; }
      const input = document.getElementById('kbFileInput');
      const err = document.getElementById('kbImportErr');
      err.hidden = true;
      const file = input.files && input.files[0];
      if (!file) { err.textContent = 'Choisissez un fichier.'; err.hidden = false; return; }
      if (file.size > 4 * 1024 * 1024) {
        err.textContent = 'Fichier trop gros (max 4 Mo).';
        err.hidden = false;
        return;
      }
      btnImportFile.disabled = true;
      btnImportFile.textContent = 'Upload…';
      try {
        const b64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const raw = String(reader.result || '');
            const i = raw.indexOf(',');
            resolve(i >= 0 ? raw.slice(i + 1) : raw);
          };
          reader.onerror = () => reject(new Error('Lecture fichier échouée'));
          reader.readAsDataURL(file);
        });
        const res = await NoviaApp.api('api-knowledge', {
          method: 'POST',
          body: JSON.stringify({
            action: 'import_file',
            file_name: file.name,
            mime_type: file.type,
            file_base64: b64,
          }),
        });
        if (res.error) throw new Error(res.error);
        input.value = '';
        await loadKnowledgeSources();
      } catch (ex) {
        err.textContent = ex.message || 'Upload échoué';
        err.hidden = false;
      } finally {
        btnImportFile.disabled = false;
        btnImportFile.textContent = 'Uploader fichier';
      }
    };
  }

  const SUGGESTIONS = [
    'C\'est combien?',
    'Vous êtes ouverts demain?',
    'Je veux un rendez-vous',
    'Où êtes-vous situés?',
  ];

  let testHistory = [];
  let testSending = false;

  function agentLabel() {
    return (document.getElementById('setAgentName')?.value || 'Léa').trim() || 'Léa';
  }

  function welcomeTestMsg() {
    const preview = document.getElementById('kbTestPreview')?.value || 'welcome';
    if (preview === 'missed') {
      const m = document.getElementById('setMissedSms')?.value?.trim();
      if (m) return m;
      return `Bonjour! Ici ${agentLabel()}. Nous avons manqué votre appel. Comment puis-je vous aider?`;
    }
    const w = document.getElementById('setWelcomeSms')?.value?.trim();
    if (w) return w;
    return `Bonjour! Ici ${agentLabel()} — comment puis-je vous aider?`;
  }

  function syncWelcomeBubble() {
    const msgsEl = document.getElementById('kbTestMsgs');
    if (!msgsEl || testHistory.length > 0) return;
    const first = msgsEl.querySelector('.client-sim-bubble.agent:not(.typing)');
    const text = welcomeTestMsg();
    if (first) {
      first.innerHTML = linkify(text);
    } else {
      appendTestBubble('assistant', text);
    }
  }

  function appendTestBubble(role, text, extraClass) {
    const msgsEl = document.getElementById('kbTestMsgs');
    if (!msgsEl) return null;
    const div = document.createElement('div');
    div.className = 'client-sim-bubble ' + (role === 'user' ? 'client' : 'agent') + (extraClass ? ' ' + extraClass : '');
    div.innerHTML = linkify(text);
    msgsEl.appendChild(div);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return div;
  }

  function renderTestChips() {
    const chips = document.getElementById('kbTestChips');
    if (!chips) return;
    chips.innerHTML = '';
    SUGGESTIONS.forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = s;
      b.onclick = () => {
        const input = document.getElementById('kbTestQuestion');
        if (input) input.value = s;
        sendTestMessage();
      };
      chips.appendChild(b);
    });
  }

  function resetTestConvo() {
    testHistory = [];
    testSending = false;
    const msgsEl = document.getElementById('kbTestMsgs');
    if (msgsEl) msgsEl.innerHTML = '';
    const box = document.getElementById('kbTestResult');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    const input = document.getElementById('kbTestQuestion');
    if (input) input.value = '';
    appendTestBubble('assistant', welcomeTestMsg());
    renderTestChips();
  }

  async function sendTestMessage() {
    const input = document.getElementById('kbTestQuestion');
    const q = (input?.value || '').trim();
    if (!q || testSending) return;
    testSending = true;
    if (input) input.value = '';
    appendTestBubble('user', q);
    const typing = appendTestBubble('assistant', '…', 'typing');
    const box = document.getElementById('kbTestResult');

    try {
      let reply = '';
      let hits = [];
      if (_demo) {
        const res = await fetch('/.netlify/functions/api-demo-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: q, history: testHistory }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur démo');
        reply = data.reply || 'Pas de réponse';
      } else {
        const res = await NoviaApp.api('api-knowledge', {
          method: 'POST',
          body: JSON.stringify({ action: 'test', question: q, history: testHistory }),
        });
        if (res.error) throw new Error(res.error);
        reply = res.reply || 'Pas de réponse';
        hits = res.hits || [];
      }

      if (typing) typing.remove();
      appendTestBubble('assistant', reply);
      testHistory.push({ role: 'user', content: q });
      testHistory.push({ role: 'assistant', content: reply });
      if (testHistory.length > 20) testHistory = testHistory.slice(-20);

      if (box) {
        if (hits.length) {
          box.hidden = false;
          let html = '<p><strong>Sources trouvées:</strong></p><ul class="kb-hits">';
          hits.forEach((h) => {
            html += `<li><small>${Math.round((h.similarity || 0) * 100)}% — ${esc(String(h.content || '').slice(0, 120))}…</small></li>`;
          });
          html += '</ul>';
          box.innerHTML = html;
        } else if (!_demo) {
          box.hidden = false;
          box.innerHTML = '<p class="muted">Aucun extrait indexé pour ce tour — réponse basée sur FAQ/services.</p>';
        }
      }
    } catch (ex) {
      if (typing) typing.remove();
      appendTestBubble('assistant', ex.message || 'Erreur');
    } finally {
      testSending = false;
      if (input) input.focus();
    }
  }

  _refreshTestWelcome = resetTestConvo;

  const welcomeEl = document.getElementById('setWelcomeSms');
  if (welcomeEl) {
    welcomeEl.addEventListener('input', syncWelcomeBubble);
  }
  const missedEl = document.getElementById('setMissedSms');
  if (missedEl) {
    missedEl.addEventListener('input', syncWelcomeBubble);
  }
  const previewEl = document.getElementById('kbTestPreview');
  if (previewEl) {
    previewEl.addEventListener('change', () => {
      if (testHistory.length === 0) syncWelcomeBubble();
    });
  }

  const btnKbTestReset = document.getElementById('btnKbTestReset');
  if (btnKbTestReset) btnKbTestReset.onclick = () => resetTestConvo();

  const btnKbTest = document.getElementById('btnKbTest');
  if (btnKbTest) btnKbTest.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    sendTestMessage();
  };

  const kbTestInput = document.getElementById('kbTestQuestion');
  if (kbTestInput) {
    kbTestInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        sendTestMessage();
      }
    });
  }

  if (document.getElementById('setWelcomeSms')?.value?.trim()) {
    resetTestConvo();
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const ok = document.getElementById('chatbotOk');
    const err = document.getElementById('chatbotErr');
    ok.hidden = true;
    err.hidden = true;
    if (!document.getElementById('setAgentName').value.trim()) {
      err.textContent = 'Le prénom de l\'agent est requis.';
      err.hidden = false;
      return;
    }
    if (_demo) { ok.hidden = false; return; }
    try {
      const websiteUrl = document.getElementById('setWebsiteUrl').value.trim();
      const payload = {
        settings: true,
        agent_name: document.getElementById('setAgentName').value.trim(),
        business_type: document.getElementById('setBusinessType').value.trim(),
        agent_tone: collectAgentTone(),
        agent_instructions: document.getElementById('setAgentInstructions').value.trim(),
        welcome_sms: document.getElementById('setWelcomeSms').value.trim(),
        missed_call_sms: document.getElementById('setMissedSms').value.trim(),
        website_url: websiteUrl,
        public_phone: document.getElementById('setPublicPhone')?.value.trim() || '',
        reservation_links: collectReservationLinks(),
        address_line: document.getElementById('setAddress').value.trim(),
        city: document.getElementById('setCity').value.trim(),
        policies: parsePoliciesLines(document.getElementById('setPolicies').value),
        hours: collectHours(),
        services: collectServices(),
        faq: collectFaq(),
        agent_favorites: collectFavorites(),
        qualification_workflow: selectedWorkflow(),
        qualification_fields: collectQualificationFields(),
      };
      const res = await NoviaApp.api('api-tenant', { method: 'PATCH', body: JSON.stringify(payload) });
      if (res.error) throw new Error(res.error);
      if (opts && opts.onSaved) opts.onSaved(res.tenant);
      _tenant = res.tenant || _tenant;
      ok.hidden = false;
      // Site web = source #1 : analyser / réanalyser en profondeur à chaque enregistrement.
      if (websiteUrl) startWebsiteDeepAnalyze(websiteUrl);
    } catch (ex) {
      err.textContent = ex.message || 'Erreur enregistrement';
      err.hidden = false;
    }
  };
}

function normalizeWebsiteKey(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '') || ''}`.toLowerCase();
  } catch {
    return String(url || '').trim().toLowerCase();
  }
}

function setWebsiteAnalyzeStatus(text, kind) {
  const el = document.getElementById('websiteAnalyzeStatus');
  if (!el) return;
  if (!text) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  el.style.display = 'block';
  el.textContent = text;
  el.style.color = kind === 'err' ? 'var(--err, #c0392b)' : (kind === 'ok' ? 'var(--ok, #1a7f37)' : '');
}

async function startWebsiteDeepAnalyze(url) {
  setWebsiteAnalyzeStatus('Analyse du site en cours (toutes les pages importantes)… Cela peut prendre 1–2 minutes.', 'info');
  const btn = document.getElementById('btnAnalyzeWebsite');
  if (btn) btn.disabled = true;
  try {
    // Préférer l'analyse synchrone pour avoir un résultat clair (timeout Netlify ~26s).
    // Si timeout / erreur → relancer en background.
    let res;
    try {
      res = await NoviaApp.api('api-knowledge', {
        method: 'POST',
        body: JSON.stringify({ action: 'analyze_website', url, max_pages: 16, replace: true }),
      });
    } catch (syncErr) {
      await NoviaApp.api('api-analyze-website-background', {
        method: 'POST',
        body: JSON.stringify({ url, max_pages: 20 }),
      });
      setWebsiteAnalyzeStatus(
        'Analyse longue lancée en arrière-plan. Rechargez Options avancées dans 1–2 min.',
        'ok',
      );
      setTimeout(() => loadKnowledgeSources().catch(() => {}), 12000);
      return;
    }
    if (res && res.error) throw new Error(res.error);
    setWebsiteAnalyzeStatus(
      `Site analysé : ${res.pages_indexed || 0} page(s), ${res.chunks || 0} extraits. L’agent s’en sert pour répondre.`,
      'ok',
    );
    await loadKnowledgeSources();
  } catch (ex) {
    setWebsiteAnalyzeStatus(ex.message || 'Analyse du site échouée — réessayez.', 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Bind add buttons immédiatement (même avant initChatbotPanel)
bindUiClicks();

window.NoviaChatbot = {
  initChatbotPanel,
  populateChatbotForm,
  loadKnowledgeSources,
  addServiceRow,
  addFaqRow,
  addFavoriteRow,
  addReservationLinkRow,
  DEFAULT_HOURS,
  refreshTestWelcome: () => { if (_refreshTestWelcome) _refreshTestWelcome(); },
};
