const twilio = require('twilio');

function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Twilio non configuré');
  return twilio(sid, token);
}

function baseUrl() {
  const u = process.env.PUBLIC_BASE_URL;
  if (!u) throw new Error('PUBLIC_BASE_URL requis pour configurer les webhooks');
  return u.replace(/\/$/, '');
}

/** Normalise une ville pour matching (sans accents, minuscules). */
function normalizePlace(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Profils géo Québec : chaque profil définit localités Twilio acceptées,
 * indicatifs préférés, et localités à REFUSER (ex. Alma pour un commerce à Québec).
 */
const CITY_PROFILES = [
  {
    id: 'quebec',
    match: (c) => /\b(quebec|levis|sainte? foy|sainte-foy|beauport|charlesbourg|loretteville|wendake|val-?belair|val belair|shannon|stoneham|lac beauport|saint-?augustin|cap-?rouge)\b/.test(c)
      || c === 'qc',
    localities: ['Lévis', 'Levis', 'Quebec'],
    areaCodes: ['418', '581'],
    rejectLocalities: [
      'alma', 'saguenay', 'chicoutimi', 'jonquiere', 'jonquière', 'dolbeau',
      'roberval', 'la baie', 'laterriere', 'laterrière',
    ],
  },
  {
    id: 'saguenay',
    match: (c) => /\b(alma|saguenay|chicoutimi|jonquiere|jonquière|la baie|dolbeau|roberval|saint-?felicien|st felicien)\b/.test(c),
    localities: ['Alma', 'Saguenay', 'Chicoutimi', 'Jonquière', 'Jonquiere', 'Dolbeau-Mistassini'],
    areaCodes: ['418', '581'],
    rejectLocalities: [],
  },
  {
    id: 'montreal',
    match: (c) => /\b(montreal|laval|longueuil|brossard|terrebonne|repentigny|boucherville|saint-?leonard|saint-?laurent|verdun|lasalle|outremont|westmount|dollard|pointe-?claire|kirkland|dorval|lachine|anjou|montreal-?nord|riviere-?des-?prairies)\b/.test(c),
    localities: ['Montreal', 'Laval', 'Longueuil', 'Brossard', 'Terrebonne', 'Repentigny'],
    areaCodes: ['514', '438', '450'],
    rejectLocalities: [],
  },
  {
    id: 'rive-sud-450',
    match: (c) => /\b(saint-?hubert|saint-?bruno|chateauguay|chateauguay|saint-?jean|iberville|granby|saint-?hyacinthe|varennes|sainte-?julie)\b/.test(c),
    localities: ['Longueuil', 'Brossard', 'Châteauguay', 'Chateauguay', 'Saint-Jean-sur-Richelieu', 'Granby', 'Saint-Hyacinthe'],
    areaCodes: ['450', '438'],
    rejectLocalities: [],
  },
  {
    id: 'gatineau',
    match: (c) => /\b(gatineau|hull|aylmer|chelsea|buckingham)\b/.test(c),
    localities: ['Gatineau', 'Hull'],
    areaCodes: ['819', '873'],
    rejectLocalities: [],
  },
  {
    id: 'sherbrooke',
    match: (c) => /\b(sherbrooke|magog|lennoxville|rock-?forest)\b/.test(c),
    localities: ['Sherbrooke', 'Magog'],
    areaCodes: ['819', '873'],
    rejectLocalities: [],
  },
  {
    id: 'trois-rivieres',
    match: (c) => /\b(trois-?rivieres|trois rivieres|shawinigan|becancour|bécancour)\b/.test(c),
    localities: ['Trois-Rivières', 'Trois-Rivieres', 'Shawinigan'],
    areaCodes: ['819', '873'],
    rejectLocalities: [],
  },
  {
    id: 'rimouski',
    match: (c) => /\b(rimouski|matane|gaspe|gaspé|baie-?comeau|sept-?iles)\b/.test(c),
    localities: ['Rimouski', 'Matane', 'Gaspé', 'Gaspe', 'Baie-Comeau', 'Sept-Îles', 'Sept-Iles'],
    areaCodes: ['418', '581'],
    rejectLocalities: [],
  },
];

const FALLBACK_AREA_CODES = ['418', '581', '514', '438', '450', '819', '873'];

function resolveCityProfile(tenant) {
  const city = normalizePlace(tenant.city || tenant.dossier?.coordonnees?.ville || '');
  if (city) {
    for (const profile of CITY_PROFILES) {
      if (profile.match(city)) return { profile, city };
    }
  }
  // Indicatif seul : 514/438 → Montréal ; 450 → couronne ; sinon Québec ville
  // (mais on refusera Alma etc. via rejectLocalities du profil Québec)
  const area = String(tenant.area_code || '').replace(/\D/g, '').slice(0, 3);
  if (area === '514' || area === '438') {
    return { profile: CITY_PROFILES.find((p) => p.id === 'montreal'), city: city || 'montreal' };
  }
  if (area === '450') {
    return { profile: CITY_PROFILES.find((p) => p.id === 'rive-sud-450'), city: city || 'longueuil' };
  }
  if (area === '819' || area === '873') {
    return { profile: CITY_PROFILES.find((p) => p.id === 'gatineau'), city: city || 'gatineau' };
  }
  return { profile: CITY_PROFILES.find((p) => p.id === 'quebec'), city: city || 'quebec' };
}

function guessAreaCode(tenant) {
  if (tenant.area_code) return String(tenant.area_code).replace(/\D/g, '').slice(0, 3);
  const pf = (tenant.existing_business_number || tenant.phone_forward || '').replace(/\D/g, '');
  if (pf.length >= 10 && pf.startsWith('1')) return pf.slice(1, 4);
  if (pf.length >= 10) return pf.slice(0, 3);
  const { profile } = resolveCityProfile(tenant);
  if (profile?.areaCodes?.[0]) return profile.areaCodes[0];
  return process.env.TWILIO_DEFAULT_AREA_CODE || '418';
}

function twilioLocalityName(value) {
  const n = normalizePlace(value);
  const map = {
    levis: 'Levis',
    quebec: 'Quebec',
    montreal: 'Montreal',
    laval: 'Laval',
    longueuil: 'Longueuil',
    gatineau: 'Gatineau',
    sherbrooke: 'Sherbrooke',
    alma: 'Alma',
    saguenay: 'Saguenay',
  };
  return map[n] || String(value || '').trim();
}

function localityOf(num) {
  return normalizePlace(num.locality || num.rateCenter || '');
}

function regionOf(num) {
  return normalizePlace(num.region || '');
}

function isRejectedLocality(num, profile) {
  const loc = localityOf(num);
  if (!loc || !profile?.rejectLocalities?.length) return false;
  return profile.rejectLocalities.some((bad) => loc.includes(normalizePlace(bad)));
}

function matchesWantedLocality(num, profile, cityNorm) {
  const loc = localityOf(num);
  if (!loc) return false;
  if (isRejectedLocality(num, profile)) return false;

  const wanted = (profile?.localities || []).map(normalizePlace).filter(Boolean);
  if (wanted.some((w) => loc === w || loc.includes(w) || w.includes(loc))) return true;

  // Ville du tenant apparaît dans la localité Twilio
  if (cityNorm && (loc.includes(cityNorm) || cityNorm.includes(loc))) return true;

  return false;
}

function pickBestNumber(candidates, profile, cityNorm) {
  if (!candidates?.length) return null;
  const pool = candidates.filter((n) => !isRejectedLocality(n, profile));
  if (!pool.length) return null;

  // Ville du commerce d'abord (Lévis ≠ Québec même si les deux sont 418/581).
  if (cityNorm) {
    const cityHit = pool.find((n) => {
      const loc = localityOf(n);
      return loc === cityNorm || loc.includes(cityNorm) || cityNorm.includes(loc);
    });
    if (cityHit) return cityHit;
  }

  const wanted = (profile?.localities || []).map(normalizePlace).filter(Boolean);
  const profileHit = pool.find((n) => {
    const loc = localityOf(n);
    return wanted.some((w) => loc === w || loc.includes(w) || w.includes(loc));
  });
  if (profileHit) return profileHit;

  if (profile?.rejectLocalities?.length) return null;
  return pool[0];
}

async function searchNumbers(client, params) {
  try {
    const clean = { ...params };
    if (clean.areaCode != null) clean.areaCode = parseInt(String(clean.areaCode).replace(/\D/g, ''), 10);
    const nums = await client.availablePhoneNumbers('CA').local.list({
      smsEnabled: true,
      voiceEnabled: true,
      limit: 20,
      ...clean,
    });
    return nums || [];
  } catch (e) {
    console.warn('twilio search', params, e.message);
    return [];
  }
}

/**
 * Cherche un numéro CA dont la localité correspond au commerce.
 * L'indicatif du commerce (ex. 418) est prioritaire sur l'overlay (581),
 * et la ville du tenant (Lévis) passe avant les autres localités du profil.
 */
async function findAvailableNumberForTenant(tenant) {
  const client = getClient();
  const preferredArea = guessAreaCode(tenant);
  const { profile, city } = resolveCityProfile(tenant);
  const cityNorm = normalizePlace(city || tenant.city || '');

  const otherAreas = [
    ...(profile?.areaCodes || []),
    ...FALLBACK_AREA_CODES,
  ].filter((v, i, arr) => v && v !== preferredArea && arr.indexOf(v) === i);

  const cityLabel = twilioLocalityName(tenant.city || city || '');
  const localities = [
    cityLabel,
    ...(profile?.localities || []).map(twilioLocalityName),
  ].filter((v, i, arr) => v && arr.findIndex((x) => normalizePlace(x) === normalizePlace(v)) === i);

  async function searchLocalities(areaCode) {
    for (const locality of localities) {
      const locNorm = normalizePlace(locality);
      const found = await searchNumbers(client, areaCode
        ? { inLocality: locality, areaCode }
        : { inLocality: locality });
      const pick = pickBestNumber(found, profile, locNorm);
      if (pick && (localityOf(pick) === locNorm
        || localityOf(pick).includes(locNorm)
        || locNorm.includes(localityOf(pick)))) {
        console.log('twilio-provision: match locality', {
          locality: pick.locality,
          phone: pick.phoneNumber,
          areaCode: areaCode || null,
          city: tenant.city,
        });
        return pick;
      }
    }
    return null;
  }

  // 1) Indicatif du commerce d'abord (418 avant 581), toutes les villes du profil
  let pick = await searchLocalities(preferredArea);
  if (pick) return pick;

  // 2) Près du vrai numéro d'affaires (pas la ligne NoviaAI déjà assignée)
  const nearRaw = (tenant.phone_forward || tenant.public_phone || tenant.existing_business_number || '')
    .replace(/\D/g, '');
  if (nearRaw.length >= 10) {
    const nearNumber = nearRaw.length === 11 && nearRaw.startsWith('1')
      ? `+${nearRaw}`
      : `+1${nearRaw.slice(-10)}`;
    const near = await searchNumbers(client, { nearNumber, distance: 25 });
    pick = pickBestNumber(near, profile, cityNorm);
    if (pick && String(pick.phoneNumber || '').replace(/\D/g, '').slice(-10).startsWith(preferredArea)) {
      console.log('twilio-provision: match nearNumber', {
        locality: pick.locality,
        phone: pick.phoneNumber,
        nearNumber,
      });
      return pick;
    }
    if (pick && String(pick.phoneNumber || '').replace(/\D/g, '').slice(1, 4) === preferredArea) {
      return pick;
    }
  }

  // 3) Même indicatif, sans filtre de ville (toujours 418 avant 581)
  {
    const found = await searchNumbers(client, { areaCode: preferredArea });
    pick = pickBestNumber(found, profile, cityNorm) || (found || []).find((n) => !isRejectedLocality(n, profile));
    if (pick) {
      console.log('twilio-provision: match preferred area', {
        locality: pick.locality,
        phone: pick.phoneNumber,
        areaCode: preferredArea,
      });
      return pick;
    }
  }

  // 4) Overlay / autres indicatifs (581, etc.) seulement s'il n'y a plus de 418
  for (const areaCode of otherAreas.slice(0, 4)) {
    pick = await searchLocalities(areaCode);
    if (pick) return pick;
    const found = await searchNumbers(client, { areaCode });
    pick = pickBestNumber(found, profile, cityNorm);
    if (pick) {
      console.log('twilio-provision: match overlay area', {
        locality: pick.locality,
        phone: pick.phoneNumber,
        areaCode,
      });
      return pick;
    }
  }

  // 5) Dernier recours : n'importe quel CA non rejeté
  const any = await searchNumbers(client, {});
  const safe = (any || []).find((n) => !isRejectedLocality(n, profile));
  if (safe) return safe;
  if (any?.length) {
    console.warn('twilio-provision: fallback sans filtre localité', {
      locality: any[0].locality,
      city: tenant.city,
    });
    return any[0];
  }

  throw new Error('Aucun numéro disponible au Canada pour cette localité');
}

/** @deprecated utiliser findAvailableNumberForTenant — gardé pour compat */
async function findAvailableNumber(preferredArea) {
  return findAvailableNumberForTenant({ area_code: preferredArea, city: '' });
}

async function configureNumber(sid, friendlyName) {
  const client = getClient();
  const b = baseUrl();
  return client.incomingPhoneNumbers(sid).update({
    smsUrl: `${b}/.netlify/functions/sms`,
    smsMethod: 'POST',
    voiceUrl: `${b}/.netlify/functions/voice`,
    voiceMethod: 'POST',
    friendlyName: (friendlyName || 'NoviaAI Rattrapeur').slice(0, 64),
  });
}

async function purchaseAndConfigure(tenant) {
  const available = await findAvailableNumberForTenant(tenant);
  const client = getClient();
  const localityLabel = available.locality || tenant.city || guessAreaCode(tenant);
  const purchased = await client.incomingPhoneNumbers.create({
    phoneNumber: available.phoneNumber,
    friendlyName: `NoviaAI — ${tenant.business_name} (${localityLabel})`.slice(0, 64),
  });
  await configureNumber(
    purchased.sid,
    `NoviaAI — ${tenant.business_name} (${localityLabel})`,
  );

  const digits = String(available.phoneNumber || '').replace(/\D/g, '');
  const areaCode = digits.length >= 11 ? digits.slice(1, 4) : digits.slice(0, 3);

  return {
    phoneNumber: purchased.phoneNumber,
    sid: purchased.sid,
    areaCode: areaCode || guessAreaCode(tenant),
    locality: available.locality || null,
    region: available.region || null,
  };
}

async function releaseNumber(twilioSid) {
  // Par défaut on libère le numéro à l'annulation (coût Twilio). Opt-out: TWILIO_RELEASE_ON_CANCEL=false
  if (!twilioSid || process.env.TWILIO_RELEASE_ON_CANCEL === 'false') return;
  const client = getClient();
  try {
    await client.incomingPhoneNumbers(twilioSid).remove();
  } catch (e) {
    console.error('release number', e.message);
  }
}

module.exports = {
  purchaseAndConfigure,
  configureNumber,
  releaseNumber,
  guessAreaCode,
  findAvailableNumber,
  findAvailableNumberForTenant,
  resolveCityProfile,
  normalizePlace,
};
