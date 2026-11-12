// 総合点(トータルバランス): 速さ 50・粘り 20・効率 20・安定性 10。基準に対する個体ごとの点(ほかの個体に左右されない)。
// KaedeSystem 本体の motor_meas_math.h(measBalOf / measAbsScore / measAbsRank)と同じ式・同じ丸め。
//   速さ = 負荷時回転数(L と H の平均)を、機種ごとの基準 rpmLo(0 点)〜rpmHi(満点)で
//   粘り = 負荷H ÷ 負荷L を 85%(0 点)〜100%(満点)で
//   効率 = 負荷時回転数 ÷ 消費電力(wL・wH の平均。無ければ w)を、機種ごとの基準 effLo〜effHi で
//   安定性 = ばらつき(cvL・cvH の大きい方)を 3%(0 点)〜0%(満点)で
// 基準は登録されている個体の最低〜最高から自動で決める(autoRef)。
// 基準を超えれば満点・下回れば 0 点で止める。値が無い項目は 50 点。基準が無い機種は点を出さない。
// 点は分数のまま正確に足して四捨五入(ちょうど .5 は切り上げ)。分母の積が大きいので BigInt で計算する。
// 入れるのは負荷L・H の形(ver 2)の行だけ。ブラウザでは window.MotorBalance、node では module.exports
(function (root) {
  const WI = [50n, 20n, 20n, 10n];   // 重み(合計 100)
  const Q = 10000;                   // 粘り・ばらつきの細かさ(本体の表と同じ ×10000)
  const DROP_LO = 8500, DROP_HI = 10000, CV_ZERO = 300;
  const pos = (x) => Number.isFinite(x) && x > 0;
  const num = (s) => { const n = parseFloat(s); return pos(n) ? n : 0; };

  // 基準 {rpmLo, rpmHi, effLo, effHi}(本体の measRefOk と同じ範囲)
  function refOk(r) {
    if (!r || typeof r !== 'object') return false;
    const ok = (v, max) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max;
    return ok(r.rpmLo, 200000) && ok(r.rpmHi, 200000) && ok(r.effLo, 65535) && ok(r.effHi, 65535)
      && r.rpmLo < r.rpmHi && r.effLo < r.effHi;
  }

  // a/b を四捨五入(a, b は正の整数。.5 は切り上げ)。本体の measDivRound と同じ
  const divRound = (a, b) => Math.floor((2 * a + b) / (2 * b));

  // 行の4項目(本体の measBalOf と同じ: 回転数は整数、電流・電圧は小数2桁にそろえて整数だけで出す。
  // 値が無い項目は 0)。ver 2 でない・回転数の無い行は null
  function balOf(e) {
    if (!e || e.ver !== 2) return null;
    const rpm = Math.round(num(e.rpm));
    if (!rpm) return null;
    const l = Math.round(num(e.rpmL)), h = Math.round(num(e.rpmH));
    // 消費電力 [1e-4 W] = 電圧(小数2桁)×電流(小数2桁)。電圧・電流が無い行(手入力など)は wL・wH・w から
    const p = (v, i, w) => (num(v) && num(i) ? Math.round(num(v) * 100) * Math.round(num(i) * 100) : Math.round(num(w) * 10000));
    const pl = p(e.vL, e.iL, e.wL), ph = p(e.vH, e.iH, e.wH);
    let eff = 0;
    if (pl > 0 && ph > 0) eff = divRound(rpm * 20000, pl + ph);
    else if (pl + ph > 0) eff = divRound(rpm * 10000, pl + ph);
    else if (num(e.w)) eff = divRound(rpm * 10000, Math.round(num(e.w) * 10000));
    const drop = l > 0 && h > 0 ? divRound(h * 10000, l) : 0;
    const cv = Math.round(Math.max(num(e.cvL), num(e.cvH)) * Q);
    return { rpm, drop: Math.min(drop, 65535) / Q, eff: Math.min(eff, 65535), cv: cv / Q };
  }

  // 値 v を lo〜hi で 分子/分母 に(値が無ければ 1/2)
  function frac(v, lo, hi, has) {
    if (!has) return [1, 2];
    return [Math.min(Math.max(v - lo, 0), hi - lo), hi - lo];
  }

  // 1 本の総合点と項目ごとの点(基準は refOk を満たすもの)
  function scoreOne(b, ref) {
    const rpm = Math.round(b.rpm);
    const drop = Math.round(b.drop * Q), eff = Math.round(b.eff), cv = Math.round(b.cv * Q);
    const fr = [
      frac(rpm, ref.rpmLo, ref.rpmHi, rpm > 0),
      frac(drop, DROP_LO, DROP_HI, drop > 0),
      frac(eff, ref.effLo, ref.effHi, eff > 0),
      frac(CV_ZERO - cv, 0, CV_ZERO, cv > 0),   // 小さいほど良い
    ];
    const D = fr.reduce((p, [, d]) => p * BigInt(d), 1n);
    const N = fr.reduce((s, [n, d], i) => s + WI[i] * BigInt(n) * (D / BigInt(d)), 0n);
    const score = Number((2n * N + D) / (2n * D));
    const [s, d, e, t] = fr.map(([n, dd]) => n / dd);
    return { score, parts: { speed: s, drop: d, eff: e, stab: t } };
  }

  // entries = 番号ごとの最後の計測、ref = その種類の基準。返り値 Map(no → {score, rank, total, parts})。
  // 基準が無い・不正なら空の Map
  function balanceScores(entries, ref) {
    const map = new Map();
    if (!refOk(ref)) return map;
    const out = (entries || [])
      .map((e) => ({ no: e && e.no, b: balOf(e) }))
      .filter((x) => x.b)
      .map((x) => ({ no: x.no, rpm: x.b.rpm, ...scoreOne(x.b, ref) }));
    for (const r of out) {
      const better = out.filter((o) => o !== r && (o.score > r.score || (o.score === r.score && o.rpm > r.rpm))).length;
      map.set(r.no, { score: r.score, rank: better + 1, total: out.length, parts: r.parts });
    }
    return map;
  }

  // 登録されている計測から基準を自動で決める: 速さ・効率それぞれ、いちばん低い個体を 0 点、いちばん高い個体を満点。
  // entries = 番号ごとの最後の計測。値の違う負荷L・H の計測が 2 本以上ないときは null
  function autoRef(entries) {
    const bals = (entries || []).map(balOf).filter(Boolean);
    const rpms = bals.map((b) => Math.round(b.rpm)).filter((v) => v > 0);
    const effs = bals.map((b) => Math.round(b.eff)).filter((v) => v > 0);
    if (rpms.length < 2 || effs.length < 2) return null;
    const r = { rpmLo: Math.min(...rpms), rpmHi: Math.max(...rpms), effLo: Math.min(...effs), effHi: Math.max(...effs) };
    return refOk(r) ? r : null;
  }

  const api = { balOf, balanceScores, refOk, autoRef };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MotorBalance = api;
})(typeof window !== 'undefined' ? window : this);
