const test = require('node:test');
const assert = require('node:assert/strict');
const menu = require('../data/menu.json');
const promotions = require('../data/promotions.json');
const { createOrderSessions } = require('./order-state');
const { confirmOrder } = require('./test-helpers.cjs');
const { validPricing, priceLine, calculateTotals } = require('./pricing');

const pricing = { currency: 'USD', is_sample: true, tax_rate_percent: 8.25, delivery_fee: 3.5 };

test('totals use menu sizes/options, quantities, promotions, tax, and delivery fee', () => {
  const { order } = createOrderSessions().update(undefined, {
    items: [{ itemId: 'house-espresso', quantity: 4, options: ['extra-shot'], unitPrice: 0.01, lineTotal: 0.01 }],
    orderType: 'delivery', promotion: 'auto',
  }, menu, promotions, pricing);
  assert.equal(order.subtotal, 18);
  assert.equal(order.discount, 1.4);
  assert.equal(order.discountedSubtotal, 16.6);
  assert.equal(order.tax, 1.37);
  assert.equal(order.deliveryFee, 3.5);
  assert.equal(order.total, 21.47);
  assert.equal(order.totalType, 'sample_total');
  for (const orderType of ['pickup', 'dine_in', null]) {
    const other = createOrderSessions().update(undefined, {
      items: [{ itemId: 'house-espresso', quantity: 4, options: ['extra-shot'] }],
      orderType, promotion: 'auto',
    }, menu, promotions, pricing);
    assert.equal(other.order.deliveryFee, 0);
    assert.equal(other.order.total, 17.97);
  }
});

test('cent arithmetic and tax rounding are deterministic and empty drafts have no fees', () => {
  const line = priceLine({ price: 0.1 }, [{ price_delta: 0.2 }], 3);
  assert.deepEqual(line, { unitPrice: 0.3, lineTotal: 0.9 });
  const total = calculateTotals([{ lineTotal: 0.05 }], 0, 'pickup', { ...pricing, tax_rate_percent: 10 });
  assert.equal(total.tax, 0.01);
  assert.equal(total.total, 0.06);
  const empty = calculateTotals([], 0, 'delivery', pricing);
  assert.equal(empty.total, 0);
  assert.equal(empty.deliveryFee, 0);
});

test('pricing rejects invalid configuration and changes invalidate draft confirmation', () => {
  assert.equal(validPricing(pricing, 'USD'), true);
  for (const update of [{ tax_rate_percent: -1 }, { tax_rate_percent: 101 },
    { tax_rate_percent: '8' }, { delivery_fee: -1 }, { delivery_fee: 1.001 },
    { currency: 'EUR' }, { is_sample: undefined }]) {
    assert.equal(validPricing({ ...pricing, ...update }, 'USD'), false);
  }
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, {
    items: [{ itemId: 'house-espresso', quantity: 1 }], orderType: 'pickup', customer: { name: 'Alex' },
  }, menu, promotions, pricing);
  confirmOrder(sessions, first.sessionId, menu, promotions, pricing);
  const changed = sessions.update(first.sessionId, undefined, menu, promotions, { ...pricing, tax_rate_percent: 10 });
  assert.equal(changed.order.tax, 0.35);
  assert.equal(changed.order.total, 3.85);
  assert.equal(changed.order.confirmed, false);
});
