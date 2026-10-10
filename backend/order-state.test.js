const test = require('node:test');
const assert = require('node:assert/strict');
const menu = require('../data/menu.json');
const { createOrderSessions } = require('./order-state');
const { confirmOrder } = require('./test-helpers.cjs');

test('confirmation requires a complete reviewed snapshot and session-specific token', () => {
  const sessions = createOrderSessions();
  const patch = { addItem: { itemId: 'house-espresso', quantity: 1 }, orderType: 'pickup', customer: { name: 'Alex' } };
  const first = sessions.update(undefined, patch, menu);
  assert.equal(sessions.update(first.sessionId, { confirmed: true }, menu).status, 400);
  const confirmationToken = sessions.review(first.sessionId, menu);
  assert.equal(typeof confirmationToken, 'string');
  for (const token of ['invented', '', true]) {
    assert.equal(sessions.update(first.sessionId, { confirmed: true, confirmationToken: token }, menu).status, 400);
  }
  const other = sessions.update(undefined, patch, menu);
  sessions.review(other.sessionId, menu);
  assert.equal(sessions.update(other.sessionId, { confirmed: true, confirmationToken }, menu).status, 400);
  const confirmed = sessions.update(first.sessionId, { confirmed: true, confirmationToken }, menu);
  assert.equal(confirmed.order.status, 'confirmed_draft');
  assert.equal(confirmed.order.confirmed, true);
  const edited = sessions.update(first.sessionId, { modifyItem: { lineIndex: 0, quantity: 2 } }, menu);
  assert.equal(edited.order.confirmed, false);
  assert.equal(sessions.update(first.sessionId, { confirmed: true, confirmationToken }, menu).status, 400);
  assert.equal(confirmOrder(sessions, first.sessionId, menu).order.confirmed, true);
  const incomplete = sessions.update(undefined, { orderType: 'delivery' }, menu);
  assert.equal(sessions.review(incomplete.sessionId, menu), null);
});

test('menu customization changes invalidate review and existing confirmation', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, {
    addItem: { itemId: 'house-espresso', quantity: 1, options: ['extra-shot'] },
    orderType: 'pickup', customer: { name: 'Alex' },
  }, menu);
  const token = sessions.review(first.sessionId, menu);
  sessions.update(first.sessionId, { confirmed: true, confirmationToken: token }, menu);
  const changedMenu = structuredClone(menu);
  changedMenu.items[0].options[0].name = 'Double extra shot';
  const refreshed = sessions.update(first.sessionId, undefined, changedMenu);
  assert.equal(refreshed.order.confirmed, false);
  assert.equal(refreshed.order.status, 'draft');
  assert.equal(sessions.update(first.sessionId, { confirmed: true, confirmationToken: token }, changedMenu).status, 400);
});

test('delivery repeats the full address and blocks draft confirmation until explicit address approval', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, {
    addItem: { itemId: 'house-espresso', quantity: 1 }, orderType: 'delivery',
    customer: { name: 'Alex', phone: '503-555-0100', address: '24 Maple Street, Portland OR 97205' },
    delivery: { apartment: 'Unit 4B', instructions: '' },
  }, menu);
  assert.deepEqual(first.requiredFields, ['delivery.addressConfirmed']);
  assert.match(first.reply, /24 Maple Street, Portland OR 97205/);
  assert.match(first.reply, /Apartment\/unit: Unit 4B/);
  assert.match(first.reply, /confirm it or provide a correction/);
  const blocked = confirmOrder(sessions, first.sessionId, menu);
  assert.equal(blocked.order.confirmed, false);
  assert.deepEqual(blocked.requiredFields, ['delivery.addressConfirmed']);
  const acknowledged = sessions.update(first.sessionId, undefined, menu);
  assert.equal(acknowledged.order.delivery.addressConfirmed, false);
  const approved = sessions.update(first.sessionId, { delivery: { addressConfirmed: true } }, menu);
  assert.equal(approved.needsInput, undefined);
  assert.equal(approved.order.delivery.addressConfirmed, true);
  assert.equal(confirmOrder(sessions, first.sessionId, menu).order.confirmed, true);
});

