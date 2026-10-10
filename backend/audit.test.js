const test = require('node:test');
const assert = require('node:assert/strict');
const menu = require('../data/menu.json');
const { createOrderSessions } = require('./order-state');
const { confirmOrder } = require('./test-helpers.cjs');

test('audit: delivery approval cannot precede the address being repeated for review', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, {
    addItem: { itemId: 'house-espresso', quantity: 1 }, orderType: 'delivery',
    customer: { name: 'Alex', address: '24 Maple Street, Portland OR 97205' },
    delivery: { apartment: 'Unit 4B', instructions: '' },
  }, menu);
  assert.deepEqual(first.requiredFields, ['customer.phone']);
  assert.doesNotMatch(first.reply, /24 Maple/);
  const premature = sessions.update(first.sessionId, {
    customer: { phone: '503-555-0100' }, delivery: { addressConfirmed: true },
  }, menu);
  assert.equal(premature.status, 400, 'An address not yet repeated to the customer must not be approved');
});

test('audit: incomplete attempted addition must preserve existing confirmation of an unchanged order', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, {
    addItem: { itemId: 'house-espresso', quantity: 1 }, orderType: 'pickup', customer: { name: 'Alex' },
  }, menu);
  const confirmed = confirmOrder(sessions, first.sessionId, menu);
  assert.equal(confirmed.order.confirmed, true);
  const incomplete = sessions.update(first.sessionId, { addItem: { itemId: 'americano' } }, menu);
  assert.equal(incomplete.needsInput, true);
  assert.deepEqual(incomplete.order, confirmed.order, 'No line was added, so the original review remains valid');
});
