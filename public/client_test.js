const socket = io();

let crowModelTemplate = null;
const gltfLoader = new THREE.GLTFLoader();

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

gltfLoader.load('3d models/crow.glb', (gltf) => {
    crowModelTemplate = gltf.scene;
    crowModelTemplate.scale.set(40, 40, 40); // Initial scale
    crowModelTemplate.traverse(child => { if (child.isMesh) { child.castShadow = true; } });
}, undefined, (e) => console.error(e));


// UI Elements
const menuScreen = document.getElementById('menu-screen');
const btnSingle = document.getElementById('btn-single');
const btnMulti = document.getElementById('btn-multi');

const waitingScreen = document.getElementById('waiting-screen');
const btnCancelMulti = document.getElementById('btn-cancel-multi');

const gameScreen = document.getElementById('game-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const disconnectScreen = document.getElementById('disconnect-screen');
const winnerText = document.getElementById('winner-text');
const restartBtn = document.getElementById('restart-btn');
const menuBtn = document.getElementById('menu-btn');

const p1Info = document.getElementById('p1-info');
const p2Info = document.getElementById('p2-info');
const p1Name = document.getElementById('p1-name');
const p2Name = document.getElementById('p2-name');
const p1HealthBar = document.getElementById('p1-health');
const p2HealthBar = document.getElementById('p2-health');
const windText = document.getElementById('wind-text');
const windArrow = document.getElementById('wind-arrow');
const controlsPanel = document.getElementById('controls-panel');
const turnIndicator = document.getElementById('turn-indicator');
const damageContainer = document.getElementById('damage-container');
const hud = document.querySelector('.hud');

// Audio Setup
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx;
let bgMusicNode = null;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new AudioContext();
        startBackgroundMusic();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playThrowSound() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.4);
    gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.4);
}

function playHitSound(isFlesh, isCrit = false) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = isFlesh ? 'sawtooth' : 'square';
    osc.frequency.setValueAtTime(isFlesh ? (isCrit ? 150 : 250) : 100, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(20, audioCtx.currentTime + (isCrit ? 0.4 : 0.2));
    gain.gain.setValueAtTime(isCrit ? 1.5 : 1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + (isCrit ? 0.4 : 0.2));
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + (isCrit ? 0.4 : 0.2));
}

function playShieldBreak() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(100, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(10, audioCtx.currentTime + 0.5);
    gain.gain.setValueAtTime(2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
}

function playCrowSound() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.3);
    gain.gain.setValueAtTime(1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
}

function startBackgroundMusic() {
    if (!audioCtx) return;
    if (bgMusicNode) bgMusicNode.disconnect();
    bgMusicNode = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    bgMusicNode.type = 'triangle';
    bgMusicNode.frequency.value = 55; 
    gain.gain.value = 0.05; 
    bgMusicNode.connect(gain);
    gain.connect(audioCtx.destination);
    bgMusicNode.start();
}

// Three.js Setup (Cinematic)
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a0b2e);
scene.fog = new THREE.FogExp2(0x1a0b2e, 0.0008);

let frustumSize = 1200;
let aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.OrthographicCamera(frustumSize * aspect / -2, frustumSize * aspect / 2, frustumSize / 2, frustumSize / -2, 1, 3000);
camera.position.set(0, 0, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
container.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(200, 1000, 500);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 1500;
const d = 1000;
dirLight.shadow.camera.left = -d; dirLight.shadow.camera.right = d; dirLight.shadow.camera.top = d; dirLight.shadow.camera.bottom = -d;
scene.add(dirLight);

const rimLight = new THREE.DirectionalLight(0x4444ff, 1);
rimLight.position.set(-200, 100, -300);
scene.add(rimLight);

const groundGeo = new THREE.BoxGeometry(15000, 200, 1000);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9, metalness: 0.1 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.position.y = -400;
ground.receiveShadow = true;
scene.add(ground);
const rocks = [];
for(let i=0; i<60; i++) {
    const rockGeo = new THREE.DodecahedronGeometry(Math.random() * 30 + 10);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 1 });
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.set((Math.random() - 0.5) * 14000, -300 + Math.random()*20, (Math.random() - 0.5) * 800 - 100);
    rock.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
    rock.castShadow = true; rock.receiveShadow = true;
    scene.add(rock); rocks.push(rock);
}

const dustGeo = new THREE.BufferGeometry();
const dustCount = 500;
const dustPos = new Float32Array(dustCount * 3);
for(let i=0; i<dustCount*3; i++) {
    dustPos[i] = (Math.random() - 0.5) * 4000;
    if(i%3 === 1) dustPos[i] = Math.random() * 800 - 300; 
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustMat = new THREE.PointsMaterial({ color: 0xffddaa, size: 4, transparent: true, opacity: 0.4 });
const dustSystem = new THREE.Points(dustGeo, dustMat);
scene.add(dustSystem);

let entities = [];
let clouds = [];
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
}

function buildMap(mapType) {
    let groundColor = 0x4ade80; // Bright green
    let rockColor = 0x9ca3af;
    let skyColor = 0x87ceeb; // Sky blue
    
    if (mapType === 'winter') { 
        groundColor = 0xffffff; rockColor = 0x94a3b8; skyColor = 0xadd8e6; 
    } else if (mapType === 'desert') { 
        groundColor = 0xfcd34d; rockColor = 0xd97706; skyColor = 0x00bfff; 
    } else if (mapType === 'castle') { 
        groundColor = 0x64748b; rockColor = 0x475569; skyColor = 0x4682b4; 
    }
    
    ground.material.color.setHex(groundColor);
    rocks.forEach(r => r.material.color.setHex(rockColor));
    scene.background.setHex(skyColor);
    scene.fog.color.setHex(skyColor);
}

