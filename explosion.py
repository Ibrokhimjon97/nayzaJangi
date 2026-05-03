import sys

file_path = 'public/client.js'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()


# 1. triggerCinematicExplosion function
explosion_func = '''
function triggerCinematicExplosion(x, y) {
    cinematicMode = true;
    cameraTargetX = x;
    cameraTargetY = y + 50;
    cameraZoomTarget = baseZoom * 2;
    screenShake = 30;

    const particleCount = 120;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    for(let i=0; i<particleCount; i++) {
        positions[i*3] = x;
        positions[i*3+1] = y;
        positions[i*3+2] = 20;
        colors[i*3] = 1.0;
        colors[i*3+1] = Math.random() * 0.6 + 0.1;
        colors[i*3+2] = 0.0;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({ size: 10, vertexColors: true, transparent: true, opacity: 1 });
    const explosion = new THREE.Points(geometry, material);
    scene.add(explosion);
    
    const velocities = [];
    for(let i=0; i<particleCount; i++) {
        velocities.push({
            vx: (Math.random() - 0.5) * 800,
            vy: (Math.random() - 0.5) * 800
        });
    }
    explosion.userData = { vels: velocities, age: 0 };
    if (!window.explosions) window.explosions = [];
    window.explosions.push(explosion);
    
    playSfx('break');

    setTimeout(() => {
        cinematicMode = false;
    }, 2000);
}
'''

content = content.replace('function startBackgroundMusic() {', explosion_func + '\nfunction startBackgroundMusic() {')


# 2. Update animate() loop to process explosions
animate_explosions = '''
    if (window.explosions) {
        for (let i = window.explosions.length - 1; i >= 0; i--) {
            const expl = window.explosions[i];
            expl.userData.age += dt;
            const posAttr = expl.geometry.attributes.position;
            const mat = expl.material;
            
            for(let j=0; j<expl.userData.vels.length; j++) {
                posAttr.array[j*3] += expl.userData.vels[j].vx * dt;
                posAttr.array[j*3+1] += expl.userData.vels[j].vy * dt;
                expl.userData.vels[j].vy -= GRAVITY * 0.2 * dt; // slightly affected by gravity
            }
            posAttr.needsUpdate = true;
            mat.opacity = Math.max(0, 1.0 - (expl.userData.age / 1.5));
            
            if (expl.userData.age > 1.5) {
                scene.remove(expl);
                expl.geometry.dispose();
                expl.material.dispose();
                window.explosions.splice(i, 1);
            }
        }
    }
'''

# insert inside animate() right before `renderer.render(scene, camera);`
content = content.replace('renderer.render(scene, camera);', animate_explosions + '\n    renderer.render(scene, camera);')


# 3. Hit listeners
# single player applyHit
apply_hit_old = '''function applyHit(targetModel, damage, hitZone, duckDodged, shieldHit, shieldActiveBlock, shieldlessDefense, shieldBroke) {
    if (duckDodged) {'''
apply_hit_new = '''function applyHit(targetModel, damage, hitZone, duckDodged, shieldHit, shieldActiveBlock, shieldlessDefense, shieldBroke, isArtillery=false) {
    if (isArtillery) {
        triggerCinematicExplosion(targetModel.position.x, targetModel.position.y);
        showDamageText(targetModel.position.x, targetModel.position.y + 80, `-50`, false, true);
        setSoldierVisual(targetModel, 'hurt');
        return;
    }
    if (duckDodged) {'''
content = content.replace(apply_hit_old, apply_hit_new)


# single player physics loop
physics_hit_old = '''        if (ducking && (hitZone === 'head' || hitZone === 'body')) {
            appliedDamage = 0;
            duckDodged = true;
        } else if (shieldHp > 0 && defending && (hitZone === 'head' || hitZone === 'body')) {'''

physics_hit_new = '''        if (spear.isArtillery) {
            appliedDamage = 50;
            shieldHit = false;
            duckDodged = false;
        } else if (ducking && (hitZone === 'head' || hitZone === 'body')) {
            appliedDamage = 0;
            duckDodged = true;
        } else if (shieldHp > 0 && defending && (hitZone === 'head' || hitZone === 'body')) {'''
content = content.replace(physics_hit_old, physics_hit_new)

# applying applyHit in single player
single_hit_old = '''applyHit(hitEntity.mesh, appliedDamage, hitZone, duckDodged, shieldHit, shieldActiveBlock, shieldlessDefense, shieldBroke);'''
single_hit_new = '''applyHit(hitEntity.mesh, appliedDamage, hitZone, duckDodged, shieldHit, shieldActiveBlock, shieldlessDefense, shieldBroke, spear.isArtillery);'''
content = content.replace(single_hit_old, single_hit_new)


