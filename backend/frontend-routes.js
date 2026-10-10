const { readFile } = require('node:fs/promises');
const path = require('node:path');
const assets = new Map([
  ['/', 'index.html'], ['/index.html', 'index.html'], ['/styles.css', 'styles.css'], ['/app.js', 'app.js'],
  ['/chat.html', 'chat.html'], ['/chat.css', 'chat.css'], ['/chat.js', 'chat.js'],
]);
async function handleFrontend(request, response) {
  const file = assets.get(new URL(request.url, 'http://localhost').pathname);
  if (!file) return false;
  if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end(); return true; }
  try {
    const content = await readFile(path.join(__dirname, '..', 'frontend', file));
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript';
    response.writeHead(200, {
      'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://images.unsplash.com; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
    });
    response.end(content);
  } catch { response.writeHead(500); response.end('Could not load the website.'); }
  return true;
}
module.exports = { handleFrontend };
