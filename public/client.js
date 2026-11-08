const IS_NATIVE_APP = (() => {
    const hasCapacitor = !!window.Capacitor;
    const viaCapacitor = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
    const viaProtocol = String(window.location?.protocol || '').startsWith('capacitor');
    const host = String(window.location?.hostname || '');
    const port = String(window.location?.port || '');
    // Capacitor Android app odatda http://localhost:8080/ dan ishlaydi
    const viaAndroidWebView = /android/i.test(String(navigator.userAgent || '')) && host === 'localhost' && (port === '' || port === '8080');
    return hasCapacitor || viaCapacitor || viaProtocol || viaAndroidWebView;
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
    on: () => { },
    emit: () => { },
    off: () => { },
    disconnect: () => { }
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

// --- Telegram WebApp Integratsiyasi ---
const tg = window.Telegram?.WebApp;
if (tg) {
    try {
        if (typeof tg.ready === 'function') tg.ready();
        if (typeof tg.expand === 'function') tg.expand();
        const hasV61 = typeof tg.isVersionAtLeast === 'function' ? tg.isVersionAtLeast('6.1') : false;
        const hasV80 = typeof tg.isVersionAtLeast === 'function' ? tg.isVersionAtLeast('8.0') : false;
        if (hasV80 && typeof tg.requestFullscreen === 'function') {
            try { tg.requestFullscreen(); } catch (_) { }
        }
        if (hasV61) {
            if (typeof tg.setHeaderColor === 'function') tg.setHeaderColor('#111827');
            if (typeof tg.setBackgroundColor === 'function') tg.setBackgroundColor('#0b0f19');
        }
    } catch (e) {
        console.warn('Telegram WebApp init warning:', e);
    }
}

function triggerHaptic(type = 'light') {
    try {
        if (tg && tg.HapticFeedback) {
            if (['light', 'medium', 'heavy', 'rigid', 'soft'].includes(type)) {
                tg.HapticFeedback.impactOccurred(type);
            } else if (['success', 'warning', 'error'].includes(type)) {
                tg.HapticFeedback.notificationOccurred(type);
            } else if (type === 'selection') {
                tg.HapticFeedback.selectionChanged();
            }
        }
    } catch (e) { }
}

let trajectoryLine = null;
let hintTrajectoryLine = null;      // Avvalgi otish trayektoriyasi (yordamchi hint)
let lastPlayerShot = null;          // O'yinchining oxirgi otish parametrlari
const mixers = [];

// Three.js TextureLoader: relative URL'lar bilan ishlatamiz - bu web va Android Capacitor ikkala muhitda ham ishlaydi.
// THREE.TextureLoader avtomatik ravishda image yuklangach material'ni yangilaydi (needsUpdate orqali).

function loadTextureWithBgRemoval(url) {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const tex = loader.load(url, (loadedTex) => {
        const img = loadedTex.image;
        if (!img) return;
        try {
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
                    if (Math.abs(data[i] - bgR) < 50 && Math.abs(data[i + 1] - bgG) < 50 && Math.abs(data[i + 2] - bgB) < 50) {
                        data[i + 3] = 0;
                    }
                }
                ctx.putImageData(imgData, 0, 0);
                loadedTex.image = canvas;
                loadedTex.needsUpdate = true;
            }
        } catch (e) {
            console.warn('BG removal failed for', url, e);
        }
    }, undefined, (err) => {
        console.error('Texture(BG) load error:', url, err);
    });
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    return tex;
}

function loadTexture(url, options = {}) {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const tex = loader.load(url, (loadedTex) => {
        if (options.removeBg && loadedTex.image) {
            try {
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
            } catch (e) {
                console.warn('BG removal failed for', url, e);
            }
        }
        loadedTex.needsUpdate = true;
    }, undefined, (err) => {
        console.error('Texture load error:', url, err);
    });
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    return tex;
}

const soldierTexture = loadTexture('Kamonlik%20Usmoniy/kamonlik%201.png');
const nayzabozTexture = loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayza%201.png');
const qargaTexture = loadTexture('qarga.png');
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
    shieldAfterShot: loadTexture('Kamonlik%20Usmoniy/kamonlik%20uq%20uzdi.png'),
    noShieldIdle: loadTexture('Kamonlik%20Usmoniy/kamonlik%20qalqonsiz%20stand.png'),
    noShieldAim: loadTexture('Kamonlik%20Usmoniy/kamonlik%20qalqonsiz%20oq%20uzadi.png'),
    noShieldDefend: loadTexture('Kamonlik%20Usmoniy/kamonlik%20qalqonsiz%20himoyalanyapti.png'),
    noShieldHurt: loadTexture('Kamonlik%20Usmoniy/yaradorkamonbozqalqonsiz.png'),
    noShieldAfterShot: loadTexture('Kamonlik%20Usmoniy/kamonlik%20uq%20uzdi.png'),
    celebrate: loadTexture('Kamonlik%20Usmoniy/kamonlik%201.png'),
    bgMusic: 'jumongsound.mp3'
};

const ottomanSpearmanTextures = {
    shieldIdle: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayza%201.png'),
    shieldAim: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayza%202.png'),
    shieldDefend: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayza%203.png'),
    shieldDuck: loadTexture('Nayzalik%20Usmoniy/qalqonnayzautirgan.png'),
    shieldHurt: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayza%204.png'),
    shieldBreak: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayza%205.png'),
    shieldAfterShot: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayza%202.png'),
    noShieldIdle: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayzalik%20qalqonsiz%201.png'),
    noShieldAim: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayzalik%20qalqonsiz%202.png'),
    noShieldDuck: loadTexture('Nayzalik%20Usmoniy/nayzaqalqonsizutirgan.png'),
    noShieldDefend: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayzalik%20qalqonsiz%202.png'),
    noShieldHurt: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayzasiz%20qalqonsiz%201.png'),
    noShieldAfterShot: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayzasiz%20qalqonsiz%201.png'),
    celebrate: loadTexture('Nayzalik%20Usmoniy/Jangchi%20nayzasiz%20qalqonsiz%20galaba%20nishonlash.png'),
    bgMusic: 'music.mp3'
};

window.customModelsInfo = [];
window.customModelTextures = {};

async function fetchCustomModels() {
    let data = [];
    try {
        const res = await fetch('/api/models');
        if (res.ok) data = await res.json();
        else throw new Error('API Fail');
    } catch (e) {
        console.warn('API fetch failed, trying local custom_models.json');
        try {
            const resLocal = await fetch('custom_models.json');
            if (resLocal.ok) data = await resLocal.json();
        } catch (e2) {
            console.error('Local models failed:', e2);
        }
    }

    if (data && data.length > 0) {
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
        if (typeof setupCustomDropdown === 'function') {
            setupCustomDropdown('select-char-type-options');
            setupCustomDropdown('select-char-type');
        }

        data.forEach(m => {
            const raw = m.textures || {};
            const defIdle = raw.shieldIdle || raw.noShieldIdle || 'Kamonlik%20Usmoniy/kamonlik%201.png';
            window.customModelTextures[m.id] = {
                shieldIdle: loadTexture(raw.shieldIdle || defIdle),
                shieldAim: loadTexture(raw.shieldAim || raw.noShieldAim || defIdle),
                shieldDuck: loadTexture(raw.shieldDuck || raw.noShieldDuck || defIdle),
                shieldDefend: loadTexture(raw.shieldDefend || raw.noShieldDefend || defIdle),
                shieldHurt: loadTexture(raw.shieldHurt || raw.noShieldHurt || raw.shieldIdle || defIdle),
                shieldBreak: loadTexture(raw.shieldBreak || raw.noShieldIdle || raw.shieldIdle || defIdle),
                shieldAfterShot: loadTexture(raw.shieldAfterShot || raw.noShieldAfterShot || raw.shieldAim || defIdle),
                shieldJump: loadTexture(raw.shieldJump || raw.shieldDuck || raw.shieldIdle || defIdle),
                noShieldIdle: loadTexture(raw.noShieldIdle || raw.shieldIdle || defIdle),
                noShieldAim: loadTexture(raw.noShieldAim || raw.shieldAim || defIdle),
                noShieldDuck: loadTexture(raw.noShieldDuck || raw.shieldDuck || defIdle),
                noShieldDefend: loadTexture(raw.noShieldDefend || raw.shieldDefend || defIdle),
                noShieldHurt: loadTexture(raw.noShieldHurt || raw.shieldHurt || raw.noShieldIdle || defIdle),
                noShieldAfterShot: loadTexture(raw.noShieldAfterShot || raw.shieldAfterShot || raw.noShieldAim || defIdle),
                noShieldJump: loadTexture(raw.noShieldJump || raw.shieldJump || raw.noShieldDuck || raw.shieldDuck || defIdle),
                celebrate: loadTexture(raw.celebrate || raw.shieldIdle || defIdle),
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
    }
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
const btnNextLevel = document.getElementById('btn-next-level');
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
const jumpButton = document.getElementById('jump-button');
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
const btnBuyArtillery = document.getElementById('btn-buy-artillery');
const btnBuyCrowhunt = document.getElementById('btn-buy-crowhunt');
const btnBuyFire = document.getElementById('btn-buy-fire');
const ARTILLERY_BUY_COST = 250;
const CROWHUNT_BUY_COST = 150;
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

// Brauzer tab / ilova fon rejimiga ketganda musiqani pauza qilish
document.addEventListener('visibilitychange', () => {
    try {
        if (document.hidden) {
            if (bgMusicAudio) bgMusicAudio.pause();
        } else {
            if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
            if (bgMusicAudio && !musicMuted) {
                bgMusicAudio.play().catch(() => { });
            }
        }
    } catch (_) {
        // ignore audio errors
    }
});

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
    bgMusicAudio.play().catch(() => { });
    preloadAllSfx();
}

function applySelectedMusicTrack() {
    if (!bgMusicAudio) return;
    if (musicMuted) {
        try { bgMusicAudio.pause(); } catch (_) { }
        return;
    }
    const currentSrc = String(bgMusicAudio.src || '');
    if (currentSrc.endsWith(selectedMusicTrack)) {
        bgMusicAudio.volume = musicVolume;
        try { bgMusicAudio.play().catch(() => { }); } catch (_) { }
        return;
    }
    bgMusicAudio.src = selectedMusicTrack;
    bgMusicAudio.loop = true;
    bgMusicAudio.preload = 'auto';
    bgMusicAudio.volume = musicVolume;
    try { bgMusicAudio.play().catch(() => { }); } catch (_) { }
    preloadAllSfx();
}

const sfxPool = {};
function preloadAllSfx() {
    try {
        Object.entries(sfxPaths).forEach(([key, src]) => {
            if (!sfxPool[key]) {
                const a = new Audio(src);
                a.preload = 'auto';
                a.load();
                sfxPool[key] = a;
            }
        });
    } catch (_) {}
}

function playSfx(key, volumeScale = 1) {
    if (sfxMuted) return;
    const src = sfxPaths[key];
    if (!src) return;
    try {
        if (!audioCtx) initAudio();
        else if (audioCtx.state === 'suspended') audioCtx.resume();
        let audio = sfxPool[key];
        if (!audio) {
            audio = new Audio(src);
            audio.preload = 'auto';
            sfxPool[key] = audio;
        }
        if (!audio.paused && audio.currentTime > 0) {
            const clone = audio.cloneNode();
            clone.volume = Math.max(0, Math.min(1, (sfxVolume || 0.8) * volumeScale));
            clone.play().catch(() => {});
            return;
        }
        audio.currentTime = 0;
        audio.volume = Math.max(0, Math.min(1, (sfxVolume || 0.8) * volumeScale));
        audio.play().catch(() => {});
    } catch (_) { }
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
    for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = 20;
        colors[i * 3] = 1.0;
        colors[i * 3 + 1] = Math.random() * 0.6 + 0.1;
        colors[i * 3 + 2] = 0.0;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({ size: 10, vertexColors: true, transparent: true, opacity: 1 });
    const explosion = new THREE.Points(geometry, material);
    scene.add(explosion);

    const velocities = [];
    for (let i = 0; i < particleCount; i++) {
        velocities.push({
            vx: (Math.random() - 0.5) * 800,
            vy: (Math.random() - 0.5) * 800
        });
    }
    explosion.userData = { vels: velocities, age: 0 };
    if (!window.explosions) window.explosions = [];
    window.explosions.push(explosion);

    // Portlash ovozi: 'break' kaliti sfxPaths da yo'q edi (jim qolardi).
    // Mavjud zarba ovozini balandroq ijro etamiz.
    playSfx('ground', 1.4);

    setTimeout(() => {
        cinematicMode = false;
    }, 2000);
}

function startBackgroundMusic() {
    // Oscillator olib tashlandi - u doimiy buzilgan ovoz berardi.
    // Haqiqiy fon musiqasi bgMusicAudio (Audio element) orqali o'ynatiladi.
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
    if (btnVolMute) btnVolMute.innerText = musicMuted ? '🔇' : '🔊';
    if (btnMusicToggle) btnMusicToggle.innerText = musicMuted ? '🔇' : '🔊';

    if (bgMusicAudio) {
        if (musicMuted) {
            try { bgMusicAudio.pause(); } catch (_) { }
        } else {
            bgMusicAudio.volume = musicVolume;
            try { bgMusicAudio.play().catch(() => { }); } catch (_) { }
        }
    }
    if (!musicMuted) {
        applySelectedMusicTrack();
    }
}

// Three.js Setup (Cinematic)
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a0b2e);
scene.fog = new THREE.FogExp2(0x1a0b2e, 0.00018);
const MOBILE_PERF_MODE = IS_NATIVE_APP;

// Radial glow teksturasi - quyosh/oy diski va yorug'lik effektlari uchun.
function makeRadialGlowTexture(innerColor = '#ffffff', outerColor = '#ffcc66') {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, innerColor);
    grad.addColorStop(0.45, outerColor);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

function tryLockLandscapeOrientation() {
    const tgApp = window.Telegram?.WebApp;
    if (tgApp) {
        try {
            if (typeof tgApp.expand === 'function') tgApp.expand();
            const hasV80 = typeof tgApp.isVersionAtLeast === 'function' ? tgApp.isVersionAtLeast('8.0') : false;
            if (hasV80) {
                if (typeof tgApp.requestFullscreen === 'function') tgApp.requestFullscreen();
                if (typeof tgApp.lockOrientation === 'function') tgApp.lockOrientation('landscape');
            }
        } catch (_) { }
    }
    try {
        if (screen.orientation && typeof screen.orientation.lock === 'function') {
            screen.orientation.lock('landscape').catch(() => { });
        }
    } catch (_) { }
}
tryLockLandscapeOrientation();

function getAppViewport() {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (window.matchMedia && window.matchMedia('(max-width: 950px)').matches);
    const needRotate = isMobileDevice && (winW < winH);

    const isLandscapePhone = (winW >= winH && (winH <= 650 || isMobileDevice)) || (winH <= 520);
    document.body.classList.toggle('mobile-landscape', isLandscapePhone);

    if (needRotate) {
        if (!document.body.classList.contains('force-landscape')) {
            document.body.classList.add('force-landscape');
        }
        return {
            width: winH,
            height: winW,
            isRotated: true
        };
    } else {
        if (document.body.classList.contains('force-landscape')) {
            document.body.classList.remove('force-landscape');
        }
        return {
            width: winW,
            height: winH,
            isRotated: false
        };
    }
}

let frustumSize = 800;
const initialVp = getAppViewport();
let aspect = initialVp.width / Math.max(1, initialVp.height);
const camera = new THREE.OrthographicCamera(frustumSize * aspect / -2, frustumSize * aspect / 2, frustumSize / 2, frustumSize / -2, 1, 3000);
camera.position.set(0, 0, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: !MOBILE_PERF_MODE, powerPreference: "high-performance" });

function getPreferredPixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    return Math.min(dpr, MOBILE_PERF_MODE ? 1.6 : 2.5);
}

renderer.setSize(initialVp.width, initialVp.height);
renderer.setPixelRatio(getPreferredPixelRatio());
renderer.shadowMap.enabled = !MOBILE_PERF_MODE;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
else renderer.outputEncoding = THREE.sRGBEncoding;
container.appendChild(renderer.domElement);

// Android WebView'da ba'zan WebGL context yo'qolib qolishi mumkin (qora ekran).
// Shunda sahifani qayta yuklab tiklaymiz.
try {
    renderer.domElement.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
    }, false);
    renderer.domElement.addEventListener('webglcontextrestored', () => {
        try { window.location.reload(); } catch (_) { }
    }, false);
} catch (_) { }

const ambientLight = new THREE.AmbientLight(0xffffff, 0.42);
scene.add(ambientLight);

// Osmon/yer rangidan keluvchi yumshoq yorug'lik - sahnaga tabiiy hajm beradi.
const hemiLight = new THREE.HemisphereLight(0xbfe3ff, 0x4a3b2a, 0.55);
hemiLight.position.set(0, 1000, 0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xfff2d9, 1.45);
dirLight.position.set(200, 1000, 500);
dirLight.castShadow = !MOBILE_PERF_MODE;
dirLight.shadow.mapSize.width = MOBILE_PERF_MODE ? 1024 : 2048;
dirLight.shadow.mapSize.height = MOBILE_PERF_MODE ? 1024 : 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 1500;
dirLight.shadow.bias = -0.0005;
const d = 1000;
dirLight.shadow.camera.left = -d; dirLight.shadow.camera.right = d; dirLight.shadow.camera.top = d; dirLight.shadow.camera.bottom = -d;
scene.add(dirLight);

const rimLight = new THREE.DirectionalLight(0x6688ff, 0.6);
rimLight.position.set(-200, 100, -300);
scene.add(rimLight);

// Quyosh/oy disk (sahna foni uchun glow effekti)
const sunSpriteMat = new THREE.SpriteMaterial({
    map: makeRadialGlowTexture('#fff6cf', '#ffd36b'),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending
});
const sunSprite = new THREE.Sprite(sunSpriteMat);
sunSprite.scale.set(900, 900, 1);
sunSprite.position.set(-1100, 780, -900);
scene.add(sunSprite);

// Tun uchun yulduzlar (statik nuqtalar)
const starGeo = new THREE.BufferGeometry();
const starCount = MOBILE_PERF_MODE ? 220 : 420;
const starPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
    starPos[i * 3] = (Math.random() - 0.5) * 6000;
    starPos[i * 3 + 1] = 250 + Math.random() * 950;
    starPos[i * 3 + 2] = -1200 - Math.random() * 400;
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 5, transparent: true, opacity: 0, depthWrite: false });
const starField = new THREE.Points(starGeo, starMat);
starField.visible = false;
// scene.add(starField); -- O'chirildi (ekranni tiniq saqlash uchun ortiqcha piksellar olib tashlandi)

const groundGeo = new THREE.BoxGeometry(40000, 15000, 2000);
groundGeo.translate(0, -7400, 0);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9, metalness: 0.1 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.position.y = -400;
ground.receiveShadow = true;
scene.add(ground);
const rocks = [];
const groundPebbleGroup = new THREE.Group();
groundPebbleGroup.name = 'ground-pebble-line';

// Barcha xaritalarda yer sathini aniq belgilovchi kichik toshchalar (pebbles) chizig'i
const pebbleMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.95, metalness: 0.05 });
const groundSurfaceLevelY = -300; // ground.position.y + 100
const pebbleStep = 36;
for (let px = -16000; px <= 16000; px += pebbleStep) {
    const pSize = 2.4 + (Math.sin(px * 0.013) * 0.8 + 1.0) * 1.6;
    const pebbleGeo = new THREE.DodecahedronGeometry(pSize, 0);
    const pebble = new THREE.Mesh(pebbleGeo, pebbleMat.clone());
    const yJitter = (Math.sin(px * 0.07) * 1.5);
    pebble.position.set(
        px + (Math.sin(px * 0.23) * 6),
        groundSurfaceLevelY + yJitter,
        15 + (Math.cos(px * 0.31) * 4)
    );
    pebble.scale.set(1.1, 0.65, 0.9);
    pebble.rotation.set(Math.sin(px) * 2, Math.cos(px) * 2, 0);
    pebble.castShadow = !MOBILE_PERF_MODE;
    pebble.receiveShadow = true;
    groundPebbleGroup.add(pebble);
    rocks.push(pebble);
}

// Mayda toshlar ostidagi nozik zamin chizig'i
const groundSeamGeo = new THREE.PlaneGeometry(36000, 3.5);
const groundSeamMat = new THREE.MeshBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.75, depthWrite: false });
const groundSeam = new THREE.Mesh(groundSeamGeo, groundSeamMat);
groundSeam.name = 'ground-seam-line';
groundSeam.position.set(0, groundSurfaceLevelY - 0.5, 14.5);
groundPebbleGroup.add(groundSeam);
scene.add(groundPebbleGroup);

const dustGeo = new THREE.BufferGeometry();
const dustCount = MOBILE_PERF_MODE ? 220 : 500;
const dustPos = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount * 3; i++) {
    dustPos[i] = (Math.random() - 0.5) * 4000;
    if (i % 3 === 1) dustPos[i] = Math.random() * 800 - 300;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustMat = new THREE.PointsMaterial({ color: 0xffddaa, size: 4, transparent: true, opacity: 0 });
const dustSystem = new THREE.Points(dustGeo, dustMat);
dustSystem.visible = false;
// scene.add(dustSystem); -- O'chirildi (ekran tiniq bo'lishi uchun)
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
    // Foydalanuvchi talabi: ortiqcha uchib yuruvchi mayda piksellar/qor/yomg'ir zarrachalari o'chirildi, ekran tiniq saqlanadi
    return;

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
    const body = new THREE.Mesh(new THREE.BoxGeometry(25, 15, 12), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
    body.position.y = 12;
    const head = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    head.position.set(12, 20, 0);
    group.add(body); group.add(head);
    group.children.forEach(c => c.castShadow = true);
    return group;
}

// ============================================================
//  Tarixiy shahar va tabiat sahnalari uchun procedural backdrop'lar
//  (Three.js geometriyasi bilan — tashqi rasmsiz, ishonchli ishlaydi)
// ============================================================

// Gumbazli machit/madrasa (Samarqand/Buxoro/Istanbul uslubida).
function makeDomedBuilding(opts) {
    const g = new THREE.Group();
    const bodyColor = opts.bodyColor;
    const domeColor = opts.domeColor;
    const bw = opts.width;
    const bh = opts.height;
    // Asosiy bino tanasi
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(bw, bh, 40),
        new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.85, flatShading: true })
    );
    body.position.y = bh / 2;
    g.add(body);
    // Markaziy peshtoq (iwan) - to'q kirish ravog'i
    const portal = new THREE.Mesh(
        new THREE.BoxGeometry(bw * 0.34, bh * 0.62, 6),
        new THREE.MeshStandardMaterial({ color: 0x16324a, roughness: 0.9 })
    );
    portal.position.set(0, bh * 0.32, 22);
    g.add(portal);
    // Asosiy gumbaz (firuza)
    const dome = new THREE.Mesh(
        new THREE.SphereGeometry(bw * 0.28, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: domeColor, roughness: 0.45, metalness: 0.25, flatShading: true })
    );
    dome.position.y = bh + bw * 0.06;
    g.add(dome);
    // Gumbaz uchidagi belgi
    const finial = new THREE.Mesh(
        new THREE.ConeGeometry(bw * 0.03, bh * 0.12, 8),
        new THREE.MeshStandardMaterial({ color: 0xf5d76e, metalness: 0.6, roughness: 0.3 })
    );
    finial.position.y = bh + bw * 0.34;
    g.add(finial);
    // Ikki yon minora
    for (const s of [-1, 1]) {
        const minaret = new THREE.Mesh(
            new THREE.CylinderGeometry(bw * 0.06, bw * 0.08, bh * 1.25, 10),
            new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.8, flatShading: true })
        );
        minaret.position.set(s * bw * 0.62, bh * 0.62, -6);
        g.add(minaret);
        const cap = new THREE.Mesh(
            new THREE.ConeGeometry(bw * 0.09, bh * 0.2, 10),
            new THREE.MeshStandardMaterial({ color: domeColor, roughness: 0.5, metalness: 0.2 })
        );
        cap.position.set(s * bw * 0.62, bh * 1.34, -6);
        g.add(cap);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    return g;
}

// === Cheksiz Osmon Tekstura Generatori (Infinite Sky Canvas) ===
function generateInfiniteSkyTexture(mapType, weather) {
    const canvas = document.createElement('canvas');
    const w = canvas.width = 1024;
    const h = canvas.height = 2048;
    const ctx = canvas.getContext('2d');
    const isNight = weather === 'night';
    const isStorm = weather === 'storm';
    const isRain = weather === 'rain';
    const isSnow = weather === 'snow';

    // 1. Vertikal osmon gradienti (Ufqdan to koinotgacha bo'lgan silliq o'tish)
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    if (isNight) {
        sky.addColorStop(0.0, '#010308');
        sky.addColorStop(0.3, '#030814');
        sky.addColorStop(0.6, '#081224');
        sky.addColorStop(0.85, '#0f203c');
        sky.addColorStop(1.0, '#1c345a');
    } else if (isStorm) {
        sky.addColorStop(0.0, '#0a0e14');
        sky.addColorStop(0.4, '#182430');
        sky.addColorStop(0.7, '#304254');
        sky.addColorStop(0.9, '#486074');
        sky.addColorStop(1.0, '#668094');
    } else if (isRain) {
        sky.addColorStop(0.0, '#12202e');
        sky.addColorStop(0.4, '#2c445c');
        sky.addColorStop(0.7, '#4e6e88');
        sky.addColorStop(0.9, '#6c90ab');
        sky.addColorStop(1.0, '#92b4cc');
    } else if (isSnow) {
        sky.addColorStop(0.0, '#264464');
        sky.addColorStop(0.4, '#527c9e');
        sky.addColorStop(0.7, '#86afd0');
        sky.addColorStop(0.9, '#b2d4ec');
        sky.addColorStop(1.0, '#e2f0fa');
    } else if (mapType === 'registan') {
        sky.addColorStop(0.0, '#041630');
        sky.addColorStop(0.35, '#0c3868');
        sky.addColorStop(0.65, '#1664aa');
        sky.addColorStop(0.85, '#389ade');
        sky.addColorStop(0.95, '#ffd284');
        sky.addColorStop(1.0, '#ffe8b4');
    } else if (mapType === 'sakura') {
        sky.addColorStop(0.0, '#0a102e');
        sky.addColorStop(0.35, '#1e2b5a');
        sky.addColorStop(0.6, '#4d5894');
        sky.addColorStop(0.82, '#8a7db6');
        sky.addColorStop(0.94, '#f8b9cd');
        sky.addColorStop(1.0, '#fff0f6');
    } else if (mapType === 'taiga') {
        sky.addColorStop(0.0, '#020a14');
        sky.addColorStop(0.3, '#081a2e');
        sky.addColorStop(0.55, '#0e344c');
        sky.addColorStop(0.78, '#1b546c');
        sky.addColorStop(0.92, '#388094');
        sky.addColorStop(1.0, '#76b4c4');
    } else if (mapType === 'citadel') {
        sky.addColorStop(0.0, '#0a0d14');
        sky.addColorStop(0.35, '#16202c');
        sky.addColorStop(0.65, '#283648');
        sky.addColorStop(0.85, '#425266');
        sky.addColorStop(0.95, '#6a5246');
        sky.addColorStop(1.0, '#8c6850');
    } else if (mapType === 'volcano') {
        sky.addColorStop(0.0, '#0c0402');
        sky.addColorStop(0.3, '#200b06');
        sky.addColorStop(0.6, '#44180e');
        sky.addColorStop(0.85, '#762612');
        sky.addColorStop(0.95, '#c43e14');
        sky.addColorStop(1.0, '#f86c1c');
    } else if (mapType === 'desert' || mapType === 'canyon') {
        sky.addColorStop(0.0, '#061c3a');
        sky.addColorStop(0.35, '#104074');
        sky.addColorStop(0.65, '#2072b4');
        sky.addColorStop(0.85, '#52a8ea');
        sky.addColorStop(0.95, '#f8c278');
        sky.addColorStop(1.0, '#ffe4aa');
    } else {
        sky.addColorStop(0.0, '#061e44');
        sky.addColorStop(0.35, '#0e3f7e');
        sky.addColorStop(0.65, '#1a6ac2');
        sky.addColorStop(0.85, '#3fa4f2');
        sky.addColorStop(0.96, '#a4d9ff');
        sky.addColorStop(1.0, '#dcf2ff');
    }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // 2. Kosmik yulduzlar (Yuqori stratosfera qatlami)
    const starCount = isNight ? 300 : 70;
    for (let s = 0; s < starCount; s++) {
        const sx = Math.random() * w;
        const sy = Math.random() * (isNight ? h * 0.78 : h * 0.38);
        const sr = 0.5 + Math.random() * (isNight ? 1.7 : 1.1);
        const sa = (0.3 + Math.random() * 0.7) * (isNight ? 1 : (1 - sy / (h * 0.38)));
        ctx.fillStyle = `rgba(255, 255, 255, ${sa.toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();
    }

    // 3. Tayga uchun Shimol yog'dusi nurlari (Aurora Borealis)
    if (mapType === 'taiga' || (isNight && Math.random() < 0.35)) {
        const aurGradient = ctx.createLinearGradient(0, h * 0.12, w, h * 0.42);
        aurGradient.addColorStop(0, 'rgba(46, 204, 113, 0)');
        aurGradient.addColorStop(0.3, 'rgba(46, 204, 113, 0.22)');
        aurGradient.addColorStop(0.6, 'rgba(26, 188, 156, 0.25)');
        aurGradient.addColorStop(0.8, 'rgba(155, 89, 182, 0.18)');
        aurGradient.addColorStop(1, 'rgba(155, 89, 182, 0)');
        ctx.fillStyle = aurGradient;
        ctx.beginPath();
        ctx.moveTo(0, h * 0.38);
        for (let x = 0; x <= w; x += 10) {
            const y = h * 0.26 + Math.sin(x * 0.008) * 60 + Math.cos(x * 0.015) * 30;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h * 0.44);
        ctx.lineTo(0, h * 0.44);
        ctx.closePath();
        ctx.fill();
    }

    // 4. Yuqori sirrus bulutlari
    if (!isNight && !isStorm) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        for (let c = 0; c < 5; c++) {
            const cy = h * 0.46 + c * 75;
            ctx.beginPath();
            ctx.ellipse(w * (0.2 + c * 0.16), cy, 180 + c * 30, 16, Math.PI * 0.02, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
}

// === Yuqori sifatli Canvas2D fon rasmlari generatori ===
function generateBackdropTexture(mapType, weather, width, height) {
    const canvas = document.createElement('canvas');
    const w = canvas.width = width || 2048;
    const h = canvas.height = height || 1024;
    const ctx = canvas.getContext('2d');
    const isNight = weather === 'night', isStorm = weather === 'storm', isRain = weather === 'rain', isSnow = weather === 'snow';

    // OSMON UFQI GRADIENTI
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.72);
    if (isNight) { sky.addColorStop(0, '#020810'); sky.addColorStop(1, '#1e3050'); }
    else if (isStorm) { sky.addColorStop(0, '#1a2a38'); sky.addColorStop(1, '#4a6070'); }
    else if (isRain) { sky.addColorStop(0, '#3a5a70'); sky.addColorStop(1, '#8ab0c8'); }
    else if (isSnow) { sky.addColorStop(0, '#a0c8e0'); sky.addColorStop(1, '#e8f4ff'); }
    else if (mapType === 'registan') { sky.addColorStop(0, '#145ea8'); sky.addColorStop(0.65, '#40a4e8'); sky.addColorStop(1, '#ffd088'); }
    else if (mapType === 'sakura') { sky.addColorStop(0, '#304278'); sky.addColorStop(0.65, '#6a78b4'); sky.addColorStop(1, '#f8c2d4'); }
    else if (mapType === 'taiga') { sky.addColorStop(0, '#0a2038'); sky.addColorStop(0.65, '#1c4864'); sky.addColorStop(1, '#68a8bc'); }
    else if (mapType === 'citadel') { sky.addColorStop(0, '#121822'); sky.addColorStop(0.65, '#2e3a4c'); sky.addColorStop(1, '#6a564c'); }
    else { sky.addColorStop(0, '#0a4a90'); sky.addColorStop(0.5, '#1a70c0'); sky.addColorStop(1, '#90d4f8'); }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Quyosh / Oy diski va yog'dusi
    if (!isStorm && !isRain) {
        const sx = isNight ? w * 0.8 : w * 0.22;
        const sy = h * 0.18;
        const sr = isNight ? 35 : 60;
        const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 4);
        sg.addColorStop(0, isNight ? 'rgba(220,235,255,0.9)' : 'rgba(255,250,200,0.95)');
        sg.addColorStop(0.3, isNight ? 'rgba(180,200,230,0.2)' : 'rgba(255,220,100,0.3)');
        sg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sg;
        ctx.fillRect(0, 0, w, h * 0.55);
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fillStyle = isNight ? '#e0eaff' : '#fff8e0';
        ctx.fill();
    }

    // Yulduzlar
    if (isNight) {
        for (let s = 0; s < 140; s++) {
            ctx.beginPath();
            ctx.arc(Math.random() * w, Math.random() * h * 0.45, 0.5 + Math.random() * 1.5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.7})`;
            ctx.fill();
        }
    }

    // Yengil bulutlar
    if (!isNight) {
        for (let c = 0; c < (isStorm ? 8 : 5); c++) {
            const cx = Math.random() * w, cy = h * 0.08 + Math.random() * h * 0.16;
            ctx.globalAlpha = isStorm ? 0.5 : 0.3;
            ctx.fillStyle = isStorm ? '#3a4a5a' : '#fff';
            for (let b = 0; b < 5; b++) {
                ctx.beginPath();
                ctx.arc(cx + b * 32 - 64, cy + Math.random() * 10, 26 + Math.random() * 28, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
    }

    // Sahna va landshaftlar
    const baseY = h * 0.70;
    _paintScene(ctx, w, h, baseY, mapType, weather);

    // Yer qatlami
    const gc = _getGroundColors(mapType, weather);
    const grd = ctx.createLinearGradient(0, baseY, 0, h);
    grd.addColorStop(0, gc[0]);
    grd.addColorStop(0.3, gc[1]);
    grd.addColorStop(1, gc[2]);
    ctx.fillStyle = grd;
    ctx.fillRect(0, baseY, w, h - baseY);

    ctx.globalAlpha = 0.14;
    for (let i = 0; i < 240; i++) {
        ctx.fillStyle = gc[3] || '#1a3010';
        ctx.fillRect(Math.random() * w, baseY + Math.random() * (h - baseY), 1 + Math.random() * 3, 2 + Math.random() * 5);
    }
    ctx.globalAlpha = 1;

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
}

function _getGroundColors(m, w) {
    if (w === 'night') return ['#1a2a1a', '#0f1a10', '#080e08', '#0a1a08'];
    if (m === 'registan') return ['#d4a858', '#b88a38', '#8a6420', '#c89c44'];
    if (m === 'sakura') return ['#3e8848', '#2e6c38', '#1c4c24', '#52a85e'];
    if (m === 'taiga') return ['#24402a', '#182e1c', '#0e1e12', '#325838'];
    if (m === 'citadel') return ['#3e444a', '#2a3036', '#1a2024', '#505860'];
    if (m === 'desert') return ['#d4a848', '#b88a30', '#8a6820', '#c09838'];
    if (m === 'winter' || w === 'snow') return ['#e8f0f8', '#d0e0ea', '#b0c8d8', '#c8dae8'];
    if (m === 'volcano') return ['#2a1810', '#1a100a', '#0e0806', '#201008'];
    if (m === 'canyon') return ['#c07038', '#a05828', '#804020', '#b06830'];
    if (m === 'oasis') return ['#3a8830', '#2a6a20', '#1a4a14', '#2a7a28'];
    if (m === 'samarkand' || m === 'bukhara') return ['#c8a868', '#a88848', '#806830', '#b09050'];
    if (m === 'istanbul') return ['#5a8050', '#4a6a40', '#3a5030', '#4a7a40'];
    return ['#4a9a38', '#3a7a28', '#2a5a1a', '#3a8a30'];
}

function _paintScene(ctx, w, h, baseY, mapType, weather) {
    const n = weather === 'night';
    if (mapType === 'registan') _paintRegistan(ctx, w, h, baseY, n);
    else if (mapType === 'sakura') _paintSakura(ctx, w, h, baseY, n);
    else if (mapType === 'taiga') _paintTaiga(ctx, w, h, baseY, n);
    else if (mapType === 'citadel') _paintCitadel(ctx, w, h, baseY, n);
    else if (mapType === 'samarkand' || mapType === 'bukhara' || mapType === 'istanbul') _paintCity(ctx, w, h, baseY, mapType, n);
    else if (mapType === 'mountain' || mapType === 'winter') _paintMountains(ctx, w, h, baseY, weather);
    else if (mapType === 'desert') _paintDesert(ctx, w, h, baseY, n);
    else if (mapType === 'volcano') _paintVolcano(ctx, w, h, baseY);
    else if (mapType === 'canyon') _paintCanyon(ctx, w, h, baseY);
    else if (mapType === 'oasis') _paintOasis(ctx, w, h, baseY, n);
    else if (mapType === 'castle') _paintCastle(ctx, w, h, baseY, n);
    else _paintField(ctx, w, h, baseY, n);
}

// 1. Registon maydoni: Peshtoq portallari, qovurg'ali moviy gumbazlar va minoralar
function _paintRegistan(ctx, w, h, baseY, n) {
    const duneCols = n ? ['#1e1610', '#2a2014'] : ['#cda152', '#b8893a'];
    for (let d = 0; d < 2; d++) {
        ctx.fillStyle = duneCols[d];
        ctx.beginPath();
        ctx.moveTo(0, baseY);
        for (let x = 0; x <= w; x += 4) {
            const y = baseY - (25 + d * 22) - Math.sin(x * 0.002 + d * 1.8) * 35;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(w, baseY);
        ctx.closePath();
        ctx.fill();
    }

    const wallCol = n ? '#141c28' : '#be955c';
    const wallDark = n ? '#0c121c' : '#947240';
    const domeTurquoise = n ? '#0e4a5c' : '#10b8d4';
    const domeDark = n ? '#072832' : '#0c7d92';
    const goldTrim = n ? '#6a501a' : '#f0b830';

    const centers = [w * 0.28, w * 0.5, w * 0.72];
    centers.forEach((cx, idx) => {
        const isMain = (idx === 1);
        const pw = isMain ? 240 : 180;
        const ph = isMain ? 320 : 250;
        const px = cx - pw / 2;
        const py = baseY - ph;

        const wg = ctx.createLinearGradient(px, py, px, baseY);
        wg.addColorStop(0, wallCol);
        wg.addColorStop(1, wallDark);
        ctx.fillStyle = wg;
        ctx.fillRect(px, py, pw, ph);

        ctx.strokeStyle = domeTurquoise;
        ctx.lineWidth = 6;
        ctx.strokeRect(px + 12, py + 12, pw - 24, ph - 12);

        const archW = pw * 0.56;
        const archH = ph * 0.62;
        const archX = cx - archW / 2;
        const archY = baseY - archH;

        ctx.fillStyle = n ? '#070c14' : '#684d28';
        ctx.beginPath();
        ctx.moveTo(archX, baseY);
        ctx.lineTo(archX, archY + archH * 0.35);
        ctx.quadraticCurveTo(archX, archY, cx, archY - 15);
        ctx.quadraticCurveTo(archX + archW, archY, archX + archW, archY + archH * 0.35);
        ctx.lineTo(archX + archW, baseY);
        ctx.closePath();
        ctx.fill();

        if (n) {
            const fl = ctx.createRadialGradient(cx, baseY - archH * 0.4, 0, cx, baseY - archH * 0.4, 60);
            fl.addColorStop(0, 'rgba(255, 180, 50, 0.6)');
            fl.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = fl;
            ctx.fillRect(archX, archY - 20, archW, archH + 20);
        }

        for (const gx of [cx - pw * 0.36, cx + pw * 0.36]) {
            const dw = isMain ? 72 : 54;
            const dh = isMain ? 90 : 68;
            const dy = py - dh * 0.55;

            ctx.fillStyle = wallCol;
            ctx.fillRect(gx - dw / 2, dy, dw, dh * 0.6);

            const dg = ctx.createLinearGradient(gx - dw / 2, dy - dh * 0.4, gx + dw / 2, dy);
            dg.addColorStop(0, domeTurquoise);
            dg.addColorStop(1, domeDark);
            ctx.fillStyle = dg;
            ctx.beginPath();
            ctx.arc(gx, dy, dw / 2, Math.PI, 0);
            ctx.fill();

            ctx.fillStyle = goldTrim;
            ctx.fillRect(gx - 2, dy - dw / 2 - 14, 4, 14);
            ctx.beginPath();
            ctx.arc(gx, dy - dw / 2 - 16, 5, 0, Math.PI * 2);
            ctx.fill();
        }

        for (const mx of [px - 16, px + pw + 6]) {
            const mw = 18;
            const mh = ph + (isMain ? 65 : 45);
            const my = baseY - mh;

            ctx.fillStyle = wallCol;
            ctx.fillRect(mx, my, mw, mh);

            ctx.fillStyle = goldTrim;
            ctx.fillRect(mx - 4, my + 15, mw + 8, 8);

            ctx.fillStyle = domeTurquoise;
            ctx.beginPath();
            ctx.arc(mx + mw / 2, my, mw * 0.65, Math.PI, 0);
            ctx.fill();
        }
    });
}

// 2. Sakura bog'i: Fudzi tog'i, yapon pagodasi va pushti gullagan daraxtlar
function _paintSakura(ctx, w, h, baseY, n) {
    const fujiX = w * 0.5;
    const fujiW = 580;
    const fujiH = 360;
    const fujiTopY = baseY - fujiH;

    const fg = ctx.createLinearGradient(fujiX, fujiTopY, fujiX, baseY);
    fg.addColorStop(0, n ? '#1c1e38' : '#5a6288');
    fg.addColorStop(1, n ? '#0d1222' : '#8898b8');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(fujiX - fujiW / 2, baseY);
    ctx.quadraticCurveTo(fujiX - fujiW * 0.22, fujiTopY + 40, fujiX - 45, fujiTopY);
    ctx.lineTo(fujiX + 45, fujiTopY);
    ctx.quadraticCurveTo(fujiX + fujiW * 0.22, fujiTopY + 40, fujiX + fujiW / 2, baseY);
    ctx.closePath();
    ctx.fill();

    const snowH = fujiH * 0.32;
    ctx.fillStyle = n ? '#788ca8' : '#ffffff';
    ctx.beginPath();
    ctx.moveTo(fujiX - 45, fujiTopY);
    ctx.lineTo(fujiX + 45, fujiTopY);
    ctx.quadraticCurveTo(fujiX + 110, fujiTopY + snowH * 0.65, fujiX + 95, fujiTopY + snowH);
    for (let s = 3; s >= -3; s--) {
        ctx.lineTo(fujiX + s * 24, fujiTopY + snowH + (s % 2 === 0 ? 12 : -8));
    }
    ctx.quadraticCurveTo(fujiX - 110, fujiTopY + snowH * 0.65, fujiX - 45, fujiTopY);
    ctx.closePath();
    ctx.fill();

    const pagX = w * 0.82;
    const pagBaseH = 260;
    const pagMat = n ? '#10141e' : '#2d1b18';
    const vermilion = n ? '#4a1818' : '#b22222';

    ctx.fillStyle = pagMat;
    ctx.fillRect(pagX - 14, baseY - pagBaseH, 28, pagBaseH);

    for (let t = 0; t < 5; t++) {
        const ty = baseY - 60 - t * 45;
        const tw = 90 - t * 10;
        ctx.fillStyle = vermilion;
        ctx.beginPath();
        ctx.moveTo(pagX - tw / 2 - 12, ty);
        ctx.quadraticCurveTo(pagX - tw / 4, ty - 12, pagX, ty - 14);
        ctx.quadraticCurveTo(pagX + tw / 4, ty - 12, pagX + tw / 2 + 12, ty);
        ctx.lineTo(pagX + tw / 2, ty + 6);
        ctx.lineTo(pagX - tw / 2, ty + 6);
        ctx.closePath();
        ctx.fill();
    }
    ctx.strokeStyle = n ? '#50442a' : '#d4af37';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(pagX, baseY - pagBaseH);
    ctx.lineTo(pagX, baseY - pagBaseH - 35);
    ctx.stroke();

    const blossomColors = n
        ? ['#4a2838', '#5c3248', '#382030']
        : ['#ffb7c5', '#ffaec9', '#ffffff', '#ff94b4'];

    for (let tr = 0; tr < 12; tr++) {
        const tx = w * 0.05 + (w * 0.9 / 11) * tr + (Math.sin(tr * 4) * 35);
        const th = 90 + (tr % 3) * 35;
        const ty = baseY - th;

        ctx.strokeStyle = n ? '#161210' : '#4a2f24';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(tx, baseY);
        ctx.quadraticCurveTo(tx + (tr % 2 === 0 ? 15 : -15), baseY - th * 0.6, tx, ty);
        ctx.stroke();

        for (let b = 0; b < 7; b++) {
            const bx = tx + Math.cos(b * 1.1) * (26 + (b % 3) * 12);
            const by = ty + Math.sin(b * 1.1) * (18 + (b % 2) * 8);
            const br = 22 + (b % 3) * 8;
            ctx.fillStyle = blossomColors[(tr + b) % blossomColors.length];
            ctx.globalAlpha = n ? 0.75 : 0.88;
            ctx.beginPath();
            ctx.arc(bx, by, br, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
}

// 3. Sibir taygasi: Shimol yog'dusi, qorli tog'lar va qalin archazor
function _paintTaiga(ctx, w, h, baseY, n) {
    const aurCols = ['rgba(46, 204, 113, 0.28)', 'rgba(26, 188, 156, 0.25)', 'rgba(155, 89, 182, 0.2)'];
    aurCols.forEach((col, idx) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(0, baseY - 350);
        for (let x = 0; x <= w; x += 6) {
            const y = baseY - 350 - idx * 50 - Math.sin(x * 0.003 + idx * 1.5) * 80 - Math.cos(x * 0.008) * 30;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(w, baseY - 200);
        ctx.lineTo(0, baseY - 200);
        ctx.closePath();
        ctx.fill();
    });

    const peakCol = n ? '#0c1622' : '#3d4d5c';
    ctx.fillStyle = peakCol;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    for (let x = 0; x <= w; x += 5) {
        const y = baseY - 180 - Math.sin(x * 0.002) * 110 - Math.abs(Math.sin(x * 0.007)) * 50;
        ctx.lineTo(x, y);
    }
    ctx.lineTo(w, baseY);
    ctx.closePath();
    ctx.fill();

    const pineCols = n
        ? ['#0a1410', '#0e1c14', '#12241a', '#162c20']
        : ['#142b1a', '#1a3822', '#22482c', '#2c5c38'];

    for (let layer = 0; layer < 4; layer++) {
        ctx.fillStyle = pineCols[layer];
        const count = 35 + layer * 15;
        const layerH = 90 + layer * 35;
        const step = w / count;

        for (let i = 0; i <= count; i++) {
            const px = i * step + (Math.sin(i * 9) * step * 0.35);
            const ph = layerH + (Math.cos(i * 7) * 25);
            const pw = 28 + layer * 8;

            ctx.beginPath();
            ctx.moveTo(px - pw / 2, baseY);
            ctx.lineTo(px, baseY - ph);
            ctx.lineTo(px + pw / 2, baseY);
            ctx.closePath();
            ctx.fill();

            if (!n || layer === 3) {
                ctx.fillStyle = 'rgba(235, 245, 255, 0.4)';
                ctx.beginPath();
                ctx.moveTo(px - pw * 0.3, baseY - ph * 0.5);
                ctx.lineTo(px, baseY - ph);
                ctx.lineTo(px + pw * 0.3, baseY - ph * 0.5);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = pineCols[layer];
            }
        }
    }
}

// 4. Buyuk Qasr: Kuchli granit bastionlar, tishli devorlar va olov mash'alalari
function _paintCitadel(ctx, w, h, baseY, n) {
    const cliffCol = n ? '#0a0d12' : '#2a2f38';
    ctx.fillStyle = cliffCol;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    for (let x = 0; x <= w; x += 5) {
        const y = baseY - 160 - Math.sin(x * 0.0025) * 80 - Math.sin(x * 0.009) * 35;
        ctx.lineTo(x, y);
    }
    ctx.lineTo(w, baseY);
    ctx.closePath();
    ctx.fill();

    const stoneLight = n ? '#141820' : '#454e58';
    const stoneDark = n ? '#0c0e14' : '#2b323a';
    const wallH = 170;

    const wg = ctx.createLinearGradient(0, baseY - wallH, 0, baseY);
    wg.addColorStop(0, stoneLight);
    wg.addColorStop(1, stoneDark);
    ctx.fillStyle = wg;
    ctx.fillRect(w * 0.05, baseY - wallH, w * 0.9, wallH);

    for (let x = w * 0.05; x < w * 0.95; x += 32) {
        ctx.fillRect(x, baseY - wallH - 18, 18, 18);
    }

    for (let i = 0; i < 7; i++) {
        const tx = w * 0.08 + (w * 0.84 / 6) * i;
        const tw = 55;
        const th = wallH + 60 + (i % 2 === 1 ? 40 : 0);
        const ty = baseY - th;

        ctx.fillStyle = stoneDark;
        ctx.fillRect(tx - tw / 2, ty, tw, th);

        for (let bx = tx - tw / 2; bx < tx + tw / 2; bx += 14) {
            ctx.fillRect(bx, ty - 12, 8, 12);
        }

        ctx.fillStyle = '#b81e1e';
        ctx.fillRect(tx - 1, ty - 35, 2, 25);
        ctx.beginPath();
        ctx.moveTo(tx + 1, ty - 35);
        ctx.lineTo(tx + 28, ty - 26);
        ctx.lineTo(tx + 1, ty - 17);
        ctx.closePath();
        ctx.fill();

        const fx = tx;
        const fy = ty + 40;
        const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, 28);
        fg.addColorStop(0, 'rgba(255, 140, 20, 0.9)');
        fg.addColorStop(0.4, 'rgba(255, 70, 10, 0.4)');
        fg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = fg;
        ctx.fillRect(fx - 28, fy - 28, 56, 56);
    }

    const gw = 70;
    ctx.fillStyle = '#0a0a0c';
    ctx.beginPath();
    ctx.arc(w / 2, baseY - 50, gw / 2, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(w / 2 - gw / 2, baseY - 50, gw, 50);
}

// 5. Maydon: 3 qatlamli zumrad tepaliklar, shamol tegirmoni va o'tloqlar
function _paintField(ctx, w, h, baseY, n) {
    const hillCols = n
        ? ['#101e14', '#152818', '#1b3420']
        : ['#4b8c38', '#3e782c', '#336522'];

    for (let l = 0; l < 3; l++) {
        ctx.fillStyle = hillCols[l];
        ctx.beginPath();
        ctx.moveTo(0, baseY);
        for (let x = 0; x <= w; x += 4) {
            const y = baseY - (15 + l * 18) - Math.sin(x * 0.002 + l * 2.2) * (30 + l * 15) - Math.sin(x * 0.006 + l) * 12;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(w, baseY);
        ctx.closePath();
        ctx.fill();
    }

    const wmX = w * 0.74;
    const wmY = baseY - 75;
    ctx.fillStyle = n ? '#0c160e' : '#283622';
    ctx.beginPath();
    ctx.moveTo(wmX - 16, wmY + 45);
    ctx.lineTo(wmX - 10, wmY);
    ctx.lineTo(wmX + 10, wmY);
    ctx.lineTo(wmX + 16, wmY + 45);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = n ? '#0c160e' : '#283622';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(wmX - 35, wmY - 25);
    ctx.lineTo(wmX + 35, wmY + 25);
    ctx.moveTo(wmX - 25, wmY + 35);
    ctx.lineTo(wmX + 25, wmY - 35);
    ctx.stroke();

    for (let i = 0; i < 14; i++) {
        const tx = (w / 14) * i + Math.sin(i * 5) * 30;
        const th = 25 + (i % 3) * 12;
        const ty = baseY - 12 - (i % 2) * 8;
        ctx.fillStyle = n ? '#101c10' : '#27521a';
        ctx.beginPath();
        ctx.arc(tx, ty - th * 0.6, th * 0.7, 0, Math.PI * 2);
        ctx.fill();
    }
}


function _paintCity(ctx, w, h, baseY, mapType, n) {
    const nc = n ? '#141e30' : (mapType === 'istanbul' ? '#8090a0' : '#b09868');
    const dc = n ? '#1a3040' : (mapType === 'istanbul' ? '#7a8a98' : '#18a0b8');
    ctx.globalAlpha = 0.4;
    for (let i = 0; i < 14; i++) {
        const bx = (w / 14) * i + Math.random() * 30, bw = 60 + Math.random() * 80, bh = 70 + Math.random() * 100;
        ctx.fillStyle = n ? '#0e1828' : '#9a8060';
        ctx.fillRect(bx, baseY - bh, bw, bh);
        if (Math.random() > 0.5) {
            ctx.fillStyle = dc;
            ctx.beginPath();
            ctx.arc(bx + bw / 2, baseY - bh, bw * 0.28, Math.PI, 0);
            ctx.fill();
        }
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 9; i++) {
        const bx = (w / 9) * i + Math.random() * 20, bw = 90 + Math.random() * 110, bh = 130 + Math.random() * 150;
        const bg = ctx.createLinearGradient(bx, baseY - bh, bx, baseY);
        bg.addColorStop(0, nc);
        bg.addColorStop(1, n ? '#0a1420' : '#7a6848');
        ctx.fillStyle = bg;
        ctx.fillRect(bx, baseY - bh, bw, bh);
        if (!n) {
            ctx.fillStyle = 'rgba(0,0,0,0.12)';
            for (let wy = 15; wy < bh - 15; wy += 22) {
                for (let wx = 8; wx < bw - 8; wx += 18) {
                    ctx.fillRect(bx + wx, baseY - bh + wy, 9, 13);
                }
            }
        } else {
            for (let wy = 15; wy < bh - 15; wy += 22) {
                for (let wx = 8; wx < bw - 8; wx += 18) {
                    if (Math.random() > 0.6) {
                        ctx.fillStyle = 'rgba(255,200,80,0.6)';
                        ctx.fillRect(bx + wx, baseY - bh + wy, 9, 13);
                    }
                }
            }
        }
        if (Math.random() > 0.3) {
            ctx.fillStyle = dc;
            ctx.beginPath();
            ctx.arc(bx + bw / 2, baseY - bh, bw * 0.3, Math.PI, 0);
            ctx.fill();
            ctx.fillStyle = '#d4a020';
            ctx.beginPath();
            ctx.arc(bx + bw / 2, baseY - bh - bw * 0.26, 3, 0, Math.PI * 2);
            ctx.fill();
        }
        if (Math.random() > 0.6) {
            const mw = 13, mh = bh + 50 + Math.random() * 60, mx = bx + bw + 4;
            ctx.fillStyle = nc;
            ctx.fillRect(mx, baseY - mh, mw, mh);
            ctx.fillStyle = dc;
            ctx.beginPath();
            ctx.arc(mx + mw / 2, baseY - mh, mw * 0.7, Math.PI, 0);
            ctx.fill();
        }
    }
}

function _paintMountains(ctx, w, h, baseY, weather) {
    const s = weather === 'snow';
    const c = s ? ['#4a6880', '#5a7a90', '#6a8aa0'] : ['#2a4a30', '#3a5a38', '#4a6a40'];
    for (let l = 0; l < 3; l++) {
        ctx.fillStyle = c[l];
        ctx.globalAlpha = 0.4 + l * 0.3;
        ctx.beginPath();
        ctx.moveTo(0, baseY);
        for (let x = 0; x <= w; x += 3) {
            const y = baseY - l * 25 - (140 - l * 30) * (0.5 + 0.5 * Math.sin(x * 0.0022 + l * 2)) - Math.sin(x * 0.007) * 20;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(w, baseY);
        ctx.closePath();
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (s) {
        ctx.fillStyle = '#f0f8ff';
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(0, baseY);
        for (let x = 0; x <= w; x += 4) {
            const y = baseY - 50 - 110 * (0.5 + 0.5 * Math.sin(x * 0.0022 + 4)) - Math.sin(x * 0.007) * 20;
            ctx.lineTo(x, y + 25 + Math.random() * 8);
        }
        ctx.lineTo(w, baseY);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

function _paintDesert(ctx, w, h, baseY, n) {
    const dc = n ? ['#2a2018', '#3a2a1a'] : ['#d4a848', '#c09030'];
    for (let d = 0; d < 2; d++) {
        ctx.fillStyle = dc[d];
        ctx.globalAlpha = d === 0 ? 0.5 : 1;
        ctx.beginPath();
        ctx.moveTo(0, baseY);
        for (let x = 0; x <= w; x += 3) {
            const y = baseY - (15 + d * 12) - Math.sin(x * 0.003 + d * 2) * (35 + d * 18) - Math.sin(x * 0.008 + d) * 12;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(w, baseY);
        ctx.closePath();
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    const pc = n ? '#1a1810' : '#b08828';
    for (let i = 0; i < 3; i++) {
        const px = w * 0.15 + i * w * 0.32, pw = 90 + i * 25, ph = 70 + i * 18;
        ctx.fillStyle = pc;
        ctx.beginPath();
        ctx.moveTo(px - pw / 2, baseY - 3);
        ctx.lineTo(px, baseY - 3 - ph);
        ctx.lineTo(px + pw / 2, baseY - 3);
        ctx.closePath();
        ctx.fill();
    }
}

function _paintVolcano(ctx, w, h, baseY) {
    const g = ctx.createRadialGradient(w * 0.5, baseY, 0, w * 0.5, baseY, h * 0.6);
    g.addColorStop(0, 'rgba(200,50,10,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    [{ x: w * 0.2, pw: 280, ph: 200 }, { x: w * 0.5, pw: 380, ph: 260 }, { x: w * 0.8, pw: 300, ph: 190 }].forEach(p => {
        const v = ctx.createLinearGradient(p.x, baseY - p.ph, p.x, baseY);
        v.addColorStop(0, '#1a1210');
        v.addColorStop(1, '#2a1a14');
        ctx.fillStyle = v;
        ctx.beginPath();
        ctx.moveTo(p.x - p.pw / 2, baseY);
        ctx.lineTo(p.x - 15, baseY - p.ph);
        ctx.lineTo(p.x + 15, baseY - p.ph);
        ctx.lineTo(p.x + p.pw / 2, baseY);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ff4a10';
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(p.x, baseY - p.ph + 5, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(p.x, baseY - p.ph - 5, 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    });
}

function _paintCanyon(ctx, w, h, baseY) {
    [{ c: '#6a3018', a: 150, f: 0.002 }, { c: '#8a4420', a: 120, f: 0.003 }, { c: '#a85828', a: 90, f: 0.004 }, { c: '#c06830', a: 60, f: 0.005 }].forEach((l, i) => {
        ctx.fillStyle = l.c;
        ctx.globalAlpha = 0.4 + i * 0.18;
        ctx.beginPath();
        ctx.moveTo(0, baseY);
        for (let x = 0; x <= w; x += 4) {
            const y = baseY - l.a * (0.5 + 0.4 * Math.sin(x * l.f + i)) - Math.abs(Math.sin(x * 0.01 + i)) * 30;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(w, baseY);
        ctx.closePath();
        ctx.fill();
    });
    ctx.globalAlpha = 1;
}

function _paintOasis(ctx, w, h, baseY, n) {
    const lg = ctx.createRadialGradient(w / 2, baseY + 8, 0, w / 2, baseY + 8, w * 0.22);
    lg.addColorStop(0, n ? '#0a3040' : '#30b8d8');
    lg.addColorStop(1, n ? '#081820' : '#1890b0');
    ctx.fillStyle = lg;
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.ellipse(w / 2, baseY + 8, w * 0.22, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    for (let i = 0; i < 8; i++) {
        const px = w * 0.08 + (w * 0.84 / 7) * i + (Math.random() - 0.5) * 25, trH = 60 + Math.random() * 45;
        ctx.strokeStyle = n ? '#3a2a18' : '#7a5a2a';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(px, baseY);
        ctx.quadraticCurveTo(px + (Math.random() - 0.5) * 15, baseY - trH * 0.6, px + (Math.random() - 0.5) * 8, baseY - trH);
        ctx.stroke();
        ctx.fillStyle = n ? '#1a3a18' : '#2a8a30';
        for (let f = 0; f < 5; f++) {
            const a = (f / 5) * Math.PI * 2;
            ctx.beginPath();
            ctx.ellipse(px + Math.cos(a) * 32, baseY - trH + Math.sin(a) * 10 - 3, 24, 7, a * 0.3, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function _paintCastle(ctx, w, h, baseY, n) {
    const wc = n ? '#1a2028' : '#5a6858';
    const wallH = 120;
    const wg = ctx.createLinearGradient(0, baseY - wallH, 0, baseY);
    wg.addColorStop(0, wc);
    wg.addColorStop(1, n ? '#0a1018' : '#3a4838');
    ctx.fillStyle = wg;
    ctx.fillRect(w * 0.1, baseY - wallH, w * 0.8, wallH);
    for (let x = w * 0.1; x < w * 0.9; x += 28) ctx.fillRect(x, baseY - wallH - 14, 16, 14);
    for (let i = 0; i < 6; i++) {
        const tx = w * 0.1 + (w * 0.8 / 5) * i, th = wallH + 45 + Math.random() * 35, tw = 32;
        ctx.fillStyle = n ? '#141820' : '#4a5848';
        ctx.fillRect(tx - tw / 2, baseY - th, tw, th);
        ctx.beginPath();
        ctx.moveTo(tx - tw / 2 - 4, baseY - th);
        ctx.lineTo(tx, baseY - th - 28);
        ctx.lineTo(tx + tw / 2 + 4, baseY - th);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = n ? '#8a2020' : '#c03030';
        ctx.fillRect(tx - 1, baseY - th - 28, 2, -18);
        ctx.beginPath();
        ctx.moveTo(tx + 1, baseY - th - 46);
        ctx.lineTo(tx + 16, baseY - th - 40);
        ctx.lineTo(tx + 1, baseY - th - 34);
        ctx.fill();
    }
    ctx.fillStyle = '#3a2a1a';
    ctx.beginPath();
    ctx.arc(w / 2, baseY, 32, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(w / 2 - 32, baseY - 32, 64, 32);
}

// 6. 3D Bezatish modellari (Tegirmon, Torii darvozasi, Registon Peshtoqi, Citadel minorasi, Mash'alalar)
function spawnSceneryProps(mapType, weather, safeRadius) {
    if (!window._animatedScenery) window._animatedScenery = [];
    window._animatedScenery = [];

    const isNight = weather === 'night';

    if (mapType === 'field') {
        const wmGroup = new THREE.Group();
        const towerGeo = new THREE.CylinderGeometry(45, 75, 280, 10);
        const towerMat = new THREE.MeshStandardMaterial({ color: isNight ? 0x2a2820 : 0xd8caa8, roughness: 0.85, flatShading: true });
        const tower = new THREE.Mesh(towerGeo, towerMat);
        tower.position.y = 140;
        wmGroup.add(tower);

        const roofGeo = new THREE.ConeGeometry(58, 80, 10);
        const roofMat = new THREE.MeshStandardMaterial({ color: isNight ? 0x1a1820 : 0x6d3d2c, roughness: 0.7 });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.y = 320;
        wmGroup.add(roof);

        const rotor = new THREE.Group();
        const hubGeo = new THREE.CylinderGeometry(14, 14, 16, 8);
        const hubMat = new THREE.MeshStandardMaterial({ color: 0x3d2816, roughness: 0.8 });
        const hub = new THREE.Mesh(hubGeo, hubMat);
        hub.rotation.x = Math.PI / 2;
        rotor.add(hub);

        const sailMat = new THREE.MeshStandardMaterial({ color: isNight ? 0x3a3830 : 0xf2ebd9, roughness: 0.6, side: THREE.DoubleSide });
        const armMat = new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: 0.85 });

        for (let b = 0; b < 4; b++) {
            const arm = new THREE.Group();
            arm.rotation.z = (b * Math.PI) / 2;

            const wood = new THREE.Mesh(new THREE.BoxGeometry(7, 160, 5), armMat);
            wood.position.y = 80;
            arm.add(wood);

            const sail = new THREE.Mesh(new THREE.BoxGeometry(32, 110, 2), sailMat);
            sail.position.set(16, 95, 2);
            arm.add(sail);

            rotor.add(arm);
        }
        rotor.position.set(0, 260, 50);
        wmGroup.add(rotor);

        wmGroup.position.set(safeRadius + 380, ground.position.y + 100, -260);
        scene.add(wmGroup);
        mapBackdrops.push(wmGroup);

        window._animatedScenery.push({ type: 'rotor', mesh: rotor, dir: 1 });

    } else if (mapType === 'sakura') {
        const toriiGroup = new THREE.Group();
        const toriiMat = new THREE.MeshStandardMaterial({ color: isNight ? 0x4a1818 : 0xcc2914, roughness: 0.6 });
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x222224, roughness: 0.9 });

        for (const sx of [-90, 90]) {
            const col = new THREE.Mesh(new THREE.CylinderGeometry(13, 16, 310, 12), toriiMat);
            col.position.set(sx, 155, 0);
            toriiGroup.add(col);

            const plinth = new THREE.Mesh(new THREE.CylinderGeometry(20, 24, 30, 8), baseMat);
            plinth.position.set(sx, 15, 0);
            toriiGroup.add(plinth);
        }

        const kasagi = new THREE.Mesh(new THREE.BoxGeometry(260, 24, 24), toriiMat);
        kasagi.position.set(0, 310, 0);
        toriiGroup.add(kasagi);

        const shimagi = new THREE.Mesh(new THREE.BoxGeometry(230, 16, 18), toriiMat);
        shimagi.position.set(0, 265, 0);
        toriiGroup.add(shimagi);

        const gaku = new THREE.Mesh(new THREE.BoxGeometry(22, 35, 8), baseMat);
        gaku.position.set(0, 287, 0);
        toriiGroup.add(gaku);

        toriiGroup.position.set(-(safeRadius + 320), ground.position.y + 100, -220);
        scene.add(toriiGroup);
        mapBackdrops.push(toriiGroup);

        for (const side of [-1, 1]) {
            const toro = new THREE.Group();
            const lanternBase = new THREE.Mesh(new THREE.CylinderGeometry(14, 18, 120, 6), baseMat);
            lanternBase.position.y = 60;
            toro.add(lanternBase);

            const lamp = new THREE.Mesh(
                new THREE.BoxGeometry(36, 36, 36),
                new THREE.MeshStandardMaterial({ color: isNight ? 0xffdf70 : 0xfffae0, emissive: isNight ? 0xffaa20 : 0x443311, emissiveIntensity: isNight ? 0.9 : 0.2 })
            );
            lamp.position.y = 138;
            toro.add(lamp);

            const lampRoof = new THREE.Mesh(new THREE.ConeGeometry(38, 30, 4), baseMat);
            lampRoof.rotation.y = Math.PI / 4;
            lampRoof.position.y = 170;
            toro.add(lampRoof);

            toro.position.set(toriiGroup.position.x + side * 150, ground.position.y + 100, -180);
            scene.add(toro);
            mapBackdrops.push(toro);
        }

    } else if (mapType === 'registan') {
        const regGroup = new THREE.Group();
        const sandMat = new THREE.MeshStandardMaterial({ color: isNight ? 0x3a2c1a : 0xddae58, roughness: 0.8, flatShading: true });
        const domeMat = new THREE.MeshStandardMaterial({ color: isNight ? 0x0e4860 : 0x0cb6d4, roughness: 0.45, metalness: 0.15 });
        const goldMat = new THREE.MeshStandardMaterial({ color: 0xdfb034, roughness: 0.3, metalness: 0.6 });

        const portal = new THREE.Mesh(new THREE.BoxGeometry(220, 340, 60), sandMat);
        portal.position.y = 170;
        regGroup.add(portal);

        const drum = new THREE.Mesh(new THREE.CylinderGeometry(60, 60, 70, 20), sandMat);
        drum.position.set(0, 375, 0);
        regGroup.add(drum);

        const dome = new THREE.Mesh(new THREE.SphereGeometry(68, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), domeMat);
        dome.position.set(0, 395, 0);
        regGroup.add(dome);

        const finial = new THREE.Mesh(new THREE.ConeGeometry(12, 45, 8), goldMat);
        finial.position.set(0, 475, 0);
        regGroup.add(finial);

        for (const sx of [-130, 130]) {
            const minaret = new THREE.Mesh(new THREE.CylinderGeometry(20, 26, 420, 14), sandMat);
            minaret.position.set(sx, 210, 0);
            regGroup.add(minaret);

            const mCap = new THREE.Mesh(new THREE.ConeGeometry(24, 50, 14), domeMat);
            mCap.position.set(sx, 445, 0);
            regGroup.add(mCap);
        }

        regGroup.position.set(safeRadius + 360, ground.position.y + 100, -280);
        scene.add(regGroup);
        mapBackdrops.push(regGroup);

    } else if (mapType === 'citadel') {
        const citGroup = new THREE.Group();
        const stoneMat = new THREE.MeshStandardMaterial({ color: isNight ? 0x1c2024 : 0x485058, roughness: 0.9, flatShading: true });
        const darkIron = new THREE.MeshStandardMaterial({ color: 0x111315, roughness: 0.7, metalness: 0.8 });

        const tower = new THREE.Mesh(new THREE.BoxGeometry(240, 360, 180), stoneMat);
        tower.position.y = 180;
        citGroup.add(tower);

        for (let m = -90; m <= 90; m += 45) {
            const merlon = new THREE.Mesh(new THREE.BoxGeometry(24, 35, 190), stoneMat);
            merlon.position.set(m, 375, 0);
            citGroup.add(merlon);
        }

        const pole = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 140, 6), darkIron);
        pole.position.set(0, 430, 0);
        citGroup.add(pole);

        const flagMat = new THREE.MeshStandardMaterial({ color: 0xa81c1c, roughness: 0.7, side: THREE.DoubleSide });
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(70, 45), flagMat);
        flag.position.set(38, 470, 0);
        citGroup.add(flag);

        const brazier = new THREE.Mesh(new THREE.ConeGeometry(20, 26, 6), darkIron);
        brazier.rotation.x = Math.PI;
        brazier.position.set(90, 220, 95);
        citGroup.add(brazier);

        const flameLight = new THREE.PointLight(0xff6a14, isNight ? 2.2 : 1.2, 450);
        flameLight.position.set(90, 240, 105);
        citGroup.add(flameLight);

        window._animatedScenery.push({ type: 'flicker', light: flameLight, baseIntensity: isNight ? 2.2 : 1.2 });

        citGroup.position.set(-(safeRadius + 340), ground.position.y + 100, -250);
        scene.add(citGroup);
        mapBackdrops.push(citGroup);

    } else if (mapType === 'taiga') {
        const campGroup = new THREE.Group();
        const logMat = new THREE.MeshStandardMaterial({ color: 0x3d2714, roughness: 0.9 });
        for (let l = 0; l < 4; l++) {
            const log = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 70, 6), logMat);
            log.rotation.z = Math.PI / 4 + (l * Math.PI) / 4;
            log.position.y = 15;
            campGroup.add(log);
        }
        const fire = new THREE.Mesh(
            new THREE.ConeGeometry(18, 40, 8),
            new THREE.MeshStandardMaterial({ color: 0xff7711, emissive: 0xff4400, emissiveIntensity: 1.2 })
        );
        fire.position.y = 25;
        campGroup.add(fire);

        const campLight = new THREE.PointLight(0xff7722, isNight ? 2.5 : 1.4, 500);
        campLight.position.set(0, 35, 20);
        campGroup.add(campLight);

        window._animatedScenery.push({ type: 'flicker', light: campLight, baseIntensity: isNight ? 2.5 : 1.4 });

        campGroup.position.set(safeRadius + 260, ground.position.y + 100, -120);
        scene.add(campGroup);
        mapBackdrops.push(campGroup);

    } else if (mapType === 'volcano') {
        const obsGroup = new THREE.Group();
        const obsMat = new THREE.MeshStandardMaterial({ color: 0x141012, roughness: 0.4, metalness: 0.3, flatShading: true });
        for (let p = 0; p < 5; p++) {
            const h = 180 + p * 50;
            const pillar = new THREE.Mesh(new THREE.CylinderGeometry(15, 28, h, 6), obsMat);
            pillar.position.set((p - 2) * 55, h / 2, (Math.random() - 0.5) * 40);
            pillar.rotation.z = (Math.random() - 0.5) * 0.15;
            obsGroup.add(pillar);
        }
        obsGroup.position.set(safeRadius + 320, ground.position.y + 100, -220);
        scene.add(obsGroup);
        mapBackdrops.push(obsGroup);
    }
}

function buildCityBackdrop(mapType, safeRadius) {
    // Endi Canvas2D generatsiya qilingan fon ishlatiladi.
}

// Voha: palma daraxtlari + ko'l.
function buildOasisBackdrop(safeRadius) {
    // Endi Canvas2D generatsiya qilingan fon ishlatiladi.
}

// Kanyon: qatlamli qizg'ish mesa qoyalar.
function buildCanyonBackdrop(safeRadius) {
    // Endi Canvas2D generatsiya qilingan fon ishlatiladi.
}

// Vulqon: lava cho'qqilar va qizil porlash.
function buildVolcanoBackdrop(safeRadius) {
    // Endi Canvas2D generatsiya qilingan fon ishlatiladi.
}

// === 2-3 ta yuqori sifatli procedural daraxt teksturalari (Canvas2D) ===
// 0: Grand Oak / Chinar (keng shoxli, mahobatli soya beruvchi daraxt)
// 1: Elegant Birch / Poplar (tik qomatli oq po'stloqli terak / qayin)
// 2: Mountain Pine / Spruce (qatlamli doimiy yashil tog' archasi / qarag'ay)
const proceduralTreeCache = {};

function getProceduralTreeTexture(styleIndex, mapType, weather) {
    const key = `${styleIndex}_${mapType}_${weather}`;
    if (proceduralTreeCache[key]) return proceduralTreeCache[key];

    const canvas = document.createElement('canvas');
    const w = canvas.width = 512;
    const h = canvas.height = 768;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    const isWinter = mapType === 'winter' || weather === 'snow';
    const isSakura = mapType === 'sakura';
    const isTaiga = mapType === 'taiga';
    const isAutumn = mapType === 'canyon' || mapType === 'desert';

    // Daraxt tanasi ranglari
    let trunkBase = '#4a2f1b';
    let trunkShadow = '#2d1a0e';
    if (styleIndex === 1) {
        // Birch/Poplar (Oq terak / qayin)
        trunkBase = '#e2e8f0';
        trunkShadow = '#94a3b8';
    } else if (styleIndex === 2) {
        // Pine/Spruce (Qarag'ay / archa)
        trunkBase = '#54361c';
        trunkShadow = '#2d1b0d';
    }

    // Barglar / ignabarglar palitrasi
    let leafColors = ['#1d5918', '#2b7a24', '#3ea334', '#59c74e', '#7de374'];
    if (isSakura) {
        leafColors = ['#9e2a56', '#c93c72', '#e8588f', '#f48fb1', '#fce4ec'];
    } else if (isWinter) {
        leafColors = ['#475569', '#64748b', '#94a3b8', '#cbd5e1', '#f1f5f9'];
    } else if (isTaiga) {
        leafColors = ['#10351d', '#194929', '#246338', '#34834c', '#4ba468'];
    } else if (isAutumn) {
        leafColors = ['#7c2d12', '#b45309', '#d97706', '#f59e0b', '#fbbf24'];
    }

    if (styleIndex === 0) {
        // === STYLE 0: GRAND OAK / CHINAR (Keng shoxli, bargli ulkan daraxt) ===
        // Ildiz qismi (yerga mustahkam kirgan)
        ctx.fillStyle = trunkBase;
        ctx.beginPath();
        ctx.moveTo(w * 0.30, h);
        ctx.bezierCurveTo(w * 0.38, h * 0.90, w * 0.42, h * 0.82, w * 0.44, h * 0.70);
        ctx.lineTo(w * 0.56, h * 0.70);
        ctx.bezierCurveTo(w * 0.58, h * 0.82, w * 0.62, h * 0.90, w * 0.70, h);
        ctx.closePath();
        ctx.fill();

        // Tana va asosiy shoxlar
        ctx.fillStyle = trunkBase;
        ctx.beginPath();
        ctx.moveTo(w * 0.44, h * 0.70);
        ctx.bezierCurveTo(w * 0.43, h * 0.55, w * 0.38, h * 0.45, w * 0.30, h * 0.36);
        ctx.bezierCurveTo(w * 0.34, h * 0.34, w * 0.42, h * 0.42, w * 0.46, h * 0.50);
        ctx.bezierCurveTo(w * 0.48, h * 0.42, w * 0.46, h * 0.32, w * 0.48, h * 0.22);
        ctx.bezierCurveTo(w * 0.52, h * 0.22, w * 0.52, h * 0.38, w * 0.54, h * 0.50);
        ctx.bezierCurveTo(w * 0.58, h * 0.42, w * 0.66, h * 0.34, w * 0.70, h * 0.36);
        ctx.bezierCurveTo(w * 0.62, h * 0.45, w * 0.57, h * 0.55, w * 0.56, h * 0.70);
        ctx.closePath();
        ctx.fill();

        // Po'stloq chiziqlari
        ctx.strokeStyle = trunkShadow;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(w * 0.48, h * 0.86); ctx.lineTo(w * 0.47, h * 0.62);
        ctx.moveTo(w * 0.52, h * 0.88); ctx.lineTo(w * 0.53, h * 0.64);
        ctx.stroke();

        // Qalin, to'yingan barglar to'dalari
        const foliageClumps = [
            { cx: w * 0.50, cy: h * 0.24, rx: w * 0.34, ry: h * 0.17 },
            { cx: w * 0.34, cy: h * 0.35, rx: w * 0.26, ry: h * 0.15 },
            { cx: w * 0.66, cy: h * 0.36, rx: w * 0.27, ry: h * 0.15 },
            { cx: w * 0.42, cy: h * 0.42, rx: w * 0.24, ry: h * 0.14 },
            { cx: w * 0.58, cy: h * 0.43, rx: w * 0.25, ry: h * 0.14 },
            { cx: w * 0.50, cy: h * 0.32, rx: w * 0.30, ry: h * 0.16 }
        ];

        foliageClumps.forEach((clump) => {
            const g = ctx.createRadialGradient(
                clump.cx - clump.rx * 0.2, clump.cy - clump.ry * 0.3, clump.rx * 0.1,
                clump.cx, clump.cy, clump.rx
            );
            g.addColorStop(0, leafColors[3] || '#59c74e');
            g.addColorStop(0.5, leafColors[2] || '#3ea334');
            g.addColorStop(0.85, leafColors[1] || '#2b7a24');
            g.addColorStop(1, leafColors[0] || '#1d5918');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(clump.cx, clump.cy, clump.rx, clump.ry, 0, 0, Math.PI * 2);
            ctx.fill();

            // Chetki barg to'plamlari
            for (let p = 0; p < 14; p++) {
                const angle = (p / 14) * Math.PI * 2;
                const px = clump.cx + Math.cos(angle) * (clump.rx * 0.88);
                const py = clump.cy + Math.sin(angle) * (clump.ry * 0.88);
                const colIdx = Math.sin(angle + 1) > 0.2 ? 3 : (Math.cos(angle) > 0 ? 2 : 1);
                ctx.fillStyle = leafColors[colIdx] || leafColors[2];
                ctx.beginPath();
                ctx.arc(px, py, 18 + ((p * 7) % 14), 0, Math.PI * 2);
                ctx.fill();
            }
        });

        // Tepasiga quyosh nuri jilosi
        const topHighlight = ctx.createRadialGradient(w * 0.50, h * 0.16, 10, w * 0.50, h * 0.20, w * 0.25);
        topHighlight.addColorStop(0, leafColors[4] || '#7de374');
        topHighlight.addColorStop(0.85, 'rgba(255,255,255,0)');
        ctx.fillStyle = topHighlight;
        ctx.beginPath();
        ctx.ellipse(w * 0.50, h * 0.20, w * 0.25, h * 0.12, 0, 0, Math.PI * 2);
        ctx.fill();

        if (isWinter) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
            foliageClumps.forEach(c => {
                ctx.beginPath();
                ctx.ellipse(c.cx, c.cy - c.ry * 0.65, c.rx * 0.65, c.ry * 0.28, 0, 0, Math.PI * 2);
                ctx.fill();
            });
        }

    } else if (styleIndex === 1) {
        // === STYLE 1: ELEGANT BIRCH / POPLAR (Tik qomatli oq terak / qayin) ===
        // Oq-kumushrang ingichka tana
        ctx.fillStyle = trunkBase;
        ctx.beginPath();
        ctx.moveTo(w * 0.43, h);
        ctx.bezierCurveTo(w * 0.45, h * 0.88, w * 0.47, h * 0.65, w * 0.48, h * 0.35);
        ctx.lineTo(w * 0.52, h * 0.35);
        ctx.bezierCurveTo(w * 0.53, h * 0.65, w * 0.55, h * 0.88, w * 0.57, h);
        ctx.closePath();
        ctx.fill();

        // Qayin tanasidagi qora gorizontal chiziqlar (lenticels)
        ctx.fillStyle = '#1e293b';
        for (let y = h * 0.38; y < h * 0.95; y += 18 + ((y * 13) % 20)) {
            const notchW = 10 + ((y * 7) % 18);
            const notchX = w * 0.48 + ((y * 5) % 8) - 4;
            ctx.beginPath();
            ctx.roundRect(notchX - notchW / 2, y, notchW, 3 + ((y * 3) % 3), 1);
            ctx.fill();
        }

        // Nafis, baland qomatli barglar to'dasi
        const birchClumps = [
            { cx: w * 0.50, cy: h * 0.18, rx: w * 0.20, ry: h * 0.14 },
            { cx: w * 0.44, cy: h * 0.28, rx: w * 0.22, ry: h * 0.13 },
            { cx: w * 0.56, cy: h * 0.29, rx: w * 0.23, ry: h * 0.13 },
            { cx: w * 0.46, cy: h * 0.40, rx: w * 0.25, ry: h * 0.14 },
            { cx: w * 0.54, cy: h * 0.41, rx: w * 0.25, ry: h * 0.14 },
            { cx: w * 0.50, cy: h * 0.50, rx: w * 0.22, ry: h * 0.12 }
        ];

        birchClumps.forEach((clump) => {
            const g = ctx.createRadialGradient(
                clump.cx - clump.rx * 0.2, clump.cy - clump.ry * 0.3, clump.rx * 0.1,
                clump.cx, clump.cy, clump.rx
            );
            g.addColorStop(0, leafColors[3] || '#59c74e');
            g.addColorStop(0.6, leafColors[2] || '#3ea334');
            g.addColorStop(1, leafColors[0] || '#1d5918');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(clump.cx, clump.cy, clump.rx, clump.ry, 0, 0, Math.PI * 2);
            ctx.fill();

            for (let p = 0; p < 12; p++) {
                const angle = (p / 12) * Math.PI * 2;
                const px = clump.cx + Math.cos(angle) * (clump.rx * 0.85);
                const py = clump.cy + Math.sin(angle) * (clump.ry * 0.85);
                ctx.fillStyle = leafColors[(p % 3) + 1] || leafColors[2];
                ctx.beginPath();
                ctx.arc(px, py, 14 + (p % 8), 0, Math.PI * 2);
                ctx.fill();
            }
        });

        if (isWinter) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            birchClumps.forEach(c => {
                ctx.beginPath();
                ctx.ellipse(c.cx, c.cy - c.ry * 0.65, c.rx * 0.65, c.ry * 0.25, 0, 0, Math.PI * 2);
                ctx.fill();
            });
        }

    } else {
        // === STYLE 2: STATELY MOUNTAIN PINE / SPRUCE (Archa / Qarag'ay) ===
        // Tik baquvvat tana
        ctx.fillStyle = trunkBase;
        ctx.beginPath();
        ctx.moveTo(w * 0.43, h);
        ctx.lineTo(w * 0.47, h * 0.40);
        ctx.lineTo(w * 0.53, h * 0.40);
        ctx.lineTo(w * 0.57, h);
        ctx.closePath();
        ctx.fill();

        // Qatlamli uchburchak archa panjalari
        const tiers = [
            { topY: h * 0.08, botY: h * 0.22, halfW: w * 0.16 },
            { topY: h * 0.16, botY: h * 0.33, halfW: w * 0.23 },
            { topY: h * 0.26, botY: h * 0.45, halfW: w * 0.29 },
            { topY: h * 0.37, botY: h * 0.58, halfW: w * 0.35 },
            { topY: h * 0.48, botY: h * 0.72, halfW: w * 0.40 }
        ];

        tiers.forEach((tier) => {
            const tg = ctx.createLinearGradient(0, tier.topY, 0, tier.botY);
            tg.addColorStop(0, leafColors[3] || '#34834c');
            tg.addColorStop(0.7, leafColors[1] || '#194929');
            tg.addColorStop(1, leafColors[0] || '#10351d');

            ctx.fillStyle = tg;
            ctx.beginPath();
            ctx.moveTo(w * 0.50, tier.topY);
            ctx.lineTo(w * 0.50 + tier.halfW, tier.botY);
            const teeth = 9;
            for (let t = teeth; t >= 0; t--) {
                const tx = w * 0.50 - tier.halfW + (tier.halfW * 2 * (t / teeth));
                const ty = tier.botY - (t % 2 === 1 ? 14 : 0);
                ctx.lineTo(tx, ty);
            }
            ctx.lineTo(w * 0.50 - tier.halfW, tier.botY);
            ctx.closePath();
            ctx.fill();

            if (isWinter) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
                ctx.beginPath();
                ctx.moveTo(w * 0.50, tier.topY);
                ctx.lineTo(w * 0.50 + tier.halfW * 0.75, tier.topY + (tier.botY - tier.topY) * 0.55);
                ctx.quadraticCurveTo(w * 0.50, tier.topY + 18, w * 0.50 - tier.halfW * 0.75, tier.topY + (tier.botY - tier.topY) * 0.55);
                ctx.closePath();
                ctx.fill();
            }
        });
    }

    // Daraxt tubining yerga botgan soyasi (ildizning yer bilan tutashuv joyi)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.beginPath();
    ctx.ellipse(w * 0.50, h - 3, w * 0.32, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    proceduralTreeCache[key] = tex;
    return tex;
}

function buildMap(mapType, weather = 'sunny') {
    if (typeof clearStuckSpears === 'function') clearStuckSpears();
    let groundColor = 0x52c234; // Boy yorqin yashil
    let rockColor = 0x9ca3af;
    let skyColor = 0x2e95e6; // To'q to'yingan havorang
    let groundTopColor = 0x7dd956; // Yer ustki qatlam rangi (o't)

    if (mapType === 'winter') {
        groundColor = 0xd8e8f8; rockColor = 0x94a3b8; skyColor = 0x7fc3e8; groundTopColor = 0xf0f8ff;
    } else if (mapType === 'desert') {
        groundColor = 0xd4a030; rockColor = 0xc77d10; skyColor = 0x1ea7e0; groundTopColor = 0xf4d078;
    } else if (mapType === 'castle') {
        groundColor = 0x4a5e3a; rockColor = 0x475569; skyColor = 0x2f7fc4; groundTopColor = 0x6a8050;
    } else if (mapType === 'mountain') {
        groundColor = 0x4a7030; rockColor = 0x6b5b4a; skyColor = 0x3a9bd4; groundTopColor = 0x6a9a48;
    } else if (mapType === 'samarkand') {
        groundColor = 0xb09050; rockColor = 0xa07d4a; skyColor = 0x2487d6; groundTopColor = 0xd4b878;
    } else if (mapType === 'bukhara') {
        groundColor = 0xc09860; rockColor = 0xb08a52; skyColor = 0x39a0dd; groundTopColor = 0xe0c090;
    } else if (mapType === 'istanbul') {
        groundColor = 0x5a7a5a; rockColor = 0x7d8a96; skyColor = 0x2b8fd8; groundTopColor = 0x7a9a70;
    } else if (mapType === 'oasis') {
        groundColor = 0x3a8a2a; rockColor = 0xc2a060; skyColor = 0x1fb0e6; groundTopColor = 0x5ab840;
    } else if (mapType === 'canyon') {
        groundColor = 0xa05828; rockColor = 0x8a4a26; skyColor = 0x2f9bdc; groundTopColor = 0xd07840;
    } else if (mapType === 'volcano') {
        groundColor = 0x2a2220; rockColor = 0x4a3530; skyColor = 0x6b3b2e; groundTopColor = 0x3a2e28;
    }

    if (weather === 'night') {
        skyColor = 0x0b1020;
        groundColor = 0x1a2530;
        groundTopColor = 0x263040;
        rockColor = 0x334155;
    } else if (weather === 'rain') {
        skyColor = 0x5f8ca8;
    } else if (weather === 'storm') {
        skyColor = 0x34495e;
        groundColor = 0x5a7a6a;
        groundTopColor = 0x7aa08c;
    } else if (weather === 'snow') {
        skyColor = 0xcde9ff;
        groundTopColor = 0xf0f8ff;
    }

    ground.material.color.setHex(groundColor);
    rocks.forEach(r => r.material.color.setHex(rockColor));
    if (typeof groundSeamMat !== 'undefined' && groundSeamMat) groundSeamMat.color.setHex(rockColor);
    scene.background.setHex(skyColor);
    scene.fog.color.setHex(skyColor);
    scene.fog.density = (weather === 'storm') ? 0.0004 : 0.00018;
    weatherType = weather;
    createWeatherSystem(weatherType);

    // Yer ustki sun'iy oq chiziq olib tashlandi (foydalanuvchi so'roviga ko'ra)
    if (window._groundTopLayer) {
        scene.remove(window._groundTopLayer);
        if (window._groundTopLayer.geometry) window._groundTopLayer.geometry.dispose();
        if (window._groundTopLayer.material) window._groundTopLayer.material.dispose();
        window._groundTopLayer = null;
    }

    // Quyosh/oy diski va yulduzlarni ob-havoga moslashtiramiz.
    if (typeof sunSprite !== 'undefined' && sunSprite) {
        if (weather === 'night') {
            sunSprite.material.map = makeRadialGlowTexture('#eaf2ff', '#9fb6dd');
            sunSprite.material.opacity = 0.85;
            sunSprite.scale.set(560, 560, 1);
            sunSprite.position.set(1300, 1150, -900);
        } else if (weather === 'storm' || weather === 'rain') {
            sunSprite.material.opacity = 0.18;
            sunSprite.scale.set(700, 700, 1);
            sunSprite.position.set(-1400, 1100, -900);
        } else if (weather === 'snow') {
            sunSprite.material.map = makeRadialGlowTexture('#ffffff', '#cfe6ff');
            sunSprite.material.opacity = 0.7;
            sunSprite.scale.set(820, 820, 1);
            sunSprite.position.set(-1400, 1100, -900);
        } else {
            sunSprite.material.map = makeRadialGlowTexture('#fff6cf', '#ffd36b');
            sunSprite.material.opacity = 0.92;
            sunSprite.scale.set(900, 900, 1);
            sunSprite.position.set(-1400, 1100, -900);
        }
        sunSprite.material.needsUpdate = true;
        sunSprite.userData.baseScale = sunSprite.scale.x;
    }
    if (typeof starMat !== 'undefined' && starMat) {
        starMat.opacity = 0;
    }
    // Yorug'lik intensivligini ob-havoga moslab, sahnani jonliroq qilamiz.
    if (typeof dirLight !== 'undefined') {
        if (weather === 'night') { dirLight.intensity = 0.6; dirLight.color.setHex(0x9fb6dd); }
        else if (weather === 'storm') { dirLight.intensity = 0.8; dirLight.color.setHex(0xb9c4d6); }
        else if (weather === 'rain') { dirLight.intensity = 1.0; dirLight.color.setHex(0xd6e0ee); }
        else if (weather === 'snow') { dirLight.intensity = 1.3; dirLight.color.setHex(0xeaf2ff); }
        else { dirLight.intensity = 1.45; dirLight.color.setHex(0xfff2d9); }
    }
    if (typeof hemiLight !== 'undefined') {
        hemiLight.intensity = weather === 'night' ? 0.3 : (weather === 'storm' ? 0.4 : 0.55);
    }

    // Decorative mixed trees placed away from fighters, with depth layers
    mapBackdrops.forEach((obj) => {
        scene.remove(obj);
        // Procedural geometriyalarni (masalan tog' konuslari) xotiradan tozalaymiz.
        if (obj.geometry && typeof obj.geometry.dispose === 'function') obj.geometry.dispose();
        if (obj.material && typeof obj.material.dispose === 'function') obj.material.dispose();
    });
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
    } else if (mapType === 'mountain') {
        treesPerSide = 5;
        smallTreeChance = 0.6;
    } else if (mapType === 'samarkand' || mapType === 'bukhara' || mapType === 'istanbul') {
        treesPerSide = 3;
        smallTreeChance = 0.4;
    } else if (mapType === 'oasis') {
        treesPerSide = 6;
        smallTreeChance = 0.3;
    } else if (mapType === 'canyon') {
        treesPerSide = 2;
        smallTreeChance = 0.25;
    } else if (mapType === 'volcano') {
        treesPerSide = 1;
        smallTreeChance = 0.2;
    }
    const safeRadius = Math.max(1300, currentBattleDistance / 2 + 420);
    // Qal'a sahnasidagi 2D qal'a modeli foydalanuvchi so'roviga binoan olib tashlandi.
    if (mapType === 'mountain') {
        // Procedural tog' siluetlari - uzoq fonda qatlamlangan konuslar.
        const snowy = (weatherType === 'snow' || weatherType === 'winter');
        const peakBase = new THREE.Color(snowy ? 0x8a99ad : 0x5b6450);
        const peakSnow = new THREE.Color(0xf4f8ff);
        const layerDefs = [
            { z: -760, scale: 1.5, count: 7, tint: 0.55 },
            { z: -540, scale: 1.18, count: 6, tint: 0.78 },
            { z: -340, scale: 0.92, count: 5, tint: 1.0 }
        ];
        layerDefs.forEach((layer) => {
            for (let m = 0; m < layer.count; m++) {
                const peakH = (520 + Math.random() * 360) * layer.scale;
                const peakW = (520 + Math.random() * 280) * layer.scale;
                const coneGeo = new THREE.ConeGeometry(peakW / 2, peakH, 5);
                const baseCol = peakBase.clone().multiplyScalar(layer.tint);
                const coneMat = new THREE.MeshStandardMaterial({
                    color: baseCol,
                    roughness: 1,
                    metalness: 0,
                    flatShading: true
                });
                const cone = new THREE.Mesh(coneGeo, coneMat);
                const spanX = (safeRadius * 2) + 1800;
                cone.position.set(
                    -spanX / 2 + (spanX / (layer.count - 1 || 1)) * m + (Math.random() - 0.5) * 220,
                    ground.position.y + 90 + peakH / 2,
                    layer.z
                );
                cone.castShadow = false;
                cone.receiveShadow = false;
                scene.add(cone);
                mapBackdrops.push(cone);

                // Qor cho'qqisi
                if (snowy || Math.random() < 0.5) {
                    const capH = peakH * 0.26;
                    const capGeo = new THREE.ConeGeometry((peakW / 2) * 0.34, capH, 5);
                    const capMat = new THREE.MeshStandardMaterial({ color: peakSnow, roughness: 0.85, flatShading: true });
                    const cap = new THREE.Mesh(capGeo, capMat);
                    cap.position.set(cone.position.x, ground.position.y + 90 + peakH - capH / 2, layer.z + 1);
                    scene.add(cap);
                    mapBackdrops.push(cap);
                }
            }
        });
    }
    // Canvas2D orqali generatsiya qilingan chiroyli fon rasmi (barcha sahnalar uchun).
    // Keng qilib yaratamiz - o'q uzoqqa uchganda ham fon tugamasligi uchun.
    const backdropTex = generateBackdropTexture(mapType, weather, 2048, 768);
    const backdropMat = new THREE.MeshBasicMaterial({
        map: backdropTex,
        transparent: false,
        side: THREE.FrontSide,
        fog: false,
        depthWrite: false
    });
    const backdropW = 40000; // Juda keng va baland - barcha rejimlar va portretda to'liq qoplaydi
    const backdropH = 15000;
    const backdropPlane = new THREE.Mesh(new THREE.PlaneGeometry(backdropW, backdropH), backdropMat);
    backdropPlane.position.set(0, ground.position.y + 100 + backdropH * 0.35, -700);
    scene.add(backdropPlane);
    mapBackdrops.push(backdropPlane);

    for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < treesPerSide; i++) {
            const treeStyle = i % 3; // 0: Grand Oak, 1: Birch/Poplar, 2: Mountain Pine
            const useSmallTree = Math.random() < smallTreeChance;
            const w = useSmallTree ? (160 + Math.random() * 50) : (230 + Math.random() * 70);
            const h = useSmallTree ? (240 + Math.random() * 70) : (330 + Math.random() * 90);
            const depthBand = Math.floor(Math.random() * 3); // 0: front, 1: middle, 2: back
            const depthOffsetX = depthBand * (110 + Math.random() * 70);
            const zByBand = depthBand === 0 ? (30 + Math.random() * 50) : (depthBand === 1 ? (-40 + Math.random() * 50) : (-150 + Math.random() * 70));
            const opacityByBand = depthBand === 0 ? (0.98 + Math.random() * 0.02) : (depthBand === 1 ? (0.94 + Math.random() * 0.04) : (0.9 + Math.random() * 0.05));

            // Ildiz markazi (pivot) pastki qismda bo'lishi uchun geometriyaning yarmini tepaga suramiz
            const treeGeo = new THREE.PlaneGeometry(w, h);
            treeGeo.translate(0, h / 2, 0); // (0, 0, 0) nuqta aynan ildiz tubi bo'ladi!

            const treeMat = new THREE.MeshBasicMaterial({
                map: getProceduralTreeTexture(treeStyle, mapType, weather),
                transparent: true,
                opacity: opacityByBand,
                side: THREE.FrontSide,
                alphaTest: 0.02,
                depthWrite: false
            });
            const tree = new THREE.Mesh(treeGeo, treeMat);
            const groundSurfaceY = ground.position.y + 100;
            tree.position.set(
                side * (safeRadius + 260 + depthOffsetX + i * (200 + Math.random() * 90)),
                groundSurfaceY, // Ildiz aynan yer chizig'iga mahkam o'rnatiladi!
                zByBand
            );
            tree.userData.baseX = tree.position.x;
            tree.userData.baseRot = (Math.random() - 0.5) * 0.02;
            tree.userData.swayAmp = 0.006 + Math.random() * 0.012;
            tree.userData.swaySpeed = 0.7 + Math.random() * 1.1;
            tree.userData.swayPhase = Math.random() * Math.PI * 2;
            tree.userData.depthBand = depthBand;

            scene.add(tree);
            decorTrees.push(tree);
        }
    }
}

function spawnEntities(options) {
    if (typeof clearStuckSpears === 'function') clearStuckSpears();
    entities.forEach(e => scene.remove(e.mesh));
    entities = [];

    if (typeof airDropCrates !== 'undefined' && Array.isArray(airDropCrates)) {
        airDropCrates.forEach(c => { if (c && c.group) scene.remove(c.group); });
        airDropCrates = [];
    }

    clouds.forEach(c => scene.remove(c));
    clouds = [];

    // Spawn Clouds
    for (let i = 0; i < 8; i++) {
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
            (Math.random() - 0.5) * 5500,
            720 + Math.random() * 320,
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
        for (let i = 0; i < birdCount; i++) {
            const bird = createCrow(0, 0);
            // Qushlar osmonda (380-840 balandlikda) ko'rinadigan erkin zonada uchadi
            bird.position.set((seededRandom() - 0.5) * 3600, 380 + seededRandom() * 460, -30 + seededRandom() * 60);
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

function spawnParticles(x, y, amount, isWood = false) {
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

// Olov nayza tegganda olov zarralari portlashi.
const fireParticleGeo = new THREE.SphereGeometry(5, 6, 6);
const fireColors = [0xff7518, 0xff3300, 0xffd000, 0xff9d00];
function spawnFireBurst(x, y, amount = 26) {
    for (let i = 0; i < amount; i++) {
        const mat = new THREE.MeshBasicMaterial({
            color: fireColors[Math.floor(Math.random() * fireColors.length)],
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const drop = new THREE.Mesh(fireParticleGeo, mat);
        drop.position.set(x, y, 22);
        drop.userData = {
            vx: (Math.random() - 0.5) * 520,
            vy: Math.random() * 620 + 160,
            vz: (Math.random() - 0.5) * 300,
            life: 0.7 + Math.random() * 0.7,
            isWood: false,
            isFire: true
        };
        scene.add(drop);
        bloodParticles.push(drop);
    }
    screenShake = MOBILE_PERF_MODE ? 12 : 20;
}

let crowSharedMaterial = null;
function getCrowMaterial() {
    if (!crowSharedMaterial) {
        crowSharedMaterial = new THREE.MeshBasicMaterial({
            map: qargaTexture,
            transparent: true,
            side: THREE.DoubleSide,
            alphaTest: 0.1,
            depthWrite: false
        });
    }
    return crowSharedMaterial;
}

function createCrow(x, y) {
    const crowGroup = new THREE.Group();
    const planeGeo = new THREE.PlaneGeometry(120, 100);
    const planeMesh = new THREE.Mesh(planeGeo, getCrowMaterial());
    planeMesh.renderOrder = 10;
    planeMesh.castShadow = true;
    crowGroup.add(planeMesh);

    crowGroup.userData.tex = qargaTexture;
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
    group.userData.isOttomanArcher = (normalizedCharType === 2 || normalizedCharType === 0);
    group.userData.isOttomanSpearman = (normalizedCharType === 3 || normalizedCharType === 1);
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
    let selectedTexture = ottomanArcherTextures.shieldIdle;
    if (normalizedCharType === 1) selectedTexture = nayzabozTexture || ottomanSpearmanTextures.shieldIdle;
    if (normalizedCharType === 2) selectedTexture = ottomanArcherTextures.shieldIdle;
    if (normalizedCharType === 3) selectedTexture = ottomanSpearmanTextures.shieldIdle;
    if (group.userData.isCustomModel) {
        const customTex = window.customModelTextures && window.customModelTextures[normalizedCharType];
        if (customTex && (customTex.shieldIdle || customTex.noShieldIdle)) {
            selectedTexture = customTex.shieldIdle || customTex.noShieldIdle;
        } else {
            selectedTexture = ottomanArcherTextures.shieldIdle;
            if (typeof fetchCustomModels === 'function') {
                fetchCustomModels().then(() => {
                    const lateTex = window.customModelTextures && window.customModelTextures[normalizedCharType];
                    if (lateTex && (lateTex.shieldIdle || lateTex.noShieldIdle) && group.userData.mats && group.userData.mats[0]) {
                        group.userData.mats[0].map = lateTex.shieldIdle || lateTex.noShieldIdle;
                        group.userData.mats[0].needsUpdate = true;
                        group.userData.customTextures = lateTex;
                    }
                }).catch(() => {});
            }
        }
    }
    const tex = selectedTexture || ottomanArcherTextures.shieldIdle;
    if (tex) {
        if (group.userData.isOttomanUnit) {
            tex.repeat.set(1, 1);
        } else {
            tex.repeat.set(0.26, 0.78);
        }
        tex.offset.set(0, 0);
    }

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
    let cWidth = group.userData.isOttomanSpearman ? 640 : (group.userData.isOttomanUnit ? 560 : 360);
    let cHeight = group.userData.isOttomanUnit ? 430 : 480;
    let cOffsetY = 0;
    let cOffsetX = 0;

    let facesLeft = false;
    if (group.userData.isCustomModel) {
        const cModel = (window.customModelsInfo || []).find(m => m.id == normalizedCharType);
        if (cModel && cModel.settings) {
            cWidth = cModel.settings.width || cWidth;
            cHeight = cModel.settings.height || cHeight;
            cOffsetY = cModel.settings.offsetY || 0;
            cOffsetX = cModel.settings.offsetX || 0;
            facesLeft = !!cModel.settings.facesLeft;
        }
    }
    const planeWidth = cWidth * mobileScaleBoost;
    const planeHeight = cHeight * mobileScaleBoost;
    const planeGeo = new THREE.PlaneGeometry(planeWidth, planeHeight);
    const planeMesh = new THREE.Mesh(planeGeo, soldierMat);
    planeMesh.position.y = planeHeight / 2 + cOffsetY;
    planeMesh.position.x = isP1 ? cOffsetX : -cOffsetX;

    // Yuzma-yuz turishni ta'minlash: Agar rasm chapga qaragan bo'lsa P1 ni o'girish, 
    // agar rasm o'ngga qaragan bo'lsa P2 ni o'girish kerak.
    const shouldFlip = isP1 ? facesLeft : !facesLeft;
    if (shouldFlip) {
        planeMesh.scale.x = -1;
    }
    if (group.userData.isOttomanUnit && !cOffsetX) planeMesh.position.x = 0;
    group.userData.planeMesh = planeMesh;
    group.userData.basePlaneY = planeHeight / 2;
    group.userData.planeWidth = planeWidth;
    group.userData.planeHeight = planeHeight;
    group.userData.baseWidth = cWidth;
    group.userData.baseHeight = cHeight;
    group.userData.facesLeft = facesLeft;
    group.userData.shouldFlip = shouldFlip;
    planeMesh.castShadow = true;
    group.userData.torso.add(planeMesh); // attach to torso so breath animation works
    group.add(group.userData.torso);

    // Keep feet on the visible top of the ground.
    group.position.y = ground.position.y + (group.userData.isOttomanUnit ? 78 : 86);
    group.userData.standingY = group.position.y;
    group.userData.baseY = group.position.y;
    group.rotation.z = 0;
    group.userData.isKnockedDown = false;
    group.userData.isDead = false;

    scene.add(group);
    return group;
}

function getOttomanArcherTexture(model, state) {
    const broken = !!model.userData.shieldBroken;
    const baseIdle = broken ? (ottomanArcherTextures.noShieldIdle || ottomanArcherTextures.shieldIdle) : (ottomanArcherTextures.shieldIdle || ottomanArcherTextures.noShieldIdle);
    const baseAim = broken ? (ottomanArcherTextures.noShieldAim || ottomanArcherTextures.shieldAim || baseIdle) : (ottomanArcherTextures.shieldAim || ottomanArcherTextures.noShieldAim || baseIdle);
    const baseAfterShot = broken ? (ottomanArcherTextures.noShieldAfterShot || ottomanArcherTextures.shieldAfterShot || baseAim) : (ottomanArcherTextures.shieldAfterShot || ottomanArcherTextures.noShieldAfterShot || baseAim);
    const baseHurt = broken ? (ottomanArcherTextures.noShieldHurt || ottomanArcherTextures.shieldHurt || baseIdle) : (ottomanArcherTextures.shieldHurt || ottomanArcherTextures.noShieldHurt || baseIdle);
    const baseDuck = broken ? (ottomanArcherTextures.noShieldDuck || ottomanArcherTextures.shieldDuck || baseIdle) : (ottomanArcherTextures.shieldDuck || ottomanArcherTextures.noShieldDuck || baseIdle);
    const baseDefend = broken ? (ottomanArcherTextures.noShieldDefend || ottomanArcherTextures.shieldDefend || baseIdle) : (ottomanArcherTextures.shieldDefend || ottomanArcherTextures.noShieldDefend || baseIdle);

    if (state === 'celebrate') return ottomanArcherTextures.celebrate || baseIdle;
    if (state === 'break') return ottomanArcherTextures.shieldBreak || baseIdle;
    if (state === 'hurt') return baseIdle;
    if (state === 'jump') return baseDuck;
    if (state === 'duck') return baseDuck;
    if (state === 'defend') return baseDefend;
    if (state === 'aim' || state === 'load') return baseAim;
    if (state === 'afterShot') return baseAfterShot;
    return baseIdle;
}

function getOttomanSpearmanTexture(model, state) {
    const broken = !!model.userData.shieldBroken;
    const baseIdle = broken ? (ottomanSpearmanTextures.noShieldIdle || ottomanSpearmanTextures.shieldIdle) : (ottomanSpearmanTextures.shieldIdle || ottomanSpearmanTextures.noShieldIdle);
    const baseAim = broken ? (ottomanSpearmanTextures.noShieldAim || ottomanSpearmanTextures.shieldAim || baseIdle) : (ottomanSpearmanTextures.shieldAim || ottomanSpearmanTextures.noShieldAim || baseIdle);
    const baseAfterShot = broken ? (ottomanSpearmanTextures.noShieldAfterShot || ottomanSpearmanTextures.shieldAfterShot || baseAim) : (ottomanSpearmanTextures.shieldAfterShot || ottomanSpearmanTextures.noShieldAfterShot || baseAim);
    const baseHurt = broken ? (ottomanSpearmanTextures.noShieldHurt || ottomanSpearmanTextures.shieldHurt || baseIdle) : (ottomanSpearmanTextures.shieldHurt || ottomanSpearmanTextures.noShieldHurt || baseIdle);
    const baseDuck = broken ? (ottomanSpearmanTextures.noShieldDuck || ottomanSpearmanTextures.shieldDuck || baseIdle) : (ottomanSpearmanTextures.shieldDuck || ottomanSpearmanTextures.noShieldDuck || baseIdle);
    const baseDefend = broken ? (ottomanSpearmanTextures.noShieldDefend || ottomanSpearmanTextures.shieldDefend || baseIdle) : (ottomanSpearmanTextures.shieldDefend || ottomanSpearmanTextures.noShieldDefend || baseIdle);

    if (state === 'break') return ottomanSpearmanTextures.shieldBreak || baseIdle;
    if (state === 'celebrate') return ottomanSpearmanTextures.celebrate || baseIdle;
    if (state === 'hurt') return baseIdle;
    if (state === 'jump') return baseDuck;
    if (state === 'duck') return baseDuck;
    if (state === 'defend') return baseDefend;
    if (state === 'aim' || state === 'load') return baseAim;
    if (state === 'afterShot') return baseAfterShot;
    return baseIdle;
}

function getOttomanTexture(model, state) {
    if (!model || !model.userData) return null;
    const charType = String(model.userData.charType);
    if (charType.startsWith('custom_') && window.customModelTextures && window.customModelTextures[charType]) {
        const t = window.customModelTextures[charType];
        const shieldBroken = !!model.userData.shieldBroken;
        const baseIdle = shieldBroken ? (t.noShieldIdle || t.shieldIdle) : (t.shieldIdle || t.noShieldIdle);
        const baseAim = shieldBroken ? (t.noShieldAim || t.shieldAim || baseIdle) : (t.shieldAim || t.noShieldAim || baseIdle);
        const baseAfterShot = shieldBroken ? (t.noShieldAfterShot || t.shieldAfterShot || baseAim || baseIdle) : (t.shieldAfterShot || t.noShieldAfterShot || baseAim || baseIdle);
        const baseHurt = shieldBroken ? (t.noShieldHurt || t.shieldHurt || baseIdle) : (t.shieldHurt || t.noShieldHurt || baseIdle);
        const baseDuck = shieldBroken ? (t.noShieldDuck || t.shieldDuck || baseIdle) : (t.shieldDuck || t.noShieldDuck || baseIdle);
        const baseJump = shieldBroken ? (t.noShieldJump || t.shieldJump || t.noShieldDuck || t.shieldDuck || baseIdle) : (t.shieldJump || t.noShieldJump || t.shieldDuck || t.noShieldDuck || baseIdle);
        const baseDefend = shieldBroken ? (t.noShieldDefend || t.shieldDefend || baseIdle) : (t.shieldDefend || t.noShieldDefend || baseIdle);

        if (state === 'jump') return baseJump;
        if (state === 'duck') return baseDuck;
        if (state === 'aim' || state === 'load') return baseAim;
        if (state === 'defend') return baseDefend;
        if (state === 'break') return t.shieldBreak || baseIdle;
        if (state === 'hurt') return baseIdle;
        if (state === 'afterShot') return baseAfterShot;
        if (state === 'celebrate') return t.celebrate || baseIdle;
        return baseIdle;
    }
    if (model.userData.isOttomanSpearman) return getOttomanSpearmanTexture(model, state);
    return getOttomanArcherTexture(model, state);
}

function setSoldierVisual(model, state) {
    if (!model || !model.userData) return;
    let targetState = state;
    const modelIndex = getPlayerIndexByModel(model);
    if (model.userData.isOttomanUnit && modelIndex >= 0) {
        if (isJumpActiveForPlayer(modelIndex)) {
            targetState = 'jump';
        } else if (isDuckActiveForPlayer(modelIndex)) {
            targetState = 'duck';
        }
    }
    model.userData.visualState = targetState;

    if (model.userData.planeMesh && model.userData.basePlaneY) {
        model.userData.planeMesh.position.y = model.userData.basePlaneY;
    }

    if (!model.userData.isOttomanUnit) {
        const frameMap = { idle: 0, load: 0.25, aim: 0.5, afterShot: 0.75 };
        if (model.userData.tex) model.userData.tex.offset.set(frameMap[state] || 0, 0);
        return;
    }

    const texture = getOttomanTexture(model, targetState);
    if (!texture) return; // NEVER replace material map with null or undefined!
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
const pos3Offset = 180; // 54-daraja va 50+ darajalarda 2-raqib ekrandan chiqib ketmasligi va yonma-yon turishi uchun qulay masofa

let p1Model = createSoldier(true, 2);
p1Model.position.x = pos1X;

let p2Model = createSoldier(false, 2);
p2Model.position.x = pos2X;
let p3Model = null;

// Spear object
let spear = null;
let secondarySpear = null;
const spearGroup = new THREE.Group();

// ============================================================
// === HAQIQIY JANGOVAR NAYZA VA KAMON O'QI (HYPER-REALISTIC 3D) ===
// ============================================================

// 1. KAMON O'QI MODELI (Real Combat Arrow)
const arrowModelGroup = new THREE.Group();
arrowModelGroup.name = 'weapon-arrow-model';

// A) O'q tanasi (Shaft) - ingichka, sayqallangan qizg'ish-sarg'ish sadr/zarang yog'ochi
const arrowShaftMat = new THREE.MeshStandardMaterial({
    color: 0x935116,
    roughness: 0.42,
    metalness: 0.06
});
const arrowShaft = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 140, 16), arrowShaftMat);
arrowShaft.name = 'spear-shaft';
arrowShaft.rotateZ(Math.PI / 2);
arrowShaft.castShadow = true;
arrowModelGroup.add(arrowShaft);

// B) O'q uchi guruhi (Arrow Tip Group)
const arrowTipGroup = new THREE.Group();
arrowTipGroup.name = 'spear-tip-group';
arrowTipGroup.position.x = 70;

// O'qning po'lat uchli paykoni (Forged steel broadhead / bodkin)
const arrowSteelMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    metalness: 0.96,
    roughness: 0.12
});
// 4 qirrali o'tkir charxlangan po'lat paykon
const arrowBlade = new THREE.Mesh(new THREE.ConeGeometry(4.2, 28, 4), arrowSteelMat);
arrowBlade.name = 'spear-blade';
arrowBlade.rotateZ(-Math.PI / 2);
arrowBlade.position.x = 14;
arrowBlade.castShadow = true;
arrowTipGroup.add(arrowBlade);

// Paykon qirrasi
const arrowBladeEdge = new THREE.Mesh(
    new THREE.OctahedronGeometry(3.6, 0),
    new THREE.MeshStandardMaterial({ color: 0xcfd6df, metalness: 0.92, roughness: 0.18 })
);
arrowBladeEdge.scale.set(2.2, 0.4, 0.9);
arrowBladeEdge.position.x = 2;
arrowBladeEdge.name = 'spear-blade-edge';
arrowTipGroup.add(arrowBladeEdge);

// Paykon bo'g'imi (Socket ferrule)
const arrowSocket = new THREE.Mesh(
    new THREE.CylinderGeometry(1.7, 2.4, 10, 12),
    new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.88, roughness: 0.28 })
);
arrowSocket.rotateZ(Math.PI / 2);
arrowSocket.position.x = -8;
arrowTipGroup.add(arrowSocket);

// Ipak ip bilan o'ralgan paykon bog'ich halqasi (Sinew wrap)
const arrowSinew1 = new THREE.Mesh(
    new THREE.CylinderGeometry(2.0, 2.0, 5, 12),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 })
);
arrowSinew1.rotateZ(Math.PI / 2);
arrowSinew1.position.x = -14;
arrowTipGroup.add(arrowSinew1);

arrowModelGroup.add(arrowTipGroup);

// C) Patlar guruhi (Natural Feather Fletching)
const arrowFeatherGroup = new THREE.Group();
arrowFeatherGroup.name = 'spear-feather';
arrowFeatherGroup.position.x = -56;

const arrowFeatherShape = new THREE.Shape();
arrowFeatherShape.moveTo(0, 0);
arrowFeatherShape.quadraticCurveTo(18, 9, 36, 7);
arrowFeatherShape.quadraticCurveTo(28, 2, 26, 0);
arrowFeatherShape.quadraticCurveTo(14, -1, 0, 0);
const arrowFeatherGeo = new THREE.ShapeGeometry(arrowFeatherShape);
const arrowFeatherMat = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    roughness: 0.75,
    metalness: 0.05,
    side: THREE.DoubleSide
});
for (let f = 0; f < 3; f++) {
    const feather = new THREE.Mesh(arrowFeatherGeo, arrowFeatherMat.clone());
    feather.rotation.x = (f * Math.PI * 2) / 3;
    feather.position.x = -6;
    feather.castShadow = true;
    arrowFeatherGroup.add(feather);
}

// Patlarni shaftga mahkamlagan old va orqa ipak iplar (Sinew wraps)
[-8, 28].forEach(sx => {
    const wrap = new THREE.Mesh(
        new THREE.CylinderGeometry(1.9, 1.9, 3.5, 12),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 })
    );
    wrap.rotateZ(Math.PI / 2);
    wrap.position.x = sx;
    arrowFeatherGroup.add(wrap);
});

arrowModelGroup.add(arrowFeatherGroup);

// D) Nock (Kamon ipiga o'rnatiladigan shox dumi)
const arrowNock = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 1.8, 7, 12),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.85 })
);
arrowNock.rotateZ(Math.PI / 2);
arrowNock.position.x = -72;
arrowModelGroup.add(arrowNock);

spearGroup.add(arrowModelGroup);

// ============================================================
// 2. JANGOVAR NAYZA MODELI (Heavy War Spear / Javelin)
// ============================================================
const spearRealGroup = new THREE.Group();
spearRealGroup.name = 'weapon-spear-model';
spearRealGroup.visible = false; // faqat nayzaboz otganda chiqadi

// A) Nayza sopi (Shaft) - baquvvat, to'q eman/shumtol yog'ochi (uzunligi 195)
const realSpearShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(2.8, 3.2, 195, 16),
    new THREE.MeshStandardMaterial({ color: 0x45220c, roughness: 0.52, metalness: 0.08 })
);
realSpearShaft.name = 'real-spear-shaft';
realSpearShaft.rotateZ(Math.PI / 2);
realSpearShaft.castShadow = true;
spearRealGroup.add(realSpearShaft);

// B) Nayza tutqichi (Markazdagi charm o'ram va tutqich tasma)
const gripLeather = new THREE.Mesh(
    new THREE.CylinderGeometry(3.4, 3.4, 42, 16),
    new THREE.MeshStandardMaterial({ color: 0x271406, roughness: 0.85 })
);
gripLeather.rotateZ(Math.PI / 2);
gripLeather.position.x = -5;
spearRealGroup.add(gripLeather);

// Charm tutqichning oltin/bronza qirralari
[-24, 18].forEach(gx => {
    const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(3.6, 3.6, 3, 16),
        new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.85, roughness: 0.25 })
    );
    ring.rotateZ(Math.PI / 2);
    ring.position.x = gx;
    spearRealGroup.add(ring);
});

// C) Nayza uchi guruhi (Formidable Leaf Spearhead with Fuller)
const realSpearTipGroup = new THREE.Group();
realSpearTipGroup.position.x = 97;

// Elongated Diamond Leaf Blade (Bargsimon og'ir po'lat nayza uchi)
const realSpearBlade = new THREE.Mesh(
    new THREE.OctahedronGeometry(6.5, 0),
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.96, roughness: 0.14 })
);
realSpearBlade.name = 'real-spear-blade';
realSpearBlade.scale.set(3.8, 0.42, 1.25);
realSpearBlade.position.x = 18;
realSpearBlade.castShadow = true;
realSpearTipGroup.add(realSpearBlade);

// Nayza uchki nina qismi (Piercing Point)
const spearSpikePoint = new THREE.Mesh(
    new THREE.ConeGeometry(3.6, 18, 4),
    new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.98, roughness: 0.10 })
);
spearSpikePoint.rotateZ(-Math.PI / 2);
spearSpikePoint.position.x = 38;
realSpearTipGroup.add(spearSpikePoint);

// Bronza bo'g'im (Cast Bronze Ferrule/Socket)
const realSpearSocket = new THREE.Mesh(
    new THREE.CylinderGeometry(3.3, 4.4, 22, 14),
    new THREE.MeshStandardMaterial({ color: 0xb45309, metalness: 0.85, roughness: 0.3 })
);
realSpearSocket.rotateZ(Math.PI / 2);
realSpearSocket.position.x = -8;
realSpearTipGroup.add(realSpearSocket);

// Jangovar qizil popuk / bayroqcha halqasi (Red Horsehair Battle Tuft)
const tuftRing = new THREE.Mesh(
    new THREE.CylinderGeometry(5.2, 3.4, 9, 14),
    new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.95 })
);
tuftRing.rotateZ(Math.PI / 2);
tuftRing.position.x = -17;
realSpearTipGroup.add(tuftRing);

spearRealGroup.add(realSpearTipGroup);

// D) Nayza dumi / Sauroter (Rear Counterweight Butt Spike)
// Haqiqiy qadimgi nayzalarning orqasida po'lat/bronza o'tkir uch bo'ladi (yerga sanchish va orqa bilan urish uchun)
const sauroter = new THREE.Mesh(
    new THREE.ConeGeometry(3.6, 26, 12),
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.88, roughness: 0.22 })
);
sauroter.rotateZ(Math.PI / 2);
sauroter.position.x = -108;
sauroter.castShadow = true;
spearRealGroup.add(sauroter);

spearGroup.add(spearRealGroup);

// 3. ARTILERIYA BOMBASI MODELI
const bombMesh = new THREE.Mesh(new THREE.SphereGeometry(18, 16, 16), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }));
bombMesh.name = 'spear-bomb';
bombMesh.visible = false;
spearGroup.add(bombMesh);

spearGroup.castShadow = true;
scene.add(spearGroup);

// Olov nayza glow effekti (nayzaga biriktiriladi)
const fireSpearGlowMat = new THREE.SpriteMaterial({
    map: makeRadialGlowTexture('#fff2b0', '#ff5a16'),
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending
});
const fireSpearGlow = new THREE.Sprite(fireSpearGlowMat);
fireSpearGlow.name = 'fire-spear-glow';
fireSpearGlow.scale.set(150, 150, 1);
fireSpearGlow.visible = false;
spearGroup.add(fireSpearGlow);

function applyFireSpearVisual(isFire) {
    if (fireSpearGlow) fireSpearGlow.visible = !!isFire;
    [spearGroup, secondarySpearGroup].forEach((group) => {
        if (!group) return;
        const blade = group.getObjectByName('spear-blade');
        const realBlade = group.getObjectByName('real-spear-blade');
        [blade, realBlade].forEach((b) => {
            if (b && b.material) {
                if (isFire) {
                    if (b.material.emissive) b.material.emissive.setHex(0xff4500);
                    b.material.color.setHex(0xffcc66);
                } else {
                    if (b.material.emissive) b.material.emissive.setHex(0x000000);
                    b.material.color.setHex(0xffffff);
                }
                b.material.needsUpdate = true;
            }
        });
    });
}

// ============================================================
// 4. HAQIQIY 3D USMONIY EGRI KAMON (Recurve Bow Model)
// ============================================================
function create3DRecurveBow() {
    const bowGroup = new THREE.Group();
    bowGroup.name = '3d-recurve-bow';

    // Usmoniy kompozit kamonning egri profil chizig'i (Double Recurve)
    const points = [
        new THREE.Vector3(14, 52, 0),    // Yuqori tip (siyah)
        new THREE.Vector3(8, 38, 0),     // Yuqori egilish
        new THREE.Vector3(2, 22, 0),     // Yuqori yelka
        new THREE.Vector3(0, 0, 0),      // Markaziy dasta (grip)
        new THREE.Vector3(2, -22, 0),    // Quyi yelka
        new THREE.Vector3(8, -38, 0),    // Quyi egilish
        new THREE.Vector3(14, -52, 0)    // Quyi tip (siyah)
    ];
    const curve = new THREE.CatmullRomCurve3(points);
    const limbGeo = new THREE.TubeGeometry(curve, 32, 2.6, 8, false);
    const limbMat = new THREE.MeshStandardMaterial({
        color: 0x3b1d0c, // To'q shox/yog'och kompozit
        roughness: 0.38,
        metalness: 0.15
    });
    const limbMesh = new THREE.Mesh(limbGeo, limbMat);
    limbMesh.castShadow = true;
    bowGroup.add(limbMesh);

    // Kamon quloqlaridagi oltin bezak uchlar (Siyah gold tips)
    [points[0], points[points.length - 1]].forEach(pos => {
        const tipMesh = new THREE.Mesh(
            new THREE.SphereGeometry(3.6, 8, 8),
            new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.85, roughness: 0.25 })
        );
        tipMesh.position.copy(pos);
        bowGroup.add(tipMesh);
    });

    // Markaziy charm dasta (Leather Handle Grip)
    const handleGeo = new THREE.CylinderGeometry(3.6, 3.6, 18, 12);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.85 });
    const handleMesh = new THREE.Mesh(handleGeo, handleMat);
    bowGroup.add(handleMesh);

    // Kamon ipi (Bowstring - dinamik tortiladigan ipak ip)
    const stringMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
    const stringGeo = new THREE.BufferGeometry().setFromPoints([
        points[0],
        new THREE.Vector3(0, 0, 0), // O'rtadagi tortish nuqtasi
        points[points.length - 1]
    ]);
    const bowString = new THREE.Line(stringGeo, stringMat);
    bowString.name = 'bow-string';
    bowGroup.add(bowString);

    bowGroup.userData = {
        topTip: points[0],
        botTip: points[points.length - 1],
        stringMesh: bowString
    };

    return bowGroup;
}

const active3DBow = create3DRecurveBow();
active3DBow.visible = false;
scene.add(active3DBow);

const opponent3DBow = create3DRecurveBow();
opponent3DBow.visible = false;
scene.add(opponent3DBow);

let remoteAimStates = {};

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

// Uchayotgan nayza ortidagi porlovchi iz (trail) - zamonaviy vizual effekt.
const SPEAR_TRAIL_LEN = MOBILE_PERF_MODE ? 18 : 28;
const spearTrailGeo = new THREE.BufferGeometry();
const spearTrailPos = new Float32Array(SPEAR_TRAIL_LEN * 3);
spearTrailGeo.setAttribute('position', new THREE.BufferAttribute(spearTrailPos, 3));
const spearTrailMat = new THREE.LineBasicMaterial({
    color: 0xffd36b,
    transparent: true,
    opacity: 0.65,
    linewidth: 2,
    blending: THREE.AdditiveBlending,
    depthWrite: false
});
const spearTrail = new THREE.Line(spearTrailGeo, spearTrailMat);
spearTrail.frustumCulled = false;
spearTrail.visible = false;
scene.add(spearTrail);
let spearTrailHistory = [];

function resetSpearTrail() {
    spearTrailHistory = [];
    spearTrail.visible = false;
}

// Avvalgi otish trayektoriyasini hint sifatida chizadi (xira ko'k chiziq).
// O'yinchi o'q uzgan navbat parametrlarini saqlab, keyingi navbatda ko'rsatamiz.
function clearHintTrajectory() {
    if (hintTrajectoryLine) {
        scene.remove(hintTrajectoryLine);
        if (hintTrajectoryLine.geometry) hintTrajectoryLine.geometry.dispose();
        if (hintTrajectoryLine.material) hintTrajectoryLine.material.dispose();
        hintTrajectoryLine = null;
    }
}

function isPlayerOnRightSide(index) {
    if (typeof index !== 'number' || index < 0) index = myPlayerIndex;
    const model = (typeof modelForPlayer === 'function') ? modelForPlayer(index) : null;
    if (model && model.position && typeof model.position.x === 'number') {
        return model.position.x > 0;
    }
    return index === 1;
}

function buildHintTrajectory() {
    clearHintTrajectory();
    if (!lastPlayerShot) return;
    const shot = lastPlayerShot;
    let simX = shot.startX;
    let simY = shot.startY;
    const rad = shot.angle * (Math.PI / 180);
    let simVx = shot.power * Math.cos(rad);
    const isRight = isPlayerOnRightSide(shot.playerIndex);
    if (isRight) simVx = -simVx;
    let simVy = shot.power * Math.sin(rad);
    const allPoints = [];
    for (let i = 0; i < 75; i++) {
        allPoints.push(new THREE.Vector3(simX, simY, -2));
        simX += simVx * 0.05;
        simY += simVy * 0.05;
        simVy -= GRAVITY * 0.05;
        simVx += (shot.wind * 30) * 0.05;
        if (simY < ground.position.y + 100) break;
    }
    const halfCount = Math.max(5, Math.min(28, Math.floor(allPoints.length * 0.45)));
    const points = allPoints.slice(0, halfCount);
    if (points.length < 2) return;
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    // Yordamchi hint: xira moviy/siyohrang, nuqtali chiziq.
    const mat = new THREE.LineDashedMaterial({
        color: 0x38bdf8,
        dashSize: 18,
        gapSize: 14,
        transparent: true,
        opacity: 0.5,
        linewidth: 2
    });
    hintTrajectoryLine = new THREE.Line(geo, mat);
    hintTrajectoryLine.computeLineDistances();
    scene.add(hintTrajectoryLine);
}

function updateSpearTrail() {
    // Iz (trail) chizig'i olib tashlandi (foydalanuvchi so'roviga ko'ra):
    // o'q/nayza ortida "arqonsimon" iz endi chizilmaydi.
    if (spearTrail.visible) {
        spearTrail.visible = false;
        spearTrailHistory = [];
    }
    if (!spear || !spear.active) return;

    // Olov nayza: uchish paytida olov zarralari sochiladi va glow miltillaydi (bu alohida effekt).
    if (spear.isFire) {
        if (fireSpearGlow) {
            const pulse = 1 + Math.sin(performance.now() * 0.02) * 0.18;
            fireSpearGlow.scale.set(150 * pulse, 150 * pulse, 1);
        }
        if (Math.random() < 0.7) {
            spawnFireTrailParticle(spear.x, spear.y);
        }
    }
}

// Uchayotgan olov nayzadan ajralib chiqadigan kichik olov uchqunlari.
function spawnFireTrailParticle(x, y) {
    const mat = new THREE.MeshBasicMaterial({
        color: fireColors[Math.floor(Math.random() * fireColors.length)],
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const drop = new THREE.Mesh(fireParticleGeo, mat);
    drop.position.set(x + (Math.random() - 0.5) * 18, y + (Math.random() - 0.5) * 18, 22);
    drop.userData = {
        vx: (Math.random() - 0.5) * 160,
        vy: 40 + Math.random() * 120,
        vz: 0,
        life: 0.35 + Math.random() * 0.4,
        isWood: false,
        isFire: true
    };
    scene.add(drop);
    bloodParticles.push(drop);
}

function applySpearVisualStyle(isSpearmanThrow, isArtillery = false) {
    [spearGroup, secondarySpearGroup].forEach((group) => {
        if (!group) return;
        const arrow = group.getObjectByName('weapon-arrow-model');
        const realSpear = group.getObjectByName('weapon-spear-model');
        const bomb = group.getObjectByName('spear-bomb');

        if (isArtillery) {
            if (arrow) arrow.visible = false;
            if (realSpear) realSpear.visible = false;
            if (bomb) bomb.visible = true;
        } else if (isSpearmanThrow) {
            // Nayzaboz otganda: haqiqiy og'ir jangovar nayza ko'rinadi (patlarsiz, popuk va orqa uchi bilan)
            if (arrow) arrow.visible = false;
            if (realSpear) realSpear.visible = true;
            if (bomb) bomb.visible = false;
        } else {
            // Kamonchi otganda: haqiqiy nozik kamon o'qi ko'rinadi (o'tkir paykon va 3 ta qizil patlar bilan)
            if (arrow) arrow.visible = true;
            if (realSpear) realSpear.visible = false;
            if (bomb) bomb.visible = false;
        }
    });
}


let baseZoom = 1;
let screenShake = 0;
let cameraTargetX = 0;
let cameraTargetY = 400;

function isPortraitMode() {
    const vp = getAppViewport();
    if (vp.isRotated) return false;
    return (window.innerHeight / Math.max(1, window.innerWidth)) > 1.05;
}

function getFocusCameraTarget(turnIndex) {
    const isPortrait = isPortraitMode();
    const isMobileView = window.matchMedia('(max-width: 900px)').matches;

    // Jang maydonidagi barcha faol jangchilar (o'yinchi va barcha dushmanlar)ning aniq gorizontal markazi
    let centerX = 0;
    if (p1Model && p2Model) {
        let minX = Math.min(p1Model.position.x, p2Model.position.x);
        let maxX = Math.max(p1Model.position.x, p2Model.position.x);
        if (p3Model && typeof enemy2Health === 'number' && enemy2Health > 0) {
            minX = Math.min(minX, p3Model.position.x);
            maxX = Math.max(maxX, p3Model.position.x);
        }
        centerX = (minX + maxX) / 2;
    }

    const groundSurfaceY = ground.position.y + 100;
    const effectiveZoom = Math.max(0.1, baseZoom || 0.4);
    const visibleH = frustumSize / effectiveZoom;

    // Yer sathi (groundSurfaceY) ekranning pastki ~13.5% qismida joylashadi.
    // Bu orqali:
    // 1) Pastdagi tugmalar (Menu, Ortga, Super qurollar) ostida qora/ko'k bo'sh zona bo'lmaydi,
    //    chiroyli toshli zamin qismi to'liq yopib turadi.
    // 2) Jangchilar ekranda mitti emas, yirik va salobatli (heroic scale) ko'rinadi.
    // 3) Yuqori qism bo'sh qolmaydi, qushlar, bulutlar va o'q parvozi tabiiy taqsimlanadi.
    const groundBottomRatio = isPortrait ? 0.12 : (isMobileView ? 0.16 : 0.135);
    const centerY = (groundSurfaceY - groundBottomRatio * visibleH) + (visibleH / 2);

    return {
        x: centerX,
        y: centerY,
        zoom: baseZoom
    };
}

function updateCameraBounds() {
    const vp = getAppViewport();
    aspect = vp.width / Math.max(1, vp.height);
    const isPortrait = isPortraitMode();
    const isMobileView = window.matchMedia('(max-width: 900px)').matches;

    frustumSize = isPortrait ? 950 : 800;
    camera.left = -frustumSize * aspect / 2;
    camera.right = frustumSize * aspect / 2;
    camera.top = frustumSize / 2;
    camera.bottom = -frustumSize / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(vp.width, vp.height);
    renderer.setPixelRatio(getPreferredPixelRatio());

    // Jang maydoni kengligi: o'yinchi va barcha raqiblar orasidagi haqiqiy oraliq
    let minX = p1Model ? p1Model.position.x : -1200;
    let maxX = p2Model ? p2Model.position.x : 1200;
    if (p3Model && typeof enemy2Health === 'number' && enemy2Health > 0) {
        minX = Math.min(minX, p3Model.position.x);
        maxX = Math.max(maxX, p3Model.position.x);
    }
    const battleSpan = Math.abs(maxX - minX);
    // Har ikkala tomonga jangchi eni + qulay yon xoshiya (padding)
    const sidePadding = isPortrait ? 280 : (isMobileView ? 300 : 340);
    const minWorldWidth = Math.max(2200, battleSpan + sidePadding * 2);
    const zoomX = (frustumSize * aspect) / minWorldWidth;

    if (isPortrait) {
        // Portret rejimida ikkala jangchi ekranga to'liq sig'adi
        baseZoom = Math.min(zoomX * 1.15, 0.65);
    } else if (isMobileView) {
        // Mobil landshaft rejimida
        baseZoom = Math.min(zoomX * 1.0, 1.2);
    } else {
        // Kompyuter (desktop) landshaft rejimida jangchilar yirik va chiroyli ko'rinsin
        baseZoom = Math.min(zoomX * 1.02, 1.35);
    }

    if (cameraState === 'static' || cameraState === 'recover' || cameraState === 'normal') {
        const camFocus = getFocusCameraTarget(currentTurnIndex >= 0 ? currentTurnIndex : myPlayerIndex);
        cameraZoomTarget = camFocus.zoom;
        camera.zoom = camFocus.zoom;
        camera.position.x = camFocus.x;
        camera.position.y = camFocus.y;
        cameraTargetX = camFocus.x;
        cameraTargetY = camFocus.y;
        camera.updateProjectionMatrix();
    }
}

window.addEventListener('resize', updateCameraBounds);
window.addEventListener('orientationchange', () => { setTimeout(updateCameraBounds, 120); });

// Game State
let gameMode = 'menu';
var autoJoinExecuted = false;
window.autoJoinExecuted = false;
let myPlayerIndex = -1;
let currentRoomName = null;
let currentTurnIndex = 0;
let currentWind = 0;
let isAnimating = false;
let singleShotLocked = false;
let myHealth = 100;
let enemyHealth = 100;
let enemy2Health = 100; // 50+ levelda ikkinchi dushman uchun alohida jon
let myShield = 5;
let enemyShield = 5;
let mySuper = 5;
let enemySuper = 5;
let myCrow = 0;
let enemyCrow = 0;
let myDefenseActive = false;
let enemyDefenseActive = false;
const duckStates = [false, false, false];
let myDuckActive = false;
let enemyDuckActive = false;
let p3DuckActive = false;
let myJumpActive = false;
let enemyJumpActive = false;
let p3JumpActive = false;
const jumpStates = [
    { active: false, startTime: 0, duration: 750, height: 165, baseY: null },
    { active: false, startTime: 0, duration: 750, height: 165, baseY: null },
    { active: false, startTime: 0, duration: 750, height: 165, baseY: null }
];
let isDoubleSpearActive = false;
let pendingDoubleShot = null;
let isFireSpearActive = false; // Olov nayza qobiliyati yoqilganmi
let pendingFireShot = false;   // Joriy otish olov nayzami
const SUPER_BUY_COST = 75;
const DOUBLE_BUY_COST = 110;
const WALL_BUY_COST = 250;
const FIRE_SPEAR_BUY_COST = 140;
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
    const menuPlayerName = document.getElementById('menu-player-name');
    if (menuPlayerName && myProfile && myProfile.name) {
        menuPlayerName.innerText = myProfile.name;
    }
    const menuAvatarImg = document.getElementById('menu-avatar-img');
    const menuAvatarFallback = document.getElementById('menu-avatar-fallback');
    if (menuAvatarImg && menuAvatarFallback) {
        if (myProfile.photoUrl) {
            menuAvatarImg.src = myProfile.photoUrl;
            menuAvatarImg.style.display = 'block';
            menuAvatarFallback.style.display = 'none';
        } else {
            menuAvatarImg.style.display = 'none';
            menuAvatarFallback.style.display = 'inline-block';
            menuAvatarFallback.innerText = myProfile.avatar || '👤';
        }
    } else {
        const menuAvatarIcon = document.getElementById('menu-avatar-icon');
        if (menuAvatarIcon && myProfile && myProfile.avatar) {
            menuAvatarIcon.innerText = myProfile.avatar;
        }
    }
    const menuTierBadge = document.getElementById('menu-tier-badge');
    if (menuTierBadge) {
        const score = Number(myStats.score || 0);
                const t = (typeof translations !== 'undefined' && translations[myProfile?.lang]) ? translations[myProfile.lang] : {};
        let tier = t.tierBronze || "🥉 Bronza";
        let tierColor = "#d97706";
        if (score >= 3000) { tier = t.tierLegend || "👑 Afsona"; tierColor = "#ec4899"; }
        else if (score >= 2000) { tier = t.tierDiamond || "💎 Olmos"; tierColor = "#38bdf8"; }
        else if (score >= 1200) { tier = t.tierGold || "🥇 Oltin"; tierColor = "#eab308"; }
        else if (score >= 600) { tier = t.tierSilver || "🥈 Kumush"; tierColor = "#94a3b8"; }
        menuTierBadge.innerText = tier;
        menuTierBadge.style.color = tierColor;
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
    // Masofa bosqichma-bosqich me'yorida oshadi (uzoqroq = qiyinroq, lekin jangchilar ekranda yirik va aniq ko'rinadi).
    const distance = Math.min(2700, 2400 + (lvl - 1) * 4);
    // Qushlar (to'siq) soni level oshgani sayin ko'payadi.
    const birds = Math.min(28, Math.floor(4 + lvl * 0.55));

    // Qiyinlik silliq egri chiziq bo'ylab oshadi.
    const t = Math.min(1, (lvl - 1) / 99); // 0..1 (1-level=0, 100-level=1)
    let hitRate = 0.55 + t * 0.43;          // AI aniqligi 0.55 -> 0.98
    let aiPrecision = 0.6 + t * 0.4;        // 0.6 -> 1.0
    let birdTargetChance = 0.1;

    // === Raqib zahiralari levelga qarab o'sadi (max 6 ta, 100-levelda) ===
    // Super kuch: 1-levelda 1, 100-levelda 6
    let enemySuperCharges = Math.max(1, Math.min(6, Math.floor(1 + t * 5)));
    // Super ishlatish ehtimoli
    let enemySuperUseChance = Math.min(0.62, 0.06 + t * 0.6);
    // Qalqon ishlatish imkoniyati: 1-levelda 1, 100-levelda 6
    let enemyShieldAutoUses = Math.max(1, Math.min(6, Math.floor(1 + t * 5)));
    // Super avtomatik ishlatish: 1-levelda 1, 100-levelda 6
    let enemySuperAutoUses = Math.max(1, Math.min(6, Math.floor(1 + t * 5)));

    // 50-leveldan keyin DOIM ikki dushman jangchisi bo'ladi.
    let enemyCount = lvl > 50 ? 2 : 1;
    // Devor (to'siq) 18-leveldan boshlab dushmanda paydo bo'ladi. FAQAT 1 TA!
    let enemyWallEnabled = lvl >= 18;

    const env = getCampaignEnvironment(lvl);
    return {
        level: lvl,
        distance,
        birds,
        enemyCount,
        enemyWallEnabled,
        enemyWallCount: 1, // Devor har doim faqat 1 ta
        hitRate,
        aiPrecision,
        birdTargetChance,
        enemySuperCharges,
        enemySuperUseChance,
        enemyShieldAutoUses,
        enemySuperAutoUses,
        // 50+ levellarda ikkala dushman bir navbatda tengidan o'q uzadi (volley).
        enemyVolleySimultaneous: lvl > 50,
        map: env.map,
        weather: env.weather
    };
}

// Kampaniya levelining tematik muhitini qaytaradi (xarita + ob-havo).
// Har bir level guruhi alohida tabiat/shahar bo'lib, dunyo bo'ylab sayohat hissi beradi.
function getCampaignEnvironment(level) {
    const lvl = Math.max(1, level || 1);
    // Boy, xilma-xil sahna ketma-ketligi (har 5 levelda yangi muhit).
    // Tabiat va tarixiy shaharlar aralashmasi.
    const scenes = [
        { map: 'field', weather: 'sunny' },   // 1-5   yashil dala, quyoshli
        { map: 'desert', weather: 'sunny' },   // 6-10  cho'l
        { map: 'field', weather: 'rain' },    // 11-15 yomg'irli dala
        { map: 'samarkand', weather: 'sunny' },   // 16-20 Samarqand
        { map: 'mountain', weather: 'sunny' },   // 21-25 tog'
        { map: 'winter', weather: 'snow' },    // 26-30 qor
        { map: 'bukhara', weather: 'sunny' },   // 31-35 Buxoro
        { map: 'castle', weather: 'night' },   // 36-40 qal'a, tun
        { map: 'oasis', weather: 'sunny' },   // 41-45 voha
        { map: 'istanbul', weather: 'sunny' },   // 46-50 Istanbul
        { map: 'field', weather: 'storm' },   // 51-55 bo'ronli dala
        { map: 'volcano', weather: 'night' },   // 56-60 vulqon, tun
        { map: 'winter', weather: 'night' },   // 61-65 qishki tun
        { map: 'samarkand', weather: 'night' },   // 66-70 Samarqand, tun
        { map: 'canyon', weather: 'sunny' },   // 71-75 kanyon
        { map: 'desert', weather: 'storm' },   // 76-80 cho'l bo'roni
        { map: 'istanbul', weather: 'rain' },    // 81-85 Istanbul, yomg'ir
        { map: 'mountain', weather: 'snow' },    // 86-90 qorli tog'
        { map: 'bukhara', weather: 'night' },   // 91-95 Buxoro, tun
        { map: 'castle', weather: 'storm' }    // 96-100 qal'a, jala
    ];
    const idx = Math.floor((lvl - 1) / 5) % scenes.length;
    let { map, weather } = scenes[idx];
    // Mantiqiy moslik tuzatishlari.
    if (map === 'desert' && weather === 'snow') weather = 'sunny';
    if (map === 'winter' && (weather === 'rain' || weather === 'storm')) weather = 'snow';
    return { map, weather };
}

function applyBattlePositions() {
    const half = currentBattleDistance / 2;
    const playerLeftSide = (typeof singleCampaignLevel !== 'undefined' ? (singleCampaignLevel % 2 === 1) : true);
    if (playerLeftSide || gameMode === 'multi') {
        p1Model.position.x = -half;
        p2Model.position.x = half;
        if (p3Model) {
            p3Model.position.x = half + pos3Offset;
            p3Model.position.z = -15;
        }
    } else {
        p1Model.position.x = -half;
        p2Model.position.x = half;
        if (p3Model) {
            p3Model.position.x = -half - pos3Offset;
            p3Model.position.z = -15;
        }
    }
}

function getEnemyIndices() {
    const enemies = [];
    if (myPlayerIndex !== 0 && (enemyHealth > 0 || myPlayerIndex === 0)) enemies.push(0);
    if (myPlayerIndex !== 1 && (enemyHealth > 0 || myPlayerIndex === 1)) enemies.push(1);
    if (p3Model && myPlayerIndex !== 2 && enemy2Health > 0) enemies.push(2);
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

// Ikki o'yinchi bir jamoada (ittifoqchi) ekanligini aniqlaydi.
// Single rejimda: o'yinchi yolg'iz, qolgan barcha indekslar dushman jamoasi.
// Dushmanlar bir-birini urmasligi kerak (50+ levelda ikki dushman).
function areAllies(indexA, indexB) {
    if (indexA === indexB) return true;
    if (gameMode !== 'single') return false;
    const enemies = [0, 1, 2].filter(idx => idx !== myPlayerIndex);
    const aIsEnemy = enemies.includes(indexA);
    const bIsEnemy = enemies.includes(indexB);
    // Ikkisi ham dushman bo'lsa - ittifoqchi (bir-birini urmasin).
    return aIsEnemy && bIsEnemy;
}

// Berilgan targetIndex uchun jonni kamaytiradi (p3 uchun alohida enemy2Health).
function applyDamageToTarget(targetIndex, damage) {
    if (targetIndex === myPlayerIndex) {
        myHealth -= damage;
        if (myHealth <= 0) {
            myHealth = 0;
            const myModel = modelForPlayer(myPlayerIndex);
            if (myModel) {
                myModel.userData.isKnockedDown = true;
                setSoldierVisual(myModel, 'hurt');
                if (myModel.userData.planeMesh && myModel.userData.planeMesh.material) {
                    myModel.userData.planeMesh.material.opacity = 0.45;
                }
                knockDownModel(myModel);
            }
        }
    } else if (p3Model && targetIndex === 2) {
        enemy2Health -= damage;
        if (enemy2Health <= 0) {
            enemy2Health = 0;
            if (p3Model) {
                p3Model.userData.isKnockedDown = true;
                setSoldierVisual(p3Model, 'hurt');
                if (p3Model.userData.planeMesh && p3Model.userData.planeMesh.material) {
                    p3Model.userData.planeMesh.material.opacity = 0.45;
                }
                knockDownModel(p3Model);
            }
        }
    } else {
        enemyHealth -= damage;
        if (enemyHealth <= 0) {
            enemyHealth = 0;
            const primaryEnemy = (myPlayerIndex === 0) ? p2Model : p1Model;
            if (primaryEnemy) {
                primaryEnemy.userData.isKnockedDown = true;
                setSoldierVisual(primaryEnemy, 'hurt');
                if (primaryEnemy.userData.planeMesh && primaryEnemy.userData.planeMesh.material) {
                    primaryEnemy.userData.planeMesh.material.opacity = 0.45;
                }
                knockDownModel(primaryEnemy);
            }
        }
    }
}

// Berilgan targetIndex uchun jon qolganligini tekshiradi.
function getHealthForTarget(targetIndex) {
    if (targetIndex === myPlayerIndex) return myHealth;
    if (p3Model && targetIndex === 2) return enemy2Health;
    return enemyHealth;
}

// Barcha dushmanlar o'ldimi tekshiradi (50+ levelda ikkisi ham 0 bo'lishi kerak).
function areAllEnemiesDead() {
    if (enemyHealth <= 0) {
        if (p3Model) return enemy2Health <= 0;
        return true;
    }
    return false;
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
    if (typeof index === 'number' && index >= 0 && index < duckStates.length) {
        return !!duckStates[index];
    }
    if (index === myPlayerIndex) return !!myDuckActive;
    return false;
}

function isJumpActiveForPlayer(index) {
    if (index < 0 || index >= jumpStates.length) return false;
    return jumpStates[index].active;
}

function updateShieldUI() {
    if (!shieldCountText) return;
    shieldCountText.innerText = Math.max(0, myShield);
    if (shieldButton) shieldButton.classList.toggle('broken', myShield <= 0);
    updateEnemyResourcesUI();
}

// Raqibning qolgan resurslari (qalqon, super, qo'sh nayza, devor) ko'rsatiladi.
function updateEnemyResourcesUI() {
    const panel = document.getElementById('enemy-resources');
    if (!panel) return;
    if (gameMode !== 'single' && gameMode !== 'multi') {
        panel.classList.add('hidden');
        return;
    }
    panel.classList.remove('hidden');
    const shieldEl = document.getElementById('enemy-res-shield');
    const superEl = document.getElementById('enemy-res-super');
    const doubleEl = document.getElementById('enemy-res-double');
    const wallEl = document.getElementById('enemy-res-wall');
    if (shieldEl) shieldEl.innerText = String(Math.max(0, enemyShield));
    if (superEl) superEl.innerText = String(Math.max(0, enemySuper));
    // Qo'sh nayza - raqibda yo'q (faqat o'yinchida)
    if (doubleEl) doubleEl.innerText = '0';
    if (wallEl) {
        // Devor faqat 1 ta bo'lishi mumkin
        const enemyIdx = getPrimaryEnemyTurnIndex ? getPrimaryEnemyTurnIndex() : (myPlayerIndex === 0 ? 1 : 0);
        const ew = wallStates && wallStates[enemyIdx];
        wallEl.innerText = (ew && ew.active) ? '1' : '0';
    }
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

    // Olov nayza tugmasi
    const fireBtn = document.getElementById('fire-button');
    const fireCountText = document.getElementById('fire-count');
    const fireCount = Math.max(0, Number(myProfile.fireSpears || 0));
    if (fireCountText) fireCountText.innerText = String(fireCount);
    if (fireBtn) {
        if (fireCount > 0) {
            fireBtn.style.display = 'inline-flex';
            fireBtn.classList.remove('hidden', 'broken');
        } else {
            isFireSpearActive = false;
            fireBtn.classList.remove('active');
            fireBtn.style.display = 'none';
            fireBtn.classList.add('hidden');
        }
        fireBtn.classList.toggle('active', isFireSpearActive && fireCount > 0);
    }

    // Artillery and Crow buttons logic
    artilleryCount = Number(myProfile.artillery || 0);
    myCrow = Number(myProfile.crowhunt || 0);

    const artCountText = document.getElementById('artillery-count');
    const bArtillery = document.getElementById('artillery-button');
    if (artCountText) artCountText.innerText = String(Math.max(0, artilleryCount));
    if (bArtillery) {
        if (artilleryCount > 0) {
            bArtillery.style.display = 'inline-flex';
            bArtillery.classList.remove('hidden');
        } else {
            bArtillery.style.display = 'none';
            bArtillery.classList.add('hidden');
        }
    }

    const cBtn = document.getElementById('crow-button');
    const cCountText = document.getElementById('crow-count');
    if (cCountText) cCountText.innerText = String(Math.max(0, myCrow));
    if (cBtn) {
        if (myCrow > 0) {
            cBtn.style.display = 'inline-flex';
            cBtn.classList.remove('hidden');
        } else {
            cBtn.style.display = 'none';
            cBtn.classList.add('hidden');
        }
    }

    updateShopUI();
    updateEnemyResourcesUI();
}

function updateShopUI() {
    const score = Number(myStats.score || 0);
    const doubleCount = Math.max(0, Number(myProfile.doubleSpears || 0));
    if (shopScoreText) shopScoreText.innerText = String(score);
    if (shopSuperMaxText) shopSuperMaxText.innerText = `Narx: ${SUPER_BUY_COST} ball`;
    if (shopDoubleMaxText) shopDoubleMaxText.innerText = `Soni: ${doubleCount}`;
    if (shopWallMaxText) shopWallMaxText.innerText = `Soni: ${Math.max(0, Number(myProfile.walls || 0))}`;
    const shopArtilleryMaxText = document.getElementById('shop-artillery-max');
    if (shopArtilleryMaxText) shopArtilleryMaxText.innerText = `Soni: ${Math.max(0, Number(myProfile.artillery || 0))}`;
    const shopFireMaxText = document.getElementById('shop-fire-max');
    if (shopFireMaxText) shopFireMaxText.innerText = `Soni: ${Math.max(0, Number(myProfile.fireSpears || 0))}`;
    const fireCountSettings = document.getElementById('fire-count-settings');
    if (fireCountSettings) fireCountSettings.innerText = String(Math.max(0, Number(myProfile.fireSpears || 0)));
    const btnBuyArtillery = document.getElementById('btn-buy-artillery');
    const btnBuyFire = document.getElementById('btn-buy-fire');
    const ARTILLERY_BUY_COST = 250;
    // Narx yorliqlarini dinamik yangilaymiz (eski cache ham to'g'ri ko'rsatadi).
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = String(val); };
    setTxt('super-buy-cost', SUPER_BUY_COST);
    setTxt('double-buy-cost', DOUBLE_BUY_COST);
    setTxt('fire-buy-cost', FIRE_SPEAR_BUY_COST);
    setTxt('wall-buy-cost', WALL_BUY_COST);
    setTxt('artillery-buy-cost', ARTILLERY_BUY_COST);
    setTxt('crowhunt-buy-cost', CROWHUNT_BUY_COST);
    if (btnBuySuper) btnBuySuper.disabled = score < SUPER_BUY_COST;
    if (btnBuyDouble) btnBuyDouble.disabled = score < DOUBLE_BUY_COST;
    if (btnBuyWall) btnBuyWall.disabled = score < WALL_BUY_COST;
    if (btnBuyArtillery) btnBuyArtillery.disabled = score < ARTILLERY_BUY_COST;
    if (btnBuyFire) btnBuyFire.disabled = score < FIRE_SPEAR_BUY_COST;
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
        new THREE.MeshBasicMaterial({
            map: devorTusiqTexture,
            transparent: true,
            alphaTest: 0.02,
            side: THREE.DoubleSide,
            toneMapped: false
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
    const groundSurfaceY = ground.position.y + 100;
    mesh.position.set(0, groundSurfaceY + height / 2 - 32, 12);
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
        const groundSurfaceY = ground.position.y + 100;
        wall.mesh.position.y = groundSurfaceY + (Number(wall.mesh.userData.wallHeight || 460) / 2) - 32;
        wall.mesh.position.z = 12;
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
    const vp = getAppViewport();
    const nx = (p.x / Math.max(1, vp.width)) - 0.5;
    const ny = 0.5 - (p.y / Math.max(1, vp.height));
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
    const halfW = Number(myWall.mesh.userData.wallWidth || 280) / 2;
    const halfH = Number(myWall.mesh.userData.wallHeight || 460) / 2;
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
    const val = !!active;
    myDuckActive = val;
    if (myPlayerIndex >= 0 && myPlayerIndex < duckStates.length) {
        duckStates[myPlayerIndex] = val;
    }
    if (duckButton) duckButton.classList.toggle('active', val);
    if (myPlayerIndex >= 0 && !isDragging) {
        setSoldierVisual(modelForPlayer(myPlayerIndex), val ? 'duck' : (myDefenseActive ? 'defend' : 'idle'));
    }
    if (gameMode === 'multi' && shouldEmit && socket && socket.connected) {
        socket.emit('duckState', { active: val });
    }
}

function triggerJump(playerIndex = myPlayerIndex) {
    const m = modelForPlayer(playerIndex);
    if (!m || !m.userData || m.userData.isKnockedDown) return;
    const js = jumpStates[playerIndex];
    if (!js || js.active) return;

    js.active = true;
    js.startTime = performance.now();
    js.duration = 750;
    js.height = 165;
    if (js.baseY === null || isNaN(js.baseY) || Math.abs(m.position.y - js.baseY) > 200) {
        js.baseY = m.userData.standingY !== undefined ? m.userData.standingY : m.position.y;
    }
    m.userData.isJumping = true;

    setSoldierVisual(m, 'jump');
    spawnParticles(m.position.x, ground.position.y + 100, 10);
    playSfx('arrowSwoosh', 0.85);

    if (playerIndex === myPlayerIndex) {
        myJumpActive = true;
        if (jumpButton) {
            jumpButton.classList.add('active');
            triggerAbilityPulse(jumpButton);
        }
        if (gameMode === 'multi' && socket && socket.connected) {
            socket.emit('jumpState', { active: true });
        }
    } else {
        enemyJumpActive = true;
    }
}

function resetJumpStates() {
    jumpStates.forEach(js => {
        js.active = false;
        js.baseY = null;
    });
    for (let di = 0; di < duckStates.length; di++) duckStates[di] = false;
    myJumpActive = false;
    enemyJumpActive = false;
    p3JumpActive = false;
    myDuckActive = false;
    enemyDuckActive = false;
    p3DuckActive = false;
    if (jumpButton) jumpButton.classList.remove('active');
    if (duckButton) duckButton.classList.remove('active');
    const allModels = [p1Model, p2Model];
    if (typeof p3Model !== 'undefined' && p3Model) allModels.push(p3Model);
    allModels.forEach(m => {
        if (m && m.userData) {
            m.userData.isJumping = false;
            if (m.userData.baseY !== undefined) m.position.y = m.userData.baseY;
        }
    });
}

function getDuckCrouchSvg() {
    return `<svg viewBox="0 0 48 48" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg" class="duck-svg-icon">
        <path d="M5 43H43" stroke="rgba(255,255,255,0.75)" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M5 11L37 11M30 7L38 11L30 15" stroke="#fbbf24" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="21" cy="20" r="4.5" fill="#f8fafc"/>
        <path d="M21 24.5L25 32.5" stroke="#f8fafc" stroke-width="4.2" stroke-linecap="round"/>
        <path d="M25 32.5L15 36.5L9 43" stroke="#f8fafc" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M25 32.5L31 37.5L33 43" stroke="#cbd5e1" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M22 28L17 34" stroke="#94a3b8" stroke-width="3.2" stroke-linecap="round"/>
    </svg>`;
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
let cameraState = 'normal';
let cameraOffsetY = 120;
let cameraOffsetZ = 1450;
let cameraZoomTarget = baseZoom;

// Mobil qurilmalarda portret va landshaft rejimlariga avtomatik moslashuv
window.addEventListener('orientationchange', () => {
    setTimeout(updateCameraBounds, 100);
});
let cinematicSlowUntil = 0;
const SUPER_CINEMATIC_MS = 8000;

// === Sinematik effektni o'tkazib yuborish (skip) tizimi ===
// Super himoya bilan o'q/nayza urib tushirilgandagi sekinlashtirilgan zoom effektini
// o'yinchi xohlasa "O'tkazib yuborish" tugmasi bilan darrov tugatishi mumkin.
let cinematicSkipBtn = null;
let cinematicAfterCallback = null;   // Effekt tugagach (yoki skip qilinganda) ishlaydigan vazifa
let cinematicAfterTimer = null;
let cinematicFinished = false;

function scheduleAfterCinematic(callback) {
    // Avvalgi kutilayotgan vazifani tozalaymiz.
    if (cinematicAfterTimer) {
        clearTimeout(cinematicAfterTimer);
        cinematicAfterTimer = null;
    }
    cinematicFinished = false;
    cinematicAfterCallback = (typeof callback === 'function') ? callback : null;
    cinematicAfterTimer = setTimeout(() => {
        finishCinematicNow();
    }, SUPER_CINEMATIC_MS);
}

function finishCinematicNow() {
    if (cinematicFinished) return;
    cinematicFinished = true;
    if (cinematicAfterTimer) {
        clearTimeout(cinematicAfterTimer);
        cinematicAfterTimer = null;
    }
    const cb = cinematicAfterCallback;
    cinematicAfterCallback = null;
    if (cb) cb();
}

function getCinematicSkipBtn() {
    if (cinematicSkipBtn) return cinematicSkipBtn;
    let el = document.getElementById('skip-cinematic-btn');
    if (!el) {
        el = document.createElement('button');
        el.id = 'skip-cinematic-btn';
        el.type = 'button';
        el.className = 'skip-cinematic-btn hidden';
        el.innerHTML = "O'tkazib yuborish ⏭";
        el.style.pointerEvents = 'auto';
        el.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            skipCinematic();
        });
        const gs = document.getElementById('game-screen') || document.body;
        gs.appendChild(el);
    }
    cinematicSkipBtn = el;
    return el;
}

function showSkipCinematicButton() {
    const btn = getCinematicSkipBtn();
    btn.classList.remove('hidden');
}

function hideSkipCinematicButton() {
    const btn = getCinematicSkipBtn();
    btn.classList.add('hidden');
}

// Skip: sekinlashtirilgan effekt va zoomni darrov tugatib, navbatga o'tamiz.
function skipCinematic() {
    hideSkipCinematicButton();
    cinematicSlowUntil = 0;
    if (superInterceptCinematic) {
        clearSuperInterceptCinematic();
    }
    if (crowKillerCinematicActive) {
        crowKillerCinematicActive = false;
        crowKillerCinematicUntil = 0;
        if (cameraState === 'crowKiller') {
            cameraState = 'normal';
            cameraZoomTarget = baseZoom;
        }
    }
    resetCameraAfterImpact();
    finishCinematicNow();
}

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

function createSuperCinematicSpear(weaponType = 'arrow') {
    const g = new THREE.Group();
    if (weaponType === 'spear') {
        // Uzun jangovor nayza: uzun tana + bargsimon paykon (faqat oldida uch).
        const shaft = new THREE.Mesh(
            new THREE.CylinderGeometry(2.3, 2.7, 150, 12),
            new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 0.62, metalness: 0.08 })
        );
        shaft.rotation.z = Math.PI / 2;
        const blade = new THREE.Mesh(
            new THREE.ConeGeometry(6, 40, 16),
            new THREE.MeshStandardMaterial({ color: 0xeef2f7, metalness: 0.96, roughness: 0.14 })
        );
        blade.position.x = 92;
        blade.rotation.z = -Math.PI / 2;
        const collar = new THREE.Mesh(
            new THREE.CylinderGeometry(2.6, 3.4, 12, 12),
            new THREE.MeshStandardMaterial({ color: 0xb8860b, metalness: 0.85, roughness: 0.3 })
        );
        collar.rotation.z = Math.PI / 2;
        collar.position.x = 66;
        g.add(shaft, collar, blade);
        g.userData.cinematicLen = 150;
    } else {
        // Kamon o'qi: ingichka tana + paykon oldida + patlar orqada.
        const shaft = new THREE.Mesh(
            new THREE.CylinderGeometry(1.5, 2.0, 90, 12),
            new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 0.62, metalness: 0.08 })
        );
        shaft.rotation.z = Math.PI / 2;
        const tip = new THREE.Mesh(
            new THREE.ConeGeometry(4.4, 22, 16),
            new THREE.MeshStandardMaterial({ color: 0xeef2f7, metalness: 0.96, roughness: 0.14 })
        );
        tip.position.x = 56;
        tip.rotation.z = -Math.PI / 2;
        // Orqa patlar
        const featherMatC = new THREE.MeshStandardMaterial({ color: 0xe23b3b, roughness: 0.8, side: THREE.DoubleSide });
        const fShape = new THREE.Shape();
        fShape.moveTo(0, 0);
        fShape.quadraticCurveTo(14, 8, 26, 6);
        fShape.quadraticCurveTo(20, 1, 18, 0);
        fShape.quadraticCurveTo(10, -1, 0, 0);
        const fGeo = new THREE.ShapeGeometry(fShape);
        for (let f = 0; f < 3; f++) {
            const feather = new THREE.Mesh(fGeo, featherMatC.clone());
            feather.rotation.x = (f * Math.PI * 2) / 3;
            feather.position.x = -44;
            g.add(feather);
        }
        g.add(shaft, tip);
        g.userData.cinematicLen = 90;
    }
    return g;
}

function clearSuperInterceptCinematic() {
    if (!superInterceptCinematic) return;
    if (superInterceptCinematic.playerSpear) scene.remove(superInterceptCinematic.playerSpear);
    if (superInterceptCinematic.enemySpear) scene.remove(superInterceptCinematic.enemySpear);
    superInterceptCinematic = null;
}

// O'yinchining jangovor quroli turini aniqlaydi: 'spear' (nayza) yoki 'arrow' (kamon o'qi).
function getPlayerWeaponType(index) {
    const model = modelForPlayer(index);
    if (!model || !model.userData) return 'arrow';
    if (model.userData.isOttomanSpearman) return 'spear';
    if (model.userData.isCustomModel) {
        const cModel = (window.customModelsInfo || []).find(m => m.id == model.userData.charType);
        if (cModel && cModel.weaponType === 'spear') return 'spear';
    }
    return 'arrow';
}

function startSuperInterceptCinematic(hitX, hitY, byPlayerIndex, weaponInfo = {}) {
    clearSuperInterceptCinematic();
    const now = performance.now();
    const defenderIndex = typeof byPlayerIndex === 'number' ? byPlayerIndex : myPlayerIndex;
    const defender = modelForPlayer(defenderIndex) || p1Model;
    const startX = defender.position.x + (hitX >= defender.position.x ? 120 : -120);
    const startY = defender.position.y + 165;

    // playerSpear = super himoya qaytaruvchi quroli (himoyachining quroli),
    // enemySpear = urib tushirilgan, raqib otgan quroli (aynan o'sha tur bo'lishi shart).
    const defenderWeapon = weaponInfo.defenderWeapon || getPlayerWeaponType(defenderIndex);
    const attackerWeapon = weaponInfo.attackerWeapon || 'arrow';
    const playerSpear = createSuperCinematicSpear(defenderWeapon);
    const enemySpear = createSuperCinematicSpear(attackerWeapon);
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
    showSkipCinematicButton();
}

function updateSuperInterceptCinematic(now, dt) {
    if (!superInterceptCinematic) return;
    const seq = superInterceptCinematic;
    const elapsed = now - seq.startMs;
    if (elapsed >= seq.durationMs) {
        clearSuperInterceptCinematic();
        hideSkipCinematicButton();
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
    const camFocus = getFocusCameraTarget(currentTurnIndex >= 0 ? currentTurnIndex : myPlayerIndex);
    cameraTargetX = camFocus.x;
    cameraTargetY = camFocus.y;
    cameraZoomTarget = camFocus.zoom;
}

updateCameraBounds();


let artilleryCount = 0;
let isArtilleryAiming = false;
let myArtilleryCannon = null;
let btnArtillery = document.getElementById('artillery-button');
let artilleryCountText = document.getElementById('artillery-count');
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let dragCurrent = { x: 0, y: 0 };
let aimSfxPlayed = false;
let battleScoreEarned = 0; // Faqat shu jangda topilgan ball

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

    // Ikkinchi dushman (p3Model) uchun alohida health bar - RAQIB tomoniga qo'shiladi.
    // O'yinchi chap (index=0) bo'lsa raqib p2-info da, o'ng (index=1) bo'lsa p1-info da.
    const enemyInfoId = myPlayerIndex === 0 ? 'p2-info' : 'p1-info';
    const enemyInfoEl = document.getElementById(enemyInfoId);
    let p3Container = document.getElementById('p3-health-container');

    if (p3Model) {
        // Agar p3 health bar hali yaratilmagan bo'lsa, raqib panelida yaratamiz.
        if (!p3Container && enemyInfoEl) {
            p3Container = document.createElement('div');
            p3Container.id = 'p3-health-container';
            p3Container.className = 'health-bar-container';
            p3Container.style.marginTop = '3px';
            const p3Bar = document.createElement('div');
            p3Bar.id = 'p3-health';
            p3Bar.className = 'health-bar-fill';
            p3Container.appendChild(p3Bar);
            enemyInfoEl.appendChild(p3Container);
        }
        // Agar bor bo'lsa, to'g'ri joyda ekanligini tekshiramiz.
        if (p3Container && p3Container.parentElement !== enemyInfoEl && enemyInfoEl) {
            enemyInfoEl.appendChild(p3Container);
        }
        const p3Bar = document.getElementById('p3-health');
        if (p3Container && p3Bar) {
            p3Container.style.display = '';
            p3Bar.style.width = Math.max(0, enemy2Health) + '%';
            if (enemy2Health <= 0) {
                p3Container.style.opacity = '0.35';
                p3Bar.style.background = '#64748b';
            } else {
                p3Container.style.opacity = '1';
                if (enemy2Health < 30) p3Bar.style.background = '#ef4444';
                else if (enemy2Health < 60) p3Bar.style.background = '#f59e0b';
                else p3Bar.style.background = '#10b981';
            }
        }
    } else if (p3Container) {
        p3Container.style.display = 'none';
    }
}

let activeDamageTexts = [];

function showDamageText(worldX, worldY, damageText, isCrit = false, isShield = false) {
    if (!damageText) return;
    const vector = new THREE.Vector3(worldX, worldY, 0);
    vector.project(camera);
    const vp = getAppViewport();
    let screenX = (vector.x * .5 + .5) * vp.width;
    let screenY = (-(vector.y * .5) + .5) * vp.height;

    // Yozuvlar bir-birini ustiga chiqib qolmasligi uchun vaqt va masofaga qarab siljitish (Anti-overlap)
    const now = Date.now();
    activeDamageTexts = activeDamageTexts.filter(t => (now - t.timestamp) < 1100);

    let overlapCount = 0;
    for (let i = 0; i < activeDamageTexts.length; i++) {
        const other = activeDamageTexts[i];
        if (Math.abs(other.x - screenX) < 120 && Math.abs(other.y - screenY) < 45) {
            overlapCount++;
        }
    }

    if (overlapCount > 0) {
        screenY -= overlapCount * 28;
        screenX += (overlapCount % 2 === 1 ? 14 : -14);
    }
    activeDamageTexts.push({ x: screenX, y: screenY, timestamp: now });

    const el = document.createElement('div');
    el.className = 'damage-text';
    el.innerText = damageText;
    el.style.left = screenX + 'px';
    el.style.top = screenY + 'px';
    el.style.transform = 'translate(-50%, -50%)';

    // Ixcham va chiroyli zamonaviy shriftlar
    if (isCrit) {
        triggerHaptic('heavy');
        el.style.fontSize = 'clamp(1.15rem, 2.2vw, 1.45rem)';
        el.style.color = '#fbbf24';
        el.style.textShadow = '0 0 10px rgba(251, 191, 36, 0.6), 0 2px 4px #000';
        screenShake = MOBILE_PERF_MODE ? 14 : 22;
    } else if (isShield) {
        triggerHaptic('rigid');
        el.style.fontSize = 'clamp(1rem, 1.9vw, 1.3rem)';
        el.style.color = '#38bdf8';
        el.style.textShadow = '0 0 8px rgba(56, 189, 248, 0.6), 0 2px 4px #000';
        screenShake = MOBILE_PERF_MODE ? 8 : 12;
    } else {
        triggerHaptic('light');
        el.style.fontSize = 'clamp(0.95rem, 1.8vw, 1.25rem)';
        el.style.color = '#ef4444';
        screenShake = MOBILE_PERF_MODE ? 6 : 9;
    }

    damageContainer.appendChild(el);
    setTimeout(() => el.remove(), 1350);
}

function getCenterNoticeContainer() {
    let container = document.getElementById('center-notice-container');
    const parent = document.getElementById('game-app-root') || document.body;
    if (!container) {
        container = document.createElement('div');
        container.id = 'center-notice-container';
        container.style.cssText = 'position:absolute;top:18%;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;z-index:9999;width:max-content;max-width:90%;';
        parent.appendChild(container);
    } else if (container.parentElement !== parent) {
        parent.appendChild(container);
    }
    return container;
}

function showCenterNotice(text, duration = 1800) {
    if (!text) return;
    const container = getCenterNoticeContainer();
    const el = document.createElement('div');
    el.className = 'center-notice-banner';
    el.innerText = text;
    el.style.cssText = 'background:rgba(15,23,42,0.88);border:1px solid rgba(56,189,248,0.35);box-shadow:0 4px 14px rgba(0,0,0,0.5),0 0 10px rgba(56,189,248,0.2);color:#e0f2fe;font-size:clamp(0.82rem,1.6vw,1.05rem);font-weight:700;padding:6px 16px;border-radius:999px;text-align:center;letter-spacing:0.3px;animation:bannerPopIn 0.3s cubic-bezier(0.16,1,0.3,1) forwards;transition:opacity 0.3s ease,transform 0.3s ease;';
    container.appendChild(el);

    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(-10px) scale(0.95)';
        setTimeout(() => el.remove(), 320);
    }, duration);
}

function hideFlyingSpear() {
    spearGroup.visible = false;
    spearGroup.children.slice().forEach((child) => {
        if (child.userData && child.userData.tempCrow) spearGroup.remove(child);
    });
    secondarySpearGroup.visible = false;
    if (typeof resetSpearTrail === 'function') resetSpearTrail();
}

let stuckSpearObjects = [];
function clearStuckSpears() {
    if (!Array.isArray(stuckSpearObjects)) stuckSpearObjects = [];
    stuckSpearObjects.forEach(obj => {
        if (!obj) return;
        if (obj.parent) obj.parent.remove(obj);
        else scene.remove(obj);
        obj.traverse(c => {
            if (c.geometry && typeof c.geometry.dispose === 'function') c.geometry.dispose();
            if (c.material) {
                if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
                else if (typeof c.material.dispose === 'function') c.material.dispose();
            }
        });
    });
    stuckSpearObjects = [];
}

function stickSpear(targetModel, hitX, hitY, angle) {
    const isCrowTarget = !!(targetModel && (
        targetModel.userData?.isCrowSprite ||
        targetModel.userData?.isBird ||
        targetModel.userData?.tex === qargaTexture ||
        targetModel.type === 'bird' ||
        (targetModel.mesh && targetModel.mesh.userData?.isCrowSprite) ||
        (targetModel.children && targetModel.children.some(c => c.userData && c.userData.isCrowSprite)) ||
        (Array.isArray(entities) && entities.some(e => e.mesh === targetModel || e === targetModel))
    ));
    const groundSurfaceY = ground.position.y + 100;
    const isAtGroundLevel = (!targetModel || isCrowTarget || hitY <= groundSurfaceY + 25);

    // Agar nayza yerga sanchilgan bo'lsa (yoki qush/qarg'a bilan birga yerga kirgan bo'lsa):
    // Yer ostiga kirgan qismi (uch va paykon) MUTLAQO KO'RINMAYDI!
    // Faqat yerdan yuqoriga qaragan dasta (shaft) va patlar ko'rinadi.
    if (!targetModel || isCrowTarget || isAtGroundLevel) {
        const groundStuckGroup = new THREE.Group();
        groundStuckGroup.name = 'ground-stuck-spear';
        groundStuckGroup.position.set(hitX, groundSurfaceY, 14);
        groundStuckGroup.rotation.z = angle;

        // Qurol turi va miqyosi
        const isSpearmanThrow = (spear && spear.weaponType === 'spear') || (spearGroup && spearGroup.scale.x > 1.2);
        const shaftLength = isSpearmanThrow ? 115 : 95;
        const shaftRadius = isSpearmanThrow ? 2.1 : 1.6;

        // Shaft (dasta): Faqat x = 0 (yer yuzasi) dan x = -shaftLength (havodagi orqa qism) gacha cho'ziladi.
        // Hech bir nuqtasi x > 0 (yer osti) da bo'lmaydi!
        const shaftGeo = new THREE.CylinderGeometry(shaftRadius * 0.85, shaftRadius * 1.1, shaftLength, 10);
        let shaftMat;
        if (spear && spear.isFire) {
            shaftMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.7, emissive: 0xb45309, emissiveIntensity: 0.35 });
        } else {
            shaftMat = new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 0.65, metalness: 0.08 });
        }
        const shaftMesh = new THREE.Mesh(shaftGeo, shaftMat);
        shaftMesh.rotation.z = Math.PI / 2;
        shaftMesh.position.x = -shaftLength / 2;
        groundStuckGroup.add(shaftMesh);

        // Patlar (fletching): Faqat orqa uchida (havoda) joylashadi
        let featherColor = isSpearmanThrow ? 0x7c3aed : 0xe23b3b;
        if (spear && spear.isFire) featherColor = 0xff5500;
        else if (spear && spear.isSuper) featherColor = 0xa855f7;

        const fMat = new THREE.MeshStandardMaterial({
            color: featherColor,
            roughness: 0.8,
            metalness: 0.05,
            side: THREE.DoubleSide
        });
        const fShape = new THREE.Shape();
        fShape.moveTo(0, 0);
        fShape.quadraticCurveTo(14, 8, 26, 6);
        fShape.quadraticCurveTo(20, 2, 18, 0);
        fShape.quadraticCurveTo(10, -1, 0, 0);
        const fGeo = new THREE.ShapeGeometry(fShape);
        for (let f = 0; f < 3; f++) {
            const fMesh = new THREE.Mesh(fGeo, fMat.clone());
            fMesh.rotation.x = (f * Math.PI * 2) / 3;
            fMesh.position.x = -shaftLength + 14;
            groundStuckGroup.add(fMesh);
        }

        // Nock (orqa dasta uchi)
        const nockMesh = new THREE.Mesh(
            new THREE.CylinderGeometry(shaftRadius * 1.25, shaftRadius, 6, 8),
            new THREE.MeshStandardMaterial({ color: 0x2a1c10, roughness: 0.85 })
        );
        nockMesh.rotation.z = Math.PI / 2;
        nockMesh.position.x = -shaftLength;
        groundStuckGroup.add(nockMesh);

        // Yerga sanchilgan nuqtadagi 2 ta mayda toshcha (zarba effekti)
        for (let p = 0; p < 2; p++) {
            const peg = new THREE.Mesh(
                new THREE.DodecahedronGeometry(1.6 + Math.random() * 1.0),
                new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.95 })
            );
            peg.position.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 3);
            groundStuckGroup.add(peg);
        }

        scene.add(groundStuckGroup);
        stuckSpearObjects.push(groundStuckGroup);

        // Agar bu qarg'a bo'lsa, qarg'a ham yer sathiga to'g'ri yotqiziladi
        if (isCrowTarget && targetModel) {
            targetModel.position.set(hitX, groundSurfaceY, 2);
            if (targetModel.children && targetModel.children.length > 1) {
                targetModel.children.slice().forEach(child => {
                    if (child !== targetModel.children[0] && (child.name?.includes('spear') || child.type === 'Group')) {
                        targetModel.remove(child);
                    }
                });
            }
        }
        return;
    }

    // Agar yuqorida (havoda) turgan jangchiga sanchilgan bo'lsa:
    const stuckSpear = spearGroup.clone();
    stuckSpear.visible = true;
    stuckSpear.rotation.z = angle;
    stuckSpear.children.slice().forEach((child) => {
        if (child.userData && child.userData.tempCrow) stuckSpear.remove(child);
    });
    stuckSpear.position.set(hitX, hitY, 0);
    scene.add(stuckSpear);
    targetModel.attach(stuckSpear);
    stuckSpearObjects.push(stuckSpear);
}

function knockDownModel(model) {
    if (!model || !model.userData) return;

    const modelIndex = getPlayerIndexByModel(model);
    const isDead = (modelIndex >= 0 && getHealthForTarget(modelIndex) <= 0);

    // Agar model allaqachon o'lgan bo'lsa va yerda yotgan bo'lsa, qayta yiqitish shart emas
    if (model.userData.isDead && model.userData.isKnockedDown) return;

    // Har qanday avvalgi yiqilish/turish taymer va animatsiyalarini bekor qilamiz
    if (model.userData.knockDownTimer) {
        clearTimeout(model.userData.knockDownTimer);
        model.userData.knockDownTimer = null;
    }
    if (model.userData.knockDownAnimId) {
        cancelAnimationFrame(model.userData.knockDownAnimId);
        model.userData.knockDownAnimId = null;
    }

    model.userData.isKnockedDown = true;
    model.userData.isDead = isDead;

    // Asl tik turgan Y koordinatasini eslab qolamiz
    const standingY = (typeof model.userData.standingY === 'number')
        ? model.userData.standingY
        : (model.position.y || (ground.position.y + 78));
    model.userData.standingY = standingY;

    // Modelning default tik turgan holatini saqlaymiz (alohida yotgan rasm shart emas)
    setSoldierVisual(model, 'idle');

    // Yiqilish yo'nalishi:
    // O'ng tomondagi jangchi (x >= 0) o'q zarbidan orqaga (o'ng tomonga) yiqiladi: soat strelkasi bo'yicha -90 gradus (-Math.PI / 2)
    // Chap tomondagi jangchi (x < 0) o'q zarbidan orqaga (chap tomonga) yiqiladi: soat strelkasiga qarshi +90 gradus (+Math.PI / 2)
    const fallDir = (model.position.x >= 0) ? -1 : 1;
    const targetRotZ = fallDir * (Math.PI / 2);

    // Yer sathiga to'g'ri yotish balandligi (model yer ostiga kirmasligi uchun)
    const groundSurfaceY = ground.position.y + 100;
    const fallenY = groundSurfaceY + 68;

    const startRotZ = model.rotation.z || 0;
    const startY = model.position.y;
    const fallDuration = 320; // 320ms silliq gravitatsiya bilan yerga yiqilish
    const startTime = performance.now();

    function stepFall(now) {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / fallDuration);
        // Gravitatsiya tezlashuvi effekti (easeInQuad)
        const ease = progress * progress;

        model.rotation.z = startRotZ + (targetRotZ - startRotZ) * ease;
        model.position.y = startY + (fallenY - startY) * ease;

        if (progress < 1) {
            model.userData.knockDownAnimId = requestAnimationFrame(stepFall);
        } else {
            model.rotation.z = targetRotZ;
            model.position.y = fallenY;
            model.userData.knockDownAnimId = null;

            // Yerga zarb bilan tushish effekti
            playSfx('ground', 0.85);
            spawnParticles(model.position.x + (fallDir * 90), groundSurfaceY + 14, 10, false);
            screenShake = Math.max(screenShake, MOBILE_PERF_MODE ? 5 : 8);

            // Agar joni tugagan bo'lsa (o'lgan bo'lsa):
            // Halok bo'lgan raqib yerga yotgach, 500ms dan so'ng silliq yo'qolib (fade-out) g'oyib bo'ladi:
            if (isDead) {
                setTimeout(() => {
                    let fadeStep = 12;
                    const fadeInterval = setInterval(() => {
                        fadeStep--;
                        if (model.userData && model.userData.planeMesh && model.userData.planeMesh.material) {
                            model.userData.planeMesh.material.opacity = Math.max(0, (fadeStep / 12) * 0.45);
                        }
                        if (fadeStep <= 0) {
                            clearInterval(fadeInterval);
                            model.visible = false;
                        }
                    }, 35);
                }, 500);
                return;
            }

            // Agar joni tugamagan bo'lsa:
            // Yerda biroz (850ms) yotgach, yana default tikka holatiga qayta turadi!
            model.userData.knockDownTimer = setTimeout(() => {
                // Qayta tekshiramiz: agar shu orada joni tugagan bo'lsa turmasin
                const stillDead = (modelIndex >= 0 && getHealthForTarget(modelIndex) <= 0);
                if (stillDead) {
                    model.userData.isDead = true;
                    return;
                }

                const standDuration = 360; // 360ms da silliq tik turish
                const standStartTime = performance.now();

                function stepStand(sNow) {
                    const sElapsed = sNow - standStartTime;
                    const sProgress = Math.min(1, sElapsed / standDuration);
                    // Qayta tik turish (easeOutQuad)
                    const sEase = 1 - (1 - sProgress) * (1 - sProgress);

                    model.rotation.z = targetRotZ * (1 - sEase);
                    model.position.y = fallenY + (standingY - fallenY) * sEase;

                    if (sProgress < 1) {
                        model.userData.knockDownAnimId = requestAnimationFrame(stepStand);
                    } else {
                        model.rotation.z = 0;
                        model.position.y = standingY;
                        model.userData.isKnockedDown = false;
                        model.userData.knockDownAnimId = null;
                        const def = (modelIndex >= 0 && isDefenseActiveForPlayer(modelIndex));
                        setSoldierVisual(model, def ? 'defend' : 'idle');
                    }
                }
                model.userData.knockDownAnimId = requestAnimationFrame(stepStand);
            }, 850);
        }
    }

    model.userData.knockDownAnimId = requestAnimationFrame(stepFall);
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
    if (isCoinTossActive || isAnimating || currentTurnIndex !== myPlayerIndex || gameMode === 'menu' || isPaused) {
        if (gameMode === 'multi' && currentTurnIndex !== myPlayerIndex && currentTurnIndex >= 0 && !isCoinTossActive && !isAnimating) {
            showCenterNotice("Hozir raqib navbati! Iltimos, kuting... ⏳", 1500);
            if (typeof triggerHaptic === 'function') triggerHaptic('warning');
        }
        return;
    }
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
    if (gameMode === 'multi' && socket && socket.connected) {
        socket.emit('playerAimState', { isAiming: true, dist: 0 });
    }
}

let lastAimEmitTime = 0;
function handleMove(e) {
    if (!isDragging) return;
    dragCurrent = getPointerPos(e);
    if (gameMode === 'multi' && socket && socket.connected) {
        const now = performance.now();
        if (now - lastAimEmitTime > 60) {
            lastAimEmitTime = now;
            const isRight = isPlayerOnRightSide(myPlayerIndex);
            const aim = getAimParameters(dragStart, dragCurrent, isRight);
            const dist = aim ? aim.distance : Math.hypot(dragCurrent.x - dragStart.x, dragCurrent.y - dragStart.y);
            const angle = aim ? aim.angle : 0;
            socket.emit('playerAimState', { isAiming: true, dist, angle });
        }
    }
}

function computeShotPower(distance) {
    if (distance <= 0) return 0;
    // Dinamik kuch: ekranning markazidan tortganda mo'tadil, 
    // uzoqroqdan/ekranning narigi tomonidan tortganda esa o'q uzoqqa va kuchli uchishi uchun kengaytirilgan diapazon
    const base = distance * 8.5 + 220;
    return Math.min(3600, Math.max(350, base));
}

function getAimParameters(dragStart, dragCurrent, isRightSide) {
    if (!dragStart || !dragCurrent) return null;
    const rawDx = dragCurrent.x - dragStart.x;
    const rawDy = dragCurrent.y - dragStart.y;
    const distance = Math.hypot(rawDx, rawDy);
    if (distance < 10) return null;

    const power = computeShotPower(distance);

    // Gorizontal va vertikal tortish/surish vektorini to'g'ri hisoblash:
    // Chapdagi o'yinchi (isRightSide=false): orqaga (chapga, rawDx < 0) tortsa, raqib tomon otadi.
    // O'ngdagi o'yinchi (isRightSide=true): orqaga (o'ngga, rawDx > 0) tortsa, raqib tomon otadi.
    let pullX = isRightSide ? rawDx : -rawDx;
    // Vertikal: pastga tortganda (rawDy > 0) o'q osmonga, yuqoriga surtganda (rawDy < 0) o'q yerga qaraydi.
    let pullY = rawDy;

    // Agar o'yinchi orqaga tortish (slingshot) o'rniga to'g'ridan-to'g'ri oldinga surgan (swipe) bo'lsa:
    if (pullX < 0) {
        pullX = -pullX;
        pullY = -pullY;
    }

    let angle = Math.atan2(pullY, Math.max(10, pullX)) * (180 / Math.PI);

    // Foydalanuvchi xohlaganidek to'liq erkin fizik burchak:
    // Pastga (yerga) qaratib otilsa - o'q to'g'ri yerga qarab ketadi va yerga sanchiladi (-60° gacha)
    // Osmonga baland qaratib otilsa - o'q osmonga tik uchadi (+88° gacha)
    // Gorizontal oldinga uchish (vx) saqlanib qolishi uchun 90° dan kam bo'lishi kifoya
    if (angle < -60) angle = -60;
    if (angle > 88) angle = 88;

    return { angle, power, distance };
}

function handleEnd(e) {
    isWallDragActive = false;
    if (!isDragging) return;
    isDragging = false;
    aimSfxPlayed = false;
    if (gameMode === 'multi' && socket && socket.connected) {
        socket.emit('playerAimState', { isAiming: false, dist: 0, angle: 0 });
    }

    const isRight = isPlayerOnRightSide(myPlayerIndex);
    const aim = getAimParameters(dragStart, dragCurrent, isRight);
    if (!aim) return;

    throwSpear(aim.angle, aim.power);
}

const isUiTarget = (target) => {
    if (!target || typeof target.closest !== 'function') return false;
    return !!(
        target.closest('button') ||
        target.closest('input') ||
        target.closest('select') ||
        target.closest('textarea') ||
        target.closest('#chat-container') ||
        target.closest('#in-game-modal')
    );
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
    }, { passive: true });

    // Explicit touchstart for older Android/Capacitor versions
    document.addEventListener('touchstart', (e) => {
        if (isUiTarget(e.target)) return;
        if (e.touches && e.touches[0]) handleStart(e.touches[0]);
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
        if (isDragging && e.cancelable) {
            e.preventDefault();
        }
    }, { passive: false });
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
        dragPointerId = null;
        handleEnd(e);
    });
    document.addEventListener('pointercancel', (e) => {
        isWallDragActive = false;
        if (!isDragging) return;
        dragPointerId = null;
        handleEnd(e);
    });
    document.addEventListener('touchend', (e) => {
        isWallDragActive = false;
        if (isDragging) {
            dragPointerId = null;
            handleEnd(e.changedTouches ? e.changedTouches[0] : e);
        }
    }, { passive: true });
    document.addEventListener('touchcancel', (e) => {
        isWallDragActive = false;
        if (isDragging) {
            dragPointerId = null;
            handleEnd(e.changedTouches ? e.changedTouches[0] : e);
        }
    }, { passive: true });
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
        if (!isUiTarget(e.target) && e.touches && e.touches[0]) {
            handleStart(e.touches[0]);
        }
    }, { passive: false });
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
    }, { passive: false });
    document.addEventListener('touchend', (e) => {
        isWallDragActive = false;
        if (isDragging) {
            handleEnd(e);
        }
    }, { passive: false });
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
    duckButton.innerHTML = getDuckCrouchSvg();
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

if (jumpButton) {
    const handleJump = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        triggerJump(myPlayerIndex);
    };
    if (window.PointerEvent) {
        jumpButton.addEventListener('pointerdown', handleJump);
    } else {
        jumpButton.addEventListener('click', handleJump);
        jumpButton.addEventListener('touchstart', handleJump, { passive: false });
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

const fireButton = document.getElementById('fire-button');
if (fireButton) {
    const toggleFire = (e) => {
        if (e) {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
        }
        const fireStock = Math.max(0, Number(myProfile.fireSpears || 0));
        if (fireStock <= 0) {
            showCenterNotice("Olovli o'qlaringiz qolmagan! Do'kondan xarid qiling.", 2200);
            return;
        }
        isFireSpearActive = !isFireSpearActive;
        fireButton.classList.toggle('active', isFireSpearActive);
        if (isFireSpearActive) {
            triggerAbilityPulse(fireButton);
            playSfx('superPress', 0.7);
            showCenterNotice("🔥 Olovli o'q faollashdi!", 1500);
        } else {
            showCenterNotice("Oddiy o'qqa qaytildi", 1200);
        }
    };
    if (window.PointerEvent) {
        fireButton.addEventListener('pointerdown', (e) => { if (e) e.stopPropagation(); });
        fireButton.addEventListener('pointerup', toggleFire);
    } else {
        fireButton.addEventListener('touchstart', (e) => { if (e) e.stopPropagation(); }, { passive: false });
        fireButton.addEventListener('touchend', toggleFire, { passive: false });
    }
    fireButton.addEventListener('click', toggleFire);
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
    const handleWallBtn = (e) => {
        if (e) {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
        }
        deployOrRepositionWall();
    };
    if (window.PointerEvent) {
        wallButton.addEventListener('pointerdown', (e) => { if (e) e.stopPropagation(); });
        wallButton.addEventListener('pointerup', handleWallBtn);
    } else {
        wallButton.addEventListener('touchstart', (e) => { if (e) e.stopPropagation(); }, { passive: false });
        wallButton.addEventListener('touchend', handleWallBtn, { passive: false });
    }
    wallButton.addEventListener('click', handleWallBtn);
}

function showSuperUseWarning() {
    const now = performance.now();
    if (now < superWarningUntil) return;
    superWarningUntil = now + 1400;
    showCenterNotice("Super kuch faqat raqib o'q otganda ishlaydi!");
}

function getPointerPos(e) {
    const vp = getAppViewport();
    const cx = (typeof e.clientX === 'number') ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const cy = (typeof e.clientY === 'number') ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    if (vp.isRotated) {
        return {
            x: cy,
            y: window.innerWidth - cx
        };
    }
    return { x: cx, y: cy };
}

// Har bir level boshlanishida bepul bonus kuch tanlash modali
function showLevelBonusChestModal(onStartBattle) {
    const modal = document.getElementById('level-bonus-chest-modal');
    const container = document.getElementById('bonus-chests-row');
    const notice = document.getElementById('bonus-reveal-notice');
    const btnSkip = document.getElementById('btn-skip-bonus-chest');
    if (!modal || !container) {
        if (typeof onStartBattle === 'function') onStartBattle();
        return;
    }

    let battleStarted = false;
    let autoCloseTimer = null;
    const triggerStartBattle = () => {
        if (battleStarted) return;
        battleStarted = true;
        if (autoCloseTimer) clearTimeout(autoCloseTimer);
        modal.classList.add('hidden');
        if (typeof onStartBattle === 'function') onStartBattle();
    };

    // Tugmaning boshlang'ich holati: "O'tkazib yuborish ➔"
    if (btnSkip) {
        btnSkip.innerText = "O'tkazib yuborish ➔";
        btnSkip.style.background = "#334155";
        btnSkip.style.color = "#cbd5e1";
        btnSkip.style.boxShadow = "none";
        const handleSkip = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            triggerStartBattle();
        };
        btnSkip.onclick = handleSkip;
        btnSkip.ontouchend = handleSkip;
    }

    // Har bir level uchun 3 ta bepul kuch:
    // 1) Qush urib tushiradigan o'q (crowhunt)
    // 2) Qo'sh nayza (doubleSpears)
    // 3) Himoya devori (walls)
    const bonusRewards = [
        {
            id: 'crow',
            name: "Qush O'qi",
            icon: '🦅',
            desc: "Osmondagi qarg'alarni urib tushiradi",
            grant: () => {
                myProfile.crowhunt = (Number(myProfile.crowhunt) || 0) + 1;
                myCrow = myProfile.crowhunt;
            }
        },
        {
            id: 'double',
            name: "Qo'sh Nayza",
            icon: '⚔️',
            desc: "Bir zarbada 2 ta nayza otadi",
            grant: () => {
                myProfile.doubleSpears = (Number(myProfile.doubleSpears) || 0) + 1;
            }
        },
        {
            id: 'wall',
            name: "Himoya Devori",
            icon: '🧱',
            desc: "Raqib o'qidan himoya to'sig'i",
            grant: () => {
                myProfile.walls = (Number(myProfile.walls) || 0) + 1;
            }
        }
    ];

    // Tasodifiy 3 ta sandiqqa aralashtirib taqsimlaymiz
    const shuffled = bonusRewards.slice().sort(() => Math.random() - 0.5);

    container.innerHTML = '';
    if (notice) {
        notice.classList.add('hidden');
        notice.innerHTML = '';
    }

    let hasChosen = false;

    shuffled.forEach((reward, idx) => {
        const card = document.createElement('div');
        card.className = 'bonus-chest-card';
        card.dataset.index = idx;

        card.innerHTML = `
            <div class="chest-box-wrapper">
                <div class="chest-closed-icon">🎁</div>
                <div class="chest-reward-icon hidden">${reward.icon}</div>
            </div>
            <div class="chest-title">Sandiq ${idx + 1}</div>
            <div class="chest-reward-title hidden">+1 ${reward.name}</div>
        `;

        const pickChest = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            if (hasChosen) return;
            hasChosen = true;

            // Tanlangan sandiq animatsiyasi
            card.classList.add('opening');
            const closedIcon = card.querySelector('.chest-closed-icon');
            const rewardIcon = card.querySelector('.chest-reward-icon');
            const titleEl = card.querySelector('.chest-title');
            const rewardTitle = card.querySelector('.chest-reward-title');

            if (closedIcon) closedIcon.classList.add('hidden');
            if (rewardIcon) rewardIcon.classList.remove('hidden');
            if (titleEl) titleEl.classList.add('hidden');
            if (rewardTitle) rewardTitle.classList.remove('hidden');

            // Kuchni o'yinchiga qo'shish
            reward.grant();
            saveProfile();
            if (typeof updateShopUI === 'function') updateShopUI();
            if (typeof updateSuperUI === 'function') updateSuperUI();
            playSfx('woodHit', 0.8);
            if (typeof triggerHaptic === 'function') triggerHaptic('success');

            if (notice) {
                notice.innerHTML = `Tabriklaymiz! Sizga <b>+1 ${reward.name} ${reward.icon}</b> bepul berildi!`;
                notice.classList.remove('hidden');
            }

            // Sandiq tanlangach "O'tkazib yuborish" tugmasi "O'yinni boshlash" ga aylanadi:
            if (btnSkip) {
                btnSkip.innerText = "⚔️ O'yinni boshlash";
                btnSkip.style.background = "linear-gradient(135deg, #10b981, #059669)";
                btnSkip.style.color = "#ffffff";
                btnSkip.style.boxShadow = "0 4px 16px rgba(16, 185, 129, 0.5)";
                const handleStartBattle = (ev) => {
                    if (ev) {
                        ev.preventDefault();
                        ev.stopPropagation();
                    }
                    triggerStartBattle();
                    showCenterNotice(`+1 ${reward.name} ${reward.icon} qo'shildi!`, 2200);
                };
                btnSkip.onclick = handleStartBattle;
                btnSkip.ontouchend = handleStartBattle;
            }

            // Qolgan sandiqlarni ham ochib ko'rsatamiz
            setTimeout(() => {
                container.querySelectorAll('.bonus-chest-card').forEach((otherCard, oIdx) => {
                    if (otherCard !== card) {
                        otherCard.classList.add('revealed-other');
                        const oReward = shuffled[oIdx];
                        const oClosed = otherCard.querySelector('.chest-closed-icon');
                        const oRewardIcon = otherCard.querySelector('.chest-reward-icon');
                        const oTitle = otherCard.querySelector('.chest-title');
                        const oRewardTitle = otherCard.querySelector('.chest-reward-title');

                        if (oClosed) oClosed.classList.add('hidden');
                        if (oRewardIcon) oRewardIcon.classList.remove('hidden');
                        if (oTitle) oTitle.classList.add('hidden');
                        if (oRewardTitle) oRewardTitle.classList.remove('hidden');
                    }
                });
            }, 300);

            // 5 soniyadan so'ng avtomatik modal yopiladi va jang boshlanadi (agar o'yinchi tugmani bosmagan bo'lsa)
            autoCloseTimer = setTimeout(() => {
                triggerStartBattle();
                showCenterNotice(`+1 ${reward.name} ${reward.icon} qo'shildi!`, 2200);
            }, 5000);
        };

        card.addEventListener('click', pickChest);
        card.addEventListener('touchend', pickChest, { passive: false });
        container.appendChild(card);
    });

    modal.classList.remove('hidden');
}

function showBattleLoading(onComplete) {
    const overlay = document.getElementById('battle-loading-overlay');
    const bar = document.getElementById('battle-loading-bar');
    const pct = document.getElementById('battle-loading-pct');
    if (!overlay || !bar) {
        if (typeof onComplete === 'function') onComplete();
        return;
    }
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
    bar.style.width = '20%';
    if (pct) pct.innerText = '20%';

    preloadAllSfx();

    setTimeout(() => {
        bar.style.width = '65%';
        if (pct) pct.innerText = '65%';
    }, 180);

    setTimeout(() => {
        bar.style.width = '100%';
        if (pct) pct.innerText = '100%';
    }, 450);

    setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.style.display = 'none';
        if (typeof onComplete === 'function') onComplete();
    }, 650);
}

// Game Logic
function startSinglePlayer(opts) {
    showBattleLoading();
    if (authModal) authModal.classList.add('hidden');
    if (singleModeModal) singleModeModal.classList.add('hidden');
    if (levelSelectModal) levelSelectModal.classList.add('hidden');
    if (charSelectModal) charSelectModal.classList.add('hidden');
    if (multiMenu) multiMenu.classList.add('hidden');
    if (typeof ALL_MODAL_IDS !== 'undefined') {
        for (const id of ALL_MODAL_IDS) {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        }
    }
    const introEl = document.getElementById('intro-screen');
    if (introEl) {
        introEl.classList.add('hide');
        introEl.style.display = 'none';
        if (introEl.parentNode) introEl.parentNode.removeChild(introEl);
    }
    waitingScreen.classList.add('hidden');
    menuScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    updateTelegramBackButton();
    updateTelegramBackButton();
    chatContainer.classList.add('hidden');
    btnToggleChat.classList.add('hidden');
    isPaused = false;
    isDragging = false;
    battleScoreEarned = 0;
    isWallPlacementMode = false;
    isWallDragActive = false;
    singleShotLocked = false;
    setDefenseActive(false, false);
    setDuckActive(false, false);
    resetJumpStates();
    enemyDuckActive = false;
    currentOpponentProfile = null;
    // Yangi o'yin: avvalgi otish hint trayektoriyasini tozalaymiz.
    lastPlayerShot = null;
    clearHintTrajectory();
    const pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) pauseBtn.innerText = (translations[myProfile.lang] || translations.uz).pause;

    const level = Math.max(1, singleCampaignLevel);
    campaignConfig = getCampaignConfig(level);
    currentBattleDistance = campaignConfig.distance;
    aiHitAccumulator = 0;
    enemyVolleyQueue = [];

    const randomMaps = ['field', 'castle', 'registan', 'sakura', 'taiga', 'citadel', 'desert', 'winter', 'mountain', 'samarkand', 'bukhara', 'istanbul', 'oasis', 'canyon', 'volcano'];
    const randomWeathers = ['sunny', 'night', 'rain', 'storm', 'snow'];
    // Kampaniya levellari endi tematik muhitga ega (bosqichma-bosqich o'zgaradi).
    // Agar config muhitni bermasa, tasodifiy tanlaymiz.
    const autoMap = campaignConfig.map || randomMaps[Math.floor(Math.random() * randomMaps.length)];
    const autoWeather = campaignConfig.weather || randomWeathers[Math.floor(Math.random() * randomWeathers.length)];
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
    function getRandomEnemyChar(exclude) {
        const defaultChars = [2, 3];
        const customChars = (window.customModelsInfo || []).map(m => m.id);
        let allChars = defaultChars.concat(customChars);
        if (exclude !== undefined) {
            const filtered = allChars.filter(c => String(c) !== String(exclude));
            if (filtered.length > 0) allChars = filtered;
        }
        return allChars[Math.floor(Math.random() * allChars.length)] || 2;
    }

    const myChar = myProfile.charType || 2;
    const enemyChar = getRandomEnemyChar(myChar);
    const p1Char = playerLeftSide ? myChar : enemyChar;
    const p2Char = playerLeftSide ? enemyChar : myChar;
    p1Model = createSoldier(true, p1Char); p1Model.position.x = pos1X;
    p2Model = createSoldier(false, p2Char); p2Model.position.x = pos2X;
    p1Model.visible = true;
    p2Model.visible = true;
    showBattleLoading();
    if (campaignConfig.enemyCount === 2) {
        let enemyChar2 = getRandomEnemyChar(myChar);
        let tries = 10;
        while ((enemyChar2 === enemyChar || String(enemyChar2) === String(myChar)) && tries > 0) {
            enemyChar2 = getRandomEnemyChar(myChar);
            tries--;
        }
        // Agar dushmanlar chap tomonda bo'lsa p3Model true (isLeftSide) bo'ladi
        p3Model = createSoldier(!playerLeftSide, enemyChar2);
    }
    if (playerLeftSide) {
        myPlayerIndex = 0;
        p1Model.position.x = -currentBattleDistance / 2;
        p2Model.position.x = currentBattleDistance / 2;
        if (p3Model) {
            p3Model.position.x = currentBattleDistance / 2 + pos3Offset;
            p3Model.position.z = -15;
        }
    } else {
        myPlayerIndex = 1;
        p1Model.position.x = -currentBattleDistance / 2;
        p2Model.position.x = currentBattleDistance / 2;
        if (p3Model) {
            p3Model.position.x = -currentBattleDistance / 2 - pos3Offset;
            p3Model.position.z = -15;
        }
    }
    applySoldierWeatherTone();
    updateCameraBounds();
    const camFocus = getFocusCameraTarget(myPlayerIndex);
    cameraState = 'static';
    cameraTargetX = camFocus.x;
    cameraTargetY = camFocus.y;
    cameraZoomTarget = camFocus.zoom;
    camera.position.x = camFocus.x;
    camera.position.y = camFocus.y;
    camera.zoom = camFocus.zoom;
    camera.updateProjectionMatrix();

    myHealth = 100;
    enemyHealth = 100;
    enemy2Health = 100;
    myShield = 5;
    enemyShield = 5;
    mySuper = Math.max(0, Number(myProfile.superPowers || 5));
    artilleryCount = Math.max(0, Number(myProfile.artillery || 0));
    myCrow = Math.max(0, Number(myProfile.crowhunt || 0));
    enemySuper = Math.max(0, Number(campaignConfig.enemySuperCharges || 1));
    enemyShieldUsesRemaining = Math.max(0, Number(campaignConfig.enemyShieldAutoUses || 0));
    enemySuperUsesRemaining = Math.max(0, Number(campaignConfig.enemySuperAutoUses || 0));
    enemyShieldAutoUsedThisFlight = false;
    myDefenseActive = false;
    enemyDefenseActive = false;
    enemyDuckActive = false;
    updateHealthUI();
    updateShieldUI();
    updateSuperUI();
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

        const botNames = { uz: "Kompyuter", ru: "Компьютер", en: "PC", tr: "Bilgisayar", az: "Kompüter", kk: "Компьютер", ky: "Компьютер", tg: "Компютер" };
    const currentBotName = botNames[myProfile?.lang] || "Kompyuter";

    if (myPlayerIndex === 0) {
        p1Name.innerText = myProfile.name;
        document.getElementById('p1-flag').innerText = myProfile.flag;
        p2Name.innerText = `${currentBotName} (Lv.${level})`;
        document.getElementById('p2-flag').innerText = "🤖";
    } else {
        p2Name.innerText = myProfile.name;
        document.getElementById('p2-flag').innerText = myProfile.flag;
        p1Name.innerText = `${currentBotName} (Lv.${level})`;
        document.getElementById('p1-flag').innerText = "🤖";
    }
    applyHudSideRoles();
    prevTurnIndex = -2;
    updateCampaignUI();
    setTimeout(() => { if (typeof checkDailyAutoPopup === 'function') checkDailyAutoPopup(); }, 500);
    // Har bir level boshlanishida 3 ta sandiqdan 1 ta bepul bonus kuch taklif qilinadi.
    // O'yinchi bonus kuchni tanlab bo'lgach (yoki o'tkazib yuborgach) keyin jang boshlanadi!
    isPaused = true;
    currentTurnIndex = -1;
    if (!isLooping) {
        isLooping = true;
        lastTime = performance.now();
        requestAnimationFrame(gameLoop);
    }

    const startBattleAfterBonus = () => {
        isPaused = false;
        updateTurn(myPlayerIndex, generateWind());
    };

    showLevelBonusChestModal(startBattleAfterBonus);
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
            power = Math.max(700, Math.min(3600, power));

            setModelActionState(shooter, 'aim', 1000);
            setTimeout(() => {
                if (gameMode === 'single' && currentTurnIndex === getPrimaryEnemyTurnIndex() && !isPaused) {
                    startSpearAnimation(shooterIndex, angle, power);
                }
            }, 800);
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

    // 100% aniqlik
    angle = Math.max(-20, Math.min(110, angle));
    power = Math.max(700, Math.min(3600, power));

    // AI o'q otishidan oldin mo'ljalga olish holatini ko'rsatish
    setModelActionState(shooter, 'aim', 1000);

    // 50+ levellarda ikki dushman tengidan o'q uzgani uchun aim kechikishi qisqaroq.
    const aimDelay = (cfg.enemyVolleySimultaneous && enemyVolleyQueue.length > 0) ? 250 : 800;
    setTimeout(() => {
        if (gameMode === 'single' && currentTurnIndex === getPrimaryEnemyTurnIndex() && !isPaused) {
            startSpearAnimation(shooterIndex, angle, power);
        }
    }, aimDelay);
}

function throwSpear(angle, power) {
    if (typeof active3DBow !== 'undefined' && active3DBow) active3DBow.visible = false;
    if (gameMode === 'single' && singleShotLocked) return;
    if (gameMode === 'single') singleShotLocked = true;
    // Yordamchi hint uchun: o'yinchining joriy otish parametrlarini saqlaymiz.
    // Faqat o'yinchining o'z otishini saqlaymiz (raqibniki emas).
    if (currentTurnIndex === myPlayerIndex) {
        triggerHaptic('medium');
        const thrower = modelForPlayer(myPlayerIndex);
        const isRight = isPlayerOnRightSide(myPlayerIndex);
        let sX = thrower ? (thrower.position.x + (isRight ? -60 : 60)) : (myPlayerIndex === 0 ? p1Model.position.x + 60 : p2Model.position.x - 60);
        let sY = (thrower ? thrower.position.y : p1Model.position.y) + 270;
        if (isArtilleryAiming) {
            sX = (thrower ? thrower.position.x : 0) + (isRight ? -570 : 570);
            sY = (thrower ? thrower.position.y : 0) + 175;
        }
        lastPlayerShot = { startX: sX, startY: sY, angle, power, wind: currentWind, playerIndex: myPlayerIndex };
        // Eski hint chizig'ini yangisi uchun tozalaymiz (keyingi navbatda chiziladi).
        clearHintTrajectory();
    }
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
                angle: Math.max(-60, Math.min(85, angle + 5.5)),
                power: Math.max(650, power * 0.94),
                wind: currentWind
            };
        }
        saveProfile();
        updateSuperUI();
    }
    let artill = false;
    if (isArtilleryAiming) {
        artill = true;
        isArtilleryAiming = false;
        if (btnArtillery) btnArtillery.classList.remove('active');
        setTimeout(() => {
            if (myArtilleryCannon) myArtilleryCannon.visible = false;
        }, 1000);
        artilleryCount--;
        myProfile.artillery = artilleryCount;
        saveProfile();
        updateSuperUI();
    }

    // Olov nayza: yoqilgan bo'lsa, ushbu otish uchun bittasini sarflaymiz.
    // (Artileriya bilan birga ishlamaydi.)
    pendingFireShot = false;
    if (!artill && isFireSpearActive && Number(myProfile.fireSpears || 0) > 0) {
        myProfile.fireSpears = Math.max(0, Number(myProfile.fireSpears || 0) - 1);
        pendingFireShot = true;
        isFireSpearActive = false;
        const fireBtn = document.getElementById('fire-button');
        if (fireBtn) fireBtn.classList.remove('active');
        saveProfile();
        updateSuperUI();
    }

    if (gameMode === 'multi') {
        socket.emit('throwSpear', { angle, power, isArtillery: artill, isFire: pendingFireShot });
    } else if (gameMode === 'single') {
        if (!artill) {
            if (currentTurnIndex === 0) {
                setModelActionState(p1Model, isDefenseActiveForPlayer(0) ? 'defend' : 'aim', 800);
            } else {
                setModelActionState(p2Model, isDefenseActiveForPlayer(1) ? 'defend' : 'aim', 800);
            }
        }
        startSpearAnimation(currentTurnIndex, angle, power, artill);
    }
}

const CROW_KILLER_CINEMATIC_MS = 2500;
let crowKillerCinematicActive = false;
let crowKillerCinematicUntil = 0;

function shootCrowKillerArrow() {
    if (myCrow <= 0) {
        showCenterNotice("Qush ovi o'qlari qolmagan!", 2000);
        return;
    }
    if (gameMode === 'multi' && currentTurnIndex !== myPlayerIndex) {
        showCenterNotice("Faqat o'z navbatingizda o'q uzishingiz mumkin!", 2000);
        return;
    }
    if (isAnimating) return;

    myCrow--;
    myProfile.crowhunt = myCrow;
    saveProfile();
    updateCrowUI();
    updateSuperUI();

    isAnimating = true;
    if (gameMode === 'multi') {
        socket.emit('crowKillerShot', { count: 20 });
    }

    playCrowKillerVisualForShooter(myPlayerIndex, () => {
        isAnimating = false;
        crowKillerCinematicActive = false;
        crowKillerCinematicUntil = 0;
        resetCameraAfterImpact();
        if (gameMode === 'multi') {
            socket.emit('crowKillerComplete');
        } else if (gameMode === 'single') {
            updateTurn(getPrimaryEnemyTurnIndex(), generateWind());
            setTimeout(() => {
                if (gameMode === 'single' && currentTurnIndex === getPrimaryEnemyTurnIndex()) {
                    playAITurn();
                }
            }, 800);
        }
    });
}

function playCrowKillerVisualForShooter(shooterIndex, onComplete) {
    const birds = entities.filter(e => e.type === 'bird' && e.alive);
    const shooterModel = modelForPlayer(shooterIndex);
    if (!shooterModel) {
        if (typeof onComplete === 'function') onComplete();
        return;
    }

    setModelActionState(shooterModel, 'aim', 1000);
    crowKillerCinematicActive = true;
    crowKillerCinematicUntil = performance.now() + 2500;
    cameraState = 'crowKiller';
    cameraZoomTarget = baseZoom * 1.7;

    const startX = shooterModel.position.x;
    const startY = shooterModel.position.y + 50;

    if (birds.length > 0) {
        birds.forEach((bird, index) => {
            setTimeout(() => {
                if (!bird || !bird.alive || !bird.mesh) return;
                const birdMesh = bird.mesh;
                const targetX = birdMesh.position.x;
                const targetY = birdMesh.position.y;
                const dx = targetX - startX;
                const dy = targetY - startY;
                const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                startCrowKillerArrowAnimation(startX, startY, angle, 1700, bird);
                playSfx('throw', 0.9);
                cameraTargetX = targetX;
                cameraTargetY = targetY;
            }, Math.min(index * 90, 1200));
        });

        setTimeout(() => {
            birds.forEach((b) => {
                if (b && b.alive) killBird(b);
            });
        }, 1800);
    } else {
        // Osmonda qush bo'lmasa ham 3 ta maxsus o'q yuqoriga uchadi
        for (let i = 0; i < 3; i++) {
            setTimeout(() => {
                const angle = 60 + i * 20;
                startCrowKillerArrowAnimation(startX, startY, angle, 1600, null);
                playSfx('throw', 0.9);
            }, i * 150);
        }
    }

    setTimeout(() => {
        crowKillerCinematicActive = false;
        crowKillerCinematicUntil = 0;
        resetCameraAfterImpact();
        if (typeof onComplete === 'function') onComplete();
    }, 2200);
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
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0xff1100, emissive: 0xaa0000 });
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.rotation.z = -Math.PI / 2;
    group.add(shaft);

    // O'q uchi
    const tipGeo = new THREE.ConeGeometry(5, 14, 8);
    const tipMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xff6600 });
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
            if (arrow.mesh) scene.remove(arrow.mesh);
            crowKillerArrows.splice(i, 1);
            continue;
        }

        // Homing: Agar nishondagi qush tirik bo'lsa, o'q to'g'ridan-to'g'ri qush tomon shiddat bilan yo'naladi
        if (arrow.targetBird && arrow.targetBird.alive && arrow.targetBird.mesh) {
            const birdMesh = arrow.targetBird.mesh;
            const dx = birdMesh.position.x - arrow.x;
            const dy = birdMesh.position.y - arrow.y;
            const dist = Math.hypot(dx, dy);

            // Qarg'aga yaqin yetib borganda aniq urib sanchilish va birga qulash
            if (dist < 80) {
                if (arrow.mesh && birdMesh) {
                    scene.remove(arrow.mesh);
                    arrow.mesh.position.set(0, 0, 5);
                    arrow.mesh.rotation.z = Math.atan2(arrow.vy, arrow.vx) - (birdMesh.rotation.z || 0);
                    birdMesh.add(arrow.mesh);
                }
                killBird(arrow.targetBird);
                arrow.active = false;
                crowKillerArrows.splice(i, 1);
                continue;
            }

            // Homing boshqaruvi
            const speed = 1650;
            arrow.vx = (dx / dist) * speed;
            arrow.vy = (dy / dist) * speed;
            arrow.x += arrow.vx * 0.016;
            arrow.y += arrow.vy * 0.016;
        } else {
            // Nishon allaqachon yo'q qilingan bo'lsa
            arrow.x += arrow.vx * 0.016;
            arrow.y += arrow.vy * 0.016;
            arrow.vy -= 600 * 0.016;
        }

        if (arrow.mesh) {
            arrow.mesh.position.set(arrow.x, arrow.y, 0);
            arrow.mesh.rotation.z = Math.atan2(arrow.vy, arrow.vx);
        }

        // Yerga tushsa yoki sahnadan chiqsa o'chirish
        if (arrow.y < ground.position.y || arrow.x < -2800 || arrow.x > 2800) {
            arrow.active = false;
            if (arrow.mesh) scene.remove(arrow.mesh);
            crowKillerArrows.splice(i, 1);
        }
    }
    // Barcha qarg'a o'qlari urib bo'lgach, kamera osmonda qolib ketmasdan jang maydoni va o'yinchiga ravon qaytadi
    if (crowKillerCinematicActive && crowKillerArrows.length === 0) {
        crowKillerCinematicActive = false;
        crowKillerCinematicUntil = 0;
        resetCameraAfterImpact();
    }
}

function killBird(birdEntity) {
    if (!birdEntity || !birdEntity.alive) return;

    birdEntity.alive = false;
    birdEntity.fallWithSpear = true;
    playCrowSound();

    // Qarg'aning qulash animatsiyasi
    const birdMesh = birdEntity.mesh;
    if (birdMesh) {
        birdMesh.rotation.z = Math.PI / 2;
        spawnParticles(birdMesh.position.x, birdMesh.position.y, 16, false);
    }

    if (typeof checkQuestProgress === 'function') checkQuestProgress('crow', 1);
}

function updateCrowUI() {
    if (crowCountText) {
        crowCountText.innerText = myCrow;
    }
}

function performSuperInterceptVisual(hitX, hitY, byPlayerIndex = myPlayerIndex, attackerIndex = null) {
    const x = Number.isFinite(hitX) ? hitX : (spear ? spear.x : 0);
    const y = Number.isFinite(hitY) ? hitY : (spear ? spear.y : 0);
    cinematicSlowUntil = performance.now() + SUPER_CINEMATIC_MS;
    cameraState = 'intercept';
    cameraTargetX = x;
    cameraTargetY = y + 30;
    cameraZoomTarget = baseZoom * 2.25;
    // Urib tushirilgan o'q/nayza aynan raqib otgan quroli turi bo'lishi kerak.
    let attackerWeapon = 'arrow';
    if (spear && spear.weaponType) {
        attackerWeapon = spear.weaponType;
    } else if (typeof attackerIndex === 'number') {
        attackerWeapon = getPlayerWeaponType(attackerIndex);
    } else if (spear && typeof spear.playerIndex === 'number') {
        attackerWeapon = getPlayerWeaponType(spear.playerIndex);
    }
    const defenderWeapon = getPlayerWeaponType(typeof byPlayerIndex === 'number' ? byPlayerIndex : myPlayerIndex);
    startSuperInterceptCinematic(x, y, byPlayerIndex, { attackerWeapon, defenderWeapon });
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
    if (spear.isArtillery) return false;

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
    scheduleAfterCinematic(() => {
        updateTurn(currentTurnIndex === 0 ? 1 : 0, generateWind());
    });
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
    if (spear.isArtillery) return false;

    const enemyIndices = getEnemyIndices();
    if (!enemyIndices.length) return false;

    const chance = Math.max(0, Math.min(0.9, Number(campaignConfig.enemySuperUseChance || 0)));
    spear.aiSuperTried = true;
    if (Math.random() > chance) return false;

    const byPlayerIndex = enemyIndices[Math.floor(Math.random() * enemyIndices.length)];
    enemySuper = Math.max(0, enemySuper - 1);
    enemySuperUsesRemaining = Math.max(0, enemySuperUsesRemaining - 1);
    playSfx('superPress', 0.95);
    updateEnemyResourcesUI();

    const hitX = spear.x;
    const hitY = spear.y;
    spear.active = false;
    hideFlyingSpear();
    isAnimating = false;
    performSuperInterceptVisual(hitX, hitY, byPlayerIndex);
    celebrateSuperIntercept(byPlayerIndex);
    scheduleAfterCinematic(() => {
        const nextTurn = currentTurnIndex === 0 ? 1 : 0;
        updateTurn(nextTurn, generateWind());
        if (nextTurn === getPrimaryEnemyTurnIndex()) {
            // Small dramatic pause after super cinematic before AI shoots.
            setTimeout(() => playAITurn(), 750);
        }
    });
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

    // AI Decision: Jump, Duck or Shield?
    const rand = Math.random();
    if (rand > 0.72) return false;

    if (dy < 140 && rand < 0.36) {
        // AI JUMPS to dodge incoming low/leg shot!
        triggerJump(enemyTurnIndex);
        if (p3Model && Math.random() < 0.5) triggerJump(2);
        return true;
    } else if (rand < 0.3) {
        // AI DUCKS
        enemyDuckActive = true;
        enemyShieldUsesRemaining = Math.max(0, enemyShieldUsesRemaining - 1);
        setTimeout(() => {
            enemyDuckActive = false;
        }, 950);
        return true;
    } else {
        // AI SHIELDS
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
}

function advanceSingleTurnAfterShot() {
    const enemyTurnIndex = getPrimaryEnemyTurnIndex();
    if (currentTurnIndex === enemyTurnIndex && enemyVolleyQueue.length > 0) {
        // 50+ levellarda ikkala dushman "tengidan" (deyarli bir vaqtda) o'q uzadi.
        const cfg = campaignConfig || getCampaignConfig(singleCampaignLevel);
        const volleyDelay = cfg.enemyVolleySimultaneous ? 130 : 550;
        setTimeout(() => fireEnemyVolleyShot(), volleyDelay);
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
    const baseHeight = targetModel?.userData?.planeHeight || targetModel?.userData?.planeMesh?.geometry?.parameters?.height || 430;
    const isDucking = isDuckActiveForPlayer(targetIndex);
    const effectiveHeight = isDucking ? (baseHeight * 0.52) : baseHeight;
    const headThreshold = effectiveHeight * 0.72;
    const legThreshold = effectiveHeight * 0.28;

    if (relativeY >= headThreshold) {
        damage = 40;
        msg = "🎯 HEADSHOT! -40";
        isCrit = true;
        hitZone = 'head';
    } else if (relativeY <= legThreshold) {
        damage = 15;
        msg = "OYOQQA! -15";
        hitZone = 'leg';
    }

    const hasShield = shieldForPlayer(targetIndex) > 0 && !targetModel.userData.shieldBroken;
    const defending = isDefenseActiveForPlayer(targetIndex);

    if (hasShield && defending && (hitZone === 'head' || hitZone === 'body')) {
        return { damage: 0, msg: "🛡️ QALQON! BLOK", isCrit: false, hitZone, isShieldHit: true, shieldActiveBlock: true, shieldlessDefense: false };
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
    if (hitResult.duckDodged || hitResult.jumpDodged) return 0;
    if (hitResult.isShieldHit) return 5;
    if (hitResult.hitZone === 'head') return 20;
    if (hitResult.hitZone === 'leg') return 5;
    return 10; // body (with or without shield)
}

function addScore(delta) {
    if (!Number.isFinite(delta) || delta === 0) return;
    myStats.score = Number(myStats.score || 0) + delta;
    if (delta > 0) {
        battleScoreEarned += delta;
    }
    if (typeof myProfile !== 'undefined' && myProfile) {
        myProfile.score = myStats.score;
    }
    saveStats();
    saveProfile();
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
    // Yo'nalish otuvchining maydondagi tomoniga (nishonga nisbatan) bog'liq.
    const desiredDir = (target.position.x >= shooter.position.x) ? 1 : -1;
    const windComp = (-currentWind * desiredDir * (dx / 280));
    power = (power + windComp) * powerScale;
    let angle = (rad * 180) / Math.PI;
    angle += desiredDir * angleOffsetDeg;
    angle = Math.max(-20, Math.min(110, angle));
    power = Math.max(700, Math.min(3600, power));
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
            if (!m || !m.visible || m.userData.isDead || m.userData.isKnockedDown) continue;
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
        const targetModel = modelForPlayer(targetIndex) || (targetIndex === 0 ? p1Model : p2Model);
        flashHit(targetModel);
        hideFlyingSpear();

        let hitResult;

        if (isSuicide) {
            hitResult = calculateHitResult(targetIndex, 0, true);
            spawnParticles(hitX, hitY, 50);
        } else {
            const relativeY = hitY - targetModel.position.y; // For 440 height plane at y=-360, relativeY goes from 50 (feet) to ~350 (head)
            hitResult = calculateHitResult(targetIndex, relativeY, false);

            if (spear && spear.isArtillery) {
                const isDefending = isDefenseActiveForPlayer(targetIndex);
                if (hitResult.isShieldHit || (isDefending && shieldForPlayer(targetIndex) > 0)) {
                    hitResult.damage = 0;
                    hitResult.msg = 'ARTILERIYA QAYTARILDI!';
                    setShieldForPlayer(targetIndex, 0);
                    spawnParticles(hitX, hitY, 10, true);
                } else {
                    const currentHp = getHealthForTarget(targetIndex);
                    const dmg = Math.ceil(currentHp / 2);
                    hitResult.damage = dmg;
                    hitResult.msg = `ARTILERIYA ZARBASI! -${dmg}`;
                    hitResult.isCrit = true;
                    triggerCinematicExplosion(hitX, hitY);
                }
            } else {
                if (doubleShotFired) hitResult = applyDoubleDamageBoost(hitResult, 2);
                // Olov nayza / o'qi: raqibga tekkanda kuchli yonish effekti va yuqori ziyon
                if (spear && spear.isFire && !hitResult.duckDodged) {
                    if (hitResult.isShieldHit) {
                        if (hitResult.shieldActiveBlock) {
                            hitResult.damage = 25;
                            hitResult.msg = "🔥 QALQONNI YONDIRDI! -25";
                        } else {
                            hitResult.damage = 35;
                            hitResult.msg = "🔥 QALQON VA OLOV! -35";
                        }
                    } else {
                        const rawDmg = Math.max(25, Number(hitResult.damage || 25));
                        const zoneBonus = hitResult.hitZone === 'head' ? 20 : (hitResult.hitZone === 'leg' ? 10 : 15);
                        hitResult.damage = Math.round(rawDmg * 2.0 + zoneBonus);
                        hitResult.msg = `🔥 OLOV ZARBASI! -${hitResult.damage}`;
                    }
                    hitResult.isCrit = true;
                    spawnFireBurst(hitX, hitY, 40);
                    screenShake = Math.max(screenShake, 18);
                    playSfx('headHit', 1.25);
                }

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
        }

        playHitByResult(hitResult);
        showDamageText(hitX, hitY + 80, hitResult.msg, hitResult.isCrit, hitResult.isShieldHit || hitResult.shieldlessDefense);

        if (hitResult.hitZone === 'head') {
            if (typeof triggerScreenFlash === 'function') triggerScreenFlash('headshot');
            if (typeof checkQuestProgress === 'function') checkQuestProgress('headshot', 1);
            // Duplicate second headshot banner removed
            screenShake = Math.max(screenShake, 18);
        } else if (targetIndex === myPlayerIndex && hitResult.damage > 0) {
            if (typeof triggerScreenFlash === 'function') triggerScreenFlash('damage');
        }

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
                    applyDamageToTarget(targetIndex, hitResult.damage);
                    updateHealthUI();
                }
                if (shieldHealth <= 0) breakShield(targetModel);
            } else {
                applyDamageToTarget(targetIndex, hitResult.damage);
                updateHealthUI();
            }

            if (myHealth <= 0 || areAllEnemiesDead()) {
                const winnerIndex = myHealth > 0 ? myPlayerIndex : getPrimaryEnemyTurnIndex();
                setTimeout(() => showGameOver(winnerIndex), 1500);
            } else {
                if (!lastRecordedSecondaryHit && hasExtraHit) {
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
                        applyDamageToTarget(doubleOutcome.targetIndex, boostedExtraHit.damage);
                        updateHealthUI();
                    }
                }
                advanceSingleTurnAfterShot();
            }
        } else {
            const finalExtra = lastRecordedSecondaryHit || (hasExtraHit ? {
                targetIndex: doubleOutcome.targetIndex,
                damage: applyDoubleDamageBoost(doubleOutcome.hitResult, 2).damage,
                hitZone: doubleOutcome.hitResult.hitZone || 'body',
                shieldActiveBlock: doubleOutcome.hitResult.shieldActiveBlock || false,
                shieldlessDefense: doubleOutcome.hitResult.shieldlessDefense || false,
                hitX: doubleOutcome.hitX,
                hitY: doubleOutcome.hitY,
                isShieldHit: doubleOutcome.hitResult.isShieldHit || false,
                hitAngle: doubleOutcome.hitAngle
            } : null);
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
                isArtillery: spear.isArtillery,
                isFire: !!(spear && spear.isFire),
                extraHit: finalExtra
            });
        }
    } else {
        playSfx('ground');
        spawnParticles(hitX, hitY, 10);
        stickSpear(null, hitX, hitY, finalAngle);
        hideFlyingSpear();

        if (gameMode === 'single') {
            if (!lastRecordedSecondaryHit && hasExtraHit) {
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
                    applyDamageToTarget(doubleOutcome.targetIndex, boostedExtraHit.damage);
                    updateHealthUI();
                }
            }
            advanceSingleTurnAfterShot();
        } else {
            const finalExtra = lastRecordedSecondaryHit || (hasExtraHit ? {
                targetIndex: doubleOutcome.targetIndex,
                damage: applyDoubleDamageBoost(doubleOutcome.hitResult, 2).damage,
                hitZone: doubleOutcome.hitResult.hitZone || 'body',
                shieldActiveBlock: doubleOutcome.hitResult.shieldActiveBlock || false,
                shieldlessDefense: doubleOutcome.hitResult.shieldlessDefense || false,
                hitX: doubleOutcome.hitX,
                hitY: doubleOutcome.hitY,
                isShieldHit: doubleOutcome.hitResult.isShieldHit || false,
                hitAngle: doubleOutcome.hitAngle
            } : null);
            socket.emit('throwComplete', {
                hitOpponent: false,
                hitX,
                hitY,
                hitAngle: finalAngle,
                isArtillery: spear.isArtillery,
                extraHit: finalExtra
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
    const handleVolMute = (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        musicMuted = !musicMuted;
        applyMusicSettings();
        saveMusicSettings();
    };
    btnVolMute.addEventListener('click', handleVolMute);
    btnVolMute.addEventListener('touchend', handleVolMute, { passive: false });
}

applyMusicSettings();
if (btnMusicToggle) {
    const handleMusicToggle = (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        musicMuted = !musicMuted;
        applyMusicSettings();
        saveMusicSettings();
    };
    btnMusicToggle.addEventListener('click', handleMusicToggle);
    btnMusicToggle.addEventListener('touchend', handleMusicToggle, { passive: false });
}
function returnToMainMenu() {
    isPaused = false;
    isAnimating = false;
    if (spear) spear.active = false;
    if (secondarySpear) secondarySpear.active = false;
    hideFlyingSpear();
    hideCoinTossModal();
    if (typeof stopTurnTimerUI === 'function') stopTurnTimerUI();
    if (typeof clearRandomWaitTimer === 'function') clearRandomWaitTimer();

    // Barcha o'yin ekranlarini yashirish
    if (gameScreen) gameScreen.classList.add('hidden');
    if (inGameModal) inGameModal.classList.add('hidden');
    if (gameOverScreen) gameOverScreen.classList.add('hidden');
    if (waitingScreen) waitingScreen.classList.add('hidden');
    if (multiMenu) multiMenu.classList.add('hidden');
    if (disconnectScreen) disconnectScreen.classList.add('hidden');
    if (rematchModal) rematchModal.classList.add('hidden');
    if (singleModeModal) singleModeModal.classList.add('hidden');
    if (aboutModal) aboutModal.classList.add('hidden');
    if (settingsModal) settingsModal.classList.add('hidden');
    if (profileModal) profileModal.classList.add('hidden');
    for (const id of ALL_MODAL_IDS) {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    }

    // Intro ekranni yo'q qilish
    const introEl = document.getElementById('intro-screen');
    if (introEl) {
        introEl.classList.add('hide');
        introEl.style.display = 'none';
        if (introEl.parentNode) introEl.parentNode.removeChild(introEl);
    }

    // Multiplayer bo'lsa, xonani tark etish
    if (gameMode === 'multi' && socket && socket.connected) {
        try {
            socket.emit('leaveRoom', { roomName: currentRoomName });
        } catch (_) { }
    }
    currentRoomName = null;

    gameMode = 'menu';
    document.documentElement.classList.remove('direct-duel-active');
    autoJoinExecuted = false;

    // Bosh menyu ekranini to'liq ko'rsatish va blokirovkalarini yechish
    if (menuScreen) {
        menuScreen.style.removeProperty('display');
        menuScreen.style.removeProperty('pointer-events');
        menuScreen.classList.remove('hidden');
    }

    cameraState = 'static';
    if (!isLooping) {
        isLooping = true;
        lastTime = performance.now();
        requestAnimationFrame(gameLoop);
    }

    if (typeof updateCampaignUI === 'function') updateCampaignUI();
    if (typeof updateMenuWallpaper === 'function') updateMenuWallpaper();
    if (typeof checkFirstTimeLanguageModal === 'function') checkFirstTimeLanguageModal();
    if (typeof updateTelegramBackButton === 'function') updateTelegramBackButton();
}

if (btnExitMenu) {
    const handleExitMenu = safeModalAction((e) => {
        returnToMainMenu();
    });
    btnExitMenu.addEventListener('click', handleExitMenu);
    btnExitMenu.addEventListener('touchend', handleExitMenu, { passive: false });
}
const btnDisconnectHome = document.getElementById('btn-disconnect-home');
if (btnDisconnectHome) {
    const handleDiscHome = safeModalAction((e) => {
        returnToMainMenu();
    });
    btnDisconnectHome.addEventListener('click', handleDiscHome);
    btnDisconnectHome.addEventListener('touchend', handleDiscHome, { passive: false });
}

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

// =========================================================
// ONLAYN MULTIPLAYER QUR'A TASHLASH (COIN TOSS) TIZIMI
// =========================================================
let isCoinTossActive = false;
let myCoinChoice = null;
let coinTossTimerInterval = null;

function playCoinFlipSound() {
    try {
        if (!audioCtx) initAudio();
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        if (!audioCtx) return;

        const now = audioCtx.currentTime;
        // O'tkir jarangdor metall tanga ovozi (ketma-ket 4 ta garmonika)
        for (let i = 0; i < 4; i++) {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'triangle';
            const baseFreq = 2200 + i * 440;
            osc.frequency.setValueAtTime(baseFreq, now + i * 0.07);
            osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + i * 0.07 + 0.12);

            gain.gain.setValueAtTime(0.25 * sfxVolume, now + i * 0.07);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.22);

            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now + i * 0.07);
            osc.stop(now + i * 0.07 + 0.25);
        }
    } catch (_) { }
}

function playCoinLandSound() {
    try {
        if (!audioCtx) initAudio();
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        if (!audioCtx) return;

        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1600, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.25);

        gain.gain.setValueAtTime(0.4 * sfxVolume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.35);
    } catch (_) { }
}

function initCoinTossUI() {
    const btnRasm = document.getElementById('btn-coin-rasm');
    const btnRaqam = document.getElementById('btn-coin-raqam');

    const handleChoice = (choice) => {
        if (!isCoinTossActive || myCoinChoice) return;
        myCoinChoice = choice;
        playSfx('button', 0.9);

        if (btnRasm) btnRasm.classList.add('disabled');
        if (btnRaqam) btnRaqam.classList.add('disabled');
        const selectedBtn = choice === 'rasm' ? btnRasm : btnRaqam;
        if (selectedBtn) selectedBtn.classList.add('selected-by-me');
        const badge = document.getElementById(choice === 'rasm' ? 'badge-coin-rasm' : 'badge-coin-raqam');
        if (badge) {
            badge.className = 'coin-choice-badge badge-me';
            badge.innerText = 'Siz tanladingiz';
        }

        const statusEl = document.getElementById('coin-status-text');
        if (statusEl) {
            statusEl.innerText = `Siz "${choice === 'rasm' ? 'Rasm' : 'Raqam'}"ni tanladingiz. Qur'a tashlanmoqda...`;
        }

        socket.emit('coinChoice', { choice: choice });
    };

    if (btnRasm) {
        btnRasm.addEventListener('click', () => handleChoice('rasm'));
        btnRasm.addEventListener('touchend', (e) => {
            e.preventDefault();
            handleChoice('rasm');
        }, { passive: false });
    }

    if (btnRaqam) {
        btnRaqam.addEventListener('click', () => handleChoice('raqam'));
        btnRaqam.addEventListener('touchend', (e) => {
            e.preventDefault();
            handleChoice('raqam');
        }, { passive: false });
    }
}

function showCoinTossModal(gameStartData) {
    const modal = document.getElementById('coin-toss-modal');
    if (!modal) return;

    isCoinTossActive = true;
    myCoinChoice = null;

    if (coinTossTimerInterval) {
        clearInterval(coinTossTimerInterval);
        coinTossTimerInterval = null;
    }

    const btnRasm = document.getElementById('btn-coin-rasm');
    const btnRaqam = document.getElementById('btn-coin-raqam');
    const badgeRasm = document.getElementById('badge-coin-rasm');
    const badgeRaqam = document.getElementById('badge-coin-raqam');
    const timerBar = document.getElementById('coin-timer-bar');
    const statusText = document.getElementById('coin-status-text');
    const stageWrap = document.getElementById('coin-stage-wrap');
    const coin3d = document.getElementById('coin-3d-element');
    const resultBanner = document.getElementById('coin-result-banner');
    const choiceContainer = document.getElementById('coin-choice-container');
    const timerWrap = document.getElementById('coin-timer-bar-wrap');

    // UI tozalash
    if (btnRasm) btnRasm.className = 'coin-choice-btn';
    if (btnRaqam) btnRaqam.className = 'coin-choice-btn';
    if (badgeRasm) { badgeRasm.className = 'coin-choice-badge'; badgeRasm.innerText = ''; }
    if (badgeRaqam) { badgeRaqam.className = 'coin-choice-badge'; badgeRaqam.innerText = ''; }
    if (choiceContainer) choiceContainer.classList.remove('hidden');
    if (timerWrap) timerWrap.classList.remove('hidden');
    if (stageWrap) {
        stageWrap.classList.add('hidden');
        stageWrap.classList.remove('is-flipping');
    }
    if (coin3d) {
        coin3d.className = 'coin-3d';
    }
    if (resultBanner) {
        resultBanner.className = 'coin-result-banner hidden';
    }
    if (statusText) {
        statusText.innerText = "Tomonlardan birini tanlang (qolgan tomon raqibga o'tadi)...";
    }

    // 7.5 soniyalik animatsiyali taymer
    let timeLeftMs = 7500;
    const stepMs = 50;
    if (timerBar) timerBar.style.width = '100%';
    coinTossTimerInterval = setInterval(() => {
        timeLeftMs -= stepMs;
        const pct = Math.max(0, (timeLeftMs / 7500) * 100);
        if (timerBar) timerBar.style.width = pct + '%';
        if (timeLeftMs <= 0) {
            clearInterval(coinTossTimerInterval);
            coinTossTimerInterval = null;
        }
    }, stepMs);

    modal.classList.remove('hidden');
}

function hideCoinTossModal() {
    isCoinTossActive = false;
    myCoinChoice = null;
    if (coinTossTimerInterval) {
        clearInterval(coinTossTimerInterval);
        coinTossTimerInterval = null;
    }
    const modal = document.getElementById('coin-toss-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function handleCoinFlipStart(data) {
    if (coinTossTimerInterval) {
        clearInterval(coinTossTimerInterval);
        coinTossTimerInterval = null;
    }

    const timerWrap = document.getElementById('coin-timer-bar-wrap');
    if (timerWrap) timerWrap.classList.add('hidden');

    const btnRasm = document.getElementById('btn-coin-rasm');
    const btnRaqam = document.getElementById('btn-coin-raqam');
    const badgeRasm = document.getElementById('badge-coin-rasm');
    const badgeRaqam = document.getElementById('badge-coin-raqam');
    const statusText = document.getElementById('coin-status-text');
    const stageWrap = document.getElementById('coin-stage-wrap');
    const coin3d = document.getElementById('coin-3d-element');
    const resultBanner = document.getElementById('coin-result-banner');
    const resultTitle = document.getElementById('coin-result-title');
    const resultSub = document.getElementById('coin-result-subtitle');

    if (btnRasm) btnRasm.classList.add('disabled');
    if (btnRaqam) btnRaqam.classList.add('disabled');

    const myChoice = (data.choices && data.choices[myPlayerIndex]) || (myPlayerIndex === 0 ? 'rasm' : 'raqam');
    const oppChoice = (data.choices && data.choices[myPlayerIndex === 0 ? 1 : 0]) || (myChoice === 'rasm' ? 'raqam' : 'rasm');
    const iWon = (data.winnerIndex === myPlayerIndex);
    const oppName = (currentOpponentProfile && currentOpponentProfile.name) || "Raqib";

    // Tugmalarda kim qaysi tomonni olganini ko'rsatish
    const myBtn = myChoice === 'rasm' ? btnRasm : btnRaqam;
    const myBadge = myChoice === 'rasm' ? badgeRasm : badgeRaqam;
    const oppBtn = oppChoice === 'rasm' ? btnRasm : btnRaqam;
    const oppBadge = oppChoice === 'rasm' ? badgeRasm : badgeRaqam;

    if (myBtn) {
        myBtn.classList.remove('selected-by-opponent');
        myBtn.classList.add('selected-by-me');
    }
    if (myBadge) {
        myBadge.className = 'coin-choice-badge badge-me';
        myBadge.innerText = 'Sizning tomoningiz';
    }

    if (oppBtn) {
        oppBtn.classList.remove('selected-by-me');
        oppBtn.classList.add('selected-by-opponent');
    }
    if (oppBadge) {
        oppBadge.className = 'coin-choice-badge badge-opp';
        oppBadge.innerText = 'Raqib tomoni';
    }

    // Status matni: kim birinchi tanlaganini tushuntirish
    if (statusText) {
        if (data.firstChooser === myPlayerIndex) {
            statusText.innerText = `Siz birinchi bo'lib "${myChoice === 'rasm' ? 'Rasm' : 'Raqam'}"ni tanladingiz!`;
        } else if (data.firstChooser !== null && data.firstChooser !== undefined) {
            statusText.innerText = `${oppName} birinchi bo'lib "${oppChoice === 'rasm' ? 'Rasm' : 'Raqam'}"ni tanladi. Sizga esa "${myChoice === 'rasm' ? 'Rasm' : 'Raqam'}" biriktirildi!`;
        } else {
            statusText.innerText = `Qur'a tashlanmoqda...`;
        }
    }

    // 3D Tangani ko'rsatish va aylantirish
    if (stageWrap) {
        stageWrap.classList.remove('hidden');
        stageWrap.classList.add('is-flipping');
    }

    playCoinFlipSound();

    if (coin3d) {
        coin3d.className = 'coin-3d ' + (data.result === 'rasm' ? 'flipping-to-rasm' : 'flipping-to-raqam');
    }

    // 3.2 soniyadan so'ng tanga tushganda natijani ko'rsatamiz
    setTimeout(() => {
        if (stageWrap) stageWrap.classList.remove('is-flipping');
        playCoinLandSound();

        if (resultBanner && resultTitle && resultSub) {
            resultBanner.className = 'coin-result-banner ' + (iWon ? 'win-banner' : 'lose-banner');
            const resultLabel = data.result === 'rasm' ? '👑 RASM' : '🔢 RAQAM';
            if (iWon) {
                resultTitle.innerHTML = `🎉 Tanga <strong>${resultLabel}</strong> tushdi — Siz yutdingiz!`;
                resultSub.innerText = `Birinchi zarba huquqi sizda! O'q uzishga tayyorlaning!`;
            } else {
                resultTitle.innerHTML = `⚔️ Tanga <strong>${resultLabel}</strong> tushdi — ${oppName} yutdi!`;
                resultSub.innerText = `Birinchi zarbani ${oppName} boshlaydi. Himoyada bo'ling!`;
            }
        }
    }, 3200);
}

socket.on('coinFlipStart', (data) => {
    handleCoinFlipStart(data);
});

socket.on('coinFlipComplete', (data) => {
    hideCoinTossModal();
    updateTurn(data.turnIndex, data.wind);
    if (gameMode === 'multi') {
        if (data.turnIndex === myPlayerIndex) {
            showCenterNotice("Qur'ada g'alaba! Otish navbati sizda, vaqt ketyapti! 🏹⏳", 2800);
            if (typeof triggerHaptic === 'function') triggerHaptic('medium');
            playSfx('button', 0.9);
        } else {
            showCenterNotice("Qur'a yakunlandi. Raqib navbati, kuting... ⏳", 2200);
        }
    }
});

socket.on('gameStart', (data) => {
    console.log('gameStart data:', JSON.stringify(data));
    console.log('data.roomName:', data.roomName);
    console.log('typeof data:', typeof data);
    clearRandomWaitTimer();
    gameMode = 'multi';
    battleScoreEarned = 0;
    autoJoinExecuted = true;
    waitingScreen.classList.add('hidden');
    multiMenu.classList.add('hidden');
    if (menuScreen) {
        menuScreen.classList.add('hidden');
        menuScreen.style.setProperty('display', 'none', 'important');
    }
    const introEl = document.getElementById('intro-screen');
    if (introEl) {
        introEl.classList.add('hide');
        introEl.style.display = 'none';
        if (introEl.parentNode) introEl.parentNode.removeChild(introEl);
    }
    // Barcha boshqa modallarni to'liq yashirish:
    for (const id of ALL_MODAL_IDS) {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    }
    gameScreen.classList.remove('hidden');
    updateTelegramBackButton();
    isPaused = false;
    isDragging = false;
    battleScoreEarned = 0;
    isWallPlacementMode = false;
    isWallDragActive = false;
    setDefenseActive(false, false);
    setDuckActive(false, false);
    resetJumpStates();
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
    currentBattleDistance = 2700; // Onlayn rejim uchun qulay masofa

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
    p1Model.visible = true;
    p2Model.visible = true;
    showBattleLoading();
    applySoldierWeatherTone();
    updateCameraBounds();
    const camFocus = getFocusCameraTarget(myPlayerIndex);
    cameraState = 'static';
    cameraTargetX = camFocus.x;
    cameraTargetY = camFocus.y;
    cameraZoomTarget = camFocus.zoom;
    camera.position.x = camFocus.x;
    camera.position.y = camFocus.y;
    camera.zoom = camFocus.zoom;
    camera.updateProjectionMatrix();

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
    applyHudSideRoles();
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
    if (data.hasCoinToss) {
        currentTurnIndex = -1;
        showCoinTossModal(data);
    } else {
        updateTurn(data.turnIndex, data.wind);
    }

    if (!isLooping) {
        isLooping = true;
        lastTime = performance.now();
        requestAnimationFrame(gameLoop);
    }
});

socket.on('nextTurn', (data) => {
    isAnimating = false;
    if (spear) spear.active = false;
    hideFlyingSpear();
    resetCameraAfterImpact();
    if (controlsPanel) controlsPanel.classList.remove('disabled');
    if (hud) hud.style.opacity = '1';
    if (spearGroup) spearGroup.visible = false;
    updateTurn(data.turnIndex, data.wind);
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
        scheduleAfterCinematic(() => updateTurn(data.nextTurn, data.wind));
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

socket.on('playerAimState', (data) => {
    if (!data || typeof data.playerIndex !== 'number') return;
    if (data.playerIndex === myPlayerIndex) return;
    remoteAimStates[data.playerIndex] = {
        isAiming: !!data.isAiming,
        dist: Number(data.dist || 0),
        angle: Number(data.angle || 0)
    };
    const oppModel = modelForPlayer(data.playerIndex);
    if (!oppModel) return;
    if (data.isAiming) {
        const state = (data.dist && data.dist > 50) ? 'aim' : (data.dist > 10 ? 'load' : 'aim');
        setSoldierVisual(oppModel, state);
    } else {
        const isDef = isDefenseActiveForPlayer(data.playerIndex);
        const isDck = isDuckActiveForPlayer(data.playerIndex);
        setSoldierVisual(oppModel, isDck ? 'duck' : (isDef ? 'defend' : 'idle'));
        if (typeof opponent3DBow !== 'undefined' && opponent3DBow) opponent3DBow.visible = false;
    }
});

socket.on('spearThrown', (data) => {
    const { playerIndex, angle, power, isArtillery, isFire } = data;
    remoteAimStates[playerIndex] = { isAiming: false, dist: 0, angle: 0 };
    if (typeof opponent3DBow !== 'undefined' && opponent3DBow) opponent3DBow.visible = false;
    const thrower = modelForPlayer(playerIndex);
    if (thrower) {
        setModelActionState(thrower, 'afterShot', 950);
    }
    if (isFire) pendingFireShot = true;
    startSpearAnimation(playerIndex, angle, power, isArtillery);
});

socket.on('airDropSpawn', (data) => {
    if (!data) return;
    if (typeof spawnAirDropCrate === 'function') {
        spawnAirDropCrate(data.x, data.y, data.id);
    }
});

socket.on('airDropHit', (data) => {
    if (!data) return;
    if (typeof onRemoteAirDropHit === 'function') {
        onRemoteAirDropHit(data);
    }
});

socket.on('groundHit', (data) => {
    isAnimating = false;
    if (spear) spear.active = false;
    hideFlyingSpear();
    resetCameraAfterImpact();
    if (controlsPanel) controlsPanel.classList.remove('disabled');
    if (hud) hud.style.opacity = '1';
    if (spear && spear.isArtillery) {
        triggerCinematicExplosion(data.hitX, data.hitY);
    } else {
        stickSpear(null, data.hitX, data.hitY, data.hitAngle);
        playSfx('ground');
    }
});

socket.on('hitRegistered', (data) => {
    const { targetIndex, damage, newHealth, newShield, hitX, hitY, isShieldHit, hitAngle, shieldActiveBlock, shieldlessDefense, shieldBroke, hitZone, duckDodged, jumpDodged, isFire } = data;
    const targetModel = modelForPlayer(targetIndex) || (targetIndex === 0 ? p1Model : p2Model);

    isAnimating = false;
    if (spear) spear.active = false;
    hideFlyingSpear();
    resetCameraAfterImpact();
    if (controlsPanel) controlsPanel.classList.remove('disabled');
    if (hud) hud.style.opacity = '1';

    if (isFire) {
        spawnFireBurst(hitX, hitY, 35);
        screenShake = Math.max(screenShake, 16);
    }

    // Har ikki o'yinchida ham o'q tegishi, yiqilishi va zarba effektlari ko'rinadi
    hideFlyingSpear();
    if (spear && spear.isArtillery) {
        triggerCinematicExplosion(hitX, hitY);
        showDamageText(hitX, hitY + 80, `-${damage}`, false, true);
        if (damage > 0 && targetModel) knockDownModel(targetModel);
    } else if (targetModel) {
        flashHit(targetModel);
        if (duckDodged) {
            showDamageText(hitX, hitY + 80, "BOSHNI EGIB QUTULDI!", false, true);
        } else if (jumpDodged) {
            showDamageText(hitX, hitY + 80, "SAKRAB QUTULDI! 🤾", false, true);
        } else if (isShieldHit) {
            spawnParticles(hitX, hitY, 10, true);
            const msg = shieldActiveBlock ? "🛡️ QALQON! BLOK" : `QALQONGA TEGDI! -${damage}`;
            showDamageText(hitX, hitY + 80, msg, false, true);
            playSfx(shieldActiveBlock ? 'shieldActive' : 'shieldPassive');
        } else {
            let isCrit = damage >= 40;
            spawnParticles(hitX, hitY, isCrit ? 40 : 20);
            if (hitZone === 'head') {
                playSfx('headHit');
                if (typeof triggerScreenFlash === 'function') triggerScreenFlash('headshot');
                screenShake = Math.max(screenShake, 18);
            } else if (hitZone === 'leg') {
                playSfx('legHit');
            } else {
                playSfx('ground', 0.9);
            }
            if (targetIndex === myPlayerIndex && damage > 0) {
                if (typeof triggerScreenFlash === 'function') triggerScreenFlash('damage');
            }
            let msg = "-" + damage;
            if (isCrit) msg = "BOSHGA! " + msg;
            if (shieldlessDefense) msg = "HIMOYA! " + msg;
            showDamageText(hitX, hitY + 80, msg, isCrit);
            if (damage > 0) {
                knockDownModel(targetModel);
                setSoldierVisual(targetModel, 'hurt');
            }
        }
    }

    if (targetIndex === myPlayerIndex) {
        myHealth = newHealth; myShield = newShield;
    } else {
        enemyHealth = newHealth; enemyShield = newShield;
    }
    if (newHealth <= 0 && targetModel) {
        targetModel.userData.isKnockedDown = true;
        setSoldierVisual(targetModel, 'hurt');
        if (targetModel.userData.planeMesh && targetModel.userData.planeMesh.material) {
            targetModel.userData.planeMesh.material.opacity = 0.45;
        }
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
    if (!data || typeof data.playerIndex !== 'number') return;
    if (data.playerIndex === myPlayerIndex) return;
    const isDuck = !!data.active;
    if (data.playerIndex >= 0 && data.playerIndex < duckStates.length) {
        duckStates[data.playerIndex] = isDuck;
    }
    enemyDuckActive = isDuck;
    const m = modelForPlayer(data.playerIndex);
    if (m) {
        setSoldierVisual(m, isDuck ? 'duck' : (isDefenseActiveForPlayer(data.playerIndex) ? 'defend' : 'idle'));
    }
});

socket.on('jumpStateChanged', (data) => {
    if (!data || typeof data.playerIndex !== 'number') return;
    if (data.playerIndex === myPlayerIndex) return;
    if (data.active) {
        triggerJump(data.playerIndex);
    }
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
    applyWallHit(Number(data.ownerIndex), Number(data.hitX || 0), Number(data.hitY || (ground.position.y + 90)), !!data.isArtillery, !!data.isFire);
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
        // Bird hit text removed by user request
    }
});

socket.on('crowKillerShot', (data) => {
    const shooterIndex = data?.shooterIndex !== undefined ? data.shooterIndex : (myPlayerIndex === 0 ? 1 : 0);
    playCrowKillerVisualForShooter(shooterIndex, () => {
        resetCameraAfterImpact();
    });
});

socket.on('gameOver', (data) => {
    hideCoinTossModal();
    setTimeout(() => showGameOver(data.winnerIndex, data), 1200);
});

socket.on('opponentDisconnected', () => {
    hideCoinTossModal();
    if (gameMode === 'multi') {
        showGameOver(myPlayerIndex, { winnerIndex: myPlayerIndex, winnerId: socket?.id, reason: 'opponent_left' });
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
    if (menuScreen) {
        menuScreen.classList.add('hidden');
        menuScreen.style.setProperty('display', 'none', 'important');
    }
    gameScreen.classList.remove('hidden');
    gameMode = 'multi';
    if (rematchBtn) {
        rematchBtn.innerText = "Revansh";
        rematchBtn.disabled = false;
    }
    // O'yin holatini qayta boshlash
    myHealth = 100;
    enemyHealth = 100;
    myShield = 5;
    enemyShield = 5;
    mySuper = myProfile.superPowers || 5;
    myCrow = myProfile.crowhunt || 0;
    artilleryCount = myProfile.artillery || 0;
    updateSuperUI();
    updateHealthUI();
    updateShieldUI();
    myDefenseActive = false;
    enemyDefenseActive = false;
    myDuckActive = false;
    enemyDuckActive = false;
    setDefenseActive(false, false);
    setDuckActive(false, false);
    resetJumpStates();
    currentTurnIndex = -1;
    prevTurnIndex = -2;
    isWallPlacementMode = false;
    isWallDragActive = false;
    singleShotLocked = false;
    resetWeapon();
    if (!isLooping) {
        isLooping = true;
        lastTime = performance.now();
        requestAnimationFrame(gameLoop);
    }
});

// Revansh rad etildi
socket.on('rematchDeclined', () => {
    if (rematchBtn) {
        rematchBtn.innerText = "Rad etildi";
        rematchBtn.disabled = true;
    }
    setTimeout(() => {
        gameOverScreen.classList.add('hidden');
        document.documentElement.classList.remove('direct-duel-active');
        if (menuScreen) {
            menuScreen.style.removeProperty('display');
            menuScreen.classList.remove('hidden');
        }
        autoJoinExecuted = false;
        gameMode = 'menu';
    }, 2000);
});

socket.on('turnTimerStart', (data) => {
    if (typeof startTurnTimerUI === 'function') {
        startTurnTimerUI(data?.duration || 30);
    }
    if (gameMode === 'multi' && data && typeof data.turnIndex === 'number' && data.turnIndex === myPlayerIndex) {
        showCenterNotice("Otish navbati sizda, vaqt ketyapti! 🏹⏳", 2500);
        if (typeof triggerHaptic === 'function') triggerHaptic('medium');
    }
});

socket.on('turnTimedOut', (data) => {
    showCenterNotice("Vaqt tugadi! Navbat o'tdi", 1800);
});

socket.on('playerEmote', (data) => {
    if (data && typeof data.playerIndex === 'number' && typeof spawnEmoteBubble === 'function') {
        spawnEmoteBubble(data.playerIndex, data.emote || '👍');
    }
});

function showGameOver(winnerIndex, data) {
    if (typeof stopTurnTimerUI === 'function') stopTurnTimerUI();
    gameOverScreen.classList.remove('hidden');
    controlsPanel.classList.add('disabled');
    const t = translations[myProfile.lang] || translations.uz;

    // Aniq g'olibni hisoblash (3-bosqichli tekshiruv)
    let isMeWinner = false;
    if (data && data.winnerId && socket && socket.id) {
        isMeWinner = (data.winnerId === socket.id);
    } else if (typeof winnerIndex === 'number' && myPlayerIndex !== null && myPlayerIndex !== undefined) {
        isMeWinner = (winnerIndex === myPlayerIndex);
    }
    if (gameMode === 'multi') {
        if (myHealth > 0 && enemyHealth <= 0) {
            isMeWinner = true;
        } else if (myHealth <= 0 && enemyHealth > 0) {
            isMeWinner = false;
        }
    }

    if (data && (data.reason === 'timeout_forfeit' || data.reason === 'opponent_left')) {
        if (data.winnerId && socket && socket.id) {
            isMeWinner = (data.winnerId === socket.id);
        } else if (typeof data.winnerIndex === 'number' && myPlayerIndex !== null && myPlayerIndex !== undefined) {
            isMeWinner = (data.winnerIndex === myPlayerIndex);
        }
        if (isMeWinner) {
            winnerText.innerText = data.reason === 'timeout_forfeit'
                ? "Raqib 30 soniyada o'q uzmadi va jangga kirmasdan qochdi! Siz g'olibsiz! 🏆"
                : "Raqib jangdan qochdi! Siz g'olibsiz! 🏆";
            winnerText.style.color = '#22c55e';
        } else {
            winnerText.innerText = data.reason === 'timeout_forfeit'
                ? "Belgilangan 30 soniyada o'q uzmadingiz, siz yengildingiz! 💀"
                : "Siz jangni tark etdingiz! 💀";
            winnerText.style.color = '#ef4444';
        }
    } else {
        winnerText.innerText = isMeWinner ? (t.win || "Siz g'olib bo'ldingiz! 🏆") : (t.lose || "Siz mag'lub bo'ldingiz! 💀");
        winnerText.style.color = isMeWinner ? '#22c55e' : '#ef4444';
    }

    // To'plangan ballni aks ettirish
    const scoreValEl = document.getElementById('game-over-score-val');
    if (scoreValEl) {
        scoreValEl.innerText = String(battleScoreEarned || 0);
    }

    // Reytingni ko'rish tugmasi hodisasi
    const btnGameOverRating = document.getElementById('btn-game-over-rating');
    if (btnGameOverRating && !btnGameOverRating._boundRating) {
        btnGameOverRating._boundRating = true;
        btnGameOverRating.addEventListener('click', (e) => {
            returnToGameOverAfterModal = true;
            if (gameOverScreen) gameOverScreen.classList.add('hidden');
            if (btnRating) {
                btnRating.click();
            } else if (typeof openModalSafely === 'function' && ratingModal) {
                renderLeaderboard();
                openModalSafely(ratingModal, e);
            }
        });
    }

    // Online rejimda revansh tugmasini ko'rsatish
    if (rematchBtn) {
        if (gameMode === 'multi') {
            rematchBtn.classList.remove('hidden');
        } else {
            rematchBtn.classList.add('hidden');
        }
    }

    if (isMeWinner) {
        triggerHaptic('success');
        myStats.wins++;
        if (gameMode === 'multi') {
            addScore(100);
            showCenterNotice("+100 Ball qo'shildi! 🏆", 2500);
        } else if (gameMode === 'single') {
            const singleWinBonus = Math.min(150, 50 + (singleCampaignLevel * 2));
            addScore(singleWinBonus);
            showCenterNotice(`+${singleWinBonus} G'alaba bonusi! 🏆`, 2500);
            singleCampaignLevel += 1;
            localStorage.setItem('nayza_single_level', String(singleCampaignLevel));
            try {
                const rawAuth = localStorage.getItem('nayza_auth_user');
                const cachedAuth = rawAuth ? JSON.parse(rawAuth) : null;
                if (cachedAuth) {
                    cachedAuth.campaignLevel = Math.max(Number(cachedAuth.campaignLevel || 1), singleCampaignLevel);
                    localStorage.setItem('nayza_auth_user', JSON.stringify(cachedAuth));
                }
            } catch { }
            updateCampaignUI();
        }
        if (typeof checkQuestProgress === 'function') checkQuestProgress('win', 1);
    } else {
        triggerHaptic('error');
    }

    const btnNextLvl = document.getElementById('btn-next-level');
    if (btnNextLvl) {
        if (gameMode === 'single' && isMeWinner) {
            btnNextLvl.classList.remove('hidden');
            btnNextLvl.innerText = `${t.nextLevelBtn || "Keyingi bosqich"} (${singleCampaignLevel}) ➔`;
        } else {
            btnNextLvl.classList.add('hidden');
        }
    }

    if (restartBtn) {
        const replayLabel = t.playAgainBtn || "Yana o'ynash";
        const tryAgainLabel = t.tryAgainBtn || "Qayta urinish";
        restartBtn.innerText = (gameMode === 'single' && !isMeWinner) ? tryAgainLabel : replayLabel;
    }
    myStats.games++;
    saveStats();
    submitLeaderboard();

    const targetFocusIndex = isMeWinner ? myPlayerIndex : (myPlayerIndex === 0 ? 1 : 0);
    cameraState = 'target';
    cameraTargetX = targetFocusIndex === 0 ? p1Model.position.x : p2Model.position.x;
    const camFocus = getFocusCameraTarget(targetFocusIndex);
    cameraTargetY = camFocus.y;
    cameraZoomTarget = baseZoom * 1.5;

    // G'alaba qozonganda bayram konfetti effekti.
    if (isMeWinner) {
        spawnConfetti();
        playSfx('crowDead', 0.6);
    }
}

// G'alaba ekranida engil DOM-asoslangan konfetti yog'diradi (mobil/Android'ga mos).
function spawnConfetti() {
    try {
        const colors = ['#fbbf24', '#ef4444', '#22d3ee', '#10b981', '#a855f7', '#f472b6'];
        const count = MOBILE_PERF_MODE ? 36 : 70;
        const layer = document.getElementById('ui-layer') || document.body;
        for (let i = 0; i < count; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.left = Math.random() * 100 + 'vw';
            piece.style.background = colors[Math.floor(Math.random() * colors.length)];
            piece.style.animationDuration = (1.8 + Math.random() * 1.8) + 's';
            piece.style.animationDelay = (Math.random() * 0.6) + 's';
            piece.style.width = (6 + Math.random() * 8) + 'px';
            piece.style.height = (10 + Math.random() * 10) + 'px';
            piece.style.setProperty('--drift', (Math.random() * 200 - 100) + 'px');
            piece.style.setProperty('--spin', (Math.random() * 720 - 360) + 'deg');
            layer.appendChild(piece);
            setTimeout(() => piece.remove(), 4200);
        }
    } catch (_) { }
}

if (btnNextLevel) {
    const handleNextLevel = safeModalAction((e) => {
        gameOverScreen.classList.add('hidden');
        if (gameMode === 'single') {
            const level = Math.max(1, singleCampaignLevel);
            aiDifficulty = level < 6 ? 'easy' : level < 15 ? 'normal' : 'hard';
            startSinglePlayer({ birds: true, animals: Math.random() > 0.45 });
            return;
        }
    });
    btnNextLevel.addEventListener('click', handleNextLevel);
    btnNextLevel.addEventListener('touchend', handleNextLevel, { passive: false });
}

if (restartBtn) {
    const handleRestartGame = safeModalAction((e) => {
        gameOverScreen.classList.add('hidden');
        if (gameMode === 'single') {
            const wasWinner = (winnerText && winnerText.style.color === 'rgb(34, 197, 94)');
            let levelToPlay = singleCampaignLevel;
            if (wasWinner && singleCampaignLevel > 1) {
                // Agar o'yinchi yutgan bo'lsa, 'Yana o'ynash' avvalgi (yutgan) bosqichni qayta o'ynaydi
                levelToPlay = singleCampaignLevel - 1;
                singleCampaignLevel = levelToPlay;
                localStorage.setItem('nayza_single_level', String(singleCampaignLevel));
            }
            const level = Math.max(1, levelToPlay);
            aiDifficulty = level < 6 ? 'easy' : level < 15 ? 'normal' : 'hard';
            startSinglePlayer({ birds: true, animals: Math.random() > 0.45 });
            return;
        }
        location.reload();
    });
    restartBtn.addEventListener('click', handleRestartGame);
    restartBtn.addEventListener('touchend', handleRestartGame, { passive: false });
}

if (menuBtn) {
    const handleReturnToMenu = safeModalAction((e) => {
        gameOverScreen.classList.add('hidden');
        gameScreen.classList.add('hidden');
        waitingScreen.classList.add('hidden');
        multiMenu.classList.add('hidden');
        disconnectScreen.classList.add('hidden');
        inGameModal.classList.add('hidden');
        if (aboutModal) aboutModal.classList.add('hidden');
        if (settingsModal) settingsModal.classList.add('hidden');
        if (profileModal) profileModal.classList.add('hidden');
        if (singleModeModal) singleModeModal.classList.add('hidden');
        document.documentElement.classList.remove('direct-duel-active');
        if (menuScreen) {
            menuScreen.style.removeProperty('display');
            menuScreen.classList.remove('hidden');
        }
        autoJoinExecuted = false;
        gameMode = 'menu';
        updateCampaignUI();
        if (typeof updateMenuWallpaper === 'function') updateMenuWallpaper();
    });
    menuBtn.addEventListener('click', handleReturnToMenu);
    menuBtn.addEventListener('touchend', handleReturnToMenu, { passive: false });
}

// Revansh tugmasi - so'rov yuborish
if (rematchBtn) {
    const handleRematchRequest = safeModalAction((e) => {
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
    rematchBtn.addEventListener('click', handleRematchRequest);
    rematchBtn.addEventListener('touchend', handleRematchRequest, { passive: false });
}

// Revansh so'rovini qabul qilish
if (btnRematchAccept) {
    const handleRematchAccept = safeModalAction((e) => {
        if (rematchModal) rematchModal.classList.add('hidden');
        if (socket && socket.connected) {
            socket.emit('rematchAccept', { roomName: currentRoomName, charType: myProfile.charType });
            showCenterNotice("⚔️ Revansh qabul qilindi! O'yin qayta boshlanmoqda...", 2000);
        }
    });
    btnRematchAccept.addEventListener('click', handleRematchAccept);
    btnRematchAccept.addEventListener('touchend', handleRematchAccept, { passive: false });
}

// Revansh so'rovini rad etish
if (btnRematchDecline) {
    const handleRematchDecline = safeModalAction((e) => {
        if (socket && socket.connected) {
            socket.emit('rematchDecline', { roomName: currentRoomName });
        }
        if (rematchModal) rematchModal.classList.add('hidden');
        gameOverScreen.classList.add('hidden');
        document.documentElement.classList.remove('direct-duel-active');
        if (menuScreen) {
            menuScreen.style.removeProperty('display');
            menuScreen.classList.remove('hidden');
        }
        autoJoinExecuted = false;
        gameMode = 'menu';
        if (typeof updateMenuWallpaper === 'function') updateMenuWallpaper();
    });
    btnRematchDecline.addEventListener('click', handleRematchDecline);
    btnRematchDecline.addEventListener('touchend', handleRematchDecline, { passive: false });
}

function updateTurn(turnIndex, wind) {
    isAnimating = false;
    if (spear) spear.active = false;
    if (secondarySpear) secondarySpear.active = false;
    hideFlyingSpear();
    resetCameraAfterImpact();
    if (controlsPanel) controlsPanel.classList.remove('disabled');
    if (hud) hud.style.opacity = '1';

    const turnChanged = turnIndex !== prevTurnIndex;
    prevTurnIndex = turnIndex;
    currentTurnIndex = turnIndex;
    if (turnIndex !== myPlayerIndex) {
        if (isWallPlacementMode) {
            isWallPlacementMode = false;
            isWallDragActive = false;
        }
        if (isArtilleryAiming) {
            isArtilleryAiming = false;
            if (btnArtillery) btnArtillery.classList.remove('active');
            if (myArtilleryCannon) myArtilleryCannon.visible = false;
        }
    }
    if (gameMode === 'single' && turnIndex === myPlayerIndex) singleShotLocked = false;
    currentWind = wind;

    if (gameMode === 'single') {
        turnsSinceLastCrate = (typeof turnsSinceLastCrate === 'number' ? turnsSinceLastCrate : 0) + 1;
        if (turnsSinceLastCrate >= 4) {
            turnsSinceLastCrate = 0;
            if (typeof spawnAirDropCrate === 'function') spawnAirDropCrate();
        }
    }

    // O'yinchi navbati boshlanganda avvalgi otish trayektoriyasini hint sifatida ko'rsatamiz.
    if (turnIndex === myPlayerIndex && lastPlayerShot) {
        buildHintTrajectory();
    } else {
        clearHintTrajectory();
    }

    p1Info.classList.toggle('active', turnIndex === 0);
    p2Info.classList.toggle('active', turnIndex === 1);
    applyHudSideRoles();
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

    const isOnlineTurnFocus = gameMode === 'multi';
    const camFocus = getFocusCameraTarget(turnIndex);
    cameraState = 'target';
    cameraTargetX = camFocus.x;
    cameraTargetY = camFocus.y;
    cameraZoomTarget = camFocus.zoom;

    if (turnIndex === myPlayerIndex) {
        controlsPanel.classList.remove('disabled');
        if (turnChanged) controlsPanel.classList.remove('auto-hidden');
        turnIndicator.innerText = "Sizning navbatingiz! (Tortib mo'ljalga oling)";
        turnIndicator.classList.add('turn-self');
        turnIndicator.classList.remove('turn-opponent');

        if (turnChanged && gameMode === 'multi') {
            showCenterNotice("Otish navbati sizda, vaqt ketyapti! 🏹⏳", 2500);
            if (typeof triggerHaptic === 'function') triggerHaptic('medium');
            playSfx('button', 0.9);
        }

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

        if (turnChanged && gameMode === 'multi') {
            showCenterNotice("Raqib navbati, kuting... ⏳", 2000);
        }

        if (isOnlineTurnFocus) {
            camera.position.x = cameraTargetX;
            camera.position.y = cameraTargetY;
            camera.zoom = cameraZoomTarget;
            camera.updateProjectionMatrix();
        }
    }
    updateSuperUI();
}

function startSpearAnimation(playerIndex, angle, power, isArtillery = false) {
    isAnimating = true;
    controlsPanel.classList.add('disabled');
    hud.style.opacity = 0.3;
    playThrowSound();

    const thrower = modelForPlayer(playerIndex);
    const isSpearman = !!thrower?.userData?.isOttomanSpearman;
    const isArcher = !!thrower?.userData?.isOttomanArcher;
    const isCustom = !!thrower?.userData?.isCustomModel;

    let throwState = 'afterShot';
    // Kamonchilarda aim holati rasmda o'qni tortib turgan holat bo'lgani uchun, 
    // o'q uzilgandan so'ng 'afterShot' rasmiga o'tishi kerak.
    // Eski mantiqda aim bo'lib qolgan edi, shuni afterShot ga o'zgartiramiz.

    setModelActionState(thrower, throwState, 1100);

    // Otish yo'nalishi otuvchining maydondagi TOMONIGA qarab aniqlanadi.
    // Chap tomondagi jangchi (x < 0) o'ngga, o'ng tomondagi (x > 0) chapga otadi.
    // (Avval bu faqat index===0 ga bog'liq edi, shu sabab 50+ levelda chap tomondagi
    //  ikkinchi raqib (p3) teskari - o'yinchidan teskari tomonga - otib yuborardi.)
    const facingRight = thrower.position.x < 0;

    // Start trajectory directly from the bow's position
    let startX = thrower.position.x + (facingRight ? 60 : -60);
    let startY = thrower.position.y + 270;

    if (isArtillery) {
        startX = thrower.position.x + (facingRight ? 570 : -570);
        startY = thrower.position.y + 175;

        if (playerIndex !== myPlayerIndex) {
            if (!window.enemyArtilleryCannon) {
                const tex = loadTexture('artileriya.png');
                const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
                window.enemyArtilleryCannon = new THREE.Mesh(new THREE.PlaneGeometry(350, 192), mat);
                scene.add(window.enemyArtilleryCannon);
            }
            const cannonOffset = 440;
            window.enemyArtilleryCannon.scale.set(1.0, 1.0, 1.0);
            window.enemyArtilleryCannon.position.set(
                thrower.position.x + (facingRight ? cannonOffset : -cannonOffset),
                thrower.position.y + 115,
                thrower.position.z - 2
            );
            if (facingRight) {
                window.enemyArtilleryCannon.rotation.y = Math.PI;
            } else {
                window.enemyArtilleryCannon.rotation.y = 0;
            }

            window.enemyArtilleryCannon.visible = true;

            // Hide it after a short delay
            setTimeout(() => {
                if (window.enemyArtilleryCannon) window.enemyArtilleryCannon.visible = false;
            }, 1000);
        }
    }

    const rad = angle * (Math.PI / 180);

    let vx = power * Math.cos(rad);
    if (!facingRight) vx = -vx;

    spear = {
        x: startX,
        y: startY,
        prevX: startX,
        prevY: startY,
        vx: vx,
        vy: power * Math.sin(rad),
        active: true,
        playerIndex: playerIndex,
        hitEntity: null,
        entityHitEmitted: false,
        aiSuperTried: false,
        isArtillery: isArtillery,
        isFire: !isArtillery && pendingFireShot,
        weaponType: getPlayerWeaponType(playerIndex)
    };
    pendingFireShot = false;

    let isSpearmanThrow = !!thrower?.userData?.isOttomanSpearman;
    if (thrower?.userData?.isCustomModel) {
        const cModel = window.customModelsInfo && window.customModelsInfo.find(m => m.id == thrower.userData.charType);
        if (cModel && cModel.weaponType === 'spear') {
            isSpearmanThrow = true;
        }
    }
    applySpearVisualStyle(isSpearmanThrow, isArtillery);
    const spearScale = isArtillery ? 2.5 : (isSpearmanThrow ? 1.15 : 1);
    spearGroup.scale.setScalar(spearScale);
    secondarySpearGroup.scale.setScalar(spearScale);
    spearGroup.position.set(startX, startY, 0);
    spearGroup.visible = true;
    // Olov nayza: nayzaga yonayotgan glow va olovni biriktiramiz.
    applyFireSpearVisual(spear.isFire);
    lastRecordedSecondaryHit = null;
    if (pendingDoubleShot) {
        const shot = pendingDoubleShot;
        const shotRad = shot.angle * (Math.PI / 180);
        let svx = shot.power * Math.cos(shotRad);
        if (!facingRight) svx = -svx;
        secondarySpear = {
            x: startX,
            y: startY + 12,
            prevX: startX,
            prevY: startY + 12,
            vx: svx,
            vy: shot.power * Math.sin(shotRad),
            active: true,
            playerIndex: playerIndex,
            shooterIndex: playerIndex,
            isSecondary: true
        };
        secondarySpearGroup.position.set(startX, startY + 12, 0);
        secondarySpearGroup.visible = true;
    } else {
        secondarySpear = null;
        secondarySpearGroup.visible = false;
    }

    if (gameMode === 'multi') {
        currentTurnIndex = -1;
    }

    cameraState = 'follow';
    cameraZoomTarget = baseZoom * 1.35;
}

function getWallHitOwnerIndex() {
    if (!spear || !spear.active) return -1;
    const states = [wallStates[0], wallStates[1]];
    for (const wall of states) {
        if (!wall || !wall.active || !wall.mesh) continue;
        // O'z jamoasining (ittifoqchilarining) o'qlari o'z devoridan bemalol o'tishi kerak.
        // Raqib o'z devorini o'zi nayza bilan buza olmaydi!
        if (areAllies(Number(spear.playerIndex), Number(wall.ownerIndex))) continue;
        const halfW = Number(wall.mesh.userData.wallWidth || 280) / 2;
        const halfH = Number(wall.mesh.userData.wallHeight || 460) / 2;
        if (Math.abs(spear.x - wall.x) <= halfW && Math.abs(spear.y - wall.mesh.position.y) <= halfH) {
            return wall.ownerIndex;
        }
    }
    return -1;
}

function applyWallHit(ownerIndex, hitX, hitY, isArtillery = false, isFire = false) {
    const wall = wallStates[ownerIndex];
    if (!wall || !wall.active) return;
    if (isFire) {
        wall.hp = 0;
        showDamageText(hitX, hitY + 50, "🔥 DEVOR YONIB KETDI!", true, false);
        spawnFireBurst(hitX, hitY, 50);
        if (wall.mesh) {
            spawnFireBurst(wall.x, wall.mesh.position.y, 40);
            spawnFireBurst(wall.x, wall.mesh.position.y + 80, 30);
            spawnFireBurst(wall.x, wall.mesh.position.y - 80, 30);
        }
        let burnTicks = 0;
        const burnInterval = setInterval(() => {
            burnTicks++;
            spawnFireBurst(wall.x + (Math.random() - 0.5) * 60, hitY + (Math.random() - 0.5) * 80, 10);
            if (burnTicks >= 5) clearInterval(burnInterval);
        }, 75);
        playSfx('headHit', 1.25);
        screenShake = Math.max(screenShake, 15);
    } else if (isArtillery) {
        wall.hp = 0;
        showDamageText(hitX, hitY + 40, "DEVOR PORTLADI!", true, false);
        triggerCinematicExplosion(hitX, hitY);
    } else {
        wall.hp = Math.max(0, Number(wall.hp || WALL_HP_MAX) - 1);
        showDamageText(hitX, hitY + 40, `DEVOR -1 (${wall.hp}/5)`, false, true);
        spawnParticles(hitX, hitY, 12, true);
    }
    if (wall.hp <= 0) {
        removeWall(ownerIndex);
    } else {
        setWallState(ownerIndex, true, wall.x, wall.hp);
    }
}

let lastRecordedSecondaryHit = null;

function getWallHitOwnerIndexForPos(posX, posY, shooterIndex) {
    const states = [wallStates[0], wallStates[1]];
    for (const wall of states) {
        if (!wall || !wall.active || !wall.mesh) continue;
        // O'z jamoasining (ittifoqchilarining) o'qlari o'z devoridan bemalol o'tadi
        if (areAllies(Number(shooterIndex), Number(wall.ownerIndex))) continue;
        const halfW = Number(wall.mesh.userData.wallWidth || 280) / 2;
        const halfH = Number(wall.mesh.userData.wallHeight || 460) / 2;
        if (Math.abs(posX - wall.x) <= halfW && Math.abs(posY - wall.mesh.position.y) <= halfH) {
            return wall.ownerIndex;
        }
    }
    return -1;
}

function applySecondarySpearHit(targetIndex, hitX, hitY) {
    const targetModel = modelForPlayer(targetIndex) || (targetIndex === 0 ? p1Model : p2Model);
    flashHit(targetModel);
    // Qo'sh nayzaning ikkinchi o'qi havoda muallaq qolib ketmasligi uchun urilgach yo'qoladi
    if (secondarySpearGroup) secondarySpearGroup.visible = false;

    const relativeY = hitY - targetModel.position.y;
    const hitResult = calculateHitResult(targetIndex, relativeY, false);

    const baseDamage = Number(hitResult.damage) > 0 ? Number(hitResult.damage) : 25;
    const finalDamage = Math.max(15, baseDamage);
    hitResult.damage = finalDamage;
    hitResult.msg = `Qo'sh nayza: -${finalDamage}`;

    playHitByResult(hitResult);
    showDamageText(hitX, hitY + 80, hitResult.msg, hitResult.isCrit, hitResult.isShieldHit);

    if (hitResult.isShieldHit) {
        spawnParticles(hitX, hitY, 15, true);
        setShieldForPlayer(targetIndex, shieldForPlayer(targetIndex) - 1);
        if (shieldForPlayer(targetIndex) <= 0) breakShield(targetModel);
    } else {
        spawnParticles(hitX, hitY, 30);
        knockDownModel(targetModel);
    }

    if (secondarySpear && secondarySpear.playerIndex === myPlayerIndex && targetIndex !== myPlayerIndex) {
        addScore(getScoreDeltaForHit(hitResult));
    }

    if (gameMode === 'single') {
        applyDamageToTarget(targetIndex, finalDamage);
        updateHealthUI();
        if (myHealth <= 0 || areAllEnemiesDead()) {
            const winnerIndex = myHealth > 0 ? myPlayerIndex : getPrimaryEnemyTurnIndex();
            setTimeout(() => showGameOver(winnerIndex), 1500);
        }
    } else {
        lastRecordedSecondaryHit = {
            targetIndex,
            damage: finalDamage,
            hitZone: hitResult.hitZone || 'body',
            shieldActiveBlock: hitResult.shieldActiveBlock || false,
            shieldlessDefense: hitResult.shieldlessDefense || false,
            hitX,
            hitY,
            isShieldHit: hitResult.isShieldHit || false,
            hitAngle: secondarySpearGroup.rotation.z
        };
    }
}

function lineSegmentIntersectsAABB(x0, y0, x1, y1, minX, maxX, minY, maxY) {
    if (Math.max(x0, x1) < minX || Math.min(x0, x1) > maxX) return false;
    if (Math.max(y0, y1) < minY || Math.min(y0, y1) > maxY) return false;
    if (x0 >= minX && x0 <= maxX && y0 >= minY && y0 <= maxY) return true;
    if (x1 >= minX && x1 <= maxX && y1 >= minY && y1 <= maxY) return true;

    const dx = x1 - x0;
    const dy = y1 - y0;
    let tmin = 0, tmax = 1;

    if (Math.abs(dx) > 1e-7) {
        let t1 = (minX - x0) / dx;
        let t2 = (maxX - x0) / dx;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return false;
    }

    if (Math.abs(dy) > 1e-7) {
        let t1 = (minY - y0) / dy;
        let t2 = (maxY - y0) / dy;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return false;
    }

    return tmin <= tmax && tmax >= 0 && tmin <= 1;
}

function getPlayerBoundingBox(playerIndex) {
    const m = modelForPlayer(playerIndex);
    if (!m || !m.userData || !m.visible || m.userData.isDead || m.userData.isKnockedDown) return null;

    const isDucking = isDuckActiveForPlayer(playerIndex);
    const isJumping = isJumpActiveForPlayer(playerIndex);

    const baseHeight = m.userData.planeHeight || m.userData?.planeMesh?.geometry?.parameters?.height || (m.userData.isOttomanUnit ? 430 : 480);
    const baseWidth = m.userData.planeWidth || m.userData?.planeMesh?.geometry?.parameters?.width || (m.userData.isOttomanSpearman ? 640 : (m.userData.isOttomanUnit ? 560 : 360));

    // When ducking/crouching, the warrior lowers down to ~52% of base standing height
    const effectiveHeight = isDucking ? (baseHeight * 0.52) : baseHeight;

    // Body width: central silhouette of the sprite. When ducking, warrior is compact (~18% narrower)
    const widthFactor = m.userData.isCustomModel ? 0.44 : 0.36;
    const halfWidth = (baseWidth * widthFactor) * (isDucking ? 0.82 : 1.0);

    // Feet Y elevation (m.position.y dynamically tracks ground or airborne jump height!)
    const minY = m.position.y;
    const maxY = m.position.y + effectiveHeight;

    const minX = m.position.x - halfWidth;
    const maxX = m.position.x + halfWidth;

    return {
        model: m,
        playerIndex,
        isDucking,
        isJumping,
        baseHeight,
        baseWidth,
        effectiveHeight,
        halfWidth,
        minX,
        maxX,
        minY,
        maxY
    };
}

function checkSecondarySpearCollision() {
    if (!secondarySpear || !secondarySpear.active) return;

    // Devor bilan to'qnashuv
    const wallOwner = getWallHitOwnerIndexForPos(secondarySpear.x, secondarySpear.y, secondarySpear.playerIndex);
    if (wallOwner >= 0) {
        secondarySpear.active = false;
        secondarySpearGroup.visible = false;
        const hitX = secondarySpear.x;
        const hitY = secondarySpear.y;
        if (gameMode === 'multi') {
            if (secondarySpear.playerIndex === myPlayerIndex) {
                socket.emit('wallHit', { ownerIndex: wallOwner, hitX, hitY, isArtillery: false });
            }
        } else {
            applyWallHit(wallOwner, hitX, hitY, false);
        }
        return;
    }

    // Raqib modellari bilan to'qnashuv - aniq fizik geometriya (bo'y, en, o'tirish va sakrash)
    const models = p3Model ? [p1Model, p2Model, p3Model] : [p1Model, p2Model];
    for (let i = 0; i < models.length; i++) {
        const m = models[i];
        if (!m || !m.visible || m.userData.isDead || m.userData.isKnockedDown) continue;
        if (i === secondarySpear.playerIndex) continue;
        if (areAllies(i, secondarySpear.playerIndex)) continue;

        const box = getPlayerBoundingBox(i);
        if (!box) continue;

        const pX = (secondarySpear.prevX !== undefined) ? secondarySpear.prevX : secondarySpear.x;
        const pY = (secondarySpear.prevY !== undefined) ? secondarySpear.prevY : secondarySpear.y;

        const isHit = lineSegmentIntersectsAABB(pX, pY, secondarySpear.x, secondarySpear.y, box.minX, box.maxX, box.minY, box.maxY);
        if (isHit) {
            const hitX = secondarySpear.x;
            const hitY = secondarySpear.y;
            secondarySpear.active = false;
            secondarySpearGroup.visible = false;
            applySecondarySpearHit(i, hitX, hitY);
            return;
        }
    }

    // Yerga tushish
    if (secondarySpear.y <= ground.position.y + 100) {
        secondarySpear.active = false;
        secondarySpearGroup.visible = false;
        stickSpear(null, secondarySpear.x, ground.position.y + 100, secondarySpearGroup.rotation.z);
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
                socket.emit('wallHit', { ownerIndex: wallOwnerIndex, hitX, hitY, isArtillery: spear.isArtillery, isFire: spear.isFire });
            }
        } else {
            applyWallHit(wallOwnerIndex, hitX, hitY, spear.isArtillery, spear.isFire);
            advanceSingleTurnAfterShot();
        }
        return;
    }

    const crateHitInfo = (typeof checkAirDropCrateHit === 'function') ? checkAirDropCrateHit() : null;
    if (crateHitInfo) {
        spear.active = false;
        isAnimating = false;
        resetCameraAfterImpact();
        hideFlyingSpear();
        if (gameMode === 'multi') {
            if (spear.playerIndex === myPlayerIndex) {
                socket.emit('airDropHit', {
                    crateId: crateHitInfo.crate ? crateHitInfo.crate.id : null,
                    reward: crateHitInfo.chosenReward,
                    hitX: spear.x,
                    hitY: spear.y,
                    shooterIndex: myPlayerIndex
                });
                socket.emit('throwComplete', {
                    hitOpponent: false,
                    hitCrate: true,
                    hitX: spear.x,
                    hitY: spear.y,
                    hitAngle: spearGroup.rotation.z
                });
            }
        } else {
            advanceSingleTurnAfterShot();
        }
        return;
    }

    let hitEntity = null;
    for (let e of entities) {
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
        // Crow hit text removed by user request
        if (typeof checkQuestProgress === 'function') checkQuestProgress('crow', 1);
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
        if (!m || !m.visible || m.userData.isDead || m.userData.isKnockedDown) continue;
        if (i !== spear.playerIndex && areAllies(i, spear.playerIndex)) continue;

        const box = getPlayerBoundingBox(i);
        if (!box) continue;

        const pX = (spear.prevX !== undefined) ? spear.prevX : spear.x;
        const pY = (spear.prevY !== undefined) ? spear.prevY : spear.y;

        const isHit = lineSegmentIntersectsAABB(pX, pY, spear.x, spear.y, box.minX, box.maxX, box.minY, box.maxY);
        if (isHit) {
            if (i === spear.playerIndex) {
                const throwerPos = m.position;
                const distFromSelf = Math.abs(spear.x - throwerPos.x);
                // 1. Agar o'q otuvchi yaqinida bo'lsa (260px ichida), o'ziga tegishi MUMKIN EMAS
                if (distFromSelf < 260) continue;
                // 2. Agar o'q hali osmonga ko'tarilayotgan bo'lsa (vy > 0), o'ziga tegmasin
                if (spear.vy > 0) continue;
                // 3. Agar o'q otuvchidan uzoqlashayotgan bo'lsa (masalan pastga, sandiqqa yoki oldinga), o'ziga tegmasin
                const isMovingAway = (spear.x > throwerPos.x && spear.vx > 0) || (spear.x < throwerPos.x && spear.vx < 0);
                if (isMovingAway) continue;
            }

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
    if (typeof active3DBow !== 'undefined' && active3DBow) active3DBow.visible = false;
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

        // Bird hit text removed by user request

        if (spear.playerIndex === myPlayerIndex || gameMode === 'single') {
            if (spear.playerIndex === myPlayerIndex) {
                // Bird/crow kill penalty: can go below zero (debt mode).
                addScore(-2);
            }
            if (gameMode === 'multi') {
                if (spear.playerIndex === myPlayerIndex) {
                    socket.emit('throwComplete', {
                        hitOpponent: false,
                        hitEntity: true,
                        entityIndex: entities.indexOf(hitEntity),
                        hitX,
                        hitY,
                        hitAngle: spearGroup.rotation.z
                    });
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
        // Pauza paytida hech narsani yangilamaymiz, faqat sahnani qayta chizamiz.
        // (Avval bu yerda `dt` e'lon qilinishidan oldin ishlatilib, crash bo'lardi.)
        lastTime = now;
        renderer.render(scene, camera);
        if (isLooping) requestAnimationFrame(gameLoop);
        return;
    }
    let timeScale = 1.0;
    if (!isAnimating && screenShake > 0) timeScale = 0.3;
    if (now < cinematicSlowUntil) timeScale *= 0.23;
    if (now < crowKillerCinematicUntil) timeScale *= 0.35; // Qush o'ldirish cinematic sekinlashtirish

    const dt = ((now - lastTime) / 1000) * timeScale;
    lastTime = now;
    mixers.forEach(m => m.update(dt));

    // Jumping Animation
    for (let ji = 0; ji < jumpStates.length; ji++) {
        const js = jumpStates[ji];
        if (!js || !js.active) continue;
        const jm = modelForPlayer(ji);
        if (!jm) continue;
        if (js.baseY === null || isNaN(js.baseY)) {
            js.baseY = jm.userData.baseY !== undefined ? jm.userData.baseY : jm.position.y;
        }
        const elapsed = now - js.startTime;
        const progress = Math.min(1, elapsed / js.duration);
        const jumpOffset = Math.sin(progress * Math.PI) * js.height;
        jm.position.y = js.baseY + jumpOffset;

        if (progress >= 1) {
            js.active = false;
            jm.position.y = js.baseY;
            jm.userData.isJumping = false;
            spawnParticles(jm.position.x, ground.position.y + 100, 10);
            playSfx('woodHit', 0.4);

            if (ji === myPlayerIndex) {
                myJumpActive = false;
                if (jumpButton) jumpButton.classList.remove('active');
                if (gameMode === 'multi' && socket && socket.connected) {
                    socket.emit('jumpState', { active: false });
                }
            } else if (ji === 1) {
                enemyJumpActive = false;
            } else if (ji === 2) {
                p3JumpActive = false;
            }

            // "sakrash tugab yerga tushganda yana dastlabki 1- holati ya`ni idle holatiga qaytsin"
            const def = isDefenseActiveForPlayer(ji);
            const dck = isDuckActiveForPlayer(ji);
            setSoldierVisual(jm, def ? 'defend' : (dck ? 'duck' : 'idle'));
        }
    }

    // Breathing & Ducking scale/position (yerga kirmaslik va eni cho'zilib ketmasligi)
    const breath = Math.sin(now * 0.002) * 0.005 + 1;
    const activeModels = [p1Model, p2Model];
    if (p3Model) activeModels.push(p3Model);

    activeModels.forEach((mod, idx) => {
        if (!mod || !mod.userData || !mod.userData.torso) return;
        const isDuck = isDuckActiveForPlayer(idx);
        const isDown = mod.userData.isKnockedDown || mod.userData.visualState === 'hurt';

        if (isDown) {
            mod.userData.torso.scale.set(1, 1, 1);
            mod.userData.torso.position.y = 0;
            return;
        }

        if (isDuck) {
            // O'tirganda model sun'iy ravishda kichrayib (kichik bo'lib) qolmasligi uchun
            // o'zining tabiiy mutanosibligini (scale.x: 1.0, scale.y: 1.0) to'liq saqlaydi!
            // Har bir qahramonning o'tirgan chiroyli maxsus teksturasi mavjud.
            mod.userData.torso.scale.x = 1.0;
            mod.userData.torso.scale.y = 1.0;
            mod.userData.torso.position.y = 0;
        } else {
            mod.userData.torso.scale.y = breath;
            mod.userData.torso.scale.x = 1.0;
            mod.userData.torso.position.y = 0;
        }
    });
    p1Model.userData.headGroup.position.y = (isDuckActiveForPlayer(0) ? 36 : 55) + Math.sin(now * 0.002) * 0.3;
    p2Model.userData.headGroup.position.y = (isDuckActiveForPlayer(1) ? 36 : 55) + Math.sin(now * 0.002) * 0.3;
    if (p3Model) p3Model.userData.headGroup.position.y = (isDuckActiveForPlayer(2) ? 36 : 55) + Math.sin(now * 0.002) * 0.3;

    p1Model.userData.armL.rotation.z = Math.sin(now * 0.002) * 0.1;
    p2Model.userData.armL.rotation.z = -Math.sin(now * 0.002) * 0.1;
    if (p3Model) p3Model.userData.armL.rotation.z = -Math.sin(now * 0.002) * 0.1;

    // Dust animation - faqat agar ko'rinadigan bo'lsa
    if (dustSystem && dustSystem.visible) {
        const positions = dustSystem.geometry.attributes.position.array;
        for (let i = 0; i < dustCount * 3; i += 3) {
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
    }

    // Tunda yulduzlar miltillaydi (faqat ko'rinib turganda).
    if (typeof starField !== 'undefined' && starField && starField.visible && starField.material.opacity > 0.01) {
        starField.material.opacity = 0.55 + Math.sin(now * 0.0015) * 0.35;
        starField.rotation.z += 0.00002;
    }
    // Quyosh diski yengilgina "nafas oladi" - tirik atmosfera.
    if (typeof sunSprite !== 'undefined' && sunSprite && sunSprite.material.opacity > 0.2 && sunSprite.userData.baseScale) {
        const pulse = 1 + Math.sin(now * 0.0012) * 0.02;
        sunSprite.scale.set(sunSprite.userData.baseScale * pulse, sunSprite.userData.baseScale * pulse, 1);
    }

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
            if (e.mesh.position.y > 900) e.vy = -Math.abs(e.vy || 30);
            if (e.mesh.position.y < 320) e.vy = Math.abs(e.vy || 30);

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
            // Agar qush nayzaga sanchilib uchayotgan bo'lsa, uni nayza o'zi boshqaradi (ikki marta gravitatsiya bo'lmaydi)
            if (spear && spear.active && spear.hitEntity === e) {
                return;
            }
            e.deathTimer = (e.deathTimer || 0) + dt;
            if (e.mesh.position.y > ground.position.y + 100) {
                e.mesh.position.y -= GRAVITY * dt * 0.5;
                e.mesh.rotation.z += 5 * dt;
            }
        }
    });

    // Qarg'a o'qlarini yangilash
    updateCrowKillerArrows();
    if (typeof updateAirDropCrates === 'function') updateAirDropCrates(dt);

    // Cloud animation
    clouds.forEach(cloud => {
        cloud.position.x += cloud.userData.vx * dt;
        if (cloud.position.x > 3200) cloud.position.x = -3200;
        if (cloud.position.x < -3200) cloud.position.x = 3200;
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
            // Daraxtning faqat tepa qismi shamolda tebranadi, ildizi esa yerda qimirlamay qat'iy turadi
            tree.rotation.z = (d.baseRot || 0) + Math.sin(now * 0.0012 * speed + phase) * amp * depthInfluence;
        }
    }

    // 3D dekorativ jismlar animatsiyasi (tegirmon parraklari, mash'ala olovi)
    if (window._animatedScenery && window._animatedScenery.length) {
        for (let i = 0; i < window._animatedScenery.length; i++) {
            const prop = window._animatedScenery[i];
            if (prop.type === 'rotor' && prop.mesh) {
                const windSpeed = 0.8 + Math.abs(currentWind) * 0.18;
                prop.mesh.rotation.z += dt * windSpeed * (prop.dir || 1);
            } else if (prop.type === 'flicker' && prop.light) {
                prop.light.intensity = prop.baseIntensity + (Math.random() - 0.5) * 0.35;
            }
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

        // Olov zarralari: ko'tarilib so'nadi (yerga yopishmaydi).
        if (p.userData.isFire) {
            p.userData.vy -= GRAVITY * 0.7 * dt; // olov yengilroq, sekin tushadi
            const lifeRatio = Math.max(0, Math.min(1, p.userData.life / 1.4));
            if (p.material) p.material.opacity = lifeRatio;
            const s = 0.6 + lifeRatio * 0.8;
            p.scale.set(s, s, s);
            if (p.userData.life <= 0) {
                scene.remove(p);
                if (p.material) p.material.dispose();
                bloodParticles.splice(i, 1);
            }
            continue;
        }

        if (p.position.y < ground.position.y + 100) {
            p.position.y = ground.position.y + 100;
            p.userData.vy = 0;
            p.userData.vx = 0;
            p.userData.vz = 0;
            if (!p.userData.isWood) p.scale.set(1.5, 0.2, 1.5);
        }

        if (p.userData.life <= 0) {
            scene.remove(p);
            bloodParticles.splice(i, 1);
        }
    }

    if (isAnimating && spear && spear.active) {
        spear.prevX = spear.x;
        spear.prevY = spear.y;
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

            // Damped vertical altitude tracking:
            // Nayza qanchalik baland uchmasin, o'yin maydoni va ufq doimo ko'rinib turadi
            const groundSurfaceY = ground.position.y + 100;
            const spearAltitude = Math.max(0, spear.y - groundSurfaceY);
            const camFocus = getFocusCameraTarget(currentTurnIndex >= 0 ? currentTurnIndex : myPlayerIndex);
            cameraTargetY = Math.max(camFocus.y, Math.min(camFocus.y + spearAltitude * 0.52, 1450));

            // Dinamik masshtab: o'q uzilganda kamera yaqinlashib (zoom bo'lib) o'q bilan birga boradi
            cameraZoomTarget = baseZoom * 1.35;
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
        updateSpearTrail();
    } else {
        updateSpearTrail();
    }

    if (secondarySpear && secondarySpear.active) {
        secondarySpear.prevX = secondarySpear.x;
        secondarySpear.prevY = secondarySpear.y;
        secondarySpear.x += secondarySpear.vx * dt;
        secondarySpear.y += secondarySpear.vy * dt;
        secondarySpear.vy -= GRAVITY * dt;
        secondarySpear.vx += (currentWind * 30) * dt;
        secondarySpearGroup.position.set(secondarySpear.x, secondarySpear.y, 0);
        secondarySpearGroup.rotation.z = Math.atan2(secondarySpear.vy, secondarySpear.vx);
        checkSecondarySpearCollision();
        if (secondarySpear.active && (secondarySpear.y <= ground.position.y + 100 || secondarySpear.x < -4200 || secondarySpear.x > 4200)) {
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
        // 'recover', 'target' yoki 'normal' holatida kamera maqsadga yetgach 'static' ga o'tadi.
        if (cameraState === 'recover' || cameraState === 'target' || cameraState === 'normal') {
            const dx = Math.abs(camera.position.x - cameraTargetX);
            const dy = Math.abs(camera.position.y - cameraTargetY);
            if (dx < 3 && dy < 3) {
                cameraState = 'static';
            }
        }
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

        if (isJumpActiveForPlayer(idx)) {
            targetState = 'jump';
        } else if (isDuckActiveForPlayer(idx)) {
            targetState = 'duck';
        } else if (isDefenseActiveForPlayer(idx)) {
            targetState = 'defend';
        } else if (isAnimating) {
            // Is animating (spear thrown)
            if ((spear && spear.playerIndex === idx) || idx === currentTurnIndex || idx === (currentTurnIndex === -1 && spear ? spear.playerIndex : -1)) {
                targetState = 'afterShot';
            }
        } else if (remoteAimStates[idx] && remoteAimStates[idx].isAiming && currentTurnIndex === idx) {
            // Raqib onlaynda mo'ljal olayotganda uning tortish animatsiyasi real-time ko'rinadi
            const rDist = remoteAimStates[idx].dist || 0;
            targetState = (rDist > 50) ? 'aim' : (rDist > 10 ? 'load' : 'aim');
        } else if (isDragging && currentTurnIndex === idx) {
            // Dragging
            const dx = dragStart.x - dragCurrent.x;
            const dy = dragCurrent.y - dragStart.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (isArtilleryAiming) {
                targetState = 'idle';
            } else if (dist > 50) {
                targetState = 'aim';
            } else if (dist > 10) {
                targetState = 'load';
            }

            // Aiming zoom logic: kamon tortayotganda
            if (cameraState === 'static' || cameraState === 'aiming' || cameraState === 'recover' || cameraState === 'normal') {
                cameraState = 'aiming';
                const isPortrait = isPortraitMode();
                const camFocus = getFocusCameraTarget(currentTurnIndex >= 0 ? currentTurnIndex : myPlayerIndex);
                if (isPortrait) {
                    cameraTargetX = model.position.x + (idx === 0 ? 60 : -60);
                    cameraTargetY = model.position.y + 240;
                    cameraZoomTarget = Math.min(baseZoom * 1.35, 0.65);
                } else {
                    // Albom (landshaft) rejimida o'yinchi ekranning markaziga surilmaydi!
                    // O'yinchi o'z tomonida turadi, raqib va mo'ljal to'liq ko'rinadi va tepada ball/daraja bloki o'yinchini to'smaydi.
                    // O'yinchining oyoqlari pastki tugmalar ustida turadi.
                    cameraTargetX = camFocus.x;
                    cameraTargetY = camFocus.y;
                    cameraZoomTarget = camFocus.zoom;
                }
                if (hud) hud.style.opacity = isPortrait ? '0.35' : '0.65';
            }
        } else if (!isDragging && cameraState === 'aiming') {
            // Revert back when stopped aiming: yana butun maydon va raqib ko'rinadigan umumiy ko'rinishga qaytish
            cameraState = 'recover';
            const camFocus = getFocusCameraTarget(currentTurnIndex >= 0 ? currentTurnIndex : myPlayerIndex);
            cameraTargetX = camFocus.x;
            cameraTargetY = camFocus.y;
            cameraZoomTarget = camFocus.zoom;
            if (hud) hud.style.opacity = '1';
        }

        setSoldierVisual(model, targetState);
    });

    if (isDragging && currentTurnIndex === myPlayerIndex) {
        const isRight = isPlayerOnRightSide(myPlayerIndex);
        const aim = getAimParameters(dragStart, dragCurrent, isRight);

        if (aim) {
            const { angle, power } = aim;
            const thrower = modelForPlayer(myPlayerIndex);
            let startX = thrower ? (thrower.position.x + (isRight ? -60 : 60)) : (myPlayerIndex === 0 ? p1Model.position.x + 60 : p2Model.position.x - 60);
            let startY = (thrower ? thrower.position.y : p1Model.position.y) + 270;

            if (isArtilleryAiming) {
                startX = (thrower ? thrower.position.x : 0) + (isRight ? -570 : 570);
                startY = (thrower ? thrower.position.y : 0) + 175;
            }

            let simX = startX;
            let simY = startY;

            const rad = angle * (Math.PI / 180);
            let simVx = power * Math.cos(rad);
            if (isRight) simVx = -simVx;
            let simVy = power * Math.sin(rad);

            const allPoints = [];
            for (let i = 0; i < 110; i++) {
                allPoints.push(new THREE.Vector3(simX, simY, 0));
                simX += simVx * 0.05;
                simY += simVy * 0.05;
                simVy -= GRAVITY * 0.05;
                simVx += (currentWind * 30) * 0.05;
                if (simY < ground.position.y + 100) break;
            }
            // Trayektoriya to'liq ko'rsatilmasin, faqat yo'nalish uchun yarimgacha (45%) ko'rsatilsin
            const halfCount = Math.max(5, Math.min(32, Math.floor(allPoints.length * 0.45)));
            const points = allPoints.slice(0, halfCount);

            const geo = new THREE.BufferGeometry().setFromPoints(points);
            const mat = new THREE.LineDashedMaterial({ color: 0xff2d2d, dashSize: 30, gapSize: 15, linewidth: 3 });
            trajectoryLine = new THREE.Line(geo, mat);
            trajectoryLine.computeLineDistances();
            scene.add(trajectoryLine);

            // 3D Usmoniy Kamonni mo'ljal olayotganda qo'lga keltirish va ipini tortish
            const myWeapon = getPlayerWeaponType(myPlayerIndex);
            if (typeof active3DBow !== 'undefined' && active3DBow) {
                if (myWeapon === 'arrow' && !isArtilleryAiming) {
                    active3DBow.visible = true;
                    active3DBow.position.set(startX, startY, 15);
                    const bowRotAngle = isRight ? (Math.PI - rad) : rad;
                    active3DBow.rotation.z = bowRotAngle;
                    if (isRight) {
                        active3DBow.scale.set(1.4, -1.4, 1.4);
                    } else {
                        active3DBow.scale.set(1.4, 1.4, 1.4);
                    }
                    if (active3DBow.userData && active3DBow.userData.stringMesh) {
                        const pullDist = Math.min(22, (power / 1000) * 18);
                        const posAttr = active3DBow.userData.stringMesh.geometry.attributes.position;
                        posAttr.setXYZ(1, -pullDist, 0, 0);
                        posAttr.needsUpdate = true;
                    }
                } else {
                    active3DBow.visible = false;
                }
            }

            if (!aimSfxPlayed) {
                playSfx('aim');
                aimSfxPlayed = true;
            }
        }
    } else {
        if (typeof active3DBow !== 'undefined' && active3DBow) active3DBow.visible = false;
    }

    // Onlayn raqibning 3D Usmoniy Kamonini real-time ko'rsatish va uning burchak/ipini harakatlantirish
    if (typeof opponent3DBow !== 'undefined' && opponent3DBow) {
        const oppIdx = myPlayerIndex === 0 ? 1 : 0;
        const oppAim = remoteAimStates[oppIdx];
        const oppModel = modelForPlayer(oppIdx);
        if (oppModel && oppAim && oppAim.isAiming && currentTurnIndex === oppIdx && !isAnimating) {
            const oppIsRight = isPlayerOnRightSide(oppIdx);
            const startX = oppModel.position.x + (oppIsRight ? -60 : 60);
            const startY = oppModel.position.y + 270;
            opponent3DBow.visible = true;
            opponent3DBow.position.set(startX, startY, 15);
            const rad = (oppAim.angle || 0) * (Math.PI / 180);
            const bowRotAngle = oppIsRight ? (Math.PI - rad) : rad;
            opponent3DBow.rotation.z = bowRotAngle;
            if (oppIsRight) {
                opponent3DBow.scale.set(1.4, -1.4, 1.4);
            } else {
                opponent3DBow.scale.set(1.4, 1.4, 1.4);
            }
            if (opponent3DBow.userData && opponent3DBow.userData.stringMesh) {
                const pullDist = Math.min(22, ((oppAim.dist || 0) / 100) * 18);
                const posAttr = opponent3DBow.userData.stringMesh.geometry.attributes.position;
                posAttr.setXYZ(1, -pullDist, 0, 0);
                posAttr.needsUpdate = true;
            }
        } else {
            opponent3DBow.visible = false;
        }
    }


    if (window.explosions) {
        for (let i = window.explosions.length - 1; i >= 0; i--) {
            const expl = window.explosions[i];
            expl.userData.age += dt;
            const posAttr = expl.geometry.attributes.position;
            const mat = expl.material;

            for (let j = 0; j < expl.userData.vels.length; j++) {
                posAttr.array[j * 3] += expl.userData.vels[j].vx * dt;
                posAttr.array[j * 3 + 1] += expl.userData.vels[j].vy * dt;
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

    renderer.render(scene, camera);
    if (isLooping) requestAnimationFrame(gameLoop);
}


// Menyu ortida 3D sahna ko'rinib tursin uchun bir martalik boshlang'ich render.
// (Avval bu yerda gameLoop'dan tashqarida `dt` ishlatadigan yetim "dead code"
//  bor edi; u runtime xatosiga olib kelishi mumkin edi - olib tashlandi.)
try {
    buildMap('field', 'sunny');
    camera.position.set(0, 60, 1000);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
} catch (_) { }

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
let authPhone = localStorage.getItem('nayza_auth_phone') || '';

function getPendingUrlDuelOrRoom() {
    try {
        let duelRoom = null;
        let inviteId = null;
        let roomCode = null;
        let view = null;

        if (window.location.search) {
            const sp = new URLSearchParams(window.location.search);
            duelRoom = sp.get('duel_room');
            inviteId = sp.get('invite_id');
            roomCode = sp.get('room') || sp.get('code') || sp.get('join');
            view = sp.get('view');
            const startapp = sp.get('startapp') || sp.get('tgWebAppStartParam');
            if (startapp) {
                if (startapp.startsWith('duel_')) {
                    const parts = startapp.slice(5).split('_');
                    duelRoom = parts[0];
                    if (parts[1]) inviteId = parts[1];
                } else {
                    roomCode = startapp;
                }
            }
        }

        if (window.location.hash) {
            const hp = new URLSearchParams(window.location.hash.replace(/^#/, ''));
            if (!duelRoom) duelRoom = hp.get('duel_room');
            if (!inviteId) inviteId = hp.get('invite_id');
            if (!roomCode) roomCode = hp.get('room') || hp.get('code') || hp.get('join');
            if (!view) view = hp.get('view');
            const startapp = hp.get('tgWebAppStartParam') || hp.get('startapp');
            if (startapp) {
                if (startapp.startsWith('duel_')) {
                    const parts = startapp.slice(5).split('_');
                    if (!duelRoom) duelRoom = parts[0];
                    if (parts[1] && !inviteId) inviteId = parts[1];
                } else if (!roomCode) {
                    roomCode = startapp;
                }
            }
        }

        if (window.Telegram?.WebApp?.initDataUnsafe?.start_param) {
            const param = window.Telegram.WebApp.initDataUnsafe.start_param;
            if (param.startsWith('duel_')) {
                const parts = param.slice(5).split('_');
                if (!duelRoom) duelRoom = parts[0];
                if (parts[1] && !inviteId) inviteId = parts[1];
            } else if (!roomCode) {
                roomCode = param;
            }
        }

        return { duelRoom, inviteId, roomCode, view };
    } catch (_) {
        return {};
    }
}

function isUrlDuelOrRoomJoin() {
    const info = getPendingUrlDuelOrRoom();
    return Boolean(info.duelRoom || info.roomCode || info.view === 'invites');
}

function shouldShowMainMenuOnAuth() {
    if (gameMode === 'multi' || gameMode === 'single') return false;
    if (Boolean(window.autoJoinExecuted || autoJoinExecuted)) return false;
    if (typeof gameScreen !== 'undefined' && gameScreen && !gameScreen.classList.contains('hidden')) return false;
    if (typeof waitingScreen !== 'undefined' && waitingScreen && !waitingScreen.classList.contains('hidden')) return false;
    if (typeof isUrlDuelOrRoomJoin === 'function' && isUrlDuelOrRoomJoin()) return false;
    if (typeof getPendingRoomCode === 'function' && getPendingRoomCode()) return false;
    return true;
}

async function autoLoginTelegramUser() {
    const tgUser = tg?.initDataUnsafe?.user;
    if (!tgUser || !tgUser.id) return false;

    // Telegram orqali ochilgan bo'lsa darhol auth modalni yashiramiz
    if (authModal) authModal.classList.add('hidden');
    if (shouldShowMainMenuOnAuth()) {
        if (menuScreen) {
            menuScreen.style.removeProperty('display');
            menuScreen.classList.remove('hidden');
        }
    }

    const tgName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || tgUser.username || 'Jangchi';
    const tgPhone = 'tg_' + tgUser.id;
    authPhone = tgPhone;
    myProfile.phone = tgPhone;
    if (tgName && (!myProfile.name || myProfile.name === 'Player' || myProfile.name === "Noma'lum")) {
        myProfile.name = tgName;
    }
    localStorage.setItem('nayza_auth_phone', authPhone);
    saveProfile();

    try {
        const clientProgress = {
            score: Number(myStats.score || 0),
            wins: Number(myStats.wins || 0),
            games: Number(myStats.games || 0),
            campaignLevel: Number(localStorage.getItem('nayza_single_level') || singleCampaignLevel || 1),
            superPowers: Number(myProfile.superPowers || 0),
            doubleSpears: Number(myProfile.doubleSpears || 0),
            walls: Number(myProfile.walls || 0)
        };
        const res = await fetch(`${API_BASE}/api/auth/telegram`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: tgUser, clientProgress })
        });
        const data = await res.json().catch(() => ({}));
        if (data && data.ok && data.user) {
            applyAuthedUser(data.user);
            console.log('[Telegram Auth] Avtomatik login bajarildi:', data.user.name, 'Ball:', myStats.score);
            return true;
        }
    } catch (err) {
        console.warn('[Telegram Auth] API xatosi, lokal profil qo\'llanadi:', err);
    }
    return true;
}

// Telegram WebApp orqali kirgan o'yinchini avtomatik tanib olish va login qilish
try {
    const tgUser = tg?.initDataUnsafe?.user;
    if (tgUser) {
        authPhone = 'tg_' + tgUser.id;
        localStorage.setItem('nayza_auth_phone', authPhone);
        const tgName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || tgUser.username;
        if (tgName && (!myProfile.name || myProfile.name === 'Player' || myProfile.name === "Noma'lum")) {
            myProfile.name = tgName;
            localStorage.setItem('nayza_profile', JSON.stringify(myProfile));
        }
        autoLoginTelegramUser();
    }
} catch (e) {
    console.warn('Telegram auto-profile error:', e);
}

function isUserLoggedIn() {
    return Boolean(authPhone && (String(authPhone).replace(/\D/g, '').length >= 7 || String(authPhone).startsWith('tg_')));
}
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
    const userPhoneStr = String(user.phone || '');
    myProfile.phone = userPhoneStr.startsWith('tg_') ? userPhoneStr : userPhoneStr.replace(/\D/g, '').slice(-15);
    myProfile.age = Math.max(7, Math.min(99, Number(user.age) || 18));
    
    // O'yinchining to'plagan ballari va progressi: har safar yangidan 500 bo'lib qolmasligi uchun lokal va serverdagi eng kattasini olamiz
    const localScore = Number(myStats.score || 0);
    const serverScore = Number.isFinite(Number(user.score)) ? Number(user.score) : 0;
    myStats.score = Math.max(localScore, serverScore);
    myProfile.score = myStats.score;

    const localWins = Number(myStats.wins || 0);
    const serverWins = Number.isFinite(Number(user.wins)) ? Number(user.wins) : 0;
    myStats.wins = Math.max(localWins, serverWins);

    const localGames = Number(myStats.games || 0);
    const serverGames = Number.isFinite(Number(user.games)) ? Number(user.games) : 0;
    myStats.games = Math.max(localGames, serverGames);

    if (user.photoUrl) myProfile.photoUrl = user.photoUrl;
    if (Number.isFinite(Number(user.losses))) myStats.losses = Math.max(Number(myStats.losses || 0), Number(user.losses));
    if (Number.isFinite(Number(user.forfeits))) myStats.forfeits = Math.max(Number(myStats.forfeits || 0), Number(user.forfeits));
    if (Array.isArray(user.friends)) myFriends = user.friends;
    if (Number.isFinite(Number(user.superPowers))) myProfile.superPowers = Math.max(Number(myProfile.superPowers || 0), Number(user.superPowers));
    if (Number.isFinite(Number(user.doubleSpears))) myProfile.doubleSpears = Math.max(Number(myProfile.doubleSpears || 0), Number(user.doubleSpears));
    if (Number.isFinite(Number(user.walls))) myProfile.walls = Math.max(Number(myProfile.walls || 0), Number(user.walls));
    if (Number.isFinite(Number(user.artillery))) myProfile.artillery = Math.max(Number(myProfile.artillery || 0), Number(user.artillery));
    if (Number.isFinite(Number(user.crowhunt))) myProfile.crowhunt = Math.max(Number(myProfile.crowhunt || 0), Number(user.crowhunt));
    if (Number.isFinite(Number(user.fireSpears))) myProfile.fireSpears = Math.max(Number(myProfile.fireSpears || 0), Number(user.fireSpears));
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
    if (shouldShowMainMenuOnAuth()) {
        if (menuScreen) {
            menuScreen.style.removeProperty('display');
            menuScreen.classList.remove('hidden');
        }
    }
    updateCampaignUI();
}

function normalizePhone(value) {
    const str = String(value || '').trim();
    if (str.startsWith('tg_')) return str;
    const digits = str.replace(/\D/g, '');
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
            openCharacterSelectModal({
                onConfirm: () => {
                    const options = {
                        map: document.getElementById('select-map') ? document.getElementById('select-map').value : 'field',
                        weather: selectWeather ? selectWeather.value : 'sunny',
                        birds: true, // Do'st chaqirishda qushlarni doim yoqish
                        birdCount: 20, // 20 ta qush
                        animals: false,
                        charType: myProfile.charType
                    };
                    socket.emit('inviteFriend', { toPlayerId, profile: myProfile, options });
                },
                onCancel: () => {
                    if (multiMenu) multiMenu.classList.remove('hidden');
                }
            });
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
    const hasGames = Number(myStats.games || 0) > 0;
    // Faqat yangi kirgan (0 o'yin va 0 ball) o'yinchiga boshlang'ich 500 ball beriladi.
    // Eski to'plangan ballar va o'yinlar aslo 500 ga qayta tushib qolmaydi!
    if (currentScore >= 500 || hasGames) {
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
        subtitle: "Jang rejimini tanlang",
        stageLabel: "Kampaniya",
        scoreLabel: "Ball",
        tierBronze: "🥉 Bronza",
        tierSilver: "🥈 Kumush",
        tierGold: "🥇 Oltin",
        tierDiamond: "💎 Olmos",
        tierLegend: "👑 Afsona",
        topInvites: "⚔️ Takliflar",
        topProfile: "👤 Profil",
        topSettings: "⚙️ Sozlamalar",
        topLogout: "🚪 Chiqish",

        // Carousel Cardlari
        cardSingleBadge: "⚔️ 100+ BOSQICH",
        cardSingleName: "Kampaniya",
        cardSingleDesc: "100 ta qiziqarli bosqich va qudratli sarkardalar bilan jang",
        cardSingleBtn: "Yakkalik o'yin",

        cardMultiBadge: "⚡ 1v1 JONLI",
        cardMultiName: "Onlayn Duel",
        cardMultiDesc: "Haqiqiy raqiblar va do'stlar bilan jonli nayza jangi",
        cardMultiBtn: "Onlayn o'yin",

        cardInvitesBadge: "⚔️ TAKLIFLAR",
        cardInvitesName: "Duelga Takliflar",
        cardInvitesDesc: "Kelgan takliflarni qabul qiling va jang vaqtini belgilang",
        cardInvitesBtn: "Takliflar ro'yxati",

        cardRewardsBadge: "🎁 BEPUL BONUS",
        cardRewardsName: "Kunlik Sovg'alar",
        cardRewardsDesc: "Har kuni kiring va bepul super kuchlar va resurslarni oling",
        cardRewardsBtn: "Sovg'ani olish",

        cardQuestsBadge: "🎯 KVESTLAR",
        cardQuestsName: "Vazifalar",
        cardQuestsDesc: "Topshiriqlarni bajaring va qo'shimcha ballar to'plang",
        cardQuestsBtn: "Vazifalar",

        cardShopBadge: "🛒 ARSENAL",
        cardShopName: "Harbiy Do'kon",
        cardShopDesc: "Super himoya, nayzalar va maxsus jangovar vositalar",
        cardShopBtn: "Do'kon",

        cardRatingBadge: "🏆 TOP-100",
        cardRatingName: "Reyting",
        cardRatingDesc: "Yetakchi kamonbozlar safiga kiring va chempionlikka erishing",
        cardRatingBtn: "Reyting",

        cardAboutBadge: "ℹ️ MA'LUMOT",
        cardAboutName: "O'yin Haqida",
        cardAboutDesc: "Qoidalar, muallif haqida va loyihani qo'llab-quvvatlash",
        cardAboutBtn: "O'yin haqida",

        // O'yin ichi (In-Game HUD)
        inGameMenu: "Menyu",
        inGameBack: "⬅ Ortga",
        wind: "SHAMOL",
        pause: "Pauza",
        resume: "O'yinga qaytish",
        sound: "Sozlamalar(ovoz)",
        addFriend: "Do'stga qo'shish",
        mainMenu: "Asosiy Menyu",
        yourTurn: "Sizning navbatingiz!",
        oppTurn: "Raqib navbati",
        waiting: "Kutilyapti...",
        win: "Siz Yutdingiz! 🏆",
        lose: "Yutqazdingiz! 💀",
        playAgainBtn: "Yana o'ynash",
        menuBtn: "Bosh menyu",
        rematchBtn: "⚔️ Revansh taklif qilish",
        viewRatingBtn: "🏆 Reytingni ko'rish",
        opponentLeft: "Raqib o'yinni tark etdi",

        // Sozlamalar modali
        settingsTitle: "Sozlamalar",
        langLabel: "Dastur tili:",
        musicVol: "Fon musiqa balandligi:",
        sfxVol: "Maxsus effektlar (SFX) balandligi:",
        musicTrack: "Fon musiqasi:",
        helpBtn: "Yordam",
        save: "Saqlash",
        close: "Yopish",
        settingsSaved: "Sozlamalar saqlandi!",

        // Profil
        profileTitle: "Profil",
        nameLabel: "Ism:",
        avatarLabel: "Avatar (Rasm):",
        charLabel: "Qahramon:",
        flagLabel: "Mamlakat bayrog'i:",
        spearLabel: "Nayza modeli:",

        // Yakkalik & Level modallari
        singleModalTitle: "Yakkalik o'yin",
        chooseMode: "Tanlang:",
        continueLevel: "Avvalgi levelni davom etish",
        selectLevel: "Level tanlash",
        newGame: "Yangi o'yin boshlash",
        cancel: "Bekor qilish",
        levelSelectTitle: "Level tanlash",
        levelLabel: "Daraja",
        campaignStage: "Kampaniya bosqichi",
        resetCampaign: "Kampaniyani qayta boshlash",

        // Onlayn multiplayer modal
        multiModalTitle: "Onlayn O'yin",
        createGame: "O'yin yaratish",
        giveCodeToFriend: "Do'stingizga shu kodni bering:",
        inviteViaTg: "📲 Telegramda do'stni chaqirish",
        joinGame: "O'yinga qo'shilish",
        enterCode: "KOD",
        joinBtn: "Qo'shilish",
        gameNotFound: "O'yin topilmadi!",
        randomOpponent: "Tasodifiy raqib",
        friendsTitle: "Do'stlar",
        refreshBtn: "Yangilash",
        noFriends: "Do'stlar yo'q.",
        backBtn: "Orqaga",

        // Qahramon tanlash
        charSelectTitle: "Qahramoningizni tanlang",
        charSelectSub: "Jangga kirishdan oldin jangchi modelini tanlang",
        enterBattle: "⚔️ Jangga kirish",
        selectedBadge: "Tanlangan",

        // O'yin sozlamalari (Options)
        optionsTitle: "O'yin Sozlamalari",
        mapLabel: "Maydon (Xarita):",
        weatherLabel: "Ob-havo:",
        birdsLabel: "Havoda Uchuvchi Qushlar (To'siq)",
        animalsLabel: "O'tlab yuruvchi hayvonlar",
        difficultyLabel: "Qiyinlik:",
        optionCharLabel: "Jangchi modeli:",
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

        // Til tanlash modali
        langModalTitle: "Tilni tanlang",
        langModalSub: "Davom etish uchun o'yin tilini tanlang",
        langSelectBtn: "Tanlash",
        welcomeToast: "🇺🇿 O'zbek tili tanlandi! Xush kelibsiz!"
    },

    ru: {
        title: "Битва Копий",
        subtitle: "Выберите режим боя",
        stageLabel: "Кампания",
        scoreLabel: "Очки",
        tierBronze: "🥉 Бронза",
        tierSilver: "🥈 Серебро",
        tierGold: "🥇 Золото",
        tierDiamond: "💎 Алмаз",
        tierLegend: "👑 Легенда",
        topInvites: "⚔️ Приглашения",
        topProfile: "👤 Профиль",
        topSettings: "⚙️ Настройки",
        topLogout: "🚪 Выход",

        cardSingleBadge: "⚔️ 100+ ЭТАПОВ",
        cardSingleName: "Кампания",
        cardSingleDesc: "100 захватывающих уровней и битвы с боссами",
        cardSingleBtn: "Одиночная игра",

        cardMultiBadge: "⚡ 1v1 ОНЛАЙН",
        cardMultiName: "Онлайн Дуэль",
        cardMultiDesc: "Сражайтесь онлайн с реальными соперниками и друзьями",
        cardMultiBtn: "Онлайн игра",

        cardInvitesBadge: "⚔️ ПРИГЛАШЕНИЯ",
        cardInvitesName: "Приглашения на Дуэль",
        cardInvitesDesc: "Принимайте вызовы и назначайте время боя",
        cardInvitesBtn: "Список приглашений",

        cardRewardsBadge: "🎁 БЕСПЛАТНЫЙ БОНУС",
        cardRewardsName: "Ежедневные Награды",
        cardRewardsDesc: "Заходите каждый день и получайте бесплатные бонусы",
        cardRewardsBtn: "Забрать награду",

        cardQuestsBadge: "🎯 КВЕСТЫ",
        cardQuestsName: "Задания",
        cardQuestsDesc: "Выполняйте задания и зарабатывайте очки",
        cardQuestsBtn: "Задания",

        cardShopBadge: "🛒 АРСЕНАЛ",
        cardShopName: "Оружейная",
        cardShopDesc: "Супер щиты, копья и боевая экипировка",
        cardShopBtn: "Магазин",

        cardRatingBadge: "🏆 ТОП-100",
        cardRatingName: "Рейтинг",
        cardRatingDesc: "Войдите в число лучших копейщиков и завоюйте чемпионство",
        cardRatingBtn: "Рейтинг",

        cardAboutBadge: "ℹ️ ИНФОРМАЦИЯ",
        cardAboutName: "Об Игре",
        cardAboutDesc: "Правила, контакты автора и информация о проекте",
        cardAboutBtn: "Об игре",

        inGameMenu: "Меню",
        inGameBack: "⬅ Назад",
        wind: "ВЕТЕР",
        pause: "Пауза",
        resume: "Продолжить",
        sound: "Звук",
        addFriend: "Добавить в друзья",
        mainMenu: "Главное меню",
        yourTurn: "Ваш ход!",
        oppTurn: "Ход противника",
        waiting: "Ожидание...",
        win: "Вы победили! 🏆",
        lose: "Вы проиграли! 💀",
        playAgainBtn: "Играть снова",
        menuBtn: "Главное меню",
        rematchBtn: "⚔️ Реванш",
        viewRatingBtn: "🏆 Рейтинг",
        opponentLeft: "Противник покинул игру",

        settingsTitle: "Настройки",
        langLabel: "Язык приложения:",
        musicVol: "Громкость музыки:",
        sfxVol: "Громкость спецэффектов (SFX):",
        musicTrack: "Фоновая музыка:",
        helpBtn: "Помощь",
        save: "Сохранить",
        close: "Закрыть",
        settingsSaved: "Настройки сохранены!",

        profileTitle: "Профиль",
        nameLabel: "Имя:",
        avatarLabel: "Аватар:",
        charLabel: "Герой:",
        flagLabel: "Флаг страны:",
        spearLabel: "Модель копья:",

        singleModalTitle: "Одиночная игра",
        chooseMode: "Выберите:",
        continueLevel: "Продолжить текущий уровень",
        selectLevel: "Выбор уровня",
        newGame: "Начать новую игру",
        cancel: "Отмена",
        levelSelectTitle: "Выбор уровня",
        levelLabel: "Уровень",
        campaignStage: "Этап кампании",
        resetCampaign: "Сбросить кампанию",

        multiModalTitle: "Онлайн Игра",
        createGame: "Создать игру",
        giveCodeToFriend: "Передайте этот код другу:",
        inviteViaTg: "📲 Позвать друга в Telegram",
        joinGame: "Присоединиться",
        enterCode: "КОД",
        joinBtn: "Войти",
        gameNotFound: "Игра не найдена!",
        randomOpponent: "Случайный соперник",
        friendsTitle: "Друзья",
        refreshBtn: "Обновить",
        noFriends: "Нет друзей.",
        backBtn: "Назад",

        charSelectTitle: "Выберите героя",
        charSelectSub: "Выберите модель воина перед боем",
        enterBattle: "⚔️ В бой",
        selectedBadge: "Выбран",

        optionsTitle: "Настройки игры",
        mapLabel: "Карта:",
        weatherLabel: "Погода:",
        birdsLabel: "Летающие птицы (препятствие)",
        animalsLabel: "Пасущиеся животные",
        difficultyLabel: "Сложность:",
        optionCharLabel: "Модель воина:",
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

        langModalTitle: "Выберите язык",
        langModalSub: "Выберите язык для продолжения игры",
        langSelectBtn: "Выбрать",
        welcomeToast: "🇷🇺 Русский язык выбран! Добро пожаловать!"
    },

    en: {
        title: "Spear Clash",
        subtitle: "Choose game mode",
        stageLabel: "Campaign",
        scoreLabel: "Score",
        tierBronze: "🥉 Bronze",
        tierSilver: "🥈 Silver",
        tierGold: "🥇 Gold",
        tierDiamond: "💎 Diamond",
        tierLegend: "👑 Legend",
        topInvites: "⚔️ Invites",
        topProfile: "👤 Profile",
        topSettings: "⚙️ Settings",
        topLogout: "🚪 Logout",

        cardSingleBadge: "⚔️ 100+ STAGES",
        cardSingleName: "Campaign",
        cardSingleDesc: "100 exciting stages and epic boss battles",
        cardSingleBtn: "Singleplayer",

        cardMultiBadge: "⚡ 1v1 LIVE",
        cardMultiName: "Online Duel",
        cardMultiDesc: "Real-time spear battles with friends and players",
        cardMultiBtn: "Online Play",

        cardInvitesBadge: "⚔️ INVITES",
        cardInvitesName: "Duel Invites",
        cardInvitesDesc: "Accept challenges and schedule match times",
        cardInvitesBtn: "View Invites",

        cardRewardsBadge: "🎁 FREE BONUS",
        cardRewardsName: "Daily Rewards",
        cardRewardsDesc: "Claim free super powers and rewards every day",
        cardRewardsBtn: "Claim Reward",

        cardQuestsBadge: "🎯 QUESTS",
        cardQuestsName: "Daily Quests",
        cardQuestsDesc: "Complete quests to earn bonus points and XP",
        cardQuestsBtn: "Quests",

        cardShopBadge: "🛒 ARSENAL",
        cardShopName: "Armory Shop",
        cardShopDesc: "Super shields, spears and special battle gear",
        cardShopBtn: "Shop",

        cardRatingBadge: "🏆 TOP-100",
        cardRatingName: "Leaderboard",
        cardRatingDesc: "Join the top spearmen and claim the championship",
        cardRatingBtn: "Leaderboard",

        cardAboutBadge: "ℹ️ INFO",
        cardAboutName: "About Game",
        cardAboutDesc: "Rules, developer contacts and project details",
        cardAboutBtn: "About",

        inGameMenu: "Menu",
        inGameBack: "⬅ Back",
        wind: "WIND",
        pause: "Pause",
        resume: "Resume",
        sound: "Sound",
        addFriend: "Add Friend",
        mainMenu: "Main Menu",
        yourTurn: "Your turn!",
        oppTurn: "Opponent's turn",
        waiting: "Waiting...",
        win: "You Win! 🏆",
        lose: "You Lose! 💀",
        playAgainBtn: "Play Again",
        menuBtn: "Main Menu",
        rematchBtn: "⚔️ Request Rematch",
        viewRatingBtn: "🏆 View Rating",
        opponentLeft: "Opponent left the match",

        settingsTitle: "Settings",
        langLabel: "App language:",
        musicVol: "Background music volume:",
        sfxVol: "Sound effects (SFX) volume:",
        musicTrack: "Background music:",
        helpBtn: "Help",
        save: "Save",
        close: "Close",
        settingsSaved: "Settings saved!",

        profileTitle: "Profile",
        nameLabel: "Name:",
        avatarLabel: "Avatar:",
        charLabel: "Hero:",
        flagLabel: "Country flag:",
        spearLabel: "Spear model:",

        singleModalTitle: "Singleplayer",
        chooseMode: "Choose:",
        continueLevel: "Continue current level",
        selectLevel: "Select Level",
        newGame: "Start new game",
        cancel: "Cancel",
        levelSelectTitle: "Select Level",
        levelLabel: "Level",
        campaignStage: "Campaign stage",
        resetCampaign: "Reset campaign",

        multiModalTitle: "Online Game",
        createGame: "Create Game",
        giveCodeToFriend: "Give this code to a friend:",
        inviteViaTg: "📲 Invite via Telegram",
        joinGame: "Join Game",
        enterCode: "CODE",
        joinBtn: "Join",
        gameNotFound: "Game not found!",
        randomOpponent: "Random Opponent",
        friendsTitle: "Friends",
        refreshBtn: "Refresh",
        noFriends: "No friends yet.",
        backBtn: "Back",

        charSelectTitle: "Choose Your Hero",
        charSelectSub: "Select warrior model before battle",
        enterBattle: "⚔️ Enter Battle",
        selectedBadge: "Selected",

        optionsTitle: "Game Options",
        mapLabel: "Map:",
        weatherLabel: "Weather:",
        birdsLabel: "Flying birds (obstacle)",
        animalsLabel: "Grazing animals",
        difficultyLabel: "Difficulty:",
        optionCharLabel: "Warrior model:",
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

        langModalTitle: "Choose Language",
        langModalSub: "Select your preferred language to continue",
        langSelectBtn: "Select",
        welcomeToast: "🇬🇧 English language selected! Welcome!"
    },

    tr: {
        title: "Mızrak Savaşı",
        subtitle: "Savaş modunu seçin",
        stageLabel: "Sefer",
        scoreLabel: "Puan",
        tierBronze: "🥉 Bronz",
        tierSilver: "🥈 Gümüş",
        tierGold: "🥇 Altın",
        tierDiamond: "💎 Elmas",
        tierLegend: "👑 Efsane",
        topInvites: "⚔️ Davetler",
        topProfile: "👤 Profil",
        topSettings: "⚙️ Ayarlar",
        topLogout: "🚪 Çıkış",

        cardSingleBadge: "⚔️ 100+ AŞAMA",
        cardSingleName: "Sefer",
        cardSingleDesc: "100 heyecanlı aşama ve güçlü komutanlarla savaş",
        cardSingleBtn: "Tek Kişilik",

        cardMultiBadge: "⚡ 1v1 CANLI",
        cardMultiName: "Çevrim İçi Düello",
        cardMultiDesc: "Gerçek rakipler ve arkadaşlarla canlı mızrak savaşı",
        cardMultiBtn: "Çevrim İçi",

        cardInvitesBadge: "⚔️ DAVETLER",
        cardInvitesName: "Düello Davetleri",
        cardInvitesDesc: "Gelen davetleri kabul edin ve maç vaktini belirleyin",
        cardInvitesBtn: "Davet Listesi",

        cardRewardsBadge: "🎁 ÜCRETSİZ BONUS",
        cardRewardsName: "Günlük Ödüller",
        cardRewardsDesc: "Her gün giriş yapın ve bedava ödüller kazanın",
        cardRewardsBtn: "Ödülü Al",

        cardQuestsBadge: "🎯 GÖREVLER",
        cardQuestsName: "Görevler",
        cardQuestsDesc: "Görevleri tamamlayarak ekstra puan toplayın",
        cardQuestsBtn: "Görevler",

        cardShopBadge: "🛒 CEPHANELİK",
        cardShopName: "Savaş Mağazası",
        cardShopDesc: "Süper kalkanlar, mızraklar ve özel teçhizat",
        cardShopBtn: "Mağaza",

        cardRatingBadge: "🏆 TOP-100",
        cardRatingName: "Lider Tablosu",
        cardRatingDesc: "En iyi mızrak savaşçıları arasına katılın ve şampiyon olun",
        cardRatingBtn: "Sıralama",

        cardAboutBadge: "ℹ️ BİLGİ",
        cardAboutName: "Oyun Hakkında",
        cardAboutDesc: "Kurallar, geliştirici iletişim ve oyun detayları",
        cardAboutBtn: "Hakkında",

        inGameMenu: "Menü",
        inGameBack: "⬅ Geri",
        wind: "RÜZGAR",
        pause: "Duraklat",
        resume: "Devam et",
        sound: "Ses Ayarları",
        addFriend: "Arkadaş Ekle",
        mainMenu: "Ana Menü",
        yourTurn: "Sıra sende!",
        oppTurn: "Rakibin sırası",
        waiting: "Bekleniyor...",
        win: "Kazandın! 🏆",
        lose: "Kaybettin! 💀",
        playAgainBtn: "Tekrar Oyna",
        menuBtn: "Ana Menü",
        rematchBtn: "⚔️ Rövanş İste",
        viewRatingBtn: "🏆 Sıralamayı Gör",
        opponentLeft: "Rakip oyundan ayrıldı",

        settingsTitle: "Ayarlar",
        langLabel: "Uygulama dili:",
        musicVol: "Müzik seviyesi:",
        sfxVol: "Özel efektler (SFX):",
        musicTrack: "Fon müziği:",
        helpBtn: "Yardım",
        save: "Kaydet",
        close: "Kapat",
        settingsSaved: "Ayarlar kaydedildi!",

        profileTitle: "Profil",
        nameLabel: "İsim:",
        avatarLabel: "Avatar:",
        charLabel: "Kahraman:",
        flagLabel: "Ülke bayrağı:",
        spearLabel: "Mızrak modeli:",

        singleModalTitle: "Tek Kişilik Oyun",
        chooseMode: "Seçin:",
        continueLevel: "Mevcut seviyeden devam et",
        selectLevel: "Seviye seç",
        newGame: "Yeni oyun başlat",
        cancel: "İptal",
        levelSelectTitle: "Seviye Seçimi",
        levelLabel: "Seviye",
        campaignStage: "Sefer aşaması",
        resetCampaign: "Seferi sıfırla",

        multiModalTitle: "Çevrim İçi Oyun",
        createGame: "Oyun Oluştur",
        giveCodeToFriend: "Bu kodu arkadaşına ver:",
        inviteViaTg: "📲 Telegram ile çağır",
        joinGame: "Oyuna Katıl",
        enterCode: "KOD",
        joinBtn: "Katıl",
        gameNotFound: "Oyun bulunamadı!",
        randomOpponent: "Rastgele Rakip",
        friendsTitle: "Arkadaşlar",
        refreshBtn: "Yenile",
        noFriends: "Arkadaş yok.",
        backBtn: "Geri",

        charSelectTitle: "Kahramanınızı Seçin",
        charSelectSub: "Savaştan önce savaşçı modelini seçin",
        enterBattle: "⚔️ Savaşa Başla",
        selectedBadge: "Seçildi",

        optionsTitle: "Oyun Ayarları",
        mapLabel: "Harita:",
        weatherLabel: "Hava Durumu:",
        birdsLabel: "Uçan Kuşlar (Engel)",
        animalsLabel: "Otlayan hayvanlar",
        difficultyLabel: "Zorluk:",
        optionCharLabel: "Savaşçı modeli:",
        mapField: "🌿 Yeşil Çayır",
        mapCastle: "🏰 Kale",
        mapDesert: "🏜️ Çöl",
        mapWinter: "❄️ Kış",
        weatherSunny: "☀️ Güneşli",
        weatherNight: "🌙 Gece",
        weatherRain: "🌧️ Yağmur",
        weatherStorm: "⛈️ Fırtına",
        weatherSnow: "❄️ Kar",
        diffEasy: "Kolay",
        diffNormal: "Normal",
        diffHard: "Zor",

        langModalTitle: "Dil Seçin",
        langModalSub: "Devam etmek için bir dil seçin",
        langSelectBtn: "Seç",
        welcomeToast: "🇹🇷 Türkçe seçildi! Hoş geldiniz!"
    },

    az: {
        title: "Nizə Döyüşü",
        subtitle: "Döyüş rejimini seçin",
        stageLabel: "Kampaniya",
        scoreLabel: "Xal",
        tierBronze: "🥉 Bürünc",
        tierSilver: "🥈 Gümüş",
        tierGold: "🥇 Qızıl",
        tierDiamond: "💎 Almaz",
        tierLegend: "👑 Əfsanə",
        topInvites: "⚔️ Dəvətlər",
        topProfile: "👤 Profil",
        topSettings: "⚙️ Parametrlər",
        topLogout: "🚪 Çıxış",

        cardSingleBadge: "⚔️ 100+ MƏRHƏLƏ",
        cardSingleName: "Kampaniya",
        cardSingleDesc: "100 maraqlı mərhələ və sərkərdələrlə döyüş",
        cardSingleBtn: "Tək Oyun",

        cardMultiBadge: "⚡ 1v1 CANLI",
        cardMultiName: "Onlayn Duel",
        cardMultiDesc: "Həqiqi rəqiblər və dostlarla canlı nizə döyüşü",
        cardMultiBtn: "Onlayn Oyun",

        cardInvitesBadge: "⚔️ DƏVƏTLƏR",
        cardInvitesName: "Duel Dəvətləri",
        cardInvitesDesc: "Gələn dəvətləri qəbul edin və döyüş vaxtını təyin edin",
        cardInvitesBtn: "Dəvətlər siyahısı",

        cardRewardsBadge: "🎁 PULSUZ BONUS",
        cardRewardsName: "Gündəlik Hədiyyələr",
        cardRewardsDesc: "Hər gün daxil olun və pulsuz bonuslar qazanın",
        cardRewardsBtn: "Hədiyyəni götür",

        cardQuestsBadge: "🎯 TAPŞIRIQLAR",
        cardQuestsName: "Tapşırıqlar",
        cardQuestsDesc: "Tapşırıqları yerinə yetirin və xal qazanın",
        cardQuestsBtn: "Tapşırıqlar",

        cardShopBadge: "🛒 ARSENAL",
        cardShopName: "Hərbi Mağaza",
        cardShopDesc: "Super qalxanlar, nizələr və xüsusi ləvazimatlar",
        cardShopBtn: "Mağaza",

        cardRatingBadge: "🏆 TOP-100",
        cardRatingName: "Liderlər Cədvəli",
        cardRatingDesc: "Ən güclü döyüşçülər sırasına daxil olun və çempion olun",
        cardRatingBtn: "Reytinq",

        cardAboutBadge: "ℹ️ MƏLUMAT",
        cardAboutName: "Oyun Haqqında",
        cardAboutDesc: "Qaydalar, müəllif əlaqəsi və oyun məlumatları",
        cardAboutBtn: "Haqqında",

        inGameMenu: "Menyu",
        inGameBack: "⬅ Geri",
        wind: "KÜLƏK",
        pause: "Fasilə",
        resume: "Davam et",
        sound: "Səs parametrləri",
        addFriend: "Dost əlavə et",
        mainMenu: "Əsas menyu",
        yourTurn: "Sənin növbən!",
        oppTurn: "Rəqibin növbəsi",
        waiting: "Gözlənilir...",
        win: "Qalib gəldin! 🏆",
        lose: "Uduzdun! 💀",
        playAgainBtn: "Yenidən Oyna",
        menuBtn: "Əsas Menyu",
        rematchBtn: "⚔️ Qisas istə",
        viewRatingBtn: "🏆 Reytinqi Gör",
        opponentLeft: "Rəqib oyunu tərk etdi",

        settingsTitle: "Parametrlər",
        langLabel: "Tətbiq dili:",
        musicVol: "Musiqi səsi:",
        sfxVol: "Xüsusi effektlər (SFX):",
        musicTrack: "Fon musiqisi:",
        helpBtn: "Kömək",
        save: "Yadda saxla",
        close: "Bağla",
        settingsSaved: "Parametrlər saxlanıldı!",

        profileTitle: "Profil",
        nameLabel: "Ad:",
        avatarLabel: "Avatar:",
        charLabel: "Qəhrəman:",
        flagLabel: "Ölkə bayrağı:",
        spearLabel: "Nizə modeli:",

        singleModalTitle: "Tək Oyun",
        chooseMode: "Seçin:",
        continueLevel: "Mövcud mərhələdən davam et",
        selectLevel: "Mərhələ seçimi",
        newGame: "Yeni oyun başlat",
        cancel: "Ləğv et",
        levelSelectTitle: "Mərhələ Seçimi",
        levelLabel: "Mərhələ",
        campaignStage: "Kampaniya mərhələsi",
        resetCampaign: "Kampaniyanı sıfırla",

        multiModalTitle: "Onlayn Oyun",
        createGame: "Oyun Yarat",
        giveCodeToFriend: "Bu kodu dostuna ver:",
        inviteViaTg: "📲 Telegram ilə dəvət et",
        joinGame: "Oyuna Qoşul",
        enterCode: "KOD",
        joinBtn: "Qoşul",
        gameNotFound: "Oyun tapılmadı!",
        randomOpponent: "Təsadüfi Rəqib",
        friendsTitle: "Dostlar",
        refreshBtn: "Yenilə",
        noFriends: "Dost yoxdur.",
        backBtn: "Geri",

        charSelectTitle: "Qəhrəmanınızı seçin",
        charSelectSub: "Döyüşdən əvvəl döyüşçü modelini seçin",
        enterBattle: "⚔️ Döyüşə başla",
        selectedBadge: "Seçildi",

        optionsTitle: "Oyun Parametrləri",
        mapLabel: "Xəritə:",
        weatherLabel: "Hava:",
        birdsLabel: "Uçan Quşlar (Maneə)",
        animalsLabel: "Otlayan heyvanlar",
        difficultyLabel: "Çətinlik:",
        optionCharLabel: "Döyüşçü modeli:",
        mapField: "🌿 Yaşıl Çöl",
        mapCastle: "🏰 Qala",
        mapDesert: "🏜️ Səhra",
        mapWinter: "❄️ Qış",
        weatherSunny: "☀️ Günəşli",
        weatherNight: "🌙 Gecə",
        weatherRain: "🌧️ Yağış",
        weatherStorm: "⛈️ Fırtına",
        weatherSnow: "❄️ Qar",
        diffEasy: "Asan",
        diffNormal: "Orta",
        diffHard: "Çətin",

        langModalTitle: "Dili Seçin",
        langModalSub: "Davam etmək üçün oyun dilini seçin",
        langSelectBtn: "Seçin",
        welcomeToast: "🇦🇿 Azərbaycan dili seçildi! Xoş gəlmisiniz!"
    },

    kk: {
        title: "Найза Шайқасы",
        subtitle: "Шайқас режимін таңдаңыз",
        stageLabel: "Кампания",
        scoreLabel: "Ұпай",
        tierBronze: "🥉 Қола",
        tierSilver: "🥈 Күміс",
        tierGold: "🥇 Алтын",
        tierDiamond: "💎 Гауһар",
        tierLegend: "👑 Аңыз",
        topInvites: "⚔️ Шақырулар",
        topProfile: "👤 Профиль",
        topSettings: "⚙️ Баптаулар",
        topLogout: "🚪 Шығу",

        cardSingleBadge: "⚔️ 100+ КЕЗЕҢ",
        cardSingleName: "Кампания",
        cardSingleDesc: "100 қызықты кезең және бастықтармен шайқас",
        cardSingleBtn: "Жеке ойын",

        cardMultiBadge: "⚡ 1v1 ОНЛАЙН",
        cardMultiName: "Онлайн Дуэль",
        cardMultiDesc: "Нақты қарсыластармен және достармен тікелей найза шайқасы",
        cardMultiBtn: "Онлайн ойнау",

        cardInvitesBadge: "⚔️ ШАҚЫРУЛАР",
        cardInvitesName: "Дуэльге Шақырулар",
        cardInvitesDesc: "Келген шақыруларды қабылдап, шайқас уақытын белгілеңіз",
        cardInvitesBtn: "Шақырулар тізімі",

        cardRewardsBadge: "🎁 ТЕГІН БОНУС",
        cardRewardsName: "Күнделікті Сыйлықтар",
        cardRewardsDesc: "Күн сайын кіріп, тегін супер күштер мен ресурстар алыңыз",
        cardRewardsBtn: "Сыйлықты алу",

        cardQuestsBadge: "🎯 ТАПСЫРМАЛАР",
        cardQuestsName: "Тапсырмалар",
        cardQuestsDesc: "Тапсырмаларды орындап, қосымша ұпай жинаңыз",
        cardQuestsBtn: "Тапсырмалар",

        cardShopBadge: "🛒 АРСЕНАЛ",
        cardShopName: "Әскери Дүкен",
        cardShopDesc: "Супер қалқандар, найзалар және әскери керек-жарақтар",
        cardShopBtn: "Дүкен",

        cardRatingBadge: "🏆 ТОП-100",
        cardRatingName: "Көшбасшылар Кестесі",
        cardRatingDesc: "Үздік сарбаздар қатарына қосылып, чемпион болыңыз",
        cardRatingBtn: "Рейтинг",

        cardAboutBadge: "ℹ️ АҚПАРАТ",
        cardAboutName: "Ойын Туралы",
        cardAboutDesc: "Ережелер, автор байланысы және жоба туралы мәлімет",
        cardAboutBtn: "Ақпарат",

        inGameMenu: "Мәзір",
        inGameBack: "⬅ Артқа",
        wind: "ЖЕЛ",
        pause: "Үзіліс",
        resume: "Жалғастыру",
        sound: "Дыбыс",
        addFriend: "Дос қосу",
        mainMenu: "Басты мәзір",
        yourTurn: "Сіздің кезегіңіз!",
        oppTurn: "Қарсылас кезегі",
        waiting: "Күтілуде...",
        win: "Сіз жеңдіңіз! 🏆",
        lose: "Сіз жеңілдіңіз! 💀",
        playAgainBtn: "Қайта ойнау",
        menuBtn: "Басты мәзір",
        rematchBtn: "⚔️ Қайта шақыру",
        viewRatingBtn: "🏆 Рейтингті көру",
        opponentLeft: "Қарсылас ойыннан шығып кетті",

        settingsTitle: "Баптаулар",
        langLabel: "Қолданба тілі:",
        musicVol: "Музыка дыбысы:",
        sfxVol: "Арнайы эффектілер (SFX):",
        musicTrack: "Фондық музыка:",
        helpBtn: "Көмек",
        save: "Сақтау",
        close: "Жабу",
        settingsSaved: "Баптаулар сақталды!",

        profileTitle: "Профиль",
        nameLabel: "Аты:",
        avatarLabel: "Аватар:",
        charLabel: "Батыр:",
        flagLabel: "Мемлекет туы:",
        spearLabel: "Найза үлгісі:",

        singleModalTitle: "Жеке ойын",
        chooseMode: "Таңдаңыз:",
        continueLevel: "Ағымдағы кезеңді жалғастыру",
        selectLevel: "Кезеңді таңдау",
        newGame: "Жаңа ойын бастау",
        cancel: "Болдырмау",
        levelSelectTitle: "Кезең Таңдау",
        levelLabel: "Кезең",
        campaignStage: "Кампания кезеңі",
        resetCampaign: "Кампанияны қайта бастау",

        multiModalTitle: "Онлайн Ойын",
        createGame: "Ойын құру",
        giveCodeToFriend: "Бұл кодты досыңызға беріңіз:",
        inviteViaTg: "📲 Telegram арқылы шақыру",
        joinGame: "Ойынға қосылу",
        enterCode: "КОД",
        joinBtn: "Қосылу",
        gameNotFound: "Ойын табылмады!",
        randomOpponent: "Кездейсоқ қарсылас",
        friendsTitle: "Достар",
        refreshBtn: "Жаңарту",
        noFriends: "Достар жоқ.",
        backBtn: "Артқа",

        charSelectTitle: "Батырыңызды таңдаңыз",
        charSelectSub: "Шайқас алдында жауынгер моделін таңдаңыз",
        enterBattle: "⚔️ Шайқасқа кіру",
        selectedBadge: "Таңдалған",

        optionsTitle: "Ойын Баптаулары",
        mapLabel: "Карта:",
        weatherLabel: "Ауа райы:",
        birdsLabel: "Ұшатын құстар (кедергі)",
        animalsLabel: "Жайылымдағы жануарлар",
        difficultyLabel: "Қиындық:",
        optionCharLabel: "Жауынгер үлгісі:",
        mapField: "🌿 Жасыл Дала",
        mapCastle: "🏰 Қамал",
        mapDesert: "🏜️ Шөл",
        mapWinter: "❄️ Қыс",
        weatherSunny: "☀️ Ашық",
        weatherNight: "🌙 Түн",
        weatherRain: "🌧️ Жаңбыр",
        weatherStorm: "⛈️ Дауыл",
        weatherSnow: "❄️ Қар",
        diffEasy: "Оңай",
        diffNormal: "Орташа",
        diffHard: "Қиын",

        langModalTitle: "Тілді таңдаңыз",
        langModalSub: "Ойынды жалғастыру үшін тілді таңдаңыз",
        langSelectBtn: "Таңдау",
        welcomeToast: "🇰🇿 Қазақ тілі таңдалды! Қош келдіңіз!"
    },

    ky: {
        title: "Найза Согушу",
        subtitle: "Согуш режимин тандаңыз",
        stageLabel: "Кампания",
        scoreLabel: "Упай",
        tierBronze: "🥉 Коло",
        tierSilver: "🥈 Күмүш",
        tierGold: "🥇 Алтын",
        tierDiamond: "💎 Алмаз",
        tierLegend: "👑 Уламыш",
        topInvites: "⚔️ Чакыруулар",
        topProfile: "👤 Профиль",
        topSettings: "⚙️ Жөндөөлөр",
        topLogout: "🚪 Чыгуу",

        cardSingleBadge: "⚔️ 100+ БАСКЫЧ",
        cardSingleName: "Кампания",
        cardSingleDesc: "100 кызыктуу деңгээл жана босстор менен салгылашуу",
        cardSingleBtn: "Жалгыз оюн",

        cardMultiBadge: "⚡ 1v1 ОНЛАЙН",
        cardMultiName: "Онлайн Дуэль",
        cardMultiDesc: "Чыныгы атаандаштар жана достор менен жандуу согуш",
        cardMultiBtn: "Онлайн ойноо",

        cardInvitesBadge: "⚔️ ЧАКЫРУУЛАР",
        cardInvitesName: "Дуэлге Чакыруулар",
        cardInvitesDesc: "Келген чакырууларды кабыл алып, согуш убактысын белгилеңиз",
        cardInvitesBtn: "Чакыруулар тизмеси",

        cardRewardsBadge: "🎁 АКЫСЫЗ БОНУС",
        cardRewardsName: "Күндөлүк Сыйлыктар",
        cardRewardsDesc: "Күн сайын кирип, бекер сыйлыктарды алыңыз",
        cardRewardsBtn: "Сыйлыкты алуу",

        cardQuestsBadge: "🎯 ТАПШЫРМАЛАР",
        cardQuestsName: "Тапшырмалар",
        cardQuestsDesc: "Тапшырмаларды аткарып, кошумча упай топтоңуз",
        cardQuestsBtn: "Тапшырмалар",

        cardShopBadge: "🛒 АРСЕНАЛ",
        cardShopName: "Аскердик Дүкөн",
        cardShopDesc: "Супер калкандар, найзалар жана согуштук буюмдар",
        cardShopBtn: "Дүкөн",

        cardRatingBadge: "🏆 ТОП-100",
        cardRatingName: "Лидерлер Таблицасы",
        cardRatingDesc: "Мыкты жоокерлер катарына кошулуп, чемпион болуңуз",
        cardRatingBtn: "Рейтинг",

        cardAboutBadge: "ℹ️ МААЛЫМАТ",
        cardAboutName: "Оюн Жөнүндө",
        cardAboutDesc: "Эрежелер, автор байланышы жана маалымат",
        cardAboutBtn: "Маалымат",

        inGameMenu: "Меню",
        inGameBack: "⬅ Артка",
        wind: "ШАМАЛ",
        pause: "Тыныгуу",
        resume: "Улантуу",
        sound: "Үн",
        addFriend: "Дос кошуу",
        mainMenu: "Башкы меню",
        yourTurn: "Сиздин кезек!",
        oppTurn: "Атаандаштын кезеги",
        waiting: "Күтүлүүдө...",
        win: "Сиз жеңдиңиз! 🏆",
        lose: "Сиз утулдуңуз! 💀",
        playAgainBtn: "Кайра ойноо",
        menuBtn: "Башкы меню",
        rematchBtn: "⚔️ Кайра чакыруу",
        viewRatingBtn: "🏆 Рейтингди көрүү",
        opponentLeft: "Атаандаш оюндан чыгып кетти",

        settingsTitle: "Жөндөөлөр",
        langLabel: "Колдонмо тили:",
        musicVol: "Музыка үнү:",
        sfxVol: "Атайын эффекттер (SFX):",
        musicTrack: "Фондук музыка:",
        helpBtn: "Жардам",
        save: "Сактоо",
        close: "Жабуу",
        settingsSaved: "Жөндөөлөр сакталды!",

        profileTitle: "Профиль",
        nameLabel: "Аты:",
        avatarLabel: "Аватар:",
        charLabel: "Баатыр:",
        flagLabel: "Өлкө желеги:",
        spearLabel: "Найза модели:",

        singleModalTitle: "Жалгыз Оюн",
        chooseMode: "Тандаңыз:",
        continueLevel: "Азыркы деңгээлди улантуу",
        selectLevel: "Деңгээлди тандоо",
        newGame: "Жаңы оюн баштоо",
        cancel: "Жокко чыгаруу",
        levelSelectTitle: "Деңгээлди Тандоо",
        levelLabel: "Деңгээл",
        campaignStage: "Кампания баскычы",
        resetCampaign: "Кампанияны кайра баштоо",

        multiModalTitle: "Онлайн Оюн",
        createGame: "Оюн түзүү",
        giveCodeToFriend: "Бул кодду досуңузга бериңиз:",
        inviteViaTg: "📲 Telegram аркылуу чакыруу",
        joinGame: "Оюнга кошулуу",
        enterCode: "КОД",
        joinBtn: "Кошулуу",
        gameNotFound: "Оюн табылган жок!",
        randomOpponent: "Кокусунан атаандаш",
        friendsTitle: "Достор",
        refreshBtn: "Жаңылоо",
        noFriends: "Достор жок.",
        backBtn: "Артка",

        charSelectTitle: "Баатырыңызды тандаңыз",
        charSelectSub: "Согуштун алдында жоокердин моделин тандаңыз",
        enterBattle: "⚔️ Согушка кирүү",
        selectedBadge: "Тандалган",

        optionsTitle: "Оюн Жөндөөлөрү",
        mapLabel: "Карта:",
        weatherLabel: "Аба ырайы:",
        birdsLabel: "Учуучу куштар (тоскоолдук)",
        animalsLabel: "Жайылган жаныбарлар",
        difficultyLabel: "Кыйынчылык:",
        optionCharLabel: "Жоокердин модели:",
        mapField: "🌿 Жашыл Талаа",
        mapCastle: "🏰 Сепил",
        mapDesert: "🏜️ Чөл",
        mapWinter: "❄️ Кыш",
        weatherSunny: "☀️ Ачык",
        weatherNight: "🌙 Түн",
        weatherRain: "🌧️ Жамгыр",
        weatherStorm: "⛈️ Бороон",
        weatherSnow: "❄️ Кар",
        diffEasy: "Оңой",
        diffNormal: "Орточо",
        diffHard: "Кыйын",

        langModalTitle: "Тилди тандаңыз",
        langModalSub: "Оюнду улантуу үчүн тилди тандаңыз",
        langSelectBtn: "Тандоо",
        welcomeToast: "🇰🇬 Кыргыз тили тандалды! Кош келиңиз!"
    },

    tg: {
        title: "Ҷанги Найза",
        subtitle: "Ҳолати ҷангро интихоб кунед",
        stageLabel: "Кампания",
        scoreLabel: "Хол",
        tierBronze: "🥉 Биринҷӣ",
        tierSilver: "🥈 Нуқра",
        tierGold: "🥇 Тилло",
        tierDiamond: "💎 Алмос",
        tierLegend: "👑 Афсона",
        topInvites: "⚔️ Даъватҳо",
        topProfile: "👤 Профил",
        topSettings: "⚙️ Танзимот",
        topLogout: "🚪 Баромад",

        cardSingleBadge: "⚔️ 100+ МАРҲИЛА",
        cardSingleName: "Кампания",
        cardSingleDesc: "100 марҳилаи шавқовар ва ҷанг бо саркардаҳо",
        cardSingleBtn: "Бозии танҳо",

        cardMultiBadge: "⚡ 1v1 ОНЛАЙН",
        cardMultiName: "Дуэли Онлайн",
        cardMultiDesc: "Ҷанги зиндаи найза бо рақибони воқеӣ ва дӯстон",
        cardMultiBtn: "Бозии онлайн",

        cardInvitesBadge: "⚔️ ДАЪВАТҲО",
        cardInvitesName: "Даъватҳо ба Дуэл",
        cardInvitesDesc: "Даъватҳоро қабул карда, вақти ҷангро муайян намоед",
        cardInvitesBtn: "Рӯйхати даъватҳо",

        cardRewardsBadge: "🎁 БОНУСИ РОЙГОН",
        cardRewardsName: "Мукофотҳои Ҳаррӯза",
        cardRewardsDesc: "Ҳар рӯз ворид шавед ва бонусҳои ройгон гиред",
        cardRewardsBtn: "Гирифтани мукофот",

        cardQuestsBadge: "🎯 СУПОРИШҲО",
        cardQuestsName: "Супоришҳо",
        cardQuestsDesc: "Супоришҳоро иҷро кунед ва хол ба даст оред",
        cardQuestsBtn: "Супоришҳо",

        cardShopBadge: "🛒 АРСЕНАЛ",
        cardShopName: "Дӯкони Ҳарбӣ",
        cardShopDesc: "Сипарҳои олӣ, найзаҳо ва лавозимоти ҷангӣ",
        cardShopBtn: "Дӯкон",

        cardRatingBadge: "🏆 ТОП-100",
        cardRatingName: "Ҷадвали Пешсафон",
        cardRatingDesc: "Ба сафи беҳтарин найзадорон ворид шуда қаҳрамон шавед",
        cardRatingBtn: "Рейтинг",

        cardAboutBadge: "ℹ️ МАЪЛУМОТ",
        cardAboutName: "Дар Бораи Бозӣ",
        cardAboutDesc: "Қоидаҳо, тамос бо муаллиф ва маълумоти лоиҳа",
        cardAboutBtn: "Муфассал",

        inGameMenu: "Меню",
        inGameBack: "⬅ Бозгашт",
        wind: "ШАМОЛ",
        pause: "Таваққуф",
        resume: "Идома",
        sound: "Садо",
        addFriend: "Илова ба дӯстон",
        mainMenu: "Менюи асосӣ",
        yourTurn: "Навбати шумо!",
        oppTurn: "Навбати рақиб",
        waiting: "Интизорӣ...",
        win: "Шумо бурдед! 🏆",
        lose: "Шумо бохтед! 💀",
        playAgainBtn: "Бозии дубора",
        menuBtn: "Менюи асосӣ",
        rematchBtn: "⚔️ Даъвати дубора",
        viewRatingBtn: "🏆 Дидани рейтинг",
        opponentLeft: "Рақиб бозиро тарк кард",

        settingsTitle: "Танзимот",
        langLabel: "Забони барнома:",
        musicVol: "Баландии мусиқӣ:",
        sfxVol: "Баландии эффектҳо (SFX):",
        musicTrack: "Мусиқии пасманзар:",
        helpBtn: "Кӯмак",
        save: "Сабт",
        close: "Пӯшидан",
        settingsSaved: "Танзимот сабт шуд!",

        profileTitle: "Профил",
        nameLabel: "Ном:",
        avatarLabel: "Аватар:",
        charLabel: "Қаҳрамон:",
        flagLabel: "Парчами кишвар:",
        spearLabel: "Модели найза:",

        singleModalTitle: "Бозии Танҳо",
        chooseMode: "Интихоб кунед:",
        continueLevel: "Давом додани сатҳи ҷорӣ",
        selectLevel: "Интихоби сатҳ",
        newGame: "Оғози бозии нав",
        cancel: "Бекор кардан",
        levelSelectTitle: "Интихоби Сатҳ",
        levelLabel: "Сатҳ",
        campaignStage: "Марҳилаи кампания",
        resetCampaign: "Аз нав оғоз кардан",

        multiModalTitle: "Бозии Онлайн",
        createGame: "Эҷоди бозӣ",
        giveCodeToFriend: "Ин рамзро ба дӯстатон фиристед:",
        inviteViaTg: "📲 Даъват тавассути Telegram",
        joinGame: "Пайваст шудан",
        enterCode: "РАМЗ",
        joinBtn: "Пайваст шудан",
        gameNotFound: "Бозӣ ёфт нашуд!",
        randomOpponent: "Рақиби тасодуфӣ",
        friendsTitle: "Дӯстон",
        refreshBtn: "Навсозӣ",
        noFriends: "Дӯстон нестанд.",
        backBtn: "Бозгашт",

        charSelectTitle: "Қаҳрамони худро интихоб кунед",
        charSelectSub: "Пеш аз ҷанг модели сарбозро интихоб намоед",
        enterBattle: "⚔️ Вориди ҷанг",
        selectedBadge: "Интихобшуда",

        optionsTitle: "Танзимоти Бозӣ",
        mapLabel: "Харита:",
        weatherLabel: "Обу ҳаво:",
        birdsLabel: "Паррандагони парвозкунанда (монеа)",
        animalsLabel: "Ҳайвоноти чарогоҳ",
        difficultyLabel: "Мушкилӣ:",
        optionCharLabel: "Модели сарбоз:",
        mapField: "🌿 Майдони Сабз",
        mapCastle: "🏰 Қалъа",
        mapDesert: "🏜️ Биёбон",
        mapWinter: "❄️ Зимистон",
        weatherSunny: "☀️ Офтобӣ",
        weatherNight: "🌙 Шаб",
        weatherRain: "🌧️ Борон",
        weatherStorm: "⛈️ Тӯфон",
        weatherSnow: "❄️ Барф",
        diffEasy: "Осон",
        diffNormal: "Миёна",
        diffHard: "Мушкил",

        langModalTitle: "Забонро интихоб кунед",
        langModalSub: "Барои идома забони бозиро интихоб намоед",
        langSelectBtn: "Интихоб",
        welcomeToast: "🇹🇯 Забони тоҷикӣ интихоб шуд! Хуш омадед!"
    }
};

function applyLanguage() {
    const langKey = (typeof myProfile !== 'undefined' && myProfile && myProfile.lang) ? myProfile.lang : 'uz';
    const t = translations[langKey] || translations.uz;
    const tf = (key, fallback = '') => t[key] ?? translations.en[key] ?? translations.uz[key] ?? fallback;

    // 1. Asosiy Menyu Sarlavhasi va Ta'rifi (AAA Carousel Header)
    const carouselTitleEl = document.querySelector('.menu-carousel-title');
    if (carouselTitleEl) carouselTitleEl.innerText = tf('title', "Nayza Jangi");
    const carouselSubEl = document.querySelector('.menu-carousel-subtitle');
    if (carouselSubEl) carouselSubEl.innerText = tf('subtitle', "Jang rejimini tanlang");

    // 2. Yuqori Bar (Top Bar) Tugmalari va Matnlari
    const btnTopInvites = document.getElementById('btn-top-invites');
    if (btnTopInvites) {
        const badgeEl = document.getElementById('top-invites-badge');
        const badgeHtml = badgeEl ? badgeEl.outerHTML : '<span id="top-invites-badge" class="badge-pill" style="display:none;">0</span>';
        btnTopInvites.innerHTML = `${tf('topInvites', '⚔️ Takliflar')} ${badgeHtml}`;
    }
    const btnProfileEl = document.getElementById('btn-profile');
    if (btnProfileEl) btnProfileEl.innerText = tf('topProfile', "👤 Profil");
    const btnSettingsEl = document.getElementById('btn-settings');
    if (btnSettingsEl) btnSettingsEl.innerText = tf('topSettings', "⚙️ Sozlamalar");
    const btnLogoutEl = document.getElementById('btn-logout');
    if (btnLogoutEl) btnLogoutEl.innerText = tf('topLogout', "🚪 Chiqish");

    // 3. Carousel Barcha Cardlari (Cards Translation)
    // Card 1: Singleplayer (Kampaniya)
    const cardSingle = document.querySelector('.menu-card[data-card="single"]');
    if (cardSingle) {
        const badge = cardSingle.querySelector('.menu-card-badge');
        if (badge) badge.innerText = tf('cardSingleBadge', "⚔️ 100+ BOSQICH");
        const name = cardSingle.querySelector('.menu-card-name');
        if (name) name.innerText = tf('cardSingleName', "Kampaniya");
        const desc = cardSingle.querySelector('.menu-card-description');
        if (desc) desc.innerText = tf('cardSingleDesc', "100 ta qiziqarli bosqich va qudratli sarkardalar bilan jang");
        const btn = cardSingle.querySelector('.menu-card-btn');
        if (btn) btn.innerText = tf('cardSingleBtn', "Yakkalik o'yin");
    }

    // Card 2: Multiplayer (Onlayn Duel)
    const cardMulti = document.querySelector('.menu-card[data-card="multi"]');
    if (cardMulti) {
        const badge = cardMulti.querySelector('.menu-card-badge');
        if (badge) badge.innerText = tf('cardMultiBadge', "⚡ 1v1 JONLI");
        const name = cardMulti.querySelector('.menu-card-name');
        if (name) name.innerText = tf('cardMultiName', "Onlayn Duel");
        const desc = cardMulti.querySelector('.menu-card-description');
        if (desc) desc.innerText = tf('cardMultiDesc', "Haqiqiy raqiblar va do'stlar bilan jonli nayza jangi");
        const btn = cardMulti.querySelector('.menu-card-btn');
        if (btn) btn.innerText = tf('cardMultiBtn', "Onlayn o'yin");
    }

    // Card 2.5: Duelga Takliflar
    const cardInvites = document.querySelector('.menu-card[data-card="invites"]');
    if (cardInvites) {
        const badge = document.getElementById('badge-duel-invites');
        if (badge) {
            const countSpan = document.getElementById('txt-duel-invites-count');
            const countHtml = countSpan ? countSpan.outerHTML : '<span id="txt-duel-invites-count" class="duel-count-pill" style="display:none;">0</span>';
            badge.innerHTML = `${tf('cardInvitesBadge', '⚔️ TAKLIFLAR')} ${countHtml}`;
        }
        const name = cardInvites.querySelector('.menu-card-name');
        if (name) name.innerText = tf('cardInvitesName', "Duelga Takliflar");
        const desc = cardInvites.querySelector('.menu-card-description');
        if (desc) desc.innerText = tf('cardInvitesDesc', "Kelgan takliflarni qabul qiling va jang vaqtini belgilang");
        const btn = cardInvites.querySelector('.menu-card-btn');
        if (btn) btn.innerText = tf('cardInvitesBtn', "Takliflar ro'yxati");
    }

    // Card 3: Kunlik Sovg'alar
    const cardRewards = document.querySelector('.menu-card[data-card="rewards"]');
    if (cardRewards) {
        const badge = cardRewards.querySelector('.menu-card-badge');
        if (badge) badge.innerText = tf('cardRewardsBadge', "🎁 BEPUL BONUS");
        const name = cardRewards.querySelector('.menu-card-name');
        if (name) name.innerText = tf('cardRewardsName', "Kunlik Sovg'alar");
        const desc = cardRewards.querySelector('.menu-card-description');
        if (desc) desc.innerText = tf('cardRewardsDesc', "Har kuni kiring va bepul super kuchlar va resurslarni oling");
        const btn = cardRewards.querySelector('.menu-card-btn');
        if (btn) btn.innerText = tf('cardRewardsBtn', "Sovg'ani olish");
    }

    // Card 4: Vazifalar
    const cardQuests = document.querySelector('.menu-card[data-card="quests"]');
    if (cardQuests) {
        const badge = cardQuests.querySelector('.menu-card-badge');
        if (badge) badge.innerText = tf('cardQuestsBadge', "🎯 KVESTLAR");
        const name = cardQuests.querySelector('.menu-card-name');
        if (name) name.innerText = tf('cardQuestsName', "Vazifalar");
        const desc = cardQuests.querySelector('.menu-card-description');
        if (desc) desc.innerText = tf('cardQuestsDesc', "Topshiriqlarni bajaring va qo'shimcha ballar to'plang");
        const btn = cardQuests.querySelector('.menu-card-btn');
        if (btn) btn.innerText = tf('cardQuestsBtn', "Vazifalar");
    }

    // Card 5: Harbiy Do'kon
    const cardShop = document.querySelector('.menu-card[data-card="shop"]');
    if (cardShop) {
        const badge = cardShop.querySelector('.menu-card-badge');
        if (badge) badge.innerText = tf('cardShopBadge', "🛒 ARSENAL");
        const name = cardShop.querySelector('.menu-card-name');
        if (name) name.innerText = tf('cardShopName', "Harbiy Do'kon");
        const desc = cardShop.querySelector('.menu-card-description');
        if (desc) desc.innerText = tf('cardShopDesc', "Super himoya, nayzalar va maxsus jangovar vositalar");
        const btn = cardShop.querySelector('.menu-card-btn');
        if (btn) btn.innerText = tf('cardShopBtn', "Do'kon");
    }

    // Card 6: Reyting
    const cardRating = document.querySelector('.menu-card[data-card="rating"]');
    if (cardRating) {
        const badge = cardRating.querySelector('.menu-card-badge');
        if (badge) badge.innerText = tf('cardRatingBadge', "🏆 TOP-100");
        const name = cardRating.querySelector('.menu-card-name');
        if (name) name.innerText = tf('cardRatingName', "Reyting");
        const desc = cardRating.querySelector('.menu-card-description');
        if (desc) desc.innerText = tf('cardRatingDesc', "Yetakchi kamonbozlar safiga kiring va chempionlikka erishing");
        const btn = cardRating.querySelector('.menu-card-btn');
        if (btn) btn.innerText = tf('cardRatingBtn', "Reyting");
    }

    // Card 7: O'yin Haqida
    const cardAbout = document.querySelector('.menu-card[data-card="about"]');
    if (cardAbout) {
        const badge = cardAbout.querySelector('.menu-card-badge');
        if (badge) badge.innerText = tf('cardAboutBadge', "ℹ️ MA'LUMOT");
        const name = cardAbout.querySelector('.menu-card-name');
        if (name) name.innerText = tf('cardAboutName', "O'yin Haqida");
        const desc = cardAbout.querySelector('.menu-card-description');
        if (desc) desc.innerText = tf('cardAboutDesc', "Qoidalar, muallif haqida va loyihani qo'llab-quvvatlash");
        const btn = cardAbout.querySelector('.menu-card-btn');
        if (btn) btn.innerText = tf('cardAboutBtn', "O'yin haqida");
    }

    // 4. In-Game Boshqaruv Tugmalari (HUD Buttons)
    const igMenuBtn = document.getElementById('in-game-menu-btn');
    if (igMenuBtn) igMenuBtn.innerText = tf('inGameMenu', "Menyu");
    const igBackBtn = document.getElementById('btn-in-game-back');
    if (igBackBtn) igBackBtn.innerText = tf('inGameBack', "⬅ Ortga");
    const igResumeBtn = document.getElementById('btn-resume');
    if (igResumeBtn) igResumeBtn.innerText = tf('resume', "O'yinga qaytish");
    const igSoundBtn = document.getElementById('btn-toggle-sound');
    if (igSoundBtn) igSoundBtn.innerText = tf('sound', "Sozlamalar(ovoz)");
    const igAddFriendBtn = document.getElementById('btn-add-friend');
    if (igAddFriendBtn) igAddFriendBtn.innerText = tf('addFriend', "Do'stga qo'shish");
    const igExitBtn = document.getElementById('btn-exit-menu');
    if (igExitBtn) igExitBtn.innerText = tf('mainMenu', "Asosiy Menyu");
    const txtIgTitle = document.getElementById('txt-ig-menu-title');
    if (txtIgTitle) txtIgTitle.innerText = tf('inGameMenu', "Menyu");
    const txtWind = document.getElementById('txt-wind');
    if (txtWind) txtWind.innerText = tf('wind', "SHAMOL");
    const pauseBtnEl = document.getElementById('btn-pause');
    if (pauseBtnEl) pauseBtnEl.innerText = tf('pause', "Pauza");

    // 5. Sozlamalar Modali (Settings Modal)
    const txtSettingsTitle = document.getElementById('txt-settings-title');
    if (txtSettingsTitle) txtSettingsTitle.innerText = tf('settingsTitle', "Sozlamalar");
    const txtLangLbl = document.getElementById('txt-lang-lbl');
    if (txtLangLbl) txtLangLbl.innerText = tf('langLabel', "Dastur tili:");
    const txtMusicVol = document.getElementById('txt-settings-music-volume');
    if (txtMusicVol) txtMusicVol.innerText = tf('musicVol', "Fon musiqa balandligi:");
    const txtSfxVol = document.getElementById('txt-settings-sfx-volume');
    if (txtSfxVol) txtSfxVol.innerText = tf('sfxVol', "Maxsus effektlar (SFX) balandligi:");
    const txtMusicTrack = document.getElementById('txt-settings-music-track');
    if (txtMusicTrack) txtMusicTrack.innerText = tf('musicTrack', "Fon musiqasi:");
    const btnHelp = document.getElementById('btn-open-help');
    if (btnHelp) btnHelp.innerText = tf('helpBtn', "Yordam");
    const btnSaveSettings = document.getElementById('btn-save-settings');
    if (btnSaveSettings) btnSaveSettings.innerText = tf('save', "Saqlash");

    // 6. Profil Modali
    const txtProfileTitle = document.getElementById('txt-profile-title');
    if (txtProfileTitle) txtProfileTitle.innerText = tf('profileTitle', "Profil");
    const btnSaveProfile = document.getElementById('btn-save-profile');
    if (btnSaveProfile) btnSaveProfile.innerText = tf('save', "Saqlash");

    // 7. Yakkalik & Level Tanlash Modali
    const singleModalH2 = document.querySelector('#single-mode-modal h2');
    if (singleModalH2) singleModalH2.innerText = tf('singleModalTitle', "Yakkalik o'yin");
    const btnSingleCont = document.getElementById('btn-single-continue');
    if (btnSingleCont) btnSingleCont.innerText = tf('continueLevel', "Avvalgi levelni davom etish");
    const btnSingleSel = document.getElementById('btn-single-select-level');
    if (btnSingleSel) btnSingleSel.innerText = tf('selectLevel', "Level tanlash");
    const btnSingleNew = document.getElementById('btn-single-new');
    if (btnSingleNew) btnSingleNew.innerText = tf('newGame', "Yangi o'yin boshlash");
    const btnSingleCancel = document.getElementById('btn-single-cancel');
    if (btnSingleCancel) btnSingleCancel.innerText = tf('cancel', "Bekor qilish");

    const levelSelectH2 = document.querySelector('#level-select-modal h2');
    if (levelSelectH2) levelSelectH2.innerText = tf('levelSelectTitle', "Level tanlash");
    const btnLevelCancel = document.getElementById('btn-level-select-cancel');
    if (btnLevelCancel) btnLevelCancel.innerText = tf('cancel', "Bekor qilish");

    // 8. Onlayn Multiplayer Modali
    const txtMultiTitle = document.getElementById('txt-multi-title');
    if (txtMultiTitle) txtMultiTitle.innerText = tf('multiModalTitle', "Onlayn O'yin");
    const btnMultiCreate = document.getElementById('btn-multi-create');
    if (btnMultiCreate) btnMultiCreate.innerText = tf('createGame', "O'yin yaratish");
    const btnMultiJoinShow = document.getElementById('btn-multi-join-show');
    if (btnMultiJoinShow) btnMultiJoinShow.innerText = tf('joinGame', "O'yinga qo'shilish");
    const btnMultiJoin = document.getElementById('btn-multi-join');
    if (btnMultiJoin) btnMultiJoin.innerText = tf('joinBtn', "Qo'shilish");
    const btnMultiRandom = document.getElementById('btn-multi-random');
    if (btnMultiRandom) btnMultiRandom.innerText = tf('randomOpponent', "Tasodifiy raqib");
    const txtFriendsTitle = document.getElementById('txt-friends-title');
    if (txtFriendsTitle) txtFriendsTitle.innerText = tf('friendsTitle', "Do'stlar");
    const btnRefreshFriends = document.getElementById('btn-refresh-friends');
    if (btnRefreshFriends) btnRefreshFriends.innerText = tf('refreshBtn', "Yangilash");
    const btnMultiBack = document.getElementById('btn-multi-back');
    if (btnMultiBack) btnMultiBack.innerText = tf('backBtn', "Orqaga");

    // 9. Qahramon Tanlash Modali
    const txtCharSelectTitle = document.getElementById('txt-char-select-title');
    if (txtCharSelectTitle) txtCharSelectTitle.innerText = tf('charSelectTitle', "Qahramoningizni tanlang");
    const txtCharSelectSub = document.getElementById('txt-char-select-sub');
    if (txtCharSelectSub) txtCharSelectSub.innerText = tf('charSelectSub', "Jangga kirishdan oldin jangchi modelini tanlang");
    const btnCharConfirmEl = document.getElementById('btn-char-select-confirm');
    if (btnCharConfirmEl) {
        const span = btnCharConfirmEl.querySelector('span');
        if (span) span.innerText = tf('enterBattle', "⚔️ Jangga kirish");
    }
    const btnCharCancelEl = document.getElementById('btn-char-select-cancel');
    if (btnCharCancelEl) {
        const span = btnCharCancelEl.querySelector('span');
        if (span) span.innerText = tf('cancel', "Bekor qilish");
    }

    // 10. O'yin Tugashi (Game Over & Rematch)
    if (restartBtn) restartBtn.innerText = tf('playAgainBtn', "Yana o'ynash");
    if (menuBtn) menuBtn.innerText = tf('menuBtn', "Bosh menyu");
    const rematchBtnEl = document.getElementById('rematch-btn');
    if (rematchBtnEl) rematchBtnEl.innerText = tf('rematchBtn', "⚔️ Revansh taklif qilish");
    const btnGameOverRating = document.getElementById('btn-game-over-rating');
    if (btnGameOverRating) btnGameOverRating.innerText = tf('viewRatingBtn', "🏆 Reytingni ko'rish");

    // 11. O'yin Sozlamalari (Options)
    if (document.getElementById('txt-campaign-stage')) document.getElementById('txt-campaign-stage').innerText = tf('campaignStage', "Kampaniya");
    if (btnResetCampaign) btnResetCampaign.innerText = tf('resetCampaign', "Kampaniyani qayta boshlash");
    if (document.getElementById('txt-options-title')) document.getElementById('txt-options-title').innerText = tf('optionsTitle', "O'yin Sozlamalari");
    if (document.getElementById('txt-map-lbl')) document.getElementById('txt-map-lbl').innerText = tf('mapLabel', "Maydon (Xarita):");
    if (document.getElementById('txt-weather-lbl')) document.getElementById('txt-weather-lbl').innerText = tf('weatherLabel', "Ob-havo:");
    if (document.getElementById('txt-birds-lbl')) document.getElementById('txt-birds-lbl').innerText = tf('birdsLabel', "Havoda Uchuvchi Qushlar (To'siq)");
    if (document.getElementById('txt-animals-lbl')) document.getElementById('txt-animals-lbl').innerText = tf('animalsLabel', "O'tlab yuruvchi hayvonlar");
    if (difficultyWrap) difficultyWrap.innerText = tf('difficultyLabel', "Qiyinlik:");
    if (document.getElementById('txt-char-opt-lbl')) document.getElementById('txt-char-opt-lbl').innerText = tf('optionCharLabel', "Jangchi modeli:");
    if (btnConfirmCreate) btnConfirmCreate.innerText = tf('createGame', "O'yinni Yaratish");
    if (btnCancelOptions) btnCancelOptions.innerText = tf('cancel', "Bekor qilish");
    if (document.getElementById('opt-map-field')) document.getElementById('opt-map-field').innerText = tf('mapField', "🌿 Yashil Dala");
    if (document.getElementById('opt-map-castle')) document.getElementById('opt-map-castle').innerText = tf('mapCastle', "🏰 Qal'a");
    if (document.getElementById('opt-map-desert')) document.getElementById('opt-map-desert').innerText = tf('mapDesert', "🏜️ Cho'l");
    if (document.getElementById('opt-map-winter')) document.getElementById('opt-map-winter').innerText = tf('mapWinter', "❄️ Qish");
    if (document.getElementById('opt-weather-sunny')) document.getElementById('opt-weather-sunny').innerText = tf('weatherSunny', "☀️ Quyoshli");
    if (document.getElementById('opt-weather-night')) document.getElementById('opt-weather-night').innerText = tf('weatherNight', "🌙 Tun");
    if (document.getElementById('opt-weather-rain')) document.getElementById('opt-weather-rain').innerText = tf('weatherRain', "🌧️ Yomg'ir");
    if (document.getElementById('opt-weather-storm')) document.getElementById('opt-weather-storm').innerText = tf('weatherStorm', "⛈️ Jala");
    if (document.getElementById('opt-weather-snow')) document.getElementById('opt-weather-snow').innerText = tf('weatherSnow', "❄️ Qor");
    if (document.getElementById('opt-diff-easy')) document.getElementById('opt-diff-easy').innerText = tf('diffEasy', "Oson");
    if (document.getElementById('opt-diff-normal')) document.getElementById('opt-diff-normal').innerText = tf('diffNormal', "O'rtacha");
    if (document.getElementById('opt-diff-hard')) document.getElementById('opt-diff-hard').innerText = tf('diffHard', "Qiyin");
    if (document.getElementById('txt-music-volume')) document.getElementById('txt-music-volume').innerText = tf('musicVol', "Fon musiqa balandligi");
    if (document.getElementById('txt-music-mute')) document.getElementById('txt-music-mute').innerText = tf('musicMuteLabel', "Ovozni o'chirish");

    // 12. Profil va Kampaniya UI qatlamlarini yangilash
    if (typeof updateCampaignUI === 'function') updateCampaignUI();
}

// Universal Safe Modal Management with Ghost Click Shield, Full Modal Isolation & Mobile Scroll Protection
let lastModalActionTime = 0;
let touchStartX = 0;
let touchStartY = 0;
let isTouchScrolling = false;
let lastScrollEndTime = 0;
let lastTouchTriggerTime = 0;

window.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches[0]) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isTouchScrolling = false;
    }
}, { passive: true, capture: true });

window.addEventListener('touchmove', (e) => {
    if (e.touches && e.touches[0]) {
        const dx = e.touches[0].clientX - touchStartX;
        const dy = e.touches[0].clientY - touchStartY;
        if (Math.hypot(dx, dy) > 8) {
            isTouchScrolling = true;
        }
    }
}, { passive: true, capture: true });

window.addEventListener('touchend', (e) => {
    if (isTouchScrolling) {
        lastScrollEndTime = Date.now();
        setTimeout(() => {
            isTouchScrolling = false;
        }, 140);
    } else {
        isTouchScrolling = false;
    }
}, { passive: true, capture: true });

window.addEventListener('touchcancel', () => {
    isTouchScrolling = false;
    lastScrollEndTime = 0;
}, { passive: true, capture: true });

function safeModalAction(fn) {
    return function (e) {
        // Agar foydalanuvchi barmoq bilan menyuni / ekranni surgan (scroll qilgan) bo'lsa, tugma bosilmasligi shart!
        if (isTouchScrolling || (Date.now() - lastScrollEndTime < 150)) {
            return;
        }
        if (e && e.type === 'touchend') {
            const touch = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
            if (touch) {
                const dist = Math.hypot(touch.clientX - touchStartX, touch.clientY - touchStartY);
                if (dist > 8) {
                    isTouchScrolling = true;
                    lastScrollEndTime = Date.now();
                    return;
                }
            }
        }
        const now = Date.now();
        if (now - lastModalActionTime < 380) {
            if (e) {
                if (typeof e.preventDefault === 'function') e.preventDefault();
                if (typeof e.stopPropagation === 'function') e.stopPropagation();
            }
            return;
        }
        lastModalActionTime = now;
        if (e) {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
        }
        fn(e);
    };
}

// O'yinchi va raqib joylashuviga qarab HUD health barlarini moslash
function applyHudSideRoles() {
    if (!p1Info || !p2Info) return;
    const p1Tag = document.getElementById('p1-role-tag');
    const p2Tag = document.getElementById('p2-role-tag');
    if (myPlayerIndex === 0) {
        p1Info.classList.add('hud-side-player');
        p1Info.classList.remove('hud-side-enemy');
        p2Info.classList.add('hud-side-enemy');
        p2Info.classList.remove('hud-side-player');
        if (p1Tag) p1Tag.innerText = " (Siz)";
        if (p2Tag) p2Tag.innerText = " (Raqib)";
    } else {
        p2Info.classList.add('hud-side-player');
        p2Info.classList.remove('hud-side-enemy');
        p1Info.classList.add('hud-side-enemy');
        p1Info.classList.remove('hud-side-player');
        if (p1Tag) p1Tag.innerText = " (Raqib)";
        if (p2Tag) p2Tag.innerText = " (Siz)";
    }
}

// Landshaft rejimida mobil brauzerda ham to'g'ri (albom) ochiluvchi Custom Select Dropdown
function setupCustomDropdown(selectId) {
    const sel = typeof selectId === 'string' ? document.getElementById(selectId) : selectId;
    if (!sel || sel.tagName !== 'SELECT') return null;

    let wrap = sel.nextElementSibling;
    if (wrap && wrap.classList && wrap.classList.contains('custom-select-wrap')) {
        refreshCustomDropdown(sel, wrap);
        return wrap;
    }

    wrap = document.createElement('div');
    wrap.className = 'custom-select-wrap';
    if (sel.id) wrap.id = 'custom-wrap-' + sel.id;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');

    const triggerText = document.createElement('span');
    triggerText.className = 'custom-select-trigger-text';

    const triggerArrow = document.createElement('span');
    triggerArrow.className = 'custom-select-trigger-arrow';
    triggerArrow.innerHTML = '&#9662;';

    trigger.appendChild(triggerText);
    trigger.appendChild(triggerArrow);

    const menu = document.createElement('div');
    menu.className = 'custom-select-menu hidden';
    menu.dataset.scrollable = 'true';
    menu.setAttribute('role', 'listbox');

    wrap.appendChild(trigger);
    wrap.appendChild(menu);

    sel.style.display = 'none';
    sel.parentNode.insertBefore(wrap, sel.nextSibling);

    const handleTriggerClick = safeModalAction((e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        const isCurrentlyHidden = menu.classList.contains('hidden');
        document.querySelectorAll('.custom-select-menu').forEach(m => {
            if (m !== menu) m.classList.add('hidden');
        });
        document.querySelectorAll('.custom-select-trigger').forEach(t => {
            if (t !== trigger) t.classList.remove('open');
        });

        if (isCurrentlyHidden) {
            refreshCustomDropdown(sel, wrap);
            menu.classList.remove('hidden');
            trigger.classList.add('open');
            const activeItem = menu.querySelector('.custom-select-item.selected');
            if (activeItem) {
                activeItem.scrollIntoView({ block: 'nearest' });
            }
        } else {
            menu.classList.add('hidden');
            trigger.classList.remove('open');
        }
    });

    trigger.addEventListener('click', handleTriggerClick);
    trigger.addEventListener('touchend', handleTriggerClick, { passive: false });

    sel.addEventListener('change', () => {
        refreshCustomDropdown(sel, wrap);
    });

    refreshCustomDropdown(sel, wrap);
    return wrap;
}

function refreshCustomDropdown(sel, wrap) {
    if (!sel || !wrap) return;
    const triggerText = wrap.querySelector('.custom-select-trigger-text');
    const menu = wrap.querySelector('.custom-select-menu');
    if (!menu || !triggerText) return;

    menu.innerHTML = '';
    const selectedValue = sel.value;
    let selectedLabel = '';

    Array.from(sel.options).forEach(opt => {
        const item = document.createElement('div');
        item.className = 'custom-select-item';
        item.dataset.value = opt.value;
        item.setAttribute('role', 'option');
        item.innerText = opt.text;

        const isSelected = (opt.value === selectedValue) || (!selectedValue && opt.selected);
        if (isSelected) {
            item.classList.add('selected');
            selectedLabel = opt.text;
        }

        const handleItemSelect = safeModalAction((e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            sel.value = opt.value;
            triggerText.innerText = opt.text;
            menu.querySelectorAll('.custom-select-item').forEach(it => it.classList.remove('selected'));
            item.classList.add('selected');
            menu.classList.add('hidden');
            const trig = wrap.querySelector('.custom-select-trigger');
            if (trig) trig.classList.remove('open');
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        });

        item.addEventListener('click', handleItemSelect);
        item.addEventListener('touchend', handleItemSelect, { passive: false });

        menu.appendChild(item);
    });

    if (!selectedLabel && sel.options.length > 0) {
        selectedLabel = sel.options[0].text;
    }
    triggerText.innerText = selectedLabel || 'Tanlang...';
}

document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest || !e.target.closest('.custom-select-wrap')) {
        document.querySelectorAll('.custom-select-menu').forEach(m => m.classList.add('hidden'));
        document.querySelectorAll('.custom-select-trigger').forEach(t => t.classList.remove('open'));
    }
}, { passive: true });

let returnToGameOverAfterModal = false;

const ALL_MODAL_IDS = [
    'daily-quests-modal',
    'daily-rewards-modal',
    'profile-modal',
    'settings-modal',
    'shop-modal',
    'about-modal',
    'rating-modal',
    'help-modal',
    'multi-menu',
    'single-mode-modal',
    'level-select-modal',
    'character-select-modal',
    'game-options-modal',
    'friend-add-modal',
    'duel-invites-modal'
];

function updateTelegramBackButton() {
    const tgApp = window.Telegram?.WebApp;
    if (!tgApp || !tgApp.BackButton) return;
    const hasV61 = typeof tgApp.isVersionAtLeast === 'function' ? tgApp.isVersionAtLeast('6.1') : false;
    if (!hasV61) return;

    try {
        const isModalOpen = ALL_MODAL_IDS.some(id => {
            const el = document.getElementById(id);
            return el && !el.classList.contains('hidden');
        });
        const inGameModalEl = document.getElementById('in-game-modal');
        const isInGameModalOpen = inGameModalEl && !inGameModalEl.classList.contains('hidden');
        const isInGame = gameScreen && !gameScreen.classList.contains('hidden');

        if (isModalOpen || isInGameModalOpen || isInGame) {
            tgApp.BackButton.show();
        } else {
            tgApp.BackButton.hide();
        }
    } catch (e) {
        console.warn('Telegram BackButton error:', e);
    }
}

function handleGlobalBack() {
    // 1. Agar biron menyu modali ochiq bo'lsa, uni yopamiz
    for (const id of ALL_MODAL_IDS) {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('hidden')) {
            closeModalSafely(el);
            updateTelegramBackButton();
            return;
        }
    }

    // 2. Agar o'yin (jang) ekranida bo'lsa:
    const inGameModalEl = document.getElementById('in-game-modal');
    const isInGameModalOpen = inGameModalEl && !inGameModalEl.classList.contains('hidden');
    const isInGame = gameScreen && !gameScreen.classList.contains('hidden');

    if (isInGame) {
        if (isInGameModalOpen) {
            // Menyu ochiq turganda yana ortga bosilsa - asosiy menyuga chiqish
            inGameModalEl.classList.add('hidden');
            location.reload();
        } else {
            // O'yin ichida turgan paytda - o'yin ichki menyusini ochamiz
            if (inGameMenuBtn) {
                inGameMenuBtn.click();
            } else if (inGameModalEl) {
                inGameModalEl.classList.remove('hidden');
            }
        }
        updateTelegramBackButton();
        return;
    }

    updateTelegramBackButton();
}

if (window.Telegram?.WebApp?.BackButton) {
    const tgApp = window.Telegram.WebApp;
    const hasV61 = typeof tgApp.isVersionAtLeast === 'function' ? tgApp.isVersionAtLeast('6.1') : false;
    if (hasV61) {
        try {
            tgApp.BackButton.onClick(handleGlobalBack);
        } catch (e) {
            console.warn('Telegram BackButton onClick error:', e);
        }
    }
}

const btnInGameBack = document.getElementById('btn-in-game-back');
if (btnInGameBack) {
    btnInGameBack.addEventListener('click', handleGlobalBack);
}

function closeModalSafely(modalEl, e) {
    if (e) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
    if (modalEl) modalEl.classList.add('hidden');
    // Ensure all other modals are closed too so nothing remains stranded
    for (const id of ALL_MODAL_IDS) {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    }
    if (returnToGameOverAfterModal) {
        returnToGameOverAfterModal = false;
        if (gameOverScreen) gameOverScreen.classList.remove('hidden');
    } else if (menuScreen) {
        menuScreen.classList.remove('hidden');
        // Prevent delayed mobile touch click from triggering underlying menu buttons
        menuScreen.style.pointerEvents = 'none';
        setTimeout(() => {
            if (menuScreen) menuScreen.style.pointerEvents = '';
        }, 400);
    }
    if (typeof updateMenuWallpaper === 'function') updateMenuWallpaper();
    updateTelegramBackButton();
}

function openModalSafely(modalEl, e) {
    if (e) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
    // HIDE ALL OTHER MODALS TO GUARANTEE ONLY ONE MODAL IS ACTIVE
    for (const id of ALL_MODAL_IDS) {
        const el = document.getElementById(id);
        if (el && el !== modalEl) {
            el.classList.add('hidden');
        }
    }
    if (modalEl) {
        modalEl.classList.remove('hidden');
        if (modalEl === charSelectModal) {
            modalEl.style.pointerEvents = 'auto';
        } else {
            // Shield the newly opened modal from any ghost clicks
            modalEl.style.pointerEvents = 'none';
            setTimeout(() => {
                if (modalEl) modalEl.style.pointerEvents = '';
            }, 320);
        }
    }
    if (menuScreen) {
        menuScreen.classList.add('hidden');
        menuScreen.style.pointerEvents = 'none';
    }
    if (typeof updateMenuWallpaper === 'function') updateMenuWallpaper();
    updateTelegramBackButton();
}

// Settings Modal
const btnSettings = document.getElementById('btn-settings');
const btnProfile = document.getElementById('btn-profile');
const btnOpenHelp = document.getElementById('btn-open-help');
const helpModal = document.getElementById('help-modal');
const btnCloseHelp = document.getElementById('btn-close-help');
const btnCloseHelpX = document.getElementById('btn-close-help-x');
const settingsModal = document.getElementById('settings-modal');
const profileModal = document.getElementById('profile-modal');
const btnSaveSettings = document.getElementById('btn-save-settings');
const btnCloseSettingsX = document.getElementById('btn-close-settings-x');
const btnSaveProfile = document.getElementById('btn-save-profile');
const btnCloseProfileX = document.getElementById('btn-close-profile-x');
const btnCloseShopX = document.getElementById('btn-close-shop-x');
const btnCloseRatingX = document.getElementById('btn-close-rating-x');
const btnCloseAboutX = document.getElementById('btn-close-about-x');

// Character Selection Modal (Jangga kirishdan oldin qahramon tanlash)
const charSelectModal = document.getElementById('character-select-modal');
const charSelectRoster = document.getElementById('char-select-roster');
const btnCharSelectConfirm = document.getElementById('btn-char-select-confirm');
const btnCharSelectCancel = document.getElementById('btn-char-select-cancel');
const txtCharSelectTitle = document.getElementById('txt-char-select-title');
const txtCharSelectSub = document.getElementById('txt-char-select-sub');

let selectedCharRosterId = null;
let pendingCharSelectCallback = null;
let pendingCharSelectCancel = null;

function getAllCharactersList() {
    const list = [
        {
            id: 2,
            name: "Usmoniy Kamonboz",
            weaponType: "bow",
            weaponLabel: "🏹 Kamon",
            image: "Kamonlik%20Usmoniy/kamonlik%201.png",
            bgMusic: 'music.mp3'
        },
        {
            id: 3,
            name: "Usmoniy Nayzaboz",
            weaponType: "spear",
            weaponLabel: "🗡️ Nayza",
            image: "Nayzalik%20Usmoniy/Jangchi%20nayza%201.png",
            bgMusic: 'music.mp3'
        }
    ];

    if (Array.isArray(window.customModelsInfo) && window.customModelsInfo.length > 0) {
        window.customModelsInfo.forEach(m => {
            const wType = (m.weaponType === 'spear') ? 'spear' : 'bow';
            const img = m.textures?.shieldIdle || m.textures?.noShieldIdle || `custom_models/${m.id}.png`;
            list.push({
                id: m.id,
                name: m.name || "Qahramon",
                weaponType: wType,
                weaponLabel: wType === 'spear' ? "🗡️ Nayza" : "🏹 Kamon",
                image: img,
                bgMusic: m.bgMusic || null
            });
        });
    }

    return list;
}

function renderCharacterSelectRoster(activeId) {
    if (!charSelectRoster) return;
    charSelectRoster.innerHTML = '';

    const list = getAllCharactersList();
    const currentLang = (typeof myProfile !== 'undefined' && myProfile.lang) ? myProfile.lang : 'uz';
    const t = translations[currentLang] || translations.uz;
    const badgeText = t.selectedBadge || "Tanlangan";

    if (activeId === null || activeId === undefined) {
        activeId = myProfile?.charType || 2;
    }
    selectedCharRosterId = activeId;

    let lastCardSelectTime = 0;

    list.forEach(c => {
        const card = document.createElement('div');
        const isSel = String(c.id) === String(activeId);
        card.className = `char-card ${isSel ? 'selected' : ''}`;
        card.setAttribute('data-char-id', String(c.id));
        card.tabIndex = 0;

        const badgeClass = c.weaponType === 'spear' ? 'badge-spear' : 'badge-bow';
        card.innerHTML = `
            <div class="char-card-badge ${badgeClass}">${c.weaponLabel}</div>
            <div class="char-card-avatar-wrap">
                <img class="char-card-img" src="${c.image}" alt="${c.name}" loading="lazy" />
                <div class="char-card-pedestal"></div>
            </div>
            <div class="char-card-name" title="${c.name}">${c.name}</div>
            <div class="char-card-selected-indicator">${badgeText}</div>
        `;

        const onSelect = (e) => {
            if (e) {
                if (typeof e.preventDefault === 'function') e.preventDefault();
                if (typeof e.stopPropagation === 'function') e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            }
            const now = Date.now();
            if (now - lastCardSelectTime < 200) return;
            lastCardSelectTime = now;

            selectedCharRosterId = c.id;
            const allCards = charSelectRoster.querySelectorAll('.char-card');
            allCards.forEach(el => {
                if (el.getAttribute('data-char-id') === String(c.id)) {
                    el.classList.add('selected');
                } else {
                    el.classList.remove('selected');
                }
            });
            if (typeof playSound === 'function') {
                try { playSound('click'); } catch (_) { }
            }
        };

        let touchStartX = 0;
        let touchStartY = 0;
        let hasMoved = false;

        card.addEventListener('touchstart', (e) => {
            if (e.touches && e.touches[0]) {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
            }
            hasMoved = false;
        }, { passive: true });

        card.addEventListener('touchmove', (e) => {
            if (e.touches && e.touches[0]) {
                const dx = Math.abs(e.touches[0].clientX - touchStartX);
                const dy = Math.abs(e.touches[0].clientY - touchStartY);
                if (dx > 6 || dy > 6) {
                    hasMoved = true;
                }
            }
        }, { passive: true });

        card.addEventListener('touchend', (e) => {
            if (hasMoved) return;
            onSelect(e);
        }, { passive: false });
        card.addEventListener('click', (e) => {
            if (hasMoved) return;
            onSelect(e);
        });

        charSelectRoster.appendChild(card);
    });

    // Barmoq va sichqoncha bilan ro'yxatni erkin surib ko'rish (Drag to scroll)
    if (!charSelectRoster.dataset.dragBound) {
        charSelectRoster.dataset.dragBound = 'true';
        let isRosterDown = false;
        let rosterStartX = 0;
        let rosterScrollLeft = 0;

        charSelectRoster.addEventListener('mousedown', (e) => {
            isRosterDown = true;
            rosterStartX = e.pageX - charSelectRoster.offsetLeft;
            rosterScrollLeft = charSelectRoster.scrollLeft;
        });
        window.addEventListener('mouseup', () => { isRosterDown = false; });
        charSelectRoster.addEventListener('mousemove', (e) => {
            if (!isRosterDown) return;
            e.preventDefault();
            const x = e.pageX - charSelectRoster.offsetLeft;
            const walk = (x - rosterStartX) * 1.5;
            charSelectRoster.scrollLeft = rosterScrollLeft - walk;
        });
    }

    requestAnimationFrame(() => {
        const selCard = charSelectRoster.querySelector('.char-card.selected');
        if (selCard && typeof selCard.scrollIntoView === 'function') {
            selCard.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    });
}

function openCharacterSelectModal(options = {}) {
    pendingCharSelectCallback = options.onConfirm || null;
    pendingCharSelectCancel = options.onCancel || null;
    isCharSelectTransitioning = false;

    // Disallow background touch bleed-through while modal is open
    if (menuScreen) {
        menuScreen.classList.add('hidden');
        menuScreen.style.pointerEvents = 'none';
    }
    for (const id of ALL_MODAL_IDS) {
        if (id !== 'character-select-modal') {
            const el = document.getElementById(id);
            if (el) {
                el.classList.add('hidden');
                el.style.pointerEvents = 'none';
            }
        }
    }

    const currentLang = (typeof myProfile !== 'undefined' && myProfile.lang) ? myProfile.lang : 'uz';
    const t = translations[currentLang] || translations.uz;
    if (txtCharSelectTitle) txtCharSelectTitle.innerText = t.charSelectTitle || "Qahramoningizni tanlang";
    if (txtCharSelectSub) txtCharSelectSub.innerText = t.charSelectSub || "Jangga kirishdan oldin jangchi modelini tanlang";
    if (btnCharSelectConfirm) {
        const span = btnCharSelectConfirm.querySelector('span') || btnCharSelectConfirm;
        span.innerText = t.enterBattle || "⚔️ Jangga kirish";
    }

    const initialId = options.defaultCharId !== undefined ? options.defaultCharId : (myProfile?.charType || 2);
    renderCharacterSelectRoster(initialId);

    if ((!window.customModelsInfo || window.customModelsInfo.length === 0) && typeof fetchCustomModels === 'function') {
        fetchCustomModels().then(() => {
            renderCharacterSelectRoster(selectedCharRosterId || initialId);
        }).catch(() => { });
    }

    openModalSafely(charSelectModal);
    if (charSelectModal) charSelectModal.style.pointerEvents = 'auto';
}

let isCharSelectTransitioning = false;
let lastConfirmClickTime = 0;

if (btnCharSelectConfirm) {
    const handleCharConfirm = (e) => {
        if (e) {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        }
        const now = Date.now();
        if (now - lastConfirmClickTime < 600 || isCharSelectTransitioning) return;
        lastConfirmClickTime = now;
        isCharSelectTransitioning = true;
        setTimeout(() => { isCharSelectTransitioning = false; }, 800);

        // Cancel callback is nullified immediately so onCancel can NEVER be triggered!
        pendingCharSelectCancel = null;

        if (selectedCharRosterId !== null && selectedCharRosterId !== undefined) {
            myProfile.charType = selectedCharRosterId;
            try {
                localStorage.setItem('nayza_profile', JSON.stringify(myProfile));
                if (playerIdReadonly) playerIdReadonly.value = myProfile.playerId;
            } catch (_) { }

            const s1 = document.getElementById('select-char-type');
            if (s1) s1.value = String(myProfile.charType);
            const s2 = document.getElementById('select-char-type-options');
            if (s2) s2.value = String(myProfile.charType);

            const chars = getAllCharactersList();
            const chosen = chars.find(c => String(c.id) === String(selectedCharRosterId));
            if (chosen && chosen.bgMusic) {
                selectedMusicTrack = chosen.bgMusic;
            } else {
                selectedMusicTrack = localStorage.getItem('nayza_music_track') || 'music.mp3';
            }
            if (typeof applySelectedMusicTrack === 'function') applySelectedMusicTrack();

            if (socket && socket.connected) {
                socket.emit('updateProfile', myProfile);
                socket.emit('registerProfile', myProfile);
            }
        }

        if (charSelectModal) charSelectModal.classList.add('hidden');

        // Prevent ghost click pass-through on release by keeping background non-interactive for 450ms
        const suppressGhost = (ge) => {
            ge.preventDefault();
            ge.stopPropagation();
            ge.stopImmediatePropagation();
        };
        window.addEventListener('click', suppressGhost, { capture: true, once: true });
        setTimeout(() => {
            window.removeEventListener('click', suppressGhost, { capture: true });
            if (menuScreen && !menuScreen.classList.contains('hidden')) menuScreen.style.pointerEvents = '';
            if (singleModeModal && !singleModeModal.classList.contains('hidden')) singleModeModal.style.pointerEvents = '';
            if (levelSelectModal && !levelSelectModal.classList.contains('hidden')) levelSelectModal.style.pointerEvents = '';
            if (multiMenu && !multiMenu.classList.contains('hidden')) multiMenu.style.pointerEvents = '';
        }, 450);

        const cb = pendingCharSelectCallback;
        pendingCharSelectCallback = null;
        if (typeof cb === 'function') {
            try {
                cb(myProfile.charType);
            } catch (err) {
                console.error("Error executing character confirm callback:", err);
            }
        }
    };
    btnCharSelectConfirm.addEventListener('click', handleCharConfirm);
    btnCharSelectConfirm.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleCharConfirm(e);
    }, { passive: false });
}

if (btnCharSelectCancel) {
    const handleCharCancel = (e) => {
        if (e) {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        }
        if (isCharSelectTransitioning) return; // Prevent cancel while confirmation is in progress

        if (charSelectModal) charSelectModal.classList.add('hidden');

        const suppressGhost = (ge) => {
            ge.preventDefault();
            ge.stopPropagation();
            ge.stopImmediatePropagation();
        };
        window.addEventListener('click', suppressGhost, { capture: true, once: true });
        setTimeout(() => {
            window.removeEventListener('click', suppressGhost, { capture: true });
            if (menuScreen && !menuScreen.classList.contains('hidden')) menuScreen.style.pointerEvents = '';
            if (singleModeModal && !singleModeModal.classList.contains('hidden')) singleModeModal.style.pointerEvents = '';
            if (levelSelectModal && !levelSelectModal.classList.contains('hidden')) levelSelectModal.style.pointerEvents = '';
            if (multiMenu && !multiMenu.classList.contains('hidden')) multiMenu.style.pointerEvents = '';
        }, 450);

        if (typeof pendingCharSelectCancel === 'function') {
            const onCancel = pendingCharSelectCancel;
            pendingCharSelectCallback = null;
            pendingCharSelectCancel = null;
            onCancel();
        }
    };
    btnCharSelectCancel.addEventListener('click', handleCharCancel);
    btnCharSelectCancel.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleCharCancel(e);
    }, { passive: false });
}

function openProfileSettingsModal(e) {
    if (e) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
    const inputName = document.getElementById('input-name');
    if (inputName) inputName.value = myProfile.name;
    const selectAvatar = document.getElementById('select-avatar');
    if (selectAvatar) selectAvatar.value = myProfile.avatar;
    const selectCharType = document.getElementById('select-char-type');
    if (selectCharType) selectCharType.value = String(myProfile.charType || 2);

    // Fix for flag selection (extract emoji)
    const countrySelect = document.getElementById('select-country');
    if (countrySelect) {
        for (let opt of countrySelect.options) {
            if (opt.value.includes(myProfile.flag)) {
                countrySelect.value = opt.value;
                break;
            }
        }
    }

    if (playerIdReadonly) playerIdReadonly.value = myProfile.playerId;
    const selectSpearModel = document.getElementById('select-spear-model');
    if (selectSpearModel) selectSpearModel.value = String(myProfile.spearModel || 0);

    // Profil modalidagi barcha dropdownlarni custom in-DOM landscape qilib yangilaymiz
    if (typeof setupCustomDropdown === 'function') {
        ['select-char-type', 'select-avatar', 'select-spear-model', 'select-country'].forEach(id => {
            const el = document.getElementById(id);
            if (el) setupCustomDropdown(el);
        });
    }

    updateSuperUI();
    openModalSafely(profileModal, e);
}

if (btnProfile) {
    const safeOpenProfile = safeModalAction(openProfileSettingsModal);
    btnProfile.addEventListener('click', safeOpenProfile);
    btnProfile.addEventListener('touchend', safeOpenProfile, { passive: false });
}

if (btnSettings) {
    const handleOpenSettings = safeModalAction((e) => {
        const selectLang = document.getElementById('select-lang');
        if (selectLang) selectLang.value = myProfile.lang;
        openModalSafely(settingsModal, e);
    });
    btnSettings.addEventListener('click', handleOpenSettings);
    btnSettings.addEventListener('touchend', handleOpenSettings, { passive: false });
}

if (btnLogout) {
    const handleLogout = safeModalAction(() => {
        // Telegram orqali kirilgan bo'lsa, o'yinni/mini-appni yopamiz (logout bo'lmasin!)
        const tgApp = window.Telegram?.WebApp;
        if (tgApp && typeof tgApp.close === 'function') {
            try {
                tgApp.close();
                return;
            } catch (err) {
                console.warn('Telegram close error:', err);
            }
        }
        // Agar Telegram bo'lmasa, oddiy brauzerda logout qilamiz
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
    btnLogout.addEventListener('click', handleLogout);
    btnLogout.addEventListener('touchend', handleLogout, { passive: false });
}

function handleSaveSettings(e) {
    if (e) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
    const selectLang = document.getElementById('select-lang');
    if (selectLang) myProfile.lang = selectLang.value;
    saveProfile();

    if (settingsMusicTrackSelect) {
        selectedMusicTrack = String(settingsMusicTrackSelect.value || 'music.mp3');
        if (typeof applyMusicSettings === 'function') applyMusicSettings();
        if (typeof saveMusicSettings === 'function') saveMusicSettings();
    }

    closeModalSafely(settingsModal, e);
    const t = (typeof translations !== 'undefined' && translations[myProfile.lang]) ? translations[myProfile.lang] : translations.uz;
    showCenterNotice(t.settingsSaved || "Sozlamalar saqlandi!", 1500);
}

if (btnSaveSettings) {
    const safeSaveSettings = safeModalAction(handleSaveSettings);
    btnSaveSettings.addEventListener('click', safeSaveSettings);
    btnSaveSettings.addEventListener('touchend', safeSaveSettings, { passive: false });
}

if (btnCloseSettingsX) {
    const handleCloseSettingsX = safeModalAction((e) => closeModalSafely(settingsModal, e));
    btnCloseSettingsX.addEventListener('click', handleCloseSettingsX);
    btnCloseSettingsX.addEventListener('touchend', handleCloseSettingsX, { passive: false });
}

function handleSaveProfile(e) {
    if (e) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
    myProfile.name = document.getElementById('input-name').value || "Jangchi";
    myProfile.avatar = document.getElementById('select-avatar').value;
    const selectedCharType = document.getElementById('select-char-type').value || 2;
    myProfile.charType = selectedCharType;
    myProfile.flag = document.getElementById('select-country').value;
    const selSpear = document.getElementById('select-spear-model');
    if (selSpear) myProfile.spearModel = Number(selSpear.value || 0);

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

    closeModalSafely(profileModal, e);
    showCenterNotice("Profil saqlandi!", 1500);
}

if (btnSaveProfile) {
    const safeSaveProfile = safeModalAction(handleSaveProfile);
    btnSaveProfile.addEventListener('click', safeSaveProfile);
    btnSaveProfile.addEventListener('touchend', safeSaveProfile, { passive: false });
}

if (btnCloseProfileX) {
    const handleCloseProfileX = safeModalAction((e) => closeModalSafely(profileModal, e));
    btnCloseProfileX.addEventListener('click', handleCloseProfileX);
    btnCloseProfileX.addEventListener('touchend', handleCloseProfileX, { passive: false });
}

if (btnOpenHelp && helpModal) {
    const handleOpenHelp = (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        if (settingsModal) settingsModal.classList.add('hidden');
        if (helpModal) helpModal.classList.remove('hidden');
    };
    btnOpenHelp.addEventListener('click', handleOpenHelp);
    btnOpenHelp.addEventListener('touchend', handleOpenHelp, { passive: false });
}
if (btnCloseHelp && helpModal) {
    const handleCloseHelp = (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        if (helpModal) helpModal.classList.add('hidden');
        if (settingsModal) settingsModal.classList.remove('hidden');
    };
    btnCloseHelp.addEventListener('click', handleCloseHelp);
    btnCloseHelp.addEventListener('touchend', handleCloseHelp, { passive: false });
}
if (btnCloseHelpX && helpModal) {
    const handleCloseHelpX = (e) => closeModalSafely(helpModal, e);
    btnCloseHelpX.addEventListener('click', handleCloseHelpX);
    btnCloseHelpX.addEventListener('touchend', handleCloseHelpX, { passive: false });
}

if (btnShop && shopModal) {
    const handleOpenShop = safeModalAction((e) => {
        updateSuperUI();
        openModalSafely(shopModal, e);
    });
    btnShop.addEventListener('click', handleOpenShop);
    btnShop.addEventListener('touchend', handleOpenShop, { passive: false });
}

if (btnCloseShop && shopModal) {
    const handleCloseShop = safeModalAction((e) => closeModalSafely(shopModal, e));
    btnCloseShop.addEventListener('click', handleCloseShop);
    btnCloseShop.addEventListener('touchend', handleCloseShop, { passive: false });
}

if (btnCloseShopX && shopModal) {
    const handleCloseShopX = safeModalAction((e) => closeModalSafely(shopModal, e));
    btnCloseShopX.addEventListener('click', handleCloseShopX);
    btnCloseShopX.addEventListener('touchend', handleCloseShopX, { passive: false });
}

if (btnAbout && aboutModal) {
    const handleOpenAbout = safeModalAction((e) => openModalSafely(aboutModal, e));
    btnAbout.addEventListener('click', handleOpenAbout);
    btnAbout.addEventListener('touchend', handleOpenAbout, { passive: false });
}

if (btnCloseAbout && aboutModal) {
    const handleCloseAbout = safeModalAction((e) => closeModalSafely(aboutModal, e));
    btnCloseAbout.addEventListener('click', handleCloseAbout);
    btnCloseAbout.addEventListener('touchend', handleCloseAbout, { passive: false });
}

if (btnCloseAboutX && aboutModal) {
    const handleCloseAboutX = safeModalAction((e) => closeModalSafely(aboutModal, e));
    btnCloseAboutX.addEventListener('click', handleCloseAboutX);
    btnCloseAboutX.addEventListener('touchend', handleCloseAboutX, { passive: false });
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
const btnCopyEmail = document.getElementById('btn-copy-email');
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
if (btnCopyEmail) {
    btnCopyEmail.addEventListener('click', () => {
        copyDonateValue('Abiturientlaruchun@gmail.com', btnCopyEmail);
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

if (btnBuyArtillery) {
    btnBuyArtillery.addEventListener('click', () => {
        const cur = Math.max(0, Number(myProfile.artillery || 0));
        if (Number(myStats.score || 0) < ARTILLERY_BUY_COST) return;
        addScore(-ARTILLERY_BUY_COST);
        myProfile.artillery = cur + 1;
        saveProfile();
        updateSuperUI();
    });
}

if (btnBuyCrowhunt) {
    btnBuyCrowhunt.addEventListener('click', () => {
        const cur = Math.max(0, Number(myProfile.crowhunt || 0));
        if (Number(myStats.score || 0) < CROWHUNT_BUY_COST) return;
        addScore(-CROWHUNT_BUY_COST);
        myProfile.crowhunt = cur + 1;
        saveProfile();
        updateSuperUI();
    });
}

if (btnBuyFire) {
    btnBuyFire.addEventListener('click', () => {
        const cur = Math.max(0, Number(myProfile.fireSpears || 0));
        if (Number(myStats.score || 0) < FIRE_SPEAR_BUY_COST) return;
        addScore(-FIRE_SPEAR_BUY_COST);
        myProfile.fireSpears = cur + 1;
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

const btnGuestPlay = document.getElementById('btn-guest-play');
if (btnGuestPlay) {
    const handleGuestPlay = safeModalAction((e) => {
        if (authModal) authModal.classList.add('hidden');
        if (menuScreen) menuScreen.classList.remove('hidden');
        if (typeof updateMenuWallpaper === 'function') updateMenuWallpaper();
    });
    btnGuestPlay.addEventListener('click', handleGuestPlay);
    btnGuestPlay.addEventListener('touchend', handleGuestPlay, { passive: false });
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
        walls: Math.max(0, Number(myProfile.walls || 0)),
        artillery: Math.max(0, Number(myProfile.artillery || 0)),
        crowhunt: Math.max(0, Number(myProfile.crowhunt || 0)),
        fireSpears: Math.max(0, Number(myProfile.fireSpears || 0))
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
            } catch (_) { }
        }
    }
}

let currentLeaderboardRows = [];

async function renderLeaderboard() {
    console.log('renderLeaderboard called, leaderboardList:', !!leaderboardList);
    if (!leaderboardList) return;
    const t = translations[myProfile.lang] || translations.en || translations.uz;

    const renderRows = (rows) => {
        if (!Array.isArray(rows) || !rows.length) {
            leaderboardList.innerHTML = '<p style="color:#94a3b8; text-align:center; padding:10px;">O\'yinchi topilmadi</p>';
            return false;
        }
        currentLeaderboardRows = rows;
        leaderboardList.innerHTML = rows.map((r, idx) => {
            const playerId = r.playerId || r.phone || r.name;
            const isMe = playerId && myProfile.playerId && (playerId === myProfile.playerId || playerId === myProfile.phone);
            const showButton = !isMe && r.name !== myProfile.name;
            const buttonHtml = showButton ? `<button class="primary-btn btn-challenge-row" data-fid="${playerId}" data-fname="${r.name}" style="padding:4px 8px; font-size:0.7rem; background:linear-gradient(135deg, #f43f5e, #be123c); border-radius:6px;">⚔️ Duel</button>` : '';

            const avatarMarkup = r.photoUrl
                ? `<img src="${r.photoUrl}" style="width:24px; height:24px; border-radius:50%; object-fit:cover; margin-right:4px; vertical-align:middle;">`
                : `<span style="font-size:1.05rem; margin-right:4px;">${r.flag || '🇺🇿'}</span>`;

            return `<div class="leaderboard-item-row" data-fid="${playerId}" data-fname="${r.name}" style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px; padding:6px 8px; border-radius:8px; background:rgba(30,41,59,0.45); cursor:pointer;">
                <div style="display:flex; align-items:center; gap:6px;">
                    <span style="color:#94a3b8; font-size:0.8rem; min-width:18px;">#${idx + 1}</span>
                    ${avatarMarkup}
                    <span style="font-weight:600; color:#f8fafc;">${r.name}</span>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="color:#fbbf24; font-weight:700;">⭐ ${r.score}</span>
                    ${buttonHtml}
                </div>
            </div>`;
        }).join('');

        // 1. Duelga chaqirish tugmasi
        leaderboardList.querySelectorAll('.btn-challenge-row').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const toPlayerId = btn.getAttribute('data-fid');
                const toPlayerName = btn.getAttribute('data-fname');
                const targetRow = rows.find(r => (r.playerId || r.phone || r.name) === toPlayerId);
                openPlayerProfileModal(toPlayerId, toPlayerName, targetRow || {});
            });
        });

        // 2. Qator ustiga bosganda o'yinchi profili ochilishi
        leaderboardList.querySelectorAll('.leaderboard-item-row').forEach((row) => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                const toPlayerId = row.getAttribute('data-fid');
                const toPlayerName = row.getAttribute('data-fname');
                const targetRow = rows.find(r => (r.playerId || r.phone || r.name) === toPlayerId);
                openPlayerProfileModal(toPlayerId, toPlayerName, targetRow || {});
            });
        });

        return true;
    };

    // Qidiruv inputini ulash
    const searchInput = document.getElementById('leaderboard-search-input');
    if (searchInput && !searchInput._hasSearchHandler) {
        searchInput._hasSearchHandler = true;
        searchInput.addEventListener('input', (e) => {
            const q = (e.target.value || '').trim().toLowerCase();
            if (!q) {
                renderRows(currentLeaderboardRows);
            } else {
                const filtered = currentLeaderboardRows.filter(r => (r.name || '').toLowerCase().includes(q));
                renderRows(filtered);
            }
        });
    }

    let showedCached = false;
    try {
        const cachedRaw = localStorage.getItem(LEADERBOARD_CACHE_KEY);
        const cachedRows = cachedRaw ? JSON.parse(cachedRaw) : [];
        showedCached = renderRows(cachedRows);
    } catch (_) { }
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
        } catch (_) { }
    } catch (_) {
        if (!showedCached) leaderboardList.innerText = "Reytingni yuklashda xatolik.";
    }
}

if (btnRating) {
    const handleOpenRating = safeModalAction((e) => {
        const statScoreEl = document.getElementById('stat-score');
        const score = Number(myStats.score || 0);
        if (statScoreEl) {
            statScoreEl.innerText = score < 0 ? `Qarz: ${score}` : String(score);
            statScoreEl.style.color = score < 0 ? '#ef4444' : '#f59e0b';
        }
        const statGamesEl = document.getElementById('stat-games');
        if (statGamesEl) statGamesEl.innerText = myStats.games;
        const statWinsEl = document.getElementById('stat-wins');
        if (statWinsEl) statWinsEl.innerText = myStats.wins;
        renderLeaderboard();
        openModalSafely(ratingModal, e);
    });
    btnRating.addEventListener('click', handleOpenRating);
    btnRating.addEventListener('touchend', handleOpenRating, { passive: false });
}

if (btnCloseRating) {
    const handleCloseRating = safeModalAction((e) => closeModalSafely(ratingModal, e));
    btnCloseRating.addEventListener('click', handleCloseRating);
    btnCloseRating.addEventListener('touchend', handleCloseRating, { passive: false });
}
if (btnCloseRatingX) {
    const handleCloseRatingX = safeModalAction((e) => closeModalSafely(ratingModal, e));
    btnCloseRatingX.addEventListener('click', handleCloseRatingX);
    btnCloseRatingX.addEventListener('touchend', handleCloseRatingX, { passive: false });
}

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
        if (!isPaused) {
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
const isTgUser = Boolean(tg?.initDataUnsafe?.user);
if (isTgUser) {
    if (authModal) authModal.classList.add('hidden');
    if (menuScreen) menuScreen.classList.remove('hidden');
    autoLoginTelegramUser();
} else if (isUserLoggedIn()) {
    if (authModal) authModal.classList.add('hidden');
    if (menuScreen) menuScreen.classList.remove('hidden');
} else {
    if (authModal) authModal.classList.remove('hidden');
    if (menuScreen) menuScreen.classList.add('hidden');
}
if (playerIdReadonly) playerIdReadonly.value = myProfile.playerId;
if (socket && socket.connected) socket.emit('registerProfile', myProfile);

// Menyu/auth/profil/do'kon kabi ekranlardan biri ochiq bo'lsa wallpaper ko'rinadi,
// o'yin (game-screen) faol bo'lsa yashiriladi. Bu funksiya holatni avtomatik kuzatadi.
const _menuWallpaperEl = document.getElementById('menu-wallpaper');
const _wallpaperScreenIds = [
    'menu-screen', 'auth-modal', 'multi-menu', 'settings-modal', 'profile-modal',
    'shop-modal', 'rating-modal', 'about-modal', 'help-modal', 'single-mode-modal',
    'level-select-modal', 'game-options-modal', 'waiting-screen', 'game-over-screen',
    'daily-rewards-modal', 'daily-quests-modal'
];
function updateMenuWallpaper() {
    if (!_menuWallpaperEl) return;
    const introVisible = (() => {
        const intro = document.getElementById('intro-screen');
        return intro && !intro.classList.contains('hide');
    })();
    const gameVisible = (() => {
        const gs = document.getElementById('game-screen');
        return gs && !gs.classList.contains('hidden');
    })();
    let anyMenuVisible = false;
    for (const id of _wallpaperScreenIds) {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('hidden')) { anyMenuVisible = true; break; }
    }
    const shouldShow = !introVisible && !gameVisible && anyMenuVisible;
    _menuWallpaperEl.classList.toggle('show', shouldShow);
}
// Ekran holatlari turli joylarda o'zgargani uchun, doimiy yengil kuzatuv qo'yamiz.
setInterval(updateMenuWallpaper, 350);

// --- Kirish intro ekrani va Asset Preloader logikasi ---
(function setupIntroScreen() {
    const introScreen = document.getElementById('intro-screen');
    if (!introScreen) return;

    const fillEl = document.getElementById('intro-loader-fill');
    const percentEl = document.getElementById('intro-loader-percent');
    const statusEl = document.getElementById('intro-loader-status');
    const startBtn = document.getElementById('btn-intro-start');

    let introDismissed = false;
    let isPreloadDone = false;
    let currentDisplayPercent = 0;
    let targetPercent = 0;

    const dismissIntro = (e) => {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        if (introDismissed) return;
        introDismissed = true;
        try { sessionStorage.setItem('kamonboz_intro_seen', '1'); } catch (_) { }
        try { initAudio(); } catch (_) { }
        try { tryLockLandscapeOrientation(); } catch (_) { }
        introScreen.classList.add('hide');
        if (typeof updateMenuWallpaper === 'function') updateMenuWallpaper();
        setTimeout(() => {
            if (introScreen && introScreen.parentNode) introScreen.parentNode.removeChild(introScreen);
        }, 600);
    };

    const handleIntroStartGame = safeModalAction((e) => {
        dismissIntro(e);
        try { tryLockLandscapeOrientation(); } catch (_) { }

        // 1. Agar Telegramdan duel yoki xona havolasi orqali kirgan bo'lsa, avtomatik ulanadi:
        if (typeof checkAutoJoinTelegramRoom === 'function' && checkAutoJoinTelegramRoom()) {
            if (authModal) authModal.classList.add('hidden');
            if (menuScreen) {
                menuScreen.classList.add('hidden');
                menuScreen.style.setProperty('display', 'none', 'important');
            }
            return;
        }

        // 2. Havolasiz oddiy kirganda: Asosiy menyu ochilishi kerak (agar o'yinda bo'lmasa)
        if (shouldShowMainMenuOnAuth()) {
            gameMode = 'menu';
            if (authModal) authModal.classList.add('hidden');
            if (menuScreen) {
                menuScreen.style.removeProperty('display');
                menuScreen.classList.remove('hidden');
            }
            if (typeof updateCampaignUI === 'function') updateCampaignUI();
            if (typeof updateMenuWallpaper === 'function') updateMenuWallpaper();
        }
    });

    if (startBtn) {
        startBtn.addEventListener('click', handleIntroStartGame);
        startBtn.addEventListener('touchend', handleIntroStartGame, { passive: false });
    }

    const handleBackgroundDismiss = (e) => {
        if (currentDisplayPercent < 100) return;
        if (e.target === startBtn || (startBtn && startBtn.contains(e.target))) return;
        handleIntroStartGame(e);
    };
    introScreen.addEventListener('click', handleBackgroundDismiss);
    introScreen.addEventListener('touchend', handleBackgroundDismiss, { passive: true });

    // Preloader assets ro'yxati (o'yin grafikasi va tovushlari)
    const assetsToPreload = [
        'walpaper.png',
        'daraxtkatta.png',
        'daraxtkichkina.png',
        'qarga.png',
        'devortusiq.png',
        'Qala.png',
        'bulut-Photoroom.png',
        'artileriya.png',
        'sandik.png',
        'Kamonlik%20Usmoniy/kamonlik%201.png',
        'Kamonlik%20Usmoniy/kamonlik%20monjal.png',
        'Kamonlik%20Usmoniy/kamonlik%20uq%20uzdi.png',
        'Kamonlik%20Usmoniy/kamonlik%202%20himoya.png',
        'Kamonlik%20Usmoniy/yaradorkamonbozqalqonli.png',
        'Kamonlik%20Usmoniy/Otirgan%20qalqonli%20kamonboz.png',
        'Nayzalik%20Usmoniy/Jangchi%20nayza%201.png',
        'Nayzalik%20Usmoniy/Jangchi%20nayza%202.png',
        'Nayzalik%20Usmoniy/Jangchi%20nayza%203.png',
        'Nayzalik%20Usmoniy/Jangchi%20nayza%204.png',
        'Nayzalik%20Usmoniy/qalqonnayzautirgan.png',
        'jumong/stand.png',
        'jumong/aim.png',
        'jumong/afterShot.png',
        'jumong/hurt.png',
        'jumong/defend.png',
        'jumong/dead.png',
        'jumong/walk1.png',
        'jumong/walk2.png',
        'avatars/jumong.png',
        'avatars/archer_ottoman.png',
        'avatars/spear_ottoman.png',
        'sounds/hit.mp3',
        'sounds/bow_shoot.mp3',
        'sounds/spear_throw.mp3',
        'sounds/headshot.mp3',
        'sounds/win.mp3',
        'sounds/lose.mp3'
    ];

    let totalAssets = assetsToPreload.length;
    let loadedAssets = 0;

    function updatePreloaderUI() {
        if (fillEl) fillEl.style.width = currentDisplayPercent + '%';
        if (percentEl) percentEl.textContent = Math.round(currentDisplayPercent) + '%';
        if (statusEl) {
            if (currentDisplayPercent < 35) {
                statusEl.textContent = "Grafika fayllari yuklanmoqda...";
            } else if (currentDisplayPercent < 70) {
                statusEl.textContent = "Jangchilar va qurollar tayyorlanmoqda...";
            } else if (currentDisplayPercent < 100) {
                statusEl.textContent = "Ovoz va animatsiyalar sozlanmoqda...";
            } else {
                statusEl.textContent = "Tayyor! ⚔️";
            }
        }
    }

    const animInterval = setInterval(() => {
        if (currentDisplayPercent < targetPercent) {
            const step = Math.max(1, Math.ceil((targetPercent - currentDisplayPercent) * 0.25));
            currentDisplayPercent = Math.min(targetPercent, currentDisplayPercent + step);
            updatePreloaderUI();
        }

        if (currentDisplayPercent >= 100 && !isPreloadDone) {
            isPreloadDone = true;
            clearInterval(animInterval);
            updatePreloaderUI();
            if (startBtn) {
                startBtn.classList.remove('hidden');
                startBtn.style.opacity = '1';
                startBtn.style.pointerEvents = 'auto';
            }
            // Agar Telegramda bo'lsa yoki avval ko'rilgan bo'lsa, 700ms dan keyin avtomatik o'yinga kirish
            setTimeout(() => {
                if (!introDismissed) {
                    handleIntroStartGame();
                }
            }, 750);
        }
    }, 30);

    const onAssetItemDone = () => {
        loadedAssets++;
        targetPercent = Math.min(100, Math.floor((loadedAssets / totalAssets) * 100));
    };

    // Assetlarni birma-bir xavfsiz yuklab keshga joylash
    assetsToPreload.forEach(src => {
        const isAudio = src.endsWith('.mp3') || src.endsWith('.wav') || src.endsWith('.ogg');
        if (isAudio) {
            try {
                const aud = new Audio();
                aud.preload = 'auto';
                let resolved = false;
                const done = () => {
                    if (!resolved) {
                        resolved = true;
                        onAssetItemDone();
                    }
                };
                aud.addEventListener('canplaythrough', done, { once: true });
                aud.addEventListener('error', done, { once: true });
                aud.src = src;
                aud.load();
                setTimeout(done, 1500);
            } catch (_) {
                onAssetItemDone();
            }
        } else {
            const img = new Image();
            let resolved = false;
            const done = () => {
                if (!resolved) {
                    resolved = true;
                    onAssetItemDone();
                }
            };
            img.onload = done;
            img.onerror = done;
            img.src = src;
            setTimeout(done, 2000);
        }
    });

    // Maxsus modellarni ham yuklash
    if (typeof fetchCustomModels === 'function') {
        fetchCustomModels().then(() => {
            onAssetItemDone();
        }).catch(() => {
            onAssetItemDone();
        });
    }

    // Safety fallback: Eng ko'pi bilan 3.2 soniyada to'liq yuklab tugatadi
    setTimeout(() => {
        targetPercent = 100;
    }, 3200);
})();
socket.on('connect', () => {
    socket.emit('registerProfile', myProfile);
    if (typeof checkAutoJoinTelegramRoom === 'function') checkAutoJoinTelegramRoom();
});

// Android bildirishnoma ruxsati so'rash va notification tap listeneri
if (IS_NATIVE_APP) {
    const _initNotifications = () => {
        try {
            const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
            if (!LN) return;
            LN.requestPermissions().catch(() => { });
            LN.createChannel({
                id: 'invite',
                name: "O'yin taklifi",
                importance: 5,
                vibration: true,
                sound: 'default'
            }).catch(() => { });
            LN.addListener('localNotificationActionPerformed', () => {
                // Notification bosilganda invite modal'ini ko'rsatish
                if (pendingFriendInvite) {
                    if (friendInviteText) friendInviteText.innerText = `${pendingFriendInvite.fromProfile?.name || "Do'stingiz"} sizni o'yinga chaqirdi. Qo'shilasizmi?`;
                    if (friendInviteModal) friendInviteModal.classList.remove('hidden');
                }
            }).catch(() => { });
        } catch (_) { }
    };
    if (document.readyState === 'complete') {
        setTimeout(_initNotifications, 1000);
    } else {
        window.addEventListener('load', () => setTimeout(_initNotifications, 1000));
    }
}
if (authUserCache && authUserCache.phone) {
    applyAuthedUser(authUserCache);
}
if (authPhone) {
    const authBase = API_BASE || '';
    fetch(`${authBase}/api/auth/user?phone=${encodeURIComponent(authPhone)}`)
        .then((r) => r.json())
        .then((data) => {
            if (data && data.ok && data.user) applyAuthedUser(data.user);
            else if (!authUserCache || !authUserCache.phone) {
                if (!isTgUser) setAuthStatus("Ro'yxatdan o'ting yoki kiring.", true);
            }
        })
        .catch(() => {
            if (!authUserCache || !authUserCache.phone) {
                if (!isTgUser) setAuthStatus("Ro'yxatdan o'ting yoki kiring.", true);
            }
        });
} else if (!authUserCache || !authUserCache.phone) {
    if (!isTgUser) setAuthStatus("Ro'yxatdan o'ting yoki kiring.", true);
}
if (authTabLogin) authTabLogin.addEventListener('click', () => switchAuthTab('login'));
if (authTabRegister) authTabRegister.addEventListener('click', () => switchAuthTab('register'));
if (btnForgotToggle && forgotSection) {
    const handleForgotToggle = safeModalAction((e) => {
        const isHidden = forgotSection.classList.contains('hidden');
        forgotSection.classList.toggle('hidden', !isHidden);
        btnForgotToggle.innerText = isHidden ? "Parolni tiklash bo'limini yopish" : "Parolni unutdingizmi?";
    });
    btnForgotToggle.addEventListener('click', handleForgotToggle);
    btnForgotToggle.addEventListener('touchend', handleForgotToggle, { passive: false });
}
switchAuthTab('login');

document.addEventListener('click', (e) => {
    if (isTouchScrolling || (Date.now() - lastScrollEndTime < 280)) return;
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    if (t.closest('button')) playSfx('button', 0.85);
});

// Force touchstart to trigger click on mobile for all buttons
// BUG FIX: touchstart click trigger scroll'ni buzmasligi uchun scroll holatini tekshiramiz.
document.addEventListener('touchend', (e) => {
    if (isTouchScrolling || (Date.now() - lastScrollEndTime < 280)) return;
    const t = e.target;
    if (t && typeof t.closest === 'function') {
        const btn = t.closest('button');
        if (btn && !btn.disabled) {
            // Agar barmoq 8px dan ortiq surilmagan bo'lsa, demak bu haqiqiy tap/click
            const touch = e.changedTouches ? e.changedTouches[0] : null;
            if (touch) {
                const dist = Math.hypot(touch.clientX - touchStartX, touch.clientY - touchStartY);
                if (dist <= 8) {
                    lastTouchTriggerTime = Date.now();
                    btn.click();
                }
            }
        }
    }
}, { passive: true });

// Prevent delayed synthetic click on touch devices from ghost-clicking elements underneath or firing after scroll
document.addEventListener('click', (e) => {
    // Tugmalar yoki menyu cardlari bosilganda click hodisasini to'sib qo'ymaslik
    const isClickableTarget = e.target && typeof e.target.closest === 'function' &&
        e.target.closest('button, .menu-card, .char-card, a, .custom-select-option');
    if (isClickableTarget) return;

    if (isTouchScrolling || (Date.now() - lastScrollEndTime < 180)) {
        e.stopPropagation();
        e.preventDefault();
        return;
    }
    if (Date.now() - lastTouchTriggerTime < 350 && e.isTrusted) {
        e.stopPropagation();
        e.preventDefault();
        return;
    }
}, true);

// Missing Event Listeners
if (document.getElementById('btn-single')) {
    const handleSingle = (e) => {
        if (e) {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
        }
        if (typeof initAudio === 'function') initAudio();
        openCharacterSelectModal({
            onConfirm: () => {
                singleCampaignLevel = Math.max(1, parseInt(localStorage.getItem('nayza_single_level') || '1', 10));
                for (const id of ALL_MODAL_IDS) {
                    const el = document.getElementById(id);
                    if (el) el.classList.add('hidden');
                }
                if (levelSelectModal) levelSelectModal.classList.add('hidden');
                if (singleModeModal) singleModeModal.classList.add('hidden');
                if (menuScreen) menuScreen.classList.add('hidden');
                aiDifficulty = singleCampaignLevel < 6 ? 'easy' : singleCampaignLevel < 15 ? 'normal' : 'hard';
                gameMode = 'single';
                startSinglePlayer({ birds: true, animals: Math.random() > 0.45 });
            },
            onCancel: () => {
                if (menuScreen) menuScreen.classList.remove('hidden');
            }
        });
    };
    const btnSingle = document.getElementById('btn-single');
    btnSingle.addEventListener('click', handleSingle);
    btnSingle.addEventListener('touchend', (e) => {
        e.preventDefault();
        handleSingle(e);
    }, { passive: false });
}

if (btnSingleContinue) {
    const handleContinue = (e) => {
        if (e) {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
        }
        openCharacterSelectModal({
            onConfirm: () => {
                for (const id of ALL_MODAL_IDS) {
                    const el = document.getElementById(id);
                    if (el) el.classList.add('hidden');
                }
                if (singleModeModal) singleModeModal.classList.add('hidden');
                if (levelSelectModal) levelSelectModal.classList.add('hidden');
                if (menuScreen) menuScreen.classList.add('hidden');
                const level = Math.max(1, singleCampaignLevel);
                aiDifficulty = level < 6 ? 'easy' : level < 15 ? 'normal' : 'hard';
                gameMode = 'single';
                startSinglePlayer({ birds: true, animals: Math.random() > 0.45 });
            },
            onCancel: () => {
                if (singleModeModal) singleModeModal.classList.remove('hidden');
            }
        });
    };
    btnSingleContinue.addEventListener('click', handleContinue);
    btnSingleContinue.addEventListener('touchend', (e) => {
        e.preventDefault();
        handleContinue(e);
    }, { passive: false });
}

if (btnSingleNew) {
    const handleNew = (e) => {
        if (e) {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
        }
        openCharacterSelectModal({
            onConfirm: () => {
                singleCampaignLevel = 1;
                localStorage.setItem('nayza_single_level', '1');
                updateCampaignUI();
                for (const id of ALL_MODAL_IDS) {
                    const el = document.getElementById(id);
                    if (el) el.classList.add('hidden');
                }
                if (singleModeModal) singleModeModal.classList.add('hidden');
                if (levelSelectModal) levelSelectModal.classList.add('hidden');
                if (menuScreen) menuScreen.classList.add('hidden');
                aiDifficulty = 'easy';
                gameMode = 'single';
                startSinglePlayer({ birds: true, animals: Math.random() > 0.45 });
            },
            onCancel: () => {
                if (singleModeModal) singleModeModal.classList.remove('hidden');
            }
        });
    };
    btnSingleNew.addEventListener('click', handleNew);
    btnSingleNew.addEventListener('touchend', (e) => {
        e.preventDefault();
        handleNew(e);
    }, { passive: false });
}

if (btnSingleCancel) {
    const handleSingleCancel = safeModalAction((e) => closeModalSafely(singleModeModal, e));
    btnSingleCancel.addEventListener('click', handleSingleCancel);
    btnSingleCancel.addEventListener('touchend', handleSingleCancel, { passive: false });
}

if (btnSingleSelectLevel) {
    const handleSelectLevel = safeModalAction((e) => {
        if (singleModeModal) singleModeModal.classList.add('hidden');
        if (levelSelectModal) {
            levelSelectModal.classList.remove('hidden');
            renderLevelGrid();
        }
    });
    btnSingleSelectLevel.addEventListener('click', handleSelectLevel);
    btnSingleSelectLevel.addEventListener('touchend', handleSelectLevel, { passive: false });
}

if (btnLevelSelectCancel) {
    const handleLevelSelectCancel = safeModalAction((e) => {
        if (levelSelectModal) levelSelectModal.classList.add('hidden');
        if (singleModeModal) singleModeModal.classList.remove('hidden');
    });
    btnLevelSelectCancel.addEventListener('click', handleLevelSelectCancel);
    btnLevelSelectCancel.addEventListener('touchend', handleLevelSelectCancel, { passive: false });
}

function renderLevelGrid() {
    if (!levelGrid) return;
    levelGrid.innerHTML = '';

    // Barcha levellar ochiq (qulfsiz). Joriy level alohida rangda belgilanadi.
    const currentLevel = Math.max(1, singleCampaignLevel || 1);
    // Har bir muhit uchun kichik emoji belgisi (level oldindan ko'rinishi).
    const mapEmoji = {
        field: '🌿', castle: '🏰', desert: '🏜️', winter: '❄️', mountain: '⛰️',
        samarkand: '🕌', bukhara: '🏛️', istanbul: '🌉', oasis: '🌴', canyon: '🏕️', volcano: '🌋'
    };
    const TOTAL_LEVELS = 100;
    for (let i = 1; i <= TOTAL_LEVELS; i++) {
        const levelBtn = document.createElement('button');
        levelBtn.className = 'primary-btn';
        levelBtn.style.padding = '8px 4px';
        levelBtn.style.fontSize = '0.9rem';
        levelBtn.style.minHeight = '40px';
        levelBtn.style.display = 'flex';
        levelBtn.style.flexDirection = 'column';
        levelBtn.style.alignItems = 'center';
        levelBtn.style.justifyContent = 'center';
        levelBtn.style.lineHeight = '1.1';

        const env = getCampaignEnvironment(i);
        const emoji = mapEmoji[env.map] || '⚔️';
        // Boss levellar (50+ ikki dushman) qizil-binafsha bilan ajratiladi.
        const isBoss = i > 50;
        levelBtn.style.background = (i === currentLevel)
            ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
            : (isBoss
                ? 'linear-gradient(135deg, #a855f7, #6d28d9)'
                : 'linear-gradient(135deg, #10b981, #059669)');
        levelBtn.innerHTML = `<span style="font-size:1rem;font-weight:800;">${i}</span><span style="font-size:0.72rem;opacity:0.9;">${emoji}${isBoss ? '⚔️' : ''}</span>`;
        levelBtn.title = `Level ${i}${isBoss ? ' (2 dushman)' : ''}`;
        const handleLevelPick = (e) => {
            if (e) {
                if (typeof e.preventDefault === 'function') e.preventDefault();
                if (typeof e.stopPropagation === 'function') e.stopPropagation();
            }
            openCharacterSelectModal({
                onConfirm: () => {
                    singleCampaignLevel = i;
                    localStorage.setItem('nayza_single_level', String(i));
                    if (typeof updateCampaignUI === 'function') updateCampaignUI();
                    for (const id of ALL_MODAL_IDS) {
                        const el = document.getElementById(id);
                        if (el) el.classList.add('hidden');
                    }
                    if (levelSelectModal) levelSelectModal.classList.add('hidden');
                    if (singleModeModal) singleModeModal.classList.add('hidden');
                    if (menuScreen) menuScreen.classList.add('hidden');
                    aiDifficulty = i < 6 ? 'easy' : i < 15 ? 'normal' : 'hard';
                    gameMode = 'single';
                    startSinglePlayer({ birds: true, animals: Math.random() > 0.45 });
                },
                onCancel: () => {
                    if (levelSelectModal) levelSelectModal.classList.remove('hidden');
                }
            });
        };
        levelBtn.addEventListener('click', handleLevelPick);
        levelBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            handleLevelPick(e);
        }, { passive: false });

        levelGrid.appendChild(levelBtn);
    }
}

if (document.getElementById('btn-multi')) {
    const handleMulti = safeModalAction((e) => {
        if (typeof initAudio === 'function') initAudio();
        clearRandomWaitTimer();
        openModalSafely(multiMenu, e);
        renderFriendsList();
        socket.emit('friendsPresence', { ids: myFriends.map((f) => f.playerId) });
    });
    document.getElementById('btn-multi').addEventListener('click', handleMulti);
    document.getElementById('btn-multi').addEventListener('touchend', handleMulti, { passive: false });
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
    const handleMultiCreate = (e) => {
        if (e) {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
        }
        openCharacterSelectModal({
            onConfirm: () => {
                gameOptionsTargetMode = 'multiCreate';
                for (const id of ALL_MODAL_IDS) {
                    const el = document.getElementById(id);
                    if (el && id !== 'multi-menu') el.classList.add('hidden');
                }
                if (multiMenu) multiMenu.classList.remove('hidden');
                if (createCodeContainer) createCodeContainer.classList.remove('hidden');
                if (joinCodeContainer) joinCodeContainer.classList.add('hidden');
                if (joinError) joinError.style.display = 'none';

                const randomMaps = ['field', 'castle', 'registan', 'samarkand', 'bukhara', 'citadel', 'desert'];
                const autoMap = randomMaps[Math.floor(Math.random() * randomMaps.length)];
                socket.emit('createGame', {
                    profile: myProfile,
                    options: { map: autoMap, weather: 'sunny', birds: true, birdCount: 20, animals: false, charType: myProfile.charType }
                });
            },
            onCancel: () => {
                if (multiMenu) multiMenu.classList.remove('hidden');
            }
        });
    };
    btnMultiCreate.addEventListener('click', handleMultiCreate);
    btnMultiCreate.addEventListener('touchend', (e) => {
        e.preventDefault();
        handleMultiCreate(e);
    }, { passive: false });
}

if (btnMultiRandom) {
    let lastRandomClickTime = 0;
    const handleMultiRandom = (e) => {
        if (e) {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
        }
        const now = Date.now();
        if (now - lastRandomClickTime < 800) return;
        lastRandomClickTime = now;

        gameOptionsTargetMode = 'multiRandom';
        if (joinError) joinError.style.display = 'none';
        for (const id of ALL_MODAL_IDS) {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        }
        if (multiMenu) multiMenu.classList.add('hidden');
        if (menuScreen) {
            menuScreen.classList.add('hidden');
            menuScreen.style.setProperty('display', 'none', 'important');
        }
        if (waitingScreen) {
            waitingScreen.classList.remove('hidden');
            const waitTitle = waitingScreen.querySelector('h2') || waitingScreen.querySelector('.title');
            if (waitTitle) waitTitle.innerText = "🔍 Tasodifiy raqib qidirilmoqda...";
        }
        startRandomWaitTimer();
        if (socket && socket.connected) {
            socket.emit('findGame', { profile: myProfile, options: null });
        } else {
            showCenterNotice("Serverga ulanish kutilmoqda...", 2500);
        }
    };
    btnMultiRandom.addEventListener('click', handleMultiRandom);
    btnMultiRandom.addEventListener('touchend', handleMultiRandom, { passive: false });
}

if (btnMultiJoinShow) {
    const handleJoinShow = safeModalAction((e) => {
        if (joinCodeContainer) joinCodeContainer.classList.toggle('hidden');
        if (joinError) joinError.style.display = 'none';
    });
    btnMultiJoinShow.addEventListener('click', handleJoinShow);
    btnMultiJoinShow.addEventListener('touchend', handleJoinShow, { passive: false });
}

if (btnMultiJoin) {
    const handleMultiJoin = (e) => {
        if (e) {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
        }
        if (!socket || !socket.connected) {
            if (joinError) {
                joinError.innerText = "Serverga ulanilmadi. Internetni tekshiring va qayta urinib ko'ring.";
                joinError.style.display = 'block';
            }
            return;
        }
        const code = (inputJoinCode && inputJoinCode.value ? inputJoinCode.value : '').trim().toUpperCase().slice(0, 4);
        if (!code) return;

        openCharacterSelectModal({
            onConfirm: () => {
                for (const id of ALL_MODAL_IDS) {
                    const el = document.getElementById(id);
                    if (el) el.classList.add('hidden');
                }
                if (multiMenu) multiMenu.classList.add('hidden');
                if (menuScreen) menuScreen.classList.add('hidden');
                if (waitingScreen) waitingScreen.classList.remove('hidden');
                socket.emit('joinGame', { profile: myProfile, code });
            },
            onCancel: () => {
                if (multiMenu) multiMenu.classList.remove('hidden');
            }
        });
    };
    btnMultiJoin.addEventListener('click', handleMultiJoin);
    btnMultiJoin.addEventListener('touchend', (e) => {
        e.preventDefault();
        handleMultiJoin(e);
    }, { passive: false });
}

if (btnMultiBack) {
    const handleMultiBack = (e) => {
        clearRandomWaitTimer();
        closeModalSafely(multiMenu, e);
        if (createCodeContainer) createCodeContainer.classList.add('hidden');
        if (joinCodeContainer) joinCodeContainer.classList.add('hidden');
        if (joinError) joinError.style.display = 'none';
    };
    btnMultiBack.addEventListener('click', handleMultiBack);
    btnMultiBack.addEventListener('touchend', handleMultiBack, { passive: false });
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
        const diffWrap = document.getElementById('custom-wrap-select-difficulty');
        if (diffWrap) diffWrap.style.display = 'block';
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
        const diffWrap = document.getElementById('custom-wrap-select-difficulty');
        if (diffWrap) diffWrap.style.display = 'block';

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

if (document.getElementById('btn-cancel-multi')) {
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

// Telegram orqali do'stga taklifnoma yuborish
const btnShareTg = document.getElementById('btn-share-tg');
if (btnShareTg) {
    btnShareTg.addEventListener('click', () => {
        const code = (createCodeText ? createCodeText.innerText : '').trim();
        if (!code || code === '1234' || code === '...') {
            showCenterNotice("Avval o'yin xonasini yarating!");
            return;
        }
        triggerHaptic('selection');
        const botUsername = 'Kamonboz_bot';
        const inviteUrl = `https://t.me/${botUsername}?start=room_${encodeURIComponent(code)}`;
        const inviteText = `🏹 Men bilan Kamonboz duelida 1v1 nayza jangiga kiring!\n🔑 Xona kodi: ${code}\n👇 Havolani bosing va to'g'ridan-to'g'ri bot orqali jangga qo'shiling:`;
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(inviteText)}`;

        if (tg && typeof tg.openTelegramLink === 'function') {
            tg.openTelegramLink(shareUrl);
        } else {
            window.open(shareUrl, '_blank');
        }
    });
}

function getPendingRoomCode() {
    let code = null;
    // 1. Telegram start_param (Mini App)
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) {
        code = String(tg.initDataUnsafe.start_param);
    }
    // 2. URL search query parametrlari (?room=XYZ, ?startapp=XYZ, ?tgWebAppStartParam=XYZ)
    if (!code && window.location.search) {
        try {
            const sp = new URLSearchParams(window.location.search);
            code = sp.get('room') || sp.get('startapp') || sp.get('tgWebAppStartParam') || sp.get('code') || sp.get('join');
        } catch (_) { }
    }
    // 3. URL hash parametrlari (#tgWebAppStartParam=XYZ yoki #tgWebAppData=...&tgWebAppStartParam=XYZ)
    if (!code && window.location.hash) {
        try {
            const hashRaw = window.location.hash.replace(/^#/, '');
            const hp = new URLSearchParams(hashRaw);
            code = hp.get('tgWebAppStartParam') || hp.get('startapp') || hp.get('room') || hp.get('code');
            if (!code && hashRaw.includes('tgWebAppStartParam=')) {
                const m = hashRaw.match(/tgWebAppStartParam=([^&]+)/);
                if (m) code = decodeURIComponent(m[1]);
            }
        } catch (_) { }
    }
    // 4. SessionStorage
    if (!code) {
        try {
            code = sessionStorage.getItem('nayza_pending_room');
        } catch (_) { }
    }
    if (code) {
        code = String(code).replace(/^(room_|duel_)/i, '').trim().toUpperCase();
        if (code.length >= 3) {
            try { sessionStorage.setItem('nayza_pending_room', code); } catch (_) { }
            return code;
        }
    }
    return null;
}

// autoJoinExecuted is declared at top-level state
function checkAutoJoinTelegramRoom() {
    // 1. Agar URL da duel parametri bo'lsa (masalan duel_room yoki view=invites)
    if (typeof checkDuelUrlParams === 'function' && checkDuelUrlParams()) {
        return true;
    }

    const code = getPendingRoomCode();
    if (!code) return false;

    // Har qanday holatda inputga ham to'ldirib qo'yamiz
    if (inputJoinCode) inputJoinCode.value = code;

    if (autoJoinExecuted) return true;

    autoJoinExecuted = true;
    gameMode = 'multi';
    console.log('[AutoJoin] Xonaga avtomatik ulanmoqda:', code);

    // Barcha oraliq ekranlarni yashirish
    const introEl = document.getElementById('intro-screen');
    if (introEl) {
        introEl.classList.add('hide');
        introEl.style.display = 'none';
        if (introEl.parentNode) introEl.parentNode.removeChild(introEl);
    }
    if (authModal) authModal.classList.add('hidden');
    if (menuScreen) {
        menuScreen.classList.add('hidden');
        menuScreen.style.setProperty('display', 'none', 'important');
    }
    if (multiMenu) multiMenu.classList.add('hidden');
    if (joinCodeContainer) joinCodeContainer.classList.add('hidden');
    if (createCodeContainer) createCodeContainer.classList.add('hidden');
    if (gameOptionsModal) gameOptionsModal.classList.add('hidden');
    if (waitingScreen) waitingScreen.classList.remove('hidden');

    // Agar socket hali serverga ulanmagan bo'lsa, connect hodisasini kutamiz
    if (!socket || !socket.connected) {
        console.log('[AutoJoin] Socket ulanishi kutilmoqda. Xona kodi:', code);
        socket.once('connect', () => {
            showCenterNotice(`⚔️ Taklif qilingan duelga (${code}) ulanilmoqda...`, 3000);
            socket.emit('joinGame', { profile: myProfile, code });
        });
        return true;
    }

    showCenterNotice(`⚔️ Taklif qilingan duelga (${code}) ulanilmoqda...`, 3000);
    socket.emit('joinGame', { profile: myProfile, code });
    return true;
}

socket.on('joinError', (err) => {
    autoJoinExecuted = false;
    try { sessionStorage.removeItem('nayza_pending_room'); } catch (_) { }
    if (waitingScreen) waitingScreen.classList.add('hidden');
    if (multiMenu) multiMenu.classList.remove('hidden');
    if (joinCodeContainer) joinCodeContainer.classList.remove('hidden');
    if (joinError) {
        joinError.style.display = 'block';
        joinError.innerText = "Xona topilmadi yoki o'yin boshlanib ketgan.";
    }
    showCenterNotice("❌ Xona topilmadi yoki o'yin tugagan.", 3000);
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
    const handleAddFriendClick = (e) => {
        if (e) {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
        }
        if (gameMode !== 'multi') {
            showCenterNotice("Faqat onlayn o'yinda raqibni do'stlarga qo'shish mumkin!", 2500);
            return;
        }
        if (!currentOpponentProfile || !currentOpponentProfile.playerId) {
            showCenterNotice("Raqib ma'lumotlari topilmadi!", 2500);
            return;
        }
        const oppId = String(currentOpponentProfile.playerId);
        const alreadyFriend = myFriends.some(f => String(f.playerId) === oppId);
        if (alreadyFriend) {
            showCenterNotice(`${currentOpponentProfile.name || 'Raqib'} allaqachon do'stlaringiz ro'yxatida!`, 2500);
            btnAddFriend.innerText = "✓ Do'stlikda";
            btnAddFriend.disabled = true;
            return;
        }
        upsertFriend(currentOpponentProfile);
        renderFriendsList();
        if (socket && socket.connected) {
            socket.emit('addFriendDirect', { toPlayerId: currentOpponentProfile.playerId });
        }
        showCenterNotice(`✅ ${currentOpponentProfile.name || 'Raqib'} do'stlaringiz ro'yxatiga qo'shildi!`, 2500);
        btnAddFriend.innerText = "✓ Do'stlikda";
        btnAddFriend.disabled = true;
    };
    btnAddFriend.addEventListener('click', handleAddFriendClick);
    btnAddFriend.addEventListener('touchend', handleAddFriendClick, { passive: false });
}

socket.on('friendInvite', (payload) => {
    pendingFriendInvite = payload || null;
    if (!pendingFriendInvite) return;
    const fromName = pendingFriendInvite.fromProfile?.name || "Do'stingiz";
    if (friendInviteText) friendInviteText.innerText = `${fromName} sizni o'yinga chaqirdi. Qo'shilasizmi?`;
    if (friendInviteModal) friendInviteModal.classList.remove('hidden');
    // Android native notification
    if (IS_NATIVE_APP) {
        try {
            const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
            if (LN) {
                LN.schedule({
                    notifications: [{
                        id: 1001,
                        title: "\u2694\uFE0F O'yin taklifi!",
                        body: `${fromName} sizni Nayza Jangi o'yiniga chaqirdi! Bosing va o'ynang.`,
                        schedule: { at: new Date(Date.now() + 300) },
                        channelId: 'invite'
                    }]
                }).catch(() => { });
            }
        } catch (_) { }
    }
});

if (btnFriendInviteAccept) {
    const handleFriendInviteAccept = safeModalAction((e) => {
        if (friendInviteModal) friendInviteModal.classList.add('hidden');
        if (!pendingFriendInvite) return;
        const fromPlayerId = pendingFriendInvite.fromProfile?.playerId;
        openCharacterSelectModal({
            onConfirm: () => {
                socket.emit('friendInviteResponse', { fromPlayerId, accept: true, profile: myProfile });
                pendingFriendInvite = null;
            },
            onCancel: () => {
                socket.emit('friendInviteResponse', { fromPlayerId, accept: false, profile: myProfile });
                pendingFriendInvite = null;
            }
        });
    });
    btnFriendInviteAccept.addEventListener('click', handleFriendInviteAccept);
    btnFriendInviteAccept.addEventListener('touchend', handleFriendInviteAccept, { passive: false });
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

if (document.getElementById('btn-send-chat')) {
    document.getElementById('btn-send-chat').addEventListener('click', () => {
        const input = document.getElementById('chat-input');
        if (input && input.value.trim() !== '') {
            socket.emit('chatMessage', input.value.trim());
            input.value = '';
        }
    });
}
if (chatQuickEmojis) {
    const handleQuickEmoji = (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('.chat-emoji-btn') : null;
        if (!btn) return;
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        const msg = String(btn.dataset.emoji || '').trim();
        if (!msg) return;
        if (gameMode === 'multi' && typeof socket !== 'undefined' && socket) {
            socket.emit('chatMessage', msg);
        }
        addChatMessage(msg, true);
        spawnEmoteBubble(myPlayerIndex, msg);
    };
    chatQuickEmojis.addEventListener('click', handleQuickEmoji);
    chatQuickEmojis.addEventListener('touchend', handleQuickEmoji, { passive: false });
}

// ==========================================
// MODERN FEATURES: VIGNETTE, TIMER, EMOTES, AIR DROP, DAILY REWARDS & QUESTS
// ==========================================

function triggerScreenFlash(type = 'damage') {
    const el = document.getElementById('screen-vignette');
    if (!el) return;
    el.className = 'screen-vignette';
    void el.offsetWidth;
    if (type === 'headshot') {
        el.classList.add('vignette-headshot');
        setTimeout(() => { if (el) el.className = 'screen-vignette'; }, 650);
    } else {
        el.classList.add('vignette-damage');
        setTimeout(() => { if (el) el.className = 'screen-vignette'; }, 350);
    }
}

let turnTimerInterval = null;
let turnSecondsLeft = 30;

function startTurnTimerUI(duration = 30) {
    const badge = document.getElementById('turn-timer-badge');
    const txt = document.getElementById('turn-timer-text');
    if (!badge || !txt) return;
    clearInterval(turnTimerInterval);
    turnSecondsLeft = Math.max(1, Number(duration) || 30);
    badge.classList.remove('hidden', 'timer-warning');
    txt.innerText = turnSecondsLeft + ' s';

    turnTimerInterval = setInterval(() => {
        turnSecondsLeft--;
        if (turnSecondsLeft <= 0) {
            clearInterval(turnTimerInterval);
            turnSecondsLeft = 0;
            txt.innerText = '0 s';
            // Agar belgilangan 30 soniyada o'q uzilmasa, serverga vaqt tugaganini bildiramiz
            if (gameMode === 'multi' && socket && socket.connected) {
                socket.emit('reportTurnTimeout', { roomName: currentRoomName });
            }
            return;
        }
        txt.innerText = turnSecondsLeft + ' s';
        if (turnSecondsLeft <= 5) {
            badge.classList.add('timer-warning');
            playSfx('click');
        } else {
            badge.classList.remove('timer-warning');
        }
    }, 1000);
}

function stopTurnTimerUI() {
    clearInterval(turnTimerInterval);
    const badge = document.getElementById('turn-timer-badge');
    if (badge) badge.classList.add('hidden');
}

function initEmotesUI() {
    const btn = document.getElementById('btn-toggle-emote');
    const picker = document.getElementById('emote-picker');
    if (!btn || !picker) return;

    const togglePicker = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        picker.classList.toggle('hidden');
    };
    btn.addEventListener('click', togglePicker);
    btn.addEventListener('touchend', togglePicker, { passive: false });

    document.querySelectorAll('.emote-choice').forEach(choice => {
        const sendThisEmote = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            const emoji = choice.getAttribute('data-emote');
            picker.classList.add('hidden');
            if (!emoji) return;

            if (gameMode === 'multi' && typeof socket !== 'undefined' && socket) {
                socket.emit('sendEmote', { emote: emoji });
            }
            spawnEmoteBubble(myPlayerIndex, emoji);
        };
        choice.addEventListener('click', sendThisEmote);
        choice.addEventListener('touchend', sendThisEmote, { passive: false });
    });

    document.addEventListener('click', (e) => {
        if (picker && !picker.classList.contains('hidden') && !e.target.closest('#emote-picker') && !e.target.closest('#btn-toggle-emote')) {
            picker.classList.add('hidden');
        }
    });
}

function spawnEmoteBubble(playerIndex, emoji) {
    const container = document.getElementById('bubble-container');
    if (!container) return;
    const model = modelForPlayer(playerIndex);
    if (!model) return;

    const v = model.position.clone();
    const modelHeight = model.userData?.planeMesh?.geometry?.parameters?.height || 430;
    v.y += modelHeight + 30;
    v.project(camera);

    const vp = getAppViewport();
    const x = (v.x * 0.5 + 0.5) * vp.width;
    const y = (-(v.y * 0.5) + 0.5) * vp.height;

    const bubble = document.createElement('div');
    bubble.className = 'speech-bubble';
    bubble.innerText = emoji;
    bubble.style.left = `${Math.round(x)}px`;
    bubble.style.top = `${Math.round(y)}px`;

    container.appendChild(bubble);
    playSfx('click');
    setTimeout(() => {
        if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
    }, 2600);
}

let airDropCrates = [];
let turnsSinceLastCrate = 0;

function create3DAirDropChest() {
    const rootGroup = new THREE.Group();

    // Sandiqni 3D perspektivada (hajmli) ko'rsatish uchun biroz buramiz
    const chestGroup = new THREE.Group();
    chestGroup.rotation.y = 0.38; // 3D chuqurlik ko'rinishi
    chestGroup.rotation.x = 0.12;

    // 1. Asosiy yog'och sandiq korpusi (72 x 36 x 48)
    const baseGeo = new THREE.BoxGeometry(72, 36, 48);
    const woodMat = new THREE.MeshStandardMaterial({
        color: 0x78350f, // boy yog'och rangi
        roughness: 0.65,
        metalness: 0.15
    });
    const baseMesh = new THREE.Mesh(baseGeo, woodMat);
    baseMesh.position.y = 18;
    chestGroup.add(baseMesh);

    // 2. Sandiqning yarim aylana shaklidagi 3D qopqog'i (Arched Lid)
    const lidGeo = new THREE.CylinderGeometry(24, 24, 72.4, 16, 1, false, 0, Math.PI);
    const lidMat = new THREE.MeshStandardMaterial({
        color: 0x854d0e,
        roughness: 0.6,
        metalness: 0.15
    });
    const lidMesh = new THREE.Mesh(lidGeo, lidMat);
    lidMesh.rotation.z = Math.PI / 2;
    lidMesh.position.set(0, 36, 0);
    chestGroup.add(lidMesh);

    // Qopqoqning yon yassi yarim doiralari
    const lidSideGeo = new THREE.CircleGeometry(23.9, 14, 0, Math.PI);
    const lidSideMat = new THREE.MeshStandardMaterial({ color: 0x713f12, roughness: 0.7 });
    const lidSideL = new THREE.Mesh(lidSideGeo, lidSideMat);
    lidSideL.position.set(-36.2, 36, 0);
    lidSideL.rotation.y = -Math.PI / 2;
    chestGroup.add(lidSideL);

    const lidSideR = new THREE.Mesh(lidSideGeo, lidSideMat);
    lidSideR.position.set(36.2, 36, 0);
    lidSideR.rotation.y = Math.PI / 2;
    chestGroup.add(lidSideR);

    // 3. Oltin/bronza mustahkamlovchi metall tasmalar va qirralar (Metal Armor Bands & Trim)
    const metalMat = new THREE.MeshStandardMaterial({
        color: 0xd97706, // Bronza / oltin zarhal metall
        roughness: 0.35,
        metalness: 0.75
    });
    const darkMetalMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b, // Qora quyma temir
        roughness: 0.45,
        metalness: 0.65
    });

    // Gorizontal qopqoq va tana birlashgan metall cheti (Rim trim)
    const rimGeo = new THREE.BoxGeometry(75, 4.5, 51);
    const rimMesh = new THREE.Mesh(rimGeo, metalMat);
    rimMesh.position.y = 36;
    chestGroup.add(rimMesh);

    // Vertikal tasmalar (Chap va o'ng metall kamarlar)
    [-22, 22].forEach(strapX => {
        // Tana qismidagi tasma
        const strapBodyGeo = new THREE.BoxGeometry(6, 38, 50.5);
        const strapBody = new THREE.Mesh(strapBodyGeo, metalMat);
        strapBody.position.set(strapX, 18, 0);
        chestGroup.add(strapBody);

        // Qopqoq qismidagi yarim aylana tasma
        const strapLidGeo = new THREE.CylinderGeometry(25.2, 25.2, 6.2, 16, 1, false, 0, Math.PI);
        const strapLid = new THREE.Mesh(strapLidGeo, metalMat);
        strapLid.rotation.z = Math.PI / 2;
        strapLid.position.set(strapX, 36, 0);
        chestGroup.add(strapLid);
    });

    // 4. Old qismdagi qulf va qisqich (Center Golden Lock & Keyhole)
    const lockPlateGeo = new THREE.BoxGeometry(11, 14, 4);
    const lockPlate = new THREE.Mesh(lockPlateGeo, metalMat);
    lockPlate.position.set(0, 34, 25.5);
    chestGroup.add(lockPlate);

    const keyholeGeo = new THREE.BoxGeometry(3, 5, 4.5);
    const keyhole = new THREE.Mesh(keyholeGeo, darkMetalMat);
    keyhole.position.set(0, 33, 25.8);
    chestGroup.add(keyhole);

    // 5. Sandiqning ikki yonidagi mustahkam tutqichlar (Side carry handles)
    [-37.5, 37.5].forEach(hx => {
        const handlePlateGeo = new THREE.BoxGeometry(3, 8, 14);
        const handlePlate = new THREE.Mesh(handlePlateGeo, darkMetalMat);
        handlePlate.position.set(hx, 20, 0);
        chestGroup.add(handlePlate);

        const handleRingGeo = new THREE.TorusGeometry(6, 1.8, 8, 12);
        const handleRing = new THREE.Mesh(handleRingGeo, metalMat);
        handleRing.position.set(hx > 0 ? hx + 1 : hx - 1, 17, 0);
        handleRing.rotation.y = Math.PI / 2;
        handleRing.rotation.x = Math.PI / 4;
        chestGroup.add(handleRing);
    });

    // 6. Yuqoridagi signalli yorug'lik mayoqchasi (Air Drop Beacon Light)
    const beaconBaseGeo = new THREE.CylinderGeometry(3.5, 4.5, 5, 8);
    const beaconBase = new THREE.Mesh(beaconBaseGeo, darkMetalMat);
    beaconBase.position.set(0, 61, 0);
    chestGroup.add(beaconBase);

    const beaconBulbGeo = new THREE.SphereGeometry(4.5, 8, 8);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
    const beaconBulb = new THREE.Mesh(beaconBulbGeo, beaconMat);
    beaconBulb.position.set(0, 65, 0);
    chestGroup.add(beaconBulb);

    rootGroup.add(chestGroup);

    // 7. Katta va chiroyli harbiy parashyut (Military Air Drop Parachute Canopy)
    const chuteGroup = new THREE.Group();
    const canopyRadius = 68;
    const canopyGeo = new THREE.SphereGeometry(canopyRadius, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.48);
    const canopyMat = new THREE.MeshStandardMaterial({
        color: 0xef4444, // Qizil oq airdrop rangi
        roughness: 0.5,
        side: THREE.DoubleSide
    });
    const canopyMesh = new THREE.Mesh(canopyGeo, canopyMat);
    canopyMesh.position.set(0, 140, 0);
    chuteGroup.add(canopyMesh);

    // Parashyut gumbazidagi oq polosa bezaklari
    const whiteCanopyGeo = new THREE.SphereGeometry(canopyRadius + 0.3, 18, 6, 0, Math.PI * 0.5, 0, Math.PI * 0.48);
    const whiteCanopyMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5, side: THREE.DoubleSide });
    const whiteMesh1 = new THREE.Mesh(whiteCanopyGeo, whiteCanopyMat);
    whiteMesh1.position.set(0, 140, 0);
    chuteGroup.add(whiteMesh1);

    const whiteMesh2 = new THREE.Mesh(whiteCanopyGeo, whiteCanopyMat);
    whiteMesh2.position.set(0, 140, 0);
    whiteMesh2.rotation.y = Math.PI;
    chuteGroup.add(whiteMesh2);

    // Parashyut arqonlari (Parachute suspension ropes)
    const ropeMat = new THREE.LineBasicMaterial({ color: 0xe2e8f0 });
    const ropeCoords = [
        [[-28, 42, 18], [-48, 135, 30]],
        [[28, 42, 18], [48, 135, 30]],
        [[-28, 42, -18], [-48, 135, -30]],
        [[28, 42, -18], [48, 135, -30]]
    ];
    ropeCoords.forEach(([p1, p2]) => {
        const ropeGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(...p1),
            new THREE.Vector3(...p2)
        ]);
        const ropeLine = new THREE.Line(ropeGeo, ropeMat);
        chuteGroup.add(ropeLine);
    });

    rootGroup.add(chuteGroup);

    return {
        rootGroup,
        chestGroup,
        chuteGroup,
        beaconBulb
    };
}

function spawnAirDropCrate(customX, customY, customId) {
    const { rootGroup, chestGroup, chuteGroup, beaconBulb } = create3DAirDropChest();
    const x = typeof customX === 'number' ? customX : (Math.random() - 0.5) * 850;
    const y = typeof customY === 'number' ? customY : 840;
    rootGroup.position.set(x, y, 10);
    scene.add(rootGroup);

    const crateObj = {
        id: customId || ('crate_' + Date.now() + '_' + Math.floor(Math.random() * 10000)),
        group: rootGroup,
        chestGroup,
        chuteMesh: chuteGroup,
        beaconBulb,
        x,
        y,
        vy: -38,
        alive: true
    };
    airDropCrates.push(crateObj);
    showCenterNotice("🪂 AIR DROP SANDIQ TUSHYAPTI!", 2200);
}

function updateAirDropCrates(dt) {
    for (let i = airDropCrates.length - 1; i >= 0; i--) {
        const c = airDropCrates[i];
        if (!c.alive) continue;
        c.y += c.vy * dt;
        c.group.position.y = c.y;

        // Havoda chayqalib tushish va signalli mayoqchani miltillatish
        if (c.chuteMesh.visible) {
            c.group.rotation.z = Math.sin(performance.now() * 0.003) * 0.08;
            if (c.beaconBulb && c.beaconBulb.material) {
                const isBright = Math.sin(performance.now() * 0.008) > 0;
                c.beaconBulb.material.color.setHex(isBright ? 0x22c55e : 0x15803d);
            }
        }

        if (c.y <= ground.position.y + 100) {
            c.y = ground.position.y + 100;
            c.group.position.y = c.y;
            c.group.rotation.z = 0;
            if (c.chuteMesh.visible) {
                c.chuteMesh.visible = false;
                spawnParticles(c.x, c.y + 20, 14, true); // Yerga qo'nganda chang effekti
            }
        }
    }
}

function applyAirDropRewardVisual(chosen, shooter, x, y) {
    if (chosen === 'crowhunt') {
        if (shooter === myPlayerIndex) {
            myProfile.crowhunt = (Number(myProfile.crowhunt) || 0) + 1;
            myCrow = myProfile.crowhunt;
            saveProfile();
            updateSuperUI();
            if (typeof updateCrowUI === 'function') updateCrowUI();
        }
        showDamageText(x, y + 60, "🎁 +1 QUSH URAR O'Q! 🐦", true, true);
    } else if (chosen === 'wall') {
        if (shooter === myPlayerIndex) {
            myProfile.walls = (Number(myProfile.walls) || 0) + 1;
            saveProfile();
            updateSuperUI();
        }
        showDamageText(x, y + 60, "🎁 +1 HIMOY DEVORI! 🧱", true, true);
    } else if (chosen === 'artillery') {
        if (shooter === myPlayerIndex) {
            myProfile.artillery = (Number(myProfile.artillery) || 0) + 1;
            artilleryCount = myProfile.artillery;
            saveProfile();
            updateSuperUI();
        }
        showDamageText(x, y + 60, "🎁 +1 ARTILERIYA! 💣", true, true);
    } else if (chosen === 'super') {
        if (shooter === myPlayerIndex) {
            myProfile.superPowers = (Number(myProfile.superPowers) || 0) + 1;
            mySuper = myProfile.superPowers;
            saveProfile();
            updateSuperUI();
        } else {
            enemySuper = (Number(enemySuper) || 0) + 1;
        }
        showDamageText(x, y + 60, "🎁 +1 SUPER KUCH! 🗡️", true, true);
    } else if (chosen === 'double') {
        if (shooter === myPlayerIndex) {
            myProfile.doubleSpears = (Number(myProfile.doubleSpears) || 0) + 1;
            saveProfile();
            updateSuperUI();
        }
        showDamageText(x, y + 60, "🎁 +1 QO'SH NAYZA! ⚔️", true, true);
    } else if (chosen === 'fire') {
        if (shooter === myPlayerIndex) {
            myProfile.fireSpears = (Number(myProfile.fireSpears) || 0) + 1;
            saveProfile();
            updateSuperUI();
        }
        showDamageText(x, y + 60, "🎁 +1 OLOVLI NAYZA! 🔥", true, true);
    } else if (chosen === 'hp') {
        if (shooter === 0) myHealth = Math.min(100, myHealth + 35);
        else enemyHealth = Math.min(100, enemyHealth + 35);
        updateHealthUI();
        showDamageText(x, y + 60, "🎁 +35 HP JON! 💖", true, true);
    } else if (chosen === 'shield') {
        setShieldForPlayer(shooter, shieldForPlayer(shooter) + 2);
        updateSuperUI();
        showDamageText(x, y + 60, "🎁 +2 QALQON! 🛡️", true, true);
    } else {
        if (shooter === myPlayerIndex) addScore(500);
        showDamageText(x, y + 60, "🎁 +500 BALL! 🪙", true, true);
    }
}

function onRemoteAirDropHit(data) {
    if (!data) return;
    const hitCrate = airDropCrates.find(c => c.id === data.crateId) || airDropCrates.find(c => c.alive && Math.abs(c.x - data.hitX) < 140);
    if (hitCrate && hitCrate.alive) {
        hitCrate.alive = false;
        scene.remove(hitCrate.group);
        spawnParticles(hitCrate.x, hitCrate.y + 25, 40, true);
        spawnFireBurst(hitCrate.x, hitCrate.y + 25, 20);
        playSfx('break');
    }
    applyAirDropRewardVisual(data.reward, data.shooterIndex, data.hitX, data.hitY);
}

function checkAirDropCrateHit() {
    if (!spear || !spear.active) return null;
    for (let i = 0; i < airDropCrates.length; i++) {
        const c = airDropCrates[i];
        if (c.alive && Math.abs(spear.x - c.x) < 70 && Math.abs(spear.y - c.y) < 70) {
            c.alive = false;
            scene.remove(c.group);
            spawnParticles(c.x, c.y + 25, 40, true);
            spawnFireBurst(c.x, c.y + 25, 20);
            playSfx('break');

            const shooter = spear.playerIndex;
            // Airdrop sandig'idan barcha xilma-xil bonuslar va quvvatlar tushadi:
            const rewardTypes = ['crowhunt', 'double', 'wall', 'fire', 'artillery', 'super', 'hp', 'shield', 'score'];
            const chosen = rewardTypes[Math.floor(Math.random() * rewardTypes.length)];

            applyAirDropRewardVisual(chosen, shooter, c.x, c.y);

            return { crate: c, chosenReward: chosen, x: c.x, y: c.y };
        }
    }
    return null;
}

const DAILY_REWARDS_DATA = [
    { day: 1, title: '1-kun', rewardText: '200 Ball', icon: '🪙', type: 'score', amount: 200 },
    { day: 2, title: '2-kun', rewardText: '+1 Qalqon', icon: '🛡️', type: 'shield', amount: 1 },
    { day: 3, title: '3-kun', rewardText: '400 Ball', icon: '🪙', type: 'score', amount: 400 },
    { day: 4, title: '4-kun', rewardText: '+1 Qo\'sh nayza', icon: '⚔️', type: 'double', amount: 1 },
    { day: 5, title: '5-kun', rewardText: '+1 Artileriya', icon: '💣', type: 'artillery', amount: 1 },
    { day: 6, title: '6-kun', rewardText: '800 Ball', icon: '🪙', type: 'score', amount: 800 },
    { day: 7, title: '7-kun', rewardText: '+1 Super Kuch', icon: '🗡️', type: 'super', amount: 1 }
];

function getDailyState() {
    const raw = localStorage.getItem('kamonboz_daily_state');
    try {
        return raw ? JSON.parse(raw) : { currentDay: 1, lastClaimDate: '' };
    } catch {
        return { currentDay: 1, lastClaimDate: '' };
    }
}

function checkDailyAutoPopup() {
    // Logindan oldin kunlik bonus modalini avtomatik ochmaymiz
    if (!isUserLoggedIn()) return;

    const today = new Date().toISOString().slice(0, 10);
    const state = getDailyState();
    if (state.lastClaimDate !== today) {
        setTimeout(() => {
            renderDailyRewards();
            const modal = document.getElementById('daily-rewards-modal');
            if (modal && gameMode === 'menu') {
                modal.classList.remove('hidden');
                if (menuScreen) menuScreen.classList.add('hidden');
                if (typeof updateMenuWallpaper === 'function') updateMenuWallpaper();
            }
        }, 1200);
    }
}

function renderDailyRewards() {
    const grid = document.getElementById('daily-rewards-grid');
    const btnClaim = document.getElementById('btn-claim-daily');
    if (!grid) return;
    grid.innerHTML = '';

    const today = new Date().toISOString().slice(0, 10);
    const state = getDailyState();
    const loggedIn = isUserLoggedIn();
    const canClaim = loggedIn && (state.lastClaimDate !== today);

    DAILY_REWARDS_DATA.forEach(d => {
        const card = document.createElement('div');
        const isCurrent = d.day === state.currentDay;
        const isClaimed = d.day < state.currentDay || (!canClaim && isCurrent && state.lastClaimDate === today);

        card.className = `daily-reward-card ${isCurrent && canClaim ? 'active' : ''} ${isClaimed ? 'claimed' : ''}`;
        card.innerHTML = `
            <div class="daily-day-title">${d.title}</div>
            <div class="daily-reward-icon">${d.icon}</div>
            <div class="daily-reward-val">${d.rewardText}</div>
        `;
        grid.appendChild(card);
    });

    if (btnClaim) {
        if (!loggedIn) {
            btnClaim.removeAttribute('disabled');
            btnClaim.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
            btnClaim.innerText = "🔒 Bonus olish uchun tizimga kiring";
        } else if (canClaim) {
            btnClaim.removeAttribute('disabled');
            btnClaim.style.background = '';
            btnClaim.innerText = `${state.currentDay}-kun sovg'asini olish!`;
        } else {
            btnClaim.setAttribute('disabled', 'true');
            btnClaim.style.background = '';
            btnClaim.innerText = "Bugungi sovg'a olingan!";
        }
    }
}

function claimDailyReward() {
    if (!isUserLoggedIn()) {
        showCenterNotice("🔒 Kunlik bonusni olish uchun avval tizimga kiring!", 2400);
        const modal = document.getElementById('daily-rewards-modal');
        if (modal) modal.classList.add('hidden');
        if (authModal) authModal.classList.remove('hidden');
        return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const state = getDailyState();
    if (state.lastClaimDate === today) return;

    const reward = DAILY_REWARDS_DATA.find(d => d.day === state.currentDay) || DAILY_REWARDS_DATA[0];
    if (reward.type === 'score') addScore(reward.amount);
    else if (reward.type === 'shield') myProfile.walls = (myProfile.walls || 0) + reward.amount;
    else if (reward.type === 'double') myProfile.doubleSpears = (myProfile.doubleSpears || 0) + reward.amount;
    else if (reward.type === 'artillery') { artilleryCount += reward.amount; myProfile.artillery = artilleryCount; }
    else if (reward.type === 'super') { mySuper += reward.amount; myProfile.superPowers = mySuper; }

    saveProfile();
    updateSuperUI();

    state.lastClaimDate = today;
    state.currentDay = state.currentDay >= 7 ? 1 : state.currentDay + 1;
    localStorage.setItem('kamonboz_daily_state', JSON.stringify(state));

    spawnConfetti();
    renderDailyRewards();
    showCenterNotice(`Tabriklaymiz! ${reward.rewardText} berildi!`, 2500);
}

function initDailyRewards() {
    const btnDailyRewards = document.getElementById('btn-daily-rewards');
    const modal = document.getElementById('daily-rewards-modal');
    const btnClose = document.getElementById('btn-close-daily');
    const btnCloseX = document.getElementById('btn-close-rewards-x');
    const btnClaim = document.getElementById('btn-claim-daily');

    const handleOpen = safeModalAction((e) => {
        renderDailyRewards();
        openModalSafely(modal, e);
    });

    const handleClose = safeModalAction((e) => {
        closeModalSafely(modal, e);
    });

    if (btnDailyRewards && modal) {
        btnDailyRewards.addEventListener('click', handleOpen);
        btnDailyRewards.addEventListener('touchend', handleOpen, { passive: false });
    }
    if (btnClose && modal) {
        btnClose.addEventListener('click', handleClose);
        btnClose.addEventListener('touchend', handleClose, { passive: false });
    }
    if (btnCloseX && modal) {
        btnCloseX.addEventListener('click', handleClose);
        btnCloseX.addEventListener('touchend', handleClose, { passive: false });
    }
    if (btnClaim) {
        btnClaim.addEventListener('click', claimDailyReward);
    }
    checkDailyAutoPopup();
}

const DEFAULT_QUESTS = [
    { id: 'headshot', title: '2 ta boshga aniq zarba ber', target: 2, current: 0, reward: 250, claimed: false },
    { id: 'crow', title: '1 ta qarg\'ani urib tushir', target: 1, current: 0, reward: 150, claimed: false },
    { id: 'win', title: '1 ta jangda g\'alaba qozon', target: 1, current: 0, reward: 300, claimed: false }
];

function getQuestsState() {
    const today = new Date().toISOString().slice(0, 10);
    const raw = localStorage.getItem('kamonboz_daily_quests');
    try {
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && parsed.date === today && Array.isArray(parsed.quests)) return parsed;
    } catch { }
    const fresh = { date: today, quests: JSON.parse(JSON.stringify(DEFAULT_QUESTS)) };
    localStorage.setItem('kamonboz_daily_quests', JSON.stringify(fresh));
    return fresh;
}

function saveQuestsState(state) {
    localStorage.setItem('kamonboz_daily_quests', JSON.stringify(state));
}

function checkQuestProgress(type, amount = 1, showNotice = true) {
    const state = getQuestsState();
    let updated = false;
    state.quests.forEach(q => {
        if (q.id === type && !q.claimed) {
            q.current = Math.min(q.target, q.current + amount);
            updated = true;
            // Qarg'ani urganda umuman yozuv chiqmasligi uchun type !== 'crow' va showNotice tekshiriladi
            if (q.current >= q.target && showNotice && type !== 'crow') {
                showCenterNotice(`🎯 Vazifa bajarildi: ${q.title}!`, 2200);
            }
        }
    });
    if (updated) saveQuestsState(state);
}

function renderDailyQuests() {
    const list = document.getElementById('daily-quests-list');
    if (!list) return;
    list.innerHTML = '';
    const state = getQuestsState();

    state.quests.forEach(q => {
        const item = document.createElement('div');
        item.className = 'quest-item';
        const pct = Math.min(100, Math.round((q.current / q.target) * 100));
        const canClaim = q.current >= q.target && !q.claimed;

        item.innerHTML = `
            <div class="quest-info">
                <div class="quest-title">${q.title} (${q.current}/${q.target})</div>
                <div class="quest-reward">🪙 +${q.reward} Ball</div>
                <div class="quest-progress-bg">
                    <div class="quest-progress-fill" style="width: ${pct}%"></div>
                </div>
            </div>
            <button class="quest-claim-btn" ${canClaim ? '' : 'disabled'}>
                ${q.claimed ? 'Olingan' : (canClaim ? 'Olish' : `${pct}%`)}
            </button>
        `;

        if (canClaim) {
            const btn = item.querySelector('.quest-claim-btn');
            btn.addEventListener('click', () => {
                q.claimed = true;
                addScore(q.reward);
                saveProfile();
                saveQuestsState(state);
                spawnConfetti();
                renderDailyQuests();
                showCenterNotice(`+${q.reward} Ball qo'shildi!`, 2000);
            });
        }
        list.appendChild(item);
    });
}

function initDailyQuests() {
    const btn = document.getElementById('btn-daily-quests');
    const modal = document.getElementById('daily-quests-modal');
    const btnClose = document.getElementById('btn-close-quests');
    const btnCloseX = document.getElementById('btn-close-quests-x');

    const handleOpen = safeModalAction((e) => {
        renderDailyQuests();
        openModalSafely(modal, e);
    });

    const handleClose = safeModalAction((e) => {
        closeModalSafely(modal, e);
    });

    if (btn && modal) {
        btn.addEventListener('click', handleOpen);
        btn.addEventListener('touchend', handleOpen, { passive: false });
    }
    if (btnClose && modal) {
        btnClose.addEventListener('click', handleClose);
        btnClose.addEventListener('touchend', handleClose, { passive: false });
    }
    if (btnCloseX && modal) {
        btnCloseX.addEventListener('click', handleClose);
        btnCloseX.addEventListener('touchend', handleClose, { passive: false });
    }
}

// Global modal ESC key handler
document.addEventListener('keydown', (e) => {
    if ((e.code === 'Space' || e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') && !e.repeat) {
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (activeTag !== 'input' && activeTag !== 'textarea') {
            const gameOverM = document.getElementById('game-over-modal');
            if (menuScreen && menuScreen.classList.contains('hidden') && (!gameOverM || gameOverM.classList.contains('hidden'))) {
                e.preventDefault();
                triggerJump(myPlayerIndex);
            }
        }
    }
    if (e.key === 'Escape' || e.key === 'Esc') {
        const modals = ['daily-quests-modal', 'daily-rewards-modal', 'about-modal', 'settings-modal', 'shop-modal', 'rating-modal', 'help-modal'];
        let closedAny = false;
        for (const id of modals) {
            const m = document.getElementById(id);
            if (m && !m.classList.contains('hidden')) {
                m.classList.add('hidden');
                closedAny = true;
            }
        }
        if (closedAny && menuScreen) {
            menuScreen.classList.remove('hidden');
            if (typeof updateMenuWallpaper === 'function') updateMenuWallpaper();
        }
    }
});

// Universal smooth touch/drag scroll for menu, modals and lists (both X and Y directions)
(function setupMenuTouchScroll() {
    let scrollStartY = 0;
    let scrollStartX = 0;
    let lastMoveX = 0;
    let lastMoveY = 0;
    let initialScrollTop = 0;
    let initialScrollLeft = 0;
    let isScrollDragging = false;
    let dragAxis = null; // 'x' or 'y'
    let canScrollX = false;
    let canScrollY = false;
    let activeScrollPanel = null;
    let lastMoveTime = 0;
    let scrollVelocity = 0;
    let isTouchActive = false;

    function getActiveScrollTarget(rawTarget) {
        if (!rawTarget) return null;

        // 1. Never intercept horizontal main menu card carousel or language track
        if (rawTarget.closest && rawTarget.closest('#menu-cards-carousel, .menu-carousel-wrapper, #lang-carousel-track, .lang-carousel-wrapper')) {
            return null;
        }

        // 2. Character Select: Touch anywhere inside character modal -> scroll the roster grid horizontally
        const charModal = document.getElementById('character-select-modal');
        if (charModal && !charModal.classList.contains('hidden') && charModal.offsetParent !== null) {
            if (rawTarget.closest && rawTarget.closest('#character-select-modal')) {
                return document.getElementById('char-select-roster') || charModal;
            }
        }

        // 3. Rating Modal: Touch anywhere inside rating modal -> scroll leaderboard list
        const ratingModal = document.getElementById('rating-modal');
        if (ratingModal && !ratingModal.classList.contains('hidden') && ratingModal.offsetParent !== null) {
            if (rawTarget.closest && rawTarget.closest('#rating-modal')) {
                const lbList = document.getElementById('leaderboard-list');
                if (lbList && (lbList.scrollHeight > lbList.clientHeight || lbList.clientHeight > 0)) {
                    return lbList;
                }
                return ratingModal;
            }
        }

        // 4. Duel Invites Modal: Touch anywhere inside invites modal -> scroll active invites list
        const duelModal = document.getElementById('duel-invites-modal');
        if (duelModal && !duelModal.classList.contains('hidden') && duelModal.offsetParent !== null) {
            if (rawTarget.closest && rawTarget.closest('#duel-invites-modal')) {
                // If clicked directly on the tabs switch buttons, don't hijack as list scroll
                if (rawTarget.closest && rawTarget.closest('.duel-invites-tabs')) {
                    return null;
                }
                const inList = document.getElementById('incoming-invites-container');
                const outList = document.getElementById('outgoing-invites-container');
                if (inList && !inList.classList.contains('hidden')) return inList;
                if (outList && !outList.classList.contains('hidden')) return outList;
                return duelModal;
            }
        }

        // 5. Look up the DOM tree from rawTarget for closest scrollable element
        if (rawTarget.closest) {
            const specific = rawTarget.closest(
                '#char-select-roster, .char-roster-grid, #leaderboard-list, ' +
                '#incoming-invites-container, #outgoing-invites-container, .duel-invites-list, ' +
                '#level-grid, .custom-select-menu, .modal-panel, .center-panel, [data-scrollable]'
            );
            if (specific) return specific;
        }

        // 6. Check open modals by active visibility
        const candidatePanels = [
            document.getElementById('duel-invites-modal'),
            document.getElementById('rating-modal'),
            document.getElementById('profile-modal'),
            document.getElementById('level-select-modal'),
            document.getElementById('shop-modal'),
            document.getElementById('settings-modal'),
            document.getElementById('daily-rewards-modal'),
            document.getElementById('daily-quests-modal'),
            document.getElementById('about-modal'),
            document.getElementById('help-modal'),
            document.getElementById('single-mode-modal'),
            document.getElementById('multi-menu'),
            document.getElementById('menu-screen')
        ];

        for (const p of candidatePanels) {
            if (p && !p.classList.contains('hidden') && p.offsetParent !== null) {
                const inner = p.querySelector && p.querySelector('.duel-invites-list:not(.hidden), #leaderboard-list, #level-grid, .char-roster-grid');
                if (inner) return inner;
                return p;
            }
        }
        return null;
    }

    function handleDragStart(clientX, clientY, rawTarget) {
        activeScrollPanel = getActiveScrollTarget(rawTarget);
        if (!activeScrollPanel) return;

        const vpos = getPointerPos({ clientX, clientY });
        scrollStartX = vpos.x;
        scrollStartY = vpos.y;
        lastMoveX = vpos.x;
        lastMoveY = vpos.y;
        initialScrollLeft = activeScrollPanel.scrollLeft || 0;
        initialScrollTop = activeScrollPanel.scrollTop || 0;
        isScrollDragging = false;
        dragAxis = null;
        scrollVelocity = 0;
        lastMoveTime = performance.now();

        // Check if panel can scroll horizontally (X) or vertically (Y)
        const isRoster = (activeScrollPanel.id === 'char-select-roster' || activeScrollPanel.classList.contains('char-roster-grid'));
        canScrollX = isRoster || (activeScrollPanel.scrollWidth > activeScrollPanel.clientWidth + 4);
        canScrollY = !isRoster && (activeScrollPanel.scrollHeight > activeScrollPanel.clientHeight + 4 || activeScrollPanel.id === 'leaderboard-list' || activeScrollPanel.classList.contains('duel-invites-list'));
    }

    function handleDragMove(clientX, clientY, rawEvent) {
        if (!activeScrollPanel) return;
        const vpos = getPointerPos({ clientX, clientY });
        const dx = vpos.x - scrollStartX;
        const dy = vpos.y - scrollStartY;

        if (!isScrollDragging) {
            // Determine drag direction once 4px threshold is exceeded
            if (canScrollX && Math.abs(dx) >= 4 && Math.abs(dx) >= Math.abs(dy)) {
                isScrollDragging = true;
                dragAxis = 'x';
            } else if (canScrollY && Math.abs(dy) >= 4) {
                isScrollDragging = true;
                dragAxis = 'y';
            } else if (canScrollX && Math.abs(dx) >= 4) {
                isScrollDragging = true;
                dragAxis = 'x';
            }
        }

        if (isScrollDragging) {
            if (rawEvent) {
                if (typeof rawEvent.preventDefault === 'function') rawEvent.preventDefault();
                if (typeof rawEvent.stopPropagation === 'function') rawEvent.stopPropagation();
            }
            const now = performance.now();
            const dt = Math.max(1, now - lastMoveTime);

            if (dragAxis === 'x') {
                scrollVelocity = (vpos.x - lastMoveX) / dt;
                lastMoveX = vpos.x;
                activeScrollPanel.scrollLeft = initialScrollLeft - dx;
            } else {
                scrollVelocity = (vpos.y - lastMoveY) / dt;
                lastMoveY = vpos.y;
                activeScrollPanel.scrollTop = initialScrollTop - dy;
            }
            lastMoveTime = now;
        }
    }

    function handleDragEnd() {
        if (!activeScrollPanel) return;
        if (isScrollDragging) {
            const momentum = scrollVelocity * 140;
            if (Math.abs(momentum) > 8) {
                if (dragAxis === 'x') {
                    activeScrollPanel.scrollBy({ left: -momentum, behavior: 'smooth' });
                } else {
                    activeScrollPanel.scrollBy({ top: -momentum, behavior: 'smooth' });
                }
            }
            // Suppress the follow-up click so releasing finger doesn't tap random buttons or select unintended cards
            const suppressEvent = (e) => {
                e.stopPropagation();
                e.preventDefault();
            };
            window.addEventListener('click', suppressEvent, { capture: true, once: true });
            window.addEventListener('touchend', suppressEvent, { capture: true, once: true });
            setTimeout(() => {
                window.removeEventListener('click', suppressEvent, { capture: true });
                window.removeEventListener('touchend', suppressEvent, { capture: true });
            }, 280);
        }
        isScrollDragging = false;
        dragAxis = null;
        activeScrollPanel = null;
    }

    // Touch events for mobile & Telegram WebApp
    window.addEventListener('touchstart', (e) => {
        if (!e.touches || !e.touches[0]) return;
        isTouchActive = true;
        handleDragStart(e.touches[0].clientX, e.touches[0].clientY, e.target);
    }, { capture: true, passive: true });

    window.addEventListener('touchmove', (e) => {
        if (!e.touches || !e.touches[0]) return;
        handleDragMove(e.touches[0].clientX, e.touches[0].clientY, e);
    }, { capture: true, passive: false });

    window.addEventListener('touchend', () => {
        handleDragEnd();
        setTimeout(() => { isTouchActive = false; }, 350);
    }, { capture: true, passive: true });

    window.addEventListener('touchcancel', () => {
        handleDragEnd();
        setTimeout(() => { isTouchActive = false; }, 350);
    }, { capture: true, passive: true });

    // Mouse events for desktop testing / click-drag
    window.addEventListener('mousedown', (e) => {
        if (isTouchActive || e.button !== 0) return;
        handleDragStart(e.clientX, e.clientY, e.target);
    }, { capture: true });

    window.addEventListener('mousemove', (e) => {
        if (isTouchActive || !activeScrollPanel) return;
        handleDragMove(e.clientX, e.clientY, e);
    }, { capture: true });

    window.addEventListener('mouseup', () => {
        if (isTouchActive) return;
        handleDragEnd();
    }, { capture: true });
})();

// =========================================================
// ZAMONAVIY CARD CAROUSEL LOGIKASI (AAA O'YINLAR USLUBIDA)
// =========================================================

// =========================================================
// ILK BOR KIRGANDA TILNI TANLASH KARUSELI (FIRST-TIME LANGUAGE CAROUSEL)
// =========================================================
function initLanguageCarousel() {
    const modal = document.getElementById('language-select-modal');
    if (!modal) return;

    const track = document.getElementById('lang-carousel-track');
    const prevBtn = document.getElementById('btn-lang-prev');
    const nextBtn = document.getElementById('btn-lang-next');

    if (prevBtn && track) {
        prevBtn.addEventListener('click', (e) => {
            if (e && e.preventDefault) e.preventDefault();
            track.scrollBy({ left: -160, behavior: 'smooth' });
        });
    }
    if (nextBtn && track) {
        nextBtn.addEventListener('click', (e) => {
            if (e && e.preventDefault) e.preventDefault();
            track.scrollBy({ left: 160, behavior: 'smooth' });
        });
    }

    const cards = modal.querySelectorAll('.lang-card');
    cards.forEach(card => {
        const lang = card.getAttribute('data-lang');
        const handleSelect = safeModalAction((e) => {
            if (e) {
                if (typeof e.preventDefault === 'function') e.preventDefault();
                if (typeof e.stopPropagation === 'function') e.stopPropagation();
            }
            selectLanguageChoice(lang);
        });
        card.addEventListener('click', handleSelect);
        card.addEventListener('touchend', handleSelect, { passive: false });
    });
}

function selectLanguageChoice(lang) {
    if (!translations[lang]) lang = 'uz';
    myProfile.lang = lang;
    try {
        localStorage.setItem('nayza_language_selected', 'true');
    } catch (_) { }

    const selectLang = document.getElementById('select-lang');
    if (selectLang) selectLang.value = lang;

    saveProfile();

    const modal = document.getElementById('language-select-modal');
    if (modal) closeModalSafely(modal);

    const t = translations[lang] || translations.uz;
    showCenterNotice(t.welcomeToast || "Xush kelibsiz!", 2200);
}

function checkFirstTimeLanguageModal() {
    try {
        if (gameMode === 'multi' || gameMode === 'single' || autoJoinExecuted || isUrlDuelOrRoomJoin()) {
            return;
        }
        const selected = localStorage.getItem('nayza_language_selected');
        if (!selected) {
            const langModal = document.getElementById('language-select-modal');
            if (langModal) {
                const introScreen = document.getElementById('intro-screen');
                if (!introScreen || introScreen.classList.contains('hide')) {
                    if (shouldShowMainMenuOnAuth()) openModalSafely(langModal);
                } else {
                    const waitIntro = setInterval(() => {
                        const curIntro = document.getElementById('intro-screen');
                        if (!curIntro || curIntro.classList.contains('hide')) {
                            clearInterval(waitIntro);
                            if (!localStorage.getItem('nayza_language_selected') && shouldShowMainMenuOnAuth()) {
                                openModalSafely(langModal);
                            }
                        }
                    }, 250);
                }
            }
        }
    } catch (_) { }
}

function setupMenuCarousel() {
    const carousel = document.getElementById('menu-cards-carousel');
    if (!carousel) return;
    const cards = Array.from(carousel.querySelectorAll('.menu-card'));
    if (cards.length === 0) return;

    // Cardlar bosilishini boshqarish: Card bosilsa ichidagi tegishli tugmani bosadi
    cards.forEach(card => {
        if (card._hasCardListener) return;
        card._hasCardListener = true;

        card.addEventListener('click', (e) => {
            if (e.target && typeof e.target.closest === 'function' && e.target.closest('button')) {
                return;
            }
            const btn = card.querySelector('button');
            if (btn) btn.click();
        });
    });
}

// =========================================================
// DUEL TAKLIFLARI, O'YINCHI PROFILI VA REJALASHTIRILGAN DUEL
// =========================================================

let activeScheduleInviteId = null;
let activeScheduleMinutes = 0;
let activeProfileTarget = null;
let duelWaitingTimerInterval = null;

async function fetchDuelInvites() {
    const myId = myProfile.playerId || myProfile.phone || '';
    if (!myId && !myProfile.name) return;
    try {
        const params = new URLSearchParams();
        if (myProfile.playerId) params.append('playerId', myProfile.playerId);
        if (myProfile.phone) params.append('phone', myProfile.phone);
        if (myProfile.name) params.append('name', myProfile.name);
        const tgId = tg?.initDataUnsafe?.user?.id ? String(tg.initDataUnsafe.user.id) : (myProfile.tgId || '');
        if (tgId) params.append('tgId', tgId);

        const res = await fetch(`${API_BASE}/api/duel-invites?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (data && data.ok) {
            updateDuelInvitesBadge(data.pendingCount || 0);
            renderDuelInvites(data.incoming || [], data.outgoing || []);
        }
    } catch (e) {
        console.warn('fetchDuelInvites error:', e);
    }
}

function updateDuelInvitesBadge(count) {
    const num = Number(count) || 0;
    const txtCardCount = document.getElementById('txt-duel-invites-count');
    const topBadge = document.getElementById('top-invites-badge');
    const tabIncBadge = document.getElementById('tab-incoming-badge');

    if (num > 0) {
        if (txtCardCount) {
            txtCardCount.innerText = `+${num}`;
            txtCardCount.style.display = 'inline-block';
        }
        if (topBadge) {
            topBadge.innerText = `+${num}`;
            topBadge.style.display = 'inline-block';
        }
        if (tabIncBadge) tabIncBadge.innerText = String(num);
    } else {
        if (txtCardCount) txtCardCount.style.display = 'none';
        if (topBadge) topBadge.style.display = 'none';
        if (tabIncBadge) tabIncBadge.innerText = '0';
    }
}

function renderDuelInvites(incoming, outgoing) {
    const incContainer = document.getElementById('incoming-invites-container');
    const outContainer = document.getElementById('outgoing-invites-container');
    const tabIncBadge = document.getElementById('tab-incoming-badge');
    const tabOutBadge = document.getElementById('tab-outgoing-badge');

    const pendingIncoming = (incoming || []).filter(i => i.status === 'pending');
    if (tabIncBadge) tabIncBadge.innerText = String(pendingIncoming.length);
    if (tabOutBadge) tabOutBadge.innerText = String((outgoing || []).length);

    if (incContainer) {
        if (!incoming || !incoming.length) {
            incContainer.innerHTML = '<p class="empty-invites-hint">Sizga kelgan yangi duel takliflari yo\'q</p>';
        } else {
            incContainer.innerHTML = incoming.map(inv => {
                const isPending = inv.status === 'pending';
                const isAccepted = inv.status === 'accepted';
                return `<div class="duel-invite-card" data-invite-id="${inv.id}">
                    <div class="invite-header">
                        <div class="invite-user-left">
                            ${inv.fromPhoto ? `<img src="${inv.fromPhoto}" class="invite-avatar">` : `<div class="invite-avatar">${inv.fromFlag || '🏹'}</div>`}
                            <div>
                                <div class="invite-user-name">${inv.fromName}</div>
                                <div class="invite-meta">${isPending ? 'Sizni duelga chorladi' : `Qabul qilingan: soat ${inv.scheduledTimeStr || 'Hozir'}`}</div>
                            </div>
                        </div>
                    </div>
                    <div class="invite-actions">
                        ${isPending ? `
                            <button type="button" class="primary-btn btn-accept-duel" data-iid="${inv.id}" data-name="${inv.fromName}" style="background: linear-gradient(135deg, #10b981, #059669); flex:1;">⚔️ Qabul qilish</button>
                            <button type="button" class="primary-btn btn-decline-duel" data-iid="${inv.id}" style="background:#ef4444; width:85px;">Rad etish</button>
                        ` : (isAccepted ? `
                            <button type="button" class="primary-btn btn-enter-duel" data-iid="${inv.id}" data-room="${inv.roomName}" style="background: linear-gradient(135deg, #f59e0b, #d97706); flex:1;">⚔️ Jangga kirish</button>
                        ` : `<span style="color:#94a3b8; font-size:0.8rem;">Status: ${inv.status}</span>`)}
                    </div>
                </div>`;
            }).join('');

            incContainer.querySelectorAll('.btn-accept-duel').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const iid = btn.getAttribute('data-iid');
                    const name = btn.getAttribute('data-name');
                    openScheduleDuelModal(iid, name);
                });
            });
            incContainer.querySelectorAll('.btn-decline-duel').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const iid = btn.getAttribute('data-iid');
                    await respondDuelInvite(iid, false);
                });
            });
            incContainer.querySelectorAll('.btn-enter-duel').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const iid = btn.getAttribute('data-iid');
                    const room = btn.getAttribute('data-room');
                    joinDuelRoomDirectly(iid, room);
                });
            });
        }
    }

    if (outContainer) {
        if (!outgoing || !outgoing.length) {
            outContainer.innerHTML = '<p class="empty-invites-hint">Siz hali hech kimga duel taklifi yubormadingiz</p>';
        } else {
            outContainer.innerHTML = outgoing.map(inv => {
                const isPending = inv.status === 'pending';
                const isAccepted = inv.status === 'accepted';
                return `<div class="duel-invite-card" data-invite-id="${inv.id}">
                    <div class="invite-header">
                        <div class="invite-user-left">
                            ${inv.toPhoto ? `<img src="${inv.toPhoto}" class="invite-avatar">` : `<div class="invite-avatar">${inv.toFlag || '🏹'}</div>`}
                            <div>
                                <div class="invite-user-name">${inv.toName}</div>
                                <div class="invite-meta">${isPending ? '⏳ Javob kutilmoqda...' : (isAccepted ? `✅ Qabul qilindi: soat ${inv.scheduledTimeStr || 'Hozir'}` : `Holat: ${inv.status}`)}</div>
                            </div>
                        </div>
                    </div>
                    <div class="invite-actions">
                        ${isPending ? `
                            <button type="button" class="primary-btn btn-cancel-duel" data-iid="${inv.id}" style="background:#475569; flex:1;">❌ Bekor qilish</button>
                        ` : (isAccepted ? `
                            <button type="button" class="primary-btn btn-enter-duel" data-iid="${inv.id}" data-room="${inv.roomName}" style="background: linear-gradient(135deg, #f59e0b, #d97706); flex:1;">⚔️ Jangga kirish</button>
                        ` : '')}
                    </div>
                </div>`;
            }).join('');

            outContainer.querySelectorAll('.btn-cancel-duel').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const iid = btn.getAttribute('data-iid');
                    await cancelDuelInvite(iid);
                });
            });
            outContainer.querySelectorAll('.btn-enter-duel').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const iid = btn.getAttribute('data-iid');
                    const room = btn.getAttribute('data-room');
                    joinDuelRoomDirectly(iid, room);
                });
            });
        }
    }
}

function openScheduleDuelModal(inviteId, opponentName) {
    activeScheduleInviteId = inviteId;
    activeScheduleMinutes = 0;
    const modal = document.getElementById('schedule-duel-modal');
    if (!modal) return;
    const subtitle = document.getElementById('txt-schedule-subtitle');
    if (subtitle) subtitle.innerText = `${opponentName || 'Raqib'} bilan jang qachon bo'lsin?`;

    // Presets reset
    modal.querySelectorAll('.schedule-time-preset').forEach((btn, idx) => {
        btn.classList.toggle('active', idx === 0);
    });
    const timeInput = document.getElementById('input-custom-schedule-time');
    if (timeInput) timeInput.value = '';

    modal.classList.remove('hidden');
}

async function respondDuelInvite(inviteId, accept, scheduledTime, scheduledTimeStr) {
    try {
        const res = await fetch(`${API_BASE}/api/duel-invites/respond`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                inviteId,
                accept,
                scheduledTime: scheduledTime || Date.now(),
                scheduledTimeStr: scheduledTimeStr || 'Hozir'
            })
        });
        const data = await res.json().catch(() => ({}));
        if (data && data.ok) {
            fetchDuelInvites();
        }
    } catch (e) {
        console.warn('respondDuelInvite error:', e);
    }
}

async function cancelDuelInvite(inviteId) {
    try {
        const res = await fetch(`${API_BASE}/api/duel-invites/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inviteId })
        });
        const data = await res.json().catch(() => ({}));
        if (data && data.ok) {
            fetchDuelInvites();
        }
    } catch (e) {
        console.warn('cancelDuelInvite error:', e);
    }
}

function joinDuelRoomDirectly(inviteId, roomName) {
    if (!roomName) return;
    console.log('[joinDuelRoomDirectly] Ulanmoqda:', roomName, inviteId);
    autoJoinExecuted = true;
    gameMode = 'multi';

    // Intro ekranni butunlay o'chirish
    const introEl = document.getElementById('intro-screen');
    if (introEl) {
        introEl.classList.add('hide');
        introEl.style.display = 'none';
        if (introEl.parentNode) introEl.parentNode.removeChild(introEl);
    }

    // Barcha ekranlarni va asosiy menyuni mutlaqo yashirish
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    if (menuScreen) {
        menuScreen.classList.add('hidden');
        menuScreen.style.setProperty('display', 'none', 'important');
    }
    if (authModal) authModal.classList.add('hidden');
    if (multiMenu) multiMenu.classList.add('hidden');
    if (waitingScreen) waitingScreen.classList.remove('hidden');

    if (socket && socket.connected) {
        showCenterNotice(`⚔️ Duelga (${roomName}) ulanilmoqda...`, 2500);
        socket.emit('joinDuelRoom', { inviteId, roomName, profile: myProfile });
    } else {
        showCenterNotice(`⚔️ Serverga ulanmoqda...`, 2500);
        socket.once('connect', () => {
            showCenterNotice(`⚔️ Duelga (${roomName}) ulanilmoqda...`, 2500);
            socket.emit('joinDuelRoom', { inviteId, roomName, profile: myProfile });
        });
    }
}

function showDuelWaitingBanner(data) {
    const banner = document.getElementById('duel-waiting-forfeit-banner');
    const timerText = document.getElementById('txt-duel-waiting-timer');
    const titleText = document.getElementById('txt-duel-waiting-title');
    if (!banner || !timerText) return;

    banner.classList.remove('hidden');
    if (titleText && data.opponentName) {
        titleText.innerText = `${data.opponentName} jangga kutilmoqda...`;
    }

    let remaining = Number(data.remainingSeconds) || 120;
    timerText.innerText = `Vaqt: ${remaining}s`;

    if (duelWaitingTimerInterval) clearInterval(duelWaitingTimerInterval);
    duelWaitingTimerInterval = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
            clearInterval(duelWaitingTimerInterval);
            timerText.innerText = `Vaqt tugadi!`;
        } else {
            timerText.innerText = `Vaqt: ${remaining}s`;
        }
    }, 1000);
}

function handleDuelOpponentForfeited(data) {
    if (duelWaitingTimerInterval) {
        clearInterval(duelWaitingTimerInterval);
        duelWaitingTimerInterval = null;
    }
    const banner = document.getElementById('duel-waiting-forfeit-banner');
    if (banner) banner.classList.add('hidden');

    myStats.wins = (myStats.wins || 0) + 1;
    myStats.games = (myStats.games || 0) + 1;
    myStats.score = (myStats.score || 0) + (data.scoreGained || 50);
    localStorage.setItem('nayza_stats', JSON.stringify(myStats));
    updateCampaignUI();

    alert(data.message || "Raqib duel maydoniga kelmadi va jangdan qochdi! Sizga texnik g'alaba va +50 ball berildi!");

    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    if (menuScreen) menuScreen.classList.remove('hidden');
    fetchDuelInvites();
}

async function openPlayerProfileModal(playerId, playerName, preloadedData = {}) {
    const modal = document.getElementById('player-profile-modal');
    if (!modal) return;

    activeProfileTarget = {
        playerId,
        name: playerName || preloadedData.name || 'Jangchi',
        flag: preloadedData.flag || '🇺🇿',
        photoUrl: preloadedData.photoUrl || '',
        score: preloadedData.score || 0
    };

    document.getElementById('player-profile-name').innerText = activeProfileTarget.name;
    const avatarImg = document.getElementById('player-profile-avatar-img');
    const avatarFallback = document.getElementById('player-profile-avatar-fallback');
    if (activeProfileTarget.photoUrl) {
        avatarImg.src = activeProfileTarget.photoUrl;
        avatarImg.style.display = 'block';
        avatarFallback.style.display = 'none';
    } else {
        avatarImg.style.display = 'none';
        avatarFallback.style.display = 'inline-block';
        avatarFallback.innerText = activeProfileTarget.flag || '👤';
    }

    document.getElementById('player-profile-score').innerText = activeProfileTarget.score || 0;
    document.getElementById('player-profile-games').innerText = preloadedData.games || 0;
    document.getElementById('player-profile-wins').innerText = preloadedData.wins || 0;
    document.getElementById('player-profile-losses').innerText = preloadedData.losses || Math.max(0, (preloadedData.games || 0) - (preloadedData.wins || 0));
    document.getElementById('player-profile-forfeits').innerText = preloadedData.forfeits || 0;
    const winRate = (preloadedData.games > 0) ? Math.round(((preloadedData.wins || 0) / preloadedData.games) * 100) : 0;
    document.getElementById('player-profile-winrate').innerText = `${winRate}%`;

    modal.classList.remove('hidden');

    try {
        const res = await fetch(`${API_BASE}/api/player-profile/${encodeURIComponent(playerId)}`);
        const data = await res.json().catch(() => ({}));
        if (data && data.ok && data.player) {
            const p = data.player;
            activeProfileTarget.photoUrl = p.photoUrl || activeProfileTarget.photoUrl;
            if (p.photoUrl) {
                avatarImg.src = p.photoUrl;
                avatarImg.style.display = 'block';
                avatarFallback.style.display = 'none';
            }
            document.getElementById('player-profile-score').innerText = p.score || 0;
            document.getElementById('player-profile-games').innerText = p.games || 0;
            document.getElementById('player-profile-wins').innerText = p.wins || 0;
            document.getElementById('player-profile-losses').innerText = p.losses || 0;
            document.getElementById('player-profile-forfeits').innerText = p.forfeits || 0;
            document.getElementById('player-profile-winrate').innerText = `${p.winRate || 0}%`;
            document.getElementById('player-profile-level').innerText = `Lv.${p.campaignLevel || 1}`;

            let tier = "🥉 Bronza";
            if (p.score >= 3000) tier = "👑 Afsona";
            else if (p.score >= 2000) tier = "💎 Olmos";
            else if (p.score >= 1200) tier = "🥇 Oltin";
            else if (p.score >= 600) tier = "🥈 Kumush";
            document.getElementById('player-profile-tier').innerText = tier;
        }
    } catch (_) {}
}

async function sendDuelInviteToActiveTarget() {
    if (!activeProfileTarget || !activeProfileTarget.playerId) return;
    try {
        const payload = {
            fromPlayerId: myProfile.playerId || myProfile.phone,
            fromName: myProfile.name,
            fromFlag: myProfile.flag,
            fromPhoto: myProfile.photoUrl || '',
            fromTgId: tg?.initDataUnsafe?.user?.id ? String(tg.initDataUnsafe.user.id) : '',
            fromPhone: myProfile.phone || '',
            toPlayerId: activeProfileTarget.playerId,
            toName: activeProfileTarget.name,
            toFlag: activeProfileTarget.flag,
            toPhoto: activeProfileTarget.photoUrl || '',
            toTgId: activeProfileTarget.tgId || '',
            toPhone: activeProfileTarget.phone || ''
        };
        const res = await fetch(`${API_BASE}/api/duel-invites/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (data && data.ok) {
            alert(`⚔️ ${activeProfileTarget.name} ga duel taklifi yuborildi!`);
            const pModal = document.getElementById('player-profile-modal');
            if (pModal) pModal.classList.add('hidden');
            fetchDuelInvites();
        } else {
            alert("Taklif yuborishda xatolik yuz berdi!");
        }
    } catch (e) {
        alert("Server bilan bog'lanishda xatolik!");
    }
}

function addFriendFromActiveTarget() {
    if (!activeProfileTarget || !activeProfileTarget.playerId) return;
    socket.emit('lookupFriendById', {
        friendId: activeProfileTarget.playerId,
        profile: myProfile
    });
    alert(`👥 ${activeProfileTarget.name} ga do'stlik taklifi yuborildi!`);
    const pModal = document.getElementById('player-profile-modal');
    if (pModal) pModal.classList.add('hidden');
}

function initDuelInvitesUI() {
    // 1. Menyu tugmalari
    const btnDuelInvites = document.getElementById('btn-duel-invites');
    const btnTopInvites = document.getElementById('btn-top-invites');
    const invitesModal = document.getElementById('duel-invites-modal');
    const closeInvitesX = document.getElementById('btn-close-invites-x');
    const closeInvitesBtn = document.getElementById('btn-close-invites');

    const openInvites = safeModalAction((e) => {
        if (typeof openModalSafely === 'function' && invitesModal) {
            fetchDuelInvites();
            openModalSafely(invitesModal, e);
        } else if (invitesModal) {
            invitesModal.classList.remove('hidden');
            fetchDuelInvites();
        }
    });
    if (btnDuelInvites) {
        btnDuelInvites.addEventListener('click', openInvites);
        btnDuelInvites.addEventListener('touchend', openInvites, { passive: false });
    }
    if (btnTopInvites) {
        btnTopInvites.addEventListener('click', openInvites);
        btnTopInvites.addEventListener('touchend', openInvites, { passive: false });
    }
    const handleCloseInvites = safeModalAction((e) => {
        if (typeof closeModalSafely === 'function' && invitesModal) {
            closeModalSafely(invitesModal, e);
        } else if (invitesModal) {
            invitesModal.classList.add('hidden');
        }
    });
    if (closeInvitesX) {
        closeInvitesX.addEventListener('click', handleCloseInvites);
        closeInvitesX.addEventListener('touchend', handleCloseInvites, { passive: false });
    }
    if (closeInvitesBtn) {
        closeInvitesBtn.addEventListener('click', handleCloseInvites);
        closeInvitesBtn.addEventListener('touchend', handleCloseInvites, { passive: false });
    }

    // 2. Tablar
    const tabInc = document.getElementById('tab-incoming-invites');
    const tabOut = document.getElementById('tab-outgoing-invites');
    const incBox = document.getElementById('incoming-invites-container');
    const outBox = document.getElementById('outgoing-invites-container');

    if (tabInc && tabOut && incBox && outBox) {
        tabInc.addEventListener('click', () => {
            tabInc.classList.add('active');
            tabOut.classList.remove('active');
            incBox.classList.remove('hidden');
            outBox.classList.add('hidden');
        });
        tabOut.addEventListener('click', () => {
            tabOut.classList.add('active');
            tabInc.classList.remove('active');
            outBox.classList.remove('hidden');
            incBox.classList.add('hidden');
        });
    }

    // 3. Schedule modal buttons
    const schedModal = document.getElementById('schedule-duel-modal');
    const closeSchedX = document.getElementById('btn-close-schedule-x');
    const cancelSchedBtn = document.getElementById('btn-cancel-schedule');
    const confirmSchedBtn = document.getElementById('btn-confirm-schedule');

    if (closeSchedX) closeSchedX.addEventListener('click', () => schedModal && schedModal.classList.add('hidden'));
    if (cancelSchedBtn) cancelSchedBtn.addEventListener('click', () => schedModal && schedModal.classList.add('hidden'));

    if (schedModal) {
        schedModal.querySelectorAll('.schedule-time-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                schedModal.querySelectorAll('.schedule-time-preset').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activeScheduleMinutes = Number(btn.getAttribute('data-minutes')) || 0;
            });
        });
    }

    if (confirmSchedBtn) {
        confirmSchedBtn.addEventListener('click', async () => {
            if (!activeScheduleInviteId) return;
            const customTimeInput = document.getElementById('input-custom-schedule-time');
            let scheduledTime = Date.now();
            let scheduledTimeStr = 'Hozir (Darhol)';

            if (customTimeInput && customTimeInput.value) {
                scheduledTimeStr = customTimeInput.value;
                const [hh, mm] = customTimeInput.value.split(':').map(Number);
                const d = new Date();
                d.setHours(hh, mm, 0, 0);
                if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
                scheduledTime = d.getTime();
            } else if (activeScheduleMinutes > 0) {
                scheduledTime = Date.now() + activeScheduleMinutes * 60 * 1000;
                const d = new Date(scheduledTime);
                const hh = String(d.getHours()).padStart(2, '0');
                const mm = String(d.getMinutes()).padStart(2, '0');
                scheduledTimeStr = `${activeScheduleMinutes} daqiqadan so'ng (${hh}:${mm})`;
            }

            await respondDuelInvite(activeScheduleInviteId, true, scheduledTime, scheduledTimeStr);
            if (schedModal) schedModal.classList.add('hidden');
            alert(`✅ Duel qabul qilindi va vaqti soat ${scheduledTimeStr} ga belgilandi!`);
        });
    }

    // 4. Player profile modal buttons
    const profileModal = document.getElementById('player-profile-modal');
    const closeProfX = document.getElementById('btn-close-player-profile-x');
    const challengeBtn = document.getElementById('btn-profile-challenge-duel');
    const addFriendBtn = document.getElementById('btn-profile-add-friend');

    if (closeProfX) closeProfX.addEventListener('click', () => profileModal && profileModal.classList.add('hidden'));
    if (challengeBtn) challengeBtn.addEventListener('click', sendDuelInviteToActiveTarget);
    if (addFriendBtn) addFriendBtn.addEventListener('click', addFriendFromActiveTarget);

    // 5. Socket listeners for duel invites
    socket.on('newDuelInvite', (data) => {
        updateDuelInvitesBadge(data?.pendingCount || 1);
        fetchDuelInvites();
        try { playSound('bonus'); } catch (_) {}
    });

    socket.on('duelInvitesCount', (data) => {
        updateDuelInvitesBadge(data?.count || 0);
    });

    socket.on('duelInviteAccepted', (data) => {
        fetchDuelInvites();
        alert(`⚔️ ${data.invite.toName} duel taklifingizni qabul qildi!\n⏰ Vaqti: soat ${data.invite.scheduledTimeStr}`);
    });

    socket.on('duelInviteDeclined', (data) => {
        fetchDuelInvites();
        alert(`❌ ${data.invite.toName} duel taklifingizni rad etdi.`);
    });

    socket.on('duelTimeArrived', (data) => {
        const inv = data.invite;
        if (confirm(`🔔 DUEL VAQTI KELDI!\n\n⚔️ ${inv.fromName} vs ${inv.toName}\nJangga kirasizmi?`)) {
            joinDuelRoomDirectly(inv.id, inv.roomName);
        }
    });

    socket.on('duelWaitingOpponent', (data) => {
        showDuelWaitingBanner(data);
    });

    socket.on('duelOpponentJoinedRoom', (data) => {
        const banner = document.getElementById('duel-waiting-forfeit-banner');
        if (banner) banner.classList.add('hidden');
        if (duelWaitingTimerInterval) clearInterval(duelWaitingTimerInterval);
    });

    socket.on('duelOpponentForfeited', (data) => {
        handleDuelOpponentForfeited(data);
    });

    socket.on('friendAddRequest', (data) => {
        const from = data?.fromProfile;
        if (!from) return;
        const confirmModal = document.getElementById('friend-request-confirm-modal');
        const msg = document.getElementById('txt-friend-confirm-msg');
        if (confirmModal && msg) {
            msg.innerText = `🤝 ${from.name || "Jangchi"} sizni do'stlar safiga qo'shmoqchi. Rozimisiz?`;
            confirmModal.classList.remove('hidden');

            const yesBtn = document.getElementById('btn-friend-confirm-yes');
            const noBtn = document.getElementById('btn-friend-confirm-no');

            yesBtn.onclick = () => {
                confirmModal.classList.add('hidden');
                socket.emit('friendAddRequestResponse', { fromPlayerId: from.playerId, accept: true });
            };
            noBtn.onclick = () => {
                confirmModal.classList.add('hidden');
                socket.emit('friendAddRequestResponse', { fromPlayerId: from.playerId, accept: false });
            };
        }
    });
}

function checkDuelUrlParams() {
    try {
        const info = getPendingUrlDuelOrRoom();
        if (info.view === 'invites') {
            const invitesModal = document.getElementById('duel-invites-modal');
            if (invitesModal) {
                document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
                if (menuScreen) {
                    menuScreen.classList.add('hidden');
                    menuScreen.style.setProperty('display', 'none', 'important');
                }
                invitesModal.classList.remove('hidden');
                fetchDuelInvites();
                return true;
            }
        } else if (info.duelRoom) {
            joinDuelRoomDirectly(info.inviteId, info.duelRoom);
            return true;
        }
    } catch (_) {}
    return false;
}

// Initialization logic
function _runPageInits() {
    setupMenuCarousel();
    initLanguageCarousel();
    checkFirstTimeLanguageModal();
    initDailyRewards();
    initDailyQuests();
    initEmotesUI();
    initCoinTossUI();
    initDuelInvitesUI();
    fetchDuelInvites();
    checkDuelUrlParams();
    ['select-map', 'select-weather', 'select-difficulty', 'select-char-type-options', 'select-char-type', 'select-avatar', 'select-spear-model', 'select-country'].forEach(id => {
        const el = document.getElementById(id);
        if (el) setupCustomDropdown(el);
    });
    if (typeof checkAutoJoinTelegramRoom === 'function') checkAutoJoinTelegramRoom();

    btnArtillery = document.getElementById('artillery-button');
    artilleryCountText = document.getElementById('artillery-count');

    if (btnArtillery && !btnArtillery._hasArtilleryListener) {
        btnArtillery._hasArtilleryListener = true;
        const handleArtilleryClick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (myHealth <= 0 || areAllEnemiesDead() || currentTurnIndex !== myPlayerIndex || artilleryCount <= 0) return;
            isArtilleryAiming = !isArtilleryAiming;

            if (isArtilleryAiming) {
                btnArtillery.classList.add('active');
                if (!myArtilleryCannon) {
                    const tex = loadTexture('artileriya.png');
                    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
                    myArtilleryCannon = new THREE.Mesh(new THREE.PlaneGeometry(350, 192), mat);
                    scene.add(myArtilleryCannon);
                }
                const playerGrp = myPlayerIndex === 0 ? p1Model : p2Model;
                if (playerGrp) {
                    const facingRight = playerGrp.position.x < 0;
                    const cannonOffset = 440;
                    myArtilleryCannon.scale.set(1.0, 1.0, 1.0);
                    myArtilleryCannon.position.set(
                        playerGrp.position.x + (facingRight ? cannonOffset : -cannonOffset),
                        playerGrp.position.y + 115,
                        playerGrp.position.z - 2
                    );
                    myArtilleryCannon.visible = true;
                    if (facingRight) {
                        myArtilleryCannon.rotation.y = Math.PI;
                    } else {
                        myArtilleryCannon.rotation.y = 0;
                    }
                }
            } else {
                btnArtillery.classList.remove('active');
                if (myArtilleryCannon) myArtilleryCannon.visible = false;
            }
        };

        if (window.PointerEvent) {
            btnArtillery.addEventListener('pointerdown', handleArtilleryClick);
        } else {
            btnArtillery.addEventListener('mousedown', handleArtilleryClick);
            btnArtillery.addEventListener('touchstart', handleArtilleryClick, { passive: false });
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _runPageInits);
} else {
    _runPageInits();
}