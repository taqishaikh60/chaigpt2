// Run with Node and Playwright available on NODE_PATH. Uses installed Edge.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs', 'ui-audit');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, 'frontend', 'index.html')).href);
    await page.evaluate(() => document.fonts.ready);
    const layouts = [];
    for (const width of [320, 375, 390, 600, 768, 860, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        smallTargets: [...document.querySelectorAll('a')]
          .filter(a => a.getBoundingClientRect().height < 44 || a.getBoundingClientRect().width < 44)
          .map(a => a.textContent.trim()),
        brokenAnchors: [...document.querySelectorAll('a[href^="#"]')]
          .filter(a => a.hash && !document.getElementById(a.hash.slice(1)))
          .map(a => a.hash),
        cards: document.querySelectorAll('.menu-card').length,
        menuImageHeights: [...document.querySelectorAll('.menu-photo')].map(photo => photo.getBoundingClientRect().height),
      }));
      assert.ok(layout.scrollWidth <= width, `Horizontal overflow at ${width}px`);
      assert.equal(layout.smallTargets.length, 0, `Small links at ${width}px`);
      assert.equal(layout.brokenAnchors.length, 0, 'Broken section links');
      assert.equal(layout.cards, 3, 'Menu content missing');
      if (width > 860) {
        assert.ok(Math.max(...layout.menuImageHeights) - Math.min(...layout.menuImageHeights) < 1, 'Uneven menu images');
      }
      layouts.push(layout);
    }
    // Scroll lazy images into view before capturing the full page.
    for (const image of await page.locator('img').all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate(img => img.decode().catch(() => {}));
    }
    const images = await page.locator('img').evaluateAll(images => images.map(img => ({
      alt: img.alt, loaded: img.complete && img.naturalWidth > 0, responsive: Boolean(img.srcset && img.sizes),
    })));
    assert.ok(images.every(img => img.responsive), 'Missing responsive image sources');
    for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 768, 1024], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: path.join(output, `after-${name}.png`), fullPage: true });
      if (name === 'mobile') {
        await page.screenshot({ path: path.join(output, 'after-mobile-first-screen.png') });
      }
    }
    await page.reload();
    await page.keyboard.press('Tab');
    assert.equal(await page.locator(':focus').innerText(), 'Skip to content');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator(':focus').getAttribute('id'), 'main');
    await page.getByRole('link', { name: 'Find your usual' }).click();
    assert.ok(page.url().endsWith('#menu'), 'Hero CTA failed');
    await page.getByRole('link', { name: 'Come on over' }).click();
    assert.ok(page.url().endsWith('#visit'), 'Visit navigation failed');
    const directions = page.getByRole('link', { name: 'Get directions' });
    assert.match(await directions.getAttribute('href'), /^https:\/\/www.google.com\/maps\/search/);
    assert.match(await directions.getAttribute('rel'), /noopener/);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
    await page.setViewportSize({ width: 320, height: 900 });
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    // Double each computed font size once; a universal percentage rule would
    // compound on nested elements and would not model text enlargement correctly.
    await page.evaluate(() => {
      const sizes = [...document.querySelectorAll('body, body *')]
        .map(element => [element, parseFloat(getComputedStyle(element).fontSize)]);
      sizes.forEach(([element, size]) => element.style.setProperty('font-size', `${size * 2}px`, 'important'));
    });
    await page.addStyleTag({ content: '* { letter-spacing: .12em !important; word-spacing: .16em !important; line-height: 1.5 !important; } p { margin-bottom: 2em !important; }' });
    const textReflow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(textReflow.scrollWidth <= textReflow.width, 'Enlarged text causes horizontal overflow');
    await page.screenshot({ path: path.join(output, 'after-text-reflow.png'), fullPage: true });
    assert.equal(errors.length, 0, 'Browser runtime errors');
    const result = {
      layouts, images, textReflow, errors,
      checks: ['44×44px link targets', 'no horizontal overflow', 'section anchors', 'menu content',
        'keyboard skip link', 'hero and visit navigation', 'directions destination and isolation', 'reduced motion',
        'responsive image sources', '200% text with spacing overrides at 320px'],
      note: 'External map destination is inspected without opening it. Full screen-reader and WCAG audits are manual follow-ups.',
    };
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
