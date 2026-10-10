const test = require('node:test');
const assert = require('node:assert/strict');
const menu = require('../data/menu.json');
const { recommendItems, validRecommendationRequest } = require('./recommendations');

test('recommendations use at most two available products matching every preference', () => {
  const original = structuredClone(menu);
  const result = recommendItems({ category: 'coffee', dietary: 'vegan', maxPrice: 4 }, menu);
  assert.equal(result.recommendations.length, 2);
  for (const recommended of result.recommendations) {
    const source = menu.items.find(item => item.id === recommended.itemId);
    assert.equal(source.available, true);
    assert.equal(source.category, 'coffee');
    assert.equal(source.dietary.vegan, true);
    assert.ok(source.price <= 4);
    assert.equal(recommended.name, source.name);
    assert.equal(recommended.price, source.price);
    assert.equal(recommended.currency, menu.currency);
  }
  assert.match(result.reply, /Sample prices/);
  assert.doesNotMatch(result.reply, /buy now|must try|limited time|add to your order/i);
  assert.deepEqual(menu, original);
});

test('unavailable products are never suggested and empty matches do not invent substitutes', () => {
  const custom = structuredClone(menu);
  custom.items.forEach(item => { item.available = item.id === 'butter-croissant'; });
  const single = recommendItems({ category: 'bakery' }, custom);
  assert.equal(single.recommendations.length, 1);
  assert.equal(single.recommendations[0].itemId, 'butter-croissant');
  assert.doesNotMatch(single.reply, /Blueberry Muffin/);
  custom.items.forEach(item => { item.available = false; });
  assert.deepEqual(recommendItems({ category: 'bakery' }, custom).recommendations, []);
  const noMatch = recommendItems({ maxPrice: 0 }, menu);
  assert.deepEqual(noMatch.recommendations, []);
  assert.match(noMatch.reply, /No available menu items match/);
  assert.deepEqual(recommendItems({ category: 'invented' }, menu).recommendations, []);
});

test('requests without preferences ask for clarification and invalid filters are rejected', () => {
  for (const request of [true, {}]) {
    const question = recommendItems(request, menu);
    assert.equal(question.needsInput, true);
    assert.deepEqual(question.recommendations, []);
    assert.match(question.reply, /What would you prefer/);
  }
  for (const request of [null, [], 'coffee', { limit: 50 }, { maxPrice: -1 },
    { maxPrice: 'free' }, { category: '' }, { dietary: 'allergen_free' }]) {
    assert.ok(!validRecommendationRequest(request));
  }
  assert.equal(validRecommendationRequest(false), true);
});
