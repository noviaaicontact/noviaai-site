// Panneau Chatbot — services, FAQ, horaires, import URL, testeur.

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

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
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
    <button type="button" class="btn btn-ghost btn-sm kb-remove" title="Supprimer">×</button>
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
    <button type="button" class="btn btn-ghost btn-sm kb-remove" title="Supprimer">×</button>
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
  container.querySelectorAll('.kb-remove').forEach((btn) => {
    btn.onclick = () => {
      const row = btn.closest('.kb-row');
      const parent = row.parentElement;
      if (parent.querySelectorAll('.kb-row').length > 1) row.remove();
    };
  });
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
  document.getElementById('setAgentName').value = t.agent_name || 'Léa';
  document.getElementById('setBusinessType').value = t.business_type || '';
  document.getElementById('setAgentTone').value = t.agent_tone || '';
  document.getElementById('setWelcomeSms').value = t.welcome_sms || '';
  document.getElementById('setWebsiteUrl').value = t.website_url || '';
  document.getElementById('setReservationUrl').value = t.reservation_url || '';
  document.getElementById('setAddress').value = t.address_line || '';
  document.getElementById('setCity').value = t.city || '';
  document.getElementById('setPolicies').value = policiesToLines(t.policies);
  renderHours(t.hours || DEFAULT_HOURS);
  renderServices(t.services);
  renderFaq(t.faq);
  if (!_demo) loadKnowledgeSources();
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

function bindClick(id, fn) {
  const el = document.getElementById(id);
  if (el) el.onclick = fn;
}

function initChatbotPanel(opts) {
  _demo = !!(opts && opts.demo);
  if (!document.getElementById('chatbotForm')) return;

  bindClick('btnAddService', () => {
    const el = document.getElementById('servicesList');
    el.insertAdjacentHTML('beforeend', serviceRowHtml({ nom: '', prix: '' }, el.children.length));
    bindRemoveButtons(el);
  });

  bindClick('btnAddFaq', () => {
    const el = document.getElementById('faqList');
    el.insertAdjacentHTML('beforeend', faqRowHtml({ question: '', reponse: '' }, el.children.length));
    bindRemoveButtons(el);
  });

  bindClick('btnImportUrl', async () => {
    if (_demo) { alert('Mode démo — connectez-vous pour importer une URL.'); return; }
    const url = document.getElementById('kbUrlInput').value.trim();
    const err = document.getElementById('kbImportErr');
    const btn = document.getElementById('btnImportUrl');
    err.hidden = true;
    if (!url) { err.textContent = 'Entrez une URL.'; err.hidden = false; return; }
    btn.disabled = true;
    btn.textContent = 'Import…';
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
      btn.disabled = false;
      btn.textContent = 'Importer URL';
    }
  };

  bindClick('btnImportFile', async () => {
    if (_demo) { alert('Mode démo — connectez-vous pour uploader un fichier.'); return; }
    const input = document.getElementById('kbFileInput');
    const err = document.getElementById('kbImportErr');
    const btn = document.getElementById('btnImportFile');
    err.hidden = true;
    const file = input.files && input.files[0];
    if (!file) { err.textContent = 'Choisissez un fichier.'; err.hidden = false; return; }
    if (file.size > 4 * 1024 * 1024) {
      err.textContent = 'Fichier trop gros (max 4 Mo).';
      err.hidden = false;
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Upload…';
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
      btn.disabled = false;
      btn.textContent = 'Uploader fichier';
    }
  };

  bindClick('btnKbTest', async () => {
    const q = document.getElementById('kbTestQuestion').value.trim();
    const box = document.getElementById('kbTestResult');
    if (!q) return;
    if (_demo) {
      box.innerHTML = '<p class="muted">Mode démo — exemple de réponse affichée.</p><p>Bonjour! Coupe femme à partir de 45 $. On a des places jeudi PM — voulez-vous qu\'on vous réserve?</p>';
      box.hidden = false;
      return;
    }
    box.hidden = false;
    box.innerHTML = '<p class="muted">Test en cours…</p>';
    try {
      const res = await NoviaApp.api('api-knowledge', {
        method: 'POST',
        body: JSON.stringify({ action: 'test', question: q }),
      });
      if (res.error) throw new Error(res.error);
      let html = '';
      if (res.hits && res.hits.length) {
        html += '<p><strong>Sources trouvées:</strong></p><ul class="kb-hits">';
        res.hits.forEach((h) => {
          html += `<li><small>${Math.round((h.similarity || 0) * 100)}% — ${esc(h.content.slice(0, 120))}…</small></li>`;
        });
        html += '</ul>';
      } else {
        html += '<p class="muted">Aucun extrait indexé — réponse basée sur FAQ/services seulement.</p>';
      }
      if (res.reply) {
        html += `<p><strong>Réponse simulée:</strong></p><p class="kb-test-reply">${esc(res.reply)}</p>`;
      }
      box.innerHTML = html;
    } catch (ex) {
      box.innerHTML = `<p class="err">${esc(ex.message)}</p>`;
    }
  };

  const chatbotForm = document.getElementById('chatbotForm');
  if (!chatbotForm) return;
  chatbotForm.onsubmit = async (e) => {
    e.preventDefault();
    const ok = document.getElementById('chatbotOk');
    const err = document.getElementById('chatbotErr');
    ok.hidden = true;
    err.hidden = true;
    if (!document.getElementById('setAgentName').value.trim()) {
      err.textContent = 'Le prénom de l\'agente est requis.';
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
        welcome_sms: document.getElementById('setWelcomeSms').value.trim(),
        website_url: document.getElementById('setWebsiteUrl').value.trim(),
        reservation_url: document.getElementById('setReservationUrl').value.trim(),
        address_line: document.getElementById('setAddress').value.trim(),
        city: document.getElementById('setCity').value.trim(),
        policies: parsePoliciesLines(document.getElementById('setPolicies').value),
        hours: collectHours(),
        services: collectServices(),
        faq: collectFaq(),
      };
      const res = await NoviaApp.api('api-tenant', { method: 'PATCH', body: JSON.stringify(payload) });
      if (res.error) throw new Error(res.error);
      if (opts.onSaved) opts.onSaved(res.tenant);
      ok.hidden = false;
    } catch (ex) {
      err.textContent = ex.message || 'Erreur enregistrement';
      err.hidden = false;
    }
  };
}

window.NoviaChatbot = {
  initChatbotPanel,
  populateChatbotForm,
  loadKnowledgeSources,
  DEFAULT_HOURS,
};
