// Read-only My Trips regression with synthetic orders; never contacts a supplier.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const base = process.env.BASE_URL || 'http://localhost:3000';
const output = process.env.QA_OUTPUT || '/tmp/tripcod-hotel-my-trips-qa';
const order = (status, extra = {}) => ({
  id: `test-${status}`, supplierBookingId: `UAT-${status}`, mode: status === 'ON_HOLD' ? 'HOLD' : 'INSTANT',
  status, statusText: { ON_HOLD: 'On hold', CONFIRMED: 'Confirmed', CANCELLED: 'Cancelled' }[status],
  holdDeadline: '2026-11-01T18:30', holdExpired: false,
  hotel: { name: 'Dubai Marina Hotel and Residences', city: 'Dubai', checkIn: '2026-11-20', checkOut: '2026-11-22', nights: 2 },
  occupancy: [{ adults: 2, childAges: [7] }], amount: 25000, currency: 'INR', ...extra,
});
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/tmp/tripcod-chrome/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext();
  await context.addCookies([{ name: 'tripcod_token', value: 'synthetic-test-token', url: base }]);
  const page = await context.newPage();
  let mode = 'success', calls = 0, flightMode = 'success';
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/hotels/orders/mine') {
      calls++;
      assert.equal(route.request().headers().authorization, 'Bearer synthetic-test-token');
      if (mode === 'pending') return;
      return route.fulfill({ status: mode === 'error' ? 503 : mode === 'auth' ? 401 : 200, contentType: 'application/json', body: JSON.stringify(mode === 'success' ? { orders: [order('ON_HOLD'), order('CONFIRMED'), order('CANCELLED')] } : mode === 'expired' ? { orders: [order('ON_HOLD', { holdExpired: true })] } : { orders: [] }) });
    }
    if (path === '/api/profile/trips') {
      if (flightMode === 'pending') return;
      return route.fulfill({ status: flightMode === 'auth' ? 401 : 200, contentType: 'application/json', body: JSON.stringify({ trips: [] }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  for (const width of [320, 375, 390, 428, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${base}/trips`);
    const hotels = page.locator('section[aria-labelledby="hotel-stays"]');
    await hotels.getByText('On hold', { exact: true }).waitFor();
    assert.equal(await hotels.locator('article').count(), 3);
    for (const label of ['Confirmed', 'Cancelled']) await hotels.getByText(label, { exact: true }).waitFor();
    assert.equal(await hotels.getByText('Hold deadline', { exact: true }).count(), 3);
    assert.equal(await hotels.getByRole('link', { name: 'View booking' }).count(), 3);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `overflow at ${width}`);
    assert.equal(await hotels.getByText('2 rooms').count(), 0);
    if ([390, 1440].includes(width)) await page.screenshot({ path: `${output}/my-trips-${width}.png`, fullPage: true });
  }
  mode = 'error'; await page.reload();
  await page.getByRole('button', { name: 'Retry hotel bookings' }).waitFor();
  const before = calls; mode = 'success'; await page.getByRole('button', { name: 'Retry hotel bookings' }).click();
  await page.getByText('On hold', { exact: true }).waitFor(); assert.ok(calls > before);
  mode = 'auth'; await page.reload(); await page.getByText('Please sign in again to see your hotel bookings.').waitFor();
  mode = 'empty'; await page.reload(); await page.getByText('No hotel bookings linked to this account yet.').waitFor();
  mode = 'expired'; await page.reload(); await page.getByText('Hold deadline (passed)').waitFor();
  await page.getByText('On hold', { exact: true }).waitFor(); assert.equal(await page.getByText('Hold expired', { exact: true }).count(), 0);
  mode = 'success'; flightMode = 'pending'; await page.reload(); await page.getByText('On hold', { exact: true }).waitFor();
  await page.getByText('Loading your flight bookings…').waitFor();
  flightMode = 'auth'; await page.reload(); await page.getByText('Please sign in again to see your flight bookings.').waitFor();
  await page.getByText('On hold', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('PASS: seven widths; statuses/details/deadlines; authenticated request; error/retry/auth/empty; flight independence; no overflow or browser errors.');
})().catch((error) => { console.error(error); process.exit(1); });
