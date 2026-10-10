const { readFile, writeFile, rename, unlink } = require('node:fs/promises');
const { randomUUID, createHash } = require('node:crypto');
const path = require('node:path');
const { buildOrderReview } = require('./order-summary');

// Serialize read/append/write across stores in this server process.
const pendingWrites = new Map();
const ORDER_STATUSES = ['confirmed', 'preparing', 'ready', 'completed', 'cancelled'];

async function readOrders(file) {
  let orders;
  try { orders = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; orders = []; }
  if (!Array.isArray(orders) || orders.some(entry => !entry || typeof entry.id !== 'string'
    || typeof entry.timestamp !== 'string' || !ORDER_STATUSES.includes(entry.status) || entry.order?.confirmed !== true)) {
    throw new Error('Invalid order storage.');
  }
  return orders;
}

async function writeOrders(file, orders) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(orders, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => {}); }
}

function serialize(file, task) {
  const operation = (pendingWrites.get(file) || Promise.resolve()).then(task);
  const settled = operation.catch(() => {});
  pendingWrites.set(file, settled);
  settled.then(() => { if (pendingWrites.get(file) === settled) pendingWrites.delete(file); });
  return operation;
}

function createOrderStore(ordersPath) {
  const file = path.resolve(ordersPath);
  return {
    async list() {
      await pendingWrites.get(file);
      return readOrders(file);
    },
    updateStatus(id, status) {
      if (!ORDER_STATUSES.includes(status)) return Promise.reject(new Error('Invalid order status.'));
      return serialize(file, async () => {
        const orders = await readOrders(file);
        const record = orders.find(entry => entry.id === id);
        if (!record) return null;
        record.status = status;
        record.order.status = status;
        record.updatedAt = new Date().toISOString();
        await writeOrders(file, orders);
        return structuredClone(record);
      });
    },
    save(sessionId, order, menu) {
      if (order.confirmed !== true || order.status !== 'confirmed_draft'
        || !buildOrderReview(order, menu).readyForConfirmation) {
        return Promise.reject(new Error('Only a complete, explicitly confirmed draft can be saved.'));
      }
      const snapshot = structuredClone(order);
      const confirmationKey = createHash('sha256').update(JSON.stringify({ sessionId, order: snapshot })).digest('hex');
      return serialize(file, async () => {
        const orders = await readOrders(file);
        const existing = orders.find(entry => entry.confirmationKey === confirmationKey);
        if (existing) return structuredClone(existing);
        const record = {
          id: randomUUID(), timestamp: new Date().toISOString(), status: 'confirmed', confirmationKey,
          order: { ...snapshot, status: 'confirmed' },
        };
        orders.push(record);
        await writeOrders(file, orders);
        return structuredClone(record);
      });
    },
  };
}

module.exports = { createOrderStore, ORDER_STATUSES };
