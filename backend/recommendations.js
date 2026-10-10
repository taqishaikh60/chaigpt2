const DIETARY_FLAGS = ['vegetarian', 'vegan', 'gluten_free'];

function validRecommendationRequest(value) {
  if (typeof value === 'boolean') return true;
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => ['category', 'dietary', 'maxPrice'].includes(key))
    && (value.category === undefined || (typeof value.category === 'string' && value.category.trim().length > 0))
    && (value.dietary === undefined || DIETARY_FLAGS.includes(value.dietary))
    && (value.maxPrice === undefined || (typeof value.maxPrice === 'number'
      && Number.isFinite(value.maxPrice) && value.maxPrice >= 0));
}

function recommendItems(preferences, menu) {
  const filters = preferences === true ? {} : preferences;
  if (!Object.keys(filters).length) {
    const categories = (menu.categories || []).map(category => category.name).join(', ');
    return {
      recommendations: [], needsInput: true,
      reply: `What would you prefer${categories ? `: ${categories}` : ''}? You can also specify a dietary preference or a price limit.`,
    };
  }
  const recommendations = menu.items.filter(item => item.available === true
    && (filters.category === undefined || item.category === filters.category)
    && (filters.dietary === undefined || item.dietary?.[filters.dietary] === true)
    && (filters.maxPrice === undefined || item.price <= filters.maxPrice))
    .slice(0, 2).map(item => ({
      itemId: item.id, name: item.name, price: item.price, currency: menu.currency,
    }));
  const reply = recommendations.length
    ? ['You might like:',
      ...recommendations.map(item => `- ${item.name} — ${item.currency} ${item.price.toFixed(2)}`),
      `${menu.is_sample === true ? 'Sample' : 'Listed'} prices are for the default size, before add-ons, tax, and fees.`,
      ...(filters.dietary ? ['Dietary flags describe base recipes; staff must verify suitability and cross-contact risks.'] : []),
    ].join('\n')
    : 'No available menu items match those preferences.';
  return { recommendations, reply };
}

module.exports = { validRecommendationRequest, recommendItems };
