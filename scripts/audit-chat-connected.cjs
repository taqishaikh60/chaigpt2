const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { writeFile, readFile, unlink } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { createServer } = require('../backend/server');

(async () => {
  const file = path.join(os.tmpdir(), `zara-ui-${randomUUID()}.json`);
  await writeFile(file, '[]');
  const server = createServer({ ordersPath: file });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
    const productQuestion = page.getByRole('button', { name: 'Ask Zara about House Espresso', exact: true });
    await productQuestion.click();
    const chat = page.frameLocator('.zara-frame');
    await chat.locator('.bot-message').last().filter({ hasText: 'House Espresso' }).waitFor();
    assert.match(await chat.locator('.bot-message').last().textContent(), /3\.50/);
    await page.getByRole('button', { name: 'Close Zara chat', exact: true }).click();
    assert.ok(await productQuestion.evaluate(node => document.activeElement === node));
    await page.getByRole('button', { name: 'Ask Zara about Vanilla Cloud Latte', exact: true }).click();
    await chat.locator('.bot-message').last().filter({ hasText: 'Vanilla Cloud Latte' }).waitFor();
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), []);
    const send = async text => {
      await chat.locator('#message').fill(text);
      await chat.getByRole('button', { name: 'Send', exact: true }).click();
      await chat.locator('#chat-status').filter({ hasText: /^$/ }).waitFor({ state: 'attached' });
    };
    await send('Could you add large Americanos?');
    await chat.getByRole('button', { name: 'Two please', exact: true }).click();
    await chat.locator('.bot-message').last().filter({ hasText: 'Added 2' }).waitFor();
    await send('make it small');
    await chat.locator('.bot-message').last().filter({ hasText: 'Updated Americano' }).waitFor();
    await send('remove 2 Americanos');
    await send('What is the price of a large Vanilla Cloud Latte?');
    assert.match(await chat.locator('.bot-message').last().textContent(), /USD 6.25/);
    await chat.locator('#message').fill('preserve my draft');
    await chat.getByRole('button', { name: /Explore the menu/ }).click();
    await chat.locator('.bot-message').last().filter({ hasText: 'Blueberry Muffin' }).waitFor();
    assert.equal(await chat.locator('#message').inputValue(), 'preserve my draft');
    await send('add 2 large Americanos');
    await chat.getByRole('button', { name: 'Pickup', exact: true }).click();
    await chat.getByLabel('Customer name', { exact: true }).fill('Alex <script>bad()</script>');
    await chat.getByRole('button', { name: 'Save details' }).click();
    await chat.getByRole('button', { name: 'Review order', exact: true }).last().click();
    const confirm = chat.getByRole('button', { name: 'Confirm this sample order', exact: true });
    await confirm.waitFor();
    assert.equal(await chat.locator('.conversation script').count(), 0);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), []);
    await send('maybe');
    assert.ok(await confirm.isDisabled());
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), []);
    await chat.getByRole('button', { name: 'Checkout', exact: true }).click();
    await chat.locator('.reply-controls:not([data-superseded="true"])').getByRole('button', { name: 'Confirm this sample order', exact: true }).click();
    await chat.locator('.bot-message').last().filter({ hasText: 'saved with ID' }).waitFor();
    assert.equal(JSON.parse(await readFile(file, 'utf8')).length, 1);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await chat.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Chat overflow at ${width}`);
      assert.ok((await chat.getByRole('button', { name: 'Send', exact: true }).boundingBox()).height >= 44);
    }
    await page.screenshot({ path: path.join(__dirname, '../docs/ui-audit/zara-connected-mobile.png') });
    await page.route('**/api/chat', route => route.abort());
    await send('Show my order');
    assert.equal(await chat.locator('#message').inputValue(), 'Show my order');
    assert.ok(await chat.getByRole('button', { name: 'Retry this message' }).isVisible());
    await page.unroute('**/api/chat');
    await chat.getByRole('button', { name: 'Retry this message' }).click();
    await chat.locator('.bot-message').last().filter({ hasText: 'Current draft' }).waitFor();
    assert.deepEqual(errors, []);
    console.log('Connected Zara UI passed: real replies, preserved input, pickup details, review/confirmation, safe text, responsive layout, network failure and retry.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await unlink(file).catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
