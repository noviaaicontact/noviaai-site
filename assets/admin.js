(function () {
  const STORAGE_KEY = 'novia_admin_secret';
  let tenants = [];
  let secret = '';

  const $ = (id) => document.getElementById(id);

  function getSecret() {
    return secret || sessionStorage.getItem(STORAGE_KEY) || '';
  }

  function setSecret(val) {
    secret = val;
    if (val) sessionStorage.setItem(STORAGE_KEY, val);
    else sessionStorage.removeItem(STORAGE_KEY);
  }

  async function adminApi(fn, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const s = getSecret();
    if (s) headers['X-Admin-Secret'] = s;
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
      return `<tr data-id="${esc(t.id)}">
        <td>
          <strong>${esc(t.business_name || '—')}</strong>
          ${t.onboarding_done ? '' : statusBadge('Onboarding', 'warn')}
          <div class="admin-sub">${esc(t.agent_name || '')}${t.business_type ? ' · ' + esc(t.business_type) : ''}</div>
        </td>
        <td>
          <div>${esc(t.email || '—')}</div>
          ${t.contact_email && t.contact_email !== t.email ? `<div class="admin-sub">${esc(t.contact_email)}</div>` : ''}
        </td>
        <td>${esc(t.plan || '—')}</td>
        <td>${subBadge(t.subscription_status)}<div class="admin-sub">Fin essai: ${esc(fmtDate(t.trial_ends_at))}</div></td>
        <td>
          ${lineBadge(t.provisioning_status)}
          <div class="admin-sub">${t.twilio_number ? esc(t.twilio_number) : 'Pas de ligne'}</div>
        </td>
        <td>${esc(fmtDate(t.created_at))}</td>
        <td class="admin-actions">
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
      if (/401|403|Non autorisé|incorrect/i.test(e.message || '')) logout();
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

  function showPanel() {
    $('adminLogin').hidden = true;
    $('adminPanel').hidden = false;
    loadTenants();
  }

  function logout() {
    setSecret('');
    $('adminPanel').hidden = true;
    $('adminLogin').hidden = false;
    $('adminSecret').value = '';
  }

  $('adminLoginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('adminLoginErr');
    if (errEl) errEl.hidden = true;
    const val = $('adminSecret')?.value?.trim();
    if (!val) return;
    try {
      await fetch('/.netlify/functions/api-admin-tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': val },
        body: JSON.stringify({ action: 'verify' }),
      }).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Mot de passe incorrect');
      });
      setSecret(val);
      showPanel();
    } catch (ex) {
      if (errEl) {
        errEl.textContent = ex.message || 'Connexion impossible';
        errEl.hidden = false;
      }
    }
  });

  $('btnAdminLogout')?.addEventListener('click', logout);
  $('btnAdminRefresh')?.addEventListener('click', () => loadTenants());
  $('adminSearch')?.addEventListener('input', renderTable);
  $('adminFilterStatus')?.addEventListener('change', renderTable);
  $('adminFilterLine')?.addEventListener('change', renderTable);

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

  if (getSecret()) showPanel();
})();
