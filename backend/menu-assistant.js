// Local, deterministic interpretation. Only explicit supported commands mutate drafts.
const normalize = value => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const HELP = 'I can show the menu, prices, sizes, allergens and recommendations, or help with a sample order. Try “add 2 large Americanos”, “my order”, “pickup”, or “checkout”.';
const ACTION = /^(?:please\s+)?(?:add|order|i(?:'d| would) like|i want|i(?:'ll| will) have|can (?:i|you) (?:have|get|add|remove)|could (?:i|you) (?:have|get|add)|remove|delete|change|modify|make)\b/i;
const numberWords = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1 };
function quantityFrom(text) {
  const cleaned = text.replace(/\b\d+\s*(?:fl\s*)?oz\b|\b(?:one|two) slices?\b/gi, '');
  const match = /(-?\d+(?:\.\d+)?|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bsix\b|\bseven\b|\beight\b|\bnine\b|\bten\b|\ba\b|\ban\b)/i.exec(cleaned);
  return match ? numberWords[match[1].toLowerCase()] ?? Number(match[1]) : undefined;
}

function matchItems(text, menu) {
  const words = normalize(text).split(' ').map(word => word.endsWith('s') ? word.slice(0, -1) : word);
  const exact = menu.items.filter(item => {
    const names = normalize(item.name).split(' ').map(word => word.endsWith('s') ? word.slice(0, -1) : word);
    return names.every(word => words.includes(word)) || words.includes(item.id);
  });
  if (exact.length) return exact;
  // Common short names may be ambiguous; return all candidates for clarification.
  const aliases = ['espresso', 'latte', 'croissant', 'muffin', 'brownie'];
  const alias = aliases.find(word => words.includes(word));
  if (alias) return menu.items.filter(item => normalize(item.name).split(' ').includes(alias));
  const distinctive = ['vanilla', 'chai', 'matcha', 'mint', 'avocado', 'granola', 'yogurt', 'almond', 'blueberry'];
  const fragment = distinctive.find(word => words.includes(word));
  return fragment ? menu.items.filter(item => normalize(item.name).split(' ').includes(fragment)) : [];
}

