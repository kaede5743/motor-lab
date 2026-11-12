// 総合点(トータルバランス)のテスト。node --test test/balance.test.js
// 基準に対する個体ごとの点。見本は KaedeSystem 本体の test/motor_meas_math_test.cpp(test_balance)と同じ:
// 基準 速さ 14000〜18000 rpm・効率 2000〜3000 rpm/W で A 54・B 31・C 95・D 0 点
const test = require('node:test');
const assert = require('node:assert/strict');
const { balOf, balanceScores, refOk, autoRef } = require('../balance.js');

// 負荷時回転数 rpm・粘り drop(H÷L)・効率 eff(rpm/W)・ばらつき cv から ver 2 の行を作る。
// 値は受け口が保存する形と同じ文字(回転数は整数、電圧 1.00V・電流は小数2桁、ばらつきは小数4桁)。
// 本体の test の balRow と同じ値になる(電流 = rpm ÷ eff を小数2桁に)
function entry(no, rpm, drop, eff, cv, over = {}) {
  const l = (2 * rpm) / (1 + drop);
  const i = eff > 0 ? (rpm / eff).toFixed(2) : '';
  return {
    no, ver: 2, rpm: String(rpm), rpmL: String(Math.round(l)), rpmH: String(Math.round(l * drop)),
    vL: i ? '1.00' : '', iL: i, vH: i ? '1.00' : '', iH: i, wL: i, wH: i, w: '',
    cvL: cv ? cv.toFixed(4) : '', cvH: cv ? (cv / 2).toFixed(4) : '', ...over,
  };
}

const REF = { rpmLo: 14000, rpmHi: 18000, effLo: 2000, effHi: 3000 };
const A = entry('001', 16000, 0.95, 2400, 0.008);
const B = entry('002', 16000, 0.85, 2250, 0.0285);
const C = entry('003', 19000, 1.00, 3500, 0);
const D = entry('004', 13000, 0.80, 1500, 0.05);

test('見本: A 54・B 31(ちょうど 30.5 → 切り上げ)・C 95・D 0、項目ごとの点', () => {
  const m = balanceScores([A, B, C, D], REF);
  assert.deepEqual([m.get('001').score, m.get('002').score, m.get('003').score, m.get('004').score], [54, 31, 95, 0]);
  const p = m.get('001').parts;
  assert.equal(p.speed, 0.5);
  assert.ok(Math.abs(p.drop - 2 / 3) < 1e-9 && Math.abs(p.eff - 0.399) < 1e-9 && Math.abs(p.stab - 220 / 300) < 1e-9);
  assert.deepEqual(m.get('003').parts, { speed: 1, drop: 1, eff: 1, stab: 0.5 });   // 満点で止まる・ばらつき無し=50
  assert.deepEqual(m.get('004').parts, { speed: 0, drop: 0, eff: 0, stab: 0 });     // 0 で止まる
});

test('順位は点の高い順(C・A・B・D)、同点は負荷時回転数の高い方', () => {
  const m = balanceScores([A, B, C, D], REF);
  assert.deepEqual(['003', '001', '002', '004'].map((no) => m.get(no).rank), [1, 2, 3, 4]);
  assert.equal(m.get('001').total, 4);
  const m2 = balanceScores([C, { ...C, no: '009', rpm: '19500' }], REF);
  assert.equal(m2.get('009').rank, 1);
  assert.equal(m2.get('003').rank, 2);
});

test('点はほかの個体に左右されない', () => {
  assert.equal(balanceScores([A], REF).get('001').score, 54);
  assert.equal(balanceScores([A, C, D], REF).get('001').score, 54);
});

test('基準が無い・不正なら点を出さない', () => {
  assert.equal(balanceScores([A, B], null).size, 0);
  assert.equal(balanceScores([A, B], { ...REF, rpmLo: 18000 }).size, 0);
  assert.equal(refOk(REF), true);
  assert.equal(refOk({ ...REF, effHi: 70000 }), false);
  assert.equal(refOk({ ...REF, rpmLo: '14000' }), false);
});

