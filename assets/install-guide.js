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
      steps: (base.steps || []).map((s) => s.replace(/\{\{NUM\}\}/g, num).replace(/\{\{E164\}\}/g, e164)),
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
    iphone: 'Appelez Bell — n\'activez pas « Renvoi d\'appel » dans Réglages iPhone (renvoi permanent).',
    android: 'Téléphone → Paramètres → Renvoi d\'appel → Si non répondu → numéro NoviaAI.',
    callProvider: true,
    note: 'iPhone Bell : appelez le fournisseur ou configurez depuis un Android.',
  },
  videotron: {
    label: 'Vidéotron',
    support: '1-877-380-2611',
    iphone: 'Appelez Vidéotron — n\'activez pas le toggle « Renvoi d\'appel » dans Réglages iPhone (renvoi permanent).',
    android: 'Paramètres → Renvoi d\'appel → Transférer si non répondu → numéro NoviaAI.',
    callProvider: true,
    note: 'Comme Bell : iPhone seul = appelez le fournisseur.',
  },
  rogers: {
    label: 'Rogers / Fido',
    support: '611 (Rogers) · soutien Fido en ligne',
    iphone: 'Réglages → Téléphone → Renvoi d\'appel → Si non répondu. Fido : désactivez la messagerie vocale si le renvoi ne s\'active pas.',
    android: 'Paramètres → Renvoi d\'appel → Si non répondu → numéro NoviaAI.',
    callProvider: false,
    note: 'Rogers/Fido : les Réglages du téléphone suffisent en général.',
  },
  telus: {
    label: 'TELUS / Koodo',
    support: '1-866-558-2273',
    iphone: 'Réglages → Téléphone → Renvoi d\'appel → Renvoi si non répondu → numéro NoviaAI.',
    android: 'Paramètres → Appels → Renvoi → Si non répondu → numéro NoviaAI.',
    callProvider: false,
    note: 'TELUS/Koodo : les Réglages iPhone suffisent la plupart du temps.',
  },
  fizz: {
    label: 'Fizz / Public Mobile',
    support: 'Clavardage Fizz · soutien Public Mobile',
    iphone: 'Contactez le soutien — le renvoi conditionnel est souvent limité avec VoLTE.',
    android: 'Réglages → Renvoi d\'appel (si disponible), sinon contactez le soutien.',
    callProvider: true,
    note: 'Souvent difficile — si ça bloque, passez au nouveau numéro NoviaAI (zéro config).',
  },
  other_mobile: {
    label: 'Autre',
    support: 'Service à la clientèle de votre opérateur',
    iphone: 'Réglages → Téléphone → Renvoi si non répondu, ou appelez votre fournisseur.',
    android: 'Paramètres → Renvoi d\'appel → Si non répondu → numéro NoviaAI.',
    callProvider: true,
    note: 'Demandez le renvoi si pas de réponse — pas permanent.',
  },
};

const INSTRUCTIONS = {
  'mobile:bell:no_answer': {
    title: 'Bell Mobilité — renvoi si pas de réponse',
    steps: [
      'Appelez Bell au 1-800-667-0123 et demandez le renvoi si pas de réponse vers {{NUM}}.',
      'Ou Android : Téléphone → Paramètres → Renvoi d\'appel → Si non répondu → {{NUM}}.',
      'MonBell (monbell.bell.ca) : Mon mobile → Renvoi sur non-réponse.',
    ],
    fallback: 'Frais de renvoi possibles (~0,05 $/min).',
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
    steps: [
      'Appelez Vidéotron au 1-877-380-2611 et demandez le renvoi si pas de réponse vers {{NUM}}.',
      'Ou Android : Paramètres → Renvoi d\'appel → Transférer si non répondu → {{NUM}}.',
      'Espace client videotron.com → Mon mobile → Renvoi sur non-réponse.',
    ],
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
    steps: [
      'iPhone : Réglages → Téléphone → Renvoi d\'appel → Renvoi si non répondu → {{NUM}}.',
      'Android : Paramètres → Appels → Renvoi d\'appels → Si non répondu → {{NUM}}.',
      'Sinon : Mon TELUS (telus.com) → Mon compte → Options cellulaires.',
    ],
  },
  'mobile:telus:always': {
    title: 'TELUS / Koodo — renvoi permanent',
    steps: ['Réglages → Renvoi d\'appel → {{NUM}}.', 'Ou composez {{MMI}}.'],
    mmi: '*21*{{NUM}}#',
  },
  'mobile:rogers:no_answer': {
    title: 'Rogers / Fido — renvoi si pas de réponse',
    steps: [
      'iPhone ou Android : Réglages → Renvoi d\'appel → Si non répondu → {{NUM}}.',
      'Fido : désactivez la messagerie vocale si le renvoi ne s\'active pas.',
      'Sinon : appelez le 611 (Rogers) ou le soutien Fido.',
    ],
  },
  'mobile:rogers:always': {
    title: 'Rogers / Fido — renvoi permanent',
    steps: ['Composez {{MMI}} puis Appeler.', 'Ou Réglages → Renvoi d\'appel → Toujours → {{NUM}}.'],
    mmi: '*21*{{NUM}}#',
  },
  'mobile:fizz:no_answer': {
    title: 'Fizz / Public Mobile — renvoi si pas de réponse',
    steps: [
      'Contactez le soutien Fizz ou Public Mobile — demandez le renvoi si pas de réponse vers {{NUM}}.',
      'Réglages → Renvoi d\'appel (si disponible sur votre appareil).',
      'Si ça bloque : passez au nouveau numéro NoviaAI sur Google (option sans renvoi).',
    ],
  },
  'mobile:fizz:always': {
    title: 'Fizz — renvoi permanent',
    steps: ['Composez {{MMI}} et appelez.', 'Confirmez avec un appel test.'],
    mmi: '*21*{{NUM}}#',
  },
  'mobile:other_mobile:no_answer': {
    title: 'Cellulaire — renvoi si pas de réponse',
    steps: [
      'Réglages → Téléphone → Renvoi d\'appel → Si non répondu → {{NUM}}.',
      'Ou appelez votre fournisseur et demandez le renvoi si pas de réponse vers {{NUM}}.',
    ],
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