function spawnEntities(options) {
    entities.forEach(e => scene.remove(e.mesh));
    entities = [];
    
    clouds.forEach(c => scene.remove(c));
    clouds = [];
    
    // Spawn Clouds
    for(let i=0; i<8; i++) {
        const cloudGeo = new THREE.SphereGeometry(Math.random() * 20 + 20, 7, 7);
        const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
        const cloud = new THREE.Mesh(cloudGeo, cloudMat);
        cloud.position.set(
            (Math.random() - 0.5) * 4000, 
            300 + Math.random() * 300, 
            -100 - Math.random() * 200
        );
        cloud.scale.set(1.5, 0.6, 1);
        cloud.userData = { vx: (Math.random() - 0.5) * 20 };
        scene.add(cloud);
        clouds.push(cloud);
    }

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
            const px = i % 2 === 0 ? pos1X + (seededRandom()*600 - 300) : pos2X + (seededRandom()*600 - 300);
            civ.position.set(px, ground.position.y + 100, 0);
            scene.add(civ);
            // Add vx for walking around
            entities.push({ type: 'civilian', mesh: civ, alive: true, vx: (seededRandom() > 0.5 ? 20 : -20) + seededRandom() * 10, originX: px });
        }
    }
}

const bloodParticles = [];
const bloodGeo = new THREE.SphereGeometry(4, 4, 4);
const bloodMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
const woodMat = new THREE.MeshBasicMaterial({ color: 0x8b4513 });

function spawnParticles(x, y, amount, isWood=false) {
    const geo = isWood ? new THREE.BoxGeometry(8, 8, 8) : bloodGeo;
    const mat = isWood ? woodMat : bloodMat;
    for (let i = 0; i < amount; i++) {
        const drop = new THREE.Mesh(geo, mat);
        drop.position.set(x, y, 20);
        drop.userData = {
            vx: (Math.random() - 0.5) * 600,
            vy: Math.random() * 500 + 200,
            vz: (Math.random() - 0.5) * 400,
            life: 1.5 + Math.random(),
            isWood: isWood
        };
        scene.add(drop);
        bloodParticles.push(drop);
    }
}

function createCrow(x, y) {
    const crowGroup = new THREE.Group();
    if (crowModelTemplate) {
        const model = crowModelTemplate.clone();
        model.rotation.y = Math.PI / 2; // Assuming the model faces Z or X, let's adjust
        crowGroup.add(model);
    } else {
        const body = new THREE.Mesh(new THREE.BoxGeometry(15, 10, 10), new THREE.MeshBasicMaterial({color: 0x111111}));
        crowGroup.add(body);
        const wingMat = new THREE.MeshBasicMaterial({color: 0x222222});
        const wingL = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 25), wingMat);
        wingL.position.set(0, 0, 12);
        crowGroup.add(wingL);
        const wingR = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 25), wingMat);
        wingR.position.set(0, 0, -12);
        crowGroup.add(wingR);
    }
    crowGroup.position.set(x, y, 0);
    return crowGroup;
}

// Characters
const pWidth = 60;
const pHeight = 160;

function createSoldier(isP1, charType = 0) {
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
}

const pos1X = -900;
const pos2X = 900;

let p1Model = createSoldier(true, 0);
p1Model.position.x = pos1X;

let p2Model = createSoldier(false, 0);
p2Model.position.x = pos2X;

// Spear object
let spear = null;
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


let baseZoom = 1;

function updateCameraBounds() {
    aspect = window.innerWidth / window.innerHeight;
    camera.left = -frustumSize * aspect / 2;
    camera.right = frustumSize * aspect / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    
    // Ensure world width of 2400 is always visible
    const minWorldWidth = 2400;
    const zoomX = (frustumSize * aspect) / minWorldWidth;
    baseZoom = Math.min(zoomX, 1);
    
    if(cameraState === 'static') {
        cameraZoomTarget = baseZoom;
        camera.zoom = baseZoom;
        camera.position.x = 0;
        camera.updateProjectionMatrix();
    }
}

window.addEventListener('resize', updateCameraBounds);

// Game State
let gameMode = 'menu';
let myPlayerIndex = -1; 
let currentTurnIndex = 0;
let currentWind = 0;
let isAnimating = false;
let myHealth = 100;
let enemyHealth = 100;
let myShield = 3;
let enemyShield = 3;

const GRAVITY = 700;
let lastTime = performance.now();

// Cinematic Camera
let cameraState = 'static'; 
let cameraTargetX = 0;
let cameraTargetY = 0;
let cameraZoomTarget = 1;
let screenShake = 0;

updateCameraBounds();

let isDragging = false;
let dragStart = { x: 0, y: 0 };
let dragCurrent = { x: 0, y: 0 };

function flashHit(model) {
    model.userData.mats.forEach(mat => {
        const orig = mat.color.clone();
        mat.color = new THREE.Color(0xff0000);
        setTimeout(() => { mat.color = orig; }, 150);
    });
    const tilt = model.position.x > 0 ? 0.3 : -0.3;
    model.userData.torso.rotation.z = tilt;
    model.userData.headGroup.rotation.z = tilt;
    setTimeout(() => { 
        model.userData.torso.rotation.z = 0; 
        model.userData.headGroup.rotation.z = 0; 
    }, 200);
}

function updateHealthUI() {
    const h1 = myPlayerIndex === 0 ? myHealth : enemyHealth;
    const h2 = myPlayerIndex === 1 ? myHealth : enemyHealth;
    p1HealthBar.style.width = h1 + '%';
    p2HealthBar.style.width = h2 + '%';
    
    if (h1 < 30) p1HealthBar.style.background = '#ef4444';
    else if (h1 < 60) p1HealthBar.style.background = '#f59e0b';
    else p1HealthBar.style.background = '#10b981';
    
    if (h2 < 30) p2HealthBar.style.background = '#ef4444';
    else if (h2 < 60) p2HealthBar.style.background = '#f59e0b';
    else p2HealthBar.style.background = '#10b981';
}

