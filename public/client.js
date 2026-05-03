const IS_NATIVE_APP = (() => {
    const viaCapacitor = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
    const viaProtocol = String(window.location?.protocol || '').startsWith('capacitor');
    const viaAndroidWebView = /android/i.test(String(navigator.userAgent || '')) && window.location?.hostname === 'localhost' && !window.location?.port;
    return viaCapacitor || viaProtocol || viaAndroidWebView;
})();
const REMOTE_SERVER_URL = 'https://nayza-jangi.onrender.com';
const WEB_LOCAL_BASE = (() => {
    const origin = String(window.location?.origin || '');
    if (origin.startsWith('http://') || origin.startsWith('https://')) return origin;
    return '';
})();
// Web: use current local server. Native app: use Render.
const API_BASE = IS_NATIVE_APP ? REMOTE_SERVER_URL : (WEB_LOCAL_BASE || REMOTE_SERVER_URL);
const FALLBACK_SOCKET = {
    connected: false,
    id: null,
    on: () => {},
    emit: () => {},
    off: () => {},
    disconnect: () => {}
};
let socket = FALLBACK_SOCKET;
try {
    if (typeof window.io === 'function') {
        socket = window.io(IS_NATIVE_APP ? REMOTE_SERVER_URL : undefined, { transports: ['websocket', 'polling'] });
    } else {
        console.warn('Socket.IO client script not loaded; online mode disabled.');
    }
} catch (err) {
    console.warn('Socket initialization failed; online mode disabled.', err);
}
let trajectoryLine = null;
const mixers = [];

function loadTextureWithBgRemoval(url) {
    const loader = new THREE.TextureLoader();
    const tex = loader.load(url, (loadedTex) => {
        const img = loadedTex.image;
        if (!img) return;
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        
        if (data[3] > 200) {
            const bgR = data[0], bgG = data[1], bgB = data[2];
            for (let i = 0; i < data.length; i += 4) {
                if (Math.abs(data[i]-bgR)<50 && Math.abs(data[i+1]-bgG)<50 && Math.abs(data[i+2]-bgB)<50) {
                    data[i+3] = 0;
                }
            }
            ctx.putImageData(imgData, 0, 0);
            tex.image = canvas;
            tex.needsUpdate = true;
        }
        loadedTex.generateMipmaps = true;
        loadedTex.minFilter = THREE.LinearMipmapLinearFilter;
        loadedTex.magFilter = THREE.LinearFilter;
        loadedTex.anisotropy = 8;
    });
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    return tex;
}

function loadTexture(url, options = {}) {
    const loader = new THREE.TextureLoader();
    const tex = loader.load(url, (loadedTex) => {
        const img = loadedTex.image;
        if (!img) return;

        if (options.removeBg) {
            const source = loadedTex.image;
            const canvas = document.createElement('canvas');
            canvas.width = source.width;
            canvas.height = source.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(source, 0, 0);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imgData.data;
            const bgR = data[0], bgG = data[1], bgB = data[2];
            for (let i = 0; i < data.length; i += 4) {
                if (Math.abs(data[i] - bgR) < 35 && Math.abs(data[i + 1] - bgG) < 35 && Math.abs(data[i + 2] - bgB) < 35) {
                    data[i + 3] = 0;
                }
            }
            ctx.putImageData(imgData, 0, 0);
            loadedTex.image = canvas;
        }

        loadedTex.needsUpdate = true;
    });
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    return tex;
}

const soldierTexture = loadTextureWithBgRemoval('askar.png');
const nayzabozTexture = loadTextureWithBgRemoval('Nayzaboz.png');
const qargaTexture = loadTextureWithBgRemoval('qarga.png');
const daraxtKattaTexture = loadTexture('daraxtkatta.png');
const daraxtKichkinaTexture = loadTexture('daraxtkichkina.png');
const qalaTexture = loadTexture('Qala.png');
const devorTusiqTexture = loadTexture('devortusiq.png');
const bulutTexture = loadTexture('bulut-Photoroom.png');
const ottomanArcherTextures = {
    shieldIdle: loadTexture('Kamonlik%20Usmoniy/kamonlik%201.png'),
    shieldAim: loadTexture('Kamonlik%20Usmoniy/kamonlik%20monjal.png'),
    shieldDefend: loadTexture('Kamonlik%20Usmoniy/kamonlik%202%20himoya.png'),
    shieldDuck: loadTexture('Kamonlik%20Usmoniy/Otirgan%20qalqonli%20kamonboz.png'),
    shieldHurt: loadTexture('Kamonlik%20Usmoniy/yaradorkamonbozqalqonli.png'),
    shieldBreak: loadTexture('Kamonlik%20Usmoniy/kamonlik%20qalqoni%20yorildi.png'),
    noShieldIdle: loadTexture('Kamonlik%20Usmoniy/kamonlik%20qalqonsiz%20stand.png'),
    noShieldAim: loadTexture('Kamonlik%20Usmoniy/kamonlik%20qalqonsiz%20oq%20uzadi.png'),
    noShieldDefend: loadTexture('Kamonlik%20Usmoniy/kamonlik%20qalqonsiz%20himoyalanyapti.png'),
    noShieldDuck: loadTexture('Kamonlik%20Usmoniy/utirganqalqonsizkamonboz.png'),
    noShieldHurt: loadTexture('Kamonlik%20Usmoniy/yaradorkamonbozqalqonsiz.png'),
    celebrate: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayzasiz%20qalqonsiz%20galaba%20nishonlash.png')
};
const ottomanSpearmanTextures = {
    shieldIdle: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayza%201.png'),
    shieldAim: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayza%202.png'),
    shieldDefend: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayza%203.png'),
    shieldAfterShot: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayza%204.png'),
    shieldBreak: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayza%205.png'),
    shieldDuck: loadTexture('Nayzalik%20Usmoniy/qalqonnayzautirgan.png'),
    noShieldIdle: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayzalik%20qalqonsiz%201.png'),
    noShieldAim: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayzalik%20qalqonsiz%202.png'),
    noShieldDefend: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayzasiz%20qalqonsiz%20galaba%20nishonlash.png'),
    noShieldAfterShot: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayzasiz%20qalqonsiz%201.png'),
    noShieldDuck: loadTexture('Nayzalik%20Usmoniy/nayzaqalqonsizutirgan.png'),
    celebrate: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayzasiz%20qalqonsiz%20galaba%20nishonlash.png')
};

window.customModelsInfo = [];
window.customModelTextures = {};

async function fetchCustomModels() {
    try {
        const res = await fetch('/api/models');
        const data = await res.json();
        window.customModelsInfo = data;
        
        const s1 = document.getElementById('select-char-type');
        const s2 = document.getElementById('select-char-type-options');
        data.forEach(m => {
            if (s1) s1.innerHTML += `<option value="${m.id}">${m.name}</option>`;
            if (s2) s2.innerHTML += `<option value="${m.id}">${m.name}</option>`;
        });
        
        // Ensure values match profile if any
        if (typeof myProfile !== 'undefined' && myProfile && myProfile.charType) {
            if (s1) s1.value = String(myProfile.charType);
            if (s2) s2.value = String(myProfile.charType);
        }
        
        data.forEach(m => {
            window.customModelTextures[m.id] = {
                shieldIdle: loadTexture(m.textures.shieldIdle),
                shieldAim: loadTexture(m.textures.shieldAim),
                shieldDuck: loadTexture(m.textures.shieldDuck),
                shieldDefend: loadTexture(m.textures.shieldDefend),
                shieldHurt: loadTexture(m.textures.shieldHurt || m.textures.shieldIdle),
                shieldBreak: loadTexture(m.textures.shieldBreak || m.textures.noShieldIdle),
                noShieldIdle: loadTexture(m.textures.noShieldIdle),
                noShieldAim: loadTexture(m.textures.noShieldAim),
                noShieldDuck: loadTexture(m.textures.noShieldDuck),
                noShieldDefend: loadTexture(m.textures.noShieldDefend),
                noShieldHurt: loadTexture(m.textures.noShieldHurt || m.textures.noShieldIdle),
                celebrate: loadTexture(m.textures.celebrate || m.textures.shieldIdle),
                bgMusic: m.bgMusic
            };
            
            // Auto-play music if this is the currently selected profile character
            if (typeof myProfile !== 'undefined' && myProfile && String(myProfile.charType) === m.id && m.bgMusic) {
                if (typeof selectedMusicTrack !== 'undefined') {
                    selectedMusicTrack = m.bgMusic;
                    if (typeof applySelectedMusicTrack === 'function') applySelectedMusicTrack();
                }
            }
        });
    } catch(e) { console.error('Error loading custom models:', e); }
}
fetchCustomModels();


// Procedural Generation Mode Enabled - No external 3D models loaded.

// UI Elements
const menuScreen = document.getElementById('menu-screen');
const btnSingle = document.getElementById('btn-single');
const btnMulti = document.getElementById('btn-multi');
const multiMenu = document.getElementById('multi-menu');

const waitingScreen = document.getElementById('waiting-screen');
const btnCancelMulti = document.getElementById('btn-cancel-multi');

const gameScreen = document.getElementById('game-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const disconnectScreen = document.getElementById('disconnect-screen');
const winnerText = document.getElementById('winner-text');
const restartBtn = document.getElementById('restart-btn');
const menuBtn = document.getElementById('menu-btn');
const rematchBtn = document.getElementById('rematch-btn');
const rematchModal = document.getElementById('rematch-modal');
const rematchTitle = document.getElementById('rematch-title');
const rematchText = document.getElementById('rematch-text');
const btnRematchAccept = document.getElementById('btn-rematch-accept');
const btnRematchDecline = document.getElementById('btn-rematch-decline');

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
const shieldButton = document.getElementById('shield-button');
const shieldCountText = document.getElementById('shield-count');
const superButton = document.getElementById('super-button');
const superCountText = document.getElementById('super-count');
const crowButton = document.getElementById('crow-button');
const crowCountText = document.getElementById('crow-count');
const duckButton = document.getElementById('duck-button');
const doubleButton = document.getElementById('double-button');
const doubleCountText = document.getElementById('double-count');
const wallButton = document.getElementById('wall-button');
const wallCountText = document.getElementById('wall-count');
const gameOptionsModal = document.getElementById('game-options-modal');
const btnConfirmCreate = document.getElementById('btn-confirm-create');
const btnCancelOptions = document.getElementById('btn-cancel-options');
const selectDifficulty = document.getElementById('select-difficulty');
const difficultyWrap = document.getElementById('difficulty-wrap');
const selectWeather = document.getElementById('select-weather');
const gameOptionsFields = document.getElementById('game-options-fields');
const selectCharTypeOptions = document.getElementById('select-char-type-options');
const levelBadge = document.getElementById('level-badge');
const soundSettingsPanel = document.getElementById('sound-settings-panel');
const musicVolumeInput = document.getElementById('music-volume');
const musicMuteInput = document.getElementById('music-mute');
const sfxVolumeInput = document.getElementById('sfx-volume');
const sfxMuteInput = document.getElementById('sfx-mute');
const settingsMusicVolumeInput = document.getElementById('settings-music-volume');
const settingsSfxVolumeInput = document.getElementById('settings-sfx-volume');
const settingsMusicTrackSelect = document.getElementById('settings-music-track');
const inGameMusicTrackSelect = document.getElementById('in-game-music-track');
const btnVolDown = document.getElementById('btn-vol-down');
const btnVolMute = document.getElementById('btn-vol-mute');
const btnVolUp = document.getElementById('btn-vol-up');
const campaignLevelText = document.getElementById('campaign-level-text');
const hudScoreText = document.getElementById('hud-score');
const btnResetCampaign = document.getElementById('btn-reset-campaign');
const btnBuySuper = document.getElementById('btn-buy-super');
const superCountSettings = document.getElementById('super-count-settings');
const btnBuyDouble = document.getElementById('btn-buy-double');
const doubleCountSettings = document.getElementById('double-count-settings');
const btnBuyWall = document.getElementById('btn-buy-wall');
const wallCountSettings = document.getElementById('wall-count-settings');
const shopScoreText = document.getElementById('shop-score-text');
const shopSuperMaxText = document.getElementById('shop-super-max');
const shopDoubleMaxText = document.getElementById('shop-double-max');
const shopWallMaxText = document.getElementById('shop-wall-max');
const btnShop = document.getElementById('btn-shop');
const btnLogout = document.getElementById('btn-logout');
const shopModal = document.getElementById('shop-modal');
const btnCloseShop = document.getElementById('btn-close-shop');
const singleModeModal = document.getElementById('single-mode-modal');
const btnSingleContinue = document.getElementById('btn-single-continue');
const btnSingleNew = document.getElementById('btn-single-new');
const btnSingleCancel = document.getElementById('btn-single-cancel');
const btnSingleSelectLevel = document.getElementById('btn-single-select-level');
const levelSelectModal = document.getElementById('level-select-modal');
const levelGrid = document.getElementById('level-grid');
const btnLevelSelectCancel = document.getElementById('btn-level-select-cancel');
const btnAddFriend = document.getElementById('btn-add-friend');
const friendsListEl = document.getElementById('friends-list');
const btnRefreshFriends = document.getElementById('btn-refresh-friends');
const friendInviteModal = document.getElementById('friend-invite-modal');
const friendInviteText = document.getElementById('friend-invite-text');
const btnFriendInviteAccept = document.getElementById('btn-friend-invite-accept');
const btnFriendInviteDecline = document.getElementById('btn-friend-invite-decline');
const playerIdReadonly = document.getElementById('player-id-readonly');
const inputFriendId = document.getElementById('input-friend-id');
const btnAddFriendId = document.getElementById('btn-add-friend-id');
const friendIdStatus = document.getElementById('friend-id-status');
const btnMusicToggle = document.getElementById('music-toggle-btn');
const btnAbout = document.getElementById('btn-about');
const aboutModal = document.getElementById('about-modal');
const btnCloseAbout = document.getElementById('btn-close-about');
const friendAddModal = document.getElementById('friend-add-modal');
const friendAddText = document.getElementById('friend-add-text');
const btnFriendAddAccept = document.getElementById('btn-friend-add-accept');
const btnFriendAddDecline = document.getElementById('btn-friend-add-decline');
const authModal = document.getElementById('auth-modal');
const authNameInput = document.getElementById('auth-name');
const authPhoneInput = document.getElementById('auth-phone');
const authRegisterPhoneInput = document.getElementById('auth-register-phone');
const authAgeInput = document.getElementById('auth-age');
const authPasswordInput = document.getElementById('auth-password');
const authRegisterPasswordInput = document.getElementById('auth-register-password');
const btnAuthRegister = document.getElementById('btn-auth-register');
const btnAuthLogin = document.getElementById('btn-auth-login');
const resetPhoneInput = document.getElementById('reset-phone');
const resetPasswordInput = document.getElementById('reset-password');
const btnAuthReset = document.getElementById('btn-auth-reset');
const btnForgotToggle = document.getElementById('btn-forgot-toggle');
const forgotSection = document.getElementById('forgot-section');
const authStatus = document.getElementById('auth-status');
const authTabLogin = document.getElementById('auth-tab-login');
const authTabRegister = document.getElementById('auth-tab-register');
const authLoginSection = document.getElementById('auth-login-section');
const authRegisterSection = document.getElementById('auth-register-section');

// Audio Setup
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx;
let bgMusicNode = null;
let bgMusicAudio = null;
let audioUnlockAttached = false;
let musicVolume = parseFloat(localStorage.getItem('nayza_music_volume') || '0.4');
let musicMuted = localStorage.getItem('nayza_music_muted') === '1';
let sfxVolume = parseFloat(localStorage.getItem('nayza_sfx_volume') || '0.8');
let sfxMuted = localStorage.getItem('nayza_sfx_muted') === '1';
let selectedMusicTrack = localStorage.getItem('nayza_music_track') || 'music.mp3';
const sfxPaths = {
    button: 'mp3/buttonlarbosilganda.mp3',
    aim: 'mp3/monjalgaolish.mp3',
    ground: 'mp3/oqodamgasanchilishi.mp3',
    shieldActive: 'mp3/oqqalqongategsa.mp3',
    shieldPassive: 'mp3/uqqalqongategsaahh.mp3',
    shieldPress: 'mp3/qalqontugmasibosilganda.mp3',
    superPress: 'mp3/Superkuch.mp3',
    crowDead: 'mp3/qargauldi.mp3',
    headHit: 'mp3/uqodamgategsaboshiga.mp3',
    legHit: 'mp3/uqoyoqqategsa.mp3',
    throw: 'mp3/uquzilganda.mp3'
};

function initAudio() {
    if (!audioCtx) {
        audioCtx = new AudioContext();
        startBackgroundMusic();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (!bgMusicAudio) {
        bgMusicAudio = new Audio(selectedMusicTrack);
        bgMusicAudio.loop = true;
        bgMusicAudio.preload = 'auto';
        bgMusicAudio.playsInline = true;
        bgMusicAudio.setAttribute('playsinline', 'true');
        bgMusicAudio.setAttribute('webkit-playsinline', 'true');
    }
    bgMusicAudio.volume = musicMuted ? 0 : musicVolume;
    bgMusicAudio.play().catch(() => {});
}

function applySelectedMusicTrack() {
    if (!bgMusicAudio) return;
    const currentSrc = String(bgMusicAudio.src || '');
    if (currentSrc.endsWith(selectedMusicTrack)) return;
    bgMusicAudio.src = selectedMusicTrack;
    bgMusicAudio.loop = true;
    bgMusicAudio.preload = 'auto';
    bgMusicAudio.volume = musicMuted ? 0 : musicVolume;
    bgMusicAudio.play().catch(() => {});
}

function playSfx(key, volumeScale = 1) {
    if (sfxMuted) return;
    const src = sfxPaths[key];
    if (!src) return;
    try {
        if (!audioCtx) initAudio();
        else if (audioCtx.state === 'suspended') audioCtx.resume();
        const audio = new Audio(src);
        audio.preload = 'auto';
        audio.playsInline = true;
        audio.setAttribute('playsinline', 'true');
        audio.volume = Math.max(0, Math.min(1, (sfxVolume || 0.8) * volumeScale));
        audio.play().catch(() => {});
    } catch (_) {}
}

function playHitByResult(hitResult) {
    if (!hitResult) return;
    if (hitResult.isShieldHit) {
        playSfx(hitResult.shieldActiveBlock ? 'shieldActive' : 'shieldPassive');
        return;
    }
    if (hitResult.hitZone === 'head') {
        playSfx('headHit');
    } else if (hitResult.hitZone === 'leg') {
        playSfx('legHit');
    } else {
        playSfx('ground', 0.9);
    }
}

function playThrowSound() {
    playSfx('throw');
}

function playHitSound(isFlesh, isCrit = false) {
    playSfx(isCrit ? 'headHit' : 'legHit');
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
    playSfx('crowDead');
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

function saveMusicSettings() {
    localStorage.setItem('nayza_music_volume', String(musicVolume));
    localStorage.setItem('nayza_music_muted', musicMuted ? '1' : '0');
    localStorage.setItem('nayza_sfx_volume', String(sfxVolume));
    localStorage.setItem('nayza_sfx_muted', sfxMuted ? '1' : '0');
    localStorage.setItem('nayza_music_track', selectedMusicTrack);
}

function applyMusicSettings() {
    if (musicVolumeInput) musicVolumeInput.value = String(musicVolume);
    if (musicMuteInput) musicMuteInput.checked = musicMuted;
    if (sfxVolumeInput) sfxVolumeInput.value = String(sfxVolume);
    if (sfxMuteInput) sfxMuteInput.checked = sfxMuted;
    if (settingsMusicVolumeInput) settingsMusicVolumeInput.value = String(musicVolume);
    if (settingsSfxVolumeInput) settingsSfxVolumeInput.value = String(sfxVolume);
    if (settingsMusicTrackSelect) settingsMusicTrackSelect.value = selectedMusicTrack;
    if (inGameMusicTrackSelect) inGameMusicTrackSelect.value = selectedMusicTrack;
    if (bgMusicAudio) bgMusicAudio.volume = musicMuted ? 0 : musicVolume;
    if (btnVolMute) btnVolMute.innerText = musicMuted ? '🔇' : '🔊';
    if (btnMusicToggle) btnMusicToggle.innerText = musicMuted ? '🔇' : '🔊';
    applySelectedMusicTrack();
}

// Three.js Setup (Cinematic)
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a0b2e);
scene.fog = new THREE.FogExp2(0x1a0b2e, 0.0008);
const MOBILE_PERF_MODE = IS_NATIVE_APP;

let frustumSize = 800;
let aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.OrthographicCamera(frustumSize * aspect / -2, frustumSize * aspect / 2, frustumSize / 2, frustumSize / -2, 1, 3000);
camera.position.set(0, 0, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: !MOBILE_PERF_MODE, powerPreference: "high-performance" });

function getPreferredPixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    return Math.min(dpr, MOBILE_PERF_MODE ? 1.6 : 2.5);
}

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(getPreferredPixelRatio());
renderer.shadowMap.enabled = !MOBILE_PERF_MODE;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
else renderer.outputEncoding = THREE.sRGBEncoding;
container.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.95);
dirLight.position.set(200, 1000, 500);
dirLight.castShadow = !MOBILE_PERF_MODE;
dirLight.shadow.mapSize.width = MOBILE_PERF_MODE ? 1024 : 2048;
dirLight.shadow.mapSize.height = MOBILE_PERF_MODE ? 1024 : 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 1500;
const d = 1000;
dirLight.shadow.camera.left = -d; dirLight.shadow.camera.right = d; dirLight.shadow.camera.top = d; dirLight.shadow.camera.bottom = -d;
scene.add(dirLight);

const rimLight = new THREE.DirectionalLight(0x4444ff, 0.55);
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
const dustCount = MOBILE_PERF_MODE ? 220 : 500;
const dustPos = new Float32Array(dustCount * 3);
for(let i=0; i<dustCount*3; i++) {
    dustPos[i] = (Math.random() - 0.5) * 4000;
    if(i%3 === 1) dustPos[i] = Math.random() * 800 - 300; 
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustMat = new THREE.PointsMaterial({ color: 0xffddaa, size: 4, transparent: true, opacity: 0.4 });
const dustSystem = new THREE.Points(dustGeo, dustMat);
scene.add(dustSystem);
let weatherType = 'sunny';
let weatherSystem = null;
let weatherVelocities = null;

function clearWeatherSystem() {
    if (!weatherSystem) return;
    scene.remove(weatherSystem);
    weatherSystem.geometry.dispose();
    weatherSystem.material.dispose();
    weatherSystem = null;
    weatherVelocities = null;
}

function createWeatherSystem(type) {
    clearWeatherSystem();
    if (type !== 'rain' && type !== 'storm' && type !== 'snow') return;

    const count = MOBILE_PERF_MODE ? (type === 'storm' ? 550 : 380) : (type === 'storm' ? 1200 : 800);
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const j = i * 3;
        pos[j] = (Math.random() - 0.5) * 4200;
        pos[j + 1] = Math.random() * 1700 - 600;
        pos[j + 2] = (Math.random() - 0.5) * 100;
        vel[i] = type === 'snow' ? (60 + Math.random() * 90) : (260 + Math.random() * 220);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
        color: type === 'snow' ? 0xffffff : 0x9ad7ff,
        size: type === 'snow' ? 3.2 : 1.7,
        transparent: true,
        opacity: type === 'storm' ? 0.85 : 0.65
    });
    weatherSystem = new THREE.Points(geo, mat);
    weatherVelocities = vel;
    scene.add(weatherSystem);
}

let entities = [];
let clouds = [];
let decorTrees = [];
let mapBackdrops = [];
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
    group.children.forEach(c => c.castShadow = true);
    return group;
}

function buildMap(mapType, weather = 'sunny') {
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
    
    if (weather === 'night') {
        skyColor = 0x0b1020;
        groundColor = 0x1f2937;
        rockColor = 0x334155;
    } else if (weather === 'rain') {
        skyColor = 0x5f8ca8;
    } else if (weather === 'storm') {
        skyColor = 0x34495e;
        groundColor = 0x7aa08c;
    } else if (weather === 'snow') {
        skyColor = 0xcde9ff;
    }

    ground.material.color.setHex(groundColor);
    rocks.forEach(r => r.material.color.setHex(rockColor));
    scene.background.setHex(skyColor);
    scene.fog.color.setHex(skyColor);
    scene.fog.density = (weather === 'storm') ? 0.0012 : 0.0008;
    weatherType = weather;
    createWeatherSystem(weatherType);

    // Decorative mixed trees placed away from fighters, with depth layers
    mapBackdrops.forEach((obj) => scene.remove(obj));
    mapBackdrops = [];
    decorTrees.forEach((tree) => scene.remove(tree));
    decorTrees = [];
    let treesPerSide = 6;
    let smallTreeChance = 0.45;
    if (mapType === 'castle') {
        treesPerSide = 4;
        smallTreeChance = 0.35;
    } else if (mapType === 'winter') {
        treesPerSide = 3;
        smallTreeChance = 0.25;
    } else if (mapType === 'desert') {
        treesPerSide = 2;
        smallTreeChance = 0.2;
    } else if (mapType === 'field') {
        treesPerSide = 7;
        smallTreeChance = 0.52;
    }
    const safeRadius = Math.max(1300, currentBattleDistance / 2 + 420);
    if (mapType === 'castle') {
        for (const side of [-1, 1]) {
            const qala = new THREE.Mesh(
                new THREE.PlaneGeometry(920, 660),
                new THREE.MeshBasicMaterial({
                    map: qalaTexture,
                    transparent: true,
                    side: THREE.FrontSide,
                    alphaTest: 0.02,
                    depthWrite: false
                })
            );
            qala.position.set(
                side * (safeRadius + 260),
                ground.position.y + 300,
                -280
            );
            if (weatherType === 'night') qala.material.color.setRGB(0.72, 0.76, 0.9);
            else if (weatherType === 'storm') qala.material.color.setRGB(0.82, 0.86, 0.95);
            else if (weatherType === 'snow') qala.material.color.setRGB(0.93, 0.95, 1);
            scene.add(qala);
            mapBackdrops.push(qala);
        }
    }
    for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < treesPerSide; i++) {
            const useSmallTree = Math.random() < smallTreeChance;
            const w = useSmallTree ? (150 + Math.random() * 60) : (220 + Math.random() * 80);
            const h = useSmallTree ? (230 + Math.random() * 90) : (320 + Math.random() * 120);
            const depthBand = Math.floor(Math.random() * 3); // 0: front, 1: middle, 2: back
            const depthOffsetX = depthBand * (110 + Math.random() * 70);
            const zByBand = depthBand === 0 ? (30 + Math.random() * 50) : (depthBand === 1 ? (-40 + Math.random() * 50) : (-150 + Math.random() * 70));
            const opacityByBand = depthBand === 0 ? (0.98 + Math.random() * 0.02) : (depthBand === 1 ? (0.94 + Math.random() * 0.04) : (0.9 + Math.random() * 0.05));
            const tree = new THREE.Mesh(
                new THREE.PlaneGeometry(w, h),
                new THREE.MeshBasicMaterial({
                    map: useSmallTree ? daraxtKichkinaTexture : daraxtKattaTexture,
                    transparent: true,
                    opacity: opacityByBand,
                    side: THREE.FrontSide,
                    alphaTest: 0.01,
                    depthWrite: false
                })
            );
            tree.position.set(
                side * (safeRadius + 260 + depthOffsetX + i * (200 + Math.random() * 90)),
                ground.position.y + 30 + h / 2,
                zByBand
            );
            tree.userData.baseX = tree.position.x;
            tree.userData.baseRot = (Math.random() - 0.5) * 0.02;
            tree.userData.swayAmp = 0.005 + Math.random() * 0.012;
            tree.userData.swaySpeed = 0.7 + Math.random() * 1.1;
            tree.userData.swayPhase = Math.random() * Math.PI * 2;
            tree.userData.depthBand = depthBand;

            // Keep trees crisp and neutral in all weather types.
            tree.material.color.setRGB(1, 1, 1);
            scene.add(tree);
            decorTrees.push(tree);
        }
    }
}