test('address and unit corrections require renewed review and cannot confirm a changed address simultaneously', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, {
    addItem: { itemId: 'house-espresso', quantity: 1 }, orderType: 'delivery',
    customer: { name: 'Alex', phone: '503-555-0100', address: '24 Maple Street, Portland OR 97205' },
    delivery: { apartment: '', instructions: '' },
  }, menu);
  sessions.update(first.sessionId, { delivery: { addressConfirmed: true } }, menu);
  confirmOrder(sessions, first.sessionId, menu);
  const corrected = sessions.update(first.sessionId, { customer: { address: '26 Maple Street, Portland OR 97205' } }, menu);
  assert.equal(corrected.order.delivery.addressConfirmed, false);
  assert.equal(corrected.order.confirmed, false);
  assert.match(corrected.reply, /26 Maple Street/);
  assert.match(corrected.reply, /None \(as specified\)/);
  const bypass = sessions.update(first.sessionId, {
    customer: { address: '28 Maple Street, Portland OR 97205' }, delivery: { addressConfirmed: true },
  }, menu);
  assert.equal(bypass.status, 400);
  assert.deepEqual(sessions.update(first.sessionId, undefined, menu).order, corrected.order);
  sessions.update(first.sessionId, { delivery: { addressConfirmed: true } }, menu);
  const unit = sessions.update(first.sessionId, { delivery: { apartment: 'Unit 2' } }, menu);
  assert.equal(unit.order.delivery.addressConfirmed, false);
  assert.match(unit.reply, /Apartment\/unit: Unit 2/);
  assert.equal(sessions.update(first.sessionId, { delivery: { addressConfirmed: 'yes' } }, menu).status, 400);
  sessions.update(first.sessionId, { delivery: { addressConfirmed: true } }, menu);
  sessions.update(first.sessionId, { orderType: 'pickup' }, menu);
  assert.equal(sessions.update(first.sessionId, { orderType: 'delivery' }, menu).order.delivery.addressConfirmed, false);
});

test('delivery collects only missing details and stores explicit none separately from unanswered', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, {
    addItem: { itemId: 'house-espresso', quantity: 1 }, orderType: 'delivery', customer: { name: 'Alex' },
  }, menu);
  assert.equal(first.order.orderType, 'delivery');
  assert.equal(first.needsInput, true);
  assert.deepEqual(first.requiredFields, ['customer.phone', 'customer.address', 'delivery.apartment', 'delivery.instructions']);
  assert.doesNotMatch(first.reply, /your name/);
  assert.equal(first.order.delivery.apartment, null);
  const partial = sessions.update(first.sessionId, { customer: { phone: '+1 (503) 555-0100' } }, menu);
  assert.deepEqual(partial.requiredFields, ['customer.address', 'delivery.apartment', 'delivery.instructions']);
  assert.doesNotMatch(partial.reply, /phone number|your name/);
  const incomplete = confirmOrder(sessions, first.sessionId, menu);
  assert.equal(incomplete.needsInput, true);
  assert.equal(incomplete.order.confirmed, false);
  const complete = sessions.update(first.sessionId, {
    customer: { address: '24 Maple Street, Portland OR 97205' },
    delivery: { apartment: '', instructions: '' },
  }, menu);
  assert.equal(complete.needsInput, true);
  assert.deepEqual(complete.requiredFields, ['delivery.addressConfirmed']);
  assert.equal(complete.order.customer.name, 'Alex');
  assert.equal(complete.order.customer.phone, '+1 (503) 555-0100');
  assert.deepEqual(complete.order.delivery, { apartment: '', instructions: '', addressConfirmed: false });
  sessions.update(first.sessionId, { delivery: { addressConfirmed: true } }, menu);
  assert.equal(confirmOrder(sessions, first.sessionId, menu).order.confirmed, true);
  const changed = sessions.update(first.sessionId, { delivery: { apartment: '  Unit 4B  ', instructions: 'Ring the bell' } }, menu);
  assert.equal(changed.order.delivery.apartment, 'Unit 4B');
  assert.equal(changed.order.confirmed, false);
  const cleared = sessions.update(first.sessionId, { delivery: { instructions: null } }, menu);
  assert.deepEqual(cleared.requiredFields, ['delivery.instructions']);
});

