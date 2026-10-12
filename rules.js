// Luật chơi của "Grow Island" (dùng chung cho game và bộ kiểm tra).
// Mỗi vật phẩm có cấp 0..MAX. Bấm một vật phẩm = lên 1 cấp nếu:
//   - needs[cấp hiện tại]: các vật phẩm khác đã đủ cấp tối thiểu, và
//   - blocks: không có vật phẩm nào đang ở cấp quá cao chặn nó lại.
// Nếu không thỏa, lượt bấm bị lãng phí. Mục tiêu: đưa mọi vật phẩm lên cấp tối đa
// trong ít lượt nhất (hoàn hảo = 8 vật phẩm x 3 cấp = 24 lượt).
(function (root) {
  var MAX = 3;
  var ITEMS = [
    { id: 'water',  icon: '💧', name: 'Nước',     needs: [{}, { sun: 1 }, { tree: 2 }] },
    { id: 'sun',    icon: '☀️', name: 'Mặt trời', needs: [{}, { water: 1 }, { volcano: 1 }] },
    { id: 'seed',   icon: '🌱', name: 'Hạt giống', needs: [{ water: 1 }, { sun: 1 }, { water: 2 }] },
    { id: 'tree',   icon: '🌳', name: 'Cây',      needs: [{ seed: 1 }, { water: 2 }, { sun: 2 }] },
    { id: 'flower', icon: '🌸', name: 'Hoa',      needs: [{ seed: 2 }, { sun: 2 }, { bee: 2 }],
      blocks: [{ by: 'volcano', above: 1, msg: 'Núi lửa phun, hoa không nở được!' }] },
    { id: 'bee',    icon: '🐝', name: 'Ong',      needs: [{ flower: 1 }, { flower: 2 }, { fruit: 1 }] },
    { id: 'fruit',  icon: '🍎', name: 'Quả',      needs: [{ tree: 2 }, { flower: 2 }, { bee: 3 }] },
    { id: 'volcano',icon: '🌋', name: 'Núi lửa',  needs: [{}, { tree: 1 }, { fruit: 2 }] }
  ];

  function newState() {
    var s = {};
    ITEMS.forEach(function (it) { s[it.id] = 0; });
    return s;
  }

  // Trả về { ok:true } hoặc { ok:false, reason:'...' }
  function canGrow(state, id) {
    var it = ITEMS.filter(function (x) { return x.id === id; })[0];
    var lv = state[id];
    if (lv >= MAX) return { ok: false, reason: 'Đã đầy cấp!' };
    var need = it.needs[lv] || {};
    for (var k in need) {
      if (state[k] < need[k]) {
        var dep = ITEMS.filter(function (x) { return x.id === k; })[0];
        return { ok: false, reason: 'Cần ' + dep.name + ' ' + dep.icon + ' đạt cấp ' + need[k] };
      }
    }
    var bl = it.blocks || [];
    for (var i = 0; i < bl.length; i++) {
      if (state[bl[i].by] > bl[i].above) return { ok: false, reason: bl[i].msg };
    }
    return { ok: true };
  }

  function grow(state, id) {
    var r = canGrow(state, id);
    if (r.ok) state[id]++;
    return r;
  }

  function isWon(state) {
    return ITEMS.every(function (it) { return state[it.id] >= MAX; });
  }

  var api = { MAX: MAX, ITEMS: ITEMS, newState: newState, canGrow: canGrow, grow: grow, isWon: isWon };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GrowRules = api;
})(this);
