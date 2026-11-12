// 総合点(トータルバランス): 速さ 50%・粘り 20%・効率 20%・安定性 10%。
// KaedeSystem 本体の motor_meas_math.h(measBalOf / measBalScore / measBalRank)と同じ式・同じ丸め。
//   速さ = 負荷時回転数(L と H の平均)/ 粘り = 負荷H ÷ 負荷L / 効率 = 負荷時回転数 ÷ 消費電力(wL・wH の平均。無ければ w)
//   安定性 = ばらつき(cvL・cvH の大きい方。小さいほど良い)
// 項目ごとの位置 = (相手のうち自分より悪い本数 + 同じ値の本数×0.5) ÷ 相手の本数(その項目の値が無い相手は除く)。
// 相手が 0 本なら 1、自分の値が無い項目は 0.5。総合の順位は点の高い順、同点は負荷時回転数の高い方が上。
// 入れるのは負荷L・H の形(ver 2)の行だけ。ブラウザでは window.MotorBalance、node では module.exports
(function (root) {
  const W = { speed: 0.5, drop: 0.2, eff: 0.2, stab: 0.1 };
  const Q = 10000;   // 本体の表と同じ細かさ(粘り・ばらつき ×10000、効率は整数)
  const pos = (x) => Number.isFinite(x) && x > 0;
  const num = (s) => { const n = parseFloat(s); return pos(n) ? n : 0; };
  const q = (x, scale) => (pos(x) ? Math.min(65535, Math.max(1, Math.round(x * scale))) / scale : 0);

  // 行の4項目(値が無い項目は 0)。ver 2 でない・回転数の無い行は null
  function balOf(e) {
    if (!e || e.ver !== 2) return null;
    const rpm = num(e.rpm);
    if (!rpm) return null;
    const l = num(e.rpmL), h = num(e.rpmH);
    const wl = num(e.wL), wh = num(e.wH);
    const w = wl && wh ? (wl + wh) / 2 : wl || wh || num(e.w);
    const cv = Math.max(num(e.cvL), num(e.cvH));
    return { rpm, drop: q(l && h ? h / l : 0, Q), eff: q(w ? rpm / w : 0, 1), cv: q(cv, Q) };
  }

  const ITEMS = [['speed', 'rpm', false], ['drop', 'drop', false], ['eff', 'eff', false], ['stab', 'cv', true]];

  function partsOf(me, others) {
    const parts = {};
    for (const [name, key, lowerBetter] of ITEMS) {
      const v = me[key];
      if (!pos(v)) { parts[name] = 0.5; continue; }
      let m = 0, worse = 0;
      for (const o of others) {
        const ov = o[key];
        if (!pos(ov)) continue;
        m++;
        if (ov === v) worse += 0.5;
        else if (lowerBetter ? ov > v : ov < v) worse += 1;
      }
      parts[name] = m === 0 ? 1 : worse / m;
    }
    return parts;
  }

  // entries = 番号ごとの最後の計測。返り値 Map(no → {score, rank, total, parts})
  function balanceScores(entries) {
    const list = (entries || []).map((e) => ({ no: e && e.no, b: balOf(e) })).filter((x) => x.b);
    const out = list.map((x) => {
      const parts = partsOf(x.b, list.filter((y) => y !== x).map((y) => y.b));
      const s = W.speed * parts.speed + W.drop * parts.drop + W.eff * parts.eff + W.stab * parts.stab;
      return { no: x.no, rpm: x.b.rpm, score: Math.round(100 * s), parts };
    });
    const map = new Map();
    for (const r of out) {
      const better = out.filter((o) => o !== r && (o.score > r.score || (o.score === r.score && o.rpm > r.rpm))).length;
      map.set(r.no, { score: r.score, rank: better + 1, total: out.length, parts: r.parts });
    }
    return map;
  }

  const api = { balOf, balanceScores, WEIGHTS: W };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MotorBalance = api;
})(typeof window !== 'undefined' ? window : this);