test('invalid delivery details do not alter the draft and phone formats do not imply location', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, { orderType: 'delivery', customer: { name: 'Alex' } }, menu);
  for (const patch of [{ delivery: null }, { delivery: [] }, { delivery: { apartment: 4 } },
    { delivery: { apartment: 'x'.repeat(101) } }, { delivery: { instructions: 'x'.repeat(501) } },
    { delivery: { guessedCity: 'Portland' } }, { customer: { phone: 'unknown' } },
    { customer: { phone: '123' } }, { customer: { phone: '1234567890123456' } }]) {
    assert.equal(sessions.update(first.sessionId, patch, menu).status, 400);
    assert.deepEqual(sessions.update(first.sessionId, undefined, menu).order, first.order);
  }
  const international = sessions.update(first.sessionId, { customer: { phone: '+92 300 1234567' } }, menu);
  assert.equal(international.order.customer.phone, '+92 300 1234567');
  assert.equal(international.order.customer.address, '');
  assert.ok(international.requiredFields.includes('customer.address'));
  assert.equal(sessions.update(undefined, { delivery: { instructions: '' } }, menu).status, 400);
});

test('delivery reuses existing customer details without requesting them again', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, { customer: {
    name: 'Alex', phone: '503-555-0100', address: '24 Maple Street, Portland OR 97205',
  } }, menu);
  const selected = sessions.update(first.sessionId, { orderType: 'delivery' }, menu);
  assert.deepEqual(selected.requiredFields, ['delivery.apartment', 'delivery.instructions']);
  assert.doesNotMatch(selected.reply, /your name|your phone|full delivery address/);
});

test('pickup collection retains selection, asks only for missing details, and accepts no time preference', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, {
    addItem: { itemId: 'house-espresso', quantity: 1 }, orderType: 'pickup', pickupTime: '14:30',
  }, menu);
  assert.equal(first.order.orderType, 'pickup');
  assert.equal(first.order.pickupTime, '14:30');
  assert.equal(first.order.items.length, 1);
  assert.equal(first.needsInput, true);
  assert.deepEqual(first.requiredFields, ['customer.name']);
  assert.equal(first.reply, 'What name should we use for pickup?');
  const incomplete = confirmOrder(sessions, first.sessionId, menu);
  assert.equal(incomplete.needsInput, true);
  assert.equal(incomplete.order.confirmed, false);
  const named = sessions.update(first.sessionId, { customer: { name: '  Alex  ' } }, menu);
  assert.equal(named.needsInput, undefined);
  assert.equal(named.order.customer.name, 'Alex');
  assert.equal(named.order.pickupTime, '14:30');
  confirmOrder(sessions, first.sessionId, menu);
  const changed = sessions.update(first.sessionId, { pickupTime: null }, menu);
  assert.equal(changed.order.pickupTime, null);
  assert.equal(changed.order.confirmed, false);
  assert.equal(changed.needsInput, undefined);
  assert.equal(confirmOrder(sessions, first.sessionId, menu).order.confirmed, true);
});

test('pickup time validation is atomic and optional, and existing names are not requested again', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, { customer: { name: 'Alex' } }, menu);
  const selected = sessions.update(first.sessionId, { orderType: 'pickup' }, menu);
  assert.equal(selected.needsInput, undefined);
  assert.equal(selected.order.pickupTime, null);
  for (const pickupTime of ['24:00', '12:60', '9:30', '', 123, {}, '14:30 tomorrow']) {
    assert.equal(sessions.update(first.sessionId, { pickupTime }, menu).status, 400);
    assert.deepEqual(sessions.update(first.sessionId, undefined, menu).order, selected.order);
  }
  assert.equal(sessions.update(undefined, { pickupTime: '12:00' }, menu).status, 400);
  const unnamed = sessions.update(first.sessionId, { customer: { name: '  ' } }, menu);
  assert.equal(unnamed.needsInput, true);
  assert.deepEqual(unnamed.requiredFields, ['customer.name']);
  assert.match(unnamed.reply, /leave it unspecified/);
});

test('removeItem reduces quantities or removes exactly the selected line', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, {
    items: [{ itemId: 'americano', quantity: 3, options: ['extra-shot'] },
      { itemId: 'americano', quantity: 1 }],
    orderType: 'pickup', customer: { name: 'Alex' }, promotion: 'auto',
  }, menu);
  confirmOrder(sessions, first.sessionId, menu);
  const reduced = sessions.update(first.sessionId, { removeItem: { lineIndex: 0, quantity: 2 } }, menu);
  assert.equal(reduced.order.items[0].quantity, 1);
  assert.deepEqual(reduced.order.items[0].options, ['extra-shot']);
  assert.deepEqual(reduced.order.items[1], first.order.items[1]);
  assert.equal(reduced.order.total, 9);
  assert.equal(reduced.order.confirmed, false);
  assert.equal(reduced.order.status, 'draft');
  assert.equal(reduced.order.customer.name, 'Alex');
  assert.deepEqual(reduced.order.promotion, first.order.promotion);
  const removed = sessions.update(first.sessionId, { removeItem: { lineIndex: 0 } }, menu);
  assert.deepEqual(removed.order.items, [first.order.items[1]]);
  assert.equal(removed.order.total, 4);
  const empty = sessions.update(first.sessionId, { removeItem: { lineIndex: 0, quantity: 1 } }, menu);
  assert.deepEqual(empty.order.items, []);
  assert.equal(empty.order.total, 0);
  assert.equal(empty.order.status, 'empty');
  assert.equal(empty.order.orderType, 'pickup');
});

