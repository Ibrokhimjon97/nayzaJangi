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

// --- Telegram WebApp Integratsiyasi ---
const tg = window.Telegram?.WebApp;
if (tg) {
    try {
        tg.ready();
        tg.expand();
        if (typeof tg.requestFullscreen === 'function') {
            try {
                if (typeof tg.isVersionAtLeast === 'function' ? tg.isVersionAtLeast('8.0') : false) {
                    tg.requestFullscreen();
                }
            } catch (_) {}
        }
        if (typeof tg.setHeaderColor === 'function') tg.setHeaderColor('#111827');
        if (typeof tg.setBackgroundColor === 'function') tg.setBackgroundColor('#0b0f19');
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
    } catch (e) {}
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
                    if (Math.abs(data[i]-bgR)<50 && Math.abs(data[i+1]-bgG)<50 && Math.abs(data[i+2]-bgB)<50) {
                        data[i+3] = 0;
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
                bgMusicAudio.play().catch(() => {});
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
    if (bgMusicAudio) bgMusicAudio.volume = musicMuted ? 0 : musicVolume;
    if (btnVolMute) btnVolMute.innerText = musicMuted ? '🔇' : '🔊';
    if (btnMusicToggle) btnMusicToggle.innerText = musicMuted ? '🔇' : '🔊';
    applySelectedMusicTrack();
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
    if (window.Telegram && window.Telegram.WebApp) {
        try {
            window.Telegram.WebApp.expand();
            if (typeof window.Telegram.WebApp.requestFullscreen === 'function') {
                window.Telegram.WebApp.requestFullscreen();
            }
            if (typeof window.Telegram.WebApp.lockOrientation === 'function') {
                window.Telegram.WebApp.lockOrientation('landscape');
            }
        } catch (_) {}
    }
    try {
        if (screen.orientation && typeof screen.orientation.lock === 'function') {
            screen.orientation.lock('landscape').catch(() => {});
        }
    } catch (_) {}
}
tryLockLandscapeOrientation();

function getAppViewport() {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || 
                           (window.matchMedia && window.matchMedia('(max-width: 950px)').matches);
    const needRotate = isMobileDevice && (winW < winH);
    
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
        try { window.location.reload(); } catch (_) {}
    }, false);
} catch (_) {}

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
scene.add(starField);

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
for(let i=0; i<dustCount*3; i++) {
    dustPos[i] = (Math.random() - 0.5) * 4000;
    if(i%3 === 1) dustPos[i] = Math.random() * 800 - 300; 
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustMat = new THREE.PointsMaterial({ color: 0xffddaa, size: 4, transparent: true, opacity: 0.12 });
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

function buildMap(mapType, weather = 'sunny') {
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
        starMat.opacity = weather === 'night' ? 0.9 : 0;
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
    backdropPlane.position.set(0, ground.position.y + 100 + backdropH * 0.48, -700);
    scene.add(backdropPlane);
    mapBackdrops.push(backdropPlane);

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
            if (mapType === 'sakura') tree.material.color.setRGB(1.0, 0.78, 0.88);
            else if (mapType === 'taiga') tree.material.color.setRGB(0.72, 0.90, 0.80);
            else if (mapType === 'winter' || weatherType === 'snow') tree.material.color.setRGB(0.85, 0.95, 1.0);
            else tree.material.color.setRGB(1, 1, 1);
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
            (Math.random() - 0.5) * 5500,
            680 + Math.random() * 260,
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
            // Qushlar osmonda (340-760 balandlikda) ko'rinadigan erkin zonada uchadi
            bird.position.set((seededRandom() - 0.5) * 3600, 340 + seededRandom() * 420, -30 + seededRandom() * 60);
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
        const cModel = window.customModelsInfo.find(m => m.id == normalizedCharType);
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
    planeMesh.castShadow = true;
    group.userData.torso.add(planeMesh); // attach to torso so breath animation works
    group.add(group.userData.torso);
    
    // Keep feet on the visible top of the ground.
    group.position.y = ground.position.y + (group.userData.isOttomanUnit ? 78 : 86);
    
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
    if (state === 'hurt') return baseHurt;
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
    if (state === 'hurt') return baseHurt;
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
        if (state === 'hurt') return baseHurt;
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
const pos3Offset = 340; // Ikkinchi dushman bir-biriga yopishib qolmasligi uchun oradagi kengroq masofa

let p1Model = createSoldier(true, 2);
p1Model.position.x = pos1X;

let p2Model = createSoldier(false, 2);
p2Model.position.x = pos2X;
let p3Model = null;

// Spear object
let spear = null;
let secondarySpear = null;
const spearGroup = new THREE.Group();

// === Haqiqiy kamon o'qi / nayza 3D modeli ===
// MUHIM: o'qning/nayzaning faqat OLD tomonida uch (paykon) bo'ladi,
// orqa tomonida esa patlar (fletching) bo'ladi. Ikki tomonida ham uch bo'lmasligi kerak.
//
// Shaft (o'q tanasi) - ingichka, uzun, tabiiy yog'och rangi, oldinga ozgina ingichkalashadi.
const spearShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 2.1, 150, 12),
    new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 0.62, metalness: 0.08 })
);
spearShaft.name = 'spear-shaft';
spearShaft.rotateZ(Math.PI / 2);
spearShaft.castShadow = true;
spearGroup.add(spearShaft);

// Uch (broadhead) - FAQAT old tomonda. Metall uchburchak paykon (uzun, nafis bargsimon).
const spearTipGroup = new THREE.Group();
spearTipGroup.name = 'spear-tip-group';
spearTipGroup.position.x = 75;
const bladeMat = new THREE.MeshStandardMaterial({ color: 0xeef2f7, metalness: 0.96, roughness: 0.14 });
// Asosiy uchli paykon
const spearBlade = new THREE.Mesh(new THREE.ConeGeometry(5.2, 34, 16), bladeMat);
spearBlade.name = 'spear-blade';
spearBlade.rotateZ(-Math.PI / 2);
spearBlade.position.x = 13;
spearBlade.castShadow = true;
spearTipGroup.add(spearBlade);
// Paykon o'rta qirrasi (qirrali, jangovor ko'rinish uchun yassi rombsimon)
const bladeEdge = new THREE.Mesh(
    new THREE.OctahedronGeometry(4.4, 0),
    new THREE.MeshStandardMaterial({ color: 0xcfd6df, metalness: 0.9, roughness: 0.22 })
);
bladeEdge.scale.set(2.0, 0.5, 1.0);
bladeEdge.position.x = -2;
bladeEdge.name = 'spear-blade-edge';
spearTipGroup.add(bladeEdge);
// Paykon bo'g'imi (socket) - uch bilan shaft orasidagi konussimon metall ulagich.
const tipCollar = new THREE.Mesh(
    new THREE.CylinderGeometry(2.0, 3.0, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xb8860b, metalness: 0.85, roughness: 0.3 })
);
tipCollar.rotateZ(Math.PI / 2);
tipCollar.position.x = -16;
spearTipGroup.add(tipCollar);
spearGroup.add(spearTipGroup);