function spawnEntities(options) {
    entities.forEach(e => scene.remove(e.mesh));
    entities = [];
    
    clouds.forEach(c => scene.remove(c));
    clouds = [];
    
    // Spawn Clouds
    for(let i=0; i<8; i++) {
        const cloudWidth = 200 + Math.random() * 150;
        const cloudHeight = 100 + Math.random() * 80;
        const cloudGeo = new THREE.PlaneGeometry(cloudWidth, cloudHeight);
        const cloudMat = new THREE.MeshBasicMaterial({
            map: bulutTexture,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const cloud = new THREE.Mesh(cloudGeo, cloudMat);
        cloud.position.set(
            (Math.random() - 0.5) * 4000,
            400 + Math.random() * 300,
            -200 - Math.random() * 300
        );
        cloud.userData = { vx: (Math.random() - 0.5) * 15 };
        scene.add(cloud);
        clouds.push(cloud);
    }

    if (!options) return;
    currentSeed = options.seed || 0.5;
    
    if (options.birds) {
        const birdCount = options.birdCount || 20;
        for(let i=0; i<birdCount; i++) {
            const bird = createCrow(0, 0);
            // Qushlar balandroqda uchadi - 1200-1600 balandlik
            bird.position.set((seededRandom() - 0.5) * 3200, 1200 + seededRandom() * 400, -30 + seededRandom() * 60);
            scene.add(bird);
            entities.push({
                type: 'bird',
                mesh: bird,
                vx: (seededRandom() > 0.5 ? 1 : -1) * (80 + seededRandom() * 160),
                vy: (seededRandom() - 0.5) * 45,
                alive: true,
                fallWithSpear: false
            });
        }
    }
    // Animals removed by request: only birds are used as obstacles.
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
    
    const tex = qargaTexture.clone();
    tex.needsUpdate = true;
    tex.repeat.set(1, 1);
    tex.offset.set(0, 0);
    
    const mat = new THREE.MeshBasicMaterial({
        map: tex, 
        transparent: true, 
        side: THREE.DoubleSide, 
        alphaTest: 0.35
    });
    
    // Qarga size
    const planeGeo = new THREE.PlaneGeometry(80, 80);
    const planeMesh = new THREE.Mesh(planeGeo, mat);
    planeMesh.castShadow = true;
    crowGroup.add(planeMesh);
    
    crowGroup.userData.tex = tex;
    crowGroup.userData.isCrowSprite = true;
    crowGroup.position.set(x, y, 0);
    return crowGroup;
}

// Characters
const pWidth = 60;
const pHeight = 160;

function createSoldier(isP1, charType = 0) {
    const group = new THREE.Group();
    
    const normalizedCharType = (typeof charType === 'string' && charType.startsWith('custom_')) ? charType : Number(charType || 0);
    group.userData.charType = normalizedCharType;
    group.userData.isCustomModel = typeof normalizedCharType === 'string' && normalizedCharType.startsWith('custom_');
    group.userData.isOttomanArcher = normalizedCharType === 2;
    group.userData.isOttomanSpearman = normalizedCharType === 3;
    group.userData.isOttomanUnit = group.userData.isOttomanArcher || group.userData.isOttomanSpearman || group.userData.isCustomModel;
    group.userData.shieldBroken = false;
    group.userData.visualState = 'idle';
    group.userData.forceState = null;
    group.userData.forceStateUntil = 0;
    group.userData.mats = [];
    group.userData.torso = new THREE.Group();
    group.userData.headGroup = new THREE.Group();
    group.userData.armL = new THREE.Group();
    group.userData.armR = new THREE.Group();
    group.userData.shieldGroup = new THREE.Group();
    
    // Add dummy groups
    group.add(group.userData.headGroup);
    group.add(group.userData.armL);
    group.add(group.userData.armR);
    
    // 2D High-Quality Hero Sprite using the selected texture
    let selectedTexture = soldierTexture;
    if (normalizedCharType === 1) selectedTexture = nayzabozTexture;
    if (normalizedCharType === 2) selectedTexture = ottomanArcherTextures.shieldIdle;
    if (normalizedCharType === 3) selectedTexture = ottomanSpearmanTextures.shieldIdle;
    if (group.userData.isCustomModel && window.customModelTextures[normalizedCharType]) {
        selectedTexture = window.customModelTextures[normalizedCharType].shieldIdle;
    }
    const tex = selectedTexture.clone();
    tex.needsUpdate = true;
    if (group.userData.isOttomanUnit) {
        tex.repeat.set(1, 1);
    } else {
        tex.repeat.set(0.26, 0.78); // 0.26 width, 0.78 height cuts off the top 22% (numbers)
    }
    tex.offset.set(0, 0); // Start from bottom
    
    // Use Standard Material with alphaTest 0.5 to fix black borders and enable proper shadows
    const soldierMat = new THREE.MeshBasicMaterial({
        map: tex, 
        transparent: true, 
        side: THREE.DoubleSide, 
        alphaTest: group.userData.isOttomanUnit ? 0.2 : 0.5,
        toneMapped: false,
        fog: false
    });
    group.userData.mats.push(soldierMat);
    group.userData.tex = tex;
    
    const isMobileView = window.matchMedia('(max-width: 900px)').matches;
    const mobileScaleBoost = isMobileView ? 1.16 : 1;
    const planeWidth = (group.userData.isOttomanSpearman ? 640 : (group.userData.isOttomanUnit ? 560 : 360)) * mobileScaleBoost;
    const planeHeight = (group.userData.isOttomanUnit ? 430 : 480) * mobileScaleBoost;
    const planeGeo = new THREE.PlaneGeometry(planeWidth, planeHeight);
    const planeMesh = new THREE.Mesh(planeGeo, soldierMat);
    planeMesh.position.y = planeHeight / 2;
    if (group.userData.isOttomanUnit) planeMesh.position.x = 0;
    group.userData.planeMesh = planeMesh;
    group.userData.basePlaneY = planeHeight / 2;
    
    // Proper shadow casting requires a material that responds to light + castShadow flag
    planeMesh.castShadow = true;
    
    if (!isP1) {
        // Flip horizontally for bot
        planeMesh.rotation.y = Math.PI;
    }
    
    group.userData.torso.add(planeMesh); // attach to torso so breath animation works
    group.add(group.userData.torso);
    
    // Keep feet on the visible top of the ground.
    group.position.y = ground.position.y + (group.userData.isOttomanUnit ? 78 : 86);
    
    scene.add(group);
    return group;
}

function getOttomanArcherTexture(model, state) {
    const broken = model.userData.shieldBroken;
    if (state === 'celebrate') return ottomanArcherTextures.celebrate;
    if (state === 'break') return ottomanArcherTextures.shieldBreak;
    if (state === 'hurt') return broken ? ottomanArcherTextures.noShieldHurt : ottomanArcherTextures.shieldHurt;
    if (state === 'duck') return broken ? ottomanArcherTextures.noShieldDuck : ottomanArcherTextures.shieldDuck;
    if (state === 'defend') return broken ? ottomanArcherTextures.noShieldDefend : ottomanArcherTextures.shieldDefend;
    if (state === 'aim') return broken ? ottomanArcherTextures.noShieldAim : ottomanArcherTextures.shieldAim;
    return broken ? ottomanArcherTextures.noShieldIdle : ottomanArcherTextures.shieldIdle;
}

function getOttomanSpearmanTexture(model, state) {
    const broken = model.userData.shieldBroken;
    if (state === 'break') return ottomanSpearmanTextures.shieldBreak;
    if (state === 'celebrate') return ottomanSpearmanTextures.celebrate;
    if (!broken) {
        if (state === 'duck') return ottomanSpearmanTextures.shieldDuck;
        if (state === 'defend') return ottomanSpearmanTextures.shieldDefend;
        if (state === 'aim') return ottomanSpearmanTextures.shieldAim;
        if (state === 'afterShot') return ottomanSpearmanTextures.shieldAfterShot;
        return ottomanSpearmanTextures.shieldIdle;
    }
    if (state === 'duck') return ottomanSpearmanTextures.noShieldDuck;
    if (state === 'defend') return ottomanSpearmanTextures.noShieldDefend;
    if (state === 'aim') return ottomanSpearmanTextures.noShieldAim;
    if (state === 'afterShot') return ottomanSpearmanTextures.noShieldAfterShot;
    return ottomanSpearmanTextures.noShieldIdle;
}

function getOttomanTexture(model, state) {
    const charType = String(model.userData.charType);
    if (charType.startsWith('custom_') && window.customModelTextures[charType]) {
        const t = window.customModelTextures[charType];
        const shieldBroken = model.userData.shieldBroken;
        if (shieldBroken) {
            if (state === 'duck') return t.noShieldDuck;
            if (state === 'aim') return t.noShieldAim;
            if (state === 'defend') return t.noShieldDefend;
            if (state === 'hurt') return t.noShieldHurt;
            if (state === 'celebrate') return t.celebrate;
            return t.noShieldIdle;
        } else {
            if (state === 'duck') return t.shieldDuck;
            if (state === 'aim') return t.shieldAim;
            if (state === 'defend') return t.shieldDefend;
            if (state === 'break') return t.shieldBreak;
            if (state === 'hurt') return t.shieldHurt;
            if (state === 'celebrate') return t.celebrate;
            return t.shieldIdle;
        }
    }
    if (model.userData.isOttomanSpearman) return getOttomanSpearmanTexture(model, state);
    return getOttomanArcherTexture(model, state);
}

function setSoldierVisual(model, state) {
    if (!model || !model.userData) return;
    let targetState = state;
    const modelIndex = getPlayerIndexByModel(model);
    if (model.userData.isOttomanUnit && modelIndex >= 0 && isDuckActiveForPlayer(modelIndex)) {
        targetState = 'duck';
    }
    model.userData.visualState = targetState;

    if (model.userData.planeMesh && model.userData.basePlaneY) {
        if (model.userData.isOttomanSpearman && targetState === 'duck') {
            model.userData.planeMesh.position.y = model.userData.basePlaneY + 45;
        } else {
            model.userData.planeMesh.position.y = model.userData.basePlaneY;
        }
    }

    if (!model.userData.isOttomanUnit) {
        const frameMap = { idle: 0, load: 0.25, aim: 0.5, afterShot: 0.75 };
        if (model.userData.tex) model.userData.tex.offset.set(frameMap[state] || 0, 0);
        return;
    }

    const texture = getOttomanTexture(model, targetState);
    const mat = model.userData.mats && model.userData.mats[0];
    if (!mat || mat.map === texture) return;
    mat.map = texture;
    mat.needsUpdate = true;
    model.userData.tex = texture;
}

function getSoldierWeatherTone(weather) {
    if (weather === 'night') return 0.62;
    if (weather === 'storm') return 0.7;
    if (weather === 'rain') return 0.82;
    if (weather === 'snow') return 0.9;
    return 1;
}

function applySoldierWeatherTone() {
    const tone = getSoldierWeatherTone(weatherType);
    [p1Model, p2Model, p3Model].forEach((model) => {
        if (!model || !model.userData || !model.userData.mats) return;
        model.userData.mats.forEach((mat) => {
            if (!mat || !mat.color) return;
            mat.color.setRGB(tone, tone, tone);
            mat.needsUpdate = true;
        });
    });
}

const pos1X = -1300;
const pos2X = 1300;
const pos3Offset = 260;

let p1Model = createSoldier(true, 2);
p1Model.position.x = pos1X;

let p2Model = createSoldier(false, 2);
p2Model.position.x = pos2X;
let p3Model = null;

// Spear object
let spear = null;
let secondarySpear = null;
const spearGroup = new THREE.Group();

const spearShaft = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 110), new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.8 }));
spearShaft.name = 'spear-shaft';
spearShaft.rotateZ(Math.PI / 2);
spearShaft.castShadow = true;
spearGroup.add(spearShaft);
const spearTipGroup = new THREE.Group();
spearTipGroup.name = 'spear-tip-group';
spearTipGroup.position.x = 60;
const spearBlade = new THREE.Mesh(new THREE.ConeGeometry(5, 25, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.9, roughness: 0.2 }));
spearBlade.name = 'spear-blade';
spearBlade.rotateZ(-Math.PI / 2);
spearBlade.castShadow = true;
spearTipGroup.add(spearBlade);
spearGroup.add(spearTipGroup);

// add feathers
const featherMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
const feather1 = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 1), featherMat);
feather1.name = 'spear-feather';
feather1.position.x = -50;
spearGroup.add(feather1);

spearGroup.castShadow = true;
scene.add(spearGroup);
spearGroup.visible = false;
const secondarySpearGroup = spearGroup.clone();
secondarySpearGroup.visible = false;
secondarySpearGroup.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    obj.material = obj.material.clone();
    if (obj.material.color) obj.material.color.setHex(0xa855f7);
    if ('emissive' in obj.material) obj.material.emissive.setHex(0x2e1065);
});
scene.add(secondarySpearGroup);

function applySpearVisualStyle(isSpearmanThrow) {
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
}


let baseZoom = 1;

function updateCameraBounds() {
    aspect = window.innerWidth / window.innerHeight;
    const isMobileView = window.matchMedia('(max-width: 900px)').matches;
    camera.left = -frustumSize * aspect / 2;
    camera.right = frustumSize * aspect / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(getPreferredPixelRatio());
    
    // Ensure world width of 2200 is always visible (zoomed in closer)
    const minWorldWidth = 2800;
    const zoomX = (frustumSize * aspect) / minWorldWidth;
    const mobileZoomBoost = isMobileView ? 1.24 : 1.1;
    baseZoom = Math.min(zoomX * mobileZoomBoost, 1.5); // Allow zooming in more
    
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
let currentRoomName = null;
let currentTurnIndex = 0;
let currentWind = 0;
let isAnimating = false;
let singleShotLocked = false;
let myHealth = 100;
let enemyHealth = 100;
let myShield = 5;
let enemyShield = 5;
let mySuper = 5;
let enemySuper = 5;
let myCrow = 3;
let enemyCrow = 3;
let myDefenseActive = false;
let enemyDefenseActive = false;
let myDuckActive = false;
let enemyDuckActive = false;
let isDoubleSpearActive = false;
let pendingDoubleShot = null;
const SUPER_BUY_COST = 150;
const DOUBLE_BUY_COST = 220;
const WALL_BUY_COST = 500;
const WALL_HP_MAX = 5;
let enemyShieldUsesRemaining = 0;
let enemySuperUsesRemaining = 0;
let enemyShieldAutoUsedThisFlight = false;
let superWarningUntil = 0;
let aiDifficulty = 'normal';
let gameOptionsTargetMode = null;
let turnHideTimer = null;
let prevTurnIndex = -2;
let singleCampaignLevel = parseInt(localStorage.getItem('nayza_single_level') || '1', 10);
let currentBattleDistance = Math.abs(pos2X - pos1X);
let enemyVolleyQueue = [];
let aiHitAccumulator = 0;
let campaignConfig = null;
let currentOpponentProfile = null;
let pendingFriendInvite = null;
let pendingFriendAddRequest = null;
let randomWaitTimer = null;
const wallStates = {
    0: { active: false, x: 0, hp: 0, mesh: null, ownerIndex: 0 },
    1: { active: false, x: 0, hp: 0, mesh: null, ownerIndex: 1 }
};
let isWallPlacementMode = false;
let isWallDragActive = false;
const aiProfiles = {
    easy: { angleJitter: 11, powerJitter: 260, shieldChance: 0.22, skillBias: 0.25 },
    normal: { angleJitter: 6, powerJitter: 160, shieldChance: 0.4, skillBias: 0.5 },
    hard: { angleJitter: 3, powerJitter: 90, shieldChance: 0.62, skillBias: 0.8 }
};
singleCampaignLevel = Math.max(1, Number.isFinite(singleCampaignLevel) ? singleCampaignLevel : 1);

function updateCampaignUI() {
    const t = translations[myProfile.lang] || translations.en || translations.uz;
    const levelWord = t.levelLabel || 'Daraja';
    if (campaignLevelText) campaignLevelText.innerText = `Lv.${singleCampaignLevel}`;
    if (levelBadge) levelBadge.innerText = gameMode === 'single' ? `${levelWord} ${singleCampaignLevel}` : `${levelWord} -`;
    const menuScoreText = document.getElementById('menu-score-text');
    if (menuScoreText) {
        const score = Number(myStats.score || 0);
        menuScoreText.innerText = score < 0 ? `Qarz: ${score}` : String(score);
        menuScoreText.style.color = score < 0 ? '#ef4444' : '#fbbf24';
    }
    if (hudScoreText) {
        const score = Number(myStats.score || 0);
        hudScoreText.innerText = score < 0 ? `Qarz: ${score}` : `Ball: ${score}`;
        hudScoreText.style.color = score < 0 ? '#ef4444' : '#fbbf24';
        hudScoreText.style.borderColor = score < 0 ? 'rgba(239,68,68,0.45)' : 'rgba(251,191,36,0.32)';
    }
}

function getCampaignConfig(level) {
    const lvl = Math.max(1, level || 1);
    const distance = Math.min(3600, 2500 + (lvl - 1) * 60);
    const birds = Math.floor((5 + (lvl - 1) * 2) / 6);
    let hitRate = 0.9;
    let aiPrecision = 0.9;
    let birdTargetChance = 0.1;
    let enemySuperCharges = 1;
    let enemySuperUseChance = 0.08;
    let enemyCount = 1;
    let enemyWallEnabled = false;
    let enemyShieldAutoUses = 2;
    let enemySuperAutoUses = 2;
    if (lvl >= 11 && lvl <= 20) {
        hitRate = 0.9;
        aiPrecision = 0.9;
        birdTargetChance = 0.1;
        enemySuperCharges = 2;
        enemySuperUseChance = 0.24;
        enemyShieldAutoUses = 3;
        enemySuperAutoUses = 3;
    } else if (lvl >= 21 && lvl <= 30) {
        hitRate = 0.9;
        aiPrecision = 0.9;
        birdTargetChance = 0.1;
        enemySuperCharges = 3;
        enemySuperUseChance = 0.35;
        enemyWallEnabled = true;
        enemyShieldAutoUses = 5;
        enemySuperAutoUses = 5;
    } else if (lvl >= 31 && lvl <= 40) {
        hitRate = 0.9;
        aiPrecision = 0.9;
        birdTargetChance = 0.1;
        enemySuperCharges = 3;
        enemySuperUseChance = 0.4;
        enemyCount = 2;
        enemyShieldAutoUses = 5;
        enemySuperAutoUses = 5;
    } else if (lvl >= 41 && lvl <= 66) {
        // Hardcore campaign band: two enemies + higher AI precision/ability pressure.
        hitRate = 0.95;
        aiPrecision = 1.0;
        birdTargetChance = 0.1;
        enemySuperCharges = 4;
        enemySuperUseChance = 0.55;
        enemyCount = 2;
        enemyWallEnabled = true;
        enemyShieldAutoUses = 7;
        enemySuperAutoUses = 7;
    } else if (lvl > 66) {
        hitRate = 0.98;
        aiPrecision = 1.0;
        birdTargetChance = 0.1;
        enemySuperCharges = 5;
        enemySuperUseChance = 0.62;
        enemyCount = 2;
        enemyWallEnabled = true;
        enemyShieldAutoUses = 8;
        enemySuperAutoUses = 8;
    }
    return {
        level: lvl,
        distance,
        birds,
        enemyCount,
        enemyWallEnabled,
        hitRate,
        aiPrecision,
        birdTargetChance,
        enemySuperCharges,
        enemySuperUseChance,
        enemyShieldAutoUses,
        enemySuperAutoUses
    };
}

function applyBattlePositions() {
    const half = currentBattleDistance / 2;
    p1Model.position.x = -half;
    p2Model.position.x = half;
    if (p3Model) p3Model.position.x = half + pos3Offset;
}

function getEnemyIndices() {
    const enemies = [];
    if (myPlayerIndex !== 0) enemies.push(0);
    if (myPlayerIndex !== 1) enemies.push(1);
    if (p3Model && myPlayerIndex !== 2) enemies.push(2);
    return enemies;
}

function modelForPlayer(index) {
    if (index === 0) return p1Model;
    if (index === 2 && p3Model) return p3Model;
    return p2Model;
}

function getPlayerIndexByModel(model) {
    if (model === p1Model) return 0;
    if (model === p2Model) return 1;
    if (p3Model && model === p3Model) return 2;
    return -1;
}

function shieldForPlayer(index) {
    return index === myPlayerIndex ? myShield : enemyShield;
}

function setShieldForPlayer(index, value) {
    if (index === myPlayerIndex) myShield = value;
    else enemyShield = value;
    updateShieldUI();
}

function isDefenseActiveForPlayer(index) {
    return index === myPlayerIndex ? myDefenseActive : enemyDefenseActive;
}

function isDuckActiveForPlayer(index) {
    return index === myPlayerIndex ? myDuckActive : enemyDuckActive;
}

function updateShieldUI() {
    if (!shieldCountText) return;
    shieldCountText.innerText = Math.max(0, myShield);
    if (shieldButton) shieldButton.classList.toggle('broken', myShield <= 0);
}

function updateSuperUI() {
    if (superCountText) superCountText.innerText = Math.max(0, mySuper);
    if (superButton) superButton.classList.toggle('broken', mySuper <= 0);
    if (superCountSettings) superCountSettings.innerText = String(Math.max(0, myProfile.superPowers || mySuper || 0));
    if (doubleCountText) doubleCountText.innerText = String(Math.max(0, Number(myProfile.doubleSpears || 0)));
    if (doubleCountSettings) doubleCountSettings.innerText = String(Math.max(0, Number(myProfile.doubleSpears || 0)));
    if (wallCountText) wallCountText.innerText = String(Math.max(0, Number(myProfile.walls || 0)));
    if (wallCountSettings) wallCountSettings.innerText = String(Math.max(0, Number(myProfile.walls || 0)));
    if (wallButton) {
        const hasWall = Number(myProfile.walls || 0) > 0;
        wallButton.classList.toggle('broken', !hasWall);
        wallButton.classList.toggle('active', isWallPlacementMode);
    }
    if (doubleButton) {
        const hasDouble = Number(myProfile.doubleSpears || 0) > 0;
        doubleButton.classList.toggle('broken', !hasDouble);
        if (!hasDouble) {
            isDoubleSpearActive = false;
            doubleButton.classList.remove('active');
        }
    }
    updateShopUI();
}

function updateShopUI() {
    const score = Number(myStats.score || 0);
    const doubleCount = Math.max(0, Number(myProfile.doubleSpears || 0));
    if (shopScoreText) shopScoreText.innerText = String(score);
    if (shopSuperMaxText) shopSuperMaxText.innerText = `Narx: ${SUPER_BUY_COST} ball`;
    if (shopDoubleMaxText) shopDoubleMaxText.innerText = `Soni: ${doubleCount}`;
    if (shopWallMaxText) shopWallMaxText.innerText = `Soni: ${Math.max(0, Number(myProfile.walls || 0))}`;
    if (btnBuySuper) btnBuySuper.disabled = score < SUPER_BUY_COST;
    if (btnBuyDouble) btnBuyDouble.disabled = score < DOUBLE_BUY_COST;
    if (btnBuyWall) btnBuyWall.disabled = score < WALL_BUY_COST;
}

function getWallPlacementLimits() {
    const leftModel = modelForPlayer(0) || p1Model;
    const rightModel = modelForPlayer(1) || p2Model;
    const leftX = Math.min(leftModel.position.x, rightModel.position.x);
    const rightX = Math.max(leftModel.position.x, rightModel.position.x);
    return { minX: leftX + 120, maxX: rightX - 120 };
}

function ensureWallMesh(ownerIndex) {
    const wall = wallStates[ownerIndex];
    if (!wall || wall.mesh) return wall;
    const width = 280;
    const height = 460;
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshLambertMaterial({
            map: devorTusiqTexture,
            transparent: true,
            alphaTest: 0.015,
            opacity: 0.98,
            side: THREE.DoubleSide
        })
    );
    mesh.visible = false;
    mesh.userData.wallOwnerIndex = ownerIndex;
    mesh.userData.wallWidth = width;
    mesh.userData.wallHeight = height;
    if (mesh.material && mesh.material.map) {
        mesh.material.map.minFilter = THREE.LinearMipmapLinearFilter;
        mesh.material.map.magFilter = THREE.LinearFilter;
        mesh.material.map.generateMipmaps = true;
        mesh.material.map.anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 8);
    }
    mesh.position.set(0, ground.position.y + 230, ownerIndex === 0 ? 8 : -8);
    scene.add(mesh);
    wall.mesh = mesh;
    return wall;
}

function setWallState(ownerIndex, active, x = 0, hp = 0) {
    const wall = ensureWallMesh(ownerIndex);
    if (!wall) return;
    wall.active = !!active;
    wall.x = Number(x || 0);
    wall.hp = Math.max(0, Number(hp || 0));
    if (wall.mesh) {
        wall.mesh.visible = wall.active;
        wall.mesh.position.x = wall.x;
        wall.mesh.position.y = ground.position.y + 230;
    }
}

function removeWall(ownerIndex) {
    setWallState(ownerIndex, false, 0, 0);
}

function clampWallX(x) {
    const { minX, maxX } = getWallPlacementLimits();
    return Math.max(minX, Math.min(maxX, x));
}

function pointerToWorldPos(e) {
    const p = getPointerPos(e);
    const nx = (p.x / Math.max(1, window.innerWidth)) - 0.5;
    const ny = 0.5 - (p.y / Math.max(1, window.innerHeight));
    const worldWidth = (camera.right - camera.left) / Math.max(0.0001, camera.zoom);
    const worldHeight = (camera.top - camera.bottom) / Math.max(0.0001, camera.zoom);
    return {
        x: camera.position.x + nx * worldWidth,
        y: camera.position.y + ny * worldHeight
    };
}

