const { randomUUID } = require('node:crypto');
const { eligiblePromotions } = require('./promotions');
const { priceLine, calculateTotals } = require('./pricing');
const { buildOrderReview } = require('./order-summary');
const DEFAULT_PROMOTIONS = { promotions: [] };
const defaultPricing = currency => ({ currency, is_sample: true, tax_rate_percent: 0, delivery_fee: 0 });
const reviewFingerprint = (order, menu) => JSON.stringify({
  ...buildOrderReview(order, menu), status: '', confirmed: false,
});
const addressFingerprint = order => JSON.stringify({
  type: order.orderType, address: order.customer.address, apartment: order.delivery.apartment,
});

const SESSION_TTL = 30 * 60 * 1000;
const MAX_SESSIONS = 1000;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const pickupNameQuestion = order => 'What name should we use for pickup?'
  + (order.pickupTime === null ? ' You may also provide a preferred pickup time (HH:MM), or leave it unspecified.' : '');

function missingDeliveryDetails(order) {
  const missing = [];
  for (const key of ['name', 'phone', 'address']) {
    if (!order.customer[key]) missing.push(`customer.${key}`);
  }
  if (order.delivery.apartment === null) missing.push('delivery.apartment');
  if (order.delivery.instructions === null) missing.push('delivery.instructions');
  return missing;
}

function deliveryQuestion(fields) {
  const labels = {
    'customer.name': 'your name',
    'customer.phone': 'your phone number',
    'customer.address': 'your full delivery address (street/building, city, and postal code where applicable)',
    'delivery.apartment': 'apartment/unit, if applicable (or say none)',
    'delivery.instructions': 'delivery instructions (or say none)',
  };
  return `Please provide ${fields.map(field => labels[field]).join('; ')}.`;
}

function deliveryAddressQuestion(order) {
  return `Please confirm this delivery address:\n${order.customer.address}\nApartment/unit: ${order.delivery.apartment || 'None (as specified)'}\nIs this address correct? Explicitly confirm it or provide a correction.`;
}

class MissingChoices extends Error {
  constructor(fields, question) {
    super(question);
    this.fields = fields;
  }
}

function emptyOrder(currency) {
  return {
    items: [], orderType: null, pickupTime: null, customer: { name: '', phone: '', address: '' },
    delivery: { apartment: null, instructions: null, addressConfirmed: false },
    promotion: null, currency, ...calculateTotals([], 0, null, defaultPricing(currency)),
    confirmed: false, status: 'empty',
  };
}