// Patlar (fletching) - FAQAT orqa tomonda uchta nafis pat (haqiqiy o'q kabi).
const featherMat = new THREE.MeshStandardMaterial({
    color: 0xe23b3b,
    roughness: 0.8,
    metalness: 0.05,
    side: THREE.DoubleSide
});
const fletchingGroup = new THREE.Group();
fletchingGroup.name = 'spear-feather';
fletchingGroup.position.x = -64;
const featherShape = new THREE.Shape();
// Egri, oqimli pat shakli (tabiiy patga o'xshash).
featherShape.moveTo(0, 0);
featherShape.quadraticCurveTo(16, 9, 30, 7);
featherShape.quadraticCurveTo(24, 2, 22, 0);
featherShape.quadraticCurveTo(12, -1, 0, 0);
const featherGeo = new THREE.ShapeGeometry(featherShape);
for (let f = 0; f < 3; f++) {
    const feather = new THREE.Mesh(featherGeo, featherMat.clone());
    feather.rotation.x = (f * Math.PI * 2) / 3; // 120° oralab joylashadi
    feather.position.x = -6;
    feather.castShadow = true;
    fletchingGroup.add(feather);
}
// Nock (o'qning kamon ipiga o'rnatiladigan orqa qismi) - tekis, uchsiz orqa.
const nock = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 2.0, 7, 10),
    new THREE.MeshStandardMaterial({ color: 0x2a1c10, roughness: 0.85 })
);
nock.rotateZ(Math.PI / 2);
nock.position.x = -79;
spearGroup.add(nock);
spearGroup.add(fletchingGroup);


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
    fireSpearGlow.visible = !!isFire;
    // Nayza uchini olov rangiga bo'yaymiz.
    const blade = spearGroup.getObjectByName('spear-blade');
    const shaft = spearGroup.getObjectByName('spear-shaft');
    if (blade && blade.material) {
        if (isFire) {
            if (blade.material.emissive) blade.material.emissive.setHex(0xff4500);
            blade.material.color.setHex(0xffcc66);
        } else {
            if (blade.material.emissive) blade.material.emissive.setHex(0x000000);
            blade.material.color.setHex(0xffffff);
        }
        blade.material.needsUpdate = true;
    }
    if (shaft && shaft.material && shaft.material.emissive) {
        shaft.material.emissive.setHex(isFire ? 0x7a2500 : 0x000000);
        shaft.material.needsUpdate = true;
    }
}

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

function buildHintTrajectory() {
    clearHintTrajectory();
    if (!lastPlayerShot) return;
    const shot = lastPlayerShot;
    let simX = shot.startX;
    let simY = shot.startY;
    const rad = shot.angle * (Math.PI / 180);
    let simVx = shot.power * Math.cos(rad);
    if (shot.playerIndex === 1) simVx = -simVx;
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
            // Patlar endi Group (uchta pat) - har bir patning rangini yangilaymiz.
            if (feather) {
                const featherColor = isSpearmanThrow ? 0x7c3aed : 0xe23b3b;
                if (feather.material && feather.material.color) {
                    feather.material.color.setHex(featherColor);
                    feather.material.needsUpdate = true;
                } else if (feather.children && feather.children.length) {
                    feather.children.forEach((fch) => {
                        if (fch.material && fch.material.color) {
                            fch.material.color.setHex(featherColor);
                            fch.material.needsUpdate = true;
                        }
                    });
                }
            }
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
    const p3OffsetExtra = (p3Model && typeof enemy2Health === 'number' && enemy2Health > 0) ? (pos3Offset / 2) : 0;
    const centerX = p3OffsetExtra;

    const groundSurfaceY = ground.position.y + 100;
    const effectiveZoom = Math.max(0.1, baseZoom || 0.4);
    const visibleH = frustumSize / effectiveZoom;

    // Yer sathi (groundSurfaceY) ekranning pastki ~22-26% qismida bo'lib, pastdagi tugmalar
    // zamin qoraytirilgan qismi ustida qulay joylashadi. Jangchilar esa ekranning quyi-markaziy
    // qismida yirik, mahobatli ko'rinadi. Yuqori qism esa qushlar, bulutlar va o'q parvozi bilan to'ladi.
    const centerY = isPortrait 
        ? 60 
        : (isMobileView ? (groundSurfaceY + visibleH * 0.26) : (groundSurfaceY + visibleH * 0.22));

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
    
    // Jang maydoni kengligi: o'yinchi va raqib(lar) orasidagi masofa
    const battleDist = (typeof currentBattleDistance === 'number') ? currentBattleDistance : 2600;
    // Har ikkala jangchining eni ~560 birlik.
    // Ekran chetlaridan yarmi chiqib ketmasligi uchun yetarli yon xoshiya (padding) qo'shamiz:
    const extraSideMargin = (p3Model ? (pos3Offset + 240) : 0) + 720;
    const minWorldWidth = Math.max(2600, battleDist + extraSideMargin);
    const zoomX = (frustumSize * aspect) / minWorldWidth;

    if (isPortrait) {
        // Portret rejimida ikkala jangchi ekranga to'liq sig'adi
        baseZoom = Math.min(zoomX * 1.15, 0.6);
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
let myDuckActive = false;
let enemyDuckActive = false;
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
        { map: 'field',     weather: 'sunny' },   // 1-5   yashil dala, quyoshli
        { map: 'desert',    weather: 'sunny' },   // 6-10  cho'l
        { map: 'field',     weather: 'rain' },    // 11-15 yomg'irli dala
        { map: 'samarkand', weather: 'sunny' },   // 16-20 Samarqand
        { map: 'mountain',  weather: 'sunny' },   // 21-25 tog'
        { map: 'winter',    weather: 'snow' },    // 26-30 qor
        { map: 'bukhara',   weather: 'sunny' },   // 31-35 Buxoro
        { map: 'castle',    weather: 'night' },   // 36-40 qal'a, tun
        { map: 'oasis',     weather: 'sunny' },   // 41-45 voha
        { map: 'istanbul',  weather: 'sunny' },   // 46-50 Istanbul
        { map: 'field',     weather: 'storm' },   // 51-55 bo'ronli dala
        { map: 'volcano',   weather: 'night' },   // 56-60 vulqon, tun
        { map: 'winter',    weather: 'night' },   // 61-65 qishki tun
        { map: 'samarkand', weather: 'night' },   // 66-70 Samarqand, tun
        { map: 'canyon',    weather: 'sunny' },   // 71-75 kanyon
        { map: 'desert',    weather: 'storm' },   // 76-80 cho'l bo'roni
        { map: 'istanbul',  weather: 'rain' },    // 81-85 Istanbul, yomg'ir
        { map: 'mountain',  weather: 'snow' },    // 86-90 qorli tog'
        { map: 'bukhara',   weather: 'night' },   // 91-95 Buxoro, tun
        { map: 'castle',    weather: 'storm' }    // 96-100 qal'a, jala
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
    return index === myPlayerIndex ? myDuckActive : enemyDuckActive;
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
    mesh.position.set(0, groundSurfaceY + height / 2, 12);
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
        wall.mesh.position.y = groundSurfaceY + (Number(wall.mesh.userData.wallHeight || 460) / 2);
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
    myDuckActive = !!active;
    if (duckButton) duckButton.classList.toggle('active', myDuckActive);
    if (myPlayerIndex >= 0 && !isDragging) {
        setSoldierVisual(modelForPlayer(myPlayerIndex), myDefenseActive ? 'defend' : 'idle');
    }
    if (gameMode === 'multi' && shouldEmit) socket.emit('duckState', { active: myDuckActive });
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
        js.baseY = m.userData.baseY !== undefined ? m.userData.baseY : m.position.y;
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
    } else if (playerIndex === 1) {
        enemyJumpActive = true;
    } else if (playerIndex === 2) {
        p3JumpActive = true;
    }
}