function isPointerOnMyWall(e) {
    if (myPlayerIndex < 0) return false;
    const myWall = wallStates[myPlayerIndex];
    if (!myWall || !myWall.active || !myWall.mesh || !myWall.mesh.visible) return false;
    const pos = pointerToWorldPos(e);
    const halfW = Number(myWall.mesh.userData.wallWidth || 250) / 2;
    const halfH = Number(myWall.mesh.userData.wallHeight || 380) / 2;
    return (
        Math.abs(pos.x - myWall.mesh.position.x) <= halfW &&
        Math.abs(pos.y - myWall.mesh.position.y) <= halfH
    );
}

function setDefenseActive(active, shouldEmit = true) {
    myDefenseActive = active;
    if (shieldButton) shieldButton.classList.toggle('active', active);
    if (active) triggerAbilityPulse(shieldButton);
    if (myPlayerIndex >= 0 && !isDragging) setSoldierVisual(modelForPlayer(myPlayerIndex), active ? 'defend' : 'idle');
    if (gameMode === 'multi' && shouldEmit) socket.emit('defenseState', { active });
}

function triggerAbilityPulse(btn) {
    if (!btn) return;
    btn.classList.remove('cooldown-pulse');
    void btn.offsetWidth;
    btn.classList.add('cooldown-pulse');
    setTimeout(() => btn.classList.remove('cooldown-pulse'), 360);
}

function setDuckActive(active, shouldEmit = true) {
    myDuckActive = !!active;
    if (duckButton) duckButton.classList.toggle('active', myDuckActive);
    if (myPlayerIndex >= 0 && !isDragging) {
        setSoldierVisual(modelForPlayer(myPlayerIndex), myDefenseActive ? 'defend' : 'idle');
    }
    if (gameMode === 'multi' && shouldEmit) socket.emit('duckState', { active: myDuckActive });
}

function createDuckHeadPngDataUrl() {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.clearRect(0, 0, 96, 96);
    const skin = ctx.createLinearGradient(0, 22, 0, 84);
    skin.addColorStop(0, '#f8fafc');
    skin.addColorStop(1, '#dbeafe');
    const helm = ctx.createLinearGradient(0, 8, 0, 46);
    helm.addColorStop(0, '#fbbf24');
    helm.addColorStop(1, '#b45309');
    const visor = ctx.createLinearGradient(0, 22, 0, 46);
    visor.addColorStop(0, '#334155');
    visor.addColorStop(1, '#0f172a');

    // Neck/shoulder base.
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.roundRect(24, 54, 48, 30, 14);
    ctx.fill();

    // Head.
    ctx.beginPath();
    ctx.arc(48, 37, 19, 0, Math.PI * 2);
    ctx.fillStyle = skin;
    ctx.fill();

    // Helmet dome.
    ctx.beginPath();
    ctx.arc(48, 30, 22, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = helm;
    ctx.fill();

    // Helmet side flaps.
    ctx.fillStyle = '#92400e';
    ctx.beginPath();
    ctx.roundRect(26, 31, 7, 18, 4);
    ctx.roundRect(63, 31, 7, 18, 4);
    ctx.fill();

    // Visor stripe.
    ctx.beginPath();
    ctx.roundRect(32, 26, 32, 8, 4);
    ctx.fillStyle = visor;
    ctx.fill();

    // Eyes.
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.arc(41, 38, 2.6, 0, Math.PI * 2);
    ctx.arc(55, 38, 2.6, 0, Math.PI * 2);
    ctx.fill();

    // Mouth.
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(48, 45, 6.5, 0.15, Math.PI - 0.15);
    ctx.stroke();

    // Helmet shine.
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(43, 24, 7, Math.PI * 1.1, Math.PI * 1.8);
    ctx.stroke();
    return canvas.toDataURL('image/png');
}

function setModelActionState(model, state, durationMs = 700) {
    if (!model || !model.userData) return;
    model.userData.forceState = state;
    model.userData.forceStateUntil = performance.now() + durationMs;
    setSoldierVisual(model, state);
}

const GRAVITY = 700;
let lastTime = performance.now();

// Cinematic Camera
let cameraState = 'static'; 
let cameraTargetX = 0;
let cameraTargetY = 0;
let cameraZoomTarget = 1;
let screenShake = 0;
let cinematicSlowUntil = 0;
const SUPER_CINEMATIC_MS = 8000;
let superClashVisual = null;
let superInterceptCinematic = null;

function clearSuperClashVisual() {
    if (!superClashVisual) return;
    scene.remove(superClashVisual);
    superClashVisual.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
    });
    superClashVisual = null;
}

function spawnSuperClashVisual(x, y) {
    clearSuperClashVisual();
    const g = new THREE.Group();
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 0.75 });
    const tipMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.9, roughness: 0.2 });
    const shaftA = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 92), shaftMat);
    shaftA.rotation.z = Math.PI / 2.6;
    const shaftB = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 92), shaftMat.clone());
    shaftB.rotation.z = -Math.PI / 2.6;
    const tipA = new THREE.Mesh(new THREE.ConeGeometry(4.2, 16, 8), tipMat);
    tipA.position.set(34, 20, 0);
    tipA.rotation.z = -Math.PI / 4;
    const tipB = new THREE.Mesh(new THREE.ConeGeometry(4.2, 16, 8), tipMat.clone());
    tipB.position.set(34, -20, 0);
    tipB.rotation.z = Math.PI / 4;
    g.add(shaftA, shaftB, tipA, tipB);
    g.position.set(x, y, 8);
    scene.add(g);
    superClashVisual = g;
    setTimeout(() => clearSuperClashVisual(), 1200);
}

function createSuperCinematicSpear() {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(1.9, 1.9, 74),
        new THREE.MeshStandardMaterial({ color: 0x8b5a34, roughness: 0.82 })
    );
    shaft.rotation.z = Math.PI / 2;
    const tip = new THREE.Mesh(
        new THREE.ConeGeometry(3.8, 16, 8),
        new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.9, roughness: 0.2 })
    );
    tip.position.x = 42;
    tip.rotation.z = -Math.PI / 2;
    g.add(shaft, tip);
    return g;
}

function clearSuperInterceptCinematic() {
    if (!superInterceptCinematic) return;
    if (superInterceptCinematic.playerSpear) scene.remove(superInterceptCinematic.playerSpear);
    if (superInterceptCinematic.enemySpear) scene.remove(superInterceptCinematic.enemySpear);
    superInterceptCinematic = null;
}

function startSuperInterceptCinematic(hitX, hitY, byPlayerIndex) {
    clearSuperInterceptCinematic();
    const now = performance.now();
    const defender = modelForPlayer(typeof byPlayerIndex === 'number' ? byPlayerIndex : myPlayerIndex) || p1Model;
    const startX = defender.position.x + (hitX >= defender.position.x ? 120 : -120);
    const startY = defender.position.y + 165;

    const playerSpear = createSuperCinematicSpear();
    const enemySpear = createSuperCinematicSpear();
    playerSpear.position.set(startX, startY, 10);
    const phase = ((Math.abs(hitX) * 0.01) + (Math.abs(hitY) * 0.013) + (Number(byPlayerIndex || 0) * 0.37));
    const sideSign = Math.sin(phase) >= 0 ? 1 : -1;
    enemySpear.position.set(hitX + sideSign * 8, hitY + 8, 8);
    playerSpear.rotation.z = Math.atan2(hitY - startY, hitX - startX);
    enemySpear.rotation.z = playerSpear.rotation.z + Math.PI * 0.92;
    scene.add(playerSpear);
    scene.add(enemySpear);

    superInterceptCinematic = {
        startMs: now,
        durationMs: SUPER_CINEMATIC_MS,
        hitMs: 2600,
        startX,
        startY,
        hitX,
        hitY,
        playerSpear,
        enemySpear,
        collided: false,
        enemyVx: sideSign * (2.8 + ((Math.cos(phase) + 1) * 0.6)),
        enemyVy: 90
    };
}

function updateSuperInterceptCinematic(now, dt) {
    if (!superInterceptCinematic) return;
    const seq = superInterceptCinematic;
    const elapsed = now - seq.startMs;
    if (elapsed >= seq.durationMs) {
        clearSuperInterceptCinematic();
        resetCameraAfterImpact();
        return;
    }

    cameraState = 'intercept';

    if (elapsed < seq.hitMs) {
        const t = elapsed / seq.hitMs;
        const ease = 1 - Math.pow(1 - t, 2);
        const x = seq.startX + (seq.hitX - seq.startX) * ease;
        const y = seq.startY + (seq.hitY - seq.startY) * ease;
        seq.playerSpear.position.set(x, y, 10);
        seq.playerSpear.rotation.z = Math.atan2(seq.hitY - y, seq.hitX - x);

        cameraTargetX = x;
        cameraTargetY = y + 40;
        cameraZoomTarget = baseZoom * 2.35;
        return;
    }

    if (!seq.collided) {
        seq.collided = true;
        spawnSuperClashVisual(seq.hitX, seq.hitY + 12);
        spawnParticles(seq.hitX, seq.hitY, 60, true);
        screenShake = Math.max(screenShake, 0.22);
        scene.remove(seq.playerSpear);
    }

    const groundY = ground.position.y + 85;
    if (seq.enemySpear.position.y > groundY) {
        seq.enemySpear.position.x += seq.enemyVx * dt * 26;
        seq.enemySpear.position.y += seq.enemyVy * dt;
        seq.enemyVy -= GRAVITY * dt * 0.6;
        seq.enemySpear.rotation.z += 2.5 * dt;
    } else {
        seq.enemySpear.position.y = groundY;
        seq.enemyVy = 0;
        seq.enemyVx *= 0.96;
        seq.enemySpear.rotation.z *= 0.985;
    }

    cameraTargetX = seq.enemySpear.position.x;
    cameraTargetY = seq.enemySpear.position.y + 35;
    cameraZoomTarget = baseZoom * 2.0;
}

function resetCameraAfterImpact() {
    cameraState = 'recover';
    if (gameMode === 'multi' && currentTurnIndex >= 0) {
        const activeModel = modelForPlayer(currentTurnIndex);
        cameraTargetX = activeModel ? activeModel.position.x : 0;
    } else {
        cameraTargetX = 0;
    }
    cameraTargetY = 0;
    cameraZoomTarget = gameMode === 'multi' ? baseZoom * 1.08 : baseZoom;
}

updateCameraBounds();

let isDragging = false;
let dragStart = { x: 0, y: 0 };
let dragCurrent = { x: 0, y: 0 };
let aimSfxPlayed = false;

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
        screenShake = MOBILE_PERF_MODE ? 16 : 30; 
    } else if(isShield) {
        el.style.color = '#38bdf8';
        screenShake = MOBILE_PERF_MODE ? 9 : 15;
    } else {
        screenShake = MOBILE_PERF_MODE ? 7 : 10; 
    }
    damageContainer.appendChild(el);
    setTimeout(() => el.remove(), 1500);
}

function showCenterNotice(text) {
    const el = document.createElement('div');
    el.className = 'damage-text';
    el.innerText = text;
    el.style.left = '50%';
    el.style.top = '48%';
    el.style.transform = 'translate(-50%, -50%)';
    el.style.textAlign = 'center';
    el.style.maxWidth = '86vw';
    el.style.padding = '8px 12px';
    el.style.background = 'rgba(15, 23, 42, 0.78)';
    el.style.borderRadius = '10px';
    el.style.color = '#38bdf8';
    damageContainer.appendChild(el);
    setTimeout(() => el.remove(), 1800);
}

function hideFlyingSpear() {
    spearGroup.visible = false;
    spearGroup.children.slice().forEach((child) => {
        if (child.userData && child.userData.tempCrow) spearGroup.remove(child);
    });
    secondarySpearGroup.visible = false;
}

function stickSpear(targetModel, hitX, hitY, angle) {
    const stuckSpear = spearGroup.clone();
    stuckSpear.visible = true;
    stuckSpear.rotation.z = angle;
    stuckSpear.children.slice().forEach((child) => {
        if (child.userData && child.userData.tempCrow) stuckSpear.remove(child);
    });

    if (targetModel) {
        stuckSpear.position.set(hitX, hitY, 0);
        scene.add(stuckSpear);
        targetModel.attach(stuckSpear);
    } else {
        stuckSpear.position.set(hitX, hitY, 0);
        scene.add(stuckSpear);
    }
}

function knockDownModel(model) {
    if (!model || model.userData.isKnockedDown) return;

    model.userData.isKnockedDown = true;
    if (model.userData.isOttomanArcher) {
        setSoldierVisual(model, 'hurt');
        setTimeout(() => {
            model.userData.isKnockedDown = false;
            setSoldierVisual(model, 'idle');
        }, 900);
        return;
    }
    const originalY = model.position.y;
    const direction = model.position.x > 0 ? -1 : 1;
    model.rotation.z = direction * Math.PI / 2;
    model.position.y = ground.position.y + 115;

    setTimeout(() => {
        model.rotation.z = 0;
        model.position.y = originalY;
        model.userData.isKnockedDown = false;
    }, 1500);
}

function breakShield(model) {
    model.userData.shieldBroken = true;
    if (model.userData.shieldGroup) model.userData.shieldGroup.visible = false;
    setSoldierVisual(model, 'break');
    spawnParticles(model.position.x, model.position.y + 30, 30, true);
    playShieldBreak();
    setTimeout(() => {
        setSoldierVisual(model, isDefenseActiveForPlayer(model === p1Model ? 0 : 1) ? 'defend' : 'idle');
    }, 700);
}

// Input Handlers
function handleStart(e) {
    const target = e && e.target;
    const hasClosest = target && typeof target.closest === 'function';
    if (hasClosest && (target.closest('button') || target.closest('#chat-container') || target.closest('#in-game-modal'))) return;
    if (isAnimating || currentTurnIndex !== myPlayerIndex || gameMode === 'menu' || isPaused) return;
    if (gameMode === 'single' && singleShotLocked) return;
    if (isPointerOnMyWall(e)) {
        isWallPlacementMode = true;
        isWallDragActive = true;
        updateSuperUI();
        return;
    }
    isDragging = true;
    aimSfxPlayed = false;
    dragStart = getPointerPos(e);
    dragCurrent = { ...dragStart };
}

function handleMove(e) {
    if (!isDragging) return;
    dragCurrent = getPointerPos(e);
}

function handleEnd(e) {
    isWallDragActive = false;
    if (!isDragging) return;
    isDragging = false;
    aimSfxPlayed = false;
    
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

const isUiTarget = (target) => {
    if (!target || typeof target.closest !== 'function') return false;
    return !!(target.closest('button') || target.closest('#chat-container') || target.closest('#in-game-modal'));
};

function pointerToWorldX(e) {
    return pointerToWorldPos(e).x;
}

if (window.PointerEvent) {
    let dragPointerId = null;
    document.addEventListener('pointerdown', (e) => {
        if (isUiTarget(e.target)) return;
        dragPointerId = e.pointerId;
        handleStart(e);
    });
    document.addEventListener('pointermove', (e) => {
        if (isWallPlacementMode && isWallDragActive) {
            const myWall = wallStates[myPlayerIndex];
            if (myWall && myWall.active) {
                const x = clampWallX(pointerToWorldX(e));
                setWallState(myPlayerIndex, true, x, myWall.hp || WALL_HP_MAX);
                if (gameMode === 'multi') socket.emit('wallMoved', { ownerIndex: myPlayerIndex, x });
            }
        }
        if (!isDragging) return;
        if (dragPointerId !== null && e.pointerId !== dragPointerId) return;
        handleMove(e);
    });
    document.addEventListener('pointerup', (e) => {
        isWallDragActive = false;
        if (!isDragging) return;
        if (dragPointerId !== null && e.pointerId !== dragPointerId) return;
        dragPointerId = null;
        handleEnd(e);
    });
    document.addEventListener('pointercancel', (e) => {
        isWallDragActive = false;
        if (!isDragging) return;
        if (dragPointerId !== null && e.pointerId !== dragPointerId) return;
        dragPointerId = null;
        handleEnd(e);
    });
} else {
    document.addEventListener('mousedown', handleStart);
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mousemove', (e) => {
        if (isWallPlacementMode && isWallDragActive) {
            const myWall = wallStates[myPlayerIndex];
            if (myWall && myWall.active) {
                const x = clampWallX(pointerToWorldX(e));
                setWallState(myPlayerIndex, true, x, myWall.hp || WALL_HP_MAX);
                if (gameMode === 'multi') socket.emit('wallMoved', { ownerIndex: myPlayerIndex, x });
            }
        }
    });
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchstart', (e) => { 
        if(!isUiTarget(e.target) && e.touches && e.touches[0]) { 
            handleStart(e.touches[0]); 
        } 
    }, {passive: false});
    document.addEventListener('touchmove', (e) => { 
        if (isWallPlacementMode && isWallDragActive && e.touches && e.touches[0]) {
            const myWall = wallStates[myPlayerIndex];
            if (myWall && myWall.active) {
                const x = clampWallX(pointerToWorldX(e.touches[0]));
                setWallState(myPlayerIndex, true, x, myWall.hp || WALL_HP_MAX);
                if (gameMode === 'multi') socket.emit('wallMoved', { ownerIndex: myPlayerIndex, x });
            }
        }
        if (isDragging && e.touches && e.touches[0]) {
            handleMove(e.touches[0]); 
        }
    }, {passive: false});
    document.addEventListener('touchend', (e) => { 
        isWallDragActive = false;
        if (isDragging) {
            handleEnd(e); 
        }
    }, {passive: false});
}

if (shieldButton) {
    const pressShield = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (gameMode === 'menu' || myPlayerIndex < 0) return;
        playSfx('shieldPress');
        setDefenseActive(true);
    };
    const releaseShield = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        setDefenseActive(false);
    };

    if (window.PointerEvent) {
        shieldButton.addEventListener('pointerdown', pressShield);
        shieldButton.addEventListener('pointerup', releaseShield);
        shieldButton.addEventListener('pointercancel', releaseShield);
        shieldButton.addEventListener('pointerleave', releaseShield);
    } else {
        shieldButton.addEventListener('mousedown', pressShield);
        shieldButton.addEventListener('touchstart', pressShield, { passive: false });
        shieldButton.addEventListener('mouseup', releaseShield);
        shieldButton.addEventListener('mouseleave', releaseShield);
        shieldButton.addEventListener('touchend', releaseShield, { passive: false });
        shieldButton.addEventListener('touchcancel', releaseShield, { passive: false });
    }
}

if (superButton) {
    const pressSuper = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (mySuper <= 0) return;
        superButton.classList.add('active');
        const used = tryUseSuperPower();
        if (!used) showSuperUseWarning();
    };
    const releaseSuper = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        superButton.classList.remove('active');
    };
    if (window.PointerEvent) {
        superButton.addEventListener('pointerdown', pressSuper);
        superButton.addEventListener('pointerup', releaseSuper);
        superButton.addEventListener('pointercancel', releaseSuper);
        superButton.addEventListener('pointerleave', releaseSuper);
    } else {
        superButton.addEventListener('mousedown', pressSuper);
        superButton.addEventListener('touchstart', pressSuper, { passive: false });
        superButton.addEventListener('touchend', releaseSuper, { passive: false });
    }
}

if (crowButton) {
    const pressCrow = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (myCrow <= 0) return;
        crowButton.classList.add('active');
        shootCrowKillerArrow();
    };
    const releaseCrow = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        crowButton.classList.remove('active');
    };
    if (window.PointerEvent) {
        crowButton.addEventListener('pointerdown', pressCrow);
        crowButton.addEventListener('pointerup', releaseCrow);
        crowButton.addEventListener('pointercancel', releaseCrow);
        crowButton.addEventListener('pointerleave', releaseCrow);
    } else {
        crowButton.addEventListener('mousedown', pressCrow);
        crowButton.addEventListener('mouseup', releaseCrow);
        crowButton.addEventListener('touchstart', pressCrow, { passive: false });
        crowButton.addEventListener('touchend', releaseCrow, { passive: false });
    }
}

if (duckButton) {
    const duckIcon = createDuckHeadPngDataUrl();
    if (duckIcon) {
        duckButton.innerHTML = `<img src="${duckIcon}" alt="Boshni egish" class="duck-icon">`;
    }
    const pressDuck = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        setDuckActive(true);
        triggerAbilityPulse(duckButton);
    };
    const releaseDuck = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        setDuckActive(false);
    };
    if (window.PointerEvent) {
        duckButton.addEventListener('pointerdown', pressDuck);
        duckButton.addEventListener('pointerup', releaseDuck);
        duckButton.addEventListener('pointercancel', releaseDuck);
        duckButton.addEventListener('pointerleave', releaseDuck);
        document.addEventListener('pointerup', releaseDuck);
    } else {
        duckButton.addEventListener('mousedown', pressDuck);
        duckButton.addEventListener('mouseup', releaseDuck);
        duckButton.addEventListener('mouseleave', releaseDuck);
        duckButton.addEventListener('touchstart', pressDuck, { passive: false });
        duckButton.addEventListener('touchend', releaseDuck, { passive: false });
        duckButton.addEventListener('touchcancel', releaseDuck, { passive: false });
        document.addEventListener('touchend', releaseDuck, { passive: false });
    }
}

if (doubleButton) {
    const toggleDouble = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (Number(myProfile.doubleSpears || 0) <= 0) return;
        isDoubleSpearActive = !isDoubleSpearActive;
        doubleButton.classList.toggle('active', isDoubleSpearActive);
        if (isDoubleSpearActive) triggerAbilityPulse(doubleButton);
    };
    doubleButton.addEventListener('click', toggleDouble);
}

function deployOrRepositionWall() {
    if (gameMode === 'menu' || myPlayerIndex < 0) return;
    if (currentTurnIndex !== myPlayerIndex) return;
    const existing = wallStates[myPlayerIndex];
    if (existing && existing.active) {
        isWallPlacementMode = !isWallPlacementMode;
        isWallDragActive = false;
        updateSuperUI();
        return;
    }
    const stock = Math.max(0, Number(myProfile.walls || 0));
    if (stock <= 0) return;
    myProfile.walls = stock - 1;
    saveProfile();
    const myModel = modelForPlayer(myPlayerIndex);
    const enemyModel = modelForPlayer(getPrimaryEnemyTurnIndex());
    const myX = Number(myModel?.position.x || 0);
    const enemyX = Number(enemyModel?.position.x || 0);
    const towardEnemy = enemyX >= myX ? 1 : -1;
    // Spawn wall close to player's fighter so it stays visible and easy to drag.
    const nearPlayerX = myX + towardEnemy * 220;
    const x = clampWallX(nearPlayerX);
    setWallState(myPlayerIndex, true, x, WALL_HP_MAX);
    isWallPlacementMode = true;
    isWallDragActive = false;
    updateSuperUI();
    if (gameMode === 'multi') socket.emit('wallPlaced', { ownerIndex: myPlayerIndex, x, hp: WALL_HP_MAX });
}

if (wallButton) {
    wallButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        deployOrRepositionWall();
    });
}

function showSuperUseWarning() {
    const now = performance.now();
    if (now < superWarningUntil) return;
    superWarningUntil = now + 1400;
    showCenterNotice("Super kuch faqat raqib o'q otganda ishlaydi!");
}

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
    isPaused = false;
    isDragging = false;
    isWallPlacementMode = false;
    isWallDragActive = false;
    singleShotLocked = false;
    setDefenseActive(false, false);
    setDuckActive(false, false);
    enemyDuckActive = false;
    currentOpponentProfile = null;
    const pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) pauseBtn.innerText = (translations[myProfile.lang] || translations.uz).pause;
    
    const level = Math.max(1, singleCampaignLevel);
    campaignConfig = getCampaignConfig(level);
    currentBattleDistance = campaignConfig.distance;
    aiHitAccumulator = 0;
    enemyVolleyQueue = [];

    const randomMaps = ['field', 'castle', 'desert', 'winter'];
    const randomWeathers = ['sunny', 'night', 'rain', 'storm', 'snow'];
    const autoMap = randomMaps[Math.floor(Math.random() * randomMaps.length)];
    const autoWeather = randomWeathers[Math.floor(Math.random() * randomWeathers.length)];
    buildMap(autoMap, autoWeather);
    clouds = [];
    const effectiveBirds = opts.birds !== false;
    spawnEntities({ ...opts, birds: effectiveBirds, birdCount: effectiveBirds ? campaignConfig.birds : 0 });
    
    scene.remove(p1Model);
    scene.remove(p2Model);
    if (p3Model) {
        scene.remove(p3Model);
        p3Model = null;
    }
    const playerLeftSide = (level % 2 === 1);
    const myChar = myProfile.charType || 2;
    const enemyChar = 2;
    const p1Char = playerLeftSide ? myChar : enemyChar;
    const p2Char = playerLeftSide ? enemyChar : myChar;
    p1Model = createSoldier(true, p1Char); p1Model.position.x = pos1X;
    p2Model = createSoldier(false, p2Char); p2Model.position.x = pos2X;
    if (campaignConfig.enemyCount === 2) {
        p3Model = createSoldier(false, enemyChar);
    }
    if (playerLeftSide) {
        myPlayerIndex = 0;
        p1Model.position.x = -currentBattleDistance / 2;
        p2Model.position.x = currentBattleDistance / 2;
        if (p3Model) p3Model.position.x = currentBattleDistance / 2 + pos3Offset;
    } else {
        myPlayerIndex = 1;
        p1Model.position.x = -currentBattleDistance / 2;
        p2Model.position.x = currentBattleDistance / 2;
        if (p3Model) p3Model.position.x = -currentBattleDistance / 2 - pos3Offset;
    }
    applySoldierWeatherTone();
    
    myHealth = 100;
    enemyHealth = 100;
    myShield = 5;
    enemyShield = 5;
    mySuper = Math.max(0, Number(myProfile.superPowers || 5));
    enemySuper = Math.max(0, Number(campaignConfig.enemySuperCharges || 1));
    enemyShieldUsesRemaining = Math.max(0, Number(campaignConfig.enemyShieldAutoUses || 0));
    enemySuperUsesRemaining = Math.max(0, Number(campaignConfig.enemySuperAutoUses || 0));
    enemyShieldAutoUsedThisFlight = false;
    myDefenseActive = false;
    enemyDefenseActive = false;
    updateHealthUI();
    updateShieldUI();
    removeWall(0);
    removeWall(1);
    if (campaignConfig && campaignConfig.enemyWallEnabled) {
        const enemyIndex = getPrimaryEnemyTurnIndex();
        const enemyModel = modelForPlayer(enemyIndex);
        const myModel = modelForPlayer(myPlayerIndex);
        if (enemyModel && myModel && (enemyIndex === 0 || enemyIndex === 1)) {
            const towardPlayer = myModel.position.x >= enemyModel.position.x ? 1 : -1;
            const enemyWallX = clampWallX(enemyModel.position.x + towardPlayer * 230);
            setWallState(enemyIndex, true, enemyWallX, WALL_HP_MAX);
        }
    }
    updateSuperUI();

    if (myPlayerIndex === 0) {
        p1Name.innerText = myProfile.name;
        document.getElementById('p1-flag').innerText = myProfile.flag;
        p2Name.innerText = (translations[myProfile.lang].singleBtn.includes("Kompyuter") ? "Kompyuter" : "PC") + ` (Lv.${level})`;
        document.getElementById('p2-flag').innerText = "🤖";
    } else {
        p2Name.innerText = myProfile.name;
        document.getElementById('p2-flag').innerText = myProfile.flag;
        p1Name.innerText = (translations[myProfile.lang].singleBtn.includes("Kompyuter") ? "Kompyuter" : "PC") + ` (Lv.${level})`;
        document.getElementById('p1-flag').innerText = "🤖";
    }
    prevTurnIndex = -2;
    updateCampaignUI();
    updateTurn(myPlayerIndex, generateWind());
    if(!isLooping) {
        isLooping = true;
        lastTime = performance.now();
        requestAnimationFrame(gameLoop);
    }
}

