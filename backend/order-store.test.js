const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, writeFile, unlink } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const menu = require('../data/menu.json');
const { createOrderStore } = require('./order-store');
const { createOrderSessions } = require('./order-state');
const { confirmOrder } = require('./test-helpers.cjs');

function confirmedDraft() {
  const sessions = createOrderSessions();
  const first = sessions.update(undefined, {
    addItem: { itemId: 'house-espresso', quantity: 1 }, orderType: 'pickup', customer: { name: 'Alex' },
  }, menu);
  return confirmOrder(sessions, first.sessionId, menu);
}

test('stores confirmed snapshots with unique IDs, timestamps, and retry deduplication', async () => {
  const file = path.join(os.tmpdir(), `cafebot-store-${randomUUID()}.json`);
  const store = createOrderStore(file);
  const first = confirmedDraft();
  const second = confirmedDraft();
  try {
    const records = await Promise.all([
      store.save(first.sessionId, first.order, menu),
      store.save(first.sessionId, first.order, menu),
      createOrderStore(file).save(second.sessionId, second.order, menu),
    ]);
    assert.equal(records[0].id, records[1].id);
    assert.notEqual(records[0].id, records[2].id);
    assert.equal(records[0].status, 'confirmed');
    assert.ok(!Number.isNaN(Date.parse(records[0].timestamp)));
    assert.equal(records[0].order.status, 'confirmed');
    assert.equal(records[0].order.confirmed, true);
    assert.equal(records[0].order.total, 3.5);
    assert.equal(first.order.status, 'confirmed_draft');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.length, 2);
    assert.equal(saved[0].order.items[0].quantity, 1);
  } finally {
    await unlink(file).catch(() => {});
  }
});

test('drafts and incomplete orders are rejected without touching storage', async () => {
  const file = path.join(os.tmpdir(), `cafebot-drafts-${randomUUID()}.json`);
  await writeFile(file, '[]\n');
  try {
    const store = createOrderStore(file);
    const draft = createOrderSessions().update(undefined, { addItem: { itemId: 'house-espresso', quantity: 1 } }, menu);
    await assert.rejects(store.save(draft.sessionId, draft.order, menu));
    const incomplete = { ...draft.order, status: 'confirmed_draft', confirmed: true };
    await assert.rejects(store.save(draft.sessionId, incomplete, menu));
    assert.equal(await readFile(file, 'utf8'), '[]\n');
  } finally {
    await unlink(file);
  }
});

test('malformed history is preserved and a failed save can be retried', async () => {
  const file = path.join(os.tmpdir(), `cafebot-retry-${randomUUID()}.json`);
  const store = createOrderStore(file);
  const confirmed = confirmedDraft();
  await writeFile(file, '{bad json');
  try {
    await assert.rejects(store.save(confirmed.sessionId, confirmed.order, menu));
    assert.equal(await readFile(file, 'utf8'), '{bad json');
    await writeFile(file, '[]');
    const record = await store.save(confirmed.sessionId, confirmed.order, menu);
    assert.equal(record.status, 'confirmed');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).length, 1);
  } finally {
    await unlink(file);
  }
});

test('staff status changes preserve the snapshot and confirmation retries do not reset status', async () => {
  const file = path.join(os.tmpdir(), `cafebot-staff-store-${randomUUID()}.json`);
  const store = createOrderStore(file);
  const first = confirmedDraft();
  try {
    const saved = await store.save(first.sessionId, first.order, menu);
    const updated = await store.updateStatus(saved.id, 'preparing');
    assert.equal(updated.status, 'preparing');
    assert.equal(updated.order.status, 'preparing');
    assert.deepEqual(updated.order.items, saved.order.items);
    assert.equal(updated.order.total, saved.order.total);
    assert.equal(updated.timestamp, saved.timestamp);
    assert.ok(updated.updatedAt);
    await assert.rejects(store.updateStatus(saved.id, 'invented'));
    assert.equal(await store.updateStatus(randomUUID(), 'ready'), null);
    const retried = await store.save(first.sessionId, first.order, menu);
    assert.equal(retried.id, saved.id);
    assert.equal(retried.status, 'preparing');
    assert.equal((await store.list()).length, 1);
  } finally { await unlink(file).catch(() => {}); }
});
