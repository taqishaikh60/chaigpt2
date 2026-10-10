const toCents = value => Math.round((value + Number.EPSILON) * 100);
const validMoney = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
  && Number.isSafeInteger(toCents(value)) && Math.abs(value * 100 - toCents(value)) < 0.000001;

function validPricing(pricing, currency) {
  return pricing && pricing.currency === currency && typeof pricing.is_sample === 'boolean'
    && validMoney(pricing.tax_rate_percent) && pricing.tax_rate_percent <= 100
    && validMoney(pricing.delivery_fee);
}

function priceLine(size, options, quantity) {
  const unitCents = toCents(size.price) + options.reduce((sum, option) => sum + toCents(option.price_delta), 0);
  const lineCents = unitCents * quantity;
  if (!Number.isSafeInteger(unitCents) || !Number.isSafeInteger(lineCents)) throw new Error('Item price exceeds supported precision.');
  return { unitPrice: unitCents / 100, lineTotal: lineCents / 100 };
}

function calculateTotals(items, discount, orderType, pricing) {
  const subtotalCents = items.reduce((sum, line) => sum + toCents(line.lineTotal), 0);
  const discountCents = toCents(discount);
  const discountedCents = subtotalCents - discountCents;
  const taxNumerator = discountedCents * toCents(pricing.tax_rate_percent);
  if (!Number.isSafeInteger(subtotalCents) || !Number.isSafeInteger(discountCents)
    || discountCents < 0 || discountedCents < 0 || !Number.isSafeInteger(taxNumerator + 5000)) {
    throw new Error('Order amounts exceed supported precision.');
  }
  // Tax applies to discounted items including add-ons; delivery fee is not taxed.
  const taxCents = Math.floor((taxNumerator + 5000) / 10000);
  const deliveryCents = orderType === 'delivery' && items.length ? toCents(pricing.delivery_fee) : 0;
  const totalCents = discountedCents + taxCents + deliveryCents;
  if (!Number.isSafeInteger(totalCents)) throw new Error('Order total exceeds supported precision.');
  return {
    subtotal: subtotalCents / 100, discount: discountCents / 100,
    discountedSubtotal: discountedCents / 100, tax: taxCents / 100,
    taxRatePercent: pricing.tax_rate_percent, deliveryFee: deliveryCents / 100,
    total: totalCents / 100,
    totalType: pricing.is_sample ? 'sample_total' : 'configured_total',
  };
}

module.exports = { validMoney, validPricing, priceLine, calculateTotals };
