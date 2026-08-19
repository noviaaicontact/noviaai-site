(function () {
  let tenants = [];
  let leads = [];
  let leadLabels = { status: {}, source: {}, inbound: {} };
  let accessToken = '';
  let currentTab = 'tenants';

  const $ = (id) => document.getElementById(id);

  const STATUS_LABELS = {
    new: 'Nouveau',
    contacted: 'Contacté',
    demo_booked: 'Démo planifiée',
    demo_done: 'Démo effectuée',
    customer: 'Client',
    not_interested: 'Pas intéressé',
  };
  const SOURCE_LABELS = {
    facebook: 'Facebook organique',
    instagram: 'Instagram organique',
    tiktok: 'TikTok organique',
    meta_ads: 'Meta Ads',
    direct: 'Direct',
  };
  const INBOUND_LABELS = {
    phone: 'Téléphone',
    sms: 'SMS',
    messenger: 'Messenger',
    instagram: 'Instagram',
    website_form: 'Formulaire sur le site',
    booking: 'Système de réservation',
    several: 'Plusieurs de ces options',
    other: 'Autre',
  };

  async function getToken() {
    if (accessToken) return accessToken;
    const sb = await NoviaApp.getSupabase();
    if (!sb) return '';
    const { data } = await sb.auth.getSession();
    accessToken = data.session?.access_token || '';
    return accessToken;
  }

  async function adminApi(fn, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const token = await getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch('/.netlify/functions/' + fn, Object.assign({}, opts, { headers }));
    let data = {};
    try { data = await res.json(); } catch (_) { /* ignore */ }
    if (!res.ok) throw new Error((data && data.error) || ('Erreur ' + res.status));
    return data;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) {
      return iso;
    }
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function statusBadge(label, kind) {
    return `<span class="admin-badge ${kind}">${esc(label)}</span>`;
  }

  function subBadge(status) {
    const map = {
      trialing: ['Essai', 'trial'],
      active: ['Actif', 'ok'],
      inactive: ['Inactif', 'muted'],
      canceled: ['Annulé', 'err'],
      past_due: ['Paiement retard', 'warn'],
    };
    const [label, kind] = map[status] || [status || '—', 'muted'];
    return statusBadge(label, kind);
  }

  function lineBadge(status) {
    const map = {
      active: ['Active', 'ok'],
      pending: ['En attente', 'warn'],
      suspended: ['Suspendue', 'err'],
      failed: ['Échec', 'err'],
    };
    const [label, kind] = map[status] || [status || '—', 'muted'];
    return statusBadge(label, kind);
  }

  function renderStats(summary) {
    const el = $('adminStats');
    if (!el || !summary) return;
    const items = [
      ['Comptes', summary.total, ''],
      ['Essai', summary.trialing, 'trial'],
      ['Payants actifs', summary.active, 'ok'],
      ['Lignes actives', summary.line_active, 'ok'],
      ['En attente', summary.line_pending, 'warn'],
      ['Suspendus', summary.line_suspended, 'err'],
    ];
    el.innerHTML = items.map(([label, n, kind]) =>
      `<div class="admin-stat-card${kind ? ' ' + kind : ''}"><div class="n">${n}</div><div class="label">${esc(label)}</div></div>`
    ).join('');
  }

  function filteredTenants() {
    const q = ($('adminSearch')?.value || '').trim().toLowerCase();
    const sub = $('adminFilterStatus')?.value || '';
    const line = $('adminFilterLine')?.value || '';
    return tenants.filter((t) => {
      if (sub && t.subscription_status !== sub) return false;
      if (line && t.provisioning_status !== line) return false;
      if (!q) return true;
      const hay = [
        t.business_name, t.email, t.contact_email, t.twilio_number,
        t.phone_forward, t.agent_name, t.id,
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function renderTable() {
    const body = $('adminTableBody');
    if (!body) return;
    const rows = filteredTenants();
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="muted">Aucun compte trouvé.</td></tr>';
      return;
    }
    body.innerHTML = rows.map((t) => {
      const canSuspend = t.provisioning_status !== 'suspended';
      const canReactivate = t.provisioning_status === 'suspended' || t.subscription_status === 'inactive';
      const pendingClaim = t.claim_token_expires_at && new Date(t.claim_token_expires_at).getTime() > Date.now();
      const placeholder = /@noviaai\.invalid$/i.test(t.email || '');
      return `<tr data-id="${esc(t.id)}">
        <td>
          <strong>${esc(t.business_name || '—')}</strong>
          ${t.onboarding_done ? '' : statusBadge('Onboarding', 'warn')}
          ${placeholder ? statusBadge('À transférer', 'trial') : ''}
          ${pendingClaim ? statusBadge('Lien client', 'ok') : ''}
          <div class="admin-sub">${esc(t.agent_name || '')}${t.business_type ? ' · ' + esc(t.business_type) : ''}</div>
        </td>
        <td>
          <div>${placeholder ? 'En attente du client' : esc(t.email || '—')}</div>
          ${t.contact_email && t.contact_email !== t.email && !placeholder ? `<div class="admin-sub">${esc(t.contact_email)}</div>` : ''}
        </td>
        <td>${esc(t.plan || '—')}</td>
        <td>${subBadge(t.subscription_status)}<div class="admin-sub">Fin essai: ${esc(fmtDate(t.trial_ends_at))}</div></td>
        <td>
          ${lineBadge(t.provisioning_status)}
          <div class="admin-sub">${t.twilio_number ? esc(t.twilio_number) : 'Pas de ligne'}</div>
        </td>
        <td>${esc(fmtDate(t.created_at))}</td>
        <td class="admin-actions">
          <button type="button" class="btn btn-accent btn-sm" data-action="assist">Assister</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="invite">Lien client</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="detail">Détails</button>
          ${canSuspend ? `<button type="button" class="btn btn-ghost btn-sm admin-danger" data-action="suspend">Suspendre</button>` : ''}
          ${canReactivate ? `<button type="button" class="btn btn-ghost btn-sm" data-action="reactivate">Réactiver</button>` : ''}
        </td>
      </tr>
      <tr class="admin-detail-row" data-detail-for="${esc(t.id)}" hidden>
        <td colspan="7">
          <div class="admin-detail-grid">
            <div><span class="admin-detail-k">ID</span><code>${esc(t.id)}</code></div>
            <div><span class="admin-detail-k">User ID</span><code>${esc(t.user_id)}</code></div>
            <div><span class="admin-detail-k">Renvoi cell</span>${esc(t.phone_forward || '—')}</div>
            <div><span class="admin-detail-k">Site web</span>${t.website_url ? `<a href="${esc(t.website_url)}" target="_blank" rel="noopener">${esc(t.website_url)}</a>` : '—'}</div>
            <div><span class="admin-detail-k">Stripe client</span>${esc(t.stripe_customer_id || '—')}</div>
            <div><span class="admin-detail-k">Stripe abo</span>${esc(t.stripe_subscription_id || '—')}</div>
            <div><span class="admin-detail-k">Leads</span>${esc(String(t.leads_count || 0))}</div>
            <div><span class="admin-detail-k">Widget</span>${t.widget_enabled === false ? 'Désactivé' : 'Activé'}</div>
            ${t.provisioning_error ? `<div class="admin-detail-wide"><span class="admin-detail-k">Erreur provision</span>${esc(t.provisioning_error)}</div>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  function fmtPhone(p) {
    const d = String(p || '').replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '1') {
      return d.slice(1, 4) + '-' + d.slice(4, 7) + '-' + d.slice(7);
    }
    if (d.length === 10) {
      return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
    }
    return p || '—';
  }

  function sourceLabel(key) {
    return (leadLabels.source && leadLabels.source[key]) || SOURCE_LABELS[key] || key || 'Direct';
  }

  function inboundLabel(key) {
    return (leadLabels.inbound && leadLabels.inbound[key]) || INBOUND_LABELS[key] || key || '—';
  }

  function statusLabel(key) {
    return (leadLabels.status && leadLabels.status[key]) || STATUS_LABELS[key] || key || '—';
  }

  function renderLeadStats(summary) {
    const el = $('adminLeadStats');
    if (!el) return;
    const s = summary || {};
    const items = [
      ['Prospects', s.total || 0, ''],
      ['Nouveaux', s.new || 0, 'trial'],
      ['7 derniers jours', s.this_week || 0, 'ok'],
      ['Facebook', s.facebook || 0, ''],
      ['Instagram', s.instagram || 0, ''],
      ['TikTok', s.tiktok || 0, ''],
      ['Meta Ads', s.meta_ads || 0, 'warn'],
    ];
    el.innerHTML = items.map(([label, n, kind]) =>
      `<div class="admin-stat-card${kind ? ' ' + kind : ''}"><div class="n">${n}</div><div class="label">${esc(label)}</div></div>`
    ).join('');
  }

  function filteredLeads() {
    const q = ($('adminLeadSearch')?.value || '').trim().toLowerCase();
    const status = $('adminLeadFilterStatus')?.value || '';
    const source = $('adminLeadFilterSource')?.value || '';
    const form = $('adminLeadFilterForm')?.value;
    return leads.filter((l) => {
      if (status && l.status !== status) return false;
      if (source && l.source_channel !== source) return false;
      if (form && (l.form_variant || 'potentiel') !== form) return false;
      if (!q) return true;
      const hay = [
        l.first_name, l.last_name, l.business_name, l.email, l.phone,
        inboundLabel(l.inbound_channel), sourceLabel(l.source_channel),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function renderLeads() {
    const body = $('adminLeadTableBody');
    if (!body) return;
    const rows = filteredLeads();
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8" class="muted">Aucun prospect pour ces filtres.</td></tr>';
      return;
    }
    const statusOpts = Object.keys(STATUS_LABELS).map((k) =>
      `<option value="${k}">${esc(STATUS_LABELS[k])}</option>`
    ).join('');
    body.innerHTML = rows.map((l) => {
      const st = l.status || 'new';
      return `<tr data-lead-id="${esc(l.id)}">
        <td><strong>${esc(l.first_name || '—')}</strong></td>
        <td>${esc(l.business_name || '—')}</td>
        <td>${esc(inboundLabel(l.inbound_channel))}</td>
        <td><a href="tel:${esc(l.phone || '')}">${esc(fmtPhone(l.phone))}</a></td>
        <td><a href="mailto:${esc(l.email || '')}">${esc(l.email || '—')}</a></td>
        <td>${esc(fmtDate(l.created_at))}</td>
        <td>${esc(sourceLabel(l.source_channel || 'direct'))}</td>
        <td>
          <select class="admin-lead-status" data-action="status" aria-label="Statut">
            ${statusOpts.replace(`value="${st}"`, `value="${st}" selected`)}
          </select>
        </td>
      </tr>`;
    }).join('');
  }

  async function loadLeads() {
    const errEl = $('adminLeadLoadErr');
    if (errEl) errEl.hidden = true;
    try {
      const data = await adminApi('api-admin-marketing-leads', { method: 'GET' });
      leads = data.leads || [];
      leadLabels = data.labels || leadLabels;
      renderLeadStats(data.summary);
      renderLeads();
    } catch (e) {
      if (errEl) {
        errEl.textContent = e.message || 'Erreur chargement';
        errEl.hidden = false;
      }
    }
  }

  function showTab(tab) {
    currentTab = tab === 'leads' ? 'leads' : 'tenants';
    const tenantsView = $('adminTenantsView');
    const leadsView = $('adminLeadsView');
    if (tenantsView) tenantsView.hidden = currentTab !== 'tenants';
    if (leadsView) leadsView.hidden = currentTab !== 'leads';
    const title = $('adminTitle');
    if (title) title.textContent = currentTab === 'leads' ? 'Prospects pubs' : 'Inscriptions SaaS';
    const prepare = $('btnAdminPrepare');
    if (prepare) prepare.hidden = currentTab !== 'tenants';
    document.querySelectorAll('.admin-tab').forEach((btn) => {
      const on = btn.getAttribute('data-tab') === currentTab;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  async function loadAll() {
    await loadTenants();
    await loadLeads();
  }

  function showLinkModal(url, businessName) {
    $('adminClaimUrl').value = url;
    $('adminLinkHint').textContent = businessName
      ? `Envoyez ce lien à ${businessName}. Le client y choisit son courriel et son mot de passe — le compte préparé reste le même.`
      : 'Envoyez ce lien au client. Il choisit son courriel et son mot de passe — le compte préparé reste le même.';
    $('adminLinkModal').hidden = false;
  }

  function closeModals() {
    $('adminPrepareModal').hidden = true;
    $('adminLinkModal').hidden = true;
  }

  function toast(msg, isErr) {
    const el = $('adminToast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.toggle('err', !!isErr);
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 4500);
  }

  async function loadTenants() {
    const errEl = $('adminLoadErr');
    if (errEl) errEl.hidden = true;
    try {
      const data = await adminApi('api-admin-tenants', { method: 'GET' });
      tenants = data.tenants || [];
      renderStats(data.summary);
      renderTable();
    } catch (e) {
      if (errEl) {
        errEl.textContent = e.message || 'Erreur chargement';
        errEl.hidden = false;
      }
      if (/401|403|Non autorisé|refusé/i.test(e.message || '')) logout();
    }
  }

  async function patchTenant(tenantId, payload) {
    const data = await adminApi('api-admin-tenants', {
      method: 'PATCH',
      body: JSON.stringify(Object.assign({ tenant_id: tenantId }, payload)),
    });
    if (data.tenant) {
      tenants = tenants.map((t) => (t.id === data.tenant.id ? data.tenant : t));
      renderStats({
        total: tenants.length,
        trialing: tenants.filter((x) => x.subscription_status === 'trialing').length,
        active: tenants.filter((x) => x.subscription_status === 'active').length,
        inactive: tenants.filter((x) => x.subscription_status === 'inactive').length,
        line_active: tenants.filter((x) => x.provisioning_status === 'active').length,
        line_pending: tenants.filter((x) => x.provisioning_status === 'pending').length,
        line_suspended: tenants.filter((x) => x.provisioning_status === 'suspended').length,
        onboarding_done: tenants.filter((x) => x.onboarding_done).length,
      });
      renderTable();
    }
    if (data.message) toast(data.message);
    else toast('Mise à jour effectuée.');
  }

  async function showPanel(email) {
    $('adminLogin').hidden = true;
    $('adminPanel').hidden = false;
    const emailEl = $('adminUserEmail');
    if (emailEl) emailEl.textContent = email || 'admin';
    await loadTenants();
    await loadLeads();
  }

  async function logout() {
    accessToken = '';
    const sb = await NoviaApp.getSupabase();
    if (sb) await sb.auth.signOut();
    $('adminPanel').hidden = true;
    $('adminLogin').hidden = false;
    $('adminPassword').value = '';
  }

  async function tryRestoreSession() {
    const sb = await NoviaApp.getSupabase();
    if (!sb) return;
    const { data } = await sb.auth.getSession();
    if (!data.session) return;
    try {
      accessToken = data.session.access_token;
      await adminApi('api-admin-tenants', {
        method: 'POST',
        body: JSON.stringify({ action: 'verify' }),
      });
      await showPanel(data.session.user?.email);
    } catch (_) {
      await sb.auth.signOut();
      accessToken = '';
    }
  }

  $('adminLoginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('adminLoginErr');
    if (errEl) errEl.hidden = true;
    const email = $('adminEmail')?.value?.trim();
    const password = $('adminPassword')?.value || '';
    if (!email || !password) return;
    try {
      const sb = await NoviaApp.getSupabase();
      if (!sb) throw new Error('Service indisponible');
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      accessToken = data.session?.access_token || '';
      await adminApi('api-admin-tenants', {
        method: 'POST',
        body: JSON.stringify({ action: 'verify' }),
      });
      await showPanel(email);
    } catch (ex) {
      const sb = await NoviaApp.getSupabase();
      if (sb) await sb.auth.signOut();
      accessToken = '';
      if (errEl) {
        const msg = ex.message || 'Connexion impossible';
        errEl.textContent = /refus|autoris|401|Non autorisé/i.test(msg)
          ? 'Ce courriel n’est pas autorisé comme admin. Utilisez noviaai.contact@gmail.com ou aetienne511@gmail.com.'
          : msg;
        errEl.hidden = false;
      }
    }
  });

  $('btnAdminLogout')?.addEventListener('click', logout);
  $('btnAdminRefresh')?.addEventListener('click', () => loadAll());
  $('adminSearch')?.addEventListener('input', renderTable);
  $('adminFilterStatus')?.addEventListener('change', renderTable);
  $('adminFilterLine')?.addEventListener('change', renderTable);
  $('adminLeadSearch')?.addEventListener('input', renderLeads);
  $('adminLeadFilterStatus')?.addEventListener('change', renderLeads);
  $('adminLeadFilterSource')?.addEventListener('change', renderLeads);
  $('adminLeadFilterForm')?.addEventListener('change', renderLeads);

  document.querySelectorAll('.admin-tab').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.getAttribute('data-tab')));
  });

  $('btnAdminPrepare')?.addEventListener('click', () => {
    $('adminPrepareErr').hidden = true;
    $('prepareBusinessName').value = '';
    $('prepareBusinessType').value = '';
    $('adminPrepareModal').hidden = false;
    $('prepareBusinessName').focus();
  });
  $('btnPrepareCancel')?.addEventListener('click', closeModals);
  $('btnLinkClose')?.addEventListener('click', closeModals);
  $('adminPrepareModal')?.addEventListener('click', (e) => {
    if (e.target === $('adminPrepareModal')) closeModals();
  });
  $('adminLinkModal')?.addEventListener('click', (e) => {
    if (e.target === $('adminLinkModal')) closeModals();
  });
  $('btnCopyClaim')?.addEventListener('click', async () => {
    const url = $('adminClaimUrl').value;
    try {
      await navigator.clipboard.writeText(url);
      toast('Lien copié.');
    } catch (_) {
      $('adminClaimUrl').select();
      toast('Sélectionnez le lien et copiez-le (Ctrl+C).');
    }
  });
  $('adminPrepareForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('adminPrepareErr');
    errEl.hidden = true;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const data = await adminApi('api-admin-tenants', {
        method: 'POST',
        body: JSON.stringify({
          action: 'prepare',
          business_name: $('prepareBusinessName').value.trim(),
          business_type: $('prepareBusinessType').value.trim(),
        }),
      });
      if (data.tenant) {
        tenants = [data.tenant].concat(tenants.filter((t) => t.id !== data.tenant.id));
        renderTable();
      }
      $('adminPrepareModal').hidden = true;
      showLinkModal(data.claim_url, data.tenant?.business_name);
      toast(data.message || 'Compte préparé.');
    } catch (ex) {
      errEl.textContent = ex.message || 'Création impossible';
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  $('adminTableBody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const row = btn.closest('tr[data-id]');
    if (!row) return;
    const id = row.getAttribute('data-id');
    const action = btn.getAttribute('data-action');

    if (action === 'detail') {
      const detail = document.querySelector(`tr.admin-detail-row[data-detail-for="${id}"]`);
      if (detail) detail.hidden = !detail.hidden;
      return;
    }

    // Ouvre le tableau de bord du client dans un onglet séparé : la session
    // admin (localStorage) suit, le ciblage passe par le paramètre d'URL.
    if (action === 'assist') {
      const t = tenants.find((x) => x.id === id);
      const url = '/dashboard.html?assist=' + encodeURIComponent(id)
        + '&assist_nom=' + encodeURIComponent(t?.business_name || '');
      window.open(url, '_blank');
      return;
    }

    if (action === 'invite') {
      const t = tenants.find((x) => x.id === id);
      try {
        const data = await adminApi('api-admin-tenants', {
          method: 'POST',
          body: JSON.stringify({ action: 'invite', tenant_id: id }),
        });
        if (data.tenant) {
          tenants = tenants.map((x) => (x.id === data.tenant.id ? data.tenant : x));
        } else {
          tenants = tenants.map((x) => (x.id === id
            ? Object.assign({}, x, { claim_token_expires_at: data.expires_at })
            : x));
        }
        renderTable();
        showLinkModal(data.claim_url, t?.business_name || data.business_name);
      } catch (ex) {
        toast(ex.message || 'Lien impossible', true);
      }
      return;
    }

    if (action === 'suspend') {
      if (!confirm('Suspendre ce compte? La ligne Twilio sera libérée.')) return;
      try {
        await patchTenant(id, { action: 'suspend' });
      } catch (ex) {
        toast(ex.message || 'Erreur', true);
      }
      return;
    }

    if (action === 'reactivate') {
      if (!confirm('Réactiver ce compte? (La ligne Twilio devra peut-être être re-provisionnée.)')) return;
      try {
        await patchTenant(id, { action: 'reactivate' });
      } catch (ex) {
        toast(ex.message || 'Erreur', true);
      }
    }
  });

  $('adminLeadTableBody')?.addEventListener('change', async (e) => {
    const sel = e.target.closest('select[data-action="status"]');
    if (!sel) return;
    const row = sel.closest('tr[data-lead-id]');
    if (!row) return;
    const id = row.getAttribute('data-lead-id');
    const status = sel.value;
    sel.disabled = true;
    try {
      const data = await adminApi('api-admin-marketing-leads', {
        method: 'PATCH',
        body: JSON.stringify({ id, status }),
      });
      if (data.lead) {
        leads = leads.map((l) => (l.id === data.lead.id ? data.lead : l));
        renderLeadStats({
          total: leads.length,
          new: leads.filter((x) => x.status === 'new').length,
          this_week: leads.filter((x) => x.created_at && new Date(x.created_at).getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000).length,
          facebook: leads.filter((x) => x.source_channel === 'facebook').length,
          instagram: leads.filter((x) => x.source_channel === 'instagram').length,
          tiktok: leads.filter((x) => x.source_channel === 'tiktok').length,
          meta_ads: leads.filter((x) => x.source_channel === 'meta_ads').length,
        });
      }
      toast('Statut mis à jour.');
    } catch (ex) {
      toast(ex.message || 'Erreur statut', true);
      await loadLeads();
    } finally {
      sel.disabled = false;
    }
  });

  tryRestoreSession();
})();
