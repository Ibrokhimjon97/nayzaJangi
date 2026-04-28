const fs = require('fs');
const data = fs.readFileSync('public/3d_models/hooded_ranged_warrior_archer_meshy_6.glb');
const str = data.toString('utf8');
const idx = str.indexOf('"animations"');
if(idx !== -1) {
    console.log(str.substring(idx, idx+1500));
} else {
    console.log('No animations found anywhere');
}
