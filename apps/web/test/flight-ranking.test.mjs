import test from 'node:test';
import assert from 'node:assert/strict';
import { rankRecommended } from '../app/lib/flight-ranking.ts';

test('recommendations apply the published price, duration and stops tradeoff without mutating supplier data', () => {
 const fares = [
  { id:'fast',totalFare:200,duration:60,stops:0 },
  { id:'balanced',totalFare:110,duration:90,stops:0 },
  { id:'cheap',totalFare:100,duration:600,stops:2 },
 ];
 const snapshot = JSON.stringify(fares);
 assert.deepEqual(rankRecommended(fares).map(f=>f.id), ['balanced','cheap','fast']);
 assert.equal(JSON.stringify(fares),snapshot);
});
test('missing price and duration cannot outrank a complete cheapest nonstop fare',()=>{
 assert.equal(rankRecommended([{id:'missing'},{id:'valid',totalFare:100,duration:60,stops:0}])[0].id,'valid');
});
test('equal scores preserve supplier order, and empty results stay empty',()=>{
 assert.deepEqual(rankRecommended([]),[]);
 assert.deepEqual(rankRecommended([{id:'a',totalFare:100,duration:60},{id:'b',totalFare:100,duration:60}]).map(f=>f.id),['a','b']);
});
