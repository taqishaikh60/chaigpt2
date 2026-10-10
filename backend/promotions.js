const cents = value => Math.round((value + Number.EPSILON) * 100);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const positiveInteger = value => Number.isInteger(value) && value > 0;
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const keysAllowed = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));

function validPromotions(data, menu) {
  const rules = data?.application_rules;
  const categories = new Set(menu.items.map(item => item.category));
  const itemIds = new Set(menu.items.map(item => item.id));
  const validCategories = value => Array.isArray(value) && value.length > 0 && value.every(id => categories.has(id));
  return data?.currency === menu.currency && rules?.active_only === true
    && rules.stacking_allowed === false && rules.maximum_promotions_per_order === 1
    && rules.require_all_eligibility_conditions === true && rules.unknown_eligibility_is_ineligible === true
    && Array.isArray(data.promotions)
    && new Set(data.promotions.map(promo => promo?.id)).size === data.promotions.length
    && data.promotions.every(promo => {
      const eligibility = promo?.eligibility;
      const discount = promo?.discount;
      return text(promo?.id) && text(promo.name) && typeof promo.active === 'boolean'
        && keysAllowed(eligibility, ['required_category', 'minimum_category_quantity', 'required_item_id',
          'minimum_item_quantity', 'qualifying_categories', 'minimum_combined_quantity', 'discounted_categories', 'available_items_only'])
        && eligibility.available_items_only === true
        && (eligibility.required_category === undefined || (categories.has(eligibility.required_category) && positiveInteger(eligibility.minimum_category_quantity)))
        && (eligibility.minimum_category_quantity === undefined || categories.has(eligibility.required_category))
        && (eligibility.required_item_id === undefined || (itemIds.has(eligibility.required_item_id) && positiveInteger(eligibility.minimum_item_quantity)))
        && (eligibility.minimum_item_quantity === undefined || itemIds.has(eligibility.required_item_id))
        && (eligibility.qualifying_categories === undefined || (validCategories(eligibility.qualifying_categories) && positiveInteger(eligibility.minimum_combined_quantity)))
        && (eligibility.minimum_combined_quantity === undefined || validCategories(eligibility.qualifying_categories))
        && (eligibility.discounted_categories === undefined || validCategories(eligibility.discounted_categories))
        && keysAllowed(discount, ['type', 'amount', 'percent', 'target', 'maximum_discounted_units', 'maximum_discount', 'unit_selection'])
        && (discount.target === 'eligible_menu_subtotal' ? validCategories(eligibility.discounted_categories) : itemIds.has(discount.target))
        && (discount.type === 'fixed_amount' ? nonnegative(discount.amount)
          : discount.type === 'percentage' && nonnegative(discount.percent) && discount.percent <= 100)
        && (discount.maximum_discounted_units === undefined || positiveInteger(discount.maximum_discounted_units))
        && (discount.maximum_discount === undefined || nonnegative(discount.maximum_discount))
        && (discount.unit_selection === undefined || discount.unit_selection === 'lowest_base_size_price');
    });
}

function eligiblePromotions(order, menu, data) {
  const lines = order.items.map(line => {
    const item = menu.items.find(entry => entry.id === line.itemId);
    const size = item?.sizes.find(entry => entry.name === line.size);
    return { item, size, quantity: line.quantity };
  });
  // Missing facts are never evidence of eligibility.
  if (lines.some(line => !line.item || line.item.available !== true || !line.size
    || !positiveInteger(line.quantity))) return [];
  const quantityWhere = predicate => lines.filter(predicate).reduce((sum, line) => sum + line.quantity, 0);
  return data.promotions.filter(promo => promo.active === true).flatMap(promo => {
    const e = promo.eligibility;
    if (e.required_category !== undefined && quantityWhere(line => line.item.category === e.required_category) < e.minimum_category_quantity) return [];
    if (e.required_item_id !== undefined && quantityWhere(line => line.item.id === e.required_item_id) < e.minimum_item_quantity) return [];
    if (e.qualifying_categories !== undefined && quantityWhere(line => e.qualifying_categories.includes(line.item.category)) < e.minimum_combined_quantity) return [];
    const d = promo.discount;
    const targets = lines.filter(line => d.target === 'eligible_menu_subtotal'
      ? e.discounted_categories.includes(line.item.category) : line.item.id === d.target)
      .sort((a, b) => a.size.price - b.size.price);
    let remaining = d.maximum_discounted_units ?? Infinity;
    let baseCents = 0;
    let units = 0;
    for (const line of targets) {
      const quantity = Math.min(remaining, line.quantity);
      baseCents += cents(line.size.price) * quantity;
      units += quantity;
      remaining -= quantity;
    }
    let discountCents = d.type === 'fixed_amount'
      ? cents(d.amount) * units : Math.floor(baseCents * d.percent / 100 + 0.5 + Number.EPSILON);
    discountCents = Math.min(discountCents, baseCents, d.maximum_discount === undefined ? Infinity : cents(d.maximum_discount));
    return discountCents > 0 ? [{ id: promo.id, name: promo.name, discount: discountCents / 100, status: 'applied_sample' }] : [];
  }).sort((a, b) => b.discount - a.discount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

module.exports = { validPromotions, eligiblePromotions };
