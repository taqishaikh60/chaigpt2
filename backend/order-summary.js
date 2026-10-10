function summarizeOrder(order, menu) {
  if (!order.items.length) return 'Your current order is empty.';
  const lines = order.items.map(line => {
    const item = menu.items.find(entry => entry.id === line.itemId);
    const options = line.options.map(id => item?.options.find(option => option.id === id)?.name || id);
    const customization = options.length ? `; ${options.join(', ')}` : '';
    return `- ${line.quantity} × ${line.name} (${line.size}${customization})`;
  });
  return [
    'Current draft — not placed:', ...lines,
    `Sample subtotal: ${order.currency} ${(order.subtotal ?? order.total).toFixed(2)} before tax and fees.`,
    ...(order.promotion ? [
      `${order.promotion.name}: −${order.currency} ${order.discount.toFixed(2)}.`,
      `Sample discounted subtotal: ${order.currency} ${order.discountedSubtotal.toFixed(2)} before tax and fees.`,
    ] : []),
    `Tax (${order.taxRatePercent}%): ${order.currency} ${order.tax.toFixed(2)}.`,
    ...(order.orderType === 'delivery' ? [`Delivery fee: ${order.currency} ${order.deliveryFee.toFixed(2)}.`] : []),
    `${order.totalType === 'sample_total' ? 'Sample total' : 'Configured total'}: ${order.currency} ${order.total.toFixed(2)}.`,
  ].join('\n');
}

function buildOrderReview(order, menu) {
  const missingFields = [];
  if (!order.items.length) missingFields.push('items');
  if (!order.orderType) missingFields.push('orderType');
  if (['pickup', 'delivery'].includes(order.orderType) && !order.customer.name) missingFields.push('customer.name');
  if (order.orderType === 'delivery') {
    for (const key of ['phone', 'address']) {
      if (!order.customer[key]) missingFields.push(`customer.${key}`);
    }
    for (const key of ['apartment', 'instructions']) {
      if (order.delivery[key] === null) missingFields.push(`delivery.${key}`);
    }
    if (!order.delivery.addressConfirmed) missingFields.push('delivery.addressConfirmed');
  }
  return {
    status: order.status, confirmed: order.confirmed, placed: false,
    readyForConfirmation: missingFields.length === 0, missingFields,
    items: order.items.map((line, lineIndex) => {
      const item = menu.items.find(entry => entry.id === line.itemId);
      return {
        lineIndex, itemId: line.itemId, name: line.name, quantity: line.quantity,
        size: line.size,
        customizations: line.options.map(id => {
          const option = item?.options.find(entry => entry.id === id);
          return { id, name: option?.name || id, priceDelta: option?.price_delta ?? null };
        }),
        unitPrice: line.unitPrice, lineTotal: line.lineTotal,
      };
    }),
    fulfillment: {
      type: order.orderType, customerName: order.customer.name || null,
      ...(order.orderType === 'pickup' ? { requestedPickupTime: order.pickupTime } : {}),
      ...(order.orderType === 'delivery' ? {
        phone: order.customer.phone || null, address: order.customer.address || null,
        apartment: order.delivery.apartment, instructions: order.delivery.instructions,
        addressConfirmed: order.delivery.addressConfirmed,
      } : {}),
    },
    promotions: order.promotion ? [{ ...order.promotion }] : [],
    totals: {
      currency: order.currency, subtotal: order.subtotal, discount: order.discount,
      discountedSubtotal: order.discountedSubtotal, taxRatePercent: order.taxRatePercent,
      tax: order.tax, deliveryFee: order.deliveryFee, total: order.total, totalType: order.totalType,
    },
  };
}

function formatOrderReview(review) {
  const money = value => `${review.totals.currency} ${value.toFixed(2)}`;
  const fulfillment = review.fulfillment;
  return [
    'Complete draft review — not placed:',
    ...(review.items.length ? review.items.map(line => {
      const options = line.customizations.length ? `; ${line.customizations.map(option => option.name).join(', ')}` : '';
      return `- ${line.quantity} × ${line.name} (${line.size}${options}) — ${money(line.unitPrice)} each; ${money(line.lineTotal)}`;
    }) : ['No items selected.']),
    `Order type: ${fulfillment.type || 'Not selected'}.`,
    `Customer name: ${fulfillment.customerName || 'Not provided'}.`,
    ...(fulfillment.type === 'pickup' ? [`Requested pickup time: ${fulfillment.requestedPickupTime || 'No preference specified'}.`] : []),
    ...(fulfillment.type === 'delivery' ? [
      `Phone: ${fulfillment.phone || 'Not provided'}.`,
      `Full delivery address: ${fulfillment.address || 'Not provided'}.`,
      `Apartment/unit: ${fulfillment.apartment === null ? 'Not answered' : fulfillment.apartment || 'None (as specified)'}.`,
      `Delivery instructions: ${fulfillment.instructions === null ? 'Not answered' : fulfillment.instructions || 'None (as specified)'}.`,
      `Address explicitly confirmed: ${fulfillment.addressConfirmed ? 'Yes' : 'No'}.`,
    ] : []),
    `Subtotal: ${money(review.totals.subtotal)}.`,
    ...(review.promotions.length ? review.promotions.map(promo => `Promotion: ${promo.name} — ${money(promo.discount)} discount.`) : ['Applied promotions: None.']),
    `Discounted subtotal: ${money(review.totals.discountedSubtotal)}.`,
    `Tax (${review.totals.taxRatePercent}%): ${money(review.totals.tax)}.`,
    `Delivery fee: ${money(review.totals.deliveryFee)}.`,
    `${review.totals.totalType === 'sample_total' ? 'Sample total' : 'Configured total'}: ${money(review.totals.total)}.`,
    ...(review.missingFields.length ? [`Still needed: ${review.missingFields.join(', ')}.`]
      : ['Review these details and confirm the draft or request changes.']),
  ].join('\n');
}

module.exports = { summarizeOrder, buildOrderReview, formatOrderReview };
