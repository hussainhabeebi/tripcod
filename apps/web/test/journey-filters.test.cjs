const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(file) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)((id) => load(path.resolve(path.dirname(file), id + '.ts')), module, module.exports);
  return module.exports;
}
const { filterJourneyFares, journeyLegSegments, visibleJourneyPicks } = load(path.resolve(__dirname, '../app/search/journey/journey-filters.ts'));
const legs = [{ origin: 'DEL', destination: 'BOM' }, { origin: 'BOM', destination: 'DEL' }];
const seg = (origin, destination, dep, arr, airlineName = 'Air A') => ({ origin, destination, departureTime: `2030-01-01T${dep}:00`, arrivalTime: `2030-01-01T${arr}:00`, duration: 90, airlineName });
const base = { id: 'out', tripKey: 'ONWARD', airlineName: 'Air A', departureTime: '2030-01-01T08:00:00', arrivalTime: '2030-01-01T10:00:00', stops: 0, duration: 120, totalFare: 1000, currency: 'INR', isRefundable: true, baggage: { checked: '15 KG' } };
const combined = { ...base, id: 'combo', tripKey: 'COMBO', segments: [seg('DEL','BOM','08:00','10:00'), seg('BOM','GOI','18:00','19:30'), seg('GOI','DEL','20:00','21:30')] };
const apply = (fares, query) => filterJourneyFares(fares, new URLSearchParams(query), legs);
test('return and multicity combined fares apply stops to every leg, not just outbound', () => {
  assert.deepEqual(journeyLegSegments(combined, legs).map(x => x.length), [1, 2]);
  assert.equal(apply([combined], 'stops=0').length, 0);
  assert.equal(apply([combined], '').length, 1);
  const multi = [{ origin: 'DEL', destination: 'BOM' }, { origin: 'BOM', destination: 'GOI' }, { origin: 'GOI', destination: 'DEL' }];
  assert.equal(filterJourneyFares([combined], new URLSearchParams('stops=0'), multi).length, 1);
});
test('local departure/arrival time and airlines check later journey legs', () => {
  assert.equal(apply([combined], 'depBand=06–12').length, 0);
  assert.equal(apply([combined], 'arrBand=06–12').length, 0);
  const mixed = { ...combined, segments: combined.segments.map((s, i) => i ? { ...s, airlineName: 'Air B' } : s) };
  assert.equal(apply([mixed], 'airlines=Air A').length, 0);
  assert.equal(apply([mixed], 'airlines=Air A,Air B').length, 1);
});
test('price limits respect currency; refund/baggage and empty results work on all groups', () => {
  for (const tripKey of ['ONWARD', 'RETURN', '0', '1', 'COMBO']) {
    const fare = { ...base, tripKey };
    assert.equal(apply([fare], 'maxPrice=900&maxPriceCurrency=INR').length, 0);
    assert.equal(apply([fare], 'maxPrice=900&maxPriceCurrency=AED').length, 1);
    assert.equal(apply([{ ...fare, isRefundable: false }], 'refundable=1').length, 0);
    assert.equal(apply([{ ...fare, baggage: {} }], 'baggage=1').length, 0);
  }
});
test('sort and reset preserve supplier IDs and special-return metadata without mutation', () => {
  const cheap = { ...base, id: 'cheap', totalFare: 500, fareIdentifier: 'SPECIAL_RETURN', sri: 'sri-1', msri: ['sri-2'] };
  const before = JSON.stringify([base, cheap]);
  assert.deepEqual(apply([base, cheap], 'sort=price').map(f => f.id), ['cheap', 'out']);
  assert.equal(apply([base, cheap], '').length, 2);
  assert.equal(apply([base, cheap], 'sort=price')[0], cheap);
  assert.equal(JSON.stringify([base, cheap]), before);
  assert.equal(apply([combined], 'stops=0').length, 0);
  assert.equal(apply([combined], '').length, 1);
});
test('unknown combined-leg data never masquerades as a matching nonstop journey', () => {
  assert.equal(apply([{ ...combined, segments: [] }], 'stops=0').length, 0);
  assert.equal(apply([{ ...combined, segments: [] }], '').length, 1);
});

test('filtered selections cannot proceed hidden or break special-return pairing', () => {
  const onward = { ...base, fareIdentifier: 'SPECIAL_RETURN', sri: 'pair-1' };
  const back = { ...base, id: 'back', tripKey: 'RETURN', fareIdentifier: 'SPECIAL_RETURN', msri: ['pair-1'] };
  assert.deepEqual(Object.keys(visibleJourneyPicks({ ONWARD: onward, RETURN: back }, { ONWARD: [], RETURN: [back] })), []);
  assert.equal(visibleJourneyPicks({ ONWARD: onward, RETURN: back }, { ONWARD: [onward], RETURN: [back] }).RETURN, back);
  const normal = { ...back, fareIdentifier: 'PUBLISHED' };
  assert.equal(visibleJourneyPicks({ RETURN: normal }, { RETURN: [normal] }).RETURN, normal);
});
