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
  return `<div class="kb-row" data-idx="${idx}">
    <input type="text" class="svc-name" placeholder="Nom du service" value="${esc(s.nom || s.description_courte || '')}">
    <input type="text" class="svc-price" placeholder="Prix" value="${esc(s.prix || '')}">
    <button type="button" class="btn btn-ghost btn-sm kb-remove" title="Supprimer">&times;</button>
  </div>`;
}

function renderServices(services) {
  const el = document.getElementById('servicesList');
  if (!el) return;
  const list = Array.isArray(services) && services.length ? services : [{ nom: '', prix: '' }];
  el.innerHTML = list.map((s, i) => serviceRowHtml(s, i)).join('');
  bindRemoveButtons(el);
}

function collectServices() {
  return Array.from(document.querySelectorAll('#servicesList .kb-row')).map((row) => ({
    nom: row.querySelector('.svc-name').value.trim(),
    prix: row.querySelector('.svc-price').value.trim(),
    description_courte: row.querySelector('.svc-name').value.trim(),
  })).filter((s) => s.nom);
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
  el.insertAdjacentHTML('beforeend', serviceRowHtml({ nom: '', prix: '' }, el.children.length));
  bindRemoveButtons(el);
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
  const set = (id, val) => {
    const node = document.getElementById(id);
    if (node) node.value = val;
  };
  set('setAgentName', t.agent_name || 'Léa');
  set('setBusinessType', t.business_type || '');
  set('setAgentTone', t.agent_tone || '');
  set('setAgentInstructions', t.agent_instructions || '');
  set('setWelcomeSms', t.welcome_sms || '');
  set('setWebsiteUrl', t.website_url || '');
  set('setPublicPhone', t.public_phone || '');
  set('setAddress', t.address_line || '');
  set('setCity', t.city || '');
  set('setPolicies', policiesToLines(t.policies));
  renderHours(t.hours || DEFAULT_HOURS);
  renderServices(t.services);
  renderFaq(t.faq);
  renderReservationLinks(normalizeLinksFromTenant(t));
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
    }
  });
}

function initChatbotPanel(opts) {
  _demo = !!(opts && opts.demo);
  bindUiClicks();
  const form = document.getElementById('chatbotForm');
  if (!form) return;

  const btnImportUrl = document.getElementById('btnImportUrl');
  if (btnImportUrl) {
    btnImportUrl.onclick = async () => {
      if (_demo) { alert('Mode démo — connectez-vous pour importer une URL.'); return; }
      const url = document.getElementById('kbUrlInput').value.trim();
      const err = document.getElementById('kbImportErr');
      err.hidden = true;
      if (!url) { err.textContent = 'Entrez une URL.'; err.hidden = false; return; }
      btnImportUrl.disabled = true;
      btnImportUrl.textContent = 'Import…';
      try {
        const res = await NoviaApp.api('api-knowledge', {
          method: 'POST',
          body: JSON.stringify({ action: 'import_url', url }),
        });
        if (res.error) throw new Error(res.error);
        document.getElementById('kbUrlInput').value = '';
        await loadKnowledgeSources();
      } catch (ex) {
        err.textContent = ex.message || 'Import échoué';
        err.hidden = false;
      } finally {
        btnImportUrl.disabled = false;
        btnImportUrl.textContent = 'Importer URL';
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
      const payload = {
        settings: true,
        agent_name: document.getElementById('setAgentName').value.trim(),
        business_type: document.getElementById('setBusinessType').value.trim(),
        agent_tone: document.getElementById('setAgentTone').value.trim(),
        agent_instructions: document.getElementById('setAgentInstructions').value.trim(),
        welcome_sms: document.getElementById('setWelcomeSms').value.trim(),
        website_url: document.getElementById('setWebsiteUrl').value.trim(),
        public_phone: document.getElementById('setPublicPhone')?.value.trim() || '',
        reservation_links: collectReservationLinks(),
        address_line: document.getElementById('setAddress').value.trim(),
        city: document.getElementById('setCity').value.trim(),
        policies: parsePoliciesLines(document.getElementById('setPolicies').value),
        hours: collectHours(),
        services: collectServices(),
        faq: collectFaq(),
      };
      const res = await NoviaApp.api('api-tenant', { method: 'PATCH', body: JSON.stringify(payload) });
      if (res.error) throw new Error(res.error);
      if (opts && opts.onSaved) opts.onSaved(res.tenant);
      ok.hidden = false;
    } catch (ex) {
      err.textContent = ex.message || 'Erreur enregistrement';
      err.hidden = false;
    }
  };
}

// Bind add buttons immédiatement (même avant initChatbotPanel)
bindUiClicks();

window.NoviaChatbot = {
  initChatbotPanel,
  populateChatbotForm,
  loadKnowledgeSources,
  addServiceRow,
  addFaqRow,
  addReservationLinkRow,
  DEFAULT_HOURS,
  refreshTestWelcome: () => { if (_refreshTestWelcome) _refreshTestWelcome(); },
};