function showDamageText(worldX, worldY, damageText, isCrit = false, isShield = false) {
    const vector = new THREE.Vector3(worldX, worldY, 0);
    vector.project(camera);
    
    const x = (vector.x * .5 + .5) * window.innerWidth;
    const y = (-(vector.y * .5) + .5) * window.innerHeight;

    const el = document.createElement('div');
    el.className = 'damage-text';
    el.innerText = damageText;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    if(isCrit) {
        el.style.fontSize = '3.5rem';
        el.style.color = '#fbbf24';
        screenShake = 30; 
    } else if(isShield) {
        el.style.color = '#38bdf8';
        screenShake = 15;
    } else {
        screenShake = 10; 
    }
    damageContainer.appendChild(el);
    setTimeout(() => el.remove(), 1500);
}

function stickSpear(targetModel, hitX, hitY, angle) {
    const stuckSpear = spearGroup.clone();
    stuckSpear.visible = true;
    stuckSpear.rotation.z = angle;
    
    if (targetModel) {
        stuckSpear.position.set(hitX, hitY, 0);
        scene.add(stuckSpear);
        targetModel.attach(stuckSpear);
    } else {
        stuckSpear.position.set(hitX, hitY, 0);
        scene.add(stuckSpear);
    }
}

function breakShield(model) {
    model.userData.shieldGroup.visible = false;
    spawnParticles(model.position.x, model.position.y + 30, 30, true);
    playShieldBreak();
}

// Input Handlers
function handleStart(e) {
    if (isAnimating || currentTurnIndex !== myPlayerIndex || gameMode === 'menu' || isPaused) return;
    isDragging = true;
    dragStart = getPointerPos(e);
    dragCurrent = { ...dragStart };
}

function handleMove(e) {
    if (!isDragging) return;
    dragCurrent = getPointerPos(e);
}

function handleEnd(e) {
    if (!isDragging) return;
    isDragging = false;
    
    const dx = dragStart.x - dragCurrent.x;
    const dy = dragCurrent.y - dragStart.y; 
    
    let distance = Math.sqrt(dx*dx + dy*dy);
    if (distance < 10) return; 
    
    let power = Math.min(distance * 4, 2000); 
    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
    
    if (myPlayerIndex === 1) angle = 180 - angle;
    if (angle < -20) angle = -20;
    if (angle > 110) angle = 110;

    throwSpear(angle, power);
}

document.addEventListener('mousedown', handleStart);
document.addEventListener('mousemove', handleMove);
document.addEventListener('mouseup', handleEnd);
document.addEventListener('touchstart', (e) => { 
    if(!e.target.closest('button') && !e.target.closest('#chat-container') && !e.target.closest('#in-game-modal')) { 
        handleStart(e.touches[0]); 
    } 
}, {passive: false});
document.addEventListener('touchmove', (e) => { 
    if(!e.target.closest('button') && !e.target.closest('#chat-container') && !e.target.closest('#in-game-modal')) { 
        handleMove(e.touches[0]); 
    } 
}, {passive: false});
document.addEventListener('touchend', (e) => { 
    if(!e.target.closest('button') && !e.target.closest('#chat-container') && !e.target.closest('#in-game-modal')) { 
        handleEnd(); 
    } 
}, {passive: false});

function getPointerPos(e) {
    return { x: e.clientX, y: e.clientY };
}

// Game Logic
function startSinglePlayer(opts) {
    waitingScreen.classList.add('hidden');
    menuScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    chatContainer.classList.add('hidden');
    btnToggleChat.classList.add('hidden');
    
    myCivilianKills = 0;
    buildMap(opts.map);
    clouds = [];
    spawnEntities(opts);
    
    scene.remove(p1Model);
    scene.remove(p2Model);
    p1Model = createSoldier(true, myProfile.charType || 0); p1Model.position.x = pos1X;
    p2Model = createSoldier(false, Math.floor(Math.random()*5)); p2Model.position.x = pos2X;
    
    myPlayerIndex = 0;

    p1Name.innerText = myProfile.name;
    document.getElementById('p1-flag').innerText = myProfile.flag;
    p2Name.innerText = translations[myProfile.lang].singleBtn.includes("Kompyuter") ? "Kompyuter" : "PC";
    document.getElementById('p2-flag').innerText = "🤖";
    updateTurn(0, generateWind());
    if(!isLooping) {
        isLooping = true;
        lastTime = performance.now();
        requestAnimationFrame(gameLoop);
    }
}

function generateWind() {
    return parseFloat((Math.random() * 30 - 15).toFixed(2));
}

function playAITurn() {
    if (gameMode !== 'single' || currentTurnIndex !== 1 || isAnimating) return;
    
    setTimeout(() => {
        let angle = 35 + Math.random() * 20; 
        let power = 1000 + Math.random() * 500; 
        throwSpear(angle, power);
    }, 1500);
}

function throwSpear(angle, power) {
    if (gameMode === 'multi') {
        socket.emit('throwSpear', { angle, power });
    } else if (gameMode === 'single') {
        startSpearAnimation(currentTurnIndex, angle, power);
    }
}

