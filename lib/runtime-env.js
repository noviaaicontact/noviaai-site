/** Environnement d'exécution (Netlify CONTEXT vs Node local). */

function isProductionEnv() {
  const ctx = String(process.env.CONTEXT || '').toLowerCase();
  if (ctx === 'production') return true;
  if (ctx === 'dev' || ctx === 'development') return false;
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production';
}

module.exports = { isProductionEnv };
