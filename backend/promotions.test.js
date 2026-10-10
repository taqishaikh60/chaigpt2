const test = require('node:test');
const assert = require('node:assert/strict');
const menu = require('../data/menu.json');
const data = require('../data/promotions.json');
const { createOrderSessions } = require('./order-state');
const { confirmOrder } = require('./test-helpers.cjs');
const { validPromotions, eligiblePromotions } = require('./promotions');

test('active promotions require all conditions and never include inactive discounts', () => {
  assert.equal(validPromotions(data, menu), true);
  const sessions = createOrderSessions();
  const espresso = sessions.update(undefined, { addItem: { itemId: 'house-espresso', quantity: 1 } }, menu, data);
  assert.deepEqual(eligiblePromotions(espresso.order, menu, data), []);
  const pair = sessions.update(espresso.sessionId, {
    addItem: { itemId: 'butter-croissant', quantity: 2 }, promotion: 'coffee-and-croissant',
  }, menu, data);
  assert.equal(pair.order.subtotal, 11.5);
  assert.equal(pair.order.discount, 1);
  assert.equal(pair.order.total, 10.5);
  assert.equal(pair.order.promotion.status, 'applied_sample');
  const coldBrew = sessions.update(undefined, { addItem: { itemId: 'cold-brew', quantity: 1 } }, menu, data);
  assert.deepEqual(eligiblePromotions(coldBrew.order, menu, data), []);
  for (const promotion of ['cold-brew-break', 'invented', 'gather-around']) {
    assert.equal(sessions.update(coldBrew.sessionId, { promotion }, menu, data).status, 400);
  }
});

test('discounts exclude add-ons, honor caps, and use half-up cent rounding', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, { items: [
    { itemId: 'house-espresso', quantity: 4, options: ['extra-shot'] },
    { itemId: 'butter-croissant', quantity: 1 },
  ], promotion: 'auto' }, menu, data);
  assert.equal(first.order.subtotal, 22);
  assert.equal(first.order.discount, 1.8);
  assert.equal(first.order.total, 20.2);
  assert.equal(first.order.promotion.id, 'gather-around');
  const capped = sessions.update(undefined, {
    items: [{ itemId: 'house-espresso', quantity: 20 }], promotion: 'auto',
  }, menu, data);
  assert.equal(capped.order.discount, 5);
  const rounding = sessions.update(undefined, { items: [
    { itemId: 'house-espresso', quantity: 3 }, { itemId: 'cappuccino', quantity: 1 },
  ], promotion: 'auto' }, menu, data);
  assert.equal(rounding.order.discount, 1.53);
});

test('promotion expiry and quantity changes remove discounts and reset confirmation', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, {
    items: [{ itemId: 'house-espresso', quantity: 4 }], orderType: 'pickup', customer: { name: 'Alex' }, promotion: 'auto',
  }, menu, data);
  confirmOrder(sessions, first.sessionId, menu, data);
  const reduced = sessions.update(first.sessionId, { removeItem: { lineIndex: 0, quantity: 1 } }, menu, data);
  assert.equal(reduced.order.promotion, null);
  assert.equal(reduced.order.discount, 0);
  assert.equal(reduced.order.total, 10.5);
  assert.equal(reduced.order.confirmed, false);
  const active = sessions.update(first.sessionId, { modifyItem: { lineIndex: 0, quantity: 4 }, promotion: 'auto' }, menu, data);
  confirmOrder(sessions, first.sessionId, menu, data);
  const inactive = structuredClone(data);
  inactive.promotions.forEach(promo => { promo.active = false; });
  const refreshed = sessions.update(first.sessionId, undefined, menu, inactive);
  assert.equal(refreshed.order.total, active.order.subtotal);
  assert.equal(refreshed.order.discount, 0);
  assert.equal(refreshed.order.confirmed, false);
});

test('invalid or unsupported eligibility configuration fails closed', () => {
  for (const mutate of [copy => { copy.currency = 'EUR'; },
    copy => { copy.promotions[0].eligibility.member_only = true; },
    copy => { copy.promotions[0].eligibility.minimum_category_quantity = undefined; },
    copy => { copy.promotions[0].discount.amount = -1; },
    copy => { copy.promotions[1].discount.percent = 101; },
    copy => { copy.application_rules.stacking_allowed = true; }]) {
    const invalid = structuredClone(data);
    mutate(invalid);
    assert.equal(validPromotions(invalid, menu), false);
  }
  const sessions = createOrderSessions();
  const { order } = sessions.update(undefined, { items: [
    { itemId: 'house-espresso', quantity: 1 }, { itemId: 'butter-croissant', quantity: 1 },
  ] }, menu, data);
  order.items[1].size = 'Unknown size';
  assert.deepEqual(eligiblePromotions(order, menu, data), []);
});

test('equal discounts select the promotion with the ascending ID', () => {
  const tied = structuredClone(data);
  const duplicate = structuredClone(tied.promotions[0]);
  duplicate.id = 'a-pair';
  tied.promotions.push(duplicate);
  const { order } = createOrderSessions().update(undefined, { items: [
    { itemId: 'house-espresso', quantity: 1 }, { itemId: 'butter-croissant', quantity: 1 },
  ], promotion: 'auto' }, menu, tied);
  assert.equal(order.promotion.id, 'a-pair');
  assert.equal(order.discount, 1);
});
