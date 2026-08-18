#!/usr/bin/env node
// Vérifie que classifyIntent repère les vraies demandes commerciales
// sans transformer le bavardage en alerte pour le propriétaire.
//
//   npm run test:leads

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { classifyIntent } = require('../lib/agent-tools.js');

const CAS = [
  // [message client, réponse IA, workflow, type attendu ('rien' = aucune alerte)]
  ['Combien ça coûte pour une piscine creusée?', '', 'appointment', 'appointment'],
  ["C'est quoi vos prix pour un spa?", '', 'appointment', 'appointment'],
  ["J'aimerais avoir une soumission", '', 'appointment', 'appointment'],
  ['Pouvez-vous me faire une estimation?', '', 'appointment', 'appointment'],
  ["Quel est le coût d'installation?", '', 'appointment', 'appointment'],
  ['Je veux acheter un spa', '', 'appointment', 'appointment'],
  ['Avez-vous des spas en inventaire?', '', 'appointment', 'appointment'],
  ['Je veux un rdv', '', 'appointment', 'appointment'],
  ['Mon chauffe-eau de spa ne fonctionne plus', '', 'appointment', 'appointment'],
  ['Ma pompe fait un bruit bizarre', '', 'appointment', 'appointment'],
  ['Ma toilette coule, combien pour la réparer?', '', 'field_service', 'lead'],

  // Bavardage : aucune alerte ne doit partir.
  ['Allo', "Bonjour! Comment puis-je vous aider aujourd'hui?", 'appointment', 'rien'],
  ['Salut', "Bonjour! Comment puis-je vous aider aujourd'hui?", 'appointment', 'rien'],
  ['Merci!', 'Avec plaisir!', 'appointment', 'rien'],
  ['Pourquoi vous choisir', 'Nous offrons une vaste sélection de spas.', 'appointment', 'rien'],

  // La réponse de l'agent ne doit pas décider à la place du client :
  // « un technicien peut vous rappeler » ne veut pas dire que le client
  // a demandé un transfert humain.
  ['Bonjour', 'Je note votre demande, un technicien peut vous rappeler.', 'appointment', 'rien'],

  // Vraies demandes de transfert humain.
  ['Je veux parler à une personne', '', 'appointment', 'human_transfer'],
  ['Pouvez-vous me rappeler svp?', '', 'appointment', 'human_transfer'],
  ["Je suis pas content, personne m'a rappelé", '', 'field_service', 'human_transfer'],
  ['C’est inacceptable, je vais laisser un avis', '', 'field_service', 'human_transfer'],
];

let echecs = 0;

for (const [message, aiReply, workflow, attendu] of CAS) {
  const intent = classifyIntent(message, aiReply, workflow);
  const obtenu = intent ? intent.type : 'rien';
  if (obtenu === attendu) {
    console.log(`  ok    ${obtenu.padEnd(15)} « ${message} »`);
  } else {
    echecs += 1;
    console.log(`  ECHEC ${obtenu.padEnd(15)} « ${message} » (attendu : ${attendu})`);
  }
}

if (echecs) {
  console.error(`\n${echecs} cas en échec sur ${CAS.length}.`);
  process.exit(1);
}
console.log(`\n${CAS.length} cas vérifiés, tout passe.`);