function interpretMessage(body, menu, order, previousContext = {}) {
  let text = body.message.trim().replace(/[?.!]+$/, '').trim();
  const context = structuredClone(previousContext);
  const answer = reply => {
    const choices = context.pending?.candidates?.map(id => menu.items.find(item => item.id === id)?.name).filter(Boolean)
      || (context.pending?.itemId ? ['One please', 'Two please'] : []);
    return { reply, mode: 'menu', context, ...(choices.length ? { suggestions: choices.slice(0, 4) } : {}) };
  };
  const money = price => `${menu.currency} ${price.toFixed(2)}`;
  const sample = 'These are sample menu prices and availability.';
  let matches = matchItems(text, menu);
  if ((matches.length === 1 && context.pending?.itemId && matches[0].id !== context.pending.itemId)
    || (matches.length > 1 && !ACTION.test(text))) delete context.pending;
  // Clarification only completes a server-owned pending request, never one in history.
  if (context.pending && !ACTION.test(text)) {
    const pending = context.pending;
    if (pending.candidates && matches.length === 1 && pending.candidates.includes(matches[0].id)) {
      const item = matches[0];
      delete context.pending;
      const quantity = pending.quantity ?? quantityFrom(text);
      const size = /\b(small|regular|large)\b/i.exec(text)?.[1] || pending.size || '';
      return interpretMessage({ ...body, message: `add ${quantity ?? ''} ${size} ${item.name}${pending.optionText || ''}` }, menu, order, context);
    }
    if (pending.itemId && /^(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+(?:small|regular|large))?(?:\s+please)?$/i.test(text)) {
      const item = menu.items.find(item => item.id === pending.itemId);
      if (item) {
        delete context.pending;
        return interpretMessage({ ...body, message: `add ${quantityFrom(text)} ${/\b(small|regular|large)\b/i.exec(text)?.[1] || pending.size || ''} ${item.name}${pending.optionText || ''}` }, menu, order, context);
      }
    }
  }
  const focused = menu.items.find(item => item.id === context.focusedItemId);
  if (focused && /\b(?:it|that|this|them|those)\b/i.test(text)) {
    const replacement = text.replace(/\b(?:it|that|this|them|those)\b/i, focused.name);
    if (ACTION.test(text) || /\b(price|cost|size|option|allergen|contain|vegan|milk|ingredient)/i.test(text)) {
      text = replacement;
      matches = [focused];
    }
  }
  if (focused && !matches.length && /^(small|regular|large)(?: please)?$/i.test(text)) {
    text = `change ${focused.name} to ${text}`;
    matches = [focused];
  }
  if (focused && !matches.length && /\b(sizes?|options?|allergens?|ingredients?)\b/i.test(text)) matches = [focused];
  const preferenceRequest = !matches.length && ACTION.test(text)
    && /\b(coffee|tea|food|bakery|snack|something|vegan|vegetarian|iced|cold|hot|sweet|recommend|suggest)\b/i.test(text);
  const action = ACTION.test(text) && !preferenceRequest;
  if (preferenceRequest) delete context.pending;
  if (matches.length === 1) context.focusedItemId = matches[0].id;
  else if (matches.length > 1) delete context.focusedItemId;

  if (/\b(hours?|open|opening|close|closing|location|where|address)\b/i.test(text)
    && !/^(?:(?:address|delivery address):|confirm address|(?:the )?address is correct)/i.test(text)) {
    return answer('The website lists Monday–Friday, 7am–6pm, and Saturday–Sunday, 8am–5pm. Address: 24 Maple Street, Portland, OR 97205. These are fictional sample business details; staff must verify them.');
  }
  if (/^(?:checkout|check out|review(?: my)? order|finish(?: my)? order|i(?:'m| am) ready(?: to (?:checkout|check out))?|that(?:'s| is) all)$/i.test(text)) { delete context.pending; return { review: true, context }; }
  if (/^(?:my order|show(?: me)?(?: my| the)? order|order summary|total|what(?:'s| is) (?:in )?my order|how much is my order|what is my total)[?.!]*$/i.test(text)) return { summary: true };
  if (/^(?:(?:i(?:'d| would) like |for |i want |can i get )?(?:pickup|pick up|takeaway|delivery|deliver|dine in))$/i.test(text)) {
    return { order: { orderType: /deliver/i.test(text) ? 'delivery' : /dine/i.test(text) ? 'dine_in' : 'pickup' } };
  }
  const name = /^(?:name:|my name is|(?:pickup|order) (?:name|for):?)\s*(.+)$/i.exec(text);
  if (name) return { order: { customer: { name: name[1] } } };
  const detail = /^(phone|address|delivery address|unit|apartment|instructions|delivery instructions|pickup time):\s*(.+)$/i.exec(text);
  if (detail) {
    const field = detail[1].toLowerCase();
    const value = /^(none|no preference)$/i.test(detail[2]) ? '' : detail[2];
    if (field === 'pickup time') return { order: { pickupTime: value || null } };
    if (['phone', 'address', 'delivery address'].includes(field)) return { order: { customer: { [field === 'phone' ? 'phone' : 'address']: value } } };
    return { order: { delivery: { [field.includes('instructions') ? 'instructions' : 'apartment']: value } } };
  }
  if (/^(?:confirm address|address is correct|the address is correct)[.!]*$/i.test(text)) return { order: { delivery: { addressConfirmed: true } } };
  if (/^(?:confirm|yes|okay|ok|sure|maybe|yes please|confirm order|i confirm)[.!]*$/i.test(text)) {
    return answer('To save a draft, type “checkout”, review the full summary, then use “Confirm this sample order”. A general yes or okay does not confirm an order. For the delivery address, say “confirm address” after it has been repeated to you.');
  }
  if (/\b(promo|promotion|discount|deal|offer)s?\b/i.test(text)) {
    return /\b(apply|use)\b/i.test(text) ? { order: { promotion: 'auto' } } : { recommendPromotions: true };
  }
  if (action) {
    delete context.pending;
    if (matches.length !== 1) {
      if (matches.length && /^(?:please\s+)?(?:add|order|i|can|could)/i.test(text) && !/\band\b/i.test(text)) {
        context.pending = { candidates: matches.map(item => item.id), quantity: quantityFrom(text), size: /\b(small|regular|large)\b/i.exec(text)?.[1], optionText: /\bwith\b.*$/i.exec(text)?.[0] ? ` ${/\bwith\b.*$/i.exec(text)[0]}` : '' };
      }
      return answer(matches.length ? `Please choose one full item name: ${matches.map(item => item.name).join(', ')}. Send one item at a time with a quantity.` : 'Which item would you like? Try “Americano”, “Vanilla Cloud Latte”, or ask for the menu.');
    }
    if (/\band\b/i.test(text)) return answer('Please send one item or change at a time, so I don’t miss part of your request.');
    const item = matches[0];
    if (!item.available) return answer(`${item.name} is unavailable in the sample menu. I haven’t changed your order.`);
    const lines = order.items.map((line, lineIndex) => ({ ...line, lineIndex })).filter(line => line.itemId === item.id);
    const quantity = quantityFrom(text);
    if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1 || quantity > 100)) return answer('Please choose a whole-number quantity from 1 to 100. I haven’t changed your order.');
    if (/\$|\bUSD\b/i.test(text)) return answer('Please specify an item and quantity; prices always come from the menu. I haven’t changed your order.');
    if (/^(?:please\s+)?(?:remove|delete|can you remove)\b/i.test(text)) {
      if (lines.length !== 1) return answer(lines.length ? 'That product appears on several order lines. Use the order controls to select the line you want to remove.' : `${item.name} isn’t in your order.`);
      return { order: { removeItem: { lineIndex: lines[0].lineIndex, ...(quantity !== undefined ? { quantity } : {}) } } };
    }
    const sizeWord = /\b(small|regular|large)\b/i.exec(text)?.[1].toLowerCase();
    const size = sizeWord && item.sizes.find(entry => entry.name.toLowerCase().startsWith(sizeWord));
    if (sizeWord && !size) return answer(`${item.name} doesn’t have a ${sizeWord} size. Listed sizes: ${item.sizes.map(entry => entry.name).join(', ')}.`);
    if (/\b(oat|almond milk|soy milk|decaf|no milk|without milk|sugar free)\b/i.test(text)) return answer('That substitution is not listed for this item. I haven’t changed the order; please ask staff about substitutions.');
    const options = item.options.filter(option => normalize(text).includes(normalize(option.name)) || normalize(text).includes(normalize(option.id))).map(option => option.id);
    if (/\bwith\b/i.test(text) && !options.length) return answer(`Please choose a listed customization: ${item.options.map(option => option.name).join(', ') || 'none for this item'}. I haven’t changed your order.`);
    if (/^(?:please\s+)?(?:change|modify|make)\b/i.test(text)) {
      if (lines.length !== 1) return answer('Please select one existing product line to modify.');
      const edit = { lineIndex: lines[0].lineIndex, ...(quantity !== undefined ? { quantity } : {}), ...(size ? { size: size.name } : {}), ...(options.length ? { options } : {}) };
      if (Object.keys(edit).length === 1) return answer('Specify a quantity, a listed size, or a listed customization to change.');
      return { order: { modifyItem: edit } };
    }
    if (quantity === undefined) {
      context.pending = { itemId: item.id, size: sizeWord, optionText: /\bwith\b.*$/i.exec(text)?.[0] ? ` ${/\bwith\b.*$/i.exec(text)[0]}` : '' };
      return answer(`How many ${item.name} would you like? You can say “two please”.${size ? ` Selected size: ${size.name}.` : ''}`);
    }
    return { order: { addItem: { itemId: item.id, quantity, ...(size ? { size: size.name } : {}), options } } };
  }
  if (matches.length) {
    if (matches.length > 1 && /\b(compare|difference|cheaper|cheapest|versus|vs)\b/i.test(text)) {
      const available = matches.filter(item => item.available);
      const cheapest = [...available].sort((a, b) => a.price - b.price)[0];
      delete context.focusedItemId;
      return answer(`${matches.map(item => `${item.name}: ${money(item.price)} for the default size. ${item.description}${item.available ? '' : ' Unavailable.'}`).join('\n\n')}\n${cheapest ? `${cheapest.name} has the lowest listed default price among the available choices.` : 'These choices are unavailable.'}\n${sample}`);
    }
    if (matches.length === 1) {
      const item = matches[0];
      if (/\b(allerg|contain|ingredient|milk|nuts?|vegan|vegetarian|gluten)/i.test(text)) {
        const dietary = /vegan/i.test(text) ? 'vegan' : /vegetarian/i.test(text) ? 'vegetarian' : /gluten/i.test(text) ? 'gluten_free' : null;
        return answer(`${item.name}: ${dietary ? `the sample base recipe is ${item.dietary[dietary] ? '' : 'not '}${dietary.replace('_', '-')}. ` : ''}Base allergens: ${item.allergens.join(', ') || 'none listed'}.\n${item.description}\nOptional add-ons can add allergens. Staff must verify actual ingredients and cross-contact risks.`);
      }
      if (/\b(price|cost|how much|sizes?|options?|customiz)/i.test(text)) {
        return answer(`${item.name}\n${item.sizes.map(size => `• ${size.name}: ${money(size.price)}`).join('\n')}\nCustomizations: ${item.options.map(option => `${option.name} (+${money(option.price_delta)})`).join('; ') || 'none listed'}.\n${sample}${item.available ? '' : ' This item is unavailable.'}`);
      }
    }
    return answer(matches.map(item => [
      `${item.name} — ${item.available ? 'available' : 'unavailable'} in the sample menu.`, item.description,
      `Sizes: ${item.sizes.map(size => `${size.name}: ${money(size.price)}`).join('; ')}.`,
      `Customizations: ${item.options.map(option => `${option.name} (+${money(option.price_delta)})`).join('; ') || 'none listed'}.`,
      `Base allergens: ${item.allergens.join(', ') || 'none listed'}.`,
      'Staff must verify ingredients and cross-contact risks before serving someone with allergies.',
    ].join('\n')).join('\n\n'));
  }
  if (/\b(allerg|dietary|ingredients)/i.test(text)) return answer('Which menu item would you like to check? I can show its listed base allergens and customizations. Shared preparation may involve milk, wheat, egg, tree nuts, soy, and sesame; ask staff to verify cross-contact risks.');
  if (preferenceRequest || /\b(vegan|vegetarian|gluten[ -]?free|recommend|suggest|iced|cold|hot|sweet|caffeine[ -]?free|cheap|cheapest|under|below|less than|budget)\b/i.test(text)) {
    if (/\b(decaf|oat milk|soy milk|almond milk|sugar[ -]?free)\b/i.test(text)) return answer('That preference or substitution isn’t listed in the sample menu. Please ask staff to verify it; I don’t want to recommend something that may not meet your needs.');
    const dietary = /vegan/i.test(text) ? 'vegan' : /vegetarian/i.test(text) ? 'vegetarian' : /gluten/i.test(text) ? 'gluten_free' : null;
    const limit = /(?:under|below|less than)\s*\$?(\d+(?:\.\d+)?)/i.exec(text);
    const category = /\bfood\b/i.test(text) ? 'food' : /\bcoffee\b/i.test(text) ? 'coffee' : /\btea\b/i.test(text) ? 'tea' : /\b(bakery|pastry|bakes)\b/i.test(text) ? 'bakery' : null;
    const items = menu.items.filter(item => item.available && (!dietary || item.dietary[dietary])
      && (!category || item.category === category)
      && (!limit || item.price < Number(limit[1]))
      && (!/iced/i.test(text) || /over ice/i.test(item.description))
      && (!/\bcold\b/i.test(text) || /over ice/i.test(item.description))
      && (!/\bhot\b/i.test(text) || /\bhot\b/i.test(item.description))
      && (!/sweet/i.test(text) || /vanilla|chocolate|brownie/i.test(item.description))
      && (!/caffeine[ -]?free/i.test(text) || /caffeine-free/i.test(item.description)))
      .sort((a, b) => /cheap|budget/i.test(text) ? a.price - b.price : 0).slice(0, 2);
    if (items.length === 1) context.focusedItemId = items[0].id;
    else delete context.focusedItemId;
    return answer(items.length ? `You might like:\n${items.map(item => `• ${item.name} — ${money(item.price)} (default size)`).join('\n')}\n${sample} Dietary flags describe base recipes; staff must verify suitability and cross-contact.` : 'No available sample menu items match those preferences. Would you like to explore the menu?');
  }
  if (/\b(menu|coffee|tea|bakery|bakes|food|latte|croissant|espresso|pastr(?:y|ies)|prices?)\b/i.test(text)) {
    const category = /\bcoffee\b/i.test(text) ? 'coffee' : /\btea\b/i.test(text) ? 'tea' : /\b(bakery|bakes|pastr(?:y|ies))\b/i.test(text) ? 'bakery' : /\bfood\b/i.test(text) ? 'food' : null;
    return answer(`${sample}\n${menu.items.filter(item => !category || item.category === category).map(item => `• ${item.name} — ${money(item.price)}${item.available ? '' : ' (unavailable)'}`).join('\n')}\nPrices are for default sizes, before add-ons, tax, and fees. Ask about a full item name for details, or say “add 1 [item name]”.`);
  }
  if (/^(hi|hello|hey|hello zara|hi zara|salam|assalamualaikum)[!. ]*$/i.test(text)) return answer(`Hi, I’m Zara! ${HELP}`);
  if (/\b(thank|thanks)\b/i.test(text)) return answer('You’re welcome! Let me know if you’d like anything else from the menu.');
  if (/^(?:please )?(?:no|cancel(?: (?:it|that|order|request))?|stop|never mind|nevermind)(?: please)?$/i.test(text)) { delete context.pending; delete context.expectedField; return answer('Okay, I’ve stopped the pending request. Your existing draft is unchanged. You can review it with “my order” or remove a named item.'); }
  if (context.expectedField && !body.message.includes('?') && !/^(?:what|how|why|can|could|should|would|tell|show|do|is|are)\b/i.test(text)) {
    const field = context.expectedField;
    if (field === 'customer.name' && /^[\p{L}][\p{L} .'-]{0,99}$/u.test(text)
      && text.split(/\s+/).length <= 5 && !/\b(no|yes|cancel|maybe|not|know|help|stop|what|why|how|can|could|i|want|please)\b/i.test(text)) return { order: { customer: { name: text } } };
    if (field === 'customer.phone' && /^[+\d ()-.]+$/.test(text)) return { order: { customer: { phone: text } } };
    if (field === 'customer.address' && /\d/.test(text) && /\p{L}/u.test(text) && text.length >= 8 && text.length <= 500) return { order: { customer: { address: text } } };
    if (['delivery.apartment', 'delivery.instructions'].includes(field) && /^(?:none|no unit|no instructions)$/i.test(text)) return { order: { delivery: { [field.split('.')[1]]: '' } } };
  }
  return answer('I’m not sure what you mean yet. Are you asking about a menu item, choosing something to drink, or changing your order? Tell me a little more, and I’ll help.');
}

module.exports = { interpretMessage };
