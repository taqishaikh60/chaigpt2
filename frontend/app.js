// Embed Zara's menu assistant; opening and closing never submits an order.
const launcher = document.querySelector('.zara-launcher');
const panel = document.querySelector('#zara-panel');
const closeButton = document.querySelector('.zara-close');
const frame = document.querySelector('.zara-frame');
let frameReady = false;
let pendingPrompt;
let returnFocus = launcher;

function deliverPrompt() {
  if (frameReady && pendingPrompt) {
    frame.contentWindow.postMessage({ type: 'cafebot:menu-question', prompt: pendingPrompt }, window.location.origin);
    pendingPrompt = undefined;
  }
}
frame.addEventListener('load', () => { frameReady = true; deliverPrompt(); });
function openChat(trigger = launcher, prompt) {
  returnFocus = trigger;
  if (prompt) pendingPrompt = prompt;
  if (!frame.hasAttribute('src')) frame.src = 'chat.html?embedded=1';
  panel.hidden = false;
  launcher.setAttribute('aria-expanded', 'true');
  closeButton.focus();
  deliverPrompt();
}

function closeChat() {
  panel.hidden = true;
  launcher.setAttribute('aria-expanded', 'false');
  returnFocus.focus();
}

launcher.hidden = false;
launcher.addEventListener('click', () => {
  if (!panel.hidden) {
    closeChat();
    return;
  }
  openChat();
});
document.querySelectorAll('[data-open-zara]').forEach(button => {
  button.addEventListener('click', () => openChat(button));
});
document.querySelectorAll('.menu-card').forEach(card => {
  const name = card.querySelector('h3').textContent;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-question';
  button.setAttribute('aria-label', `Ask Zara about ${name}`);
  button.textContent = 'Ask Zara about this ↗';
  button.addEventListener('click', () => openChat(button, `Tell me about ${name}`));
  card.querySelector('.menu-card-body').append(button);
});
closeButton.addEventListener('click', closeChat);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !panel.hidden) closeChat();
});
window.addEventListener('message', event => {
  if (event.source === frame.contentWindow && event.data?.type === 'cafebot:close-chat' && !panel.hidden) closeChat();
});
