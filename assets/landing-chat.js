(function () {
  const API = '/.netlify/functions/api-landing-chat';
  const SESSION_KEY = 'novia_landing_chat_history';
  const SUGGESTIONS = [
    'C\'est combien?',
    'Comment ça marche?',
    'Essai gratuit?',
    'Voir la démo',
  ];

  function el(tag, cls, html) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function loadHistory() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveHistory(history) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(history.slice(-12)));
  }

  function linkify(text) {
    return String(text)
      .replace(/</g, '&lt;')
      .replace(/(https?:\/\/[^\s]+|\/[a-z0-9./?=&_-]+)/gi, (url) => {
        const href = url.startsWith('/') ? url : url;
        return `<a href="${href}">${url}</a>`;
      });
  }

  const style = document.createElement('style');
  style.textContent = `
    .novia-landing-chat { font-family: Inter, system-ui, sans-serif; z-index: 2147483000; }
    .novia-landing-chat-btn {
      position: fixed; bottom: 20px; right: 20px; width: 56px; height: 56px; border-radius: 50%;
      border: none; cursor: pointer; background: #13325b; color: #c8f135; font-size: 24px;
      box-shadow: 0 8px 24px rgba(19,50,91,.35); transition: transform .15s;
    }
    .novia-landing-chat-btn:hover { transform: scale(1.05); }
    .novia-landing-chat-panel {
      position: fixed; bottom: 88px; right: 20px; width: min(380px, calc(100vw - 32px)); height: 500px;
      background: #fff; border-radius: 16px; box-shadow: 0 16px 48px rgba(15,23,42,.18);
      display: none; flex-direction: column; overflow: hidden; border: 1px solid #e2e8f0;
    }
    .novia-landing-chat-panel.open { display: flex; }
    .novia-landing-chat-head {
      background: linear-gradient(135deg, #13325b, #1c4a86); color: #fff; padding: 14px 16px;
    }
    .novia-landing-chat-head strong { display: block; font-size: .95rem; }
    .novia-landing-chat-head span { font-size: .78rem; opacity: .85; }
    .novia-landing-chat-msgs { flex: 1; overflow-y: auto; padding: 12px; background: #f8fafc; }
    .novia-landing-chat-msg {
      max-width: 90%; margin-bottom: 10px; padding: 10px 12px; border-radius: 12px;
      font-size: .9rem; line-height: 1.45;
    }
    .novia-landing-chat-msg.in { background: #fff; border: 1px solid #e2e8f0; margin-right: auto; }
    .novia-landing-chat-msg.out { background: #13325b; color: #fff; margin-left: auto; }
    .novia-landing-chat-msg a { color: #c8f135; font-weight: 600; }
    .novia-landing-chat-msg.in a { color: #1c4a86; }
    .novia-landing-chat-chips {
      display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 10px; background: #f8fafc;
    }
    .novia-landing-chat-chips button {
      border: 1px solid #e2e8f0; background: #fff; border-radius: 999px; padding: 6px 12px;
      font-size: .78rem; cursor: pointer; color: #13325b;
    }
    .novia-landing-chat-chips button:hover { border-color: #13325b; }
    .novia-landing-chat-foot {
      display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e2e8f0; background: #fff;
    }
    .novia-landing-chat-foot input {
      flex: 1; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; font-size: .9rem;
    }
    .novia-landing-chat-foot button {
      border: none; border-radius: 10px; padding: 10px 14px; background: #c8f135; color: #13325b;
      font-weight: 700; cursor: pointer;
    }
    .novia-landing-chat-cta {
      font-size: .75rem; text-align: center; padding: 8px 10px 10px; background: #fff;
      border-top: 1px dashed #e2e8f0;
    }
    .novia-landing-chat-cta a { color: #1c4a86; font-weight: 600; text-decoration: none; }
    @media (max-width: 480px) {
      .novia-landing-chat-panel { bottom: 80px; right: 12px; height: min(70vh, 480px); }
      .novia-landing-chat-btn { right: 12px; bottom: 12px; }
    }
  `;
  document.head.appendChild(style);

  const root = el('div', 'novia-landing-chat');
  const btn = el('button', 'novia-landing-chat-btn', '💬');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Poser une question sur NoviaAI');

  const panel = el('div', 'novia-landing-chat-panel');
  const head = el('div', 'novia-landing-chat-head');
  head.innerHTML = '<strong>Léa — NoviaAI</strong><span>Questions sur le produit · Réponse instantanée</span>';

  const msgs = el('div', 'novia-landing-chat-msgs');
  const chips = el('div', 'novia-landing-chat-chips');
  const foot = el('form', 'novia-landing-chat-foot');
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Ex. C\'est combien par mois?';
  input.maxLength = 600;
  input.autocomplete = 'off';
  const sendBtn = el('button', null, 'Envoyer');
  sendBtn.type = 'submit';
  foot.append(input, sendBtn);

  const cta = el('div', 'novia-landing-chat-cta');
  cta.innerHTML = '<a href="/signup.html?plan=pro">Essai gratuit 14 jours →</a>';

  panel.append(head, msgs, chips, foot, cta);
  root.append(btn, panel);
  document.body.appendChild(root);

  let history = loadHistory();
  let open = false;
  let sending = false;

  function renderChips() {
    chips.innerHTML = '';
    SUGGESTIONS.forEach((label) => {
      const b = el('button', null, label);
      b.type = 'button';
      b.onclick = () => sendMessage(label);
      chips.appendChild(b);
    });
  }

  function appendMsg(role, text) {
    const bubble = el('div', 'novia-landing-chat-msg ' + (role === 'user' ? 'out' : 'in'));
    bubble.innerHTML = linkify(text);
    msgs.appendChild(bubble);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function welcomeIfEmpty() {
    if (history.length) {
      history.forEach((m) => appendMsg(m.role === 'user' ? 'user' : 'assistant', m.content));
      return;
    }
    appendMsg('assistant', 'Bonjour! Je suis Léa chez NoviaAI 👋 Posez-moi vos questions sur le prix, l\'essai gratuit ou comment ça marche pour votre commerce.');
  }

  async function sendMessage(text) {
    const message = (text || input.value).trim();
    if (!message || sending) return;
    sending = true;
    input.value = '';
    sendBtn.disabled = true;

    appendMsg('user', message);
    history.push({ role: 'user', content: message });
    saveHistory(history);

    const thinking = el('div', 'novia-landing-chat-msg in', '…');
    msgs.appendChild(thinking);
    msgs.scrollTop = msgs.scrollHeight;

    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: history.slice(0, -1) }),
      });
      const data = await res.json();
      thinking.remove();
      const reply = data.reply || 'Désolée, je n\'ai pas pu répondre. Écrivez-nous à noviaai.contact@gmail.com';
      appendMsg('assistant', reply);
      history.push({ role: 'assistant', content: reply });
      saveHistory(history);
    } catch {
      thinking.remove();
      const fallback = 'Connexion impossible pour le moment. Essayez /signup.html?plan=pro ou noviaai.contact@gmail.com';
      appendMsg('assistant', fallback);
    } finally {
      sending = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  btn.onclick = () => {
    open = !open;
    panel.classList.toggle('open', open);
    if (open) {
      if (!msgs.childElementCount) {
        renderChips();
        welcomeIfEmpty();
      }
      input.focus();
    }
  };

  foot.onsubmit = (e) => {
    e.preventDefault();
    sendMessage();
  };
})();
