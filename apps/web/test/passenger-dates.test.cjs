const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(name, overrides = {}) {
  const file = path.join(__dirname, '../app/book', name);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => overrides[id] || (id === './passenger-dates' ? load('passenger-dates.ts') : require(id)), module, module.exports);
  return module.exports;
}
const { validPassengerDate, passengerDatesError, passengerDateError, passportExpiryMinimum } = load('passenger-dates.ts');
test('strict dates reject expanded years and calendar rollover', () => {
  for (const value of ['222222-04-23', '10000-01-01', '+010000-01-01', '0000-01-01', '2025-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '2026-1-01', '04/23/222222', 'invalid']) assert.equal(validPassengerDate(value), false, value);
  for (const value of ['2024-02-29', '2000-02-29', '2026-04-23', '1990-01-01', '9999-12-31']) assert.equal(validPassengerDate(value), true, value);
  assert.equal(validPassengerDate('1900-02-29'), false);
  assert.equal(passportExpiryMinimum('2026-12-31'), '2027-01-01');
  assert.equal(passportExpiryMinimum('2024-02-28'), '2024-02-29');
});
test('date bounds and cross-field checks cover imported profiles too', () => {
  const p = { dob: '1990-01-01', passportIssueDate: '2020-01-01', passportExpiry: '2030-01-01' };
  assert.equal(passengerDatesError(p, '2026-10-27'), '');
  for (const field of ['dob', 'passportIssueDate', 'passportExpiry']) assert.match(passengerDatesError({ ...p, [field]: '222222-04-23' }, '2026-10-27'), /four-digit/);
  assert.match(passengerDatesError({ ...p, dob: '2027-01-01' }, '2026-10-27'), /birth.*future/);
  assert.match(passengerDatesError({ ...p, passportIssueDate: '2027-01-01' }, '2026-10-27'), /issue.*future/);
  assert.match(passengerDatesError({ ...p, passportExpiry: '2025-01-01' }, '2026-10-27'), /expiry/);
  assert.match(passengerDatesError({ ...p, passportExpiry: '2030-01-01', passportIssueDate: '2030-01-01' }, '2030-01-01'), /expiry/);
  assert.equal(passengerDatesError({ dob: '', passportIssueDate: '', passportExpiry: '' }, '2026-10-27'), '');
  assert.match(passengerDateError('2027-01-01', '0001-01-01', '2026-10-27'), /before/);
});
test('date field rejects six-digit year, accepts manual/calendar values and preserves native picker', () => {
  const changes = [], errors = [];
  const jsx = (type, props) => ({ type, props });
  const Component = load('PassengerDateInput.tsx', {
    react: { useEffect: (f) => f(), useId: () => 'date-error', useRef: () => ({ current: { setCustomValidity() {} } }), useState: () => ['', (s) => errors.push(s)] },
    'react/jsx-runtime': { jsx, jsxs: jsx },
  }).default;
  const tree = Component({ label: 'Passport expiry', value: '', onChange: (v) => changes.push(v), required: true });
  const input = tree.props.children.find((x) => x && x.type === 'input');
  assert.equal(input.props.type, 'date');
  assert.equal(input.props.max, '9999-12-31');
  assert.equal(input.props.required, true);
  const target = { value: '222222-04-23' };
  input.props.onChange({ currentTarget: target });
  assert.equal(target.value, '');
  assert.deepEqual(changes, ['']);
  assert.match(errors[0], /four-digit/);
  input.props.onChange({ currentTarget: { value: '2030-04-23' } });
  assert.equal(changes.at(-1), '2030-04-23');
  input.props.onBlur({ currentTarget: { validity: { badInput: true } } });
  assert.match(errors.at(-1), /complete/);
});
