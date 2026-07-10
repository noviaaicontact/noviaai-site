/**
 * Assistant d'installation NoviaAI — instructions par type de ligne et fournisseur.
 * Détection appel manqué : renvoi fournisseur → Twilio → SMS immédiat.
 */
window.NoviaInstallGuide = {
  lineTypes: [
    { id: 'mobile', label: 'Cellulaire', icon: '📱', desc: '581, 438, 514 mobile…' },
    { id: 'landline', label: 'Ligne fixe', icon: '☎️', desc: '418, 450 au bureau ou commerce' },
    { id: 'voip', label: 'Téléphonie IP / VoIP', icon: '🖥️', desc: 'RingCentral, Ooma, système bureau…' },
  ],

  providers: {
    mobile: [
      { id: 'bell', label: 'Bell / Bell MTS' },
      { id: 'videotron', label: 'Vidéotron' },
      { id: 'rogers', label: 'Rogers / Fido / Chatr' },
      { id: 'telus', label: 'TELUS / Koodo' },
      { id: 'fizz', label: 'Fizz / Public Mobile' },
      { id: 'other_mobile', label: 'Autre cellulaire' },
    ],
    landline: [
      { id: 'bell', label: 'Bell résidentiel / affaires' },
      { id: 'videotron', label: 'Vidéotron fixe' },
      { id: 'other_landline', label: 'Autre fixe' },
    ],
    voip: [
      { id: 'ringcentral', label: 'RingCentral' },
      { id: 'ooma', label: 'Ooma' },
      { id: 'vonage', label: 'Vonage' },
      { id: 'other_voip', label: 'Autre VoIP / PBX' },
    ],
  },

  forwardModes: [
    {
      id: 'no_answer',
      label: 'Si pas de réponse (recommandé)',
      desc: 'Votre téléphone sonne d\'abord. NoviaAI n\'intervient que si vous ne répondez pas.',
      recommended: true,
    },
    {
      id: 'always',
      label: 'Toujours renvoyer',
      desc: 'Tous les appels vont direct à NoviaAI. SMS immédiat à chaque appel — votre cellulaire ne sonne pas.',
    },
  ],

  getInstructions(lineType, providerId, forwardMode, twilioNumber) {
    const num = twilioNumber || 'NUMÉRO_NOVIAAI';
    const dial = num.replace(/\D/g, '');
    const e164 = dial.length === 10 ? `+1${dial}` : num;
    const key = `${lineType}:${providerId}:${forwardMode}`;
    const base = INSTRUCTIONS[key] || INSTRUCTIONS[`${lineType}:other_${lineType === 'mobile' ? 'mobile' : lineType === 'landline' ? 'landline' : 'voip'}:${forwardMode}`]
      || INSTRUCTIONS[`${lineType}:other_mobile:no_answer`];
    return {
      ...base,
      steps: (base.steps || []).map((s) => s.replace(/\{\{NUM\}\}/g, num).replace(/\{\{E164\}\}/g, e164).replace(/\{\{MMI\}\}/g, base.mmi ? base.mmi.replace(/\{\{NUM\}\}/g, dial.length === 10 ? `1${dial}` : dial) : '')),
      mmi: base.mmi ? base.mmi.replace(/\{\{NUM\}\}/g, dial.length === 10 ? `1${dial}` : dial) : null,
      providerTip: PROVIDER_TIPS[providerId] || PROVIDER_TIPS.other_mobile,
    };
  },

  getProviderTip(providerId) {
    return PROVIDER_TIPS[providerId] || PROVIDER_TIPS.other_mobile;
  },
};

