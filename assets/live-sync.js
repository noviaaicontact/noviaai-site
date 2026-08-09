/**
 * Sync en direct du tableau de bord.
 *
 * Deux sessions peuvent travailler sur le même commerce en même temps :
 * le client sur son compte, et un admin NoviaAI en mode assistance. Ce module
 * détecte les changements venus de l'autre session et rafraîchit l'écran.
 *
 * Sondage court plutôt que websocket : les deux sessions passent déjà par les
 * mêmes fonctions Netlify, donc aucune configuration Supabase Realtime n'est
 * requise côté base de données.
 */
(function () {
  const POLL_VISIBLE_MS = 4000;
  const POLL_HIDDEN_MS = 25000;
  const MAX_BACKOFF_MS = 60000;

  let timer = null;
  let started = false;
  let inPoll = false;
  let backoff = 0;

  let tenantStamp = null;
  let inboxStamp = null;
  let opts = {};

  /** Ne jamais écraser un champ que la personne est en train de remplir. */
  function isTyping() {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    if (el.isContentEditable) return true;
    return ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(el.tagName) !== -1;
  }

  function inboxSignature(conversations) {
    return (conversations || [])
      .map((c) => `${c.caller_phone}|${c.last_at || ''}|${c.last_preview || ''}`)
      .join('~');
  }

  function showReloadToast(message, onReload) {
    let el = document.getElementById('liveToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'liveToast';
      el.className = 'live-toast';
      document.body.appendChild(el);
    }
    el.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = message;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Afficher';
    btn.addEventListener('click', () => {
      el.remove();
      onReload();
    });
    el.appendChild(text);
    el.appendChild(btn);
  }

  function dismissToast() {
    document.getElementById('liveToast')?.remove();
  }

  async function pollTenant() {
    inPoll = true;
    let data;
    try {
      data = await NoviaApp.api('api-tenant');
    } finally {
      inPoll = false;
    }
    const fresh = data && data.tenant;
    if (!fresh) return;
    if (tenantStamp === null) {
      tenantStamp = fresh.updated_at || '';
      return;
    }
    if ((fresh.updated_at || '') === tenantStamp) return;

    tenantStamp = fresh.updated_at || '';
    const label = data.assisting
      ? 'Modifié depuis votre autre session.'
      : 'Votre configuration vient d\'être mise à jour.';
    if (isTyping() && opts.onRemoteTenant) {
      showReloadToast(label, () => opts.onRemoteTenant(fresh));
      return;
    }
    dismissToast();
    if (opts.onRemoteTenant) opts.onRemoteTenant(fresh);
  }

  async function pollInbox() {
    if (!opts.onRemoteInbox) return;
    const data = await NoviaApp.api('api-conversations');
    const sig = inboxSignature(data.conversations);
    if (inboxStamp === null) {
      inboxStamp = sig;
      return;
    }
    if (sig === inboxStamp) return;
    inboxStamp = sig;
    opts.onRemoteInbox(data.conversations || []);
  }

  async function tick() {
    try {
      await pollTenant();
      await pollInbox();
      backoff = 0;
    } catch (e) {
      // Réseau instable ou session expirée : on ralentit au lieu de marteler.
      backoff = Math.min(backoff ? backoff * 2 : POLL_VISIBLE_MS, MAX_BACKOFF_MS);
      console.warn('live-sync', e.message || e);
    }
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    if (!started) return;
    const base = document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
    timer = setTimeout(tick, Math.max(base, backoff));
  }

  /** Toute réponse d'API contenant le commerce fait foi : c'est notre référence. */
  window.addEventListener('novia:tenant', (e) => {
    if (inPoll) return;
    const t = e.detail;
    if (t && t.updated_at) tenantStamp = t.updated_at;
  });

  document.addEventListener('visibilitychange', () => {
    if (!started) return;
    if (!document.hidden) {
      backoff = 0;
      clearTimeout(timer);
      timer = setTimeout(tick, 300);
    } else {
      schedule();
    }
  });

  window.NoviaLive = {
    start(options) {
      opts = options || {};
      if (opts.tenant) tenantStamp = opts.tenant.updated_at || null;
      if (started) return;
      started = true;
      schedule();
    },
    stop() {
      started = false;
      clearTimeout(timer);
    },
    /** Force la prochaine lecture inbox à être considérée comme neuve. */
    resetInbox() {
      inboxStamp = null;
    },
  };
})();
