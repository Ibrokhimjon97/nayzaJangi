const fs = require('fs');
const data = fs.readFileSync('public/3d_models/hooded_ranged_warrior_archer_meshy_6.glb');
const str = data.toString('utf8');
const regex = /"name":"([^"]+)"/g;
let match;
const names = new Set();
while ((match = regex.exec(str)) !== null) {
    names.add(match[1]);
}
console.log(Array.from(names).slice(0, 50));