function processHit(hitOpponent, targetIndex, hitX, hitY, isSuicide = false) {
    const finalAngle = spearGroup.rotation.z;
    
    if (hitOpponent) {
        const targetModel = targetIndex === 0 ? p1Model : p2Model;
        flashHit(targetModel);
        stickSpear(targetModel, hitX, hitY, finalAngle);
        
        let damage = 25;
        let msg = "-25";
        let isCrit = false;
        let isShieldHit = false;
        
        if (isSuicide) {
            damage = 50;
            msg = "SUIQASD! -50";
            isCrit = true;
            spawnParticles(hitX, hitY, 50);
        } else {
            const relativeY = hitY - targetModel.position.y;
            
            if (relativeY > 65) {
                damage = 40; 
                msg = "BOSHGA! -40";
                isCrit = true;
                spawnParticles(hitX, hitY, 40); 
            } else if (relativeY < -10) {
                damage = 15; 
                msg = "OYOQQA! -15";
                spawnParticles(hitX, hitY, 15);
            } else {
                const currentShield = targetIndex === 0 ? myShield : enemyShield;
                if (currentShield > 0) {
                    isShieldHit = true;
                    damage = 0;
                    msg = "QALQON!";
                    spawnParticles(hitX, hitY, 10, true); 
                } else {
                    spawnParticles(hitX, hitY, 25);
                }
            }
        }

        playHitSound(true, isCrit);
        showDamageText(hitX, hitY + 80, msg, isCrit, isShieldHit);

        if (!isShieldHit) {
            const originalY = targetModel.position.y;
            targetModel.rotation.z = Math.PI / 2;
            targetModel.position.y -= 35; 
            setTimeout(() => {
                targetModel.rotation.z = 0;
                targetModel.position.y = originalY;
            }, 1500);
        }

        if (gameMode === 'single') {
            if (isShieldHit) {
                if (targetIndex === 0) myShield--; else enemyShield--;
                const shieldHealth = targetIndex === 0 ? myShield : enemyShield;
                if (shieldHealth <= 0) breakShield(targetModel);
            } else {
                if (targetIndex === 0) myHealth -= damage; else enemyHealth -= damage;
                updateHealthUI();
            }
            
            if (myHealth <= 0 || enemyHealth <= 0) {
                setTimeout(() => showGameOver(myHealth > 0 ? 0 : 1), 1500);
            } else {
                setTimeout(() => {
                    updateTurn(currentTurnIndex === 0 ? 1 : 0, generateWind());
                    if (currentTurnIndex === 1) playAITurn();
                }, 2000);
            }
        } else {
            socket.emit('throwComplete', { hitOpponent: true, targetIndex: targetIndex, damage, hitX, hitY, isShieldHit, hitAngle: finalAngle });
        }
    } else {
        playHitSound(false); 
        spawnParticles(hitX, hitY, 10); 
        stickSpear(null, hitX, hitY, finalAngle);
        
        if (gameMode === 'single') {
            setTimeout(() => {
                updateTurn(currentTurnIndex === 0 ? 1 : 0, generateWind());
                if (currentTurnIndex === 1) playAITurn();
            }, 1500);
        } else {
            socket.emit('throwComplete', { hitOpponent: false, hitX, hitY, hitAngle: finalAngle });
        }
    }
}

// Menu and Chat Logic
const inGameMenuBtn = document.getElementById('in-game-menu-btn');
const btnToggleChat = document.getElementById('btn-toggle-chat');
const inGameModal = document.getElementById('in-game-modal');
const btnResume = document.getElementById('btn-resume');
const btnToggleSound = document.getElementById('btn-toggle-sound');
const btnExitMenu = document.getElementById('btn-exit-menu');
const chatContainer = document.getElementById('chat-container');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

inGameMenuBtn.addEventListener('click', () => { inGameModal.classList.remove('hidden'); });
let unreadMessages = 0;
const chatBadge = document.getElementById('chat-badge');
btnToggleChat.addEventListener('click', () => {
    chatContainer.classList.toggle('hidden');
    if (!chatContainer.classList.contains('hidden')) {
        unreadMessages = 0;
        chatBadge.classList.add('hidden');
    }
});
btnResume.addEventListener('click', () => { inGameModal.classList.add('hidden'); });

let soundMuted = false;
btnToggleSound.addEventListener('click', () => {
    soundMuted = !soundMuted;
    if (audioCtx) {
        if (soundMuted) audioCtx.suspend();
        else audioCtx.resume();
    }
    btnToggleSound.innerText = soundMuted ? "Ovozni Yoqish" : "Ovozni O'chirish";
});
btnExitMenu.addEventListener('click', () => { location.reload(); });

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (msg && gameMode === 'multi') {
        socket.emit('chatMessage', msg);
        addChatMessage(msg, true);
        chatInput.value = '';
    }
});

function addChatMessage(msg, isMine) {
    const el = document.createElement('div');
    el.className = 'chat-msg ' + (isMine ? 'mine' : 'theirs');
    el.innerText = msg;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function playMessageSound() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(600, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.5, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + 0.2);
}

socket.on('chatMessage', (data) => {
    if (data.senderId !== socket.id) {
        addChatMessage(data.msg, false);
        playMessageSound();
        if (chatContainer.classList.contains('hidden')) {
            unreadMessages++;
            chatBadge.innerText = '+' + unreadMessages;
            chatBadge.classList.remove('hidden');
        }
    }
});

socket.on('gameStart', (data) => {
    gameMode = 'multi';
    waitingScreen.classList.add('hidden');
    multiMenu.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    chatMessages.innerHTML = '';
    unreadMessages = 0; chatBadge.classList.add('hidden');
    btnToggleChat.classList.remove('hidden');
    
    const opts = data.options || { map: 'field', birds: false, animals: false, civilians: false };
    buildMap(opts.map);
    spawnEntities(opts);
    myCivilianKills = 0;
    
    myPlayerIndex = data.playerIndex;
    
    scene.remove(p1Model); scene.remove(p2Model);
    const p1Char = myPlayerIndex === 0 ? myProfile.charType : (data.opponentProfile ? data.opponentProfile.charType : 0);
    const p2Char = myPlayerIndex === 1 ? myProfile.charType : (data.opponentProfile ? data.opponentProfile.charType : 0);
    p1Model = createSoldier(true, p1Char); p1Model.position.x = pos1X;
    p2Model = createSoldier(false, p2Char); p2Model.position.x = pos2X;
    
    if (myPlayerIndex === 0) {
        p1Name.innerText = myProfile.name;
        document.getElementById('p1-flag').innerText = myProfile.flag;
        p2Name.innerText = data.opponentProfile ? data.opponentProfile.name : "Raqib";
        document.getElementById('p2-flag').innerText = data.opponentProfile ? data.opponentProfile.flag : "🏳️";
    } else {
        p2Name.innerText = myProfile.name;
        document.getElementById('p2-flag').innerText = myProfile.flag;
        p1Name.innerText = data.opponentProfile ? data.opponentProfile.name : "Raqib";
        document.getElementById('p1-flag').innerText = data.opponentProfile ? data.opponentProfile.flag : "🏳️";
    }
    
    myHealth = data.health[myPlayerIndex];
    enemyHealth = data.health[myPlayerIndex === 0 ? 1 : 0];
    myShield = data.shield[myPlayerIndex];
    enemyShield = data.shield[myPlayerIndex === 0 ? 1 : 0];
    updateHealthUI();
    updateTurn(data.turnIndex, data.wind);
    
    if(!isLooping) {
        isLooping = true;
        lastTime = performance.now();
        requestAnimationFrame(gameLoop);
    }
});

