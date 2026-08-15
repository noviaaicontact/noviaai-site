(function () {
  const LABELS = {
    google: 'Google Calendar',
    microsoft: 'Microsoft Calendar',
  };

  function $(id) {
    return document.getElementById(id);
  }

  function statusLabel(info) {
    if (!info || !info.connected) {
      if (info && (info.status === 'expired' || info.status === 'error')) {
        return { text: 'Autorisation expirée', cls: 'err' };
      }
      return { text: 'Non connecté', cls: 'muted' };
    }
    return { text: 'Connecté', cls: 'ok' };
  }

  function renderProvider(provider, info, configured) {
    const st = statusLabel(info);
    const email = info && info.email ? info.email : '';
    const err = info && info.error && !info.connected ? info.error : '';
    const canConnect = !!configured;
    const connected = !!(info && info.connected);

    return `
      <div class="cal-row" data-provider="${provider}">
        <div>
          <strong>${LABELS[provider]}</strong>
          <p class="muted" style="margin:4px 0 0;font-size:.85rem">
            <span class="cal-status" style="${st.cls === 'ok' ? 'color:var(--ok);font-weight:700' : ''}">${st.text}</span>
            ${email ? ` · ${email}` : ''}
          </p>
          ${err ? `<p class="err" style="margin:6px 0 0;font-size:.82rem">${err}</p>` : ''}
          ${!canConnect ? '<p class="muted" style="margin:6px 0 0;font-size:.82rem">Non configuré côté NoviaAI pour le moment.</p>' : ''}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${connected
            ? `<button type="button" class="btn btn-ghost btn-sm cal-disconnect" data-provider="${provider}">Déconnecter</button>`
            : `<button type="button" class="btn btn-primary btn-sm cal-connect" data-provider="${provider}" ${canConnect ? '' : 'disabled'}>Connecter</button>`}
        </div>
      </div>`;
  }

  function render(connections) {
    const box = $('calendarProviders');
    if (!box || !connections) return;
    const cfg = connections.configured || {};
    box.innerHTML = ['google', 'microsoft']
      .map((p) => renderProvider(p, connections[p], cfg[p]))
      .join('');
    box.querySelectorAll('.cal-connect').forEach((btn) => {
      btn.addEventListener('click', () => connect(btn.dataset.provider, btn));
    });
    box.querySelectorAll('.cal-disconnect').forEach((btn) => {
      btn.addEventListener('click', () => disconnect(btn.dataset.provider, btn));
    });
  }

  function flash(ok, msg) {
    const okEl = $('calendarOk');
    const errEl = $('calendarErr');
    if (okEl) { okEl.hidden = !ok; if (ok) okEl.textContent = msg; }
    if (errEl) { errEl.hidden = ok; if (!ok) errEl.textContent = msg; }
  }

  async function load() {
    const data = await NoviaApp.api('api-calendar', { method: 'GET' });
    render(data.connections);
  }

  async function connect(provider, btn) {
    try {
      if (btn) btn.disabled = true;
      const data = await NoviaApp.api('api-calendar', {
        method: 'POST',
        body: JSON.stringify({ action: 'connect', provider }),
      });
      if (data.url) location.href = data.url;
    } catch (e) {
      flash(false, e.message || 'Connexion impossible');
      if (btn) btn.disabled = false;
    }
  }

  async function disconnect(provider, btn) {
    if (!confirm('Déconnecter ' + LABELS[provider] + ' ? L\'agent ne verra plus ces disponibilités.')) return;
    try {
      if (btn) btn.disabled = true;
      const data = await NoviaApp.api('api-calendar', {
        method: 'POST',
        body: JSON.stringify({ action: 'disconnect', provider }),
      });
      render(data.connections);
      flash(true, LABELS[provider] + ' déconnecté');
    } catch (e) {
      flash(false, e.message || 'Déconnexion impossible');
      if (btn) btn.disabled = false;
    }
  }

  function consumeQuery() {
    const q = new URLSearchParams(location.search);
    const cal = q.get('calendar');
    if (!cal) return;
    if (cal === 'ok') flash(true, 'Calendrier connecté');
    else if (q.get('reason') === 'denied') flash(false, 'Autorisation refusée');
    else flash(false, 'La connexion du calendrier a échoué. Réessayez.');
    q.delete('calendar');
    q.delete('provider');
    q.delete('reason');
    const qs = q.toString();
    history.replaceState({}, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }

  async function init() {
    if (!$('calendarProviders') || !window.NoviaApp) return;
    consumeQuery();
    const demo = new URLSearchParams(location.search).get('demo') === '1'
      || sessionStorage.getItem('novia_demo') === '1';
    if (demo) {
      render({
        google: { connected: false },
        microsoft: { connected: false },
        configured: { google: true, microsoft: true },
      });
      return;
    }
    try {
      await NoviaApp.requireAuth();
      await load();
    } catch (e) {
      flash(false, e.message || 'Impossible de charger le calendrier');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
