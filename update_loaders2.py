with open('public/client.js', 'r', encoding='utf-8') as f:
    text = f.read()

import re

new_loaders = """let archerModels = [];
let archerAnims = [];
let spearModels = [];

let civilianModel = null;
let crowModelTemplate = null;
let civAnims = null;
let crowAnims = null;

// Archer 0 (hawley)
gltfLoader.load('3d_models/hawley_the_archer_anim/scene_embedded.gltf', (gltf) => {
    archerModels[0] = gltf.scene;
    archerAnims[0] = gltf.animations;
    archerModels[0].scale.set(80, 80, 80);
    archerModels[0].traverse(c => { if(c.isMesh) c.castShadow = true; });
}, undefined, (e) => console.error(e));

// Archer 1 (golden)
gltfLoader.load('3d_models/archer_shooting_arrow_from_bow_in_battle.glb', (gltf) => {
    archerModels[1] = gltf.scene;
    archerAnims[1] = gltf.animations;
    archerModels[1].scale.set(80, 80, 80);
    archerModels[1].traverse(c => { if(c.isMesh) c.castShadow = true; });
}, undefined, (e) => console.error(e));

// Spear 0
gltfLoader.load('3d_models/arrow.glb', (gltf) => {
    spearModels[0] = gltf.scene;
    spearModels[0].scale.set(20, 20, 20); 
    spearModels[0].rotation.y = Math.PI / 2;
}, undefined, (e) => console.error(e));

// Spear 1
gltfLoader.load('3d_models/arrow (1).glb', (gltf) => {
    spearModels[1] = gltf.scene;
    spearModels[1].scale.set(20, 20, 20); 
    spearModels[1].rotation.y = Math.PI / 2;
}, undefined, (e) => console.error(e));

// Birds
gltfLoader.load('3d_models/birds.glb', (gltf) => {
    crowModelTemplate = gltf.scene;
    crowAnims = gltf.animations;
    crowModelTemplate.scale.set(20, 20, 20); 
    crowModelTemplate.traverse(child => { if (child.isMesh) { child.castShadow = true; } });
}, undefined, (e) => console.error(e));

"""

loader_start = text.find('let archerModels = [];')
loader_end = text.find('// UI Elements')

if loader_start != -1 and loader_end != -1:
    text = text[:loader_start] + new_loaders + text[loader_end:]

text = text.replace('archerModels[(archerIdx + 1) % 3]', 'archerModels[(archerIdx + 1) % 2]')
text = text.replace('archerAnims[(archerIdx + 1) % 3]', 'archerAnims[(archerIdx + 1) % 2]')

with open('public/client.js', 'w', encoding='utf-8') as f:
    f.write(text)

with open('public/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

html = html.replace('<option value="0">Qora kiyimlik kamonchi</option>', '')
html = html.replace('<option value="1">Yashil kiyimlik kamonchi</option>', '<option value="0">Yashil kiyimlik kamonchi</option>')
html = html.replace('<option value="2">Oltin qoplamali kamonchi</option>', '<option value="1">Oltin qoplamali kamonchi</option>')

html = html.replace('<option value="0">Temir nayza</option>', '')
html = html.replace('<option value="1">Yog\'och nayza</option>', '<option value="0">Yog\'och nayza</option>')
html = html.replace('<option value="2">Nayza 3</option>', '<option value="1">Nayza 3</option>')

html = html.replace('client.js?v=9', 'client.js?v=10')

with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
