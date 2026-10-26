const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function moduleUrl(file) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return 'data:text/javascript;base64,' + Buffer.from(output.replace(
    /from "(\.[^"]+\.js)"/g,
    (_, dependency) => 'from ' + JSON.stringify(moduleUrl(path.join(path.dirname(file), dependency.replace(/\.js$/, '.ts')))),
  )).toString('base64');
}

// Offline only: every client call is intercepted; no supplier or booking request leaves this process.
test('TripJack supplied-document contract checks (offline)', async (t) => {
  const { TripjackClient } = await import(moduleUrl('../src/tripjack/client.ts'));
  const { resolveRoute, loadConfig } = await import('../../../apps/tripjack-gateway/src/gateway.mjs');
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url, ...options, body: JSON.parse(options.body) });
    return Response.json({ bookingId: 'synthetic-session', status: { success: true } });
  };
  const client = new TripjackClient({ baseUrl: 'https://uat-gateway.invalid', apiKey: 'synthetic-key', proxyKey: 'synthetic-gateway-key' });
  const params = { origin: 'DEL', destination: 'BOM', departureDate: '2030-01-10', adults: 1, children: 0, infants: 0, cabinClass: 'ECONOMY', tripType: 'ONEWAY' };
  await t.test('gateway maps search alias to official FMS endpoint and defaults to apitest', async () => {
    await client.search(params);
    assert.equal(resolveRoute(new URL(seen.at(-1).url).pathname).upstreamPath, '/fms/v1/air-search-all');
    assert.equal(loadConfig({ TRIPCOD_GATEWAY_KEY: 'synthetic' }).upstream.origin, 'https://apitest.tripjack.com');
    assert.equal(seen.at(-1).method, 'POST');
    assert.equal(seen.at(-1).headers.apikey, 'synthetic-key');
  });
  await t.test('round trip and multi-city retain ordered route infos', async () => {
    await client.search({ ...params, tripType: 'ROUNDTRIP', returnDate: '2030-01-20' });
    assert.equal(seen.at(-1).body.searchQuery.routeInfos.length, 2);
    const legs = [{ origin: 'DEL', destination: 'BOM', date: '2030-01-10' }, { origin: 'BOM', destination: 'MAA', date: '2030-01-12' }];
    await client.search({ ...params, tripType: 'MULTICITY', legs });
    assert.deepEqual(seen.at(-1).body.searchQuery.routeInfos.map(x => x.travelDate), legs.map(x => x.date));
  });
  await t.test('review sends selected price IDs and preserves session', async () => {
    assert.equal((await client.review(['synthetic-price-1', 'synthetic-price-2'])).bookingId, 'synthetic-session');
    assert.deepEqual(seen.at(-1).body, { priceIds: ['synthetic-price-1', 'synthetic-price-2'] });
  });
  await t.test('OMS uses the same header key and optional independent base', async () => {
    const split = new TripjackClient({ baseUrl: 'https://fms.invalid', omsBaseUrl: 'https://oms.invalid', apiKey: 'synthetic-key' });
    await split.pnrStatus('synthetic-session');
    assert.equal(seen.at(-1).url, 'https://oms.invalid/oms/v1/booking-details');
    assert.equal(seen.at(-1).headers.apikey, 'synthetic-key');
  });
  await t.test('instant and hold payloads differ by paymentInfos (mock only)', async () => {
    const body = { holdId: 'synthetic-session', contactPhone: '919999999999', contactEmail: 'offline@example.invalid', paymentAmount: 12345, passengers: [{ type: 'ADULT', firstName: 'Offline', lastName: 'Fixture', gender: 'M' }] };
    await client.book(body);
    assert.deepEqual(seen.at(-1).body.paymentInfos, [{ amount: 12345 }]);
    await client.book({ ...body, holdOnly: true });
    assert.equal(Object.hasOwn(seen.at(-1).body, 'paymentInfos'), false);
  });
  for (const cabinClass of ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']) {
    await t.test(`document requires full cabin name: ${cabinClass}`, async () => {
      await client.search({ ...params, cabinClass });
      assert.equal(seen.at(-1).body.searchQuery.cabinClass, cabinClass);
    });
  }
  await t.test('official fare-validation endpoints have dedicated client methods', () => {
    assert.equal(typeof client.validateInstantFare, 'function');
    assert.equal(typeof client.confirmFareBeforeTicket, 'function');
  });
  await t.test('post-booking SSR and seat routes preserve supplier IDs and payment quote', async () => {
    await client.ssrList('synthetic-session');
    assert.equal(seen.at(-1).url, 'https://uat-gateway.invalid/fms/v1/ancillaries/fetch/ssr');
    assert.ok(resolveRoute(new URL(seen.at(-1).url).pathname));
    await client.postBookingSeatMap('synthetic-session');
    assert.ok(resolveRoute(new URL(seen.at(-1).url).pathname));
    const pick = { paymentInfos: [{ amount: 250 }], sI: [{ id: 'supplier-segment', bI: { tI: [{ id: 7, smi: { code: 'MEAL1' } }] } }] };
    await client.addSsr('synthetic-session', pick);
    assert.equal(new URL(seen.at(-1).url).pathname, '/oms/v1/air/amendment/add/ssr');
    assert.ok(resolveRoute(new URL(seen.at(-1).url).pathname));
    assert.deepEqual(seen.at(-1).body, { bookingId: 'synthetic-session', ...pick });
  });
  await t.test('staging validates instant and held fares before mutation; production call sequence stays unchanged', async () => {
    const staging = new TripjackClient({ baseUrl: 'https://uat-gateway.invalid', apiKey: 'synthetic', uatFareValidation: true });
    const body = { holdId: 'session', contactPhone: '919999999999', contactEmail: 'offline@example.invalid', paymentAmount: 200, passengers: [] };
    seen.length = 0;
    await staging.book(body);
    assert.deepEqual(seen.map(x => new URL(x.url).pathname), ['/oms/v1/air/book/fare-validate', '/oms/v1/air/book']);
    assert.deepEqual(seen[0].body, seen[1].body);
    seen.length = 0;
    await staging.confirmHold('session', 200);
    assert.deepEqual(seen.map(x => new URL(x.url).pathname), ['/oms/v1/air/fare-validate', '/oms/v1/air/confirm-book']);
    seen.length = 0;
    await client.book(body);
    assert.equal(seen.length, 1);
  });
  await t.test('staging refuses a known production OMS route before any HTTP exchange', async () => {
    let calls = 0;
    global.fetch = async () => { calls++; return Response.json({ status: { success: true } }); };
    const mixed = new TripjackClient({ baseUrl: 'https://apitest.tripjack.com', omsBaseUrl: 'https://tripjack.com', apiKey: 'synthetic' });
    await assert.rejects(mixed.confirmHold('session', 200), /production OMS/);
    assert.equal(calls, 0);
  });
  await t.test('validation alerts, rejected and malformed responses stop before book', async () => {
    const staging = new TripjackClient({ baseUrl: 'https://apitest.tripjack.com', apiKey: 'synthetic' });
    for (const response of [{ status: { success: true }, alerts: [{ type: 'FAREALERT' }] }, { status: { success: false } }, { status: { success: true }, totalPriceInfo: { totalFareDetail: { fC: { TF: 201 } } } }, {}]) {
      let calls = 0;
      global.fetch = async () => { calls++; return Response.json(response); };
      await assert.rejects(staging.book({ holdId: 'session', contactPhone: '919999999999', contactEmail: 'offline@example.invalid', paymentAmount: 200, passengers: [] }));
      assert.equal(calls, 1);
    }
  });

});

