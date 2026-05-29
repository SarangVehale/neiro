// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:18080';

// ── Helpers ────────────────────────────────────────────────────────────────
async function waitForCatalogue(page) {
  await page.waitForFunction(() => window.CATALOGUE && window.CATALOGUE.totalSongs > 0, { timeout: 10000 });
}

// ── Boot & initial render ──────────────────────────────────────────────────
test('page loads with correct title', async ({ page }) => {
  await page.goto(BASE);
  await expect(page).toHaveTitle(/HIBIKI/);
});

test('catalogue loads and song count badge is populated', async ({ page }) => {
  await page.goto(BASE);
  await waitForCatalogue(page);
  const badge = page.locator('#songCountBadge');
  await expect(badge).not.toHaveText('— songs');
  const text = await badge.textContent();
  expect(parseInt(text)).toBeGreaterThan(0);
});

test('album grid renders at least one album card', async ({ page }) => {
  await page.goto(BASE);
  await waitForCatalogue(page);
  const cards = page.locator('.album-card');
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
  console.log(`Rendered ${count} album cards`);
});

// ── Navigation ─────────────────────────────────────────────────────────────
test('nav links switch views', async ({ page }) => {
  await page.goto(BASE);
  await waitForCatalogue(page);

  // Artists view
  await page.click('[data-route="artists"]');
  await expect(page.locator('.artist-listing')).toBeVisible();

  // Contribute view
  await page.click('[data-route="contribute"]');
  await expect(page.locator('.contribute-layout')).toBeVisible();

  // Contributors view
  await page.click('[data-route="contributors"]');
  await expect(page.locator('.contrib-layout')).toBeVisible();

  // About view
  await page.click('[data-route="about"]');
  await expect(page.locator('.about-layout')).toBeVisible();

  // Back to Library
  await page.click('[data-route="library"]');
  await expect(page.locator('.album-grid')).toBeVisible();
});

test('logo click returns to library', async ({ page }) => {
  await page.goto(BASE);
  await waitForCatalogue(page);
  await page.click('[data-route="artists"]');
  await expect(page.locator('.artist-listing')).toBeVisible();
  await page.click('.nav-logo');
  await expect(page.locator('.album-grid')).toBeVisible();
});

// ── Album detail ───────────────────────────────────────────────────────────
test('clicking an album card opens album detail page', async ({ page }) => {
  await page.goto(BASE);
  await waitForCatalogue(page);
  await page.locator('.album-card').first().click();
  await expect(page.locator('.album-page')).toBeVisible();
  await expect(page.locator('.tracklist')).toBeVisible();
  const rows = page.locator('.tracklist tbody tr');
  expect(await rows.count()).toBeGreaterThan(0);
});

test('album back button returns to library', async ({ page }) => {
  await page.goto(BASE);
  await waitForCatalogue(page);
  await page.locator('.album-card').first().click();
  await expect(page.locator('.album-page')).toBeVisible();
  await page.click('.album-back');
  await expect(page.locator('.album-grid')).toBeVisible();
});

// ── Artist navigation ──────────────────────────────────────────────────────
test('artists page lists all artists with stats', async ({ page }) => {
  await page.goto(BASE);
  await waitForCatalogue(page);
  await page.click('[data-route="artists"]');
  const rows = page.locator('.artist-row');
  expect(await rows.count()).toBeGreaterThan(0);
  // Each row should show album/track counts
  const firstRow = rows.first();
  await expect(firstRow.locator('.ar-stats')).toBeVisible();
});

test('clicking artist row opens artist detail', async ({ page }) => {
  await page.goto(BASE);
  await waitForCatalogue(page);
  await page.click('[data-route="artists"]');
  await page.locator('.artist-row').first().click();
  await expect(page.locator('.artist-page')).toBeVisible();
  await expect(page.locator('.album-grid')).toBeVisible();
});

// ── Search and filters ─────────────────────────────────────────────────────
test('search filters the album grid', async ({ page }) => {
  await page.goto(BASE);
  await waitForCatalogue(page);
  const initialCount = await page.locator('.album-card').count();

  await page.fill('#searchInput', 'zzz_no_match_xyz');
  await expect(page.locator('.empty-state')).toBeVisible();

  await page.fill('#searchInput', '');
  expect(await page.locator('.album-card').count()).toBe(initialCount);
});

test('/ shortcut focuses search', async ({ page }) => {
  await page.goto(BASE);
  await waitForCatalogue(page);
  await page.keyboard.press('/');
  const input = page.locator('#searchInput');
  await expect(input).toBeFocused();
});

