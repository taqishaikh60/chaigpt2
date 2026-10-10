const ordersArea = document.querySelector('#orders');
const feedback = document.querySelector('#feedback');
const refresh = document.querySelector('#refresh');
const labels = { confirmed: 'Confirmed', preparing: 'Preparing', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled' };
let saving = 0;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function detail(list, label, value) {
  list.append(element('dt', label), element('dd', value === null || value === undefined ? 'Not provided' : value === '' ? 'None specified' : value));
}

function renderOrder(record, statuses) {
  const order = record.order;
  const card = element('article', undefined, 'order');
  const heading = element('div', undefined, 'order-heading');
  const title = element('div');
  title.append(element('h2', `Order ${record.id}`), element('p', new Date(record.timestamp).toLocaleString(), 'timestamp'));
  const badge = element('span', labels[record.status], 'badge');
  heading.append(title, badge);
  const body = element('div', undefined, 'order-body');
  const items = element('section');
  items.append(element('h3', 'Items'));
  const list = element('ul');
  for (const line of order.items) {
    const item = element('li', `${line.quantity} × ${line.name}`);
    item.append(element('span', [line.size, ...(line.options || [])].join(' · '), 'item-options'));
    list.append(item);
  }
  items.append(list);
  const fulfillment = element('section');
  fulfillment.append(element('h3', order.orderType === 'dine_in' ? 'Dine in' : order.orderType === 'delivery' ? 'Delivery' : 'Pickup'));
  const details = element('dl');
  detail(details, 'Customer', order.customer.name || 'Not provided');
  if (order.orderType === 'pickup') detail(details, 'Requested time', order.pickupTime || 'No preference');
  if (order.orderType === 'delivery') {
    detail(details, 'Phone', order.customer.phone);
    detail(details, 'Address', order.customer.address);
    detail(details, 'Apartment / unit', order.delivery.apartment);
    detail(details, 'Instructions', order.delivery.instructions);
  }
  fulfillment.append(details);
  const actions = element('section', undefined, 'order-actions');
  actions.append(element('h3', order.totalType === 'sample_total' ? 'Sample total' : 'Total'), element('p', `${order.currency} ${order.total.toFixed(2)}`, 'total'));
  const form = element('form', undefined, 'status-form');
  const select = element('select');
  select.id = `status-${record.id}`;
  const label = element('label', 'Order status');
  label.htmlFor = select.id;
  for (const status of statuses) {
    const option = element('option', labels[status]);
    option.value = status;
    select.append(option);
  }
  select.value = record.status;
  const button = element('button', 'Update status');
  button.type = 'submit';
  const message = element('p', '', 'form-feedback');
  message.setAttribute('role', 'status');
  form.append(label, select, button, message);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    button.disabled = select.disabled = true;
    refresh.disabled = true;
    saving += 1;
    message.classList.remove('error');
    message.textContent = 'Saving status…';
    try {
      const response = await fetch(`/api/staff/orders/${encodeURIComponent(record.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: select.value }),
      });
      if (!response.ok) throw new Error('Could not save status. Try again.');
      const result = await response.json();
      record.status = result.order.status;
      badge.textContent = labels[record.status];
      message.textContent = `Status saved: ${labels[record.status]}.`;
    } catch (error) {
      message.classList.add('error');
      message.textContent = error.message;
    } finally {
      button.disabled = select.disabled = false;
      saving -= 1;
      refresh.disabled = saving > 0;
    }
  });
  actions.append(form);
  body.append(items, fulfillment, actions);
  card.append(heading, body);
  return card;
}

async function loadOrders() {
  refresh.disabled = true;
  ordersArea.setAttribute('aria-busy', 'true');
  feedback.classList.remove('error');
  feedback.textContent = 'Loading orders…';
  try {
    const response = await fetch('/api/staff/orders');
    if (!response.ok) throw new Error('Could not load orders. Use Refresh orders to try again.');
    const data = await response.json();
    const cards = data.orders.slice().reverse().map(record => renderOrder(record, data.statuses));
    ordersArea.replaceChildren(...(cards.length ? cards : [element('p', 'No confirmed orders yet.', 'empty')]));
    feedback.textContent = `${cards.length} saved ${cards.length === 1 ? 'order' : 'orders'}.`;
  } catch (error) {
    feedback.classList.add('error');
    feedback.textContent = error.message;
  } finally {
    ordersArea.setAttribute('aria-busy', 'false');
    refresh.disabled = saving > 0;
  }
}

refresh.addEventListener('click', loadOrders);
loadOrders();