function generateWind() {
    return parseFloat((Math.random() * 30 - 15).toFixed(2));
}

function getPrimaryEnemyTurnIndex() {
    return myPlayerIndex === 0 ? 1 : 0;
}

function playAITurn() {
    const enemyTurnIndex = getPrimaryEnemyTurnIndex();
    if (gameMode !== 'single' || currentTurnIndex !== enemyTurnIndex || isAnimating) return;
    const profile = aiProfiles[aiDifficulty] || aiProfiles.normal;
    const cfg = campaignConfig || getCampaignConfig(singleCampaignLevel);
    enemyVolleyQueue = getEnemyIndices();

    setTimeout(() => fireEnemyVolleyShot(), 900);
}

function shouldAiHit() {
    const cfg = campaignConfig || getCampaignConfig(singleCampaignLevel);
    aiHitAccumulator += cfg.hitRate;
    if (aiHitAccumulator >= 1) {
        aiHitAccumulator -= 1;
        return true;
    }
    return false;
}

function fireEnemyVolleyShot() {
    if (gameMode !== 'single' || currentTurnIndex !== getPrimaryEnemyTurnIndex() || isAnimating) return;
    const shooterIndex = enemyVolleyQueue.shift();
    if (shooterIndex === undefined) return;
    const shooter = modelForPlayer(shooterIndex);
    if (!shooter) return;

    const profile = aiProfiles[aiDifficulty] || aiProfiles.normal;
    const cfg = campaignConfig || getCampaignConfig(singleCampaignLevel);
    const shouldHit = shouldAiHit();
    
    // AI asosan o'yinchiga nishonlaydi (90%), tasodifan qushlarni o'ldiradi (10%)
    const targetBird = cfg.birdTargetChance > 0 && Math.random() < cfg.birdTargetChance;
    let targetIndex, targetX, targetY;
    
    if (targetBird && entities.length > 0) {
        // Qushni nishonlash
        const birds = entities.filter(e => e.type === 'bird' && e.alive);
        if (birds.length > 0) {
            const targetBirdEntity = birds[Math.floor(Math.random() * birds.length)];
            targetX = targetBirdEntity.mesh.position.x;
            targetY = targetBirdEntity.mesh.position.y;
            // Qush uchun maxsus hisoblash
            const dx = Math.abs(shooter.position.x - targetX);
            const dy = targetY - shooter.position.y;
            const baseAngle = Math.atan2(dy, dx) * 180 / Math.PI;
            const rad = ((Math.abs(baseAngle) + Math.min(10, dx / 300)) * Math.PI) / 180;
            let power = Math.sqrt((dx * dx + dy * dy) * GRAVITY / Math.max(0.2, Math.sin(2 * rad)));
            const desiredDir = shooterIndex === 0 ? 1 : -1;
            const windComp = (-currentWind * desiredDir * (dx / 280));
            power += windComp;
            let angle = baseAngle + (Math.random() - 0.5) * 5;
            angle = Math.max(-20, Math.min(110, angle));
            power = Math.max(700, Math.min(2000, power));
            
            setModelActionState(shooter, 'aim', 900);
            startSpearAnimation(shooterIndex, angle, power);
            return;
        }
    }
    
    // O'yinchiga aniq nishonlash
    targetIndex = myPlayerIndex;
    const targetModel = modelForPlayer(targetIndex);
    
    // computeAccurateShot dan foydalanib aniq trajektoriya hisoblash
    const accurateShot = computeAccurateShot(shooterIndex, targetIndex, 0, 1);
    if (!accurateShot) return;
    
    let angle = accurateShot.angle;
    let power = accurateShot.power;
    
    // aiPrecision ga qarab aniqlikni belgilash
    const precision = cfg.aiPrecision || 0.5;
    
    // Tasodifiy xato - aniqlik qancha yuqori bo'lsa, xato shunchalik kam
    const missChance = 1 - precision;
    const willMiss = Math.random() < missChance;
    
    if (willMiss) {
        // O'tkazib yuborish - kichik offset
        angle += (Math.random() - 0.5) * 8;
        power *= 0.9 + Math.random() * 0.2;
    } else {
        // Aniq tegish - 100% aniqlikda offsetlarsiz, boshqalarda kichik offset
        if (precision >= 1.0) {
            // 100% aniqlik - hech qanday offset, to'g'ridan-to'g'ri markazga
            // angle va power o'zgarishsiz qoladi
        } else {
            // Bosh, tana, oyoq qismlariga tasodifiy offset
            const hitZone = Math.random();
            let yOffset = 0;
            let xOffset = 0;
            
            if (hitZone < 0.3) {
                // Boshga tegish (30%)
                yOffset = 80 + Math.random() * 20;
                xOffset = (Math.random() - 0.5) * 15;
            } else if (hitZone < 0.7) {
                // Tanaga tegish (40%)
                yOffset = 20 + Math.random() * 40;
                xOffset = (Math.random() - 0.5) * 20;
            } else {
                // Oyoqqa tegish (30%)
                yOffset = -30 + Math.random() * 20;
                xOffset = (Math.random() - 0.5) * 25;
            }
            
            // Offsetga qarab kichik tuzatish
            angle += (shooterIndex === 0 ? 1 : -1) * (xOffset / 50);
            power *= 1 + (yOffset / 500);
        }
    }
    
    angle = Math.max(-20, Math.min(110, angle));
    power = Math.max(700, Math.min(2000, power));

    setModelActionState(shooter, 'aim', 900);
    startSpearAnimation(shooterIndex, angle, power);
}

function throwSpear(angle, power) {
    if (gameMode === 'single' && singleShotLocked) return;
    if (gameMode === 'single') singleShotLocked = true;
    pendingDoubleShot = null;
    if (isDoubleSpearActive && Number(myProfile.doubleSpears || 0) > 0) {
        myProfile.doubleSpears = Math.max(0, Number(myProfile.doubleSpears || 0) - 1);
        const shooterIndex = currentTurnIndex;
        const targetIndex = getDoubleShotTargetIndex(shooterIndex);
        const shouldAssistDouble = Math.random() < 0.8;
        if (shouldAssistDouble) {
            const primaryAssisted = computeAccurateShot(shooterIndex, targetIndex, 0, 1);
            const secondaryAssisted = computeAccurateShot(shooterIndex, targetIndex, 4.8, 0.97);
            if (primaryAssisted && secondaryAssisted) {
                angle = primaryAssisted.angle;
                power = primaryAssisted.power;
                pendingDoubleShot = {
                    shooterIndex,
                    angle: secondaryAssisted.angle,
                    power: secondaryAssisted.power,
                    wind: currentWind,
                    forceHit: true,
                    targetIndex
                };
            }
        }
        if (!pendingDoubleShot) {
            pendingDoubleShot = {
                shooterIndex: currentTurnIndex,
                angle: Math.max(-20, Math.min(110, angle + (currentTurnIndex === 0 ? 5.5 : -5.5))),
                power: Math.max(650, power * 0.94),
                wind: currentWind
            };
        }
        saveProfile();
        updateSuperUI();
    }
    if (gameMode === 'multi') {
        socket.emit('throwSpear', { angle, power });
    } else if (gameMode === 'single') {
        if (currentTurnIndex === 0) {
            setModelActionState(p1Model, isDefenseActiveForPlayer(0) ? 'defend' : 'aim', 800);
        } else {
            setModelActionState(p2Model, isDefenseActiveForPlayer(1) ? 'defend' : 'aim', 800);
        }
        startSpearAnimation(currentTurnIndex, angle, power);
    }
}

const CROW_KILLER_CINEMATIC_MS = 4000;
let crowKillerCinematicActive = false;
let crowKillerCinematicUntil = 0;

function shootCrowKillerArrow() {
    if (myCrow <= 0) return;
    myCrow--;
    updateCrowUI();
    
    // Qarg'alarni aniqlash
    const birds = entities.filter(e => e.type === 'bird' && e.alive);
    if (birds.length === 0) return;
    
    // 2/3 qismini urish
    const targetCount = Math.floor(birds.length * 2 / 3);
    const targets = birds.slice(0, targetCount);
    
    // Cinematic effektni yoqish
    crowKillerCinematicActive = true;
    crowKillerCinematicUntil = performance.now() + CROW_KILLER_CINEMATIC_MS;
    cameraState = 'crowKiller';
    cameraZoomTarget = baseZoom * 1.8;
    
    // Har bir qarg'a uchun o'q otish
    const shooterModel = modelForPlayer(myPlayerIndex);
    if (!shooterModel) return;
    
    const startX = shooterModel.position.x;
    const startY = shooterModel.position.y + 50;
    
    targets.forEach((bird, index) => {
        setTimeout(() => {
            const birdMesh = bird.mesh;
            const targetX = birdMesh.position.x;
            const targetY = birdMesh.position.y;
            
            // O'q trayektoriyasini hisoblash
            const dx = targetX - startX;
            const dy = targetY - startY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            const power = Math.min(distance * 2.5, 1800);
            
            // Maxsus o'q otish (dushmanga zarar bermaydi)
            startCrowKillerArrowAnimation(startX, startY, angle, power, bird);
            
            // Camera target ni qarg'aga qaratish
            cameraTargetX = targetX;
            cameraTargetY = targetY;
        }, index * 200); // Har bir o'q 200ms orqali (sekinroq)
    });
    
    if (gameMode === 'multi') {
        socket.emit('crowKillerShot', { count: targetCount });
    }
    
    // Cinematic tugagandan keyin camera ni qaytarish
    setTimeout(() => {
        crowKillerCinematicActive = false;
        cameraState = 'normal';
        cameraZoomTarget = baseZoom;
    }, CROW_KILLER_CINEMATIC_MS);
}

function startCrowKillerArrowAnimation(startX, startY, angle, power, targetBird) {
    const rad = angle * Math.PI / 180;
    const vx = power * Math.cos(rad);
    const vy = power * Math.sin(rad);
    
    // Maxsus o'q yaratish
    const arrow = createCrowKillerArrow();
    arrow.position.set(startX, startY, 0);
    scene.add(arrow);
    
    const arrowData = {
        mesh: arrow,
        x: startX,
        y: startY,
        vx: vx,
        vy: vy,
        targetBird: targetBird,
        isCrowKiller: true,
        active: true
    };
    
    crowKillerArrows.push(arrowData);
}

function createCrowKillerArrow() {
    const group = new THREE.Group();
    
    // O'q tanasi
    const shaftGeo = new THREE.CylinderGeometry(2, 2, 60);
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.rotation.z = -Math.PI / 2;
    group.add(shaft);
    
    // O'q uchi
    const tipGeo = new THREE.ConeGeometry(4, 12, 8);
    const tipMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.set(36, 0, 0);
    tip.rotation.z = -Math.PI / 2;
    group.add(tip);
    
    return group;
}

let crowKillerArrows = [];

function updateCrowKillerArrows() {
    for (let i = crowKillerArrows.length - 1; i >= 0; i--) {
        const arrow = crowKillerArrows[i];
        if (!arrow.active) {
            scene.remove(arrow.mesh);
            crowKillerArrows.splice(i, 1);
            continue;
        }
        
        // Fizika
        arrow.x += arrow.vx * 0.016;
        arrow.y += arrow.vy * 0.016;
        arrow.vy -= 500 * 0.016; // Gravity
        
        arrow.mesh.position.set(arrow.x, arrow.y, 0);
        arrow.mesh.rotation.z = Math.atan2(arrow.vy, arrow.vx);
        
        // Qarg'aga urish tekshiruvi
        if (arrow.targetBird && arrow.targetBird.alive) {
            const birdMesh = arrow.targetBird.mesh;
            const dx = arrow.x - birdMesh.position.x;
            const dy = arrow.y - birdMesh.position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Distance ni oshirish - 30 dan 100 gacha
            if (distance < 100) {
                console.log('Qarg\'aga urildi! Distance:', distance);
                // Qarg'ani urib tushirish
                killBird(arrow.targetBird);
                arrow.active = false;
                scene.remove(arrow.mesh);
                crowKillerArrows.splice(i, 1);
            }
        }
        
        // Yerga tushsa o'chirish
        if (arrow.y < ground.position.y) {
            arrow.active = false;
            scene.remove(arrow.mesh);
            crowKillerArrows.splice(i, 1);
        }
    }
}

function killBird(birdEntity) {
    if (!birdEntity || !birdEntity.alive) return;
    
    birdEntity.alive = false;
    
    // Qarg'ani qirilishi animatsiyasi
    const birdMesh = birdEntity.mesh;
    birdMesh.rotation.z = Math.PI / 2;
    
    // Pastga tushish
    const fallAnimation = () => {
        birdMesh.position.y -= 5;
        if (birdMesh.position.y > ground.position.y) {
            requestAnimationFrame(fallAnimation);
        } else {
            scene.remove(birdMesh);
        }
    };
    fallAnimation();
    
    // Particle effect
    spawnParticles(birdMesh.position.x, birdMesh.position.y, 10, false);
}

function updateCrowUI() {
    if (crowCountText) {
        crowCountText.innerText = myCrow;
    }
}

function performSuperInterceptVisual(hitX, hitY, byPlayerIndex = myPlayerIndex) {
    const x = Number.isFinite(hitX) ? hitX : (spear ? spear.x : 0);
    const y = Number.isFinite(hitY) ? hitY : (spear ? spear.y : 0);
    cinematicSlowUntil = performance.now() + SUPER_CINEMATIC_MS;
    cameraState = 'intercept';
    cameraTargetX = x;
    cameraTargetY = y + 30;
    cameraZoomTarget = baseZoom * 2.25;
    startSuperInterceptCinematic(x, y, byPlayerIndex);
    showDamageText(x, y + 70, "SUPER HIMOYA!", true, true);
}

function celebrateSuperIntercept(playerIndex) {
    const model = modelForPlayer(playerIndex);
    if (!model) return;
    setModelActionState(model, 'celebrate', 3000);
    setTimeout(() => {
        const defend = isDefenseActiveForPlayer(playerIndex);
        setSoldierVisual(model, defend ? 'defend' : 'idle');
    }, 3000);
}

function tryUseSuperPower() {
    if (mySuper <= 0) return false;
    if (!(isAnimating && spear && spear.active)) return false;
    if (spear.playerIndex === myPlayerIndex) return false;

    if (gameMode === 'multi') {
        triggerAbilityPulse(superButton);
        socket.emit('useSuperPower', { hitX: spear.x, hitY: spear.y });
        return true;
    }
    // Single-player local intercept.
    mySuper = Math.max(0, mySuper - 1);
    myProfile.superPowers = mySuper;
    saveProfile();
    updateSuperUI();
    triggerAbilityPulse(superButton);
    const hitX = spear.x;
    const hitY = spear.y;
    spear.active = false;
    hideFlyingSpear();
    isAnimating = false;
    performSuperInterceptVisual(hitX, hitY, myPlayerIndex);
    celebrateSuperIntercept(myPlayerIndex);
    setTimeout(() => {
        updateTurn(currentTurnIndex === 0 ? 1 : 0, generateWind());
    }, SUPER_CINEMATIC_MS);
    return true;
}

function tryEnemyUseSuperPowerSingle() {
    if (gameMode !== 'single') return false;
    if (!campaignConfig) return false;
    if (enemySuper <= 0) return false;
    if (enemySuperUsesRemaining <= 0) return false;
    if (!(isAnimating && spear && spear.active)) return false;
    if (spear.playerIndex !== myPlayerIndex) return false; // enemy only intercepts player's projectile
    if (spear.aiSuperTried) return false;

    const enemyIndices = getEnemyIndices();
    if (!enemyIndices.length) return false;

    const chance = Math.max(0, Math.min(0.9, Number(campaignConfig.enemySuperUseChance || 0)));
    spear.aiSuperTried = true;
    if (Math.random() > chance) return false;

    const byPlayerIndex = enemyIndices[Math.floor(Math.random() * enemyIndices.length)];
    enemySuper = Math.max(0, enemySuper - 1);
    enemySuperUsesRemaining = Math.max(0, enemySuperUsesRemaining - 1);
    playSfx('superPress', 0.95);

    const hitX = spear.x;
    const hitY = spear.y;
    spear.active = false;
    hideFlyingSpear();
    isAnimating = false;
    performSuperInterceptVisual(hitX, hitY, byPlayerIndex);
    celebrateSuperIntercept(byPlayerIndex);
    setTimeout(() => {
        const nextTurn = currentTurnIndex === 0 ? 1 : 0;
        updateTurn(nextTurn, generateWind());
        if (nextTurn === getPrimaryEnemyTurnIndex()) {
            // Small dramatic pause after super cinematic before AI shoots.
            setTimeout(() => playAITurn(), 750);
        }
    }, SUPER_CINEMATIC_MS);
    return true;
}

function tryEnemyUseShieldSingle() {
    if (gameMode !== 'single') return false;
    if (enemyDefenseActive || enemyShield <= 0) return false;
    if (enemyShieldUsesRemaining <= 0) return false;
    if (!isAnimating || !spear || !spear.active) return false;
    if (spear.playerIndex !== myPlayerIndex) return false;

    const enemyTurnIndex = getPrimaryEnemyTurnIndex();
    const enemyModel = modelForPlayer(enemyTurnIndex);
    if (!enemyModel || !enemyModel.userData || enemyModel.userData.shieldBroken) return false;

    const dx = Math.abs(spear.x - enemyModel.position.x);
    const dy = spear.y - enemyModel.position.y;
    if (dx > 430 || dy < -120 || dy > 420) return false;
    if (Math.random() > 0.72) return false;

    enemyDefenseActive = true;
    enemyShieldUsesRemaining = Math.max(0, enemyShieldUsesRemaining - 1);
    playSfx('shieldPress', 0.85);
    setModelActionState(enemyModel, 'defend', 700);
    if (p3Model) setModelActionState(p3Model, 'defend', 700);
    setTimeout(() => {
        enemyDefenseActive = false;
        if (!isAnimating) {
            setSoldierVisual(enemyModel, 'idle');
            if (p3Model) setSoldierVisual(p3Model, 'idle');
        }
    }, 820);
    return true;
}

function advanceSingleTurnAfterShot() {
    const enemyTurnIndex = getPrimaryEnemyTurnIndex();
    if (currentTurnIndex === enemyTurnIndex && enemyVolleyQueue.length > 0) {
        setTimeout(() => fireEnemyVolleyShot(), 550);
        return;
    }
    enemyVolleyQueue = [];
    setTimeout(() => {
        const nextTurn = currentTurnIndex === 0 ? 1 : 0;
        updateTurn(nextTurn, generateWind());
        if (nextTurn === enemyTurnIndex) playAITurn();
    }, 1500);
}

function calculateHitResult(targetIndex, relativeY, isSuicide = false) {
    if (isSuicide) {
        return { damage: 50, msg: "SUIQASD! -50", isCrit: true, hitZone: 'body', isShieldHit: false, shieldActiveBlock: false, shieldlessDefense: false };
    }

    let damage = 25;
    let msg = "-25";
    let isCrit = false;
    let hitZone = 'body';

    const targetModel = modelForPlayer(targetIndex);
    const modelHeight = targetModel?.userData?.planeMesh?.geometry?.parameters?.height || 430;
    const headThreshold = modelHeight * 0.8;
    const legThreshold = modelHeight * 0.34;
    const duckAvoidThreshold = modelHeight * 0.55;

    if (relativeY > headThreshold) {
        damage = 40;
        msg = "BOSHGA! -40";
        isCrit = true;
        hitZone = 'head';
    } else if (relativeY < legThreshold) {
        damage = 15;
        msg = "OYOQQA! -15";
        hitZone = 'leg';
    }

    if (isDuckActiveForPlayer(targetIndex) && relativeY >= duckAvoidThreshold) {
        return { damage: 0, msg: "BOSHNI EGIB QUTULDI!", isCrit: false, hitZone: 'head', isShieldHit: false, shieldActiveBlock: false, shieldlessDefense: false, duckDodged: true };
    }

    const hasShield = shieldForPlayer(targetIndex) > 0 && !targetModel.userData.shieldBroken;
    const defending = isDefenseActiveForPlayer(targetIndex);

    if (hasShield && defending && (hitZone === 'head' || hitZone === 'body')) {
        return { damage: 0, msg: "QALQON, BARAKALLA!", isCrit: false, hitZone, isShieldHit: true, shieldActiveBlock: true, shieldlessDefense: false };
    }

    if (hasShield && hitZone === 'body') {
        return { damage: 5, msg: "QALQONGA TEGDI! -5", isCrit: false, hitZone, isShieldHit: true, shieldActiveBlock: false, shieldlessDefense: false };
    }

    if (!hasShield && defending) {
        const reducedDamage = Math.max(5, Math.round(damage * 0.45));
        return { damage: reducedDamage, msg: `HIMOYA! -${reducedDamage}`, isCrit: false, hitZone, isShieldHit: false, shieldActiveBlock: false, shieldlessDefense: true };
    }

    return { damage, msg, isCrit, hitZone, isShieldHit: false, shieldActiveBlock: false, shieldlessDefense: false };
}

function getScoreDeltaForHit(hitResult) {
    if (!hitResult) return 0;
    if (hitResult.duckDodged) return 0;
    if (hitResult.isShieldHit) return 5;
    if (hitResult.hitZone === 'head') return 20;
    if (hitResult.hitZone === 'leg') return 5;
    return 10; // body (with or without shield)
}

function addScore(delta) {
    if (!Number.isFinite(delta) || delta === 0) return;
    myStats.score = Number(myStats.score || 0) + delta;
    saveStats();
    updateCampaignUI();
    updateShopUI();
    if (authPhone) {
        clearTimeout(addScore.syncTimer);
        addScore.syncTimer = setTimeout(() => {
            submitLeaderboard();
        }, 250);
    }
}

function applyDoubleDamageBoost(hitResult, multiplier = 1) {
    if (!hitResult || multiplier <= 1) return hitResult;
    if (hitResult.isShieldHit || hitResult.duckDodged) return hitResult;
    const boostedDamage = Math.max(1, Math.round((Number(hitResult.damage) || 0) * multiplier));
    const boostedMsg = String(hitResult.msg || '').replace(/-\d+/, `-${boostedDamage}`);
    return { ...hitResult, damage: boostedDamage, msg: boostedMsg };
}

function getDoubleShotTargetIndex(shooterIndex) {
    if (gameMode === 'single') {
        return shooterIndex === myPlayerIndex ? getPrimaryEnemyTurnIndex() : myPlayerIndex;
    }
    return shooterIndex === 0 ? 1 : 0;
}

function computeAccurateShot(shooterIndex, targetIndex, angleOffsetDeg = 0, powerScale = 1) {
    const shooter = modelForPlayer(shooterIndex);
    const target = modelForPlayer(targetIndex);
    if (!shooter || !target) return null;
    const dx = Math.abs(shooter.position.x - target.position.x);
    // Burchakni kamaytirish - 25-35 gradus (oldingi 38-52 o'rniga)
    // Bu trayektoriyani pastroq qiladi, qarg'alarga tegmaydi
    const rad = ((25 + Math.min(10, dx / 300)) * Math.PI) / 180;
    let power = Math.sqrt((dx * GRAVITY) / Math.max(0.2, Math.sin(2 * rad)));
    const desiredDir = shooterIndex === 0 ? 1 : -1;
    const windComp = (-currentWind * desiredDir * (dx / 280));
    power = (power + windComp) * powerScale;
    let angle = (rad * 180) / Math.PI;
    angle += (shooterIndex === 0 ? 1 : -1) * angleOffsetDeg;
    angle = Math.max(-20, Math.min(110, angle));
    power = Math.max(700, Math.min(2000, power));
    return { angle, power };
}

function simulateDoubleSpearHit() {
    if (!pendingDoubleShot) return null;
    const shot = pendingDoubleShot;
    pendingDoubleShot = null;
    const shooter = modelForPlayer(shot.shooterIndex);
    if (!shooter) return null;

    const startX = shot.shooterIndex === 0 ? shooter.position.x + 60 : shooter.position.x - 60;
    const startY = shooter.position.y + 270;
    if (shot.forceHit && Number.isFinite(Number(shot.targetIndex))) {
        const targetIndex = Number(shot.targetIndex);
        const target = modelForPlayer(targetIndex);
        if (target && !target.userData.isKnockedDown) {
            const h = target.userData?.planeMesh?.geometry?.parameters?.height || 430;
            const hitY = target.position.y + h * 0.62;
            const hitX = target.position.x + (shot.shooterIndex === 0 ? -8 : 8);
            const relY = hitY - target.position.y;
            const hit = calculateHitResult(targetIndex, relY, false);
            return {
                targetIndex,
                hitX,
                hitY,
                hitAngle: Math.atan2(hitY - startY, hitX - startX),
                hitResult: hit,
                path: [
                    { x: startX, y: startY },
                    { x: (startX + hitX) * 0.5, y: Math.max(startY, hitY) + 120 },
                    { x: hitX, y: hitY }
                ]
            };
        }
    }
    const rad = shot.angle * (Math.PI / 180);
    let vx = shot.power * Math.cos(rad);
    if (shot.shooterIndex === 1) vx = -vx;
    let vy = shot.power * Math.sin(rad);
    let x = startX;
    let y = startY;
    const dt = 0.028;
    const targets = p3Model ? [p1Model, p2Model, p3Model] : [p1Model, p2Model];
    const path = [{ x: startX, y: startY }];

    for (let i = 0; i < 220; i++) {
        x += vx * dt;
        y += vy * dt;
        path.push({ x, y });
        vy -= GRAVITY * dt;
        vx += ((shot.wind || 0) * 30) * dt;
        if (y <= ground.position.y + 100) {
            return { hitX: x, hitY: y, hitAngle: Math.atan2(vy, vx), hitResult: null, path };
        }
        for (let idx = 0; idx < targets.length; idx++) {
            if (idx === shot.shooterIndex) continue;
            const m = targets[idx];
            if (!m || m.userData.isKnockedDown) continue;
            const h = m.userData?.planeMesh?.geometry?.parameters?.height || 430;
            if (Math.abs(x - m.position.x) < 55 && y > m.position.y + 30 && y < m.position.y + h) {
                const relY = y - m.position.y;
                const hit = calculateHitResult(idx, relY, false);
                return { targetIndex: idx, hitX: x, hitY: y, hitAngle: Math.atan2(vy, vx), hitResult: hit, path };
            }
        }
    }
    return { hitX: x, hitY: y, hitAngle: Math.atan2(vy, vx), hitResult: null, path };
}

