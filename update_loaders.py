with open('public/client.js', 'r', encoding='utf-8') as f:
    text = f.read()

import re

# Replace the loader section
loader_start = text.find('let archer1Model = null;')
loader_end = text.find('// UI Elements')

new_loaders = """let archerModels = [];
let archerAnims = [];
let spearModels = [];

let civilianModel = null;
let crowModelTemplate = null;
let civAnims = null;
let crowAnims = null;

// Archer 0
gltfLoader.load('3d_models/hooded_ranged_warrior_archer_meshy_6.glb', (gltf) => {
    archerModels[0] = gltf.scene;
    archerAnims[0] = gltf.animations;
    archerModels[0].scale.set(80, 80, 80);
    archerModels[0].traverse(c => { if(c.isMesh) c.castShadow = true; });
}, undefined, (e) => console.error(e));

// Archer 1
gltfLoader.load('3d_models/hawley_the_archer_anim/scene_embedded.gltf', (gltf) => {
    archerModels[1] = gltf.scene;
    archerAnims[1] = gltf.animations;
    archerModels[1].scale.set(80, 80, 80);
    archerModels[1].traverse(c => { if(c.isMesh) c.castShadow = true; });
}, undefined, (e) => console.error(e));

// Archer 2
gltfLoader.load('3d_models/archer_shooting_arrow_from_bow_in_battle.glb', (gltf) => {
    archerModels[2] = gltf.scene;
    archerAnims[2] = gltf.animations;
    archerModels[2].scale.set(80, 80, 80);
    archerModels[2].traverse(c => { if(c.isMesh) c.castShadow = true; });
}, undefined, (e) => console.error(e));

// Spear 0
gltfLoader.load('3d_models/steampunk_arrow.glb', (gltf) => {
    spearModels[0] = gltf.scene;
    spearModels[0].scale.set(5, 5, 5);
    spearModels[0].rotation.y = Math.PI / 2;
}, undefined, (e) => console.error(e));

// Spear 1
gltfLoader.load('3d_models/arrow.glb', (gltf) => {
    spearModels[1] = gltf.scene;
    spearModels[1].scale.set(20, 20, 20); // adjust as needed
    spearModels[1].rotation.y = Math.PI / 2;
}, undefined, (e) => console.error(e));

// Spear 2
gltfLoader.load('3d_models/arrow (1).glb', (gltf) => {
    spearModels[2] = gltf.scene;
    spearModels[2].scale.set(20, 20, 20); // adjust as needed
    spearModels[2].rotation.y = Math.PI / 2;
}, undefined, (e) => console.error(e));

// Civilian
gltfLoader.load('3d_models/character_test_-_walking.glb', (gltf) => {
    civilianModel = gltf.scene;
    civAnims = gltf.animations;
    civilianModel.scale.set(80, 80, 80);
    civilianModel.traverse(c => { if(c.isMesh) c.castShadow = true; });
}, undefined, (e) => console.error(e));

// Birds
gltfLoader.load('3d_models/birds.glb', (gltf) => {
    crowModelTemplate = gltf.scene;
    crowAnims = gltf.animations;
    crowModelTemplate.scale.set(20, 20, 20); 
    crowModelTemplate.traverse(child => { if (child.isMesh) { child.castShadow = true; } });
}, undefined, (e) => console.error(e));

"""

if loader_start != -1 and loader_end != -1:
    text = text[:loader_start] + new_loaders + text[loader_end:]
else:
    print("Could not find loader section bounds!")

# Now replace createSoldier logic
soldier_old = '''let template = isP1 ? archer1Model : archer2Model;'''
soldier_new = '''
    const archerIdx = document.getElementById('select-archer-model') ? parseInt(document.getElementById('select-archer-model').value) : 0;
    let template = isP1 ? archerModels[archerIdx] : archerModels[(archerIdx + 1) % 3]; // bot gets different skin
    if(!template) template = archerModels[0]; // fallback
'''
text = text.replace(soldier_old, soldier_new)

# Fix anims in createSoldier
anims_old = '''const anims = isP1 ? archer1Anims : archer2Anims;'''
anims_new = '''const anims = isP1 ? archerAnims[archerIdx] : archerAnims[(archerIdx + 1) % 3];'''
text = text.replace(anims_old, anims_new)

# Fix arrow model in createSpear
arrow_old = '''if (arrowModel) {
        const arrow = arrowModel.clone();'''
arrow_new = '''const spearIdx = document.getElementById('select-spear-model') ? parseInt(document.getElementById('select-spear-model').value) : 0;
    let arrowTemplate = spearModels[spearIdx] || spearModels[0];
    if (arrowTemplate) {
        const arrow = arrowTemplate.clone();'''
text = text.replace(arrow_old, arrow_new)

with open('public/client.js', 'w', encoding='utf-8') as f:
    f.write(text)
