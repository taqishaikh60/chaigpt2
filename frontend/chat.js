const form = document.querySelector('.composer');
const input = document.querySelector('#message');
const sendButton = document.querySelector('.send-button');
const conversation = document.querySelector('.conversation');
const status = document.querySelector('#chat-status');
const embedded = new URLSearchParams(window.location.search).get('embedded') === '1';
let sessionId;
let busy = false;
let history = [];
if (embedded) {
  document.documentElement.classList.add('embedded-chat');
  document.querySelector('#chat-title').textContent = 'Zara';
  document.querySelector('.avatar').textContent = 'z.';
  document.querySelector('.speaker').textContent = 'Zara';
  conversation.setAttribute('aria-label', 'Conversation with Zara');
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') window.parent.postMessage({ type: 'cafebot:close-chat' }, window.location.origin);
  });
}

function appendMessage(text, customer) {
  const article = document.createElement('article');
  article.className = `message ${customer ? 'customer-message' : 'bot-message'}`;
  const speaker = document.createElement('p');
  speaker.className = 'speaker';
  speaker.textContent = customer ? 'You' : 'Zara';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const copy = document.createElement('p');
  copy.textContent = text;
  bubble.append(copy);
  article.append(speaker, bubble);
  conversation.append(article);
  return bubble;
}

function updateBusy(value) {
  busy = value;
  sendButton.disabled = busy || !input.value.trim();
  document.querySelectorAll('[data-prompt], .reply-controls button').forEach(button => {
    button.disabled = busy || button.closest('.reply-controls')?.dataset.superseded === 'true';
  });
  status.textContent = busy ? 'Zara is checking your request…' : '';
}

function replyControls(bubble, data) {
  const controls = document.createElement('div');
  controls.className = 'reply-controls';
  const action = (label, patch, message) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => sendMessage(message || label, patch));
    controls.append(button);
  };
  if (data.confirmationToken && data.reviewSummary?.readyForConfirmation) {
    action('Confirm this sample order', { order: { confirmed: true, confirmationToken: data.confirmationToken } });
  }
  const fields = data.requiredFields || [];
  if (Array.isArray(data.suggestions)) {
    data.suggestions.slice(0, 4).filter(value => typeof value === 'string' && value.length <= 1000)
      .forEach(value => action(value, {}, value));
  }
  if (fields.includes('orderType')) {
    action('Pickup', { order: { orderType: 'pickup' } });
    action('Delivery', { order: { orderType: 'delivery' } });
    action('Dine in', { order: { orderType: 'dine_in' } });
  }
  if (fields.length === 1 && fields[0] === 'delivery.addressConfirmed') {
    action('This address is correct', { order: { delivery: { addressConfirmed: true } } });
  }
  const labels = {
    'customer.name': ['Customer name', 'text', 100], 'customer.phone': ['Phone number', 'tel', 100],
    'customer.address': ['Full delivery address', 'text', 500],
    'delivery.apartment': ['Apartment / unit (or none)', 'text', 100],
    'delivery.instructions': ['Delivery instructions (or none)', 'text', 500],
  };
  const required = fields.filter(field => labels[field]);
  if (required.length) {
    const details = document.createElement('form');
    details.className = 'details-form';
    const inputs = [];
    required.forEach(field => {
      const [labelText, type, maxLength] = labels[field];
      const label = document.createElement('label');
      label.textContent = labelText;
      const fieldInput = document.createElement('input');
      fieldInput.type = type;
      fieldInput.maxLength = maxLength;
      fieldInput.required = true;
      label.append(fieldInput);
      details.append(label);
      inputs.push([field, fieldInput]);
    });
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Save details';
    details.append(save);
    details.addEventListener('submit', event => {
      event.preventDefault();
      const order = {};
      for (const [field, fieldInput] of inputs) {
        const [group, key] = field.split('.');
        const value = fieldInput.value.trim();
        if (!value) { fieldInput.focus(); return; }
        order[group] ||= {};
        order[group][key] = group === 'delivery' && /^none$/i.test(value) ? '' : value;
      }
      sendMessage('Save my fulfillment details', { order });
    });
    controls.append(details);
  }
  if (data.mode === 'order' && !data.needsInput && !data.reviewSummary && !data.savedOrder && data.order?.items.length) {
    action('Review order', { review: true });
  }
  if (controls.childElementCount) bubble.append(controls);
}

async function sendMessage(text, patch = {}, clearDraft = false) {
  if (busy) return false;
  updateBusy(true);
  appendMessage(text, true);
  conversation.scrollTop = conversation.scrollHeight;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ message: text, history: history.slice(-20), sessionId, ...patch }),
    });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) throw new Error('Open the website at http://127.0.0.1:3000 so Zara can reach the chat server.');
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 404 && /session/i.test(data.error || '')) {
        sessionId = undefined;
        history = [];
      }
      throw new Error(data.error || 'Zara could not process this request. Please try again.');
    }
    if (typeof data.reply !== 'string') throw new Error('The chat server returned an invalid reply. Please try again.');
    sessionId = data.sessionId;
    history.push({ role: 'user', content: text }, { role: 'assistant', content: data.reply.slice(0, 4000) });
    history = history.slice(-20);
    document.querySelectorAll('.reply-controls').forEach(controls => {
      controls.dataset.superseded = 'true';
      controls.querySelectorAll('button, input').forEach(control => { control.disabled = true; });
    });
    const bubble = appendMessage(data.reply, false);
    replyControls(bubble, data);
    if (clearDraft && input.value.trim() === text) input.value = '';
    return true;
  } catch (error) {
    const message = error.name === 'AbortError' ? 'The request timed out. Your message is preserved. Please try again.'
      : error instanceof TypeError ? 'Cannot reach Zara. Start the chat server and open http://127.0.0.1:3000, then retry.' : error.message;
    const bubble = appendMessage(message, false);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'retry-button';
    retry.textContent = 'Retry this message';
    retry.addEventListener('click', () => { retry.disabled = true; sendMessage(text, patch, clearDraft); });
    bubble.append(retry);
    return false;
  } finally {
    clearTimeout(timeout);
    updateBusy(false);
    conversation.scrollTop = conversation.scrollHeight;
    input.focus();
  }
}

input.addEventListener('input', () => { sendButton.disabled = busy || !input.value.trim(); });
form.addEventListener('submit', event => {
  event.preventDefault();
  const text = input.value.trim();
  if (text && text.length <= 1000) sendMessage(text, {}, true);
});
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing) {
    event.preventDefault();
    if (input.value.trim() && !busy) form.requestSubmit();
  }
});
document.querySelectorAll('[data-prompt]').forEach(button => {
  button.disabled = false;
  button.addEventListener('click', () => sendMessage(button.dataset.prompt));
});
input.disabled = false;
if (embedded) {
  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin || event.source !== window.parent
      || event.data?.type !== 'cafebot:menu-question') return;
    const prompt = event.data.prompt;
    if (typeof prompt === 'string' && prompt.length > 0 && prompt.length <= 1000) sendMessage(prompt);
  });
}