function spawnDoubleSpearVisual(doubleOutcome) {
    if (!doubleOutcome || !Array.isArray(doubleOutcome.path) || doubleOutcome.path.length < 2) return;
    const ghost = spearGroup.clone();
    ghost.visible = true;
    scene.add(ghost);
    const path = doubleOutcome.path;
    let idx = 0;
    const tick = () => {
        if (idx >= path.length - 1) {
            scene.remove(ghost);
            return;
        }
        const a = path[idx];
        const b = path[idx + 1];
        ghost.position.set(a.x, a.y, 0);
        ghost.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
        idx += 4;
        requestAnimationFrame(tick);
    };
    tick();
}

function processHit(hitOpponent, targetIndex, hitX, hitY, isSuicide = false) {
    const finalAngle = spearGroup.rotation.z;
    const doubleOutcome = simulateDoubleSpearHit();
    const doubleShotFired = !!doubleOutcome;
    const hasExtraHit = !!(doubleOutcome && doubleOutcome.hitResult);
    if (doubleOutcome) spawnDoubleSpearVisual(doubleOutcome);
    
    if (hitOpponent) {
        const targetModel = targetIndex === 0 ? p1Model : p2Model;
        flashHit(targetModel);
        hideFlyingSpear();
        
        let hitResult;
        
        if (isSuicide) {
            hitResult = calculateHitResult(targetIndex, 0, true);
            spawnParticles(hitX, hitY, 50);
        } else {
            const relativeY = hitY - targetModel.position.y; // For 440 height plane at y=-360, relativeY goes from 50 (feet) to ~350 (head)
            hitResult = calculateHitResult(targetIndex, relativeY, false);
            if (doubleShotFired) hitResult = applyDoubleDamageBoost(hitResult, 2);

            if (hitResult.isShieldHit) {
                spawnParticles(hitX, hitY, 10, true);
            } else if (hitResult.hitZone === 'head') {
                spawnParticles(hitX, hitY, 40);
            } else if (hitResult.hitZone === 'leg') {
                spawnParticles(hitX, hitY, 15);
            } else {
                spawnParticles(hitX, hitY, 25);
            }
        }

        playHitByResult(hitResult);
        showDamageText(hitX, hitY + 80, hitResult.msg, hitResult.isCrit, hitResult.isShieldHit || hitResult.shieldlessDefense);
        if (!isSuicide && spear && spear.playerIndex === myPlayerIndex && targetIndex !== myPlayerIndex) {
            addScore(getScoreDeltaForHit(hitResult));
        }

        if (!hitResult.isShieldHit) {
            knockDownModel(targetModel);
        }

        if (gameMode === 'single') {
            const hitMyself = targetIndex === myPlayerIndex;
            if (hitResult.isShieldHit) {
                setShieldForPlayer(targetIndex, shieldForPlayer(targetIndex) - 1);
                const shieldHealth = shieldForPlayer(targetIndex);
                if (hitResult.damage > 0) {
                    if (hitMyself) myHealth -= hitResult.damage;
                    else enemyHealth -= hitResult.damage;
                    updateHealthUI();
                }
                if (shieldHealth <= 0) breakShield(targetModel);
            } else {
                if (hitMyself) myHealth -= hitResult.damage;
                else enemyHealth -= hitResult.damage;
                updateHealthUI();
            }
            
            if (myHealth <= 0 || enemyHealth <= 0) {
                const winnerIndex = myHealth > 0 ? myPlayerIndex : getPrimaryEnemyTurnIndex();
                setTimeout(() => showGameOver(winnerIndex), 1500);
            } else {
                if (hasExtraHit) {
                    const extraTarget = modelForPlayer(doubleOutcome.targetIndex);
                    const extraMyself = doubleOutcome.targetIndex === myPlayerIndex;
                    const boostedExtraHit = applyDoubleDamageBoost(doubleOutcome.hitResult, 2);
                    playHitByResult(boostedExtraHit);
                    showDamageText(doubleOutcome.hitX, doubleOutcome.hitY + 70, `Qo'sh nayza: ${boostedExtraHit.msg}`, boostedExtraHit.isCrit, boostedExtraHit.isShieldHit);
                    if (spear && spear.playerIndex === myPlayerIndex && doubleOutcome.targetIndex !== myPlayerIndex) {
                        addScore(getScoreDeltaForHit(boostedExtraHit));
                    }
                    if (!boostedExtraHit.isShieldHit && extraTarget) knockDownModel(extraTarget);
                    if (boostedExtraHit.isShieldHit) {
                        setShieldForPlayer(doubleOutcome.targetIndex, shieldForPlayer(doubleOutcome.targetIndex) - 1);
                        if (shieldForPlayer(doubleOutcome.targetIndex) <= 0 && extraTarget) breakShield(extraTarget);
                    }
                    if (boostedExtraHit.damage > 0) {
                        if (extraMyself) myHealth -= boostedExtraHit.damage;
                        else enemyHealth -= boostedExtraHit.damage;
                        updateHealthUI();
                    }
                }
                advanceSingleTurnAfterShot();
            }
        } else {
            const extraNetHit = hasExtraHit ? applyDoubleDamageBoost(doubleOutcome.hitResult, 2) : null;
            socket.emit('throwComplete', {
                hitOpponent: true,
                targetIndex: targetIndex,
                damage: hitResult.damage,
                hitZone: hitResult.hitZone,
                shieldActiveBlock: hitResult.shieldActiveBlock,
                shieldlessDefense: hitResult.shieldlessDefense,
                hitX,
                hitY,
                isShieldHit: hitResult.isShieldHit,
                hitAngle: finalAngle,
                extraHit: hasExtraHit ? {
                    targetIndex: doubleOutcome.targetIndex,
                    damage: extraNetHit.damage,
                    hitZone: extraNetHit.hitZone,
                    shieldActiveBlock: extraNetHit.shieldActiveBlock,
                    shieldlessDefense: extraNetHit.shieldlessDefense,
                    hitX: doubleOutcome.hitX,
                    hitY: doubleOutcome.hitY,
                    isShieldHit: extraNetHit.isShieldHit,
                    hitAngle: doubleOutcome.hitAngle
                } : null
            });
        }
    } else {
        playSfx('ground');
        spawnParticles(hitX, hitY, 10); 
        stickSpear(null, hitX, hitY, finalAngle);
        hideFlyingSpear();
        
        if (gameMode === 'single') {
            if (hasExtraHit) {
                const extraTarget = modelForPlayer(doubleOutcome.targetIndex);
                const extraMyself = doubleOutcome.targetIndex === myPlayerIndex;
                const boostedExtraHit = applyDoubleDamageBoost(doubleOutcome.hitResult, 2);
                playHitByResult(boostedExtraHit);
                showDamageText(doubleOutcome.hitX, doubleOutcome.hitY + 70, `Qo'sh nayza: ${boostedExtraHit.msg}`, boostedExtraHit.isCrit, boostedExtraHit.isShieldHit);
                if (spear && spear.playerIndex === myPlayerIndex && doubleOutcome.targetIndex !== myPlayerIndex) {
                    addScore(getScoreDeltaForHit(boostedExtraHit));
                }
                if (!boostedExtraHit.isShieldHit && extraTarget) knockDownModel(extraTarget);
                if (boostedExtraHit.isShieldHit) {
                    setShieldForPlayer(doubleOutcome.targetIndex, shieldForPlayer(doubleOutcome.targetIndex) - 1);
                    if (shieldForPlayer(doubleOutcome.targetIndex) <= 0 && extraTarget) breakShield(extraTarget);
                }
                if (boostedExtraHit.damage > 0) {
                    if (extraMyself) myHealth -= boostedExtraHit.damage;
                    else enemyHealth -= boostedExtraHit.damage;
                    updateHealthUI();
                }
            }
            advanceSingleTurnAfterShot();
        } else {
            const extraNetHit = hasExtraHit ? applyDoubleDamageBoost(doubleOutcome.hitResult, 2) : null;
            socket.emit('throwComplete', {
                hitOpponent: false,
                hitX,
                hitY,
                hitAngle: finalAngle,
                extraHit: hasExtraHit ? {
                    targetIndex: doubleOutcome.targetIndex,
                    damage: extraNetHit.damage,
                    hitZone: extraNetHit.hitZone,
                    shieldActiveBlock: extraNetHit.shieldActiveBlock,
                    shieldlessDefense: extraNetHit.shieldlessDefense,
                    hitX: doubleOutcome.hitX,
                    hitY: doubleOutcome.hitY,
                    isShieldHit: extraNetHit.isShieldHit,
                    hitAngle: doubleOutcome.hitAngle
                } : null
            });
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
const chatQuickEmojis = document.getElementById('chat-quick-emojis');

inGameMenuBtn.addEventListener('click', () => {
    if (btnAddFriend) {
        const canAddFriend = gameMode === 'multi' && !!(currentOpponentProfile && currentOpponentProfile.playerId);
        btnAddFriend.style.display = canAddFriend ? '' : 'none';
    }
    if (gameMode === 'single') {
        isPaused = true;
    }
    inGameModal.classList.remove('hidden');
});
let unreadMessages = 0;
const chatBadge = document.getElementById('chat-badge');
btnToggleChat.addEventListener('click', () => {
    chatContainer.classList.toggle('hidden');
    if (!chatContainer.classList.contains('hidden')) {
        unreadMessages = 0;
        chatBadge.classList.add('hidden');
    }
});
btnResume.addEventListener('click', () => {
    inGameModal.classList.add('hidden');
    if (gameMode === 'single') {
        isPaused = false;
        lastTime = performance.now();
    }
});

btnToggleSound.addEventListener('click', () => {
    if (soundSettingsPanel) soundSettingsPanel.classList.toggle('hidden');
});

if (musicVolumeInput) {
    musicVolumeInput.addEventListener('input', () => {
        musicVolume = Math.max(0, Math.min(1, parseFloat(musicVolumeInput.value)));
        applyMusicSettings();
        saveMusicSettings();
    });
}

if (musicMuteInput) {
    musicMuteInput.addEventListener('change', () => {
        musicMuted = !!musicMuteInput.checked;
        applyMusicSettings();
        saveMusicSettings();
    });
}

if (sfxVolumeInput) {
    sfxVolumeInput.addEventListener('input', () => {
        sfxVolume = Math.max(0, Math.min(1, parseFloat(sfxVolumeInput.value)));
        saveMusicSettings();
    });
}

if (settingsMusicVolumeInput) {
    settingsMusicVolumeInput.addEventListener('input', () => {
        musicVolume = Math.max(0, Math.min(1, parseFloat(settingsMusicVolumeInput.value)));
        applyMusicSettings();
        saveMusicSettings();
    });
}

if (settingsSfxVolumeInput) {
    settingsSfxVolumeInput.addEventListener('input', () => {
        sfxVolume = Math.max(0, Math.min(1, parseFloat(settingsSfxVolumeInput.value)));
        applyMusicSettings();
        saveMusicSettings();
    });
}

if (settingsMusicTrackSelect) {
    settingsMusicTrackSelect.addEventListener('change', () => {
        selectedMusicTrack = String(settingsMusicTrackSelect.value || 'music.mp3');
        applyMusicSettings();
        saveMusicSettings();
    });
}

if (inGameMusicTrackSelect) {
    inGameMusicTrackSelect.addEventListener('change', () => {
        selectedMusicTrack = String(inGameMusicTrackSelect.value || 'music.mp3');
        applyMusicSettings();
        saveMusicSettings();
    });
}

if (sfxMuteInput) {
    sfxMuteInput.addEventListener('change', () => {
        sfxMuted = !!sfxMuteInput.checked;
        saveMusicSettings();
    });
}

if (btnVolDown) {
    btnVolDown.addEventListener('click', () => {
        musicVolume = Math.max(0, musicVolume - 0.1);
        applyMusicSettings();
        saveMusicSettings();
    });
}
if (btnVolUp) {
    btnVolUp.addEventListener('click', () => {
        musicVolume = Math.min(1, musicVolume + 0.1);
        if (musicVolume > 0) musicMuted = false;
        applyMusicSettings();
        saveMusicSettings();
    });
}
if (btnVolMute) {
    btnVolMute.addEventListener('click', () => {
        musicMuted = !musicMuted;
        applyMusicSettings();
        saveMusicSettings();
    });
}

applyMusicSettings();
if (btnMusicToggle) {
    btnMusicToggle.addEventListener('click', () => {
        musicMuted = !musicMuted;
        applyMusicSettings();
        saveMusicSettings();
    });
}
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
    console.log('gameStart data:', JSON.stringify(data));
    console.log('data.roomName:', data.roomName);
    console.log('typeof data:', typeof data);
    clearRandomWaitTimer();
    gameMode = 'multi';
    waitingScreen.classList.add('hidden');
    multiMenu.classList.add('hidden');
    menuScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    isPaused = false;
    isDragging = false;
    isWallPlacementMode = false;
    isWallDragActive = false;
    setDefenseActive(false, false);
    setDuckActive(false, false);
    chatMessages.innerHTML = '';
    unreadMessages = 0; chatBadge.classList.add('hidden');
    btnToggleChat.classList.remove('hidden');

    // Room name ni saqlash (revansh uchun)
    if (data.roomName) {
        currentRoomName = data.roomName;
        console.log('currentRoomName o\'rnatildi:', currentRoomName);
    } else {
        console.log('roomName kelmadi');
    }

    const opts = data.options || { map: 'field', birds: false, animals: false, weather: 'sunny' };
    buildMap(opts.map, opts.weather || 'sunny');
    spawnEntities(opts);
    
    // Multiplayer rejimida jangchilar orasidagi masofani o'rnatish
    currentBattleDistance = 3600; // Onlayn rejim uchun uzoq masofa
    
    myPlayerIndex = data.playerIndex;
    myDefenseActive = false;
    enemyDefenseActive = false;
    myDuckActive = false;
    enemyDuckActive = false;
    
    scene.remove(p1Model); scene.remove(p2Model);
    const myChar = myProfile.charType || 2;
    const oppChar = (data.opponentProfile && data.opponentProfile.charType) || 2;
    const p1Char = myPlayerIndex === 0 ? myChar : oppChar;
    const p2Char = myPlayerIndex === 1 ? myChar : oppChar;
    p1Model = createSoldier(true, p1Char); p1Model.position.x = pos1X;
    p2Model = createSoldier(false, p2Char); p2Model.position.x = pos2X;
    applySoldierWeatherTone();
    
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
    currentOpponentProfile = data.opponentProfile || null;
    
    myHealth = data.health[myPlayerIndex];
    enemyHealth = data.health[myPlayerIndex === 0 ? 1 : 0];
    myShield = data.shield[myPlayerIndex];
    enemyShield = data.shield[myPlayerIndex === 0 ? 1 : 0];
    mySuper = Array.isArray(data.super) ? (data.super[myPlayerIndex] || 0) : Math.max(0, Number(myProfile.superPowers || 5));
    enemySuper = Array.isArray(data.super) ? (data.super[myPlayerIndex === 0 ? 1 : 0] || 0) : 5;
    updateHealthUI();
    updateShieldUI();
    removeWall(0);
    removeWall(1);
    updateSuperUI();
    prevTurnIndex = -2;
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

socket.on('superState', (data) => {
    if (!data) return;
    if (data.playerIndex === myPlayerIndex) mySuper = data.remaining;
    else enemySuper = data.remaining;
    if (data.playerIndex === myPlayerIndex) {
        myProfile.superPowers = mySuper;
        saveProfile();
    }
    updateSuperUI();
});

socket.on('superIntercept', (data) => {
    const byPlayerIndex = data?.byPlayerIndex;
    const hitX = data?.hitX;
    const hitY = data?.hitY;
    if (spear && spear.active) {
        spear.active = false;
    }
    hideFlyingSpear();
    isAnimating = false;
    performSuperInterceptVisual(hitX, hitY, byPlayerIndex);
    if (typeof byPlayerIndex === 'number') celebrateSuperIntercept(byPlayerIndex);
    if (typeof data?.nextTurn === 'number') {
        setTimeout(() => updateTurn(data.nextTurn, data.wind), SUPER_CINEMATIC_MS);
    }
    if (typeof byPlayerIndex === 'number') {
        if (byPlayerIndex === myPlayerIndex && typeof data?.remaining === 'number') {
            mySuper = data.remaining;
            myProfile.superPowers = mySuper;
            saveProfile();
            updateSuperUI();
        } else if (typeof data?.remaining === 'number') {
            enemySuper = data.remaining;
        }
    }
});

socket.on('spearThrown', (data) => {
    const { playerIndex, angle, power } = data;
    setModelActionState(modelForPlayer(playerIndex), 'aim', 800);
    startSpearAnimation(playerIndex, angle, power);
});

socket.on('groundHit', (data) => {
    if (spear && spear.playerIndex !== myPlayerIndex) {
        stickSpear(null, data.hitX, data.hitY, data.hitAngle);
        hideFlyingSpear();
        playSfx('ground');
    }
});

socket.on('hitRegistered', (data) => {
    const { targetIndex, damage, newHealth, newShield, hitX, hitY, isShieldHit, hitAngle, shieldActiveBlock, shieldlessDefense, shieldBroke, hitZone, duckDodged } = data;
    const targetModel = targetIndex === 0 ? p1Model : p2Model;
    
    if (spear && spear.playerIndex !== myPlayerIndex) {
        flashHit(targetModel);
        hideFlyingSpear();
        
        if (duckDodged) {
            showDamageText(hitX, hitY + 80, "BOSHNI EGIB QUTULDI!", false, true);
        } else if (isShieldHit) {
            spawnParticles(hitX, hitY, 10, true);
            const msg = shieldActiveBlock ? "QALQON, BARAKALLA!" : `QALQONGA TEGDI! -${damage}`;
            showDamageText(hitX, hitY + 80, msg, false, true);
            playSfx(shieldActiveBlock ? 'shieldActive' : 'shieldPassive');
        } else {
            let isCrit = damage >= 40;
            spawnParticles(hitX, hitY, isCrit ? 40 : 20);
            if (hitZone === 'head') playSfx('headHit');
            else if (hitZone === 'leg') playSfx('legHit');
            else playSfx('ground', 0.9);
            let msg = "-" + damage;
            if (isCrit) msg = "BOSHGA! " + msg;
            if (shieldlessDefense) msg = "HIMOYA! " + msg;
            showDamageText(hitX, hitY + 80, msg, isCrit);

            if (damage > 0) knockDownModel(targetModel);
        }
    }
    
    if (targetIndex === myPlayerIndex) {
        myHealth = newHealth; myShield = newShield;
    } else {
        enemyHealth = newHealth; enemyShield = newShield;
    }
    updateShieldUI();
    if ((shieldBroke || newShield <= 0) && !targetModel.userData.shieldBroken) breakShield(targetModel);
    updateHealthUI();
});

socket.on('defenseStateChanged', (data) => {
    if (!data || data.playerIndex === myPlayerIndex) return;
    enemyDefenseActive = data.active;
    setSoldierVisual(modelForPlayer(data.playerIndex), data.active ? 'defend' : 'idle');
});

socket.on('duckStateChanged', (data) => {
    if (!data || data.playerIndex === myPlayerIndex) return;
    enemyDuckActive = !!data.active;
    setSoldierVisual(modelForPlayer(data.playerIndex), enemyDefenseActive ? 'defend' : 'idle');
});

socket.on('wallStateChanged', (data) => {
    if (!data) return;
    const ownerIndex = Number(data.ownerIndex);
    if (!Number.isFinite(ownerIndex) || !wallStates[ownerIndex]) return;
    if (data.active) setWallState(ownerIndex, true, Number(data.x || 0), Number(data.hp || WALL_HP_MAX));
    else removeWall(ownerIndex);
});

socket.on('wallHitFx', (data) => {
    if (!data) return;
    applyWallHit(Number(data.ownerIndex), Number(data.hitX || 0), Number(data.hitY || (ground.position.y + 90)));
});

socket.on('entityHit', (data) => {
    const { entityIndex, hitX, hitY, hitAngle } = data || {};
    const e = entities[entityIndex];
    if (e) {
        e.alive = false;
        e.fallWithSpear = true;
        e.mesh.position.set(hitX, hitY, 0);
        e.mesh.rotation.z = hitAngle + Math.PI / 2;
        if (spear && spear.playerIndex !== myPlayerIndex) {
            spear.hitEntity = e;
            spear.vx *= 0.35;
            spear.vy = Math.min(spear.vy, -120);
        }
        spawnParticles(hitX, hitY, 20);
            showDamageText(hitX, hitY + 50, "QUSH!", true);
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

// Revansh so'rovi keldi
socket.on('rematchRequest', () => {
    console.log('Revansh so\'rovi keldi');
    if (rematchModal) {
        rematchModal.classList.remove('hidden');
        console.log('Modal ochildi');
    } else {
        console.log('Modal topilmadi');
    }
});

// Revansh qabul qilindi - yangi o'yin boshlash
socket.on('rematchStart', () => {
    // O'yinni qayta boshlash
    gameOverScreen.classList.add('hidden');
    if (rematchModal) rematchModal.classList.add('hidden');
    if (rematchBtn) {
        rematchBtn.innerText = "Revansh";
        rematchBtn.disabled = false;
    }
    // O'yin holatini qayta boshlash
    myHealth = 100;
    enemyHealth = 100;
    mySuper = myProfile.superPowers || 5;
    updateHealthUI();
    myDefenseActive = false;
    enemyDefenseActive = false;
    myDuckActive = false;
    enemyDuckActive = false;
    setDefenseActive(false, false);
    setDuckActive(false, false);
    currentTurnIndex = 0;
    prevTurnIndex = -2;
    isWallPlacementMode = false;
    isWallDragActive = false;
    singleShotLocked = false;
    resetWeapon();
});

// Revansh rad etildi
socket.on('rematchDeclined', () => {
    if (rematchBtn) {
        rematchBtn.innerText = "Rad etildi";
        rematchBtn.disabled = true;
    }
    setTimeout(() => {
        gameOverScreen.classList.add('hidden');
        menuScreen.classList.remove('hidden');
        gameMode = 'menu';
    }, 2000);
});

function showGameOver(winnerIndex) {
    gameOverScreen.classList.remove('hidden');
    controlsPanel.classList.add('disabled');
    const t = translations[myProfile.lang] || translations.uz;
    const winner = winnerIndex === myPlayerIndex ? t.win : t.lose;
    winnerText.innerText = winner;
    if (restartBtn) {
        const nextLabel = t.nextLevelBtn || "Keyingi bosqich";
        const replayLabel = t.playAgainBtn || "Yana o'ynash";
        restartBtn.innerText = (gameMode === 'single' && winnerIndex === myPlayerIndex) ? nextLabel : replayLabel;
    }
    
    // Online rejimda revansh tugmasini ko'rsatish
    if (rematchBtn) {
        if (gameMode === 'multi') {
            rematchBtn.classList.remove('hidden');
        } else {
            rematchBtn.classList.add('hidden');
        }
    }
    
    if (winnerIndex === myPlayerIndex) {
        myStats.wins++;
        if (gameMode === 'single') {
            singleCampaignLevel += 1;
            localStorage.setItem('nayza_single_level', String(singleCampaignLevel));
            try {
                const rawAuth = localStorage.getItem('nayza_auth_user');
                const cachedAuth = rawAuth ? JSON.parse(rawAuth) : null;
                if (cachedAuth) {
                    cachedAuth.campaignLevel = Math.max(Number(cachedAuth.campaignLevel || 1), singleCampaignLevel);
                    localStorage.setItem('nayza_auth_user', JSON.stringify(cachedAuth));
                }
            } catch {}
            updateCampaignUI();
        }
    }
    myStats.games++;
    saveStats();
    submitLeaderboard();
    
    cameraState = 'target';
    cameraTargetX = winnerIndex === 0 ? p1Model.position.x : p2Model.position.x;
    cameraTargetY = -200;
    cameraZoomTarget = baseZoom * 1.5;
}

if (restartBtn) {
    restartBtn.addEventListener('click', () => {
        gameOverScreen.classList.add('hidden');
        if (gameMode === 'single') {
            const level = Math.max(1, singleCampaignLevel);
            aiDifficulty = level < 6 ? 'easy' : level < 15 ? 'normal' : 'hard';
            startSinglePlayer({ birds: true, animals: Math.random() > 0.45 });
            return;
        }
        location.reload();
    });
}

if (menuBtn) {
    menuBtn.addEventListener('click', () => {
        gameOverScreen.classList.add('hidden');
        gameScreen.classList.add('hidden');
        waitingScreen.classList.add('hidden');
        multiMenu.classList.add('hidden');
        disconnectScreen.classList.add('hidden');
        inGameModal.classList.add('hidden');
        if (aboutModal) aboutModal.classList.add('hidden');
        menuScreen.classList.remove('hidden');
        gameMode = 'menu';
        updateCampaignUI();
    });
}

// Revansh tugmasi - so'rov yuborish
if (rematchBtn) {
    rematchBtn.addEventListener('click', () => {
        console.log('Revansh tugmasi bosildi, roomName:', currentRoomName);
        if (socket && socket.connected) {
            socket.emit('rematchRequest', { roomName: currentRoomName });
            rematchBtn.innerText = "Kutilmoqda...";
            rematchBtn.disabled = true;
        } else {
            console.log('Socket ulanmagan');
            rematchBtn.innerText = "Xatolik";
        }
    });
}

// Revansh so'rovini qabul qilish
if (btnRematchAccept) {
    btnRematchAccept.addEventListener('click', () => {
        if (socket && socket.connected) {
            socket.emit('rematchAccept', { roomName: currentRoomName });
        }
        if (rematchModal) rematchModal.classList.add('hidden');
    });
}

// Revansh so'rovini rad etish
if (btnRematchDecline) {
    btnRematchDecline.addEventListener('click', () => {
        if (socket && socket.connected) {
            socket.emit('rematchDecline', { roomName: currentRoomName });
        }
        if (rematchModal) rematchModal.classList.add('hidden');
        gameOverScreen.classList.add('hidden');
        menuScreen.classList.remove('hidden');
        gameMode = 'menu';
    });
}

function updateTurn(turnIndex, wind) {
    const turnChanged = turnIndex !== prevTurnIndex;
    prevTurnIndex = turnIndex;
    currentTurnIndex = turnIndex;
    if (turnIndex !== myPlayerIndex && isWallPlacementMode) {
        isWallPlacementMode = false;
        isWallDragActive = false;
    }
    if (gameMode === 'single' && turnIndex === myPlayerIndex) singleShotLocked = false;
    currentWind = wind;

    p1Info.classList.toggle('active', turnIndex === 0);
    p2Info.classList.toggle('active', turnIndex === 1);
    p1Info.querySelector('.status').innerText = turnIndex === 0 ? "O'z navbatida" : "Kutmoqda";
    p2Info.querySelector('.status').innerText = turnIndex === 1 ? "O'z navbatida" : "Kutmoqda";

    windText.innerText = Math.abs(wind).toFixed(1);
    if (wind > 0) windArrow.style.transform = 'rotate(0deg)';
    else if (wind < 0) windArrow.style.transform = 'rotate(180deg)';
    else windArrow.style.transform = 'rotate(0deg)';

    if (turnChanged && turnIndicator) {
        turnIndicator.classList.remove('turn-pulse');
        // Reflow so animation can retrigger every turn change.
        void turnIndicator.offsetWidth;
        turnIndicator.classList.add('turn-pulse');
    }

    const activeModel = modelForPlayer(turnIndex);
    const activeX = activeModel ? activeModel.position.x : 0;
    const isOnlineTurnFocus = gameMode === 'multi';

    if (turnIndex === myPlayerIndex) {
        controlsPanel.classList.remove('disabled');
        if (turnChanged) controlsPanel.classList.remove('auto-hidden');
        turnIndicator.innerText = "Sizning navbatingiz! (Tortib mo'ljalga oling)";
        turnIndicator.classList.add('turn-self');
        turnIndicator.classList.remove('turn-opponent');
        
        cameraState = 'target';
        cameraTargetX = activeX;
        cameraTargetY = 0;
        cameraZoomTarget = isOnlineTurnFocus ? baseZoom * 1.08 : baseZoom;
        if (isOnlineTurnFocus) {
            camera.position.x = cameraTargetX;
            camera.position.y = cameraTargetY;
            camera.zoom = cameraZoomTarget;
            camera.updateProjectionMatrix();
        }
        hud.style.opacity = 1;
        if (turnChanged) {
            if (turnHideTimer) clearTimeout(turnHideTimer);
            turnHideTimer = setTimeout(() => {
                if (currentTurnIndex === myPlayerIndex && !isAnimating) {
                    controlsPanel.classList.add('auto-hidden');
                }
            }, 5000);
        }
    } else {
        controlsPanel.classList.add('disabled');
        controlsPanel.classList.remove('auto-hidden');
        turnIndicator.innerText = "Raqib navbati";
        turnIndicator.classList.add('turn-opponent');
        turnIndicator.classList.remove('turn-self');
        
        cameraState = 'target';
        cameraTargetX = activeX;
        cameraTargetY = 0;
        cameraZoomTarget = isOnlineTurnFocus ? baseZoom * 1.08 : baseZoom;
        if (isOnlineTurnFocus) {
            camera.position.x = cameraTargetX;
            camera.position.y = cameraTargetY;
            camera.zoom = cameraZoomTarget;
            camera.updateProjectionMatrix();
        }
    }
    updateSuperUI();
}

function startSpearAnimation(playerIndex, angle, power) {
    isAnimating = true;
    controlsPanel.classList.add('disabled');
    hud.style.opacity = 0.3; 
    playThrowSound();

    const thrower = modelForPlayer(playerIndex);
    const throwState = thrower?.userData?.isOttomanSpearman
        ? 'afterShot'
        : (thrower?.userData?.isOttomanArcher ? 'aim' : 'afterShot');
    setModelActionState(thrower, throwState, 950);

    // Start trajectory directly from the bow's position
    const startX = playerIndex === 0 ? p1Model.position.x + 60 : thrower.position.x - 60;
    const startY = thrower.position.y + 270; 

    const rad = angle * (Math.PI / 180);

    let vx = power * Math.cos(rad);
    if (playerIndex !== 0) vx = -vx;

    spear = {
        x: startX,
        y: startY,
        vx: vx,
        vy: power * Math.sin(rad),
        active: true,
        playerIndex: playerIndex,
        hitEntity: null,
        entityHitEmitted: false,
        aiSuperTried: false
    };
    
    const isSpearmanThrow = !!thrower?.userData?.isOttomanSpearman;
    applySpearVisualStyle(isSpearmanThrow);
    const spearScale = isSpearmanThrow ? 1.9 : 1;
    spearGroup.scale.setScalar(spearScale);
    secondarySpearGroup.scale.setScalar(spearScale);
    spearGroup.position.set(startX, startY, 0);
    spearGroup.visible = true;
    if (pendingDoubleShot) {
        const shot = pendingDoubleShot;
        const shotRad = shot.angle * (Math.PI / 180);
        let svx = shot.power * Math.cos(shotRad);
        if (playerIndex !== 0) svx = -svx;
        secondarySpear = {
            x: startX,
            y: startY,
            vx: svx,
            vy: shot.power * Math.sin(shotRad),
            active: true
        };
        secondarySpearGroup.position.set(startX, startY, 0);
        secondarySpearGroup.visible = true;
    } else {
        secondarySpear = null;
        secondarySpearGroup.visible = false;
    }
    
    if (gameMode === 'multi') {
        currentTurnIndex = -1;
    }
    
    cameraState = 'follow';
    cameraZoomTarget = baseZoom * 1.2;
}

function getWallHitOwnerIndex() {
    if (!spear || !spear.active) return -1;
    const states = [wallStates[0], wallStates[1]];
    for (const wall of states) {
        if (!wall || !wall.active || !wall.mesh) continue;
        // Owner's own projectile should pass through their wall.
        if (Number(spear.playerIndex) === Number(wall.ownerIndex)) continue;
        const halfW = Number(wall.mesh.userData.wallWidth || 180) / 2;
        const halfH = Number(wall.mesh.userData.wallHeight || 170) / 2;
        if (Math.abs(spear.x - wall.x) <= halfW && Math.abs(spear.y - wall.mesh.position.y) <= halfH) {
            return wall.ownerIndex;
        }
    }
    return -1;
}

function applyWallHit(ownerIndex, hitX, hitY) {
    const wall = wallStates[ownerIndex];
    if (!wall || !wall.active) return;
    wall.hp = Math.max(0, Number(wall.hp || WALL_HP_MAX) - 1);
    showDamageText(hitX, hitY + 40, `DEVOR -1 (${wall.hp}/5)`, false, true);
    spawnParticles(hitX, hitY, 12, true);
    if (wall.hp <= 0) {
        removeWall(ownerIndex);
    } else {
        setWallState(ownerIndex, true, wall.x, wall.hp);
    }
}

function checkCollision() {
    if (!spear || !spear.active) return;

    const wallOwnerIndex = getWallHitOwnerIndex();
    if (wallOwnerIndex >= 0) {
        spear.active = false;
        isAnimating = false;
        const hitX = spear.x;
        const hitY = spear.y;
        resetCameraAfterImpact();
        hideFlyingSpear();
        if (gameMode === 'multi') {
            if (spear.playerIndex === myPlayerIndex) {
                socket.emit('wallHit', { ownerIndex: wallOwnerIndex, hitX, hitY });
            }
        } else {
            applyWallHit(wallOwnerIndex, hitX, hitY);
            advanceSingleTurnAfterShot();
        }
        return;
    }

    let hitEntity = null;
    for(let e of entities) {
        if (e.alive) {
            if (spear.hitEntity === e) continue;
            const dx = spear.x - e.mesh.position.x;
            const dy = spear.y - e.mesh.position.y; // spear relative to e's origin
            let isHit = false;
            
            if (e.type === 'bird' && e.mesh.userData.isCrowSprite) {
                isHit = (Math.abs(dx) < 45 && Math.abs(dy) < 45);
            } else {
                isHit = (Math.abs(dx) < 30 && Math.abs(dy) < 50);
            }
            
            if (isHit) {
                hitEntity = e;
                break;
            }
        }
    }

    if (hitEntity) {
        hitEntity.alive = false;
        hitEntity.fallWithSpear = true;
        spear.hitEntity = hitEntity;
        spear.vy = Math.min(spear.vy, -120);
        spear.vx *= 0.35;
        playCrowSound();
        showDamageText(spear.x, spear.y + 50, "QARG'A!", true);
        if (gameMode === 'multi' && spear.playerIndex === myPlayerIndex && !spear.entityHitEmitted) {
            socket.emit('entityHit', { entityIndex: entities.indexOf(hitEntity), hitX: spear.x, hitY: spear.y, hitAngle: spearGroup.rotation.z });
            spear.entityHitEmitted = true;
        }
        hitEntity = null;
        return;
    }

    if (spear.hitEntity) {
        spear.hitEntity.mesh.position.set(spear.x, spear.y, 0);
        spear.hitEntity.mesh.rotation.z = spearGroup.rotation.z + Math.PI / 2;
    }

    if (spear.hitEntity && spear.y <= ground.position.y + 100) {
        spear.active = false;
        spear.y = ground.position.y + 100;
        finishAnimation(false, -1, spear.x, spear.y, spear.hitEntity);
        return;
    }

    if (spear.y <= ground.position.y + 100) {
        spear.active = false;
        spear.y = ground.position.y + 100;
        finishAnimation(false, -1, spear.x, spear.y);
        return;
    }

    const models = p3Model ? [p1Model, p2Model, p3Model] : [p1Model, p2Model];
    for (let i = 0; i < models.length; i++) {
        const m = models[i];
        if (m.userData.isKnockedDown) continue;
        const modelHeight = m.userData?.planeMesh?.geometry?.parameters?.height || 430;
        const hitTopY = m.position.y + modelHeight;
        const hitBottomY = m.position.y + 30;
        const relativeY = spear.y - m.position.y;
        if (isDuckActiveForPlayer(i) && relativeY > modelHeight * 0.52) continue;
        if (Math.abs(spear.x - m.position.x) < 55 &&
            spear.y > hitBottomY && 
            spear.y < hitTopY) {
            
            if (i === spear.playerIndex && spear.vy > 0) continue;
            
            spear.active = false;
            const isSuicide = (i === spear.playerIndex);
            finishAnimation(true, i, spear.x, spear.y, null, isSuicide);
            return;
        }
    }
    
    if (spear.x < -4000 || spear.x > 4000 || spear.y < -1200) {
        spear.active = false;
        spear.y = ground.position.y + 100;
        finishAnimation(false, -1, spear.x, spear.y);
    }
}

function finishAnimation(hitOpponent, targetIndex, hitX, hitY, hitEntity = null, isSuicide = false) {
    isAnimating = false;
    resetCameraAfterImpact();
    screenShake = Math.max(screenShake, MOBILE_PERF_MODE ? 7 : 12);
    
    p1Model.userData.armR.rotation.z = Math.PI / 4;
    p2Model.userData.armR.rotation.z = Math.PI / 4;
    if (p3Model) p3Model.userData.armR.rotation.z = Math.PI / 4;

    if (hitEntity) {
        hitEntity.mesh.rotation.z = spearGroup.rotation.z + Math.PI / 2;
        stickSpear(hitEntity.mesh, hitX, hitY, spearGroup.rotation.z);
        hideFlyingSpear();
        spawnParticles(hitX, hitY, 20);
        
        showDamageText(hitX, hitY + 50, "QUSH!", true);
        
        if (spear.playerIndex === myPlayerIndex || gameMode === 'single') {
            if (spear.playerIndex === myPlayerIndex) {
                // Bird/crow kill penalty: can go below zero (debt mode).
                addScore(-2);
            }
            if (gameMode === 'multi') {
                if (!spear.entityHitEmitted) {
                    socket.emit('entityHit', { entityIndex: entities.indexOf(hitEntity), hitX, hitY, hitAngle: spearGroup.rotation.z });
                    spear.entityHitEmitted = true;
                }
            } else {
                advanceSingleTurnAfterShot();
            }
        }
        return;
    }

    if (!hitOpponent) hitY = ground.position.y + 100;
    if (spear.playerIndex === myPlayerIndex || gameMode === 'single') {
        processHit(hitOpponent, targetIndex, hitX, hitY, isSuicide);
    }
}

let isLooping = false;
let isPaused = false;


function gameLoop(now) {
    if (isPaused) {
        lastTime = now;
    mixers.forEach(m => m.update(dt));
        renderer.render(scene, camera);
        if(isLooping) requestAnimationFrame(gameLoop);
        return;
    }
    let timeScale = 1.0;
    if (!isAnimating && screenShake > 0) timeScale = 0.3; 
    if (now < cinematicSlowUntil) timeScale *= 0.23;
    if (now < crowKillerCinematicUntil) timeScale *= 0.35; // Qush o'ldirish cinematic sekinlashtirish
    
    const dt = ((now - lastTime) / 1000) * timeScale;
    lastTime = now;
    mixers.forEach(m => m.update(dt));

    // Breathing Animation
    const breath = Math.sin(now * 0.004) * 0.02 + 1;
    const duckOffset = -62;
    const p1Duck = isDuckActiveForPlayer(0);
    const p2Duck = isDuckActiveForPlayer(1);
    const p3Duck = p3Model ? isDuckActiveForPlayer(2) : false;
    const p1ArcherDuck = p1Model?.userData?.isOttomanArcher && p1Duck;
    const p2ArcherDuck = p2Model?.userData?.isOttomanArcher && p2Duck;
    const p3ArcherDuck = p3Model?.userData?.isOttomanArcher && p3Duck;
    p1Model.userData.torso.scale.y = p1ArcherDuck ? Math.max(0.74, breath - 0.22) : (p1Duck ? Math.max(0.86, breath - 0.12) : breath);
    p2Model.userData.torso.scale.y = p2ArcherDuck ? Math.max(0.74, breath - 0.22) : (p2Duck ? Math.max(0.86, breath - 0.12) : breath);
    if (p3Model) p3Model.userData.torso.scale.y = p3ArcherDuck ? Math.max(0.74, breath - 0.22) : (p3Duck ? Math.max(0.86, breath - 0.12) : breath);
    p1Model.userData.torso.position.y = p1ArcherDuck ? -34 : (p1Duck ? duckOffset : 0);
    p2Model.userData.torso.position.y = p2ArcherDuck ? -34 : (p2Duck ? duckOffset : 0);
    if (p3Model) p3Model.userData.torso.position.y = p3ArcherDuck ? -34 : (p3Duck ? duckOffset : 0);
    p1Model.userData.headGroup.position.y = (isDuckActiveForPlayer(0) ? 36 : 55) + Math.sin(now * 0.004) * 0.8;
    p2Model.userData.headGroup.position.y = (isDuckActiveForPlayer(1) ? 36 : 55) + Math.sin(now * 0.004) * 0.8;
    if (p3Model) p3Model.userData.headGroup.position.y = (isDuckActiveForPlayer(2) ? 36 : 55) + Math.sin(now * 0.004) * 0.8;
    
    p1Model.userData.armL.rotation.z = Math.sin(now * 0.002) * 0.1;
    p2Model.userData.armL.rotation.z = -Math.sin(now * 0.002) * 0.1;
    if (p3Model) p3Model.userData.armL.rotation.z = -Math.sin(now * 0.002) * 0.1;

    // Dust animation
    const positions = dustSystem.geometry.attributes.position.array;
    for(let i=0; i<dustCount*3; i+=3) {
        positions[i] += currentWind * 10 * dt;
        if (positions[i] > 2000) {
            positions[i] = -2000 + Math.random() * 220;
            positions[i + 1] = Math.random() * 800 - 300;
            positions[i + 2] = (Math.random() - 0.5) * 180;
        }
        if (positions[i] < -2000) {
            positions[i] = 2000 - Math.random() * 220;
            positions[i + 1] = Math.random() * 800 - 300;
            positions[i + 2] = (Math.random() - 0.5) * 180;
        }
    }
    dustSystem.geometry.attributes.position.needsUpdate = true;

    if (weatherSystem && weatherVelocities) {
        const wPos = weatherSystem.geometry.attributes.position.array;
        for (let i = 0; i < weatherVelocities.length; i++) {
            const j = i * 3;
            wPos[j + 1] -= weatherVelocities[i] * dt;
            if (weatherType === 'snow') wPos[j] += Math.sin((now * 0.001) + i) * 12 * dt;
            if (wPos[j + 1] < ground.position.y + 110) {
                wPos[j + 1] = 900 + Math.random() * 700;
                wPos[j] = (Math.random() - 0.5) * 4200;
            }
        }
        weatherSystem.geometry.attributes.position.needsUpdate = true;
    }

    
    entities.forEach((e, idx) => {
        e.index = idx;
        if (e.type === 'bird' && e.alive) {
            e.mesh.position.x += e.vx * dt;
            e.mesh.position.y += (e.vy || 0) * dt;
            e.vy = (e.vy || 0) + Math.sin((now * 0.001) + idx) * 3 * dt;
            if (e.mesh.position.x > 1800) e.vx = -Math.abs(e.vx);
            if (e.mesh.position.x < -1800) e.vx = Math.abs(e.vx);
            if (e.mesh.position.y > 920) e.vy = -Math.abs(e.vy || 30);
            if (e.mesh.position.y < 280) e.vy = Math.abs(e.vy || 30);
            
            if (e.mesh.userData.isCrowSprite && e.mesh.userData.tex) {
                const planeMesh = e.mesh.children.find(child => child.isMesh);
                if (planeMesh) {
                    planeMesh.rotation.y = e.vx > 0 ? 0 : Math.PI;
                    planeMesh.rotation.z = Math.sin(now / 160) * 0.12;
                }
            } else {
                e.mesh.rotation.y = e.vx > 0 ? 0 : Math.PI;
            }
        }
        
        if (!e.alive) {
            e.deathTimer = (e.deathTimer || 0) + dt;
            if (e.mesh.position.y > ground.position.y + 100) {
                e.mesh.position.y -= GRAVITY * dt * 0.5;
                e.mesh.rotation.z += 5 * dt;
            }
        }
    });
    
    // Qarg'a o'qlarini yangilash
    updateCrowKillerArrows();

    // Cloud animation
    clouds.forEach(cloud => {
        cloud.position.x += cloud.userData.vx * dt;
        if (cloud.position.x > 2000) cloud.position.x = -2000;
        if (cloud.position.x < -2000) cloud.position.x = 2000;
    });

    // Decorative tree sway reacts to weather/wind.
    if (decorTrees.length) {
        const weatherSway =
            weatherType === 'storm' ? 1.9 :
            weatherType === 'rain' ? 1.4 :
            weatherType === 'snow' ? 0.65 : 1.0;
        const windSway = 1 + Math.min(1.6, Math.abs(currentWind) / 6);
        const swayScale = weatherSway * windSway;
        for (let i = 0; i < decorTrees.length; i++) {
            const tree = decorTrees[i];
            const d = tree.userData || {};
            const amp = (d.swayAmp || 0.01) * swayScale;
            const speed = d.swaySpeed || 1;
            const phase = d.swayPhase || 0;
            const band = d.depthBand || 1;
            const depthInfluence = band === 2 ? 0.8 : (band === 0 ? 1.12 : 1);
            tree.rotation.z = (d.baseRot || 0) + Math.sin(now * 0.0012 * speed + phase) * amp * depthInfluence;
            tree.position.x = (d.baseX || tree.position.x) + Math.sin(now * 0.0006 * speed + phase) * (1.8 + band) * amp * 42;
        }
    }

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
        if (spear.hitEntity) {
            spear.hitEntity.mesh.position.set(spear.x, spear.y, 0);
            spear.hitEntity.mesh.rotation.z = angle + Math.PI / 2;
        }
        
        if (cameraState === 'follow') {
            // Lead slightly ahead of the spear for a more cinematic track.
            const lead = 90;
            const velLen = Math.max(1, Math.hypot(spear.vx, spear.vy));
            const lx = spear.vx / velLen;
            const ly = spear.vy / velLen;
            cameraTargetX = spear.x + lx * lead;
            cameraTargetY = spear.y + ly * (lead * 0.45);
        }

        // In single-player, AI can intercept player's projectile with super power.
        let interceptedByAiSuper = false;
        if (
            gameMode === 'single' &&
            spear.playerIndex === myPlayerIndex &&
            enemySuper > 0 &&
            spear.y > ground.position.y + 140 &&
            Math.abs(spear.x - modelForPlayer(getPrimaryEnemyTurnIndex()).position.x) < (currentBattleDistance * 0.7)
        ) {
            if (!enemyShieldAutoUsedThisFlight) {
                enemyShieldAutoUsedThisFlight = tryEnemyUseShieldSingle();
            }
            interceptedByAiSuper = tryEnemyUseSuperPowerSingle();
        }

        if (!interceptedByAiSuper) checkCollision();
        if (!spear.active) enemyShieldAutoUsedThisFlight = false;
    }

    if (secondarySpear && secondarySpear.active) {
        secondarySpear.x += secondarySpear.vx * dt;
        secondarySpear.y += secondarySpear.vy * dt;
        secondarySpear.vy -= GRAVITY * dt;
        secondarySpear.vx += (currentWind * 30) * dt;
        secondarySpearGroup.position.set(secondarySpear.x, secondarySpear.y, 0);
        secondarySpearGroup.rotation.z = Math.atan2(secondarySpear.vy, secondarySpear.vx);
        if (secondarySpear.y <= ground.position.y + 100 || secondarySpear.x < -4200 || secondarySpear.x > 4200) {
            secondarySpear.active = false;
            secondarySpearGroup.visible = false;
        }
    }

    updateSuperInterceptCinematic(now, dt);

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
    
    // Update animation frames based on state
    const animModels = p3Model ? [p1Model, p2Model, p3Model] : [p1Model, p2Model];
    animModels.forEach((model, idx) => {
        if (!model.userData.tex && !model.userData.isOttomanUnit) return;
        if (model.userData.isKnockedDown) return;
        
        let targetState = 'idle';
        const nowMs = performance.now();

        if (model.userData.forceState && model.userData.forceStateUntil > nowMs) {
            setSoldierVisual(model, model.userData.forceState);
            return;
        } else if (model.userData.forceState && model.userData.forceStateUntil <= nowMs) {
            model.userData.forceState = null;
        }
        
        if (isDefenseActiveForPlayer(idx)) {
            targetState = 'defend';
        } else if (isAnimating) {
            // Is animating (spear thrown)
            if ((spear && spear.playerIndex === idx) || idx === currentTurnIndex || idx === (currentTurnIndex === -1 && spear ? spear.playerIndex : -1)) {
                targetState = 'afterShot';
            }
        } else if (isDragging && currentTurnIndex === idx) {
            // Dragging
            const dx = dragStart.x - dragCurrent.x;
            const dy = dragCurrent.y - dragStart.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist > 50) targetState = 'aim';
            else if (dist > 10) targetState = 'load';
            
            // Aiming zoom logic
            if (cameraState === 'static' || cameraState === 'aiming') {
                cameraState = 'aiming';
                // Move camera towards the character and zoom in
                cameraTargetX = model.position.x + (idx === 0 ? 95 : -95); 
                cameraTargetY = model.position.y + 160;
                cameraZoomTarget = baseZoom * 1.75;
            }
        } else if (!isDragging && cameraState === 'aiming') {
            // Revert back when stopped aiming
            cameraState = 'static';
            cameraZoomTarget = baseZoom;
            cameraTargetX = 0;
            cameraTargetY = 0;
        }
        
        setSoldierVisual(model, targetState);
    });

    if (isDragging && currentTurnIndex === myPlayerIndex) {
        const dx = dragStart.x - dragCurrent.x;
        const dy = dragCurrent.y - dragStart.y;
        
        if (Math.sqrt(dx*dx + dy*dy) > 10) {
            const startX = myPlayerIndex === 0 ? p1Model.position.x + 60 : p2Model.position.x - 60;
            const startY = p1Model.position.y + 270;
            
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
            const mat = new THREE.LineDashedMaterial({ color: 0xff2d2d, dashSize: 30, gapSize: 15, linewidth: 3 });
            trajectoryLine = new THREE.Line(geo, mat);
            trajectoryLine.computeLineDistances();
            scene.add(trajectoryLine);
            if (!aimSfxPlayed) {
                playSfx('aim');
                aimSfxPlayed = true;
            }
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
    charType: 2,
    superPowers: 5,
    doubleSpears: 0,
    walls: 0
};
myProfile.charType = myProfile.charType || 2;
myProfile.superPowers = Math.max(0, Number(myProfile.superPowers || 5));
myProfile.doubleSpears = Math.max(0, Number(myProfile.doubleSpears || 0));
myProfile.walls = Math.max(0, Number(myProfile.walls || 0));
if (!myProfile.playerId) {
    myProfile.playerId = String(Math.floor(10000 + Math.random() * 90000));
}
myProfile.playerId = String(myProfile.playerId).replace(/\D/g, '').slice(0, 5).padStart(5, '0');

let myFriends = JSON.parse(localStorage.getItem('nayza_friends') || '[]');
if (!Array.isArray(myFriends)) myFriends = [];

let myStats = JSON.parse(localStorage.getItem('nayza_stats')) || {
    score: 500,
    games: 0,
    wins: 0
};
if (!Number.isFinite(Number(myStats.score))) myStats.score = 500;
const LEGACY_BONUS_KEY = 'nayza_legacy_500_bonus_v1';
let legacyBonusApplied = localStorage.getItem(LEGACY_BONUS_KEY) === '1';
let authPhone = normalizePhone(localStorage.getItem('nayza_auth_phone') || '');
let authUserCache = null;
try {
    const rawAuthUser = localStorage.getItem('nayza_auth_user');
    authUserCache = rawAuthUser ? JSON.parse(rawAuthUser) : null;
} catch {
    authUserCache = null;
}

function saveProfile() {
    localStorage.setItem('nayza_profile', JSON.stringify(myProfile));
    if (playerIdReadonly) playerIdReadonly.value = myProfile.playerId;
    if (socket && socket.connected) socket.emit('registerProfile', myProfile);
    applyLanguage();
    if (authPhone) {
        clearTimeout(saveProfile.syncTimer);
        saveProfile.syncTimer = setTimeout(() => {
            submitLeaderboard();
        }, 300);
    }
}

async function authRequest(endpoint, payload) {
    const request = async (base) => {
        const res = await fetch(`${base}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok && res.status === 404) throw new Error('endpoint_not_found');
        if (!res.ok || !data.ok) throw new Error(data.error || 'auth_failed');
        return data;
    };
    try {
        return await request(API_BASE);
    } catch (err) {
        const fallbackAllowed = !API_BASE || API_BASE !== REMOTE_SERVER_URL;
        if (fallbackAllowed) return request(REMOTE_SERVER_URL);
        if (String(err?.message || '') === 'endpoint_not_found' && !IS_NATIVE_APP) {
            throw new Error('local_api_missing');
        }
        if (String(err?.message || '').toLowerCase().includes('failed to fetch')) {
            throw new Error('server_unreachable');
        }
        throw err;
    }
}

function applyAuthedUser(user) {
    if (!user) return;
    myProfile.name = String(user.name || myProfile.name || 'Jangchi').slice(0, 30);
    myProfile.phone = String(user.phone || '').replace(/\D/g, '').slice(-15);
    myProfile.age = Math.max(7, Math.min(99, Number(user.age) || 18));
    if (Number.isFinite(Number(user.score))) myStats.score = Number(user.score);
    if (Number.isFinite(Number(user.wins))) myStats.wins = Math.max(0, Number(user.wins));
    if (Number.isFinite(Number(user.games))) myStats.games = Math.max(0, Number(user.games));
    if (Number.isFinite(Number(user.superPowers))) myProfile.superPowers = Math.max(0, Number(user.superPowers));
    if (Number.isFinite(Number(user.doubleSpears))) myProfile.doubleSpears = Math.max(0, Number(user.doubleSpears));
    if (Number.isFinite(Number(user.walls))) myProfile.walls = Math.max(0, Number(user.walls));
    const localCampaignLevel = Math.max(1, Number(localStorage.getItem('nayza_single_level') || singleCampaignLevel || 1));
    if (Number.isFinite(Number(user.campaignLevel))) {
        // Never downgrade campaign progress from stale auth cache/server lag.
        singleCampaignLevel = Math.max(localCampaignLevel, Math.max(1, Number(user.campaignLevel)));
    } else {
        singleCampaignLevel = localCampaignLevel;
    }
    localStorage.setItem('nayza_single_level', String(singleCampaignLevel));
    localStorage.setItem('nayza_stats', JSON.stringify(myStats));
    authPhone = myProfile.phone;
    localStorage.setItem('nayza_auth_phone', authPhone);
    localStorage.setItem('nayza_auth_user', JSON.stringify({
        name: myProfile.name,
        phone: myProfile.phone,
        age: myProfile.age,
        score: myStats.score,
        wins: myStats.wins,
        games: myStats.games,
        campaignLevel: singleCampaignLevel,
        superPowers: myProfile.superPowers,
        doubleSpears: myProfile.doubleSpears,
        walls: myProfile.walls
    }));
    maybeApplyLegacy500Bonus(true);
    saveProfile();
    if (authModal) authModal.classList.add('hidden');
    menuScreen.classList.remove('hidden');
    updateCampaignUI();
}

function normalizePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 9) return `998${digits}`;
    if (digits.length === 12 && digits.startsWith('998')) return digits;
    if (digits.length > 9) return `998${digits.slice(-9)}`;
    return '';
}

function setAuthStatus(msg, isError = false) {
    if (!authStatus) return;
    authStatus.innerText = msg || '';
    authStatus.style.color = isError ? '#fca5a5' : '#86efac';
}

function formatAuthError(err) {
    const code = String(err?.message || 'auth_failed');
    if (code === 'endpoint_not_found') return "Server auth endpointlari hali yangilanmagan. Birozdan so'ng qayta urinib ko'ring.";
    if (code === 'local_api_missing') return "Lokal server yangilanmagan. `npm run dev` ni qayta ishga tushiring.";
    if (code === 'server_unreachable') return "Server bilan aloqa yo'q. Internetni tekshirib qayta urinib ko'ring.";
    if (code === 'phone_exists') return "Bu telefon raqam allaqachon ro'yxatdan o'tgan.";
    if (code === 'invalid_credentials') return "Telefon raqam yoki parol noto'g'ri.";
    if (code === 'user_not_found') return "Foydalanuvchi topilmadi.";
    if (code === 'invalid_payload') return "Kiritilgan ma'lumotlarni tekshiring.";
    return `Xatolik: ${code}`;
}

function switchAuthTab(mode) {
    const loginMode = mode === 'login';
    if (authLoginSection) authLoginSection.classList.toggle('hidden', !loginMode);
    if (authRegisterSection) authRegisterSection.classList.toggle('hidden', loginMode);
    if (authTabLogin) authTabLogin.classList.toggle('active', loginMode);
    if (authTabRegister) authTabRegister.classList.toggle('active', !loginMode);
}

function saveFriends() {
    localStorage.setItem('nayza_friends', JSON.stringify(myFriends));
}

function upsertFriend(friend) {
    if (!friend || !friend.playerId) return;
    const entry = {
        playerId: String(friend.playerId),
        name: String(friend.name || "Do'st").slice(0, 30),
        flag: String(friend.flag || '🏳️').slice(0, 8),
        online: !!friend.online
    };
    const idx = myFriends.findIndex((f) => f.playerId === entry.playerId);
    if (idx === -1) myFriends.push(entry);
    else myFriends[idx] = { ...myFriends[idx], ...entry };
    saveFriends();
}

function renderFriendsList() {
    console.log('renderFriendsList called, myFriends:', myFriends);
    if (!friendsListEl) return;
    if (!myFriends.length) {
        console.log('No friends found');
        friendsListEl.innerText = "Do'stlar yo'q.";
        return;
    }
    friendsListEl.innerHTML = myFriends.map((f) => `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px;">
            <span>${f.flag || '🏳️'} ${f.name} ${f.online ? '🟢' : '⚪'}</span>
            <button class="primary-btn btn-invite-friend" data-fid="${f.playerId}" style="padding:5px 9px; font-size:0.72rem; background:${f.online ? '#10b981' : '#475569'};" ${f.online ? '' : 'disabled'}>Chaqirish</button>
        </div>
    `).join('');
    friendsListEl.querySelectorAll('.btn-invite-friend').forEach((el) => {
        el.addEventListener('click', () => {
            const toPlayerId = el.getAttribute('data-fid');
            if (!toPlayerId) return;
            const options = {
                map: document.getElementById('select-map') ? document.getElementById('select-map').value : 'field',
                weather: selectWeather ? selectWeather.value : 'sunny',
                birds: true, // Do'st chaqirishda qushlarni doim yoqish
                birdCount: 20, // 20 ta qush
                animals: false,
                charType: myProfile.charType
            };
            socket.emit('inviteFriend', { toPlayerId, profile: myProfile, options });
        });
    });
}

function clearRandomWaitTimer() {
    if (randomWaitTimer) {
        clearTimeout(randomWaitTimer);
        randomWaitTimer = null;
    }
}

function startRandomWaitTimer() {
    clearRandomWaitTimer();
    randomWaitTimer = setTimeout(() => {
        socket.emit('cancelFind');
        waitingScreen.classList.add('hidden');
        multiMenu.classList.remove('hidden');
        const msg = "Sherik topilmadi. Qayta o'yin boshlang.";
        if (joinError) {
            joinError.innerText = msg;
            joinError.style.display = 'block';
        }
    }, 120000);
}

function saveStats() {
    localStorage.setItem('nayza_stats', JSON.stringify(myStats));
}

function maybeApplyLegacy500Bonus(allowSync = false) {
    if (legacyBonusApplied) return;
    const currentScore = Number(myStats.score || 0);
    if (currentScore >= 500) {
        legacyBonusApplied = true;
        localStorage.setItem(LEGACY_BONUS_KEY, '1');
        return;
    }
    myStats.score = 500;
    saveStats();
    updateCampaignUI();
    updateShopUI();
    legacyBonusApplied = true;
    localStorage.setItem(LEGACY_BONUS_KEY, '1');
    if (allowSync && authPhone) submitLeaderboard();
}
maybeApplyLegacy500Bonus(false);

const translations = {
    uz: {
        title: "Nayza Jangi",
        subtitle: "",
        singleBtn: "Yakkalik o'yin (Kompyuterga qarshi)",
        multiBtn: "Onlayn (Haqiqiy raqibga qarshi)",
        aboutBtn: "O'yin haqida",
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
        close: "Yopish",
        playAgainBtn: "Yana o'ynash",
        nextLevelBtn: "Keyingi bosqich",
        menuBtn: "Bosh menyu",
        levelLabel: "Daraja",
        campaignStage: "Kampaniya bosqichi",
        resetCampaign: "Kampaniyani qayta boshlash",
        optionsTitle: "O'yin Sozlamalari",
        mapLabel: "Maydon (Xarita):",
        weatherLabel: "Ob-havo:",
        birdsLabel: "Havoda Uchuvchi Qushlar (To'siq)",
        animalsLabel: "O'tlab yuruvchi hayvonlar",
        difficultyLabel: "Qiyinlik:",
        optionCharLabel: "Jangchi modeli:",
        createGame: "O'yinni Yaratish",
        cancel: "Bekor qilish",
        mapField: "🌿 Yashil Dala",
        mapCastle: "🏰 Qal'a",
        mapDesert: "🏜️ Cho'l",
        mapWinter: "❄️ Qish",
        weatherSunny: "☀️ Quyoshli",
        weatherNight: "🌙 Tun",
        weatherRain: "🌧️ Yomg'ir",
        weatherStorm: "⛈️ Jala",
        weatherSnow: "❄️ Qor",
        diffEasy: "Oson",
        diffNormal: "O'rtacha",
        diffHard: "Qiyin",
        musicVolumeLabel: "Fon musiqa balandligi",
        musicMuteLabel: "Ovozni o'chirish",
        leaderboardLoading: "Reyting yuklanmoqda...",
        leaderboardEmpty: "Hozircha reyting yo'q."
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
        close: "Закрыть",
        playAgainBtn: "Играть снова",
        nextLevelBtn: "Следующий этап",
        menuBtn: "Главное меню",
        levelLabel: "Уровень",
        campaignStage: "Этап кампании",
        resetCampaign: "Сбросить кампанию",
        optionsTitle: "Настройки игры",
        mapLabel: "Карта:",
        weatherLabel: "Погода:",
        birdsLabel: "Летающие птицы (препятствие)",
        animalsLabel: "Пасущиеся животные",
        difficultyLabel: "Сложность:",
        optionCharLabel: "Модель воина:",
        createGame: "Создать игру",
        cancel: "Отмена",
        mapField: "🌿 Зеленое поле",
        mapCastle: "🏰 Замок",
        mapDesert: "🏜️ Пустыня",
        mapWinter: "❄️ Зима",
        weatherSunny: "☀️ Солнечно",
        weatherNight: "🌙 Ночь",
        weatherRain: "🌧️ Дождь",
        weatherStorm: "⛈️ Ливень",
        weatherSnow: "❄️ Снег",
        diffEasy: "Легко",
        diffNormal: "Нормально",
        diffHard: "Сложно",
        musicVolumeLabel: "Громкость фоновой музыки",
        musicMuteLabel: "Выключить звук",
        leaderboardLoading: "Загрузка рейтинга...",
        leaderboardEmpty: "Рейтинг пока пуст."
    },
    en: {
        title: "Spear Clash",
        subtitle: "",
        singleBtn: "Singleplayer (vs PC)",
        multiBtn: "Online (vs Player)",
        aboutBtn: "About game",
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
        close: "Close",
        playAgainBtn: "Play Again",
        nextLevelBtn: "Next Level",
        menuBtn: "Main Menu",
        levelLabel: "Level",
        campaignStage: "Campaign stage",
        resetCampaign: "Reset campaign",
        optionsTitle: "Game Options",
        mapLabel: "Map:",
        weatherLabel: "Weather:",
        birdsLabel: "Flying birds (obstacle)",
        animalsLabel: "Grazing animals",
        difficultyLabel: "Difficulty:",
        optionCharLabel: "Warrior model:",
        createGame: "Create Game",
        cancel: "Cancel",
        mapField: "🌿 Green Field",
        mapCastle: "🏰 Castle",
        mapDesert: "🏜️ Desert",
        mapWinter: "❄️ Winter",
        weatherSunny: "☀️ Sunny",
        weatherNight: "🌙 Night",
        weatherRain: "🌧️ Rain",
        weatherStorm: "⛈️ Storm",
        weatherSnow: "❄️ Snow",
        diffEasy: "Easy",
        diffNormal: "Normal",
        diffHard: "Hard",
        musicVolumeLabel: "Background music volume",
        musicMuteLabel: "Mute audio",
        leaderboardLoading: "Loading leaderboard...",
        leaderboardEmpty: "No leaderboard entries yet."
    },
    tg: {
        title: "Ҷанги Найза",
        subtitle: "Сарбозони қадимии 3D",
        singleBtn: "Бозии танҳо (бар зидди компютер)",
        multiBtn: "Онлайн (бар зидди бозингар)",
        settings: "Танзимот",
        rating: "Рейтинг",
        wind: "ШАМОЛ",
        waiting: "Интизорӣ...",
        yourTurn: "Навбати шумо!",
        oppTurn: "Навбати рақиб",
        win: "Шумо бурдед! 🏆",
        lose: "Шумо бохтед! 💀",
        pause: "Таваққуф",
        resume: "Идома",
        sound: "Садо",
        mainMenu: "Менюи асосӣ",
        save: "Сабт",
        close: "Пӯшидан"
    },
    ky: {
        title: "Найза Согушу",
        subtitle: "Байыркы 3D Жоокерлер",
        singleBtn: "Жалгыз ойун (ПКга каршы)",
        multiBtn: "Онлайн (оюнчуга каршы)",
        settings: "Жөндөөлөр",
        rating: "Рейтинг",
        wind: "ШАМАЛ",
        waiting: "Күтүлүүдө...",
        yourTurn: "Сиздин кезек!",
        oppTurn: "Атаандаштын кезеги",
        win: "Сиз жеңдиңиз! 🏆",
        lose: "Сиз утулдуңуз! 💀",
        pause: "Тыныгуу",
        resume: "Улантуу",
        sound: "Үн",
        mainMenu: "Башкы меню",
        save: "Сактоо",
        close: "Жабуу"
    },
    kk: {
        title: "Найза Шайқасы",
        subtitle: "Ежелгі 3D Жауынгерлер",
        singleBtn: "Жеке ойын (ПК-ға қарсы)",
        multiBtn: "Онлайн (ойыншыға қарсы)",
        settings: "Баптаулар",
        rating: "Рейтинг",
        wind: "ЖЕЛ",
        waiting: "Күтілуде...",
        yourTurn: "Сіздің кезегіңіз!",
        oppTurn: "Қарсылас кезегі",
        win: "Сіз жеңдіңіз! 🏆",
        lose: "Сіз жеңілдіңіз! 💀",
        pause: "Үзіліс",
        resume: "Жалғастыру",
        sound: "Дыбыс",
        mainMenu: "Басты мәзір",
        save: "Сақтау",
        close: "Жабу"
    },
    tr: {
        title: "Mızrak Savaşı",
        subtitle: "Antik 3D Savaşçılar",
        singleBtn: "Tek Kişilik (Bilgisayara karşı)",
        multiBtn: "Çevrim içi (Oyuncuya karşı)",
        settings: "Ayarlar",
        rating: "Sıralama",
        wind: "RÜZGAR",
        waiting: "Bekleniyor...",
        yourTurn: "Sıra sende!",
        oppTurn: "Rakibin sırası",
        win: "Kazandın! 🏆",
        lose: "Kaybettin! 💀",
        pause: "Duraklat",
        resume: "Devam et",
        sound: "Ses",
        mainMenu: "Ana Menü",
        save: "Kaydet",
        close: "Kapat"
    },
    az: {
        title: "Nizə Döyüşü",
        subtitle: "Qədim 3D Döyüşçülər",
        singleBtn: "Tək oyun (Kompüterə qarşı)",
        multiBtn: "Onlayn (Oyunçuya qarşı)",
        settings: "Parametrlər",
        rating: "Reytinq",
        wind: "KÜLƏK",
        waiting: "Gözlənilir...",
        yourTurn: "Sənin növbən!",
        oppTurn: "Rəqibin növbəsi",
        win: "Qalib gəldin! 🏆",
        lose: "Uduzdun! 💀",
        pause: "Fasilə",
        resume: "Davam et",
        sound: "Səs",
        mainMenu: "Əsas menyu",
        save: "Yadda saxla",
        close: "Bağla"
    }
};

function applyLanguage() {
    const t = translations[myProfile.lang] || translations.uz;
    const tf = (key, fallback = '') => t[key] ?? translations.en[key] ?? translations.uz[key] ?? fallback;
    document.querySelector('h1').innerText = t.title;
    const subtitleEl = document.getElementById('txt-subtitle');
    if (subtitleEl) subtitleEl.innerText = tf('subtitle', '');
    document.getElementById('btn-single').innerText = t.singleBtn;
    document.getElementById('btn-multi').innerText = t.multiBtn;
    if (document.getElementById('btn-profile')) document.getElementById('btn-profile').innerText = "Profil";
    if (btnAbout) btnAbout.innerText = tf('aboutBtn', "O'yin haqida");
    document.getElementById('btn-settings').innerText = t.settings;
    if (document.getElementById('btn-shop')) document.getElementById('btn-shop').innerText = "Do'kon";
    document.getElementById('btn-rating').innerText = t.rating;
    if (document.getElementById('btn-logout')) document.getElementById('btn-logout').innerText = "Akkauntdan chiqish";
    document.getElementById('txt-settings-title').innerText = t.settings;
    if (document.getElementById('txt-profile-title')) document.getElementById('txt-profile-title').innerText = "Profil";
    document.getElementById('txt-rating-title').innerText = t.rating;
    document.getElementById('btn-save-settings').innerText = t.save;
    if (document.getElementById('btn-save-profile')) document.getElementById('btn-save-profile').innerText = t.save;
    if (document.getElementById('btn-open-help')) document.getElementById('btn-open-help').innerText = "Yordam";
    if (document.getElementById('txt-settings-music-volume')) document.getElementById('txt-settings-music-volume').innerText = "Fon musiqa balandligi:";
    if (document.getElementById('txt-settings-sfx-volume')) document.getElementById('txt-settings-sfx-volume').innerText = "Maxsus effektlar (SFX) balandligi:";
    if (document.getElementById('txt-settings-music-track')) document.getElementById('txt-settings-music-track').innerText = "Fon musiqasi:";
    document.getElementById('btn-close-rating').innerText = t.close;
    if (restartBtn) restartBtn.innerText = tf('playAgainBtn', "Yana o'ynash");
    if (menuBtn) menuBtn.innerText = tf('menuBtn', "Bosh menyu");
    document.getElementById('txt-wind').innerText = t.wind;
    document.getElementById('btn-resume').innerText = t.resume;
    const pauseBtnEl = document.getElementById('btn-pause');
    if (pauseBtnEl) pauseBtnEl.innerText = t.pause;
    document.getElementById('btn-toggle-sound').innerText = t.sound;
    document.getElementById('btn-exit-menu').innerText = t.mainMenu;
    document.getElementById('txt-ig-menu-title').innerText = t.settings;
    if (document.getElementById('txt-campaign-stage')) document.getElementById('txt-campaign-stage').innerText = tf('campaignStage');
    if (btnResetCampaign) btnResetCampaign.innerText = tf('resetCampaign');
    if (document.getElementById('txt-options-title')) document.getElementById('txt-options-title').innerText = tf('optionsTitle');
    if (document.getElementById('txt-map-lbl')) document.getElementById('txt-map-lbl').innerText = tf('mapLabel');
    if (document.getElementById('txt-weather-lbl')) document.getElementById('txt-weather-lbl').innerText = tf('weatherLabel');
    if (document.getElementById('txt-birds-lbl')) document.getElementById('txt-birds-lbl').innerText = tf('birdsLabel');
    if (document.getElementById('txt-animals-lbl')) document.getElementById('txt-animals-lbl').innerText = tf('animalsLabel');
    if (difficultyWrap) difficultyWrap.innerText = tf('difficultyLabel');
    if (document.getElementById('txt-char-opt-lbl')) document.getElementById('txt-char-opt-lbl').innerText = tf('optionCharLabel');
    if (btnConfirmCreate) btnConfirmCreate.innerText = tf('createGame');
    if (btnCancelOptions) btnCancelOptions.innerText = tf('cancel');
    if (document.getElementById('opt-map-field')) document.getElementById('opt-map-field').innerText = tf('mapField');
    if (document.getElementById('opt-map-castle')) document.getElementById('opt-map-castle').innerText = tf('mapCastle');
    if (document.getElementById('opt-map-desert')) document.getElementById('opt-map-desert').innerText = tf('mapDesert');
    if (document.getElementById('opt-map-winter')) document.getElementById('opt-map-winter').innerText = tf('mapWinter');
    if (document.getElementById('opt-weather-sunny')) document.getElementById('opt-weather-sunny').innerText = tf('weatherSunny');
    if (document.getElementById('opt-weather-night')) document.getElementById('opt-weather-night').innerText = tf('weatherNight');
    if (document.getElementById('opt-weather-rain')) document.getElementById('opt-weather-rain').innerText = tf('weatherRain');
    if (document.getElementById('opt-weather-storm')) document.getElementById('opt-weather-storm').innerText = tf('weatherStorm');
    if (document.getElementById('opt-weather-snow')) document.getElementById('opt-weather-snow').innerText = tf('weatherSnow');
    if (document.getElementById('opt-diff-easy')) document.getElementById('opt-diff-easy').innerText = tf('diffEasy');
    if (document.getElementById('opt-diff-normal')) document.getElementById('opt-diff-normal').innerText = tf('diffNormal');
    if (document.getElementById('opt-diff-hard')) document.getElementById('opt-diff-hard').innerText = tf('diffHard');
    if (document.getElementById('txt-music-volume')) document.getElementById('txt-music-volume').innerText = tf('musicVolumeLabel');
    if (document.getElementById('txt-music-mute')) document.getElementById('txt-music-mute').innerText = tf('musicMuteLabel');
    updateCampaignUI();
}

// Settings Modal
const btnSettings = document.getElementById('btn-settings');
const btnProfile = document.getElementById('btn-profile');
const btnOpenHelp = document.getElementById('btn-open-help');
const helpModal = document.getElementById('help-modal');
const btnCloseHelp = document.getElementById('btn-close-help');
const settingsModal = document.getElementById('settings-modal');
const profileModal = document.getElementById('profile-modal');
const btnSaveSettings = document.getElementById('btn-save-settings');
const btnSaveProfile = document.getElementById('btn-save-profile');

function openProfileSettingsModal() {
    document.getElementById('input-name').value = myProfile.name;
    document.getElementById('select-avatar').value = myProfile.avatar;
    document.getElementById('select-char-type').value = String(myProfile.charType || 2);
    
    // Fix for flag selection (extract emoji)
    const countrySelect = document.getElementById('select-country');
    for (let opt of countrySelect.options) {
        if (opt.value.includes(myProfile.flag)) {
            countrySelect.value = opt.value;
            break;
        }
    }
    
    if (profileModal) profileModal.classList.remove('hidden');
    if (playerIdReadonly) playerIdReadonly.value = myProfile.playerId;
    updateSuperUI();
    menuScreen.classList.add('hidden');
}

btnSettings.addEventListener('click', () => {
    document.getElementById('select-lang').value = myProfile.lang;
    settingsModal.classList.remove('hidden');
    menuScreen.classList.add('hidden');
});
if (btnProfile) btnProfile.addEventListener('click', openProfileSettingsModal);
if (btnLogout) {
    btnLogout.addEventListener('click', () => {
        authPhone = '';
        authUserCache = null;
        delete myProfile.phone;
        delete myProfile.age;
        localStorage.removeItem('nayza_auth_phone');
        localStorage.removeItem('nayza_auth_user');
        saveProfile();
        menuScreen.classList.add('hidden');
        if (authModal) authModal.classList.remove('hidden');
        if (authPasswordInput) authPasswordInput.value = '';
        if (authPhoneInput) authPhoneInput.value = '';
        setAuthStatus("Siz akkauntdan chiqdingiz.");
    });
}

btnSaveSettings.addEventListener('click', () => {
    myProfile.lang = document.getElementById('select-lang').value;
    saveProfile();
    settingsModal.classList.add('hidden');
    menuScreen.classList.remove('hidden');
});

if (btnSaveProfile) btnSaveProfile.addEventListener('click', () => {
    myProfile.name = document.getElementById('input-name').value || "Jangchi";
    myProfile.avatar = document.getElementById('select-avatar').value;
    const selectedCharType = document.getElementById('select-char-type').value || 2;
    myProfile.charType = selectedCharType;
    myProfile.flag = document.getElementById('select-country').value;
    
    saveProfile();
    
    if (window.customModelsInfo) {
        const custom = window.customModelsInfo.find(m => m.id === String(selectedCharType));
        if (custom && custom.bgMusic) {
            selectedMusicTrack = custom.bgMusic;
        } else {
            selectedMusicTrack = localStorage.getItem('nayza_music_track') || 'music.mp3';
        }
        if (typeof applySelectedMusicTrack === 'function') applySelectedMusicTrack();
    }
    
    if (profileModal) profileModal.classList.add('hidden');
    menuScreen.classList.remove('hidden');
});

if (btnOpenHelp && helpModal) {
    btnOpenHelp.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
        helpModal.classList.remove('hidden');
    });
}
if (btnCloseHelp && helpModal) {
    btnCloseHelp.addEventListener('click', () => {
        helpModal.classList.add('hidden');
        settingsModal.classList.remove('hidden');
    });
}

if (btnShop && shopModal) {
    btnShop.addEventListener('click', () => {
        updateSuperUI();
        shopModal.classList.remove('hidden');
        menuScreen.classList.add('hidden');
    });
}

if (btnCloseShop && shopModal) {
    btnCloseShop.addEventListener('click', () => {
        shopModal.classList.add('hidden');
        menuScreen.classList.remove('hidden');
    });
}

if (btnAbout) {
    btnAbout.addEventListener('click', () => {
        if (aboutModal) aboutModal.classList.remove('hidden');
        menuScreen.classList.add('hidden');
    });
}

if (btnCloseAbout) {
    btnCloseAbout.addEventListener('click', () => {
        if (aboutModal) aboutModal.classList.add('hidden');
        menuScreen.classList.remove('hidden');
    });
}

async function copyDonateValue(value, btnEl) {
    if (!value) return;
    try {
        await navigator.clipboard.writeText(value);
    } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = value;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }
    if (btnEl) {
        const prev = btnEl.innerText;
        btnEl.innerText = '✅';
        setTimeout(() => { btnEl.innerText = prev; }, 900);
    }
}

const btnCopyHumo = document.getElementById('btn-copy-humo');
const btnCopyVisa = document.getElementById('btn-copy-visa');
if (btnCopyHumo) {
    btnCopyHumo.addEventListener('click', () => {
        const value = (document.getElementById('donate-humo')?.innerText || '').trim();
        copyDonateValue(value, btnCopyHumo);
    });
}
if (btnCopyVisa) {
    btnCopyVisa.addEventListener('click', () => {
        const value = (document.getElementById('donate-visa')?.innerText || '').trim();
        copyDonateValue(value, btnCopyVisa);
    });
}

if (btnBuySuper) {
    btnBuySuper.addEventListener('click', () => {
        if ((myStats.score || 0) < SUPER_BUY_COST) return;
        addScore(-SUPER_BUY_COST);
        myProfile.superPowers = Math.max(0, Number(myProfile.superPowers || 0) + 1);
        mySuper = myProfile.superPowers;
        saveProfile();
        updateSuperUI();
    });
}

if (btnBuyDouble) {
    btnBuyDouble.addEventListener('click', () => {
        const cur = Math.max(0, Number(myProfile.doubleSpears || 0));
        if ((myStats.score || 0) < DOUBLE_BUY_COST) return;
        addScore(-DOUBLE_BUY_COST);
        myProfile.doubleSpears = cur + 1;
        saveProfile();
        updateSuperUI();
    });
}
if (btnBuyWall) {
    btnBuyWall.addEventListener('click', () => {
        const cur = Math.max(0, Number(myProfile.walls || 0));
        if (Number(myStats.score || 0) < WALL_BUY_COST) return;
        addScore(-WALL_BUY_COST);
        myProfile.walls = cur + 1;
        saveProfile();
        updateSuperUI();
    });
}

if (btnAuthRegister) {
    btnAuthRegister.addEventListener('click', async () => {
        const name = (authNameInput?.value || '').trim();
        const phone = normalizePhone(authRegisterPhoneInput?.value || '');
        const age = Number(authAgeInput?.value || 0);
        const password = String(authRegisterPasswordInput?.value || '');
        if (!name || name.length < 2) return setAuthStatus("Ism kamida 2 ta belgi bo'lsin.", true);
        if (phone.length < 9) return setAuthStatus("Telefon raqamni to'liq kiriting.", true);
        if (!Number.isFinite(age) || age < 7 || age > 99) return setAuthStatus("Yosh 7-99 oralig'ida bo'lsin.", true);
        if (password.length < 4) return setAuthStatus("Parol kamida 4 ta belgi bo'lsin.", true);
        try {
            const data = await authRequest('/api/auth/register', {
                name,
                phone,
                age,
                password
            });
            setAuthStatus("Ro'yxatdan o'tildi.");
            applyAuthedUser(data.user);
        } catch (err) {
            setAuthStatus(formatAuthError(err), true);
        }
    });
}

if (btnAuthLogin) {
    btnAuthLogin.addEventListener('click', async () => {
        const phone = normalizePhone(authPhoneInput?.value || '');
        const password = String(authPasswordInput?.value || '');
        if (phone.length < 9) return setAuthStatus("Telefon raqamni to'liq kiriting.", true);
        if (password.length < 4) return setAuthStatus("Parol kamida 4 ta belgi bo'lsin.", true);
        try {
            const data = await authRequest('/api/auth/login', {
                phone,
                password
            });
            setAuthStatus("Muvaffaqiyatli kirildi.");
            applyAuthedUser(data.user);
        } catch (err) {
            setAuthStatus(formatAuthError(err), true);
        }
    });
}

if (btnAuthReset) {
    btnAuthReset.addEventListener('click', async () => {
        const phone = normalizePhone(resetPhoneInput?.value || '');
        const newPassword = String(resetPasswordInput?.value || '');
        if (phone.length < 9) return setAuthStatus("Telefon raqamni to'liq kiriting.", true);
        if (newPassword.length < 4) return setAuthStatus("Yangi parol kamida 4 ta belgi bo'lsin.", true);
        try {
            await authRequest('/api/auth/reset-password', {
                phone,
                newPassword
            });
            setAuthStatus("Parol yangilandi. Endi kirishingiz mumkin.");
        } catch (err) {
            setAuthStatus(formatAuthError(err), true);
        }
    });
}

// Rating Modal
const btnRating = document.getElementById('btn-rating');
const ratingModal = document.getElementById('rating-modal');
const btnCloseRating = document.getElementById('btn-close-rating');
const leaderboardList = document.getElementById('leaderboard-list');
const LEADERBOARD_CACHE_KEY = 'nayza_leaderboard_cache_v1';

async function submitLeaderboard() {
    const payload = {
        name: myProfile.name,
        flag: myProfile.flag,
        phone: myProfile.phone || authPhone || '',
        score: myStats.score,
        wins: myStats.wins,
        games: myStats.games,
        campaignLevel: singleCampaignLevel,
        superPowers: Math.max(0, Number(myProfile.superPowers || 0)),
        doubleSpears: Math.max(0, Number(myProfile.doubleSpears || 0)),
        walls: Math.max(0, Number(myProfile.walls || 0))
    };
    try {
        await fetch(`${API_BASE}/api/leaderboard`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (_) {
        if (!IS_NATIVE_APP) {
            try {
                await fetch(`${REMOTE_SERVER_URL}/api/leaderboard`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } catch (_) {}
        }
    }
}

async function renderLeaderboard() {
    console.log('renderLeaderboard called, leaderboardList:', !!leaderboardList);
    if (!leaderboardList) return;
    const t = translations[myProfile.lang] || translations.en || translations.uz;
    const renderRows = (rows) => {
        console.log('renderRows called with:', rows);
        if (!Array.isArray(rows) || !rows.length) return false;
        console.log('Leaderboard rows:', rows);
        leaderboardList.innerHTML = rows.map((r, idx) => {
            console.log('Row:', idx, r);
            // playerId bo'lmasa, phone dan foydalanamiz
            const playerId = r.playerId || r.phone;
            const isMe = playerId && myProfile.playerId && playerId === myProfile.playerId;
            // Agar o'zimiz bo'lsak tugma ko'rsatmaslik, aks holda ko'rsatish (phone bo'lmasa ham)
            const showButton = !isMe && r.name !== myProfile.name;
            console.log('playerId:', playerId, 'isMe:', isMe, 'showButton:', showButton);
            const buttonHtml = showButton ? `<button class="primary-btn btn-invite-leaderboard" data-fid="${playerId}" data-fname="${r.name}" style="padding:4px 8px; font-size:0.7rem; background:#10b981;">Chaqirish</button>` : '';
            console.log('Button HTML for', r.name, ':', buttonHtml);
            return `<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px;">
                <span>${idx + 1}. ${r.flag || '🏳️'} ${r.name}</span>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span><b>${r.score}</b></span>
                    ${buttonHtml}
                </div>
            </div>`;
        }).join('');
        
        // Chaqirish tugmalariga event listener qo'shish
        leaderboardList.querySelectorAll('.btn-invite-leaderboard').forEach((el) => {
            el.addEventListener('click', () => {
                const toPlayerId = el.getAttribute('data-fid');
                const toPlayerName = el.getAttribute('data-fname');
                if (!toPlayerId) return;
                
                const options = {
                    map: 'field',
                    weather: 'sunny',
                    birds: true,
                    birdCount: 20,
                    animals: false,
                    charType: myProfile.charType
                };
                
                socket.emit('inviteFriend', { toPlayerId, profile: myProfile, options });
                
                // Taklif yuborilgani haqida xabar
                if (friendIdStatus) {
                    friendIdStatus.style.color = '#3b82f6';
                    friendIdStatus.innerText = `${toPlayerName} ga o'yin taklifi yuborildi.`;
                }
            });
        });
        
        return true;
    };
    let showedCached = false;
    try {
        const cachedRaw = localStorage.getItem(LEADERBOARD_CACHE_KEY);
        const cachedRows = cachedRaw ? JSON.parse(cachedRaw) : [];
        showedCached = renderRows(cachedRows);
    } catch (_) {}
    if (!showedCached) leaderboardList.innerText = t.leaderboardLoading || "Loading leaderboard...";
    try {
        const fetchRows = async (base) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3500);
            const res = await fetch(`${base}/api/leaderboard?limit=20`, { signal: controller.signal });
            clearTimeout(timeoutId);
            const data = await res.json().catch(() => ({}));
            return Array.isArray(data.rows) ? data.rows : [];
        };
        let rows = await fetchRows(API_BASE);
        if (!rows.length && !IS_NATIVE_APP) {
            // Localhostda ro'yxat bo'sh bo'lsa, umumiy remote reytingni ham ko'rsatamiz.
            rows = await fetchRows(REMOTE_SERVER_URL);
        }
        if (!rows.length) {
            leaderboardList.innerText = t.leaderboardEmpty || "No leaderboard entries yet.";
            return;
        }
        renderRows(rows);
        try {
            localStorage.setItem(LEADERBOARD_CACHE_KEY, JSON.stringify(rows));
        } catch (_) {}
    } catch (_) {
        if (!showedCached) leaderboardList.innerText = "Reytingni yuklashda xatolik.";
    }
}