function updateOrder(previous, patch, menu, promotions, pricing, reviewed, addressReviewed) {
  if (patch !== undefined && (!object(patch)
    || Object.keys(patch).some(key => !['items', 'addItem', 'modifyItem', 'removeItem', 'orderType', 'pickupTime', 'customer', 'delivery', 'promotion', 'confirmed', 'confirmationToken'].includes(key)))) {
    throw new Error('Invalid order update fields.');
  }
  if (patch?.confirmationToken !== undefined && (typeof patch.confirmationToken !== 'string' || patch.confirmed !== true)) {
    throw new Error('Use the review confirmation token only with explicit confirmed: true.');
  }
  const order = structuredClone(previous);
  if (patch?.removeItem !== undefined) {
    if (['addItem', 'modifyItem', 'items', 'confirmed'].some(key => patch[key] !== undefined)) {
      throw new Error('Remove an item separately from adding, modifying, replacing, or confirming the draft.');
    }
    const removal = patch.removeItem;
    if (!object(removal) || Object.keys(removal).some(key => !['lineIndex', 'quantity'].includes(key))
      || !Number.isInteger(removal.lineIndex) || removal.lineIndex < 0 || removal.lineIndex >= order.items.length) {
      throw new Error('Choose an existing order line by its zero-based lineIndex.');
    }
    const line = order.items[removal.lineIndex];
    const quantity = removal.quantity === undefined ? line.quantity : removal.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > line.quantity) {
      throw new Error('Remove a positive whole-number quantity no greater than the current line quantity.');
    }
    if (quantity === line.quantity) order.items.splice(removal.lineIndex, 1);
    else line.quantity -= quantity;
  }
  if (patch?.modifyItem !== undefined) {
    if (patch.addItem !== undefined || patch.items !== undefined || patch.confirmed !== undefined) {
      throw new Error('Modify an item separately from adding, replacing, or confirming the draft.');
    }
    const edit = patch.modifyItem;
    if (!object(edit) || Object.keys(edit).some(key => !['lineIndex', 'quantity', 'size', 'options'].includes(key))
      || !['quantity', 'size', 'options'].some(key => Object.hasOwn(edit, key))) {
      throw new Error('Provide lineIndex and a quantity, size, or options change.');
    }
    if (!Number.isInteger(edit.lineIndex) || edit.lineIndex < 0 || edit.lineIndex >= order.items.length) {
      throw new Error('Choose an existing order line by its zero-based lineIndex.');
    }
    const line = order.items[edit.lineIndex];
    for (const key of ['quantity', 'size', 'options']) {
      if (Object.hasOwn(edit, key)) line[key] = edit[key];
    }
  }
  if (patch?.addItem !== undefined) {
    if (patch.items !== undefined || patch.confirmed !== undefined) {
      throw new Error('Add an item separately from replacing or confirming the draft.');
    }
    if (!object(patch.addItem)
      || Object.keys(patch.addItem).some(key => !['itemId', 'quantity', 'size', 'options'].includes(key))) {
      throw new Error('Provide itemId, quantity, and any listed size or options only.');
    }
    if (order.items.length >= 50) throw new Error('The draft can contain at most 50 lines.');
    order.items.push(patch.addItem);
  }
  if (patch?.items !== undefined) {
    if (!Array.isArray(patch.items) || patch.items.length > 50) throw new Error('Provide up to 50 order lines.');
    order.items = patch.items;
  }
  // Rebuild all lines from the current menu, never from client-supplied prices.
  order.items = order.items.map(line => {
    if (!object(line)) throw new Error('Provide a valid order item.');
    const item = menu.items.find(entry => entry.id === line.itemId);
    if (!item || !item.available) throw new Error('Order item is unknown or unavailable.');
    if (line.quantity === undefined) {
      throw new MissingChoices(['quantity'], `How many ${item.name} would you like? Choose a quantity from 1 to 100.`);
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100) {
      throw new Error('Each item needs a quantity from 1 to 100.');
    }
    const size = line.size === undefined
      ? item.sizes.find(entry => entry.default === true)
      : item.sizes.find(entry => entry.name === line.size);
    if (!size && line.size === undefined) {
      throw new MissingChoices(['size'], `Which size of ${item.name} would you like? Choose: ${item.sizes.map(entry => entry.name).join(', ')}.`);
    }
    if (!size) throw new Error('Choose a listed size.');
    const options = line.options === undefined ? [] : line.options;
    if (!Array.isArray(options) || new Set(options).size !== options.length) {
      throw new Error('Options must be a list of unique option IDs.');
    }
    const selected = options.map(id => {
      const option = item.options.find(entry => entry.id === id);
      if (!option) throw new Error('Choose only listed options.');
      return option;
    });
    const missingOptions = item.options.filter(option => option.required === true && !options.includes(option.id));
    if (missingOptions.length) {
      throw new MissingChoices(['options'], `Please select the required options for ${item.name}: ${missingOptions.map(option => `${option.name} (${option.id})`).join(', ')}.`);
    }
    return {
      itemId: item.id, name: item.name, quantity: line.quantity, size: size.name,
      options: selected.map(option => option.id),
      ...priceLine(size, selected, line.quantity),
    };
  });
  if (patch?.orderType !== undefined) {
    if (![null, 'pickup', 'dine_in', 'delivery'].includes(patch.orderType)) throw new Error('Invalid order type.');
    order.orderType = patch.orderType;
  }
  if (patch?.customer !== undefined) {
    if (!object(patch.customer) || Object.keys(patch.customer).some(key => !['name', 'phone', 'address'].includes(key))) {
      throw new Error('Invalid customer fields.');
    }
    for (const [key, value] of Object.entries(patch.customer)) {
      if (typeof value !== 'string' || value.length > (key === 'address' ? 500 : 100)) {
        throw new Error('Invalid customer details.');
      }
      order.customer[key] = value.trim();
    }
  }
  if (patch?.delivery !== undefined) {
    if (order.orderType !== 'delivery') throw new Error('Select delivery before specifying delivery details.');
    if (!object(patch.delivery) || Object.keys(patch.delivery).some(key => !['apartment', 'instructions', 'addressConfirmed'].includes(key))) {
      throw new Error('Provide only apartment, instructions, and addressConfirmed in delivery details.');
    }
    for (const [key, value] of Object.entries(patch.delivery)) {
      if (key === 'addressConfirmed') {
        if (typeof value !== 'boolean') throw new Error('addressConfirmed must be true or false.');
        continue;
      }
      if (value !== null && (typeof value !== 'string' || value.length > (key === 'apartment' ? 100 : 500))) {
        throw new Error('Invalid delivery details.');
      }
      // Empty string means the customer explicitly said none; null means unanswered.
      order.delivery[key] = value === null ? null : value.trim();
    }
  }
  const addressChanged = order.customer.address !== previous.customer.address
    || order.delivery.apartment !== previous.delivery.apartment || order.orderType !== previous.orderType;
  if (addressChanged) order.delivery.addressConfirmed = false;
  if (patch?.delivery?.addressConfirmed !== undefined) {
    if (patch.delivery.addressConfirmed && (addressChanged || !order.customer.address || order.delivery.apartment === null
      || addressReviewed !== addressFingerprint(order))) {
      throw new Error('Review the saved full address and apartment/unit before confirming them in a separate request.');
    }
    order.delivery.addressConfirmed = patch.delivery.addressConfirmed;
  }
  if (order.orderType === 'delivery' && order.customer.phone) {
    const phone = order.customer.phone;
    const digits = phone.replace(/\D/g, '');
    if (!/^\+?[\d\s().-]+$/.test(phone) || digits.length < 7 || digits.length > 15) {
      throw new Error('Provide a phone number with 7 to 15 digits, optionally including +, spaces, parentheses, dots, or hyphens.');
    }
  }
  if (patch?.pickupTime !== undefined) {
    if (order.orderType !== 'pickup') throw new Error('Select pickup before specifying a pickup time.');
    const time = typeof patch.pickupTime === 'string' ? patch.pickupTime.trim() : patch.pickupTime;
    if (time !== null && (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
      throw new Error('Provide pickupTime as HH:MM in 24-hour format, or null for no preference.');
    }
    order.pickupTime = time;
  }
  if (patch?.promotion !== undefined) {
    if (patch.promotion !== null && (typeof patch.promotion !== 'string'
      || !/^[a-z0-9-]{1,80}$/.test(patch.promotion))) throw new Error('Invalid promotion ID.');
  }
  order.currency = menu.currency;
  const eligible = eligiblePromotions(order, menu, promotions);
  if (patch?.promotion !== undefined && patch.promotion !== null && patch.promotion !== 'auto'
    && !eligible.some(promo => promo.id === patch.promotion)) {
    throw new Error('The requested promotion is unknown, inactive, or ineligible for this draft.');
  }
  const wantsPromotion = patch?.promotion !== undefined ? patch.promotion !== null : previous.promotion !== null;
  order.promotion = wantsPromotion ? eligible[0] || null : null;
  Object.assign(order, calculateTotals(order.items, order.promotion?.discount || 0, order.orderType, pricing));
  if (previous.confirmed && reviewed?.fingerprint !== reviewFingerprint(order, menu)) order.confirmed = false;
  const changed = JSON.stringify({ ...order, confirmed: false, status: '' })
    !== JSON.stringify({ ...previous, confirmed: false, status: '' });
  if (changed) order.confirmed = false;
  if (patch?.confirmed !== undefined) {
    if (typeof patch.confirmed !== 'boolean') throw new Error('Confirmation must be true or false.');
    if (patch.confirmed && changed) throw new Error('Review the updated draft before confirming it in a separate request.');
    if (patch.confirmed && (!order.items.length || !order.orderType)) {
      throw new Error('Add items and an order type before confirming the draft.');
    }
    if (patch.confirmed && order.orderType === 'pickup' && !order.customer.name) {
      throw new MissingChoices(['customer.name'], pickupNameQuestion(order));
    }
    if (patch.confirmed && order.orderType === 'delivery') {
      const missing = missingDeliveryDetails(order);
      if (missing.length) throw new MissingChoices(missing, deliveryQuestion(missing));
      if (!order.delivery.addressConfirmed) {
        throw new MissingChoices(['delivery.addressConfirmed'], deliveryAddressQuestion(order));
      }
    }
    if (patch.confirmed && (!reviewed || patch.confirmationToken !== reviewed.token
      || reviewed.fingerprint !== reviewFingerprint(order, menu))) {
      throw new Error('Review the complete final summary, then explicitly confirm with its confirmationToken.');
    }
    order.confirmed = patch.confirmed;
  }
  order.status = order.items.length ? (order.confirmed ? 'confirmed_draft' : 'draft') : 'empty';
  return order;
}

