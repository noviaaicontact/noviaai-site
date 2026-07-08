(function () {
  const script = document.currentScript;
  if (!script) return;

  const widgetId = script.getAttribute('data-widget-id');
  if (!widgetId) return;

  const base = script.src.replace(/\/widget\.js(\?.*)?$/, '');
  const apiConfig = base + '/.netlify/functions/api-widget-config?id=' + encodeURIComponent(widgetId);
  const apiChat = base + '/.netlify/functions/api-widget-chat';

  const SESSION_KEY = 'novia_widget_session_' + widgetId;

  function sessionId() {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = 'w_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  }

  function el(tag, cls, html) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  const style = document.createElement('style');
  style.textContent = `
    .novia-widget-root { font-family: Inter, system-ui, sans-serif; z-index: 2147483000; }
    .novia-widget-btn {
      position: fixed; bottom: 20px; right: 20px; width: 56px; height: 56px; border-radius: 50%;
      border: none; cursor: pointer; background: #13325b; color: #c8f135; font-size: 24px;
      box-shadow: 0 8px 24px rgba(19,50,91,.35); transition: transform .15s;
    }
    .novia-widget-btn:hover { transform: scale(1.05); }
    .novia-widget-panel {
      position: fixed; bottom: 88px; right: 20px; width: min(360px, calc(100vw - 32px)); height: 480px;
      background: #fff; border-radius: 16px; box-shadow: 0 16px 48px rgba(15,23,42,.18);
      display: none; flex-direction: column; overflow: hidden; border: 1px solid #e2e8f0;
    }
    .novia-widget-panel.open { display: flex; }
    .novia-widget-head {
      background: linear-gradient(135deg, #13325b, #1c4a86); color: #fff; padding: 14px 16px;
    }
    .novia-widget-head strong { display: block; font-size: .95rem; }
    .novia-widget-head span { font-size: .78rem; opacity: .85; }
    .novia-widget-msgs { flex: 1; overflow-y: auto; padding: 12px; background: #f8fafc; }
    .novia-widget-msg { max-width: 88%; margin-bottom: 10px; padding: 10px 12px; border-radius: 12px; font-size: .9rem; line-height: 1.45; }
    .novia-widget-msg.in { background: #fff; border: 1px solid #e2e8f0; margin-right: auto; }
    .novia-widget-msg.out { background: #13325b; color: #fff; margin-left: auto; }
    .novia-widget-foot { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e2e8f0; background: #fff; }
    .novia-widget-foot input {
      flex: 1; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; font-size: .9rem;
    }
    .novia-widget-foot button {
      border: none; border-radius: 10px; padding: 10px 14px; background: #c8f135; color: #13325b;
      font-weight: 700; cursor: pointer;
    }
    .novia-widget-sms {
      font-size: .75rem; text-align: center; padding: 6px 10px 10px; background: #fff;
      border-top: 1px dashed #e2e8f0;
    }
    .novia-widget-sms a { color: #1c4a86; font-weight: 600; text-decoration: none; }
  `;
  document.head.appendChild(style);

  const root = el('div', 'novia-widget-root');
  const btn = el('button', 'novia-widget-btn', '💬');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Ouvrir le chat');
  const panel = el('div', 'novia-widget-panel');
  const head = el('div', 'novia-widget-head');
  const msgs = el('div', 'novia-widget-msgs');
  const foot = el('form', 'novia-widget-foot');
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Écrivez votre question…';
  input.maxLength = 800;
  input.autocomplete = 'off';
  const sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.textContent = 'Envoyer';
  foot.appendChild(input);
  foot.appendChild(sendBtn);
  const smsBar = el('div', 'novia-widget-sms');
  panel.appendChild(head);
  panel.appendChild(msgs);
  panel.appendChild(foot);
  panel.appendChild(smsBar);
  root.appendChild(btn);
  root.appendChild(panel);
  document.body.appendChild(root);

  let config = null;
  let open = false;

  function toggle() {
    open = !open;
    panel.classList.toggle('open', open);
    if (open && config && !msgs.children.length) {
      addMsg('out', config.welcome_message);
    }
    if (open) input.focus();
  }

  function addMsg(dir, text) {
    const bubble = el('div', 'novia-widget-msg ' + dir);
    bubble.textContent = text;
    msgs.appendChild(bubble);
    msgs.scrollTop = msgs.scrollHeight;
  }

  btn.onclick = toggle;

  foot.onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMsg('in', text);
    sendBtn.disabled = true;
    try {
      const res = await fetch(apiChat, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widgetId, sessionId: sessionId(), message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      addMsg('out', data.reply || '…');
    } catch (err) {
      addMsg('out', 'Désolé, réessayez dans un instant.');
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  };

  fetch(apiConfig)
    .then((r) => r.json())
    .then((data) => {
      if (!data.business_name) return;
      config = data;
      head.innerHTML = '<strong>' + escapeHtml(data.business_name) + '</strong><span>Assistante ' + escapeHtml(data.agent_name || 'IA') + ' · en ligne</span>';
      if (data.sms_href) {
        smsBar.innerHTML = 'Sur mobile? <a href="' + escapeHtml(data.sms_href) + '">Continuer par texto ' + escapeHtml(data.phone_display || '') + '</a>';
      } else {
        smsBar.hidden = true;
      }
    })
    .catch(() => {
      head.innerHTML = '<strong>Chat NoviaAI</strong><span>Chargement…</span>';
    });

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }
})();