btnRating.addEventListener('click', () => {
    const statScoreEl = document.getElementById('stat-score');
    const score = Number(myStats.score || 0);
    statScoreEl.innerText = score < 0 ? `Qarz: ${score}` : String(score);
    statScoreEl.style.color = score < 0 ? '#ef4444' : '#f59e0b';
    document.getElementById('stat-games').innerText = myStats.games;
    document.getElementById('stat-wins').innerText = myStats.wins;
    renderLeaderboard();
    
    ratingModal.classList.remove('hidden');
    menuScreen.classList.add('hidden');
});

btnCloseRating.addEventListener('click', () => {
    ratingModal.classList.add('hidden');
    menuScreen.classList.remove('hidden');
});

if (btnResetCampaign) {
    btnResetCampaign.addEventListener('click', () => {
        singleCampaignLevel = 1;
        localStorage.setItem('nayza_single_level', '1');
        updateCampaignUI();
    });
}

// Pause Logic
const btnPause = document.getElementById('btn-pause');
if (btnPause) {
    btnPause.addEventListener('click', () => {
        if (gameMode !== 'single') return; // Pause only in single player
        isPaused = !isPaused;
        btnPause.innerText = isPaused ? translations[myProfile.lang].resume : translations[myProfile.lang].pause;
        if(!isPaused) {
            lastTime = performance.now(); // avoid teleportation
        }
    });
}

