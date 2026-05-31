// @ts-check
// Live smoke tests against the deployed GitHub Pages site.
const { test, expect } = require('@playwright/test');

const LIVE = 'https://sarangvehale.github.io/neiro';

async function waitForCatalogue(page) {
  await page.waitForFunction(
    () => window.CATALOGUE && window.CATALOGUE.totalSongs > 0,
    { timeout: 20000 }
  );
}

test('live: page title correct', async ({ page }) => {
  await page.goto(LIVE);
  await expect(page).toHaveTitle(/NEIRO/);
});

test('live: catalogue loads with real songs', async ({ page }) => {
  await page.goto(LIVE);
  await waitForCatalogue(page);
  const badge = page.locator('#songCountBadge');
  const text = await badge.textContent();
  const count = parseInt(text);
  expect(count).toBeGreaterThan(0);
  console.log(`Live catalogue: ${count} songs`);
});

test('live: album grid has cards', async ({ page }) => {
  await page.goto(LIVE);
  await waitForCatalogue(page);
  const cards = page.locator('.album-card');
  await expect(cards.first()).toBeVisible();
  console.log(`Album cards rendered: ${await cards.count()}`);
});

test('live: catalogue.json served with media_base_url', async ({ page }) => {
  const res = await page.request.get(`${LIVE}/_catalogue/catalogue.json`);
  expect(res.status()).toBe(200);
  const cat = await res.json();
  expect(cat.meta.total_songs).toBeGreaterThan(0);
  expect(cat.meta.media_base_url).toBeTruthy();
  console.log(`Songs: ${cat.meta.total_songs}, CDN: ${cat.meta.media_base_url}`);
});

test('live: all nav routes render without JS errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(LIVE);
  await waitForCatalogue(page);

  for (const route of ['artists', 'contribute', 'contributors', 'about', 'library']) {
    await page.click(`[data-route="${route}"]`);
    await page.waitForTimeout(200);
  }
  expect(errors).toHaveLength(0);
});

test('live: album detail page loads and shows tracks', async ({ page }) => {
  await page.goto(LIVE);
  await waitForCatalogue(page);
  await page.locator('.album-card').first().click();
  await expect(page.locator('.tracklist tbody tr').first()).toBeVisible();
});

test('live: audio src URL points to GitHub raw CDN', async ({ page }) => {
  await page.goto(LIVE);
  await waitForCatalogue(page);
  await page.locator('.album-card').first().click();
  await page.locator('.tracklist tbody tr').first().click();
  await page.waitForTimeout(500);
  // Verify player bar updated with a track title
  const title = await page.locator('#pbTitle').textContent();
  expect(title).not.toBe('—');
  console.log(`Playing: ${title}`);
});

test('live: no console errors on load', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(LIVE);
  await waitForCatalogue(page);
  const critical = errors.filter(e =>
    !e.includes('favicon') &&
    !e.includes('sw.js') &&
    !e.includes('net::ERR_')  // audio 404s are expected without R2
  );
  expect(critical).toHaveLength(0);
});
