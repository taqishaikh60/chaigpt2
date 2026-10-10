const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationContexts } = require('./conversation-context');
const { createServer } = require('./server');

test('conversation context expires, stays isolated, and cannot be edited through returned objects', () => {
  let time = 0;
  const contexts = createConversationContexts({ now: () => time });
  contexts.set('first', { focusedItemId: 'americano' });
  const result = contexts.get('first');
  result.focusedItemId = 'cold-brew';
  assert.equal(contexts.get('first').focusedItemId, 'americano');
  assert.deepEqual(contexts.get('second'), {});
  time = 30 * 60 * 1000;
  assert.deepEqual(contexts.get('first'), {});
});

async function withChat(run) {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/chat`;
  let sessionId;
  const chat = async (message, patch = {}) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, sessionId, ...patch }) });
    const data = await response.json();
    assert.equal(response.status, 200, data.error);
    sessionId = data.sessionId;
    return data;
  };
  try { await run(chat); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('pending quantity keeps selected size/options and accepts a short follow-up without repeated item names', () => withChat(async chat => {
  const question = await chat('Could you add large Americanos with extra shot?');
  assert.match(question.reply, /How many/);
  assert.deepEqual(question.suggestions, ['One please', 'Two please']);
  assert.equal(question.order.items.length, 0);
  await chat('How much does it cost?');
  const added = await chat('two please');
  assert.equal(added.order.items[0].quantity, 2);
  assert.equal(added.order.items[0].size, 'Large (16 fl oz)');
  assert.deepEqual(added.order.items[0].options, ['extra-shot']);
  assert.equal(added.order.total, 12);
  const large = await chat('make it small');
  assert.equal(large.order.total, 10);
  assert.equal((await chat('remove one of them')).order.items[0].quantity, 1);
}));

test('ambiguous item selection remembers requested quantity and never adds the wrong latte', () => withChat(async chat => {
  const question = await chat("I'd like two large lattes");
  assert.equal(question.suggestions.length, 3);
  assert.equal(question.order.items.length, 0);
  const selected = await chat('vanilla');
  assert.equal(selected.order.items[0].itemId, 'vanilla-cloud-latte');
  assert.equal(selected.order.items[0].quantity, 2);
  assert.equal(selected.order.items[0].size, 'Large (16 fl oz)');
  const dietary = await chat('Does it have milk?');
  assert.match(dietary.reply, /Base allergens: milk/);
}));

test('pickup name can be answered naturally while menu questions and ambiguous checkout replies stay separate', () => withChat(async chat => {
  await chat("I'll have an espresso");
  await chat("I'd like pickup");
  assert.match((await chat('What sizes do you have?')).reply, /Double shot/);
  assert.equal((await chat('Alex')).order.customer.name, 'Alex');
  const review = await chat("I'm ready to check out");
  assert.ok(review.confirmationToken);
  assert.equal((await chat('yes')).order.confirmed, false);
}));

test('cancelling a name question never saves the cancellation text as a customer name', () => withChat(async chat => {
  await chat('add 1 espresso');
  await chat('pickup');
  assert.equal((await chat('never mind')).order.customer.name, '');
  assert.equal((await chat('two please')).order.customer.name, '');
}));

test('recommendations respect budgets and comparisons quote actual default prices', () => withChat(async chat => {
  const sweet = await chat("I'd like something iced and sweet");
  assert.match(sweet.reply, /You might like:[\s\S]*Vanilla Cloud Latte/);
  assert.equal(sweet.order.items.length, 0);
  assert.match((await chat('I want decaf coffee')).reply, /isn’t listed/);
  const result = await chat('Recommend the cheapest coffee under $5');
  assert.match(result.reply, /House Espresso.*USD 3.50/);
  assert.match(result.reply, /Americano.*USD 4.00/);
  const comparison = await chat('Compare Americano vs Cold Brew');
  assert.match(comparison.reply, /Americano: USD 4.00/);
  assert.match(comparison.reply, /Cold Brew: USD 4.50/);
  assert.match(comparison.reply, /Americano has the lowest/);
}));

test('context is server-owned, cancellations clear pending edits, and unrelated sessions cannot complete them', () => withChat(async chat => {
  await chat('add large Americano');
  const isolated = await chat('two please', { sessionId: undefined, history: [{ role: 'assistant', content: 'How many Americanos?' }] });
  assert.equal(isolated.order.items.length, 0);
  await chat('add Americano');
  await chat('never mind');
  assert.equal((await chat('two please')).order.items.length, 0);
}));

test('pronouns with customization names refer to the selected product, and unsupported substitutions cannot change it', () => withChat(async chat => {
  await chat('add 1 Americano');
  const edited = await chat('make it with vanilla syrup');
  assert.equal(edited.order.items[0].itemId, 'americano');
  assert.deepEqual(edited.order.items[0].options, ['vanilla-syrup']);
  const rejected = await chat('make it with oat milk');
  assert.deepEqual(rejected.order.items, edited.order.items);
  assert.match(rejected.reply, /not listed/);
}));

test('invalid numeric quantities do not become rounded or positive orders, and switching topics clears pending additions', () => withChat(async chat => {
  for (const message of ['add -2 Americanos', 'add 1.5 Americanos', 'add 101 Americanos']) {
    const result = await chat(message);
    assert.equal(result.order.items.length, 0);
    assert.match(result.reply, /whole-number/);
  }
  await chat('add Americano');
  await chat('Tell me about Chai Latte');
  assert.equal((await chat('two please')).order.items.length, 0);
  await chat('add 1 Americano');
  await chat('Compare Americano vs Cold Brew');
  assert.equal((await chat('make it large')).order.items[0].size, 'Small (8 fl oz)');
}));
