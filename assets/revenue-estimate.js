/**
 * Estimation des revenus récupérables — barème partagé.
 * Chargé par la page /potentiel et par la fonction api-qualification-lead,
 * pour que le chiffre montré au prospect soit celui gardé en base.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NoviaEstimate = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** Médiane retenue pour chaque tranche d'appels manqués par mois. */
  var MISSED_CALLS = {
    '0-5': 3,
    '6-10': 8,
    '11-20': 15,
    '21-50': 35,
    '50+': 60,
  };

  /** Médiane retenue pour chaque tranche de valeur d'un nouveau client ($ CAD). */
  var CLIENT_VALUE = {
    'moins-100': 75,
    '100-250': 175,
    '250-500': 375,
    '500-1000': 750,
    '1000+': 1250,
  };

  /** Volume d'appels reçus — sert à la qualification, pas au calcul. */
  var CALLS_PER_MONTH = ['0-20', '21-50', '51-100', '101-200', '200+'];

  var SECTORS = [
    'esthetique',
    'coiffure',
    'construction',
    'nettoyage',
    'garage',
    'services-pro',
    'autre',
  ];

  var INTENTS = ['oui-absolument', 'oui-en-savoir-plus', 'curieux'];

  /** Part des appels manqués réellement rattrapés — prudent, jamais présenté comme garanti. */
  var RATE = { low: 0.15, mid: 0.25, high: 0.30 };

  /** Arrondi doux : au 10 $ sous 500 $, au 50 $ ensuite — évite les faux chiffres précis. */
  function roundSoft(n) {
    var step = n < 500 ? 10 : 50;
    return Math.round(n / step) * step;
  }

  /**
   * @returns {{monthly:number, low:number, high:number, yearly:number,
   *            missedCalls:number, clientValue:number, ratePct:number, valid:boolean}}
   */
  function estimate(missedCallsKey, clientValueKey) {
    var calls = MISSED_CALLS[missedCallsKey];
    var value = CLIENT_VALUE[clientValueKey];
    if (!calls || !value) {
      return {
        monthly: 0, low: 0, high: 0, yearly: 0,
        missedCalls: 0, clientValue: 0, ratePct: Math.round(RATE.mid * 100),
        valid: false,
      };
    }
    var base = calls * value;
    var monthly = roundSoft(base * RATE.mid);
    return {
      monthly: monthly,
      low: roundSoft(base * RATE.low),
      high: roundSoft(base * RATE.high),
      yearly: monthly * 12,
      missedCalls: calls,
      clientValue: value,
      ratePct: Math.round(RATE.mid * 100),
      valid: true,
    };
  }

  function formatCad(n) {
    // Espace insécable avant le $ et comme séparateur de milliers (usage québécois).
    var digits = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
    return digits + '\u00A0$';
  }

  return {
    MISSED_CALLS: MISSED_CALLS,
    CLIENT_VALUE: CLIENT_VALUE,
    CALLS_PER_MONTH: CALLS_PER_MONTH,
    SECTORS: SECTORS,
    INTENTS: INTENTS,
    RATE: RATE,
    estimate: estimate,
    formatCad: formatCad,
  };
}));