test('invalid removals are atomic and cannot remove more than ordered', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, { addItem: { itemId: 'house-espresso', quantity: 2 } }, menu);
  for (const removeItem of [null, [], {}, { lineIndex: -1 }, { lineIndex: 1 }, { lineIndex: 0.5 },
    { lineIndex: '0' }, { lineIndex: 0, quantity: 0 }, { lineIndex: 0, quantity: -1 },
    { lineIndex: 0, quantity: 3 }, { lineIndex: 0, quantity: 0.5 },
    { lineIndex: 0, quantity: null }, { lineIndex: 0, itemId: 'americano' }]) {
    assert.equal(sessions.update(first.sessionId, { removeItem }, menu).status, 400);
    assert.deepEqual(sessions.update(first.sessionId, undefined, menu).order, first.order);
  }
  for (const other of [{ addItem: { itemId: 'house-espresso', quantity: 1 } },
    { modifyItem: { lineIndex: 0, quantity: 1 } }, { items: [] }, { confirmed: true }]) {
    assert.equal(sessions.update(first.sessionId, { removeItem: { lineIndex: 0 }, ...other }, menu).status, 400);
  }
  const unavailableMenu = structuredClone(menu);
  unavailableMenu.items[0].available = false;
  const removed = sessions.update(first.sessionId, { removeItem: { lineIndex: 0 } }, unavailableMenu);
  assert.equal(removed.order.status, 'empty');
});

test('modifyItem targets one existing line, recalculates totals, and resets confirmation', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, {
    items: [{ itemId: 'americano', quantity: 1 }, { itemId: 'americano', quantity: 2 }],
    orderType: 'pickup', customer: { name: 'Alex' },
  }, menu);
  confirmOrder(sessions, first.sessionId, menu);
  const edited = sessions.update(first.sessionId, {
    modifyItem: { lineIndex: 1, quantity: 3, size: 'Large (16 fl oz)', options: ['extra-shot', 'vanilla-syrup'] },
  }, menu);
  assert.deepEqual(edited.order.items[0], first.order.items[0]);
  assert.equal(edited.order.items[1].quantity, 3);
  assert.equal(edited.order.items[1].unitPrice, 6.5);
  assert.equal(edited.order.total, 23.5);
  assert.equal(edited.order.confirmed, false);
  assert.equal(edited.order.status, 'draft');
  assert.equal(edited.order.customer.name, 'Alex');
  const quantityOnly = sessions.update(first.sessionId, { modifyItem: { lineIndex: 1, quantity: 2 } }, menu);
  assert.equal(quantityOnly.order.items[1].size, 'Large (16 fl oz)');
  assert.deepEqual(quantityOnly.order.items[1].options, ['extra-shot', 'vanilla-syrup']);
  assert.equal(quantityOnly.order.total, 17);
  const clearOptions = sessions.update(first.sessionId, { modifyItem: { lineIndex: 1, options: [] } }, menu);
  assert.equal(clearOptions.order.total, 14);
});