function resetJumpStates() {
    jumpStates.forEach(js => {
        js.active = false;
        js.baseY = null;
    });
    myJumpActive = false;
    enemyJumpActive = false;
    p3JumpActive = false;
    if (jumpButton) jumpButton.classList.remove('active');
    const allModels = [p1Model, p2Model];
    if (typeof p3Model !== 'undefined' && p3Model) allModels.push(p3Model);
    allModels.forEach(m => {
        if (m && m.userData) {
            m.userData.isJumping = false;
            if (m.userData.baseY !== undefined) m.position.y = m.userData.baseY;
        }
    });
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
            if (enemy2Health < 30) p3Bar.style.background = '#ef4444';
            else if (enemy2Health < 60) p3Bar.style.background = '#f59e0b';
            else p3Bar.style.background = '#10b981';
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
        // Yerga sanchilgan nayza / kamon o'qi:
        // O'q uchi butunlay yer ostiga kirgan bo'ladi va MUTLAQO KO'RINMAYDI.
        // Faqat yer sathidan (groundSurfaceY) yuqoriga qaragan dasta (shaft) va patlar (fletching) ko'rinadi.
        const groundSurfaceY = ground.position.y + 100;
        const groundStuckGroup = new THREE.Group();
        groundStuckGroup.name = 'ground-stuck-spear';
        groundStuckGroup.position.set(hitX, groundSurfaceY, 14);
        groundStuckGroup.rotation.z = angle;

        // Qurol turi va miqyosi
        const isSpearmanThrow = (spearGroup && spearGroup.scale.x > 1.2);
        const shaftLength = isSpearmanThrow ? 115 : 95;
        const shaftRadius = isSpearmanThrow ? 2.1 : 1.6;

        // Shaft (dasta): Faqat x = 0 (yer yuzasi) dan x = -shaftLength (havodagi orqa qism) gacha cho'ziladi.
        // Hech bir nuqtasi x > 0 (yer osti) da bo'lmaydi!
        const shaftGeo = new THREE.CylinderGeometry(shaftRadius * 0.85, shaftRadius * 1.1, shaftLength, 10);
        const shaftMat = new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 0.65, metalness: 0.08 });
        const shaftMesh = new THREE.Mesh(shaftGeo, shaftMat);
        shaftMesh.rotation.z = Math.PI / 2;
        shaftMesh.position.x = -shaftLength / 2;
        groundStuckGroup.add(shaftMesh);

        // Patlar (fletching): Faqat orqa uchida (havoda) joylashadi
        const featherColor = isSpearmanThrow ? 0x7c3aed : 0xe23b3b;
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
    }
}

function knockDownModel(model) {
    if (!model || !model.userData || model.userData.isKnockedDown) return;

    model.userData.isKnockedDown = true;
    const modelIndex = getPlayerIndexByModel(model);
    const isDead = (modelIndex >= 0 && getHealthForTarget(modelIndex) <= 0);

    // Barcha 2D sprite qahramonlar (Kamonchi, Nayzachi, Maxsus modellar)
    if (model.userData.isOttomanUnit || model.userData.isOttomanArcher || model.userData.isOttomanSpearman || model.userData.isCustomModel) {
        setSoldierVisual(model, 'hurt');
        // Agar o'lgan bo'lsa, yiqilgan (yarador) holatda qoladi, qaytib o'rnidan turmaydi
        if (!isDead) {
            setTimeout(() => {
                if (model && model.userData) {
                    // Qayta tekshiramiz: agar shu vaqt ichida o'lgan bo'lsa turmasin
                    const stillDead = (modelIndex >= 0 && getHealthForTarget(modelIndex) <= 0);
                    if (!stillDead) {
                        model.userData.isKnockedDown = false;
                        const def = modelIndex >= 0 && isDefenseActiveForPlayer(modelIndex);
                        setSoldierVisual(model, def ? 'defend' : 'idle');
                    }
                }
            }, 900);
        }
        return;
    }

    // 3D modellar uchun: 90 daraja yiqilganda yer tagiga kirib ketmasligi uchun
    // Yer usti yuzi ground.position.y + 100 da joylashgan. Model yuzasi yer ustida turishi shart.
    const originalY = model.position.y;
    const direction = model.position.x > 0 ? -1 : 1;
    model.rotation.z = direction * Math.PI / 2;
    model.position.y = ground.position.y + 100 + 180;

    if (!isDead) {
        setTimeout(() => {
            if (model && model.userData) {
                const stillDead = (modelIndex >= 0 && getHealthForTarget(modelIndex) <= 0);
                if (!stillDead) {
                    model.rotation.z = 0;
                    model.position.y = originalY;
                    model.userData.isKnockedDown = false;
                }
            }
        }, 1500);
    }
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
    if (isCoinTossActive || isAnimating || currentTurnIndex !== myPlayerIndex || gameMode === 'menu' || isPaused) return;
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

function computeShotPower(distance) {
    if (distance <= 0) return 0;
    // Dinamik kuch: ekranning markazidan tortganda mo'tadil, 
    // uzoqroqdan/ekranning narigi tomonidan tortganda esa o'q uzoqqa va kuchli uchishi uchun kengaytirilgan diapazon
    const base = distance * 8.5 + 220;
    return Math.min(3600, Math.max(350, base));
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
    
    let power = computeShotPower(distance); 
    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
    
    if (myPlayerIndex === 1) angle = 180 - angle;
    if (angle < -20) angle = -20;
    if (angle > 110) angle = 110;

    throwSpear(angle, power);
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
            e.preventDefault();
            e.stopPropagation();
        }
        if (Number(myProfile.fireSpears || 0) <= 0) return;
        isFireSpearActive = !isFireSpearActive;
        fireButton.classList.toggle('active', isFireSpearActive);
        if (isFireSpearActive) {
            triggerAbilityPulse(fireButton);
            playSfx('superPress', 0.7);
        }
    };
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
function showLevelBonusChestModal() {
    const modal = document.getElementById('level-bonus-chest-modal');
    const container = document.getElementById('bonus-chests-row');
    const notice = document.getElementById('bonus-reveal-notice');
    const btnSkip = document.getElementById('btn-skip-bonus-chest');
    if (!modal || !container) return;

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
            updateShopAndItemButtons();
            playSfx('woodHit', 0.8);
            if (typeof triggerHaptic === 'function') triggerHaptic('success');

            if (notice) {
                notice.innerHTML = `Tabriklaymiz! Sizga <b>+1 ${reward.name} ${reward.icon}</b> bepul berildi!`;
                notice.classList.remove('hidden');
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

            // 1.3 soniyadan so'ng modal yopiladi va jang boshlanadi
            setTimeout(() => {
                modal.classList.add('hidden');
                showCenterNotice(`+1 ${reward.name} ${reward.icon} qo'shildi!`, 2200);
            }, 1300);
        };

        card.addEventListener('click', pickChest);
        card.addEventListener('touchend', pickChest, { passive: false });
        container.appendChild(card);
    });

    if (btnSkip) {
        btnSkip.onclick = (e) => {
            if (e) e.preventDefault();
            modal.classList.add('hidden');
        };
    }

    modal.classList.remove('hidden');
}

