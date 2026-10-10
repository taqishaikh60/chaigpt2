const test = require('node:test');
const assert = require('node:assert/strict');
const menu = require('../data/menu.json');
const promotions = require('../data/promotions.json');
const { createOrderSessions } = require('./order-state');
const { summarizeOrder, buildOrderReview, formatOrderReview } = require('./order-summary');

test('complete pickup review includes menu customizations, fulfillment, valid promotion, and all totals', () => {
  const { order } = createOrderSessions().update(undefined, {
    items: [{ itemId: 'americano', quantity: 4, size: 'Large (16 fl oz)', options: ['extra-shot'] }],
    orderType: 'pickup', pickupTime: '14:30', customer: { name: 'Alex' }, promotion: 'auto',
  }, menu, promotions);
  const before = structuredClone(order);
  const review = buildOrderReview(order, menu);
  assert.equal(review.items[0].quantity, 4);
  assert.deepEqual(review.items[0].customizations, [{ id: 'extra-shot', name: 'Extra espresso shot', priceDelta: 1 }]);
  assert.equal(review.items[0].unitPrice, 6);
  assert.equal(review.items[0].lineTotal, 24);
  assert.deepEqual(review.fulfillment, { type: 'pickup', customerName: 'Alex', requestedPickupTime: '14:30' });
  assert.equal(review.promotions[0].id, 'gather-around');
  assert.equal(review.totals.subtotal, 24);
  assert.equal(review.totals.discount, 2);
  assert.equal(review.totals.total, 22);
  assert.equal(review.readyForConfirmation, true);
  assert.equal(review.placed, false);
  assert.match(formatOrderReview(review), /Alex|14:30/);
  assert.match(formatOrderReview(review), /USD 6\.00 each; USD 24\.00/);
  assert.deepEqual(order, before);
});

test('delivery review shows complete supplied details and distinguishes missing from explicit none', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, {
    addItem: { itemId: 'house-espresso', quantity: 1 }, orderType: 'delivery',
    customer: { name: 'Alex', phone: '503-555-0100', address: '24 Maple Street, Portland OR 97205' },
    delivery: { apartment: 'Unit 4B', instructions: '' },
  }, menu);
  const pending = buildOrderReview(first.order, menu);
  assert.equal(pending.readyForConfirmation, false);
  assert.deepEqual(pending.missingFields, ['delivery.addressConfirmed']);
  const confirmed = sessions.update(first.sessionId, { delivery: { addressConfirmed: true } }, menu);
  const review = buildOrderReview(confirmed.order, menu);
  assert.equal(review.readyForConfirmation, true);
  assert.equal(review.fulfillment.address, '24 Maple Street, Portland OR 97205');
  assert.equal(review.fulfillment.apartment, 'Unit 4B');
  assert.equal(review.fulfillment.instructions, '');
  const text = formatOrderReview(review);
  assert.match(text, /503-555-0100/);
  assert.match(text, /Delivery instructions: None \(as specified\)/);
  const incomplete = sessions.update(undefined, { orderType: 'delivery' }, menu);
  const missing = buildOrderReview(incomplete.order, menu);
  assert.equal(missing.fulfillment.address, null);
  assert.equal(missing.fulfillment.instructions, null);
  assert.ok(missing.missingFields.includes('items'));
  assert.match(formatOrderReview(missing), /Not answered/);
});

test('summary lists quantities, sizes, and customization names without changing state', () => {
  const { order } = createOrderSessions().update(undefined, {
    items: [{ itemId: 'americano', quantity: 4, size: 'Large (16 fl oz)', options: ['extra-shot', 'vanilla-syrup'] },
      { itemId: 'butter-croissant', quantity: 1 }],
    customer: { name: 'Private name', phone: 'Private number', address: 'Private address' },
    promotion: 'gather-around',
  }, menu, promotions);
  const original = structuredClone(order);
  const summary = summarizeOrder(order, menu);
  assert.match(summary, /4 × Americano \(Large \(16 fl oz\); Extra espresso shot, Vanilla syrup\)/);
  assert.match(summary, /1 × Butter Croissant \(One pastry\)/);
  assert.match(summary, /USD 30\.00 before tax and fees/);
  assert.match(summary, /not placed/);
  assert.match(summary, /Gather Around: −USD 2\.40/);
  assert.match(summary, /discounted subtotal: USD 27\.60/);
  assert.doesNotMatch(summary, /Private|extra-shot|vanilla-syrup/);
  assert.deepEqual(order, original);
});

test('empty orders have a concise summary', () => {
  const { order } = createOrderSessions().update(undefined, undefined, menu);
  assert.equal(summarizeOrder(order, menu), 'Your current order is empty.');
});
