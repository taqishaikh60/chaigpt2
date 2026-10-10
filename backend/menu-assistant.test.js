const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile, writeFile, unlink } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const { createServer } = require('./server');

test('Zara answers from menu data and completes a natural pickup draft only after review', async () => {
  const ordersPath = path.join(os.tmpdir(), `zara-${randomUUID()}.json`);
  await writeFile(ordersPath, '[]');
  const server = createServer({ ordersPath });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let sessionId;
  const chat = async (message, patch = {}) => {
    const response = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, sessionId, ...patch }) });
    const data = await response.json();
    assert.equal(response.status, 200, data.error);
    sessionId = data.sessionId;
    return data;
  };
  try {
    for (const file of ['/', '/chat.html?embedded=1', '/chat.js', '/styles.css']) assert.equal((await fetch(base + file)).status, 200);
    assert.equal((await fetch(base + '/data/orders.json')).status, 404);
    assert.match((await chat('menu')).reply, /Blueberry Muffin.*unavailable/);
    assert.match((await chat('What does the large Vanilla Cloud Latte cost?')).reply, /Large \(16 fl oz\): USD 6.25/);
    assert.match((await chat('Something iced and sweet')).reply, /Vanilla Cloud Latte/);
    const vegan = await chat('recommend vegan food');
    assert.doesNotMatch(vegan.reply, /Butter Croissant|Cappuccino|Vanilla Cloud Latte/);
    assert.match((await chat('Is Butter Croissant safe for allergies?')).reply, /wheat, milk, egg/);
    assert.match((await chat('add 1 Blueberry Muffin')).reply, /unavailable/);
    assert.equal((await chat('add 2 large Americanos with extra shot')).order.total, 12);
    assert.match((await chat('add 1 latte')).reply, /choose one full item name/);
    assert.match((await chat('add 1 Americano with oat milk')).reply, /not listed/);
    assert.match((await chat('add 1 Americano and 1 pizza')).reply, /one item/);
    assert.equal((await chat('change Americano to 3 small')).order.total, 15);
    assert.equal((await chat('remove 1 Americano')).order.items[0].quantity, 2);
    const pickup = await chat('pickup');
    assert.deepEqual(pickup.requiredFields, ['customer.name']);
    assert.match((await chat('What are your hours?')).reply, /7am–6pm/);
    await chat('Name: Alex');
    await chat('okay');
    assert.deepEqual(JSON.parse(await readFile(ordersPath, 'utf8')), []);
    const review = await chat('checkout');
    assert.ok(review.confirmationToken);
    assert.equal(review.reviewSummary.totals.total, 10);
    const confirmed = await chat('Confirm this sample order', { order: { confirmed: true, confirmationToken: review.confirmationToken } });
    assert.ok(confirmed.savedOrder.id);
    assert.equal(JSON.parse(await readFile(ordersPath, 'utf8')).length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); await unlink(ordersPath); }
});

test('delivery conversation repeats the address and never treats an ambiguous yes as checkout', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let sessionId;
  const chat = async message => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, sessionId }) });
    const data = await response.json();
    assert.equal(response.status, 200, data.error);
    sessionId = data.sessionId;
    return data;
  };
  try {
    await chat('add 1 espresso');
    await chat('delivery');
    await chat('Name: Alex'); await chat('Phone: +1 555 123 4567');
    await chat('Address: 10 Test Street, Portland, OR 97205');
    await chat('Unit: none');
    const addressReview = await chat('Instructions: none');
    assert.match(addressReview.reply, /10 Test Street/);
    assert.deepEqual(addressReview.requiredFields, ['delivery.addressConfirmed']);
    assert.equal((await chat('yes')).order.delivery.addressConfirmed, false);
    assert.equal((await chat('confirm address')).order.delivery.addressConfirmed, true);
    const review = await chat('checkout');
    assert.ok(review.confirmationToken);
    assert.equal((await chat('sure')).order.confirmed, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