socket.on('nextTurn', (data) => {
    updateTurn(data.turnIndex, data.wind);
    if (!isAnimating) spearGroup.visible = false;
});

socket.on('spearThrown', (data) => {
    const { playerIndex, angle, power } = data;
    startSpearAnimation(playerIndex, angle, power);
});

socket.on('groundHit', (data) => {
    if (spear && spear.playerIndex !== myPlayerIndex) {
        stickSpear(null, data.hitX, data.hitY, data.hitAngle);
    }
});

socket.on('hitRegistered', (data) => {
    const { targetIndex, damage, newHealth, newShield, hitX, hitY, isShieldHit, hitAngle } = data;
    const targetModel = targetIndex === 0 ? p1Model : p2Model;
    
    if (spear && spear.playerIndex !== myPlayerIndex) {
        flashHit(targetModel);
        stickSpear(targetModel, hitX, hitY, hitAngle);
        
        if (isShieldHit) {
            spawnParticles(hitX, hitY, 10, true);
            showDamageText(hitX, hitY + 80, "QALQON!", false, true);
            if (newShield <= 0) breakShield(targetModel);
        } else {
            let isCrit = damage >= 40;
            spawnParticles(hitX, hitY, isCrit ? 40 : 20);
            playHitSound(true, isCrit);
            let msg = "-" + damage;
            if (isCrit) msg = "BOSHGA! " + msg;
            showDamageText(hitX, hitY + 80, msg, isCrit);

            const originalY = targetModel.position.y;
            targetModel.rotation.z = Math.PI / 2;
            targetModel.position.y -= 35;
            setTimeout(() => {
                targetModel.rotation.z = 0;
                targetModel.position.y = originalY;
            }, 1500);
        }
    }
    
    if (targetIndex === myPlayerIndex) {
        myHealth = newHealth; myShield = newShield;
    } else {
        enemyHealth = newHealth; enemyShield = newShield;
    }
    updateHealthUI();
});

socket.on('crowSpawned', (data) => {
    spawnCrowAtSpear(data.x, data.y);
});

socket.on('entityHit', (data) => {
    if (spear && spear.playerIndex !== myPlayerIndex) {
        spear.active = false;
        isAnimating = false;
        spearGroup.visible = false;
        
        const { entityIndex, hitX, hitY, hitAngle } = data;
        const e = entities[entityIndex];
        if (e) {
            e.alive = false;
            e.mesh.rotation.z = Math.PI / 2;
            stickSpear(e.mesh, hitX, hitY, hitAngle);
            spawnParticles(hitX, hitY, 20);
            showDamageText(hitX, hitY + 50, e.type === 'bird' ? "QUSH!" : "HAYVON!", true);
        }
    }
});

socket.on('gameOver', (data) => {
    setTimeout(() => showGameOver(data.winnerIndex), 1500);
});

socket.on('opponentDisconnected', () => {
    if(gameMode === 'multi') {
        disconnectScreen.classList.remove('hidden');
        gameScreen.classList.add('hidden');
    }
});

function showGameOver(winnerIndex) {
    gameOverScreen.classList.remove('hidden');
    controlsPanel.classList.add('disabled');
    const winner = winnerIndex === myPlayerIndex ? translations[myProfile.lang].win : translations[myProfile.lang].lose;
    winnerText.innerText = winner;
    
    if (winnerIndex === myPlayerIndex) {
        myStats.wins++;
        myStats.score += 100;
    }
    myStats.games++;
    saveStats();
    
    cameraState = 'target';
    cameraTargetX = winnerIndex === 0 ? p1Model.position.x : p2Model.position.x;
    cameraTargetY = -200;
    cameraZoomTarget = baseZoom * 1.5;
}

function updateTurn(turnIndex, wind) {
    currentTurnIndex = turnIndex;
    currentWind = wind;

    p1Info.classList.toggle('active', turnIndex === 0);
    p2Info.classList.toggle('active', turnIndex === 1);
    p1Info.querySelector('.status').innerText = turnIndex === 0 ? "O'z navbatida" : "Kutmoqda";
    p2Info.querySelector('.status').innerText = turnIndex === 1 ? "O'z navbatida" : "Kutmoqda";

    windText.innerText = Math.abs(wind).toFixed(1);
    if (wind > 0) windArrow.style.transform = 'rotate(0deg)';
    else if (wind < 0) windArrow.style.transform = 'rotate(180deg)';
    else windArrow.style.transform = 'rotate(0deg)';

    if (turnIndex === myPlayerIndex) {
        controlsPanel.classList.remove('disabled');
        turnIndicator.innerText = "Sizning navbatingiz! (Tortib mo'ljalga oling)";
        turnIndicator.style.color = "#10b981";
        
        cameraState = 'target';
        cameraTargetX = myPlayerIndex === 0 ? p1Model.position.x + 200 : p2Model.position.x - 200;
        cameraTargetY = 0;
        cameraZoomTarget = baseZoom;
        hud.style.opacity = 1;
    } else {
        controlsPanel.classList.add('disabled');
        turnIndicator.innerText = "Raqib navbati";
        turnIndicator.style.color = "#ef4444";
        
        cameraState = 'target';
        cameraTargetX = myPlayerIndex === 0 ? p2Model.position.x - 200 : p1Model.position.x + 200;
        cameraTargetY = 0;
        cameraZoomTarget = baseZoom;
    }
}