test('format filter buttons work', async ({ page }) => {
  await page.goto(BASE);
  await waitForCatalogue(page);
  // Click first non-"All" format filter if it has a count > 0
  const filters = page.locator('[data-ff]:not([data-ff=""])');
  const count = await filters.count();
  if (count > 0) {
    await filters.first().click();
    // Either shows results or empty state — neither should error
    const hasCards = await page.locator('.album-card').count() > 0;
    const hasEmpty = await page.locator('.empty-state').count() > 0;
    expect(hasCards || hasEmpty).toBe(true);
    // Click "All formats" to reset
    await page.click('[data-ff=""]');
  }
});

// ── Player bar ─────────────────────────────────────────────────────────────
test('player bar is visible and shows initial state', async ({ page }) => {
  await page.goto(BASE);
  await waitForCatalogue(page);
  await expect(page.locator('#playerBar')).toBeVisible();
  await expect(page.locator('#pbTitle')).toHaveText('—');
  await expect(page.locator('#pbArtist')).toHaveText('No track selected');
});

test('clicking a track row loads it into the player', async ({ page }) => {
  await page.goto(BASE);
  await waitForCatalogue(page);
  await page.locator('.album-card').first().click();
  await expect(page.locator('.tracklist')).toBeVisible();

  const firstRow = page.locator('.tracklist tbody tr').first();
  const trackTitle = await firstRow.locator('.td-title').textContent();
  await firstRow.click();

  await expect(page.locator('#pbTitle')).not.toHaveText('—');
  const pbTitle = await page.locator('#pbTitle').textContent();
  expect(pbTitle).toBe(trackTitle.trim());
});

test('keyboard play/pause (Space) toggles player', async ({ page }) => {
  await page.goto(BASE);
  await waitForCatalogue(page);
  await page.locator('.album-card').first().click();
  await page.locator('.tracklist tbody tr').first().click();

  // Focus body so Space reaches the keydown handler (not the search input)
  await page.click('body');
  const iconBefore = await page.locator('#pbPlayIcon').getAttribute('class');
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  const iconAfter = await page.locator('#pbPlayIcon').getAttribute('class');
  // Icon class should change between play and pause
  expect(iconBefore).not.toBe(iconAfter);
});

// ── Download buttons ────────────────────────────────────────────────────────
test('download button shows toast', async ({ page }) => {
  await page.goto(BASE);
  await waitForCatalogue(page);
  await page.locator('.album-card').first().click();
  await expect(page.locator('.download-bar')).toBeVisible();
  await page.locator('.dl-part-btn').first().click();
  await expect(page.locator('.toast')).toBeVisible({ timeout: 3000 });
});

// ── Contribute form ────────────────────────────────────────────────────────
test('contribute form validates required fields before enabling submit', async ({ page }) => {
  await page.goto(BASE);
  await waitForCatalogue(page);
  await page.click('[data-route="contribute"]');

  const submit = page.locator('#submitBtn');
  await expect(submit).toBeDisabled();

  await page.fill('#f-artist', 'Test Artist');
  await page.fill('#f-album', 'Test Album');
  await page.fill('#f-year', '2024');
  await page.selectOption('#f-genre', { index: 1 });
  await page.check('#f-license');

  await expect(submit).toBeEnabled();
});

// ── PWA / service worker ───────────────────────────────────────────────────
test('manifest.json is accessible', async ({ page }) => {
  const res = await page.request.get(`${BASE}/manifest.json`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.name).toBeTruthy();
});

test('service worker script is accessible', async ({ page }) => {
  const res = await page.request.get(`${BASE}/sw.js`);
  expect(res.status()).toBe(200);
});

// ── Catalogue integrity ─────────────────────────────────────────────────────
test('catalogue.json returns valid JSON with expected shape', async ({ page }) => {
  const res = await page.request.get(`${BASE}/_catalogue/catalogue.json`);
  expect(res.status()).toBe(200);
  const cat = await res.json();
  expect(cat.meta.total_songs).toBeGreaterThan(0);
  expect(Array.isArray(cat.artists)).toBe(true);
  expect(cat.artists.length).toBeGreaterThan(0);
  // Every album must have an id, title, and tracks array
  for (const artist of cat.artists) {
    for (const album of artist.albums) {
      expect(album.id).toBeTruthy();
      expect(album.title).toBeTruthy();
      expect(Array.isArray(album.tracks)).toBe(true);
    }
  }
});

test('all album IDs in catalogue are unique', async ({ page }) => {
  const res = await page.request.get(`${BASE}/_catalogue/catalogue.json`);
  const cat = await res.json();
  const ids = cat.artists.flatMap(a => a.albums.map(al => al.id));
  const unique = new Set(ids);
  expect(unique.size).toBe(ids.length);
});