test('負荷1点の頃の行(ver なし)・回転数の無い行は入れない。効率が無い行は効率だけ 50', () => {
  const old = { no: '005', rpm: '17000', rpmNl: '40000', w: '6.00' };
  const m = balanceScores([A, old, { ...A, no: '006', rpm: '' }], REF);
  assert.equal(m.has('005'), false);
  assert.equal(m.has('006'), false);
  const noW = entry('007', 16000, 0.95, 0, 0.008);
  assert.equal(balOf(noW).eff, 0);
  assert.equal(balanceScores([noW], REF).get('007').parts.eff, 0.5);
});

test('基準の幅が大きくても(分母の積が 2^53 を超えても)点が正しい', () => {
  const wide = { rpmLo: 1, rpmHi: 200000, effLo: 1, effHi: 65535 };
  // 速さ (16000−1)/199999、粘り 1000/1500、効率 (2399−1)/65534、安定 220/300(本体の test と同じ)
  const s = balanceScores([A], wide).get('001').score;
  const exact = 50 * (15999 / 199999) + 20 * (1000 / 1500) + 20 * (2398 / 65534) + 10 * (220 / 300);
  assert.equal(s, Math.floor(exact + 0.5));
});

test('実際に近い値でも本体と同じ点(本体の test の「実際に近い値」と同じ見本: 62 点)', () => {
  // 本体の生の値 L 16410.3rpm 2.7949V 1.8549A / H 15589.7rpm 2.7612V 2.2349A を、受け口が保存する形にしたもの
  const real = { no: '007', ver: 2, rpm: '16000', rpmL: '16410', rpmH: '15590', vL: '2.79', iL: '1.85', vH: '2.76', iH: '2.23',
    wL: '5.16', wH: '6.15', w: '5.66', cvL: '0.0083', cvH: '0.0061' };
  const b = balOf(real);
  assert.equal(b.eff, 2828);
  assert.equal(Math.round(b.drop * 10000), 9500);
  assert.equal(balanceScores([real], REF).get('007').score, 62);
});

test('消費電力は電圧・電流から(L・H の平均、片方だけならその値)。電圧・電流が無い行は wL・wH・w', () => {
  const lh = { ver: 2, rpm: '15820', rpmL: '16340', rpmH: '15300', vL: '2.56', iL: '2.30', vH: '2.49', iH: '2.95' };
  assert.equal(balOf(lh).eff, 2391);                          // 本体の test と同じ
  assert.equal(balOf({ ...lh, iH: '' }).eff, 2687);
  const b = balOf({ ver: 2, rpm: '15820', rpmL: '16340', rpmH: '15300', wL: '5.88', wH: '7.35', w: '', cvL: '0.0080', cvH: '0.0110' });
  assert.ok(Math.abs(b.eff - Math.round(15820 / 6.615)) < 1e-9);
  assert.ok(Math.abs(b.cv - 0.011) < 1e-9);
  const c = balOf({ ver: 2, rpm: '15820', rpmL: '16340', rpmH: '15300', w: '6.00' });
  assert.ok(Math.abs(c.eff - Math.round(15820 / 6)) < 1e-9);
});

test('基準の自動設定: 速さ・効率それぞれ最低を 0 点・最高を満点に', () => {
  const r = autoRef([A, B, C, D]);
  assert.deepEqual(r, { rpmLo: 13000, rpmHi: 19000, effLo: balOf(D).eff, effHi: balOf(C).eff });
  assert.ok(refOk(r));
  const m = balanceScores([A, B, C, D], r);
  assert.equal(m.get('003').rank, 1);
  assert.equal(m.get('004').score, 0);
});

test('基準の自動設定: 計測が 2 本未満・値が同じなら null', () => {
  assert.equal(autoRef([A]), null);
  assert.equal(autoRef([A, { ...A, no: '009' }]), null);
  assert.equal(autoRef([]), null);
  assert.equal(autoRef([A, { no: '010', ver: 1, rpm: '20000' }]), null);
});
