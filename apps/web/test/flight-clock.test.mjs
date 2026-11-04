import test from 'node:test';
import assert from 'node:assert/strict';
import {flightClock,flightHour,flightDay} from '../app/lib/flight-clock.ts';
test('airport-local times and filter hours do not shift with UTC offsets',()=>{
 assert.equal(flightClock('2027-01-10T10:00:00+05:30'),'10:00');
 assert.equal(flightClock('2027-01-10T12:30:00+04:00'),'12:30');
 assert.equal(flightHour('2027-01-10T00:30:00+05:30'),0);
 assert.equal(flightDay('2027-01-10T00:30:00+05:30'),'2027-01-10');
});
test('missing flight timestamps are explicit rather than fabricated',()=>{
 assert.equal(flightClock(),'--:--');assert.equal(flightHour('invalid'),null);assert.equal(flightDay(),'');
});