function startSpearAnimation(playerIndex, angle, power) {
    if (arrowModel && spearGroup.children.length === 0 || (spearGroup.children.length > 0 && !spearGroup.children[0].isGroup)) {
        // clear old boxy spear and add new one
        while(spearGroup.children.length > 0){ 
            spearGroup.remove(spearGroup.children[0]); 
        }
        spearGroup.add(arrowModel.clone());
    }

    isAnimating = true;
    controlsPanel.classList.add('disabled');
    hud.style.opacity = 0.3; 
    playThrowSound();

    const thrower = playerIndex === 0 ? p1Model : p2Model;
    thrower.userData.armR.rotation.z = Math.PI;

    const startX = playerIndex === 0 ? p1Model.position.x + 40 : p2Model.position.x - 40;
    const startY = thrower.position.y + 65; 

    const rad = angle * (Math.PI / 180);

    let vx = power * Math.cos(rad);
    if (playerIndex === 1) vx = -vx;

    spear = {
        x: startX,
        y: startY,
        vx: vx,
        vy: power * Math.sin(rad),
        active: true,
        playerIndex: playerIndex,
        hitCrow: false
    };
    
    spearGroup.position.set(startX, startY, 0);
    spearGroup.visible = true;
    
    if (gameMode === 'multi') {
        currentTurnIndex = -1;
    }
    
    cameraState = 'follow';
    cameraZoomTarget = baseZoom * 1.2;
}

function spawnCrowAtSpear(x, y) {
    const crow = createCrow(x, y);
    scene.add(crow);
    spearGroup.add(crow);
    crow.position.set(60, 0, 0);
    playCrowSound();
    showDamageText(x, y + 50, "QARG'A!", true);
}

function checkCollision() {
    if (!spear || !spear.active) return;

    if (spear.y > 1000 && spear.vy > 0 && !spear.hitCrow) {
        spear.hitCrow = true;
        spear.vy = -100; 
        spear.vx *= 0.5;
        spawnCrowAtSpear(spear.x, spear.y);
        if (gameMode === 'multi') socket.emit('crowHit', { x: spear.x, y: spear.y });
    }

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

    if (spear.y <= ground.position.y + 100) {
        spear.active = false;
        spear.y = ground.position.y + 100;
        finishAnimation(false, -1, spear.x, spear.y);
        return;
    }

    const models = [p1Model, p2Model];
    for (let i = 0; i < 2; i++) {
        const m = models[i];
        if (Math.abs(spear.x - m.position.x) < 45 &&
            spear.y > m.position.y - 60 && 
            spear.y < m.position.y + 130) {
            
            if (i === spear.playerIndex && spear.vy > 0) continue;
            
            spear.active = false;
            const isSuicide = (i === spear.playerIndex);
            finishAnimation(true, i, spear.x, spear.y, null, isSuicide);
            return;
        }
    }
    
    if (spear.x < -4000 || spear.x > 4000) {
        spear.active = false;
        finishAnimation(false, -1, spear.x, spear.y);
    }
}

function finishAnimation(hitOpponent, targetIndex, hitX, hitY, hitEntity = null, isSuicide = false) {
    isAnimating = false;
    
    p1Model.userData.armR.rotation.z = Math.PI / 4;
    p2Model.userData.armR.rotation.z = Math.PI / 4;

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
                socket.emit('entityHit', { entityIndex: entities.indexOf(hitEntity), hitX, hitY, hitAngle: spearGroup.rotation.z });
            } else {
                setTimeout(() => {
                    updateTurn(currentTurnIndex === 0 ? 1 : 0, generateWind());
                    if (currentTurnIndex === 1) playAITurn();
                }, 1500);
            }
        }
        return;
    }

    if (spear.playerIndex === myPlayerIndex || gameMode === 'single') {
        processHit(hitOpponent, targetIndex, hitX, hitY, isSuicide);
    }
}

let isLooping = false;
let isPaused = false;

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
container.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(200, 1000, 500);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 1500;
const d = 1000;
dirLight.shadow.camera.left = -d;
dirLight.shadow.camera.right = d;
dirLight.shadow.camera.top = d;
dirLight.shadow.camera.bottom = -d;
scene.add(dirLight);

const rimLight = new THREE.DirectionalLight(0x4444ff, 1);
rimLight.position.set(-200, 100, -300);
scene.add(rimLight);

const groundGeo = new THREE.BoxGeometry(15000, 200, 1000);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9, metalness: 0.1 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.position.y = -400;
ground.receiveShadow = true;
scene.add(ground);
const rocks = [];

for(let i=0; i<60; i++) {
    const rockGeo = new THREE.DodecahedronGeometry(Math.random() * 30 + 10);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 1 });
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.set((Math.random() - 0.5) * 14000, -300 + Math.random()*20, (Math.random() - 0.5) * 800 - 100);
    rock.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
    rocks.push(rock);
}

