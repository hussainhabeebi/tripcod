// Live hotel checks on www.tripcod.com, desktop + mobile. Read-only: it never
// submits checkout, so no order, booking, cancellation or payment is created.
// /hotels → room-wise guests with children → results → room selection →
// checkout (TripJack price check only) → booking-details and My Trips pages.
const { chromium } = require("playwright");
const [checkIn, checkOut] = process.argv.slice(2);
const fs = require("fs");
fs.mkdirSync("release-shots", { recursive: true });

async function journey(width, tag) {
  const out = { tag, checks: {} };
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: tag === "mobile", hasTouch: tag === "mobile" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const overflow = async (name) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); out.checks[`${name}NoHorizontalScroll`] = o <= 1; };
  const shot = (name) => page.screenshot({ path: `release-shots/${tag}-${name}.png`, fullPage: true });
  const either = (a, b, timeout = 60_000) => page.locator(a).or(page.locator(b)).first().waitFor({ timeout });
  try {
    // 1–2. Children + room-wise adults / children / ages
    await page.goto("https://www.tripcod.com/hotels", { waitUntil: "networkidle" });
    await page.locator(".hw-input").first().click();
    await page.keyboard.type("Dubai");
    await page.locator(".hw-dropdown li").first().dispatchEvent("mousedown");
    await page.fill("#hw-check-in", checkIn);
    await page.fill("#hw-check-out", checkOut);
    await page.click(".gr-toggle");
    await page.click('[aria-label="More adults"] >> nth=0');
    await page.click('[aria-label="More children"] >> nth=0');
    out.checks.doneBlockedUntilChildAge = await page.locator(".gr-done").isDisabled();
    await page.locator(".gr-ages select").nth(0).selectOption("6");
    await page.click(".gr-add");
    await page.click('[aria-label="More children"] >> nth=1');
    await page.click('[aria-label="More children"] >> nth=1');
    await page.locator(".gr-ages select").nth(1).selectOption("3");
    await page.locator(".gr-ages select").nth(2).selectOption("10");
    out.checks.roomsInPicker = await page.locator(".gr-room").count();
    out.checks.childAgeSelects = await page.locator(".gr-ages select").count();
    await shot("1-search"); await overflow("search");
    await page.click(".gr-done");
    out.checks.summary = await page.textContent("#gr-value");
    await page.click(".hw-search-btn");
    await page.waitForURL(/hotels\/search/, { timeout: 90_000 });
    await page.waitForLoadState("networkidle");
    out.occ = new URL(page.url()).searchParams.get("occ");
    out.checks.resultsRoomWiseChips = await page.locator('ul[aria-label="Guests in each room"] li').count();
    out.checks.resultHotels = await page.locator("text=Choose room").count();
    await shot("2-results"); await overflow("results");
    if (!out.checks.resultHotels) { out.result = "NO_HOTELS_RETURNED"; return out; }

    // Room selection
    await page.locator("text=Choose room").first().click();
    await page.waitForURL(/hotels\/hotel/);
    await either("text=Choose your room", ".err");
    out.checks.roomOptions = await page.locator("article.opt").count();
    out.checks.roomPageOccupancyRows = await page.locator("ul.occ li").count();
    await shot("3-rooms"); await overflow("rooms");
    if (!out.checks.roomOptions) { out.result = "NO_ROOM_OPTIONS"; out.message = (await page.locator(".err").textContent().catch(() => ""))?.slice(0, 200); return out; }

    // Checkout (TripJack price check only — never submitted)
    await page.locator("article.opt a.btn").first().click();
    await page.waitForURL(/hotels\/book/);
    await either("text=price confirmed", ".note-warn");
    out.checks.priceConfirmed = (await page.locator("text=price confirmed").count()) > 0;
    out.checks.adultForms = await page.locator(".chip:not(.chip-child)").count();
    out.checks.childForms = await page.locator(".chip-child").count();
    out.checks.roomBlocks = await page.locator(".roomblock").count();
    out.checks.cancellationPolicyShown = (await page.locator(".policy").count()) > 0;
    out.checks.payNowOption = (await page.locator("text=Pay now & confirm").count()) > 0;
    out.checks.holdOption = (await page.locator("text=Hold now, pay later").count()) > 0 ? "offered by supplier"
      : (await page.locator("text=Hold isn't offered").count()) > 0 ? "not offered by supplier for this room" : "missing";
    out.checks.cardOption = (await page.locator('.choice b:text-is("Card")').count()) > 0;
    out.checks.walletOption = (await page.locator('.choice b:text-is("Tripcod wallet")').count()) > 0;
    out.checks.walletState = (await page.locator('label:has(b:text-is("Tripcod wallet")) small').textContent().catch(() => ""))?.trim();
    out.checks.payButton = (await page.locator(".pay button").textContent())?.trim();
    await shot("4-checkout"); await overflow("checkout");

    // Booking details page (unknown order → safe not-found state) and My Trips
    await page.goto("https://www.tripcod.com/hotels/booking/release-check-no-such-order", { waitUntil: "networkidle" });
    await either(".err", ".status", 30_000);
    out.checks.bookingDetailsPageNotFoundHandled = (await page.locator(".err").count()) > 0;
    await shot("5-booking-details"); await overflow("bookingDetails");
    await page.goto("https://www.tripcod.com/trips", { waitUntil: "networkidle" });
    out.checks.myTripsSignInPrompt = (await page.locator("text=Sign in to see your trips").count()) > 0;
    await shot("6-my-trips"); await overflow("myTrips");
    out.result = "VERIFIED_NOTHING_SUBMITTED";
  } catch (err) {
    out.result = "ERROR"; out.error = String(err.message).slice(0, 300);
    await shot("error").catch(() => {});
  } finally {
    out.pageErrors = errors.slice(0, 5);
    await browser.close();
  }
  return out;
}

(async () => {
  for (const [w, tag] of [[1280, "desktop"], [390, "mobile"]]) console.log("JOURNEY " + JSON.stringify(await journey(w, tag)));
})();
