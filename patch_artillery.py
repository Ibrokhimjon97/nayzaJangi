import re
import os

filepath = r'public/client.js'

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add bombMesh to spearGroup
bomb_code = """
const bombMesh = new THREE.Mesh(new THREE.SphereGeometry(18, 16, 16), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }));
bombMesh.name = 'spear-bomb';
bombMesh.visible = false;
spearGroup.add(bombMesh);

spearGroup.castShadow = true;
scene.add(spearGroup);
"""
content = re.sub(r'spearGroup\.castShadow\s*=\s*true;\s*scene\.add\(spearGroup\);', bomb_code, content)

# 2. Modify applySpearVisualStyle to toggle bomb
apply_spear_old = """function applySpearVisualStyle(isSpearmanThrow) {
    const styleScale = isSpearmanThrow ? 1.3 : 1;
    [spearGroup, secondarySpearGroup].forEach((group) => {
        if (!group) return;
        const shaft = group.getObjectByName('spear-shaft');
        const tipGroup = group.getObjectByName('spear-tip-group');
        const blade = group.getObjectByName('spear-blade');
        const feather = group.getObjectByName('spear-feather');
        if (shaft) shaft.scale.set(1, styleScale, styleScale);
        if (tipGroup) tipGroup.scale.set(styleScale, styleScale, styleScale);
        if (blade && blade.material && blade.material.color) {
            blade.material.color.setHex(isSpearmanThrow ? 0xe2e8f0 : 0xffffff);
            blade.material.needsUpdate = true;
        }
        if (feather && feather.material && feather.material.color) {
            feather.material.color.setHex(isSpearmanThrow ? 0x7c3aed : 0xff0000);
            feather.material.needsUpdate = true;
        }
    });
}"""

apply_spear_new = """function applySpearVisualStyle(isSpearmanThrow, isArtillery = false) {
    const styleScale = isSpearmanThrow ? 1.3 : 1;
    [spearGroup, secondarySpearGroup].forEach((group) => {
        if (!group) return;
        const shaft = group.getObjectByName('spear-shaft');
        const tipGroup = group.getObjectByName('spear-tip-group');
        const feather = group.getObjectByName('spear-feather');
        const bomb = group.getObjectByName('spear-bomb');

        if (isArtillery) {
            if (shaft) shaft.visible = false;
            if (tipGroup) tipGroup.visible = false;
            if (feather) feather.visible = false;
            if (bomb) bomb.visible = true;
        } else {
            if (shaft) shaft.visible = true;
            if (tipGroup) tipGroup.visible = true;
            if (feather) feather.visible = true;
            if (bomb) bomb.visible = false;
            
            const blade = group.getObjectByName('spear-blade');
            if (shaft) shaft.scale.set(1, styleScale, styleScale);
            if (tipGroup) tipGroup.scale.set(styleScale, styleScale, styleScale);
            if (blade && blade.material && blade.material.color) {
                blade.material.color.setHex(isSpearmanThrow ? 0xe2e8f0 : 0xffffff);
                blade.material.needsUpdate = true;
            }
            if (feather && feather.material && feather.material.color) {
                feather.material.color.setHex(isSpearmanThrow ? 0x7c3aed : 0xff0000);
                feather.material.needsUpdate = true;
            }
        }
    });
}"""
content = content.replace(apply_spear_old, apply_spear_new)


# 3. Fix startSpearAnimation arguments and spear spawn coordinates
start_anim_old = r'function startSpearAnimation\(playerIndex, angle, power\) {'
start_anim_new = r'function startSpearAnimation(playerIndex, angle, power, isArtillery = false) {'
content = re.sub(start_anim_old, start_anim_new, content)

spear_coords_old = """    const startX = playerIndex === 0 ? p1Model.position.x + 60 : thrower.position.x - 60;
    const startY = thrower.position.y + 270; 

    const rad = angle * (Math.PI / 180);"""
    
spear_coords_new = """    let startX = playerIndex === 0 ? p1Model.position.x + 60 : thrower.position.x - 60;
    let startY = thrower.position.y + 270; 
    
    if (isArtillery) {
        startX = thrower.position.x + (playerIndex === 0 ? 150 : -150) + (playerIndex === 0 ? 50 : -50);
        startY = thrower.position.y + 150;
    }

    const rad = angle * (Math.PI / 180);"""
content = content.replace(spear_coords_old, spear_coords_new)


# 4. Fix spear state creation to include isArtillery and applySpearVisualStyle
spear_state_old = """        hitEntity: null,
        entityHitEmitted: false,
        aiSuperTried: false
    };"""
    
spear_state_new = """        hitEntity: null,
        entityHitEmitted: false,
        aiSuperTried: false,
        isArtillery: isArtillery
    };"""
content = content.replace(spear_state_old, spear_state_new)

style_call_old = """    applySpearVisualStyle(isSpearmanThrow);
    const spearScale = isSpearmanThrow ? 1.9 : 1;"""

style_call_new = """    applySpearVisualStyle(isSpearmanThrow, isArtillery);
    const spearScale = isArtillery ? 2.5 : (isSpearmanThrow ? 1.9 : 1);"""
content = content.replace(style_call_old, style_call_new)

# 5. Fix Artillery cannon spawn location and getMyGroup ReferenceError
cannon_spawn_old = """                const playerGrp = getMyGroup();
                if (playerGrp) {
                    myArtilleryCannon.position.set(playerGrp.position.x + (myPlayerIndex === 0 ? 80 : -80), playerGrp.position.y - 40, playerGrp.position.z + 10);
                    myArtilleryCannon.visible = true;
                }"""
                
cannon_spawn_new = """                const playerGrp = myPlayerIndex === 0 ? p1Model : p2Model;
                if (playerGrp) {
                    myArtilleryCannon.scale.set(1.5, 1.5, 1.5);
                    myArtilleryCannon.position.set(playerGrp.position.x + (myPlayerIndex === 0 ? 150 : -150), playerGrp.position.y + 60, playerGrp.position.z + 10);
                    myArtilleryCannon.visible = true;
                    if (myPlayerIndex === 1) myArtilleryCannon.rotation.y = Math.PI;
                    else myArtilleryCannon.rotation.y = 0;
                }"""
content = content.replace(cannon_spawn_old, cannon_spawn_new)

# 6. Fix trajectory line start point when isArtilleryAiming is true
trajectory_old = """            const startX = myPlayerIndex === 0 ? p1Model.position.x + 60 : p2Model.position.x - 60;
            const startY = p1Model.position.y + 270;
            
            const points = [];
            let simX = startX;"""

trajectory_new = """            let startX = myPlayerIndex === 0 ? p1Model.position.x + 60 : p2Model.position.x - 60;
            let startY = p1Model.position.y + 270;
            
            if (isArtilleryAiming && myArtilleryCannon) {
                startX = myArtilleryCannon.position.x + (myPlayerIndex === 0 ? 50 : -50);
                startY = myArtilleryCannon.position.y + 50;
            }
            
            const points = [];
            let simX = startX;"""
content = content.replace(trajectory_old, trajectory_new)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print("Patched successfully!")
