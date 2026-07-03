const PLANS = {
  starter: {
    name: 'Essentiel',
    price: 149,
    priceEnv: 'STRIPE_PRICE_STARTER',
    tagline: '1 commerce · ligne auto · SMS IA',
  },
  pro: {
    name: 'Pro',
    price: 299,
    priceEnv: 'STRIPE_PRICE_PRO',
    tagline: 'Illimité · alertes leads · analytics',
    featured: true,
  },
  business: {
    name: 'Entreprise',
    price: 499,
    priceEnv: 'STRIPE_PRICE_BUSINESS',
    tagline: 'Multi-numéros · priorité · white-label',
  },
};