const dustGeo = new THREE.BufferGeometry();
const dustCount = 500;
const dustPos = new Float32Array(dustCount * 3);
for(let i=0; i<dustCount*3; i++) {
    dustPos[i] = (Math.random() - 0.5) * 4000;
    if(i%3 === 1) dustPos[i] = Math.random() * 800 - 300; 
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustMat = new THREE.PointsMaterial({ color: 0xffddaa, size: 4, transparent: true, opacity: 0.4 });
const dustSystem = new THREE.Points(dustGeo, dustMat);
scene.add(dustSystem);


let entities = [];

function gameLoop(now) {
    if (isPaused) {
        lastTime = now;
        renderer.render(scene, camera);
        if(isLooping) requestAnimationFrame(gameLoop);
        return;
    }
    let timeScale = 1.0;
    if (!isAnimating && screenShake > 0) timeScale = 0.3; 
    
    const dt = ((now - lastTime) / 1000) * timeScale;
    lastTime = now;

    // Breathing Animation
    const breath = Math.sin(now * 0.004) * 0.05 + 1;
    p1Model.userData.torso.scale.y = breath;
    p2Model.userData.torso.scale.y = breath;
    p1Model.userData.headGroup.position.y = 95 + Math.sin(now * 0.004) * 2;
    p2Model.userData.headGroup.position.y = 95 + Math.sin(now * 0.004) * 2;
    
    p1Model.userData.armL.rotation.z = Math.sin(now * 0.002) * 0.1;
    p2Model.userData.armL.rotation.z = -Math.sin(now * 0.002) * 0.1;

    // Dust animation
    const positions = dustSystem.geometry.attributes.position.array;
    for(let i=0; i<dustCount*3; i+=3) {
        positions[i] += currentWind * 10 * dt; 
        if (positions[i] > 2000) positions[i] = -2000;
        if (positions[i] < -2000) positions[i] = 2000;
    }
    dustSystem.geometry.attributes.position.needsUpdate = true;

    
    entities.forEach((e, idx) => {
        e.index = idx;
        if (e.type === 'bird' && e.alive) {
            e.mesh.position.x += e.vx * dt;
            if (e.mesh.position.x > 800) e.vx = -Math.abs(e.vx);
            if (e.mesh.position.x < -800) e.vx = Math.abs(e.vx);
            e.mesh.rotation.y = e.vx > 0 ? 0 : Math.PI;
        } else if (e.type === 'civilian' && e.alive) {
            e.mesh.position.x += e.vx * dt;
            if (Math.abs(e.mesh.position.x - e.originX) > 200) {
                e.vx = -e.vx;
            }
        }
        if (!e.alive && e.mesh.position.y > ground.position.y + 100) {
            e.mesh.position.y -= GRAVITY * dt * 0.5;
            e.mesh.rotation.z += 5 * dt;
        }
    });

    // Cloud animation
    clouds.forEach(cloud => {
        cloud.position.x += cloud.userData.vx * dt;
        if (cloud.position.x > 2000) cloud.position.x = -2000;
        if (cloud.position.x < -2000) cloud.position.x = 2000;
    });

    // Blood particles
    for (let i = bloodParticles.length - 1; i >= 0; i--) {
        const p = bloodParticles[i];
        p.position.x += p.userData.vx * dt;
        p.position.y += p.userData.vy * dt;
        p.position.z += p.userData.vz * dt;
        p.userData.vy -= GRAVITY * 1.5 * dt;
        p.userData.life -= dt;
        
        if (p.position.y < ground.position.y + 100) {
            p.position.y = ground.position.y + 100;
            p.userData.vy = 0;
            p.userData.vx = 0;
            p.userData.vz = 0;
            if(!p.userData.isWood) p.scale.set(1.5, 0.2, 1.5);
        }
        
        if (p.userData.life <= 0) {
            scene.remove(p);
            bloodParticles.splice(i, 1);
        }
    }

    if (isAnimating && spear && spear.active) {
        spear.x += spear.vx * dt;
        spear.y += spear.vy * dt;
        spear.vy -= GRAVITY * dt; 
        spear.vx += (currentWind * 30) * dt; 

        spearGroup.position.set(spear.x, spear.y, 0);
        const angle = Math.atan2(spear.vy, spear.vx);
        spearGroup.rotation.z = angle;
        
        if (cameraState === 'follow') {
            cameraTargetX = spear.x;
            cameraTargetY = spear.y;
        }

        checkCollision();
    }

    // Camera Interpolation & Shake
    if (cameraState !== 'static') {
        camera.position.x += (cameraTargetX - camera.position.x) * 5 * dt;
        camera.position.y += (cameraTargetY - camera.position.y) * 5 * dt;
        camera.zoom += (cameraZoomTarget - camera.zoom) * 3 * dt;
        camera.updateProjectionMatrix();
    }
    
    if (screenShake > 0) {
        camera.position.x += (Math.random() - 0.5) * screenShake;
        camera.position.y += (Math.random() - 0.5) * screenShake;
        screenShake *= 0.9;
        if (screenShake < 0.5) screenShake = 0;
    }

    // Trajectory Line
    if (trajectoryLine) {
        scene.remove(trajectoryLine);
        trajectoryLine.geometry.dispose();
        trajectoryLine.material.dispose();
        trajectoryLine = null;
    }

    if (isDragging && currentTurnIndex === myPlayerIndex) {
        const dx = dragStart.x - dragCurrent.x;
        const dy = dragCurrent.y - dragStart.y;
        
        if (Math.sqrt(dx*dx + dy*dy) > 10) {
            const startX = myPlayerIndex === 0 ? p1Model.position.x + 40 : p2Model.position.x - 40;
            const startY = p1Model.position.y + 65;
            
            const points = [];
            let simX = startX;
            let simY = startY;
            const distance = Math.sqrt(dx*dx + dy*dy);
            const power = Math.min(distance * 4, 2000);
            let angle = Math.atan2(dy, dx) * (180 / Math.PI);
            
            if (myPlayerIndex === 1) angle = 180 - angle;
            if (angle < -20) angle = -20;
            if (angle > 110) angle = 110;
            
            const rad = angle * (Math.PI / 180);
            let simVx = power * Math.cos(rad);
            if (myPlayerIndex === 1) simVx = -simVx;
            let simVy = power * Math.sin(rad);
            
            for(let i=0; i<30; i++) {
                points.push(new THREE.Vector3(simX, simY, 0));
                simX += simVx * 0.05;
                simY += simVy * 0.05;
                simVy -= GRAVITY * 0.05;
                simVx += (currentWind * 30) * 0.05;
                if(simY < ground.position.y + 100) break;
            }
            
            const geo = new THREE.BufferGeometry().setFromPoints(points);
            const mat = new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: 30, gapSize: 15, linewidth: 3 });
            trajectoryLine = new THREE.Line(geo, mat);
            trajectoryLine.computeLineDistances();
            scene.add(trajectoryLine);
        }
    }

    renderer.render(scene, camera);
    if(isLooping) requestAnimationFrame(gameLoop);
}

renderer.render(scene, camera);

// --- NEW PROFILE, STATS & LANGUAGE LOGIC ---
let myProfile = JSON.parse(localStorage.getItem('nayza_profile')) || {
    lang: 'uz',
    name: 'Jangchi',
    avatar: '👤',
    flag: '🇺🇿',
    charType: 0
};