const PROVIDER_TIPS = {
  bell: {
    label: 'Bell',
    support: '1-800-667-0123',
    iphone: 'Ne pas activer « Renvoi d\'appel » dans Réglages iPhone — c\'est un renvoi permanent. Appelez Bell ou utilisez Android.',
    android: 'Téléphone → Paramètres → Renvoi d\'appel → Si non répondu.',
    callProvider: true,
    note: 'Sur iPhone Bell, le code MMI peut ne pas fonctionner — appelez le fournisseur.',
  },
  videotron: {
    label: 'Vidéotron',
    support: '1-877-380-2611',
    iphone: 'Ne pas activer le toggle « Renvoi d\'appel » dans Réglages iPhone — renvoi permanent. Appelez Vidéotron ou utilisez Android.',
    android: 'Paramètres → Renvoi d\'appel → Transférer si non répondu.',
    callProvider: true,
    note: 'Comme Bell : iPhone seul = souvent appel au fournisseur requis.',
  },
  rogers: {
    label: 'Rogers / Fido',
    support: '611 (Rogers) · soutien Fido en ligne',
    iphone: 'Essayez d\'abord le code MMI. Si messagerie vocale active (Fido), désactivez-la — elle bloque le renvoi.',
    android: 'Paramètres → Renvoi d\'appel → Si non répondu.',
    callProvider: false,
    note: 'Rogers/Fido : le code *61* fonctionne souvent sans appeler le fournisseur.',
  },
  telus: {
    label: 'TELUS / Koodo',
    support: '1-866-558-2273',
    iphone: 'Réglages → Téléphone → Renvoi d\'appel → Renvoi si non répondu — fonctionne en général sans appeler TELUS.',
    android: 'Paramètres → Appels → Renvoi → Si non répondu.',
    callProvider: false,
    note: 'TELUS/Koodo + iPhone : les Réglages suffisent la plupart du temps.',
  },
  fizz: {
    label: 'Fizz / Public Mobile',
    support: 'Clavardage Fizz · soutien Public Mobile',
    iphone: 'Souvent bloqué (VoLTE). Essayez le code MMI, sinon contactez le soutien ou passez au nouveau numéro NoviaAI.',
    android: 'Même limitation VoLTE possible — code MMI ou soutien.',
    callProvider: true,
    note: 'Le plus difficile — si ça bloque, recommandez le nouveau numéro NoviaAI (zéro config).',
  },
  other_mobile: {
    label: 'Autre',
    support: 'Service à la clientèle de votre opérateur',
    iphone: 'Cherchez « Renvoi si non répondu » dans Réglages → Téléphone, ou appelez votre fournisseur.',
    android: 'Paramètres → Renvoi d\'appel → Si non répondu.',
    callProvider: true,
    note: 'En cas de doute, appelez votre fournisseur avec le numéro NoviaAI.',
  },
};

