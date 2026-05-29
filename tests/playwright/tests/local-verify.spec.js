// @ts-check
// Local verification suite against http://localhost:18080
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:18080';

async function waitCatalogue(page) {
  await page.waitForFunction(() => window.CATALOGUE && window.CATALOGUE.totalSongs > 0, { timeout: 10000 });
}

test('catalogue loads 496 songs', async ({ page }) => {
  await page.goto(BASE);
  await waitCatalogue(page);
  const badge = await page.locator('#songCountBadge').textContent();
  expect(parseInt(badge)).toBe(496);
  console.log('Badge:', badge);
});

test('album cards are compact and uniform', async ({ page }) => {
  await page.goto(BASE);
  await waitCatalogue(page);
  const card = page.locator('.album-card').first();
  const box = await card.boundingBox();
  console.log(`Card width: ${box.width.toFixed(0)}px`);
  expect(box.width).toBeLessThan(260);
  expect(box.width).toBeGreaterThan(100);
  const cards = await page.locator('.album-card').all();
  const widths = await Promise.all(cards.slice(0, 6).map(async c => (await c.boundingBox()).width));
  const maxDiff = Math.max(...widths) - Math.min(...widths);
  console.log(`Widths: ${widths.map(w => w.toFixed(0)).join(', ')} — diff: ${maxDiff.toFixed(1)}px`);
  expect(maxDiff).toBeLessThan(5);
});

test('29 album cards render cover <img> not kanji', async ({ page }) => {
  await page.goto(BASE);
  await waitCatalogue(page);
  const total = await page.locator('.album-card').count();
  const imgs = await page.locator('.album-card .art-wrap img').count();
  console.log(`Cards with <img>: ${imgs}/${total}`);
  expect(imgs).toBeGreaterThan(20);
});

test('track paths are URL-encoded at runtime', async ({ page }) => {
  await page.goto(BASE);
  await waitCatalogue(page);
  const path = await page.evaluate(() => {
    const album = window.CATALOGUE.allAlbums.find(a => a.tracks.some(t => t.path.includes('%')));
    return album ? album.tracks[0].path : null;
  });
  console.log('Encoded path sample:', path ? path.substring(0, 100) : 'NONE');
  expect(path).not.toBeNull();
  expect(path).toContain('%20');
  expect(path).not.toContain(' ');
});

test('coverUrl is encoded — no raw spaces', async ({ page }) => {
  await page.goto(BASE);
  await waitCatalogue(page);
  const url = await page.evaluate(() => {
    const album = window.CATALOGUE.allAlbums.find(a => a.coverUrl);
    return album ? album.coverUrl : null;
  });
  console.log('CoverUrl:', url ? url.substring(0, 100) : 'none');
  if (url) {
    expect(url).not.toContain(' ');
    expect(url).toContain('media.githubusercontent.com');
    expect(url).toContain('%');
  }
});

test('clicking track updates player bar title', async ({ page }) => {
  await page.goto(BASE);
  await waitCatalogue(page);
  await page.locator('.album-card').first().click();
  await expect(page.locator('.tracklist tbody tr').first()).toBeVisible();
  await page.locator('.tracklist tbody tr').first().click();
  await page.waitForTimeout(500);
  const title = await page.locator('#pbTitle').textContent();
  console.log('Player bar title after click:', title);
  expect(title).not.toBe('—');
  expect(title.length).toBeGreaterThan(0);
});

test('full-screen player opens on player bar click', async ({ page }) => {
  await page.goto(BASE);
  await waitCatalogue(page);
  await page.locator('.album-card').first().click();
  await page.locator('.tracklist tbody tr').first().click();
  await page.waitForTimeout(400);
  await expect(page.locator('.full-player')).not.toHaveClass(/open/);
  await page.locator('.pb-track').click();
  await page.waitForTimeout(350);
  await expect(page.locator('.full-player')).toHaveClass(/open/);
  const fpTitle = await page.locator('#fpTitle').textContent();
  const fpArtist = await page.locator('#fpArtist').textContent();
  console.log(`Full player: "${fpTitle}" by "${fpArtist}"`);
  expect(fpTitle).not.toBe('—');
});

test('full-screen player closes on chevron-down', async ({ page }) => {
  await page.goto(BASE);
  await waitCatalogue(page);
  await page.locator('.album-card').first().click();
  await page.locator('.tracklist tbody tr').first().click();
  await page.waitForTimeout(300);
  await page.locator('.pb-track').click();
  await page.waitForTimeout(350);
  await expect(page.locator('.full-player')).toHaveClass(/open/);
  await page.locator('#fpDown').click();
  await page.waitForTimeout(350);
  await expect(page.locator('.full-player')).not.toHaveClass(/open/);
  console.log('Full player closed ✓');
});

test('hamburger menu: nav hidden, mobile nav opens at 375px', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await waitCatalogue(page);
  expect(await page.locator('.nav-links').isVisible()).toBe(false);
  expect(await page.locator('#navToggle').isVisible()).toBe(true);
  await page.locator('#navToggle').click();
  await page.waitForTimeout(250);
  const open = await page.locator('.mobile-nav').evaluate(el => el.classList.contains('open'));
  expect(open).toBe(true);
  const links = await page.locator('.mobile-nav a').count();
  console.log(`Mobile nav: ${links} links`);
  expect(links).toBeGreaterThanOrEqual(5);
  await ctx.close();
});

test('2-column card grid at 375px', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await waitCatalogue(page);
  const boxes = await Promise.all(
    (await page.locator('.album-card').all()).slice(0, 4).map(c => c.boundingBox())
  );
  console.log(`Card tops: ${boxes.map(b => b.y.toFixed(0)).join(', ')}`);
  expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(5);    // same row
  expect(Math.abs(boxes[2].y - boxes[0].y)).toBeGreaterThan(50); // new row
  await ctx.close();
});

test('no console errors on load', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE);
  await waitCatalogue(page);
  const critical = errors.filter(e =>
    !e.includes('favicon') && !e.includes('sw.js') && !e.includes('net::ERR_')
  );
  if (critical.length) console.log('Errors:', critical);
  expect(critical).toHaveLength(0);
});
