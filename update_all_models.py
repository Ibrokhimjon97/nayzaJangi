import re

with open('public/client.js', 'r', encoding='utf-8') as f:
    text = f.read()

models_loader_code = """
let archer1Model = null;
let archer2Model = null;
let arrowModel = null;
let civilianModel = null;

gltfLoader.load('3d models/archer1/scene.gltf', (gltf) => {
    archer1Model = gltf.scene;
    archer1Model.scale.set(80, 80, 80);
    archer1Model.traverse(c => { if(c.isMesh) c.castShadow = true; });
}, undefined, (e) => console.error(e));

gltfLoader.load('3d models/hooded_ranged_warrior_archer_meshy_6.glb', (gltf) => {
    archer2Model = gltf.scene;
    archer2Model.scale.set(80, 80, 80);
    archer2Model.traverse(c => { if(c.isMesh) c.castShadow = true; });
}, undefined, (e) => console.error(e));

gltfLoader.load('3d models/steampunk_arrow.glb', (gltf) => {
    arrowModel = gltf.scene;
    arrowModel.scale.set(50, 50, 50);
    arrowModel.rotation.y = Math.PI / 2;
}, undefined, (e) => console.error(e));

gltfLoader.load('3d models/character_test_-_walking.glb', (gltf) => {
    civilianModel = gltf.scene;
    civilianModel.scale.set(80, 80, 80);
    civilianModel.traverse(c => { if(c.isMesh) c.castShadow = true; });
}, undefined, (e) => console.error(e));
"""

if 'archer1Model = null;' not in text:
    text = text.replace('gltfLoader = new THREE.GLTFLoader();', 'gltfLoader = new THREE.GLTFLoader();\n' + models_loader_code)


new_create_civilian = """function createCivilian() {
    const group = new THREE.Group();
    
    if (civilianModel) {
        const model = civilianModel.clone();
        model.position.y = -40; // Adjust offset
        group.add(model);
    } else {
        const skinMat = new THREE.MeshStandardMaterial({color: 0xd2a679});
        const shirtMat = new THREE.MeshStandardMaterial({color: 0x3b82f6});
        const pantsMat = new THREE.MeshStandardMaterial({color: 0x1e293b});
        
        const torso = new THREE.Mesh(new THREE.BoxGeometry(24, 32, 16), shirtMat);
        torso.position.y = 36;
        group.add(torso);
        const head = new THREE.Mesh(new THREE.SphereGeometry(12), skinMat);
        head.position.y = 60;
        group.add(head);
        const legL = new THREE.Mesh(new THREE.BoxGeometry(8, 20, 8), pantsMat); legL.position.set(6, 10, 0); group.add(legL);
        const legR = new THREE.Mesh(new THREE.BoxGeometry(8, 20, 8), pantsMat); legR.position.set(-6, 10, 0); group.add(legR);
        const armL = new THREE.Mesh(new THREE.BoxGeometry(6, 28, 6), skinMat); armL.position.set(15, 34, 0); group.add(armL);
        const armR = new THREE.Mesh(new THREE.BoxGeometry(6, 28, 6), skinMat); armR.position.set(-15, 34, 0); group.add(armR);
    }
    
    return group;
}"""
text = re.sub(r'function createCivilian\(\) \{[\s\S]*?return group;\n\}', new_create_civilian, text)


new_create_soldier = """function createSoldier(isP1, charType = 0) {
    const group = new THREE.Group();
    
    // Create dummies to prevent game logic crash
    group.userData.mats = [];
    group.userData.torso = new THREE.Group();
    group.userData.headGroup = new THREE.Group();
    group.userData.armL = new THREE.Group();
    group.userData.armR = new THREE.Group();
    group.userData.shieldGroup = new THREE.Group();
    
    // Add armR so spear throws from correct offset
    group.add(group.userData.armR);
    
    let template = isP1 ? archer1Model : archer2Model;
    
    if (template) {
        const model = template.clone();
        model.position.y = -100; // Adjust foot to floor
        
        if (!isP1) {
            model.rotation.y = Math.PI; 
        } else {
            model.rotation.y = 0; 
        }
        
        model.traverse(child => {
            if (child.isMesh && child.material) {
                child.material = child.material.clone();
                group.userData.mats.push(child.material);
            }
        });
        
        group.add(model);
        group.position.y = -140; // Adjust overall group position
    } else {
        // Fallback simple box soldier
        const suitMat = new THREE.MeshStandardMaterial({ color: isP1 ? 0x2c3e50 : 0x8b0000 });
        group.userData.mats.push(suitMat);
        const body = new THREE.Mesh(new THREE.BoxGeometry(40, 60, 20), suitMat);
        group.add(body);
        group.userData.torso.add(body);
        group.position.y = -180;
    }

    scene.add(group);
    return group;
}"""
text = re.sub(r'function createSoldier\(isP1, charType = 0\) \{[\s\S]*?return group;\n\}', new_create_soldier, text)


# Update Spear
spear_setup = """let spear = null;
const spearGroup = new THREE.Group();

if (arrowModel) {
    const arr = arrowModel.clone();
    spearGroup.add(arr);
} else {
    const spearShaft = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 110), new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 0.5 }));
    spearShaft.rotateZ(Math.PI / 2);
    spearGroup.add(spearShaft);
    const spearTipGroup = new THREE.Group();
    spearTipGroup.position.x = 60;
    const spearBlade = new THREE.Mesh(new THREE.ConeGeometry(3.5, 20, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.9, roughness: 0.2 }));
    spearBlade.rotateZ(-Math.PI / 2);
    spearTipGroup.add(spearBlade);
    spearGroup.add(spearTipGroup);
}

spearGroup.castShadow = true;
scene.add(spearGroup);
spearGroup.visible = false;
"""
text = re.sub(r'let spear = null;\nconst spearGroup = new THREE\.Group\(\);[\s\S]*?spearGroup\.visible = false;', spear_setup, text)

# Because GLTF load is async, when startSinglePlayer or gameStart is called, the models might just be ready.
# To ensure the spear updates if arrowModel loads later:
# We can just recreate spearGroup elements inside startSpearAnimation or gameStart.
# Let's dynamically update spearGroup inside throwSpear/startSpearAnimation.

spear_update_logic = """function startSpearAnimation(playerIndex, angle, power) {
    if (arrowModel && spearGroup.children.length === 0 || (spearGroup.children.length > 0 && !spearGroup.children[0].isGroup)) {
        // clear old boxy spear and add new one
        while(spearGroup.children.length > 0){ 
            spearGroup.remove(spearGroup.children[0]); 
        }
        spearGroup.add(arrowModel.clone());
    }
"""
text = text.replace('function startSpearAnimation(playerIndex, angle, power) {', spear_update_logic)

with open('public/client.js', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated models successfully")