function createOrderSessions({ now = Date.now } = {}) {
  const sessions = new Map();
  return {
    reviewAddress(sessionId) {
      const session = sessions.get(sessionId);
      if (session?.order.orderType === 'delivery' && session.order.customer.address && session.order.delivery.apartment !== null) {
        session.addressReviewed = addressFingerprint(session.order);
      }
    },
    review(sessionId, menu) {
      const session = sessions.get(sessionId);
      if (!session || !buildOrderReview(session.order, menu).readyForConfirmation) return null;
      const token = randomUUID();
      session.reviewed = { token, fingerprint: reviewFingerprint(session.order, menu) };
      return token;
    },
    update(sessionId, patch, menu, promotions = DEFAULT_PROMOTIONS, pricing = defaultPricing(menu.currency)) {
      const time = now();
      for (const [id, session] of sessions) {
        if (time - session.updatedAt >= SESSION_TTL) sessions.delete(id);
      }
      if (sessionId !== undefined && (typeof sessionId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId))) {
        return { error: 'Invalid session ID.', status: 400 };
      }
      const existing = sessionId === undefined ? undefined : sessions.get(sessionId);
      if (sessionId !== undefined && !existing) return { error: 'Session expired or not found. Start a new session.', status: 404 };
      if (!existing && sessions.size >= MAX_SESSIONS) return { error: 'Session capacity reached. Try again later.', status: 503 };
      let order;
      try {
        order = updateOrder(existing?.order || emptyOrder(menu.currency), patch, menu, promotions, pricing, existing?.reviewed, existing?.addressReviewed);
      } catch (error) {
        if (error instanceof MissingChoices) {
          const id = sessionId || randomUUID();
          let unchanged;
          try {
            // Even a clarification must not keep an expired or ineligible discount.
            unchanged = updateOrder(existing?.order || emptyOrder(menu.currency), undefined, menu, promotions, pricing, existing?.reviewed, existing?.addressReviewed);
          } catch {
            return { error: 'The current draft no longer matches the available menu. Review its items.', status: 400 };
          }
          const reviewed = existing?.reviewed?.fingerprint === reviewFingerprint(unchanged, menu) ? existing.reviewed : undefined;
          const addressReviewed = error.fields.includes('delivery.addressConfirmed') ? addressFingerprint(unchanged)
            : existing?.addressReviewed === addressFingerprint(unchanged) ? existing.addressReviewed : undefined;
          sessions.set(id, { order: structuredClone(unchanged), updatedAt: time, reviewed, addressReviewed });
          return { sessionId: id, order: unchanged, needsInput: true, requiredFields: error.fields, reply: error.message };
        }
        return { error: error.message, status: 400 };
      }
      const id = sessionId || randomUUID();
      const reviewed = existing?.reviewed?.fingerprint === reviewFingerprint(order, menu) ? existing.reviewed : undefined;
      const addressReviewed = existing?.addressReviewed === addressFingerprint(order) ? existing.addressReviewed : undefined;
      sessions.set(id, { order: structuredClone(order), updatedAt: time, reviewed, addressReviewed });
      if (order.orderType === 'pickup' && !order.customer.name) {
        return { sessionId: id, order, needsInput: true, requiredFields: ['customer.name'], reply: pickupNameQuestion(order) };
      }
      if (order.orderType === 'delivery') {
        const missing = missingDeliveryDetails(order);
        if (missing.length) return { sessionId: id, order, needsInput: true, requiredFields: missing, reply: deliveryQuestion(missing) };
        if (!order.delivery.addressConfirmed) {
          sessions.get(id).addressReviewed = addressFingerprint(order);
          return { sessionId: id, order, needsInput: true, requiredFields: ['delivery.addressConfirmed'], reply: deliveryAddressQuestion(order) };
        }
      }
      return { sessionId: id, order };
    },
  };
}

module.exports = { createOrderSessions };