// Setup on load
applyLanguage();
updateShieldUI();
updateCampaignUI();
updateSuperUI();
if (!audioUnlockAttached) {
    const unlockAudio = () => {
        initAudio();
        document.removeEventListener('pointerdown', unlockAudio);
        document.removeEventListener('touchstart', unlockAudio);
        audioUnlockAttached = false;
    };
    document.addEventListener('pointerdown', unlockAudio, { once: true });
    document.addEventListener('touchstart', unlockAudio, { once: true });
    audioUnlockAttached = true;
}
if (authModal) authModal.classList.remove('hidden');
menuScreen.classList.add('hidden');
if (playerIdReadonly) playerIdReadonly.value = myProfile.playerId;
if (socket && socket.connected) socket.emit('registerProfile', myProfile);
socket.on('connect', () => {
    socket.emit('registerProfile', myProfile);
});
if (authUserCache && authUserCache.phone) {
    applyAuthedUser(authUserCache);
}
if (authPhone) {
    const authBase = API_BASE || '';
    fetch(`${authBase}/api/auth/user?phone=${encodeURIComponent(authPhone)}`)
        .then((r) => r.json())
        .then((data) => {
            if (data && data.ok && data.user) applyAuthedUser(data.user);
            else if (!authUserCache || !authUserCache.phone) setAuthStatus("Ro'yxatdan o'ting yoki kiring.", true);
        })
        .catch(() => {
            if (!authUserCache || !authUserCache.phone) setAuthStatus("Ro'yxatdan o'ting yoki kiring.", true);
        });
} else if (!authUserCache || !authUserCache.phone) {
    setAuthStatus("Ro'yxatdan o'ting yoki kiring.", true);
}
if (authTabLogin) authTabLogin.addEventListener('click', () => switchAuthTab('login'));
if (authTabRegister) authTabRegister.addEventListener('click', () => switchAuthTab('register'));
if (btnForgotToggle && forgotSection) {
    btnForgotToggle.addEventListener('click', () => {
        const hidden = forgotSection.classList.contains('hidden');
        forgotSection.classList.toggle('hidden', !hidden);
        btnForgotToggle.innerText = hidden ? "Parolni tiklash bo'limini yopish" : "Parolni unutdingizmi?";
    });
}
switchAuthTab('login');