test('held PNR is never confirmed or ticketed; ticket issuance needs supplier success', async () => {
  const { tripjackBookingResult } = await import(moduleUrl('../src/tripjack/booking-status.ts'));
  const travellers = [{ pnrDetails: { 'DEL-BOM': 'SYNTHETIC' }, ticketNumberDetails: { 'DEL-BOM': 'SYNTHETIC-TICKET' } }];
  for (const state of ['ON_HOLD', 'PENDING', 'FAILED']) {
    const result = tripjackBookingResult({ order: { bookingId: 'session', status: state }, status: { success: true }, itemInfos: { AIR: { travellerInfos: travellers } } }, 'session');
    assert.equal(result.status, state === 'ON_HOLD' ? 'HELD' : state === 'FAILED' ? 'FAILED' : 'PENDING');
    assert.deepEqual(result.ticketNumbers, []);
  }
  assert.equal(tripjackBookingResult({ order: { bookingId: 'session', status: 'SUCCESS' }, itemInfos: { AIR: { travellerInfos: travellers } } }, 'session').status, 'TICKETED');
  assert.equal(tripjackBookingResult({ bookingId: 'session', status: { success: true }, pnr: 'SYNTHETIC' }, 'session').status, 'PENDING');
});

test('Admin UAT correction preserves production URL; certification rows stay unchanged', () => {
  const root = path.resolve(__dirname, '../../..');
  const backend = fs.readFileSync(path.join(root, 'apps/api/src/routes/admin/integrations.ts'), 'utf8');
  const admin = fs.readFileSync(path.join(root, 'apps/admin/app/(dashboard)/integrations/page.tsx'), 'utf8');
  assert.match(backend, /https:\/\/apitest\.tripjack\.com/);
  assert.match(backend, /https:\/\/api\.tripjack\.com/);
  assert.doesNotMatch(backend + admin, /uat\.tripjack\.com/);
  const cases = JSON.parse(fs.readFileSync(path.join(root, 'docs/tripjack-uat/certification-cases.json'), 'utf8'));
  assert.equal(cases.length, 22);
  assert.equal(cases.filter(x => x.adults + x.children + x.infants > 9 && x.status === 'CLARIFY_PASSENGER_LIMIT').length, 8);
});
