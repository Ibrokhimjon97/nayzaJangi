import sys

file_path = 'public/client.js'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Shop UI
shop_ui_old = '''    if (shopWallMaxText) shopWallMaxText.innerText = `Soni: ${Math.max(0, Number(myProfile.walls || 0))}`;
    if (btnBuySuper) btnBuySuper.disabled = score < SUPER_BUY_COST;
    if (btnBuyDouble) btnBuyDouble.disabled = score < DOUBLE_BUY_COST;
    if (btnBuyWall) btnBuyWall.disabled = score < WALL_BUY_COST;
}'''

shop_ui_new = '''    if (shopWallMaxText) shopWallMaxText.innerText = `Soni: ${Math.max(0, Number(myProfile.walls || 0))}`;
    const shopArtilleryMaxText = document.getElementById('shop-artillery-max');
    if (shopArtilleryMaxText) shopArtilleryMaxText.innerText = `Soni: ${Math.max(0, Number(myProfile.artillery || 0))}`;
    const btnBuyArtillery = document.getElementById('btn-buy-artillery');
    const ARTILLERY_BUY_COST = 500;
    if (btnBuySuper) btnBuySuper.disabled = score < SUPER_BUY_COST;
    if (btnBuyDouble) btnBuyDouble.disabled = score < DOUBLE_BUY_COST;
    if (btnBuyWall) btnBuyWall.disabled = score < WALL_BUY_COST;
    if (btnBuyArtillery) btnBuyArtillery.disabled = score < ARTILLERY_BUY_COST;
}'''

content = content.replace(shop_ui_old, shop_ui_new)

# Shop buy logic
buy_wall_old = '''    if (btnBuyWall) {
        btnBuyWall.addEventListener('click', () => {
            if (Number(myStats.score || 0) < WALL_BUY_COST) return;
            addScore(-WALL_BUY_COST);
            myProfile.walls = (myProfile.walls || 0) + 1;
            wallCount = myProfile.walls;
            saveProfile();
            updateShopUI();
        });
    }'''

buy_artillery = '''
    const btnBuyArtillery = document.getElementById('btn-buy-artillery');
    const ARTILLERY_BUY_COST = 500;
    if (btnBuyArtillery) {
        btnBuyArtillery.addEventListener('click', () => {
            if (Number(myStats.score || 0) < ARTILLERY_BUY_COST) return;
            addScore(-ARTILLERY_BUY_COST);
            myProfile.artillery = (myProfile.artillery || 0) + 1;
            artilleryCount = myProfile.artillery;
            saveProfile();
            updateShopUI();
        });
    }
'''

content = content.replace(buy_wall_old, buy_wall_old + buy_artillery)


# 2. In-game variables and logic
game_logic_old = '''let isAiming = false;
let pointerStartX = 0;
let pointerStartY = 0;
let currentTrajectoryAngle = 0;
let currentTrajectoryPower = 0;
let dragCount = 0;'''

game_logic_new = game_logic_old + '''
let artilleryCount = 0;
let isArtilleryAiming = false;
let myArtilleryCannon = null;
let btnArtillery = document.getElementById('artillery-button');
let artilleryCountText = document.getElementById('artillery-count');
'''

content = content.replace(game_logic_old, game_logic_new)


# Sync profile variables when UI is built
update_hud_old = '''function updateSuperUI() {
    if (superCountText) superCountText.innerText = String(mySuper);
    if (doubleCountText) doubleCountText.innerText = String(doubleCount);
    if (wallCountText) wallCountText.innerText = String(wallCount);
    if (crowCountText) crowCountText.innerText = String(crowCount);'''

update_hud_new = '''function updateSuperUI() {
    artilleryCount = Number(myProfile.artillery || 0);
    if (superCountText) superCountText.innerText = String(mySuper);
    if (doubleCountText) doubleCountText.innerText = String(doubleCount);
    if (wallCountText) wallCountText.innerText = String(wallCount);
    if (crowCountText) crowCountText.innerText = String(crowCount);
    if (artilleryCountText) artilleryCountText.innerText = String(artilleryCount);
    if (btnArtillery) btnArtillery.style.display = artilleryCount > 0 ? 'flex' : 'none';'''

content = content.replace(update_hud_old, update_hud_new)


# Adding artillery button listener near other buttons like crow
crow_listen_old = '''    if (btnCrow) {
        btnCrow.addEventListener('click', () => {
            if (gameOver || isMyTurn === false || crowCount <= 0) return;
            triggerAbilityPulse(btnCrow);
            crowCount--;
            myProfile.crows = crowCount;
            saveProfile();
            updateSuperUI();
            shootCrow();
        });
    }'''