document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    if (t.closest('button')) playSfx('button', 0.85);
});

// Missing Event Listeners
if(document.getElementById('btn-single')) {
    document.getElementById('btn-single').addEventListener('click', () => {
        if(typeof initAudio === 'function') initAudio();
        if (singleModeModal) {
            singleModeModal.classList.remove('hidden');
            menuScreen.classList.add('hidden');
            return;
        }
        const level = Math.max(1, singleCampaignLevel);
        aiDifficulty = level < 6 ? 'easy' : level < 15 ? 'normal' : 'hard';
        gameMode = 'single';
        startSinglePlayer({ birds: true, animals: Math.random() > 0.45 });
    });
}

if (btnSingleContinue) {
    btnSingleContinue.addEventListener('click', () => {
        if (singleModeModal) singleModeModal.classList.add('hidden');
        const level = Math.max(1, singleCampaignLevel);
        aiDifficulty = level < 6 ? 'easy' : level < 15 ? 'normal' : 'hard';
        gameMode = 'single';
        startSinglePlayer({ birds: true, animals: Math.random() > 0.45 });
    });
}

if (btnSingleNew) {
    btnSingleNew.addEventListener('click', () => {
        singleCampaignLevel = 1;
        localStorage.setItem('nayza_single_level', '1');
        updateCampaignUI();
        if (singleModeModal) singleModeModal.classList.add('hidden');
        aiDifficulty = 'easy';
        gameMode = 'single';
        startSinglePlayer({ birds: true, animals: Math.random() > 0.45 });
    });
}

if (btnSingleCancel) {
    btnSingleCancel.addEventListener('click', () => {
        if (singleModeModal) singleModeModal.classList.add('hidden');
        menuScreen.classList.remove('hidden');
    });
}

if (btnSingleSelectLevel) {
    btnSingleSelectLevel.addEventListener('click', () => {
        if (singleModeModal) singleModeModal.classList.add('hidden');
        if (levelSelectModal) {
            levelSelectModal.classList.remove('hidden');
            renderLevelGrid();
        }
    });
}

if (btnLevelSelectCancel) {
    btnLevelSelectCancel.addEventListener('click', () => {
        if (levelSelectModal) levelSelectModal.classList.add('hidden');
        if (singleModeModal) singleModeModal.classList.remove('hidden');
    });
}

function renderLevelGrid() {
    if (!levelGrid) return;
    levelGrid.innerHTML = '';
    
    // singleCampaignLevel saqlangan eng yuqori level
    const maxLevel = Math.max(1, singleCampaignLevel || 1);
    for (let i = 1; i <= 100; i++) {
        const levelBtn = document.createElement('button');
        levelBtn.className = 'primary-btn';
        levelBtn.style.padding = '8px 4px';
        levelBtn.style.fontSize = '0.9rem';
        levelBtn.style.minHeight = '40px';
        
        if (i <= maxLevel) {
            levelBtn.style.background = '#10b981';
            levelBtn.innerText = i;
            levelBtn.addEventListener('click', () => {
                singleCampaignLevel = i;
                if (levelSelectModal) levelSelectModal.classList.add('hidden');
                if (singleModeModal) singleModeModal.classList.add('hidden');
                menuScreen.classList.add('hidden');
                aiDifficulty = 'easy';
                gameMode = 'single';
                startSinglePlayer({ birds: true, animals: Math.random() > 0.45 });
            });
        } else {
            levelBtn.style.background = '#475569';
            levelBtn.style.opacity = '0.5';
            levelBtn.style.cursor = 'not-allowed';
            levelBtn.innerText = '🔒';
        }
        
        levelGrid.appendChild(levelBtn);
    }
}

if(document.getElementById('btn-multi')) {
    document.getElementById('btn-multi').addEventListener('click', () => {
        if(typeof initAudio === 'function') initAudio();
        clearRandomWaitTimer();
        multiMenu.classList.remove('hidden');
        renderFriendsList();
        socket.emit('friendsPresence', { ids: myFriends.map((f) => f.playerId) });
        menuScreen.classList.add('hidden');
    });
}

const btnMultiCreate = document.getElementById('btn-multi-create');
const btnMultiJoinShow = document.getElementById('btn-multi-join-show');
const btnMultiJoin = document.getElementById('btn-multi-join');
const btnMultiRandom = document.getElementById('btn-multi-random');
const btnMultiBack = document.getElementById('btn-multi-back');
const createCodeContainer = document.getElementById('create-code-container');
const createCodeText = document.getElementById('create-code');
const joinCodeContainer = document.getElementById('join-code-container');
const inputJoinCode = document.getElementById('input-join-code');
const joinError = document.getElementById('join-error');

if (btnMultiCreate) {
    btnMultiCreate.addEventListener('click', () => {
        gameOptionsTargetMode = 'multiCreate';
        if (gameOptionsFields) gameOptionsFields.style.display = 'block';
        if (difficultyWrap) difficultyWrap.style.display = 'none';
        if (selectDifficulty) selectDifficulty.style.display = 'none';
        if (selectCharTypeOptions) selectCharTypeOptions.value = String(myProfile.charType || 2);
        gameOptionsModal.classList.remove('hidden');
        multiMenu.classList.add('hidden');
    });
}

if (btnMultiRandom) {
    btnMultiRandom.addEventListener('click', () => {
        gameOptionsTargetMode = 'multiRandom';
        if (joinError) joinError.style.display = 'none';
        socket.emit('findGame', { profile: myProfile, options: null });
        waitingScreen.classList.remove('hidden');
        startRandomWaitTimer();
        multiMenu.classList.add('hidden');
    });
}

if (btnMultiJoinShow) {
    btnMultiJoinShow.addEventListener('click', () => {
        if (joinCodeContainer) joinCodeContainer.classList.toggle('hidden');
        if (joinError) joinError.style.display = 'none';
    });
}

if (btnMultiJoin) {
    btnMultiJoin.addEventListener('click', () => {
        const code = (inputJoinCode && inputJoinCode.value ? inputJoinCode.value : '').trim();
        if (!code) return;
        socket.emit('joinGame', { profile: myProfile, code });
    });
}

if (btnMultiBack) {
    btnMultiBack.addEventListener('click', () => {
        clearRandomWaitTimer();
        multiMenu.classList.add('hidden');
        menuScreen.classList.remove('hidden');
        if (createCodeContainer) createCodeContainer.classList.add('hidden');
        if (joinCodeContainer) joinCodeContainer.classList.add('hidden');
        if (joinError) joinError.style.display = 'none';
    });
}

if (btnRefreshFriends) {
    btnRefreshFriends.addEventListener('click', () => {
        socket.emit('friendsPresence', { ids: myFriends.map((f) => f.playerId) });
    });
}

if (btnCancelOptions) {
    btnCancelOptions.addEventListener('click', () => {
        gameOptionsModal.classList.add('hidden');
        if (difficultyWrap) difficultyWrap.style.display = 'block';
        if (selectDifficulty) selectDifficulty.style.display = 'block';
        if (gameOptionsTargetMode === 'multiCreate' || gameOptionsTargetMode === 'multiRandom') {
            multiMenu.classList.remove('hidden');
            menuScreen.classList.add('hidden');
        } else {
            menuScreen.classList.remove('hidden');
        }
    });
}

if (btnConfirmCreate) {
    btnConfirmCreate.addEventListener('click', () => {
        const mapVal = document.getElementById('select-map') ? document.getElementById('select-map').value : 'field';
        const weather = selectWeather ? selectWeather.value : 'sunny';
        const birds = document.getElementById('check-birds') ? document.getElementById('check-birds').checked : false;
        const animals = document.getElementById('check-animals') ? document.getElementById('check-animals').checked : false;
        const difficulty = selectDifficulty ? selectDifficulty.value : 'normal';
        const charTypeOpt = selectCharTypeOptions ? selectCharTypeOptions.value || 2 : 2;
        myProfile.charType = charTypeOpt;
        gameOptionsModal.classList.add('hidden');
        if (difficultyWrap) difficultyWrap.style.display = 'block';
        if (selectDifficulty) selectDifficulty.style.display = 'block';

        if (gameOptionsTargetMode === 'single') {
            aiDifficulty = difficulty;
            gameMode = 'single';
            startSinglePlayer({ map: mapVal, weather, birds, animals, difficulty });
        } else if (gameOptionsTargetMode === 'multiCreate') {
            socket.emit('createGame', { profile: myProfile, options: { map: mapVal, weather, birds, animals, charType: myProfile.charType } });
            multiMenu.classList.remove('hidden');
            if (createCodeContainer) createCodeContainer.classList.remove('hidden');
            if (joinCodeContainer) joinCodeContainer.classList.add('hidden');
            if (joinError) joinError.style.display = 'none';
        } else if (gameOptionsTargetMode === 'multiRandom') {
            socket.emit('findGame', { profile: myProfile, options: { map: mapVal, weather, birds, animals, charType: myProfile.charType } });
            waitingScreen.classList.remove('hidden');
        } else {
            socket.emit('findGame', { profile: myProfile, options: { map: mapVal, weather, birds, animals, charType: myProfile.charType } });
            waitingScreen.classList.remove('hidden');
        }
    });
}

if(document.getElementById('btn-cancel-multi')) {
    document.getElementById('btn-cancel-multi').addEventListener('click', () => {
        clearRandomWaitTimer();
        socket.emit('cancelFind');
        document.getElementById('waiting-screen').classList.add('hidden');
        multiMenu.classList.remove('hidden');
        document.getElementById('menu-screen').classList.add('hidden');
    });
}

socket.on('gameCreated', (code) => {
    if (createCodeContainer) createCodeContainer.classList.remove('hidden');
    if (createCodeText) createCodeText.innerText = String(code || '');
    if (joinError) joinError.style.display = 'none';
});

socket.on('joinError', () => {
    if (joinError) joinError.style.display = 'block';
});

socket.on('waiting', () => {
    waitingScreen.classList.remove('hidden');
    multiMenu.classList.add('hidden');
    menuScreen.classList.add('hidden');
    startRandomWaitTimer();
});

socket.on('friendsPresence', (payload) => {
    const statuses = payload && payload.statuses ? payload.statuses : {};
    myFriends = myFriends.map((f) => ({ ...f, online: !!statuses[f.playerId] }));
    saveFriends();
    renderFriendsList();
});

if (btnAddFriend) {
    btnAddFriend.addEventListener('click', () => {
        if (gameMode !== 'multi' || !currentOpponentProfile || !currentOpponentProfile.playerId) return;
        upsertFriend(currentOpponentProfile);
        renderFriendsList();
    });
}

socket.on('friendInvite', (payload) => {
    pendingFriendInvite = payload || null;
    if (!pendingFriendInvite) return;
    const fromName = pendingFriendInvite.fromProfile?.name || "Do'stingiz";
    if (friendInviteText) friendInviteText.innerText = `${fromName} sizni o'yinga chaqirdi. Qo'shilasizmi?`;
    if (friendInviteModal) friendInviteModal.classList.remove('hidden');
});

if (btnFriendInviteAccept) {
    btnFriendInviteAccept.addEventListener('click', () => {
        if (friendInviteModal) friendInviteModal.classList.add('hidden');
        if (!pendingFriendInvite) return;
        socket.emit('friendInviteResponse', { fromPlayerId: pendingFriendInvite.fromProfile?.playerId, accept: true });
        pendingFriendInvite = null;
    });
}

if (btnFriendInviteDecline) {
    btnFriendInviteDecline.addEventListener('click', () => {
        if (friendInviteModal) friendInviteModal.classList.add('hidden');
        if (!pendingFriendInvite) return;
        socket.emit('friendInviteResponse', { fromPlayerId: pendingFriendInvite.fromProfile?.playerId, accept: false });
        pendingFriendInvite = null;
    });
}

if (btnAddFriendId) {
    btnAddFriendId.addEventListener('click', () => {
        const fid = (inputFriendId?.value || '').replace(/\D/g, '').slice(0, 5);
        if (fid.length !== 5) {
            if (friendIdStatus) {
                friendIdStatus.style.color = '#f87171';
                friendIdStatus.innerText = "ID 5 ta raqam bo'lishi kerak.";
            }
            return;
        }
        if (friendIdStatus) {
            friendIdStatus.style.color = '#93c5fd';
            friendIdStatus.innerText = "Tekshirilmoqda...";
        }
        if (socket && socket.connected) {
            socket.emit('registerProfile', myProfile);
        }
        socket.emit('lookupFriendById', { friendId: fid, profile: myProfile });
    });
}

socket.on('friendLookupResult', (payload) => {
    if (!payload || !payload.ok || !payload.friend) {
        if (friendIdStatus) {
            friendIdStatus.style.color = '#f87171';
            if (payload?.reason === 'self') {
                friendIdStatus.innerText = "O'zingizga so'rov yubora olmaysiz.";
            } else if (payload?.reason === 'invalid') {
                friendIdStatus.innerText = "ID noto'g'ri. 5 ta raqam kiriting.";
            } else if (payload?.reason === 'declined') {
                friendIdStatus.innerText = "Do'stlik so'rovi rad etildi.";
            } else {
                friendIdStatus.innerText = "Do'st topilmadi yoki offline.";
            }
        }
        return;
    }
    if (payload.friend.playerId === myProfile.playerId) {
        if (friendIdStatus) {
            friendIdStatus.style.color = '#f87171';
            friendIdStatus.innerText = "O'zingizni do'stga qo'shib bo'lmaydi.";
        }
        return;
    }
    if (payload.pending) {
        if (friendIdStatus) {
            friendIdStatus.style.color = '#60a5fa';
            friendIdStatus.innerText = `${payload.friend.name} ga do'stlik so'rovi yuborildi.`;
        }
        if (inputFriendId) inputFriendId.value = '';
        return;
    }
    upsertFriend(payload.friend);
    renderFriendsList();
    if (inputFriendId) inputFriendId.value = '';
    if (friendIdStatus) {
        friendIdStatus.style.color = '#4ade80';
        friendIdStatus.innerText = `${payload.friend.name} do'stlar ro'yxatiga qo'shildi.`;
    }
});

socket.on('friendAddRequest', (payload) => {
    pendingFriendAddRequest = payload || null;
    if (!pendingFriendAddRequest) return;
    const fromName = pendingFriendAddRequest.fromProfile?.name || "Do'st";
    if (friendAddText) friendAddText.innerText = `${fromName} sizga do'stlik so'rovi yubordi. Qabul qilasizmi?`;
    if (friendAddModal) friendAddModal.classList.remove('hidden');
});

if (btnFriendAddAccept) {
    btnFriendAddAccept.addEventListener('click', () => {
        if (friendAddModal) friendAddModal.classList.add('hidden');
        if (!pendingFriendAddRequest) return;
        socket.emit('friendAddRequestResponse', {
            fromPlayerId: pendingFriendAddRequest.fromProfile?.playerId,
            accept: true
        });
        pendingFriendAddRequest = null;
    });
}

if (btnFriendAddDecline) {
    btnFriendAddDecline.addEventListener('click', () => {
        if (friendAddModal) friendAddModal.classList.add('hidden');
        if (!pendingFriendAddRequest) return;
        socket.emit('friendAddRequestResponse', {
            fromPlayerId: pendingFriendAddRequest.fromProfile?.playerId,
            accept: false
        });
        pendingFriendAddRequest = null;
    });
}

socket.on('friendAdded', (payload) => {
    if (!payload || !payload.friend) return;
    upsertFriend(payload.friend);
    renderFriendsList();
    if (friendIdStatus && payload.byRequest) {
        friendIdStatus.style.color = '#4ade80';
        friendIdStatus.innerText = `${payload.friend.name} bilan do'st bo'ldingiz.`;
    }
});

if(document.getElementById('btn-send-chat')) {
    document.getElementById('btn-send-chat').addEventListener('click', () => {
        const input = document.getElementById('chat-input');
        if (input && input.value.trim() !== '') {
            socket.emit('chatMessage', input.value.trim());
            input.value = '';
        }
    });
}
if (chatQuickEmojis) {
    chatQuickEmojis.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('.chat-emoji-btn') : null;
        if (!btn || gameMode !== 'multi') return;
        const msg = String(btn.dataset.emoji || '').trim();
        if (!msg) return;
        socket.emit('chatMessage', msg);
        addChatMessage(msg, true);
    });
}