// Game Logic
function startSinglePlayer(opts) {
    if (authModal) authModal.classList.add('hidden');
    if (singleModeModal) singleModeModal.classList.add('hidden');
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
    applyHudSideRoles();
    prevTurnIndex = -2;
    updateCampaignUI();
    setTimeout(() => { if (typeof checkDailyAutoPopup === 'function') checkDailyAutoPopup(); }, 500);
    updateTurn(myPlayerIndex, generateWind());
    if(!isLooping) {
        isLooping = true;
        lastTime = performance.now();
        requestAnimationFrame(gameLoop);
    }
    // Har bir level boshlanishida 3 ta sandiqdan 1 ta bepul bonus kuch taklif qilinadi
    showLevelBonusChestModal();
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
    if (gameMode === 'single' && singleShotLocked) return;
    if (gameMode === 'single') singleShotLocked = true;
    // Yordamchi hint uchun: o'yinchining joriy otish parametrlarini saqlaymiz.
    // Faqat o'yinchining o'z otishini saqlaymiz (raqibniki emas).
    if (currentTurnIndex === myPlayerIndex) {
        triggerHaptic('medium');
        const sX = myPlayerIndex === 0 ? p1Model.position.x + 60 : p2Model.position.x - 60;
        const sY = (myPlayerIndex === 0 ? p1Model.position.y : p2Model.position.y) + 270;
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
                angle: Math.max(-20, Math.min(110, angle + (currentTurnIndex === 0 ? 5.5 : -5.5))),
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
        if (myArtilleryCannon) myArtilleryCannon.visible = false;
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

const CROW_KILLER_CINEMATIC_MS = 4000;
let crowKillerCinematicActive = false;
let crowKillerCinematicUntil = 0;

function shootCrowKillerArrow() {
    if (myCrow <= 0) return;
    myCrow--;
    myProfile.crowhunt = myCrow;
    saveProfile();
    updateCrowUI();
    updateSuperUI();
    
    // Qarg'alarni aniqlash
    const birds = entities.filter(e => e.type === 'bird' && e.alive);
    if (birds.length === 0) return;
    
    // Barcha qushlarni urish
    const targetCount = birds.length;
    const targets = birds;
    
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
            if (!bird || !bird.alive || !bird.mesh) return;
            const birdMesh = bird.mesh;
            const targetX = birdMesh.position.x;
            const targetY = birdMesh.position.y;
            
            // O'q trayektoriyasini hisoblash
            const dx = targetX - startX;
            const dy = targetY - startY;
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            const power = 1600;
            
            // Homing o'q otish
            startCrowKillerArrowAnimation(startX, startY, angle, power, bird);
            playSfx('throw', 0.9);
            
            // Camera target ni qarg'aga qaratish
            cameraTargetX = targetX;
            cameraTargetY = targetY;
        }, index * 120);
    });
    
    // Kafolat: funksiya ishlaganda osmondagi BARCHA qarg'alar 100% yerga qulashi shart
    setTimeout(() => {
        targets.forEach((bird) => {
            if (bird && bird.alive) {
                killBird(bird);
            }
        });
    }, 2000);
    
    if (gameMode === 'multi') {
        socket.emit('crowKillerShot', { count: targetCount });
    }
    
    // Cinematic tugagandan keyin camera ni darhol dastlabki o'yinchi / jang maydoni ko'rinishiga qaytarish
    setTimeout(() => {
        crowKillerCinematicActive = false;
        crowKillerCinematicUntil = 0;
        resetCameraAfterImpact();
    }, 2000);
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
            
            // Qarg'aga yaqin yetib borganda aniq urib tushirish
            if (dist < 80) {
                killBird(arrow.targetBird);
                arrow.active = false;
                if (arrow.mesh) scene.remove(arrow.mesh);
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
    const modelHeight = targetModel?.userData?.planeMesh?.geometry?.parameters?.height || 430;
    const headThreshold = modelHeight * 0.8;
    const legThreshold = modelHeight * 0.34;
    const duckAvoidThreshold = modelHeight * 0.55;

    if (relativeY > headThreshold) {
        damage = 40;
        msg = "🎯 HEADSHOT! -40";
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

    if (isJumpActiveForPlayer(targetIndex) && (relativeY <= legThreshold || hitZone === 'leg')) {
        return { damage: 0, msg: "SAKRAB QUTULDI! 🤾", isCrit: false, hitZone: 'leg', isShieldHit: false, shieldActiveBlock: false, shieldlessDefense: false, jumpDodged: true };
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
function returnToMainMenu() {
    isPaused = false;
    isAnimating = false;
    if (spear) spear.active = false;
    if (secondarySpear) secondarySpear.active = false;
    hideFlyingSpear();
    
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
        } catch (_) {}
    }
    
    gameMode = 'menu';
    if (menuScreen) menuScreen.classList.remove('hidden');
    if (typeof updateCampaignUI === 'function') updateCampaignUI();
    if (typeof updateMenuWallpaper === 'function') updateMenuWallpaper();
    if (typeof updateTelegramBackButton === 'function') updateTelegramBackButton();
}

btnExitMenu.addEventListener('click', returnToMainMenu);
const btnDisconnectHome = document.getElementById('btn-disconnect-home');
if (btnDisconnectHome) {
    btnDisconnectHome.addEventListener('click', returnToMainMenu);
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
    } catch (_) {}
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
    } catch (_) {}
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
    updateTelegramBackButton();
    isPaused = false;
    isDragging = false;
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

socket.on('spearThrown', (data) => {
    const { playerIndex, angle, power, isArtillery, isFire } = data;
    setModelActionState(modelForPlayer(playerIndex), 'aim', 800);
    if (isFire) pendingFireShot = true;
    startSpearAnimation(playerIndex, angle, power, isArtillery);
});

socket.on('groundHit', (data) => {
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
});

