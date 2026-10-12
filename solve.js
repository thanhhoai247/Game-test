// Bộ giải: kiểm tra màn chơi thắng được và đếm số cách thắng hoàn hảo.
// Chạy: node solve.js
var R = require('./rules.js');
var ids = R.ITEMS.map(function (i) { return i.id; });
function key(s) { return ids.map(function (i) { return s[i]; }).join(''); }

var memo = {};
function count(s) { // số chuỗi bấm hoàn hảo (mỗi lượt đều lên cấp) dẫn tới thắng
  if (R.isWon(s)) return 1;
  var k = key(s);
  if (k in memo) return memo[k];
  var total = 0;
  ids.forEach(function (id) {
    if (R.canGrow(s, id).ok) {
      var n = Object.assign({}, s); n[id]++;
      total += count(n);
    }
  });
  return (memo[k] = total);
}

var n = count(R.newState());
console.log('Số cách thắng hoàn hảo (24 lượt):', n);
if (n === 0) { console.error('MÀN CHƠI KHÔNG THỂ THẮNG'); process.exit(1); }

// In một lời giải mẫu
var s = R.newState(), path = [];
while (!R.isWon(s)) {
  for (var i = 0; i < ids.length; i++) {
    if (R.canGrow(s, ids[i]).ok) {
      var t = Object.assign({}, s); t[ids[i]]++;
      if (count(t) > 0) { s = t; path.push(ids[i]); break; }
    }
  }
}
console.log('Lời giải mẫu:', path.join(' → '));