artillery_listen = '''
    if (btnArtillery) {
        btnArtillery.addEventListener('click', () => {
            if (gameOver || isMyTurn === false || artilleryCount <= 0) return;
            isArtilleryAiming = !isArtilleryAiming;
            
            if (isArtilleryAiming) {
                btnArtillery.classList.add('active');
                if (!myArtilleryCannon) {
                    const tex = loadTexture('artileriya.png');
                    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
                    myArtilleryCannon = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat);
                    scene.add(myArtilleryCannon);
                }
                const playerGrp = getMyGroup();
                if (playerGrp) {
                    myArtilleryCannon.position.set(playerGrp.position.x + 80, playerGrp.position.y - 40, playerGrp.position.z + 10);
                    myArtilleryCannon.visible = true;
                }
            } else {
                btnArtillery.classList.remove('active');
                if (myArtilleryCannon) myArtilleryCannon.visible = false;
            }
        });
    }
'''

content = content.replace(crow_listen_old, crow_listen_old + artillery_listen)


# 3. Fire logic modifications
fire_old = '''    if (gameMode === 'multi') {
        socket.emit('throwSpear', { angle, power });
    } else if (gameMode === 'single') {'''

fire_new = '''    let artill = false;
    if (isArtilleryAiming) {
        artill = true;
        isArtilleryAiming = false;
        if (btnArtillery) btnArtillery.classList.remove('active');
        if (myArtilleryCannon) myArtilleryCannon.visible = false;
        artilleryCount--;
        myProfile.artillery = artilleryCount;
        saveProfile();
        updateSuperUI();
    }
    
    if (gameMode === 'multi') {
        socket.emit('throwSpear', { angle, power, isArtillery: artill });
    } else if (gameMode === 'single') {'''

content = content.replace(fire_old, fire_new)


# Passing isArtillery around in sockets
socket_spear_old = '''socket.on('spearThrown', (data) => {
    const { playerIndex, angle, power } = data;
    setModelActionState(modelForPlayer(playerIndex), 'aim', 800);
    startSpearAnimation(playerIndex, angle, power);
});'''

socket_spear_new = '''socket.on('spearThrown', (data) => {
    const { playerIndex, angle, power, isArtillery } = data;
    setModelActionState(modelForPlayer(playerIndex), 'aim', 800);
    startSpearAnimation(playerIndex, angle, power, isArtillery);
});'''

content = content.replace(socket_spear_old, socket_spear_new)


# startSpearAnimation logic
start_spear_old = '''function startSpearAnimation(playerIndex, angle, power, overrideDouble = null) {
    playSfx('throw');
    const isP1 = (playerIndex === 0);
    const startX = isP1 ? -distanceBetweenPlayers / 2 : distanceBetweenPlayers / 2;
    const startY = -40;

    const velocityMult = 3.5;
    const vx = Math.cos(angle) * power * velocityMult;
    const vy = Math.sin(angle) * power * velocityMult;'''

start_spear_new = '''function startSpearAnimation(playerIndex, angle, power, overrideDouble = null) {
    playSfx('throw');
    const isP1 = (playerIndex === 0);
    let startX = isP1 ? -distanceBetweenPlayers / 2 : distanceBetweenPlayers / 2;
    let startY = -40;
    
    let isArtillery = false;
    if (typeof overrideDouble === 'boolean' && arguments.length === 4) {
        isArtillery = overrideDouble; // reuse param if true
        overrideDouble = null;
    }
    if (isArtillery) {
        startX += (isP1 ? 80 : -80);
        startY -= 40;
    }

    const velocityMult = 3.5;
    const vx = Math.cos(angle) * power * velocityMult;
    const vy = Math.sin(angle) * power * velocityMult;'''

content = content.replace(start_spear_old, start_spear_new)

# Creating the projectile mesh inside startSpearAnimation
spear_mesh_old = '''    const spearMat = new THREE.MeshBasicMaterial({ map: spearTex, transparent: true });
    const spearMesh = new THREE.Mesh(spearGeom, spearMat);
    spearGroup.add(spearMesh);'''

spear_mesh_new = '''    let spearMesh;
    if (isArtillery) {
        const geom = new THREE.SphereGeometry(15, 16, 16);
        const mat = new THREE.MeshBasicMaterial({ color: 0x222222 });
        spearMesh = new THREE.Mesh(geom, mat);
        spearGroup.add(spearMesh);
    } else {
        const spearMat = new THREE.MeshBasicMaterial({ map: spearTex, transparent: true });
        spearMesh = new THREE.Mesh(spearGeom, spearMat);
        spearGroup.add(spearMesh);
    }'''

content = content.replace(spear_mesh_old, spear_mesh_new)


# Push projectile
spear_push_old = '''    const newSpear = {
        x: startX,
        y: startY,
        vx,
        vy,
        group: spearGroup,
        playerIndex,
        isDouble: doDouble,
        trailNodes: [],
        entityHitEmitted: false
    };'''

spear_push_new = '''    const newSpear = {
        x: startX,
        y: startY,
        vx,
        vy,
        group: spearGroup,
        playerIndex,
        isDouble: doDouble,
        isArtillery: isArtillery,
        trailNodes: [],
        entityHitEmitted: false
    };'''

content = content.replace(spear_push_old, spear_push_new)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Done!')
