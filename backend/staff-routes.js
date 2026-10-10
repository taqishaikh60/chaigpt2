const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { ORDER_STATUSES } = require('./order-store');

const publicRecord = ({ confirmationKey, ...record }) => record;

async function handleStaff(request, response, store, sendJson) {
  const assets = {
    '/staff': ['staff.html', 'text/html; charset=utf-8'],
    '/staff/': ['staff.html', 'text/html; charset=utf-8'],
    '/staff.css': ['staff.css', 'text/css; charset=utf-8'],
    '/staff.js': ['staff.js', 'text/javascript; charset=utf-8'],
  };
  const asset = assets[request.url];
  const list = request.url === '/api/staff/orders';
  const update = /^\/api\/staff\/orders\/([0-9a-f-]{36})$/i.exec(request.url);
  if (!asset && !list && !update) return false;
  const method = update ? 'PATCH' : 'GET';
  if (request.method !== method) {
    response.setHeader('Allow', method);
    sendJson(response, 405, { error: `Use ${method}.` });
    return true;
  }
  try {
    if (asset) {
      const source = await readFile(path.join(__dirname, '..', 'frontend', asset[0]));
      response.writeHead(200, {
        'Content-Type': asset[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      });
      response.end(source);
    } else if (list) {
      sendJson(response, 200, { orders: (await store.list()).map(publicRecord), statuses: ORDER_STATUSES });
    } else {
      if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) {
        sendJson(response, 403, { error: 'Status updates must come from this staff dashboard.' });
        return true;
      }
      if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        sendJson(response, 415, { error: 'Send Content-Type: application/json.' });
        return true;
      }
      let bytes = 0;
      const chunks = [];
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 8192) { sendJson(response, 413, { error: 'Request body exceeds 8 KB.' }); return true; }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { sendJson(response, 400, { error: 'Request body must be valid JSON.' }); return true; }
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).length !== 1 || !ORDER_STATUSES.includes(body.status)) {
        sendJson(response, 400, { error: 'Provide one valid order status.' });
        return true;
      }
      const record = await store.updateStatus(update[1], body.status);
      sendJson(response, record ? 200 : 404, record ? { order: publicRecord(record) } : { error: 'Order not found.' });
    }
  } catch {
    sendJson(response, 500, { error: 'Could not load or update staff orders. Try again.' });
  }
  return true;
}

module.exports = { handleStaff };
