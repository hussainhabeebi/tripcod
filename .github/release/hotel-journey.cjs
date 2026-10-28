// Production hotel journey for the release check, desktop and mobile:
// /hotels → room-wise guests with children → results → room selection → checkout
// (TripJack price check). It never submits checkout: no booking, no payment.
const { chromium } = require("playwright");
const [checkIn, checkOut] = process.argv.slice(2);
const fs = require("fs");
fs.mkdirSync("release-shots", { recursive: true });

async function journey(width, tag) {
  const out = { tag, steps: [] };
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: tag === "mobile" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const step = async (name) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: `release-shots/${tag}-${name}.png`, fullPage: true });
    out.steps.push({ name, url: page.url().replace(/sid=[^&]+/, "sid=…"), horizontalOverflowPx: Math.max(0, overflow) });
  };
  try {
    await page.goto("https://www.tripcod.com/hotels", { waitUntil: "networkidle" });
    await page.locator(".hw-input").first().click();
    await page.keyboard.type("Dubai");
    await page.locator(".hw-dropdown li").first().dispatchEvent("mousedown");
    await page.fill("#hw-check-in", checkIn);
    await page.fill("#hw-check-out", checkOut);
    await page.click(".gr-toggle");
    await page.click('[aria-label="More adults"] >> nth=0');                 // room 1: 2 adults
    await page.click('[aria-label="More children"] >> nth=0');
    await page.locator(".gr-ages select").nth(0).selectOption("6");         // + child aged 6
    await page.click(".gr-add");                                             // room 2: 1 adult + child aged 3
    await page.click('[aria-label="More children"] >> nth=1');
    await page.locator(".gr-ages select").nth(1).selectOption("3");
    await step("1-search");
    await page.click(".gr-done");
    await page.click(".hw-search-btn");
    await page.waitForURL(/hotels\/search/, { timeout: 90_000 });
    await page.waitForLoadState("networkidle");
    out.occ = new URL(page.url()).searchParams.get("occ");
    await step("2-results");
    const choose = page.locator("text=Choose room").first();
    if (!(await choose.count())) { out.result = "NO_HOTELS_RETURNED"; out.message = (await page.textContent("main"))?.slice(0, 300); return out; }
    await choose.click();
    await page.waitForURL(/hotels\/hotel/);
    await page.waitForSelector("text=Choose your rooms, .err", { timeout: 60_000 });
    await step("3-rooms");
    const select = page.locator("a.btn", { hasText: "Select" }).first();
    if (!(await select.count())) { out.result = "NO_ROOM_OPTIONS"; return out; }
    await select.click();
    await page.waitForURL(/hotels\/book/);
    await page.waitForSelector("text=price confirmed, .note-warn", { timeout: 60_000 });
    out.guestForms = await page.locator('label:has-text("First name") input').count();
    await step("4-checkout");
    out.result = (await page.locator("text=price confirmed").count()) ? "CHECKOUT_READY_NOT_SUBMITTED" : "CHECKOUT_PRICE_CHECK_FAILED";
  } catch (err) {
    out.result = "ERROR"; out.error = String(err.message).slice(0, 300);
  } finally {
    out.pageErrors = errors.slice(0, 5);
    await browser.close();
  }
  return out;
}

(async () => {
  for (const [w, tag] of [[1280, "desktop"], [390, "mobile"]]) console.log(JSON.stringify(await journey(w, tag)));
})();