let myStats = JSON.parse(localStorage.getItem('nayza_stats')) || {
    score: 0,
    games: 0,
    wins: 0
};

function saveProfile() {
    localStorage.setItem('nayza_profile', JSON.stringify(myProfile));
    applyLanguage();
}

function saveStats() {
    localStorage.setItem('nayza_stats', JSON.stringify(myStats));
}

const translations = {
    uz: {
        title: "Nayza Jangi",
        subtitle: "Qadimgi 3D Askarlar",
        singleBtn: "Yakkalik o'yin (Kompyuterga qarshi)",
        multiBtn: "Onlayn (Haqiqiy raqibga qarshi)",
        settings: "Sozlamalar",
        rating: "Reyting",
        wind: "SHAMOL",
        waiting: "Kutilyapti...",
        yourTurn: "Sizning navbatingiz!",
        oppTurn: "Raqib navbati",
        win: "Siz Yutdingiz! 🏆",
        lose: "Yutqazdingiz! 💀",
        pause: "Pauza",
        resume: "Davom etish",
        sound: "Sozlamalar(ovoz)",
        mainMenu: "Asosiy Menyu",
        save: "Saqlash",
        close: "Yopish"
    },
    ru: {
        title: "Битва Копий",
        subtitle: "Древние 3D Воины",
        singleBtn: "Одиночная (Против ПК)",
        multiBtn: "Онлайн (Против игрока)",
        settings: "Настройки",
        rating: "Рейтинг",
        wind: "ВЕТЕР",
        waiting: "Ожидание...",
        yourTurn: "Ваш ход!",
        oppTurn: "Ход противника",
        win: "Вы победили! 🏆",
        lose: "Вы проиграли! 💀",
        pause: "Пауза",
        resume: "Продолжить",
        sound: "Звук",
        mainMenu: "Главное меню",
        save: "Сохранить",
        close: "Закрыть"
    },
    en: {
        title: "Spear Clash",
        subtitle: "Ancient 3D Warriors",
        singleBtn: "Singleplayer (vs PC)",
        multiBtn: "Online (vs Player)",
        settings: "Settings",
        rating: "Rating",
        wind: "WIND",
        waiting: "Waiting...",
        yourTurn: "Your turn!",
        oppTurn: "Opponent's turn",
        win: "You Win! 🏆",
        lose: "You Lose! 💀",
        pause: "Pause",
        resume: "Resume",
        sound: "Sound",
        mainMenu: "Main Menu",
        save: "Save",
        close: "Close"
    }
};

function applyLanguage() {
    const t = translations[myProfile.lang];
    document.querySelector('h1').innerText = t.title;
    document.getElementById('txt-subtitle').innerText = t.subtitle;
    document.getElementById('btn-single').innerText = t.singleBtn;
    document.getElementById('btn-multi').innerText = t.multiBtn;
    document.getElementById('btn-settings').innerText = t.settings;
    document.getElementById('btn-rating').innerText = t.rating;
    document.getElementById('txt-settings-title').innerText = t.settings;
    document.getElementById('txt-rating-title').innerText = t.rating;
    document.getElementById('btn-save-settings').innerText = t.save;
    document.getElementById('btn-close-rating').innerText = t.close;
    document.getElementById('txt-wind').innerText = t.wind;
    document.getElementById('btn-resume').innerText = t.resume;
    document.getElementById('btn-pause').innerText = t.pause;
    document.getElementById('btn-toggle-sound').innerText = t.sound;
    document.getElementById('btn-exit-menu').innerText = t.mainMenu;
    document.getElementById('txt-ig-menu-title').innerText = t.settings;
}

// Settings Modal
const btnSettings = document.getElementById('btn-settings');
const settingsModal = document.getElementById('settings-modal');
const btnSaveSettings = document.getElementById('btn-save-settings');

btnSettings.addEventListener('click', () => {
    document.getElementById('select-lang').value = myProfile.lang;
    document.getElementById('input-name').value = myProfile.name;
    document.getElementById('select-avatar').value = myProfile.avatar;
    document.getElementById('select-char-type').value = myProfile.charType || 0;
    
    // Fix for flag selection (extract emoji)
    const countrySelect = document.getElementById('select-country');
    for (let opt of countrySelect.options) {
        if (opt.value.includes(myProfile.flag)) {
            countrySelect.value = opt.value;
            break;
        }
    }
    
    settingsModal.classList.remove('hidden');
    menuScreen.classList.add('hidden');
});

btnSaveSettings.addEventListener('click', () => {
    myProfile.lang = document.getElementById('select-lang').value;
    myProfile.name = document.getElementById('input-name').value || "Jangchi";
    myProfile.avatar = document.getElementById('select-avatar').value;
    myProfile.charType = document.getElementById('select-char-type').value;
    myProfile.flag = document.getElementById('select-country').value;
    
    saveProfile();
    settingsModal.classList.add('hidden');
    menuScreen.classList.remove('hidden');
});

// Rating Modal
const btnRating = document.getElementById('btn-rating');
const ratingModal = document.getElementById('rating-modal');
const btnCloseRating = document.getElementById('btn-close-rating');

btnRating.addEventListener('click', () => {
    document.getElementById('stat-score').innerText = myStats.score;
    document.getElementById('stat-games').innerText = myStats.games;
    document.getElementById('stat-wins').innerText = myStats.wins;
    
    ratingModal.classList.remove('hidden');
    menuScreen.classList.add('hidden');
});

btnCloseRating.addEventListener('click', () => {
    ratingModal.classList.add('hidden');
    menuScreen.classList.remove('hidden');
});

// Pause Logic
const btnPause = document.getElementById('btn-pause');
btnPause.addEventListener('click', () => {
    if (gameMode !== 'single') return; // Pause only in single player
    isPaused = !isPaused;
    btnPause.innerText = isPaused ? translations[myProfile.lang].resume : translations[myProfile.lang].pause;
    if(!isPaused) {
        lastTime = performance.now(); // avoid teleportation
    }
});

// Setup on load
applyLanguage();