const INSTRUCTIONS = {
  'mobile:bell:no_answer': {
    title: 'Bell Mobilité — renvoi si pas de réponse',
    difficulty: 'Moyen',
    extra: 'IMPORTANT iPhone : le bouton « Renvoi d\'appel » dans Réglages renvoie TOUS les appels (votre téléphone ne sonnera plus). Utilisez le code ci-dessous à la place. VoLTE requis. Frais de renvoi ~0,05 $/min.',
    steps: [
      'D\'abord, désactivez un renvoi permanent si actif : composez #21# puis Appeler.',
      'Ensuite, activez le renvoi SI PAS DE RÉPONSE : composez {{MMI}} puis Appeler (méthode recommandée).',
      'Ne pas utiliser Réglages → Téléphone → Renvoi d\'appel ON (c\'est un renvoi permanent sur iPhone Bell).',
      'Android Samsung : Téléphone → ⋮ → Paramètres → Renvoi d\'appel → « Si non répondu » uniquement → {{NUM}}.',
      'Test : appelez votre numéro depuis un autre téléphone — votre cell doit sonner. Ne répondez pas → SMS en ~30 sec.',
    ],
    mmi: '*61*{{NUM}}#',
    fallback: 'MonBell (monbell.bell.ca) → Mon mobile → Renvoi sur non-réponse (pas renvoi permanent).',
  },
  'mobile:bell:always': {
    title: 'Bell Mobilité — renvoi permanent',
    difficulty: 'Facile',
    extra: 'Tous les appels sont transférés. Votre cellulaire ne sonne plus directement.',
    steps: [
      'iPhone : Réglages → Apps → Téléphone → Renvoi d\'appel → activer → « Renvoyer vers » {{NUM}}.',
      'Android : Téléphone → Paramètres → Renvoi d\'appel → « Toujours renvoyer » → {{NUM}}.',
      'Alternative : composez {{MMI}} puis appuyez sur Appeler.',
    ],
    mmi: '*21*{{NUM}}#',
  },
  'mobile:videotron:no_answer': {
    title: 'Vidéotron — renvoi si pas de réponse',
    difficulty: 'Moyen',
    extra: 'IMPORTANT iPhone : activer « Renvoi d\'appel » dans Réglages = renvoi permanent (le téléphone ne sonne plus). Utilisez le code {{MMI}} à la place. VoLTE requis.',
    steps: [
      'D\'abord, coupez le renvoi permanent : composez #21# puis Appeler.',
      'Activez le renvoi si pas de réponse : composez {{MMI}} puis Appeler.',
      'Ne pas activer le toggle « Renvoi d\'appel » dans Réglages iPhone (renvoi permanent).',
      'Android : Paramètres → Renvoi d\'appel → « Transférer si non répondu » → {{NUM}}.',
      'Test : votre cell doit sonner quand on vous appelle. SMS seulement si vous ne répondez pas.',
    ],
    mmi: '*61*{{NUM}}#',
    fallback: 'videotron.com → Mon mobile → Renvoi sur non-réponse.',
  },
  'mobile:videotron:always': {
    title: 'Vidéotron — renvoi permanent',
    difficulty: 'Facile',
    steps: [
      'Réglages → Téléphone → Renvoi d\'appel → activer → {{NUM}}.',
      'Ou Android : « Toujours renvoyer » → {{NUM}} → Activer.',
    ],
    mmi: '*21*{{NUM}}#',
  },
  'mobile:telus:no_answer': {
    title: 'TELUS / Koodo — renvoi si pas de réponse',
    difficulty: 'Moyen',
    steps: [
      'iPhone : Réglages → Téléphone → Renvoi d\'appel → « Renvoi si non répondu » → {{NUM}}.',
      'Android : Paramètres → Appels → Renvoi d\'appels → Si non répondu → {{NUM}}.',
      'Code alternatif : {{MMI}} (composez et appelez).',
    ],
    mmi: '*61*{{NUM}}#',
    fallback: 'Mon TELUS (telus.com) → Mon compte → Options cellulaires.',
  },
  'mobile:telus:always': {
    title: 'TELUS / Koodo — renvoi permanent',
    steps: ['Réglages → Renvoi d\'appel → {{NUM}}.', 'Ou composez {{MMI}}.'],
    mmi: '*21*{{NUM}}#',
  },
  'mobile:rogers:no_answer': {
    title: 'Rogers / Fido — renvoi si pas de réponse',
    difficulty: 'Moyen',
    extra: 'Fido : le renvoi conditionnel ne fonctionne que si la messagerie vocale est désactivée.',
    steps: [
      'D\'abord : composez #21# puis Appeler (couper un renvoi permanent).',
      'Activez le renvoi si pas de réponse : composez {{MMI}} puis Appeler.',
      'Android : Paramètres → Renvoi d\'appel → Si non répondu → {{NUM}}.',
      'Test : votre cell doit sonner. SMS seulement si vous ne répondez pas.',
    ],
    mmi: '*61*{{NUM}}#',
    fallback: 'Rogers : rogers.com → Soutien. Fido : désactiver la messagerie vocale si le renvoi ne s\'active pas.',
  },
  'mobile:rogers:always': {
    title: 'Rogers / Fido — renvoi permanent',
    steps: ['Composez {{MMI}} puis Appeler.', 'Ou Réglages → Renvoi d\'appel → Toujours → {{NUM}}.'],
    mmi: '*21*{{NUM}}#',
  },
  'mobile:fizz:no_answer': {
    title: 'Fizz / Public Mobile — renvoi si pas de réponse',
    difficulty: 'Difficile',
    extra: 'Fizz n\'offre pas toujours le renvoi dans les réglages. Essayez le code MMI ou passez par « Toujours renvoyer ».',
    steps: [
      'Essayez de composer {{MMI}} puis Appeler (30 sec de sonnerie avant renvoi).',
      'Si échec : Réglages → Téléphone → Renvoi d\'appel (si disponible).',
      'Sinon : contactez le soutien Fizz ou utilisez le numéro NoviaAI directement sur Google (option sans renvoi).',
    ],
    mmi: '*61*{{NUM}}#',
  },
  'mobile:fizz:always': {
    title: 'Fizz — renvoi permanent',
    steps: ['Composez {{MMI}} et appelez.', 'Confirmez avec un appel test.'],
    mmi: '*21*{{NUM}}#',
  },
  'mobile:other_mobile:no_answer': {
    title: 'Cellulaire — renvoi si pas de réponse',
    difficulty: 'Variable',
    extra: 'Les menus varient selon marque et fournisseur. Essayez dans l\'ordre : réglages téléphone, code MMI, portail client.',
    steps: [
      'Cherchez « Renvoi d\'appel », « Call forwarding » ou « Transfert d\'appel » dans Réglages → Téléphone.',
      'Activez « Si non répondu » / « No answer » et entrez {{NUM}}.',
      'Code universel GSM (peut fonctionner) : composez {{MMI}} puis Appeler.',
      'Désactiver plus tard : composez #61# (si non répondu) ou #21# (si permanent).',
    ],
    mmi: '*61*{{NUM}}#',
  },
  'mobile:other_mobile:always': {
    title: 'Cellulaire — renvoi permanent',
    steps: ['Réglages → Renvoi d\'appel → Toujours → {{NUM}}.', 'Ou composez {{MMI}}.'],
    mmi: '*21*{{NUM}}#',
  },
  'landline:bell:no_answer': {
    title: 'Bell fixe — renvoi si pas de réponse',
    difficulty: 'Moyen',
    extra: 'Option « Renvoi sur non-réponse » à activer chez Bell si pas déjà incluse.',
    steps: [
      'Composez *92 sur votre fixe, puis {{NUM}}, attendez confirmation.',
      'Pour renvoi permanent sur fixe Bell : *72 puis {{NUM}}.',
      'Désactiver : *93 (non-réponse) ou *73 (permanent).',
    ],
    mmi: '*92 puis {{NUM}}',
    fallback: 'Bell.ca → Téléphonie → Options → Renvoi sur non-réponse.',
  },
  'landline:bell:always': {
    title: 'Bell fixe — renvoi permanent (*72)',
    difficulty: 'Facile',
    steps: [
      'Décrochez et composez *72.',
      'Entendez la tonalité, composez {{NUM}}.',
      'Restez en ligne 5 sec si quelqu\'un répond ; sinon raccrochez après 3 sonneries.',
      'Désactiver : composez *73.',
    ],
  },
  'landline:videotron:no_answer': {
    title: 'Vidéotron fixe — renvoi si pas de réponse',
    steps: [
      'Contactez Vidéotron pour activer « Renvoi sur non-réponse » vers {{NUM}}.',
      'Ou utilisez le portail Espace client → Téléphonie résidentielle.',
    ],
    fallback: 'Soutien Vidéotron requis pour certains forfaits fixe.',
  },
  'landline:videotron:always': {
    title: 'Vidéotron fixe — renvoi permanent',
    steps: ['Espace client videotron.com → Téléphonie → Renvoi d\'appel → {{NUM}}.'],
  },
  'landline:other_landline:no_answer': {
    title: 'Ligne fixe — renvoi si pas de réponse',
    steps: [
      'Consultez la doc de votre fournisseur (souvent *92 ou option dans le portail).',
      'Destination : {{NUM}}.',
      'Bell utilise *92 ; d\'autres fournisseurs : appelez le soutien technique.',
    ],
  },
  'landline:other_landline:always': {
    title: 'Ligne fixe — renvoi permanent',
    steps: ['Essayez *72 puis {{NUM}} (standard Bell/Canada).', 'Sinon : portail ou soutien du fournisseur.'],
  },
  'voip:ringcentral:no_answer': {
    title: 'RingCentral — renvoi si pas de réponse',
    difficulty: 'Facile',
    extra: 'Configuration dans le portail admin, pas sur le téléphone.',
    steps: [
      'Connectez-vous à admin.ringcentral.com.',
      'Téléphone → Numéros → votre numéro → Règles de gestion des appels.',
      'Ajoutez « Renvoyer vers » → Numéro externe → {{NUM}} → condition « Pas de réponse » (15–20 sec).',
      'Enregistrez et testez.',
    ],
  },
  'voip:ringcentral:always': {
    title: 'RingCentral — renvoi permanent',
    steps: [
      'admin.ringcentral.com → votre numéro → Règles → Renvoi inconditionnel → {{NUM}}.',
    ],
  },
  'voip:ooma:no_answer': {
    title: 'Ooma — renvoi si pas de réponse',
    steps: [
      'my.ooma.com → Preferences → Call Forward → « When device is offline or Do Not Disturb » ou règle No Answer.',
      'Numéro externe : {{NUM}}.',
    ],
  },
  'voip:ooma:always': {
    title: 'Ooma — renvoi permanent',
    steps: ['my.ooma.com → Call Forward → Always ring another number → {{NUM}}.'],
  },
  'voip:vonage:no_answer': {
    title: 'Vonage — renvoi si pas de réponse',
    steps: [
      'Portail Vonage Business → Features → Call Forwarding → No Answer → {{NUM}}.',
    ],
  },
  'voip:vonage:always': {
    title: 'Vonage — renvoi permanent',
    steps: ['Portail Vonage → Call Forwarding → Always → {{NUM}}.'],
  },
  'voip:other_voip:no_answer': {
    title: 'VoIP / PBX — renvoi si pas de réponse',
    difficulty: 'Variable',
    extra: 'Cherchez « Call Forward No Answer », « Failover » ou « External number » dans l\'admin de votre système.',
    steps: [
      'Ouvrez le portail admin de votre téléphonie IP (3CX, FreePBX, etc.).',
      'Trouvez Renvoi / Forward → condition « No answer » ou délai 15–20 sec.',
      'Destination externe : {{NUM}} (format +1XXXXXXXXXX).',
      'Si PBX local : routez le DID vers une règle de renvoi externe.',
    ],
  },
  'voip:other_voip:always': {
    title: 'VoIP — renvoi permanent',
    steps: ['Admin VoIP → Renvoi inconditionnel → {{NUM}}.', 'Testez avec un appel externe.'],
  },
};