test('invalid modifications leave the complete order untouched', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, { addItem: { itemId: 'house-espresso', quantity: 1 } }, menu);
  for (const modifyItem of [null, [], {}, { lineIndex: 0 },
    { lineIndex: -1, quantity: 2 }, { lineIndex: 1, quantity: 2 }, { lineIndex: 0.5, quantity: 2 },
    { lineIndex: 0, quantity: 0 }, { lineIndex: 0, quantity: 101 }, { lineIndex: 0, quantity: 1.5 },
    { lineIndex: 0, size: 'Imaginary' }, { lineIndex: 0, size: null },
    { lineIndex: 0, options: ['imaginary'] }, { lineIndex: 0, options: null },
    { lineIndex: 0, options: ['extra-shot', 'extra-shot'] },
    { lineIndex: 0, quantity: 2, price: 0 }, { lineIndex: 0, itemId: 'americano' }]) {
    assert.equal(sessions.update(first.sessionId, { modifyItem }, menu).status, 400);
    assert.deepEqual(sessions.update(first.sessionId, undefined, menu).order, first.order);
  }
  for (const other of [{ addItem: { itemId: 'house-espresso', quantity: 1 } }, { items: [] }, { confirmed: true }]) {
    assert.equal(sessions.update(first.sessionId, { modifyItem: { lineIndex: 0, quantity: 2 }, ...other }, menu).status, 400);
  }
  const unavailableMenu = structuredClone(menu);
  unavailableMenu.items[0].available = false;
  assert.equal(sessions.update(first.sessionId, { modifyItem: { lineIndex: 0, quantity: 2 } }, unavailableMenu).status, 400);
});

test('modifications cannot clear required options and request missing selections', () => {
  const customMenu = structuredClone(menu);
  customMenu.items[0].options[0].required = true;
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, {
    addItem: { itemId: 'house-espresso', quantity: 1, options: ['extra-shot'] },
  }, customMenu);
  const result = sessions.update(first.sessionId, { modifyItem: { lineIndex: 0, options: [] } }, customMenu);
  assert.equal(result.needsInput, true);
  assert.deepEqual(result.requiredFields, ['options']);
  assert.deepEqual(result.order, first.order);
});

test('addItem appends validated menu lines and preserves the draft on invalid additions', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, { addItem: { itemId: 'house-espresso', quantity: 2 } }, menu);
  const second = sessions.update(first.sessionId, { addItem: {
    itemId: 'americano', quantity: 1, size: 'Large (16 fl oz)', options: ['extra-shot'],
  } }, menu);
  assert.equal(second.order.items.length, 2);
  assert.deepEqual(second.order.items[0], first.order.items[0]);
  assert.equal(second.order.total, 13);
  for (const addItem of [null, { itemId: 'invented', quantity: 1 },
    { itemId: 'blueberry-muffin', quantity: 1 },
    { itemId: 'house-espresso', quantity: -1 },
    { itemId: 'house-espresso', quantity: 1, price: 0.01 },
    { itemId: 'house-espresso', quantity: 1, options: ['invented'] },
    { itemId: 'house-espresso', quantity: 1, options: ['extra-shot', 'extra-shot'] }]) {
    assert.equal(sessions.update(first.sessionId, { addItem }, menu).status, 400);
    assert.deepEqual(sessions.update(first.sessionId, undefined, menu).order, second.order);
  }
  assert.equal(sessions.update(first.sessionId, {
    addItem: { itemId: 'house-espresso', quantity: 1 }, items: [],
  }, menu).status, 400);
});

test('missing required choices prompt without adding a partial item', () => {
  const sessions = createOrderSessions();
  const question = sessions.update(undefined, { addItem: { itemId: 'house-espresso' } }, menu);
  assert.equal(question.needsInput, true);
  assert.deepEqual(question.requiredFields, ['quantity']);
  assert.match(question.reply, /How many House Espresso/);
  assert.equal(question.order.items.length, 0);
  const customMenu = structuredClone(menu);
  customMenu.items[0].sizes[0].default = false;
  customMenu.items[0].options[0].required = true;
  const missingSize = sessions.update(question.sessionId, {
    addItem: { itemId: 'house-espresso', quantity: 1 },
  }, customMenu);
  assert.deepEqual(missingSize.requiredFields, ['size']);
  assert.match(missingSize.reply, /Double shot/);
  const missingOption = sessions.update(question.sessionId, {
    addItem: { itemId: 'house-espresso', quantity: 1, size: 'Double shot (2 fl oz)' },
  }, customMenu);
  assert.deepEqual(missingOption.requiredFields, ['options']);
  assert.match(missingOption.reply, /Extra espresso shot/);
  assert.equal(missingOption.order.items.length, 0);
  const complete = sessions.update(question.sessionId, {
    addItem: { itemId: 'house-espresso', quantity: 1, size: 'Double shot (2 fl oz)', options: ['extra-shot'] },
  }, customMenu);
  assert.equal(complete.order.total, 4.5);
  assert.equal(complete.order.items.length, 1);
});

