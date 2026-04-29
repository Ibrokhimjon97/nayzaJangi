import re

with open(r'c:\Users\Ibrokhimjohn\Desktop\game\public\client.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace const p1Model and p2Model with let
content = re.sub(r'const p1Model\s*=\s*createSoldier\(true\);', r'let p1Model = createSoldier(true, 0);', content)
content = re.sub(r'const p2Model\s*=\s*createSoldier\(false\);', r'let p2Model = createSoldier(false, 0);', content)

# 2. Add rocks array tracking
content = re.sub(
    r'(const groundGeo.*?scene\.add\(ground\);)',
    r'\1\nconst rocks = [];',
    content,
    flags=re.DOTALL
)
content = re.sub(
    r'(rock\.receiveShadow = true;\s*scene\.add\(rock\);)',
    r'\1\n    rocks.push(rock);',
    content
)

# 3. Add entities system & seededRandom
entities_code = """
let entities = [];
let myCivilianKills = 0;
let currentSeed = 0.5;
function seededRandom() {
    const x = Math.sin(currentSeed++) * 10000;
    return x - Math.floor(x);
}

function createAnimal() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(25, 15, 12), new THREE.MeshStandardMaterial({color: 0xeeeeee}));
    body.position.y = 12;
    const head = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshStandardMaterial({color: 0x222222}));
    head.position.set(12, 20, 0);
    group.add(body); group.add(head);
    return group;
}

function createCivilian() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 25), new THREE.MeshStandardMaterial({color: 0x8b4513}));
    body.position.y = 12;
    const head = new THREE.Mesh(new THREE.SphereGeometry(7), new THREE.MeshStandardMaterial({color: 0xd2a679}));
    head.position.y = 30;
    group.add(body); group.add(head);
    return group;
}

function buildMap(mapType) {
    let groundColor = 0x1e293b;
    let rockColor = 0x334155;
    if (mapType === 'winter') { groundColor = 0xe2e8f0; rockColor = 0x94a3b8; }
    if (mapType === 'desert') { groundColor = 0xedc9af; rockColor = 0xc2b280; }
    if (mapType === 'castle') { groundColor = 0x475569; rockColor = 0x1e293b; }
    ground.material.color.setHex(groundColor);
    rocks.forEach(r => r.material.color.setHex(rockColor));
}

function spawnEntities(options) {
    entities.forEach(e => scene.remove(e.mesh));
    entities = [];
    if (!options) return;
    currentSeed = options.seed || 0.5;
    
    if (options.birds) {
        for(let i=0; i<3; i++) {
            const bird = createCrow(0, 0);
            bird.position.set((seededRandom() - 0.5) * 1000, 300 + seededRandom() * 200, 0);
            scene.add(bird);
            entities.push({ type: 'bird', mesh: bird, vx: 100 + seededRandom()*100, alive: true });
        }
    }
    if (options.animals) {
        for(let i=0; i<4; i++) {
            const animal = createAnimal();
            const px = i % 2 === 0 ? pos1X + (seededRandom()*400 - 200) : pos2X + (seededRandom()*400 - 200);
            animal.position.set(px, ground.position.y + 100, 0);
            scene.add(animal);
            entities.push({ type: 'animal', mesh: animal, alive: true });
        }
    }
    if (options.civilians) {
        for(let i=0; i<4; i++) {
            const civ = createCivilian();
            const px = i % 2 === 0 ? pos1X + (seededRandom()*300 - 150) : pos2X + (seededRandom()*300 - 150);
            civ.position.set(px, ground.position.y + 100, 0);
            scene.add(civ);
            entities.push({ type: 'civilian', mesh: civ, alive: true });
        }
    }
}
"""
content = re.sub(r'(const bloodParticles = \[\];)', entities_code + r'\n\1', content)

# 4. Modify createSoldier
create_soldier_sig = r'function createSoldier\(isP1\) \{'
new_create_soldier_sig = """function createSoldier(isP1, charType = 0) {
    const group = new THREE.Group();
    
    let pColor, vestColor, skinMatColor = 0xd2a679;
    switch(parseInt(charType)) {
        case 0: pColor = isP1 ? 0x2c3e50 : 0x4b5320; vestColor = 0x222222; break; // Commando
        case 1: pColor = 0x8b0000; vestColor = 0x111111; break; // Red Avenger
        case 2: pColor = 0xeeeeee; vestColor = 0xaaaaaa; break; // Winter
        case 3: pColor = 0xc2b280; vestColor = 0x8b4513; break; // Desert
        case 4: pColor = 0x111111; vestColor = 0x050505; skinMatColor = 0x8d5524; break; // Black Ops
        default: pColor = isP1 ? 0x2c3e50 : 0x4b5320; vestColor = 0x222222;
    }
    
    const skinMat = new THREE.MeshStandardMaterial({ color: skinMatColor, roughness: 0.5 });
    const vestMat = new THREE.MeshStandardMaterial({ color: vestColor, roughness: 0.8 });
    const gearMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 });
    const suitMat = new THREE.MeshStandardMaterial({ color: pColor, roughness: 0.9 });
"""
content = re.sub(r'function createSoldier\(isP1\) \{.*?const suitMat = new THREE\.MeshStandardMaterial\(\{ color: pColor, roughness: 0\.9 \}\);', new_create_soldier_sig, content, flags=re.DOTALL)

# 5. Modify myProfile initial load and btn settings save
content = re.sub(
    r"avatar: '👤',\s*flag: '🇺🇿'\s*};",
    "avatar: '👤',\n    flag: '🇺🇿',\n    charType: 0\n};",
    content
)

content = re.sub(
    r"myProfile\.avatar = document\.getElementById\('select-avatar'\)\.value;",
    r"myProfile.avatar = document.getElementById('select-avatar').value;\n    myProfile.charType = document.getElementById('select-char-type').value;",
    content
)

content = re.sub(
    r"document\.getElementById\('select-avatar'\)\.value = myProfile\.avatar;",
    r"document.getElementById('select-avatar').value = myProfile.avatar;\n    document.getElementById('select-char-type').value = myProfile.charType || 0;",
    content
)

# 6. CheckCollision update for entities
entity_collision = """
    let hitEntity = null;
    for(let e of entities) {
        if (e.alive) {
            const dx = spear.x - e.mesh.position.x;
            const dy = spear.y - e.mesh.position.y;
            if (Math.abs(dx) < 30 && Math.abs(dy) < 50) {
                hitEntity = e;
                break;
            }
        }
    }

    if (hitEntity) {
        hitEntity.alive = false;
        spear.active = false;
        finishAnimation(false, -1, spear.x, spear.y, hitEntity);
        return;
    }
"""
content = re.sub(
    r'(if \(spear\.y <= ground\.position\.y \+ 100\))',
    entity_collision + r'\n    \1',
    content
)

# 7. Update GameLoop for entities
entity_update = """
    entities.forEach(e => {
        if (e.type === 'bird' && e.alive) {
            e.mesh.position.x += e.vx * dt;
            if (e.mesh.position.x > 800) e.vx = -Math.abs(e.vx);
            if (e.mesh.position.x < -800) e.vx = Math.abs(e.vx);
            e.mesh.rotation.y = e.vx > 0 ? 0 : Math.PI;
        }
        if (!e.alive && e.mesh.position.y > ground.position.y + 100) {
            e.mesh.position.y -= GRAVITY * dt * 0.5;
            e.mesh.rotation.z += 5 * dt;
        }
    });
"""
content = re.sub(
    r'(// Blood particles)',
    entity_update + r'\n    \1',
    content
)

# 8. Update finishAnimation to receive hitEntity
content = re.sub(
    r'function finishAnimation\(hitOpponent, targetIndex, hitX, hitY\) \{',
    r'function finishAnimation(hitOpponent, targetIndex, hitX, hitY, hitEntity = null) {',
    content
)
finish_anim_logic = """
    if (hitEntity) {
        hitEntity.mesh.rotation.z = Math.PI / 2;
        stickSpear(hitEntity.mesh, hitX, hitY, spearGroup.rotation.z);
        spawnParticles(hitX, hitY, 20);
        
        if (hitEntity.type === 'civilian') {
            showDamageText(hitX, hitY + 50, "FUQARO HALOK BO'LDI!", true);
            if (spear.playerIndex === myPlayerIndex) {
                myCivilianKills++;
                if (myCivilianKills >= 5) {
                    if (gameMode === 'multi') socket.emit('civilianKilled');
                    else showGameOver(currentTurnIndex === 0 ? 1 : 0);
                }
            }
        } else {
            showDamageText(hitX, hitY + 50, hitEntity.type === 'bird' ? "QUSH!" : "HAYVON!", true);
        }
        
        if (spear.playerIndex === myPlayerIndex || gameMode === 'single') {
            if (gameMode === 'multi') {
                socket.emit('throwComplete', { hitOpponent: false, hitX, hitY, hitAngle: spearGroup.rotation.z });
            } else {
                setTimeout(() => {
                    updateTurn(currentTurnIndex === 0 ? 1 : 0, generateWind());
                    if (currentTurnIndex === 1) playAITurn();
                }, 1500);
            }
        }
        return;
    }
"""
content = re.sub(
    r'(if \(spear\.playerIndex === myPlayerIndex \|\| gameMode === \'single\'\) \{)',
    finish_anim_logic + r'\n    \1',
    content
)


# 9. gameStart logic to apply options and characters
game_start_logic = """
    const opts = data.options || { map: 'field', birds: false, animals: false, civilians: false };
    buildMap(opts.map);
    spawnEntities(opts);
    myCivilianKills = 0;
    
    scene.remove(p1Model);
    scene.remove(p2Model);
    const p1Char = myPlayerIndex === 0 ? myProfile.charType : (data.opponentProfile.charType || 0);
    const p2Char = myPlayerIndex === 1 ? myProfile.charType : (data.opponentProfile.charType || 0);
    p1Model = createSoldier(true, p1Char); p1Model.position.x = pos1X;
    p2Model = createSoldier(false, p2Char); p2Model.position.x = pos2X;
    
    if (gameMode === 'multi') {
"""
content = re.sub(
    r'(if \(gameMode === \'multi\'\) \{)',
    game_start_logic,
    content,
    count=1
)

# 10. singlePlayer logic to apply options and characters
single_player_logic = """
    myCivilianKills = 0;
    buildMap('field');
    spawnEntities({ birds: true, animals: true, civilians: true, seed: Math.random() });
    
    scene.remove(p1Model);
    scene.remove(p2Model);
    p1Model = createSoldier(true, myProfile.charType || 0); p1Model.position.x = pos1X;
    p2Model = createSoldier(false, Math.floor(Math.random()*5)); p2Model.position.x = pos2X;
    
    myPlayerIndex = 0;
"""
content = re.sub(
    r'(myPlayerIndex = 0;)',
    single_player_logic,
    content,
    count=1
)

# 11. MultiMenu buttons logic
multi_menu_logic = """
btnMultiCreate.addEventListener('click', () => {
    initAudio();
    multiMenu.classList.add('hidden');
    document.getElementById('game-options-modal').classList.remove('hidden');
});

document.getElementById('btn-cancel-options').addEventListener('click', () => {
    document.getElementById('game-options-modal').classList.add('hidden');
    multiMenu.classList.remove('hidden');
});

document.getElementById('btn-confirm-create').addEventListener('click', () => {
    document.getElementById('game-options-modal').classList.add('hidden');
    
    const options = {
        map: document.getElementById('select-map').value,
        birds: document.getElementById('check-birds').checked,
        animals: document.getElementById('check-animals').checked,
        civilians: document.getElementById('check-civilians').checked,
        seed: Math.random()
    };
    
    socket.emit('createGame', { profile: myProfile, options: options });
    multiMenu.classList.remove('hidden');
    document.getElementById('create-code-container').classList.remove('hidden');
    document.getElementById('join-code-container').classList.add('hidden');
});
"""

content = re.sub(
    r'btnMultiCreate\.addEventListener\(\'click\', \(\) => \{.*?document\.getElementById\(\'join-code-container\'\)\.classList\.add\(\'hidden\'\);\s*\}\);',
    multi_menu_logic,
    content,
    flags=re.DOTALL
)


with open(r'c:\Users\Ibrokhimjohn\Desktop\game\public\client.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated client.js successfully")
