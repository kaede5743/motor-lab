// 総合点(トータルバランス)のテスト。node --test test/balance.test.js
// 見本は KaedeSystem 本体の test/motor_meas_math_test.cpp(test_balance)と同じ: 80・70・0 点、1・2・3 位
const test = require('node:test');
const assert = require('node:assert/strict');
const { balOf, balanceScores } = require('../balance.js');

// 負荷時回転数 rpm・粘り drop(H÷L)・効率 eff(rpm/W)・ばらつき cv から ver 2 の行(値は文字列)を作る
function entry(no, rpm, drop, eff, cv, over = {}) {
  const l = (2 * rpm) / (1 + drop);
  const w = eff > 0 ? (rpm / eff).toFixed(2) : '';
  return {
    no, ver: 2, rpm: String(rpm), rpmL: String(Math.round(l)), rpmH: String(Math.round(l * drop)),
    wL: w, wH: w, w, cvL: cv ? cv.toFixed(4) : '', cvH: cv ? (cv / 2).toFixed(4) : '', ...over,
  };
}

const e1 = entry('001', 16000, 0.95, 2400, 0.008);
const e2 = entry('002', 15500, 0.97, 2600, 0.012);
const e3 = entry('003', 15000, 0.90, 2300, 0.020);

test('見本の3本: 80・70・0 点、1・2・3 位、項目ごとの位置', () => {
  const m = balanceScores([e1, e2, e3]);
  assert.deepEqual([m.get('001').score, m.get('002').score, m.get('003').score], [80, 70, 0]);
  assert.deepEqual([m.get('001').rank, m.get('002').rank, m.get('003').rank], [1, 2, 3]);
  assert.deepEqual(m.get('001').parts, { speed: 1, drop: 0.5, eff: 0.5, stab: 1 });
  assert.equal(m.get('001').total, 3);
});

test('1 本だけは 100 点・1 位、同じ値の 2 本はどちらも 50 点', () => {
  assert.equal(balanceScores([e1]).get('001').score, 100);
  assert.equal(balanceScores([e1]).get('001').rank, 1);
  const m = balanceScores([e1, { ...e1, no: '009' }]);
  assert.equal(m.get('001').score, 50);
  assert.equal(m.get('009').score, 50);
});

test('負荷1点の頃の行(ver なし)・回転数の無い行は入れない', () => {
  const old = { no: '005', rpm: '17000', rpmNl: '40000', w: '6.00' };
  const m = balanceScores([e1, e2, e3, old, { ...e1, no: '006', rpm: '' }]);
  assert.equal(m.has('005'), false);
  assert.equal(m.has('006'), false);
  assert.equal(m.get('001').total, 3);
});

test('効率が無い(消費電力が空)行は効率だけ 0.5', () => {
  const noW = entry('004', 16000, 0.95, 0, 0.008);
  assert.equal(balOf(noW).eff, 0);
  const m = balanceScores([e1, e2, e3, noW]);
  assert.equal(m.get('004').parts.eff, 0.5);
});

test('消費電力は wL・wH の平均、無ければ w', () => {
  const b = balOf({ ver: 2, rpm: '15820', rpmL: '16340', rpmH: '15300', wL: '5.88', wH: '7.35', w: '', cvL: '0.0080', cvH: '0.0110' });
  assert.ok(Math.abs(b.eff - 15820 / 6.615) < 0.5);
  assert.ok(Math.abs(b.cv - 0.011) < 1e-9);
  const c = balOf({ ver: 2, rpm: '15820', rpmL: '16340', rpmH: '15300', w: '6.00' });
  assert.ok(Math.abs(c.eff - 15820 / 6) < 0.5);
});