test('sessions track priced drafts, reset confirmation on edits, and isolate customers', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, {
    items: [{ itemId: 'house-espresso', quantity: 2, options: ['extra-shot'], unitPrice: 0.01 }],
    orderType: 'pickup', customer: { name: '  Alex  ', phone: '555-0100' },
    promotion: 'auto',
  }, menu);
  assert.equal(first.order.total, 9);
  assert.equal(first.order.items[0].unitPrice, 4.5);
  assert.equal(first.order.items[0].quantity, 2);
  assert.deepEqual(first.order.items[0].options, ['extra-shot']);
  assert.equal(first.order.customer.name, 'Alex');
  assert.equal(first.order.promotion, null);
  assert.equal(first.order.status, 'draft');
  const confirmed = confirmOrder(sessions, first.sessionId, menu);
  assert.equal(confirmed.order.status, 'confirmed_draft');
  assert.equal(confirmed.order.confirmed, true);
  const changed = sessions.update(first.sessionId, { customer: { address: '24 Maple Street' } }, menu);
  assert.equal(changed.order.confirmed, false);
  assert.equal(changed.order.customer.phone, '555-0100');
  assert.equal(changed.order.status, 'draft');
  const second = sessions.update(undefined, undefined, menu);
  assert.notEqual(second.sessionId, first.sessionId);
  assert.equal(second.order.total, 0);
  assert.equal(second.order.customer.name, '');
  first.order.customer.name = 'Mutation';
  assert.equal(sessions.update(first.sessionId, undefined, menu).order.customer.name, 'Alex');
  const cleared = sessions.update(first.sessionId, { items: [], promotion: null }, menu);
  assert.equal(cleared.order.total, 0);
  assert.equal(cleared.order.status, 'empty');
});

test('invalid updates are atomic and cannot bypass menu pricing or confirmation review', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, undefined, menu);
  for (const patch of [null, [], { total: 0 }, { status: 'placed' }, { items: null },
    { items: [{ itemId: 'invented', quantity: 1 }] },
    { items: [{ itemId: 'blueberry-muffin', quantity: 1 }] },
    { items: [{ itemId: 'house-espresso', quantity: 0 }] },
    { items: [{ itemId: 'house-espresso', quantity: 1.5 }] },
    { items: [{ itemId: 'house-espresso', quantity: 1, size: 'Imaginary size' }] },
    { items: [{ itemId: 'house-espresso', quantity: 1, options: ['free-option'] }] },
    { items: [{ itemId: 'house-espresso', quantity: 1, options: ['extra-shot', 'extra-shot'] }] },
    { customer: { name: 'x'.repeat(101) } }, { customer: { card: 'secret' } },
    { orderType: 'unknown' }, { promotion: {} }, { confirmed: 'yes' }, { confirmed: true },
    { items: [{ itemId: 'house-espresso', quantity: 1 }], orderType: 'pickup', confirmed: true }]) {
    assert.equal(sessions.update(first.sessionId, patch, menu).status, 400);
    assert.deepEqual(sessions.update(first.sessionId, undefined, menu).order, first.order);
  }
});

test('menu price changes recalculate totals and invalidate confirmation', () => {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, {
    items: [{ itemId: 'americano', quantity: 3, size: 'Large (16 fl oz)', options: ['vanilla-syrup'] }],
    orderType: 'dine_in',
  }, menu);
  assert.equal(first.order.total, 16.5);
  confirmOrder(sessions, first.sessionId, menu);
  const changedMenu = structuredClone(menu);
  changedMenu.items.find(item => item.id === 'americano').sizes[2].price = 5.25;
  const refreshed = sessions.update(first.sessionId, undefined, changedMenu);
  assert.equal(refreshed.order.total, 17.25);
  assert.equal(refreshed.order.confirmed, false);
});

test('sessions expire after 30 minutes of inactivity and reject unknown IDs', () => {
  let time = 0;
  const sessions = createOrderSessions({ now: () => time });
  const first = sessions.update(undefined, undefined, menu);
  assert.equal(sessions.update('not-a-session', undefined, menu).status, 400);
  assert.equal(sessions.update('11111111-1111-4111-8111-111111111111', undefined, menu).status, 404);
  time = 29 * 60 * 1000;
  assert.equal(sessions.update(first.sessionId, undefined, menu).sessionId, first.sessionId);
  time += 30 * 60 * 1000;
  assert.equal(sessions.update(first.sessionId, undefined, menu).status, 404);
});