# socket.on hitRegistered
socket_hit_old = '''socket.on('hitRegistered', (data) => {
    const { targetIndex, damage, newHealth, newShield, hitX, hitY, isShieldHit, hitAngle, shieldActiveBlock, shieldlessDefense, shieldBroke, hitZone, duckDodged } = data;
    const targetModel = targetIndex === 0 ? p1Model : p2Model;
    
    if (spear && spear.playerIndex !== myPlayerIndex) {
        flashHit(targetModel);
        hideFlyingSpear();
        
        if (duckDodged) {'''

socket_hit_new = '''socket.on('hitRegistered', (data) => {
    const { targetIndex, damage, newHealth, newShield, hitX, hitY, isShieldHit, hitAngle, shieldActiveBlock, shieldlessDefense, shieldBroke, hitZone, duckDodged } = data;
    const targetModel = targetIndex === 0 ? p1Model : p2Model;
    
    if (spear && spear.playerIndex !== myPlayerIndex) {
        hideFlyingSpear();
        if (spear.isArtillery) {
            triggerCinematicExplosion(hitX, hitY);
            showDamageText(hitX, hitY + 80, `-${damage}`, false, true);
        } else {
            flashHit(targetModel);
        
        if (duckDodged) {'''

socket_hit_old_end = '''        } else {
            spawnParticles(hitX, hitY, 15, false);
            showDamageText(hitX, hitY + 80, `-${damage}`, false, true);
            playSfx('hit');
        }
    }'''

socket_hit_new_end = '''        } else {
            spawnParticles(hitX, hitY, 15, false);
            showDamageText(hitX, hitY + 80, `-${damage}`, false, true);
            playSfx('hit');
        }
        }
    }'''

content = content.replace(socket_hit_old, socket_hit_new).replace(socket_hit_old_end, socket_hit_new_end)

# groundHit explosion
socket_ground_old = '''socket.on('groundHit', (data) => {
    if (spear && spear.playerIndex !== myPlayerIndex) {
        stickSpear(null, data.hitX, data.hitY, data.hitAngle);
        hideFlyingSpear();
        playSfx('ground');
    }
});'''
socket_ground_new = '''socket.on('groundHit', (data) => {
    if (spear && spear.playerIndex !== myPlayerIndex) {
        if (spear.isArtillery) {
            triggerCinematicExplosion(data.hitX, data.hitY);
            hideFlyingSpear();
        } else {
            stickSpear(null, data.hitX, data.hitY, data.hitAngle);
            hideFlyingSpear();
            playSfx('ground');
        }
    }
});'''
content = content.replace(socket_ground_old, socket_ground_new)


# wallHitFx explosion
socket_wall_old = '''socket.on('wallHitFx', (data) => {
    const { ownerIndex, hitX, hitY } = data;
    spawnParticles(hitX, hitY, 15, true);
    showDamageText(hitX, hitY + 80, "DEVOR", false, true);
    playSfx('shieldPassive');
    
    if (walls[ownerIndex]) {'''

socket_wall_new = '''socket.on('wallHitFx', (data) => {
    const { ownerIndex, hitX, hitY, isArtillery } = data;
    if (isArtillery) {
        triggerCinematicExplosion(hitX, hitY);
        showDamageText(hitX, hitY + 80, "YAKSON!", false, true);
    } else {
        spawnParticles(hitX, hitY, 15, true);
        showDamageText(hitX, hitY + 80, "DEVOR", false, true);
        playSfx('shieldPassive');
    }
    
    if (walls[ownerIndex]) {'''

content = content.replace(socket_wall_old, socket_wall_new)

# multi emit entityHit
multi_entity_old = '''                if (!spear.entityHitEmitted) {
                    socket.emit('entityHit', { entityIndex: entities.indexOf(hitEntity), hitX, hitY, hitAngle: spearGroup.rotation.z });
                    spear.entityHitEmitted = true;
                }'''

multi_entity_new = '''                if (!spear.entityHitEmitted) {
                    socket.emit('entityHit', { entityIndex: entities.indexOf(hitEntity), hitX, hitY, hitAngle: spearGroup.rotation.z, isArtillery: spear.isArtillery });
                    spear.entityHitEmitted = true;
                }'''

content = content.replace(multi_entity_old, multi_entity_new)


# multi emit wallHit
multi_wall_old = '''            if (spear.playerIndex === myPlayerIndex) {
                socket.emit('wallHit', { ownerIndex: wallOwnerIndex, hitX, hitY });
            }'''
multi_wall_new = '''            if (spear.playerIndex === myPlayerIndex) {
                socket.emit('wallHit', { ownerIndex: wallOwnerIndex, hitX, hitY, isArtillery: spear.isArtillery });
            }'''
content = content.replace(multi_wall_old, multi_wall_new)


with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Done!')