socket.on('hitRegistered', (data) => {
    const { targetIndex, damage, newHealth, newShield, hitX, hitY, isShieldHit, hitAngle, shieldActiveBlock, shieldlessDefense, shieldBroke, hitZone, duckDodged, jumpDodged, isFire } = data;
    const targetModel = targetIndex === 0 ? p1Model : p2Model;

    if (isFire) {
        spawnFireBurst(hitX, hitY, 35);
        screenShake = Math.max(screenShake, 16);
    }

    if (spear && spear.playerIndex !== myPlayerIndex) {
        hideFlyingSpear();
        if (spear.isArtillery) {
            triggerCinematicExplosion(hitX, hitY);
            showDamageText(hitX, hitY + 80, `-${damage}`, false, true);
            if (damage > 0) knockDownModel(targetModel);
        } else {
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
                if (damage > 0) knockDownModel(targetModel);
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
    if (!data || data.playerIndex === myPlayerIndex) return;
    enemyDuckActive = !!data.active;
    setSoldierVisual(modelForPlayer(data.playerIndex), enemyDefenseActive ? 'defend' : 'idle');
});

socket.on('jumpStateChanged', (data) => {
    if (!data || data.playerIndex === myPlayerIndex) return;
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

socket.on('gameOver', (data) => {
    hideCoinTossModal();
    setTimeout(() => showGameOver(data.winnerIndex, data), 1200);
});

socket.on('opponentDisconnected', () => {
    hideCoinTossModal();
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
    myCrow = myProfile.crowhunt || 0;
    artilleryCount = myProfile.artillery || 0;
    updateSuperUI();
    updateHealthUI();
    myDefenseActive = false;
    enemyDefenseActive = false;
    myDuckActive = false;
    enemyDuckActive = false;
    setDefenseActive(false, false);
    setDuckActive(false, false);
    resetJumpStates();
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

socket.on('turnTimerStart', (data) => {
    if (typeof startTurnTimerUI === 'function') {
        startTurnTimerUI(data?.duration || 30);
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
    
    if (data && data.reason === 'timeout_forfeit') {
        if (winnerIndex === myPlayerIndex) {
            winnerText.innerText = "Siz g'alaba qozondingiz, raqibingiz chekindi!";
            winnerText.style.color = '#22c55e';
        } else {
            winnerText.innerText = "Vaqtingiz tugadi, siz yengildingiz!";
            winnerText.style.color = '#ef4444';
        }
    } else {
        const winner = winnerIndex === myPlayerIndex ? t.win : t.lose;
        winnerText.innerText = winner;
        winnerText.style.color = winnerIndex === myPlayerIndex ? '#22c55e' : '#ef4444';
    }

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
        triggerHaptic('success');
        myStats.wins++;
        if (gameMode === 'multi') {
            addScore(100);
            showCenterNotice("+100 Ball qo'shildi! 🏆", 2500);
        }
        if (typeof checkQuestProgress === 'function') checkQuestProgress('win', 1);
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
    } else {
        triggerHaptic('error');
    }
    myStats.games++;
    saveStats();
    submitLeaderboard();
    
    cameraState = 'target';
    cameraTargetX = winnerIndex === 0 ? p1Model.position.x : p2Model.position.x;
    const camFocus = getFocusCameraTarget(winnerIndex);
    cameraTargetY = camFocus.y;
    cameraZoomTarget = baseZoom * 1.5;

    // G'alaba qozonganda bayram konfetti effekti.
    if (winnerIndex === myPlayerIndex) {
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
    } catch (_) {}
}

if (restartBtn) {
    const handleRestartGame = safeModalAction((e) => {
        gameOverScreen.classList.add('hidden');
        if (gameMode === 'single') {
            const level = Math.max(1, singleCampaignLevel);
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
        menuScreen.classList.remove('hidden');
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
        if (socket && socket.connected) {
            socket.emit('rematchAccept', { roomName: currentRoomName });
        }
        if (rematchModal) rematchModal.classList.add('hidden');
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
        menuScreen.classList.remove('hidden');
        gameMode = 'menu';
        if (typeof updateMenuWallpaper === 'function') updateMenuWallpaper();
    });
    btnRematchDecline.addEventListener('click', handleRematchDecline);
    btnRematchDecline.addEventListener('touchend', handleRematchDecline, { passive: false });
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

    turnsSinceLastCrate = (typeof turnsSinceLastCrate === 'number' ? turnsSinceLastCrate : 0) + 1;
    if (turnsSinceLastCrate >= 4) {
        turnsSinceLastCrate = 0;
        if (typeof spawnAirDropCrate === 'function') spawnAirDropCrate();
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
        startX = thrower.position.x + (facingRight ? 200 : -200);
        startY = thrower.position.y + 150;
        
        if (playerIndex !== myPlayerIndex) {
            if (!window.enemyArtilleryCannon) {
                const tex = loadTexture('artileriya.png');
                const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
                window.enemyArtilleryCannon = new THREE.Mesh(new THREE.PlaneGeometry(280, 240), mat);
                scene.add(window.enemyArtilleryCannon);
            }
            window.enemyArtilleryCannon.scale.set(1.6, 1.6, 1.6);
            window.enemyArtilleryCannon.position.set(thrower.position.x + (facingRight ? 190 : -190), thrower.position.y + 200, thrower.position.z + 10);
                        
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
    const spearScale = isArtillery ? 2.5 : (isSpearmanThrow ? 1.9 : 1);
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
        // Owner's own projectile should pass through their wall.
        if (Number(spear.playerIndex) === Number(wall.ownerIndex)) continue;
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
        if (Number(shooterIndex) === Number(wall.ownerIndex)) continue;
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
    stickSpear(targetModel, hitX, hitY, secondarySpearGroup.rotation.z);
    
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
    
    // Raqib modellari bilan to'qnashuv
    const models = p3Model ? [p1Model, p2Model, p3Model] : [p1Model, p2Model];
    for (let i = 0; i < models.length; i++) {
        const m = models[i];
        if (!m || m.userData.isKnockedDown) continue;
        if (i === secondarySpear.playerIndex) continue;
        if (areAllies(i, secondarySpear.playerIndex)) continue;
        
        const modelHeight = m.userData?.planeMesh?.geometry?.parameters?.height || 430;
        const hitTopY = m.position.y + modelHeight;
        const hitBottomY = m.position.y + 30;
        const relativeY = secondarySpear.y - m.position.y;
        
        if (isDuckActiveForPlayer(i) && relativeY > modelHeight * 0.52) continue;
        if (isJumpActiveForPlayer(i) && relativeY < modelHeight * 0.34) continue;
        
        if (Math.abs(secondarySpear.x - m.position.x) < 65 &&
            secondarySpear.y > hitBottomY &&
            secondarySpear.y < hitTopY) {
            
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

    if (typeof checkAirDropCrateHit === 'function' && checkAirDropCrateHit()) {
        spear.active = false;
        isAnimating = false;
        resetCameraAfterImpact();
        hideFlyingSpear();
        if (gameMode === 'single') advanceSingleTurnAfterShot();
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
        if (m.userData.isKnockedDown) continue;
        const modelHeight = m.userData?.planeMesh?.geometry?.parameters?.height || 430;
        const hitTopY = m.position.y + modelHeight;
        const hitBottomY = m.position.y + 30;
        const relativeY = spear.y - m.position.y;
        if (isDuckActiveForPlayer(i) && relativeY > modelHeight * 0.52) continue;
        if (isJumpActiveForPlayer(i) && relativeY < modelHeight * 0.34) continue;
        // Ittifoqchini (bir tomondagi raqibni) o'qi/nayzasi urmaydi - dushmanlar
        // bir-birining jonini kamaytirmaydi (50+ levelda ikki dushman).
        if (i !== spear.playerIndex && areAllies(i, spear.playerIndex)) continue;
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
        
        // Bird hit text removed by user request
        
        if (spear.playerIndex === myPlayerIndex || gameMode === 'single') {
            if (spear.playerIndex === myPlayerIndex) {
                // Bird/crow kill penalty: can go below zero (debt mode).
                addScore(-2);
            }
            if (gameMode === 'multi') {
                if (!spear.entityHitEmitted) {
                    socket.emit('entityHit', { entityIndex: entities.indexOf(hitEntity), hitX, hitY, hitAngle: spearGroup.rotation.z, isArtillery: spear.isArtillery });
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

    // Tunda yulduzlar miltillaydi (faqat ko'rinib turganda).
    if (typeof starField !== 'undefined' && starField && starField.material.opacity > 0.01) {
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
            tree.rotation.z = (d.baseRot || 0) + Math.sin(now * 0.0012 * speed + phase) * amp * depthInfluence;
            tree.position.x = (d.baseX || tree.position.x) + Math.sin(now * 0.0006 * speed + phase) * (1.8 + band) * amp * 42;
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
        const dx = dragStart.x - dragCurrent.x;
        const dy = dragCurrent.y - dragStart.y;
        
        if (Math.sqrt(dx*dx + dy*dy) > 10) {
            let startX = myPlayerIndex === 0 ? p1Model.position.x + 60 : p2Model.position.x - 60;
            let startY = p1Model.position.y + 270;
            
            if (isArtilleryAiming) {
                startX = (myPlayerIndex === 0 ? p1Model.position.x : p2Model.position.x) + (myPlayerIndex === 0 ? 200 : -200);
                startY = (myPlayerIndex === 0 ? p1Model.position.y : p2Model.position.y) + 150;
            }
            
            
            
            let simX = startX;
            let simY = startY;
            const distance = Math.sqrt(dx*dx + dy*dy);
            const power = computeShotPower(distance);
            let angle = Math.atan2(dy, dx) * (180 / Math.PI);
            
            if (myPlayerIndex === 1) angle = 180 - angle;
            if (angle < -20) angle = -20;
            if (angle > 110) angle = 110;

            const rad = angle * (Math.PI / 180);
            let simVx = power * Math.cos(rad);
            if (myPlayerIndex === 1) simVx = -simVx;
            let simVy = power * Math.sin(rad);

            const allPoints = [];
            for(let i=0; i<110; i++) {
                allPoints.push(new THREE.Vector3(simX, simY, 0));
                simX += simVx * 0.05;
                simY += simVy * 0.05;
                simVy -= GRAVITY * 0.05;
                simVx += (currentWind * 30) * 0.05;
                if(simY < ground.position.y + 100) break;
            }
            // Trayektoriya to'liq ko'rsatilmasin, faqat yo'nalish uchun yarimgacha (45%) ko'rsatilsin
            const halfCount = Math.max(5, Math.min(32, Math.floor(allPoints.length * 0.45)));
            const points = allPoints.slice(0, halfCount);
            
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

    renderer.render(scene, camera);
    if(isLooping) requestAnimationFrame(gameLoop);
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
} catch (_) {}

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

async function autoLoginTelegramUser() {
    const tgUser = tg?.initDataUnsafe?.user;
    if (!tgUser || !tgUser.id) return false;

    // Telegram orqali ochilgan bo'lsa darhol auth modalni yashiramiz va menyuni ko'rsatamiz
    if (authModal) authModal.classList.add('hidden');
    if (menuScreen) menuScreen.classList.remove('hidden');

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
        const res = await fetch(`${API_BASE}/api/auth/telegram`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: tgUser })
        });
        const data = await res.json().catch(() => ({}));
        if (data && data.ok && data.user) {
            applyAuthedUser(data.user);
            console.log('[Telegram Auth] Avtomatik login bajarildi:', data.user.name);
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
    if (Number.isFinite(Number(user.score))) myStats.score = Number(user.score);
    if (Number.isFinite(Number(user.wins))) myStats.wins = Math.max(0, Number(user.wins));
    if (Number.isFinite(Number(user.games))) myStats.games = Math.max(0, Number(user.games));
    if (Number.isFinite(Number(user.superPowers))) myProfile.superPowers = Math.max(0, Number(user.superPowers));
    if (Number.isFinite(Number(user.doubleSpears))) myProfile.doubleSpears = Math.max(0, Number(user.doubleSpears));
    if (Number.isFinite(Number(user.walls))) myProfile.walls = Math.max(0, Number(user.walls));
    if (Number.isFinite(Number(user.artillery))) myProfile.artillery = Math.max(0, Number(user.artillery));
    if (Number.isFinite(Number(user.crowhunt))) myProfile.crowhunt = Math.max(0, Number(user.crowhunt));
    if (Number.isFinite(Number(user.fireSpears))) myProfile.fireSpears = Math.max(0, Number(user.fireSpears));
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
        }, 280);
    }
}, { passive: true, capture: true });

function safeModalAction(fn) {
    return function(e) {
        // Agar foydalanuvchi barmoq bilan menyuni / ekranni surgan (scroll qilgan) bo'lsa, tugma bosilmasligi shart!
        if (isTouchScrolling || (Date.now() - lastScrollEndTime < 280)) {
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
    'game-options-modal',
    'friend-add-modal'
];

function updateTelegramBackButton() {
    if (!window.Telegram?.WebApp?.BackButton) return;
    try {
        const isModalOpen = ALL_MODAL_IDS.some(id => {
            const el = document.getElementById(id);
            return el && !el.classList.contains('hidden');
        });
        const inGameModalEl = document.getElementById('in-game-modal');
        const isInGameModalOpen = inGameModalEl && !inGameModalEl.classList.contains('hidden');
        const isInGame = gameScreen && !gameScreen.classList.contains('hidden');

        if (isModalOpen || isInGameModalOpen || isInGame) {
            window.Telegram.WebApp.BackButton.show();
        } else {
            window.Telegram.WebApp.BackButton.hide();
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
    try {
        window.Telegram.WebApp.BackButton.onClick(handleGlobalBack);
    } catch (e) {
        console.warn('Telegram BackButton onClick error:', e);
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
    if (menuScreen) {
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
        // Shield the newly opened modal from any ghost clicks
        modalEl.style.pointerEvents = 'none';
        setTimeout(() => {
            if (modalEl) modalEl.style.pointerEvents = '';
        }, 320);
    }
    if (menuScreen) menuScreen.classList.add('hidden');
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
    showCenterNotice("Sozlamalar saqlandi!", 1500);
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

// --- Kirish intro ekrani logikasi ---
(function setupIntroScreen() {
    const introScreen = document.getElementById('intro-screen');
    if (!introScreen) return;
    
    // Agar bu sessiyada intro bir marta ko'rilgan bo'lsa, qayta ko'rsatilmaydi
    try {
        if (sessionStorage.getItem('kamonboz_intro_seen') === '1') {
            introScreen.classList.add('hide');
            introScreen.style.display = 'none';
            if (introScreen.parentNode) introScreen.parentNode.removeChild(introScreen);
            return;
        }
    } catch (_) {}
    
    let introDismissed = false;
    const dismissIntro = (e) => {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        if (introDismissed) return;
        introDismissed = true;
        try { sessionStorage.setItem('kamonboz_intro_seen', '1'); } catch (_) {}
        try { initAudio(); } catch (_) {}
        try { tryLockLandscapeOrientation(); } catch (_) {}
        introScreen.classList.add('hide');
        if (typeof updateMenuWallpaper === 'function') updateMenuWallpaper();
        setTimeout(() => {
            if (introScreen && introScreen.parentNode) introScreen.parentNode.removeChild(introScreen);
        }, 600);
    };

    const handleIntroStartGame = safeModalAction((e) => {
        dismissIntro(e);
        try { tryLockLandscapeOrientation(); } catch (_) {}
        
        // 1. Agar Telegramdan duel uchun havola orqali kirgan bo'lsa, duelga avtomatik ulanadi:
        if (typeof checkAutoJoinTelegramRoom === 'function' && checkAutoJoinTelegramRoom()) {
            if (authModal) authModal.classList.add('hidden');
            if (menuScreen) menuScreen.classList.add('hidden');
            return;
        }
        
        // 2. Havolasiz oddiy kirganda: Asosiy menyu ochilishi kerak (avtomatik level boshlanmaydi!):
        gameMode = 'menu';
        if (authModal) authModal.classList.add('hidden');
        if (menuScreen) {
            menuScreen.classList.remove('hidden');
        }
        if (typeof updateCampaignUI === 'function') updateCampaignUI();
        if (typeof updateMenuWallpaper === 'function') updateMenuWallpaper();
    });

    const startBtn = document.getElementById('btn-intro-start');
    if (startBtn) {
        startBtn.addEventListener('click', handleIntroStartGame);
        startBtn.addEventListener('touchend', handleIntroStartGame, { passive: false });
    }

    const handleBackgroundDismiss = (e) => {
        if (e.target === startBtn || (startBtn && startBtn.contains(e.target))) return;
        handleIntroStartGame(e);
    };
    introScreen.addEventListener('click', handleBackgroundDismiss);
    introScreen.addEventListener('touchend', handleBackgroundDismiss, { passive: true });
    // 4.5 soniyadan so'ng avtomatik menyuga o'tish
    setTimeout(() => {
        if (!introDismissed) {
            handleIntroStartGame();
        }
    }, 4500);
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
            LN.requestPermissions().catch(() => {});
            LN.createChannel({
                id: 'invite',
                name: "O'yin taklifi",
                importance: 5,
                vibration: true,
                sound: 'default'
            }).catch(() => {});
            LN.addListener('localNotificationActionPerformed', () => {
                // Notification bosilganda invite modal'ini ko'rsatish
                if (pendingFriendInvite) {
                    if (friendInviteText) friendInviteText.innerText = `${pendingFriendInvite.fromProfile?.name || "Do'stingiz"} sizni o'yinga chaqirdi. Qo'shilasizmi?`;
                    if (friendInviteModal) friendInviteModal.classList.remove('hidden');
                }
            }).catch(() => {});
        } catch (_) {}
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
    if (isTouchScrolling || (Date.now() - lastScrollEndTime < 280)) {
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
if(document.getElementById('btn-single')) {
    const handleSingle = safeModalAction((e) => {
        if(typeof initAudio === 'function') initAudio();
        if (singleModeModal) {
            openModalSafely(singleModeModal, e);
            return;
        }
        const level = Math.max(1, singleCampaignLevel);
        aiDifficulty = level < 6 ? 'easy' : level < 15 ? 'normal' : 'hard';
        gameMode = 'single';
        startSinglePlayer({ birds: true, animals: Math.random() > 0.45 });
    });
    document.getElementById('btn-single').addEventListener('click', handleSingle);
    document.getElementById('btn-single').addEventListener('touchend', handleSingle, { passive: false });
}

if (btnSingleContinue) {
    const handleContinue = safeModalAction((e) => {
        if (singleModeModal) singleModeModal.classList.add('hidden');
        if (menuScreen) menuScreen.classList.add('hidden');
        const level = Math.max(1, singleCampaignLevel);
        aiDifficulty = level < 6 ? 'easy' : level < 15 ? 'normal' : 'hard';
        gameMode = 'single';
        startSinglePlayer({ birds: true, animals: Math.random() > 0.45 });
    });
    btnSingleContinue.addEventListener('click', handleContinue);
    btnSingleContinue.addEventListener('touchend', handleContinue, { passive: false });
}

if (btnSingleNew) {
    const handleNew = safeModalAction((e) => {
        singleCampaignLevel = 1;
        localStorage.setItem('nayza_single_level', '1');
        updateCampaignUI();
        if (singleModeModal) singleModeModal.classList.add('hidden');
        if (menuScreen) menuScreen.classList.add('hidden');
        aiDifficulty = 'easy';
        gameMode = 'single';
        startSinglePlayer({ birds: true, animals: Math.random() > 0.45 });
    });
    btnSingleNew.addEventListener('click', handleNew);
    btnSingleNew.addEventListener('touchend', handleNew, { passive: false });
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
        const handleLevelPick = safeModalAction((e) => {
            singleCampaignLevel = i;
            if (levelSelectModal) levelSelectModal.classList.add('hidden');
            if (singleModeModal) singleModeModal.classList.add('hidden');
            menuScreen.classList.add('hidden');
            aiDifficulty = 'easy';
            gameMode = 'single';
            startSinglePlayer({ birds: true, animals: Math.random() > 0.45 });
        });
        levelBtn.addEventListener('click', handleLevelPick);
        levelBtn.addEventListener('touchend', handleLevelPick, { passive: false });

        levelGrid.appendChild(levelBtn);
    }
}

if(document.getElementById('btn-multi')) {
    const handleMulti = safeModalAction((e) => {
        if(typeof initAudio === 'function') initAudio();
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
    btnMultiCreate.addEventListener('click', () => {
        gameOptionsTargetMode = 'multiCreate';
        if (gameOptionsFields) gameOptionsFields.style.display = 'block';
        if (difficultyWrap) difficultyWrap.style.display = 'none';
        if (selectDifficulty) selectDifficulty.style.display = 'none';
        const diffWrap = document.getElementById('custom-wrap-select-difficulty');
        if (diffWrap) diffWrap.style.display = 'none';

        if (selectCharTypeOptions) selectCharTypeOptions.value = String(myProfile.charType || 2);
        ['select-map', 'select-weather', 'select-difficulty', 'select-char-type-options'].forEach(id => {
            const el = document.getElementById(id);
            if (el) setupCustomDropdown(el);
        });

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
    const handleJoinShow = safeModalAction((e) => {
        if (joinCodeContainer) joinCodeContainer.classList.toggle('hidden');
        if (joinError) joinError.style.display = 'none';
    });
    btnMultiJoinShow.addEventListener('click', handleJoinShow);
    btnMultiJoinShow.addEventListener('touchend', handleJoinShow, { passive: false });
}

if (btnMultiJoin) {
    btnMultiJoin.addEventListener('click', () => {
        if (!socket || !socket.connected) {
            if (joinError) {
                joinError.innerText = "Serverga ulanilmadi. Internetni tekshiring va qayta urinib ko'ring.";
                joinError.style.display = 'block';
            }
            return;
        }
        const code = (inputJoinCode && inputJoinCode.value ? inputJoinCode.value : '').trim().toUpperCase().slice(0, 4);
        if (!code) return;
        socket.emit('joinGame', { profile: myProfile, code });
    });
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
        const inviteUrl = `https://t.me/${botUsername}?startapp=${encodeURIComponent(code)}`;
        const webDirectUrl = `https://nayza-jangi.onrender.com/?room=${encodeURIComponent(code)}`;
        const inviteText = `🏹 Men bilan Kamonboz duelida 1v1 nayza jangiga kiring!\n🔑 Xona kodi: ${code}\n👇 Havolani bosing va darhol o'yinga ulaning:\n${webDirectUrl}`;
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
        } catch (_) {}
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
        } catch (_) {}
    }
    // 4. SessionStorage
    if (!code) {
        try {
            code = sessionStorage.getItem('nayza_pending_room');
        } catch (_) {}
    }
    if (code) {
        code = String(code).replace(/^(room_|duel_)/i, '').trim().toUpperCase();
        if (code.length >= 3) {
            try { sessionStorage.setItem('nayza_pending_room', code); } catch (_) {}
            return code;
        }
    }
    return null;
}

let autoJoinExecuted = false;
function checkAutoJoinTelegramRoom() {
    const code = getPendingRoomCode();
    if (!code) return false;

    // Har qanday holatda inputga ham to'ldirib qo'yamiz
    if (inputJoinCode) inputJoinCode.value = code;

    if (autoJoinExecuted) return true;

    // Agar socket hali serverga ulanmagan bo'lsa, connect hodisasini kutamiz
    if (!socket || !socket.connected) {
        console.log('[AutoJoin] Socket ulanishi kutilmoqda. Xona kodi:', code);
        return false;
    }

    autoJoinExecuted = true;
    console.log('[AutoJoin] Xonaga avtomatik ulanmoqda:', code);

    // Barcha oraliq ekranlarni yashirish
    const introEl = document.getElementById('intro-screen');
    if (introEl) {
        introEl.classList.add('hide');
        introEl.style.display = 'none';
        if (introEl.parentNode) introEl.parentNode.removeChild(introEl);
    }
    if (authModal) authModal.classList.add('hidden');
    if (menuScreen) menuScreen.classList.add('hidden');
    if (multiMenu) multiMenu.classList.add('hidden');
    if (joinCodeContainer) joinCodeContainer.classList.add('hidden');
    if (createCodeContainer) createCodeContainer.classList.add('hidden');
    if (gameOptionsModal) gameOptionsModal.classList.add('hidden');
    if (waitingScreen) waitingScreen.classList.remove('hidden');

    showCenterNotice(`⚔️ Taklif qilingan duelga (${code}) ulanilmoqda...`, 3000);
    socket.emit('joinGame', { profile: myProfile, code });
    return true;
}

socket.on('joinError', (err) => {
    autoJoinExecuted = false;
    try { sessionStorage.removeItem('nayza_pending_room'); } catch (_) {}
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
                }).catch(() => {});
            }
        } catch (_) {}
    }
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
        if (turnSecondsLeft < 0) {
            clearInterval(turnTimerInterval);
            turnSecondsLeft = 0;
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

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        picker.classList.toggle('hidden');
    });

    document.querySelectorAll('.emote-choice').forEach(choice => {
        choice.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const emoji = choice.getAttribute('data-emote');
            picker.classList.add('hidden');
            if (!emoji) return;

            if (gameMode === 'multi') {
                socket.emit('sendEmote', { emote: emoji });
            }
            spawnEmoteBubble(myPlayerIndex, emoji);
        });
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

function spawnAirDropCrate() {
    const { rootGroup, chestGroup, chuteGroup, beaconBulb } = create3DAirDropChest();
    const x = (Math.random() - 0.5) * 850;
    const y = 840;
    rootGroup.position.set(x, y, 10);
    scene.add(rootGroup);

    const crateObj = {
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

function checkAirDropCrateHit() {
    if (!spear || !spear.active) return false;
    for (let i = 0; i < airDropCrates.length; i++) {
        const c = airDropCrates[i];
        if (c.alive && Math.abs(spear.x - c.x) < 70 && Math.abs(spear.y - c.y) < 70) {
            c.alive = false;
            scene.remove(c.group);
            spawnParticles(c.x, c.y + 25, 40, true);
            spawnFireBurst(c.x, c.y + 25, 20);
            playSfx('break');

            const shooter = spear.playerIndex;
            const rewardTypes = ['hp', 'shield', 'double', 'fire', 'score'];
            const chosen = rewardTypes[Math.floor(Math.random() * rewardTypes.length)];

            if (chosen === 'hp') {
                if (shooter === 0) myHealth = Math.min(100, myHealth + 30);
                else enemyHealth = Math.min(100, enemyHealth + 30);
                updateHealthUI();
                showDamageText(c.x, c.y + 60, "🎁 +30 HP!", true, true);
            } else if (chosen === 'shield') {
                setShieldForPlayer(shooter, shieldForPlayer(shooter) + 2);
                showDamageText(c.x, c.y + 60, "🎁 +2 QALQON!", true, true);
            } else if (chosen === 'double') {
                if (shooter === myPlayerIndex) {
                    myProfile.doubleSpears = (myProfile.doubleSpears || 0) + 1;
                    saveProfile();
                    updateSuperUI();
                }
                showDamageText(c.x, c.y + 60, "🎁 +1 QO'SH NAYZA!", true, true);
            } else if (chosen === 'fire') {
                if (shooter === myPlayerIndex) {
                    myProfile.fireSpears = (myProfile.fireSpears || 0) + 1;
                    saveProfile();
                    updateSuperUI();
                }
                showDamageText(c.x, c.y + 60, "🎁 +1 OLOVLI NAYZA!", true, true);
            } else {
                if (shooter === myPlayerIndex) addScore(300);
                showDamageText(c.x, c.y + 60, "🎁 +300 BALL!", true, true);
            }
            return true;
        }
    }
    return false;
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
    } catch {}
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

// Universal smooth touch/drag scroll for menu and modals
(function setupMenuTouchScroll() {
    let scrollStartY = 0;
    let scrollStartX = 0;
    let initialScrollTop = 0;
    let isScrollDragging = false;
    let activeScrollPanel = null;
    let lastMoveTime = 0;
    let lastMoveY = 0;
    let scrollVelocity = 0;
    let isTouchActive = false;

    function getActiveScrollTarget(rawTarget) {
        if (rawTarget && typeof rawTarget.closest === 'function') {
            const grid = rawTarget.closest('#level-grid');
            if (grid) return grid;
            const scrollable = rawTarget.closest('#level-grid, .scrollable, [data-scrollable], .custom-select-menu, #profile-modal, #level-select-modal, .center-panel, .modal-panel');
            if (scrollable) return scrollable;
        }

        const profModal = document.getElementById('profile-modal');
        if (profModal && !profModal.classList.contains('hidden') && profModal.offsetParent !== null) {
            return profModal;
        }

        const lvlModal = document.getElementById('level-select-modal');
        if (lvlModal && !lvlModal.classList.contains('hidden') && lvlModal.offsetParent !== null) {
            const grid = document.getElementById('level-grid');
            if (grid) return grid;
            return lvlModal;
        }

        if (typeof gameMode !== 'undefined' && gameMode !== 'menu') {
            const activeModals = [
                document.getElementById('profile-modal'),
                document.getElementById('settings-modal'),
                document.getElementById('rating-modal'),
                document.getElementById('shop-modal'),
                document.getElementById('about-modal'),
                document.getElementById('help-modal'),
                document.getElementById('daily-rewards-modal'),
                document.getElementById('daily-quests-modal')
            ];
            for (const m of activeModals) {
                if (m && !m.classList.contains('hidden') && m.offsetParent !== null) return m;
            }
            return null;
        }

        const candidatePanels = [
            document.getElementById('profile-modal'),
            document.getElementById('single-mode-modal'),
            document.getElementById('multi-menu'),
            document.getElementById('settings-modal'),
            document.getElementById('rating-modal'),
            document.getElementById('shop-modal'),
            document.getElementById('daily-rewards-modal'),
            document.getElementById('daily-quests-modal'),
            document.getElementById('about-modal'),
            document.getElementById('help-modal'),
            document.getElementById('auth-modal'),
            document.getElementById('menu-screen')
        ];

        for (const p of candidatePanels) {
            if (p && !p.classList.contains('hidden') && p.offsetParent !== null) {
                return p;
            }
        }
        return null;
    }

    function handleDragStart(clientX, clientY, rawTarget) {
        activeScrollPanel = getActiveScrollTarget(rawTarget);
        if (!activeScrollPanel) return;

        const vpos = getPointerPos({ clientX, clientY });
        scrollStartY = vpos.y;
        scrollStartX = vpos.x;
        initialScrollTop = activeScrollPanel.scrollTop;
        isScrollDragging = false;
        lastMoveTime = performance.now();
        lastMoveY = vpos.y;
        scrollVelocity = 0;
    }

    function handleDragMove(clientX, clientY, rawEvent) {
        if (!activeScrollPanel) return;
        const vpos = getPointerPos({ clientX, clientY });
        const dy = vpos.y - scrollStartY;
        const dx = vpos.x - scrollStartX;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (!isScrollDragging && (dist > 6 || Math.abs(dy) > 4)) {
            isScrollDragging = true;
            isTouchScrolling = true;
            lastScrollEndTime = Date.now();
        }

        if (isScrollDragging) {
            isTouchScrolling = true;
            lastScrollEndTime = Date.now();
            activeScrollPanel.scrollTop = initialScrollTop - dy;
            
            const now = performance.now();
            const dt = now - lastMoveTime;
            if (dt > 8) {
                scrollVelocity = (vpos.y - lastMoveY) / dt;
                lastMoveTime = now;
                lastMoveY = vpos.y;
            }
            if (rawEvent && rawEvent.cancelable) {
                rawEvent.preventDefault();
            }
        }
    }

    function handleDragEnd() {
        if (isScrollDragging) {
            isTouchScrolling = true;
            lastScrollEndTime = Date.now();
            setTimeout(() => { isTouchScrolling = false; }, 280);

            if (activeScrollPanel && Math.abs(scrollVelocity) > 0.12) {
                const momentum = scrollVelocity * 160;
                activeScrollPanel.scrollBy({ top: -momentum, behavior: 'smooth' });
            }

            const suppressEvent = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                ev.stopImmediatePropagation();
            };
            window.addEventListener('click', suppressEvent, { capture: true, once: true });
            window.addEventListener('touchend', suppressEvent, { capture: true, once: true });
            setTimeout(() => {
                window.removeEventListener('click', suppressEvent, { capture: true });
                window.removeEventListener('touchend', suppressEvent, { capture: true });
            }, 280);
        }
        isScrollDragging = false;
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

// Initialization logic
function _runPageInits() {
    initDailyRewards();
    initDailyQuests();
    initEmotesUI();
    initCoinTossUI();
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
                    myArtilleryCannon = new THREE.Mesh(new THREE.PlaneGeometry(280, 240), mat);
                    scene.add(myArtilleryCannon);
                }
                const playerGrp = myPlayerIndex === 0 ? p1Model : p2Model;
                if (playerGrp) {
                    myArtilleryCannon.scale.set(1.6, 1.6, 1.6);
                    myArtilleryCannon.position.set(playerGrp.position.x + (myPlayerIndex === 0 ? 190 : -190), playerGrp.position.y + 200, playerGrp.position.z + 10);
                    myArtilleryCannon.visible = true;
                    if (myPlayerIndex === 0) {
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
