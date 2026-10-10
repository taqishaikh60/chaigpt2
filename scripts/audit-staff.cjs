const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { readFile, writeFile, unlink } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createServer } = require('../backend/server');
const { createOrderSessions } = require('../backend/order-state');
const { createOrderStore } = require('../backend/order-store');
const { confirmOrder } = require('../backend/test-helpers.cjs');
const menu = require('../data/menu.json');

(async () => {
  const file = path.join(os.tmpdir(), `cafebot-staff-ui-${randomUUID()}.json`);
  const sessions = createOrderSessions();
  const draft = sessions.update(undefined, {
    items: [{ itemId: 'americano', quantity: 2, options: ['extra-shot'] }], orderType: 'delivery',
    customer: { name: 'Alex <script>bad()</script>', phone: '503-555-0100', address: '24 Maple Street, Portland OR 97205' },
    delivery: { apartment: 'Unit 4B', instructions: 'Ring the bell' },
  }, menu);
  sessions.update(draft.sessionId, { delivery: { addressConfirmed: true } }, menu);
  const confirmed = confirmOrder(sessions, draft.sessionId, menu);
  await createOrderStore(file).save(confirmed.sessionId, confirmed.order, menu);
  const server = createServer({ ordersPath: file });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/staff`);
    await page.getByText('1 saved order.', { exact: true }).waitFor();
    assert.ok(await page.getByText('Alex <script>bad()</script>', { exact: true }).isVisible());
    assert.ok(await page.getByText('24 Maple Street, Portland OR 97205', { exact: true }).isVisible());
    assert.equal(await page.locator('.order script').count(), 0);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
      const button = await page.getByRole('button', { name: 'Update status' }).boundingBox();
      assert.ok(button.height >= 44);
    }
    await page.getByLabel('Order status').selectOption('ready');
    await page.getByRole('button', { name: 'Update status' }).click();
    await page.getByText('Status saved: Ready.', { exact: true }).waitFor();
    assert.equal(JSON.parse(await readFile(file, 'utf8'))[0].status, 'ready');
    await page.getByRole('button', { name: 'Refresh orders' }).click();
    await page.getByText('1 saved order.', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Order status').inputValue(), 'ready');
    await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'ui-audit', 'staff-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'ui-audit', 'staff-mobile.png'), fullPage: true });
    await writeFile(file, '[]');
    await page.getByRole('button', { name: 'Refresh orders' }).click();
    await page.getByText('No confirmed orders yet.', { exact: true }).waitFor();
    await writeFile(file, '{bad');
    await page.getByRole('button', { name: 'Refresh orders' }).click();
    await page.getByText('Could not load orders. Use Refresh orders to try again.', { exact: true }).waitFor();
    console.log('Staff UI passed: responsive layout, safe text, status persistence, empty and error states.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await unlink(file).catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
