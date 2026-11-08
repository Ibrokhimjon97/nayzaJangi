const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: true,
        methods: ['GET', 'POST']
    }
});

app.use(cors({ origin: true }));
app.use(express.json());
app.use((req, res, next) => {
    if (req.path === '/' || req.path.endsWith('.html') || req.path.endsWith('.json')) {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }
    next();
});
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/ping', (req, res) => res.status(200).send('pong'));
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', uptime: Math.floor(process.uptime()), timestamp: Date.now() }));
app.use(express.static(path.join(__dirname, 'public')));

const multer = require('multer');
const customModelsPath = path.join(__dirname, 'public', 'custom_models.json');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = path.join(__dirname, 'public', 'custom_models');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

function loadCustomModels() {
    try {
        if (!fs.existsSync(customModelsPath)) return [];
        return JSON.parse(fs.readFileSync(customModelsPath, 'utf8'));
    } catch {
        return [];
    }
}

function saveCustomModels(models) {
    fs.writeFileSync(customModelsPath, JSON.stringify(models, null, 2), 'utf8');
}

app.get('/api/models', (req, res) => {
    res.json(loadCustomModels());
});
app.post('/api/models/delete', express.json(), (req, res) => {
    try {
        const id = req.body.id;
        let models = loadCustomModels();
        const modelToDelete = models.find(m => m.id === id);
        if (modelToDelete) {
            // Delete texture files
            if (modelToDelete.textures) {
                const uniqueFiles = new Set(Object.values(modelToDelete.textures));
                uniqueFiles.forEach(filePath => {
                    const absolutePath = path.join(__dirname, 'public', filePath);
                    if (fs.existsSync(absolutePath)) {
                        try { fs.unlinkSync(absolutePath); } catch (err) { console.error('Error deleting texture file:', err); }
                    }
                });
            }
            // Delete background music
            if (modelToDelete.bgMusic) {
                const absolutePath = path.join(__dirname, 'public', modelToDelete.bgMusic);
                if (fs.existsSync(absolutePath)) {
                    try { fs.unlinkSync(absolutePath); } catch (err) { console.error('Error deleting music file:', err); }
                }
            }
        }
        models = models.filter(m => m.id !== id);
        saveCustomModels(models);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/models/update', upload.fields([
    { name: 'shieldIdle', maxCount: 1 },
    { name: 'shieldAim', maxCount: 1 },
    { name: 'shieldDuck', maxCount: 1 },
    { name: 'shieldDefend', maxCount: 1 },
    { name: 'shieldHurt', maxCount: 1 },
    { name: 'shieldBreak', maxCount: 1 },
    { name: 'shieldAfterShot', maxCount: 1 },
    { name: 'shieldJump', maxCount: 1 },
    { name: 'noShieldIdle', maxCount: 1 },
    { name: 'noShieldAim', maxCount: 1 },
    { name: 'noShieldDuck', maxCount: 1 },
    { name: 'noShieldDefend', maxCount: 1 },
    { name: 'noShieldHurt', maxCount: 1 },
    { name: 'noShieldAfterShot', maxCount: 1 },
    { name: 'noShieldJump', maxCount: 1 },
    { name: 'celebrate', maxCount: 1 },
    { name: 'bgMusic', maxCount: 1 }
]), (req, res) => {
    try {
        const id = req.body.id;
        const models = loadCustomModels();
        const modelIndex = models.findIndex(m => m.id === id);
        if (modelIndex === -1) return res.status(404).json({ ok: false, error: 'Model topilmadi' });

        const files = req.files || {};
        const oldModel = models[modelIndex];

        if (req.body.name) oldModel.name = req.body.name;

        oldModel.settings = oldModel.settings || {};
        if (req.body.width !== undefined) oldModel.settings.width = Number(req.body.width);
        if (req.body.height !== undefined) oldModel.settings.height = Number(req.body.height);
        if (req.body.offsetY !== undefined) oldModel.settings.offsetY = Number(req.body.offsetY);
        if (req.body.offsetX !== undefined) oldModel.settings.offsetX = Number(req.body.offsetX);
        if (req.body.weaponType !== undefined) oldModel.weaponType = req.body.weaponType;

        const fileNames = ['shieldIdle', 'shieldAim', 'shieldDuck', 'shieldDefend', 'shieldHurt', 'shieldBreak', 'shieldAfterShot', 'shieldJump', 'noShieldIdle', 'noShieldAim', 'noShieldDuck', 'noShieldDefend', 'noShieldHurt', 'noShieldAfterShot', 'noShieldJump', 'celebrate'];
        fileNames.forEach(fn => {
            if (files[fn] && files[fn][0]) {
                oldModel.textures[fn] = 'custom_models/' + files[fn][0].filename;
            }
        });

        if (files.bgMusic && files.bgMusic[0]) {
            oldModel.bgMusic = 'custom_models/' + files.bgMusic[0].filename;
        }

        saveCustomModels(models);
        res.json({ ok: true, model: oldModel });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});


app.post('/api/models/create', upload.fields([
    { name: 'shieldIdle', maxCount: 1 },
    { name: 'shieldAim', maxCount: 1 },
    { name: 'shieldDuck', maxCount: 1 },
    { name: 'shieldDefend', maxCount: 1 },
    { name: 'shieldHurt', maxCount: 1 },
    { name: 'shieldBreak', maxCount: 1 },
    { name: 'shieldAfterShot', maxCount: 1 },
    { name: 'shieldJump', maxCount: 1 },
    { name: 'noShieldIdle', maxCount: 1 },
    { name: 'noShieldAim', maxCount: 1 },
    { name: 'noShieldDuck', maxCount: 1 },
    { name: 'noShieldDefend', maxCount: 1 },
    { name: 'noShieldHurt', maxCount: 1 },
    { name: 'noShieldAfterShot', maxCount: 1 },
    { name: 'noShieldJump', maxCount: 1 },
    { name: 'celebrate', maxCount: 1 },
    { name: 'bgMusic', maxCount: 1 }
]), (req, res) => {
    try {
        const name = req.body.name || 'Yangi Model';
        const files = req.files || {};
        if (!files.shieldIdle || !files.shieldAim || !files.shieldDuck || !files.shieldDefend || !files.shieldHurt || !files.shieldBreak || !files.noShieldIdle || !files.noShieldAim || !files.noShieldDuck || !files.noShieldDefend || !files.noShieldHurt) {
            console.error('Kemtik fayllar:', Object.keys(files));
            return res.status(400).json({ ok: false, error: 'Barcha asosiy rasmlar yuklanishi shart. Yuborilgan fayllar: ' + Object.keys(files).join(', ') });
        }
        const models = loadCustomModels();
        const newModel = {
            id: 'custom_' + Date.now(),
            name: name,
            textures: {
                shieldIdle: 'custom_models/' + files.shieldIdle[0].filename,
                shieldAim: 'custom_models/' + files.shieldAim[0].filename,
                shieldDuck: 'custom_models/' + files.shieldDuck[0].filename,
                shieldDefend: 'custom_models/' + files.shieldDefend[0].filename,
                shieldHurt: 'custom_models/' + files.shieldHurt[0].filename,
                shieldBreak: 'custom_models/' + files.shieldBreak[0].filename,
                noShieldIdle: 'custom_models/' + files.noShieldIdle[0].filename,
                noShieldAim: 'custom_models/' + files.noShieldAim[0].filename,
                noShieldDuck: 'custom_models/' + files.noShieldDuck[0].filename,
                noShieldDefend: 'custom_models/' + files.noShieldDefend[0].filename,
                noShieldHurt: 'custom_models/' + files.noShieldHurt[0].filename,
                shieldAfterShot: files.shieldAfterShot ? 'custom_models/' + files.shieldAfterShot[0].filename : (files.shieldAim ? 'custom_models/' + files.shieldAim[0].filename : 'custom_models/' + files.shieldIdle[0].filename),
                noShieldAfterShot: files.noShieldAfterShot ? 'custom_models/' + files.noShieldAfterShot[0].filename : (files.shieldAfterShot ? 'custom_models/' + files.shieldAfterShot[0].filename : 'custom_models/' + files.noShieldIdle[0].filename),
                shieldJump: files.shieldJump ? 'custom_models/' + files.shieldJump[0].filename : (files.shieldDuck ? 'custom_models/' + files.shieldDuck[0].filename : 'custom_models/' + files.shieldIdle[0].filename),
                noShieldJump: files.noShieldJump ? 'custom_models/' + files.noShieldJump[0].filename : (files.shieldJump ? 'custom_models/' + files.shieldJump[0].filename : (files.noShieldDuck ? 'custom_models/' + files.noShieldDuck[0].filename : 'custom_models/' + files.noShieldIdle[0].filename)),
                celebrate: files.celebrate ? 'custom_models/' + files.celebrate[0].filename : 'custom_models/' + files.shieldIdle[0].filename
            },
            weaponType: req.body.weaponType || 'spear',
            bgMusic: files.bgMusic ? 'custom_models/' + files.bgMusic[0].filename : null,
            settings: {
                width: Number(req.body.width) || 560,
                height: Number(req.body.height) || 430,
                offsetY: Number(req.body.offsetY) || 0,
                offsetX: Number(req.body.offsetX) || 0
            }
        };
        models.push(newModel);
        saveCustomModels(models);
        res.json({ ok: true, model: newModel });
    } catch (e) {
        console.error('Model saqlashda xatolik:', e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

const leaderboardDbPath = path.join(__dirname, 'ratings.json');
const usersDbPath = path.join(__dirname, 'users.json');
const duelInvitesDbPath = path.join(__dirname, 'duel_invites.json');
const avatarsDir = path.join(__dirname, 'public', 'avatars');
if (!fs.existsSync(avatarsDir)) {
    try { fs.mkdirSync(avatarsDir, { recursive: true }); } catch (_) {}
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseEnabled = Boolean(supabaseUrl && supabaseServiceRoleKey);
const supabase = supabaseEnabled
    ? createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } })
    : null;

function loadDuelInvites() {
    try {
        if (!fs.existsSync(duelInvitesDbPath)) return [];
        const raw = fs.readFileSync(duelInvitesDbPath, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveDuelInvites(invites) {
    safeWriteJsonSync(duelInvitesDbPath, invites);
}

function loadLeaderboard() {
    try {
        if (!fs.existsSync(leaderboardDbPath)) return [];
        const raw = fs.readFileSync(leaderboardDbPath, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function safeWriteJsonSync(filePath, data) {
    const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tempPath, filePath);
    } catch {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    }
}

function saveLeaderboard(entries) {
    safeWriteJsonSync(leaderboardDbPath, entries);
}

function normalizeEntry(body) {
    const games = Math.max(0, Number(body?.games) || 0);
    const wins = Math.max(0, Number(body?.wins) || 0);
    const forfeits = Math.max(0, Number(body?.forfeits) || 0);
    const losses = body?.losses !== undefined ? Math.max(0, Number(body?.losses) || 0) : Math.max(0, games - wins);
    return {
        name: String(body?.name || 'Jangchi').slice(0, 30),
        flag: String(body?.flag || '🏳️').slice(0, 8),
        phone: String(body?.phone || '').replace(/\D/g, '').slice(-15),
        photoUrl: String(body?.photoUrl || ''),
        score: Number(body?.score) || 0,
        wins: wins,
        losses: losses,
        forfeits: forfeits,
        games: games,
        campaignLevel: Math.max(1, Number(body?.campaignLevel) || 1),
        updatedAt: Date.now()
    };
}

function loadUsers() {
    try {
        if (!fs.existsSync(usersDbPath)) return [];
        const raw = fs.readFileSync(usersDbPath, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveUsers(users) {
    safeWriteJsonSync(usersDbPath, users);
}

function ensureLegacyBonus(users) {
    let changed = false;
    const migrated = (users || []).map((u) => {
        const normalizedStoredPhone = normalizePhone(u?.phone || '');
        const score = Number(u?.score || 0);
        const needsScore = score < 500;
        const needsPhone = normalizedStoredPhone && normalizedStoredPhone !== String(u?.phone || '');
        const needsInventoryDefaults =
            !Number.isFinite(Number(u?.superPowers)) ||
            !Number.isFinite(Number(u?.doubleSpears)) ||
            !Number.isFinite(Number(u?.walls));
        if (!needsScore && !needsPhone && !needsInventoryDefaults) return u;
        changed = true;
        return {
            ...u,
            phone: normalizedStoredPhone || String(u?.phone || ''),
            score: needsScore ? 500 : score,
            superPowers: Math.max(0, Number(u?.superPowers || 0)),
            doubleSpears: Math.max(0, Number(u?.doubleSpears || 0)),
            walls: Math.max(0, Number(u?.walls || 0))
        };
    });
    if (changed) saveUsers(migrated);
    return migrated;
}

// One-time migration at startup: legacy accounts get minimum 500 score.
ensureLegacyBonus(loadUsers());

const PASSWORD_SALT = 'kamonboz_v2_salt_secure_2026';

function hashPassword(password, salt = PASSWORD_SALT) {
    return crypto.createHash('sha256').update(String(password || '') + ':' + salt).digest('hex');
}

function verifyPassword(inputPassword, storedHash) {
    if (!storedHash) return false;
    // 1. Check with current v2 salt
    if (storedHash === hashPassword(inputPassword, PASSWORD_SALT)) return true;
    // 2. Fallback to legacy unsalted hash for existing accounts
    const legacy = crypto.createHash('sha256').update(String(inputPassword || '')).digest('hex');
    return legacy === storedHash;
}

function normalizePhone(phone) {
    const raw = String(phone || '').trim();
    if (raw.startsWith('tg_')) return raw;
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 9) return `998${digits}`;
    if (digits.length === 12 && digits.startsWith('998')) return digits;
    if (digits.length > 9) return `998${digits.slice(-9)}`;
    return '';
}

function toPublicUser(user) {
    const games = Math.max(0, Number(user.games) || 0);
    const wins = Math.max(0, Number(user.wins) || 0);
    const forfeits = Math.max(0, Number(user.forfeits) || 0);
    const losses = user.losses !== undefined ? Math.max(0, Number(user.losses) || 0) : Math.max(0, games - wins);
    const winRate = games > 0 ? Math.round((wins / games) * 100) : 0;
    return {
        id: user.id || user.phone,
        playerId: user.phone || user.id,
        name: user.name,
        phone: user.phone,
        tgId: user.tgId || '',
        photoUrl: user.photoUrl || '',
        age: user.age,
        score: Number(user.score) || 0,
        wins: wins,
        losses: losses,
        forfeits: forfeits,
        games: games,
        winRate: winRate,
        campaignLevel: Math.max(1, Number(user.campaignLevel) || 1),
        friends: Array.isArray(user.friends) ? user.friends : [],
        superPowers: Math.max(0, Number(user.superPowers || 0)),
        doubleSpears: Math.max(0, Number(user.doubleSpears || 0)),
        walls: Math.max(0, Number(user.walls || 0)),
        artillery: Math.max(0, Number(user.artillery || 0)),
        crowhunt: Math.max(0, Number(user.crowhunt || 0)),
        fireSpears: Math.max(0, Number(user.fireSpears || 0))
    };
}

function findUserIndexByPhone(users, phone) {
    const raw = String(phone || '').trim();
    if (!raw) return -1;
    if (raw.startsWith('tg_')) {
        const tgId = raw.replace('tg_', '');
        return (users || []).findIndex((u) => u?.phone === raw || String(u?.tgId) === tgId);
    }
    const phoneNorm = normalizePhone(raw);
    if (!phoneNorm) return -1;
    const phoneTail = phoneNorm.slice(-9);
    return (users || []).findIndex((u) => {
        if (String(u?.phone || '').startsWith('tg_')) return false;
        const storedNorm = normalizePhone(u?.phone || '');
        if (storedNorm) return storedNorm === phoneNorm;
        const rawTail = String(u?.phone || '').replace(/\D/g, '').slice(-9);
        return rawTail && rawTail === phoneTail;
    });
}

function upsertUserProgress(phone, progress = {}) {
    if (!phone) return;
    const users = loadUsers();
    const idx = findUserIndexByPhone(users, phone);
    if (idx === -1) return;
    const prev = users[idx];
    users[idx] = {
        ...prev,
        score: Number.isFinite(Number(progress.score)) ? Number(progress.score) : Number(prev.score || 0),
        wins: Math.max(Number(prev.wins || 0), Number(progress.wins || 0)),
        losses: Number.isFinite(Number(progress.losses)) ? Number(progress.losses) : Number(prev.losses || 0),
        forfeits: Number.isFinite(Number(progress.forfeits)) ? Number(progress.forfeits) : Number(prev.forfeits || 0),
        games: Math.max(Number(prev.games || 0), Number(progress.games || 0)),
        campaignLevel: Math.max(Number(prev.campaignLevel || 1), Number(progress.campaignLevel || 1)),
        photoUrl: progress.photoUrl || prev.photoUrl || '',
        superPowers: Number.isFinite(Number(progress.superPowers)) ? Math.max(0, Number(progress.superPowers)) : Math.max(0, Number(prev.superPowers || 0)),
        doubleSpears: Number.isFinite(Number(progress.doubleSpears)) ? Math.max(0, Number(progress.doubleSpears)) : Math.max(0, Number(prev.doubleSpears || 0)),
        walls: Number.isFinite(Number(progress.walls)) ? Math.max(0, Number(progress.walls)) : Math.max(0, Number(prev.walls || 0)),
        artillery: Number.isFinite(Number(progress.artillery)) ? Math.max(0, Number(progress.artillery)) : Math.max(0, Number(prev.artillery || 0)),
        crowhunt: Number.isFinite(Number(progress.crowhunt)) ? Math.max(0, Number(progress.crowhunt)) : Math.max(0, Number(prev.crowhunt || 0)),
        fireSpears: Number.isFinite(Number(progress.fireSpears)) ? Math.max(0, Number(progress.fireSpears)) : Math.max(0, Number(prev.fireSpears || 0)),
        updatedAt: Date.now()
    };
    saveUsers(users);
}

async function fetchLeaderboardRows(limit) {
    if (!supabaseEnabled) {
        return loadLeaderboard()
            .sort((a, b) => (b.score - a.score) || (b.wins - a.wins) || (a.games - b.games))
            .slice(0, limit);
    }
    const { data, error } = await supabase
        .from('leaderboard')
        .select('name,flag,score,wins,games,updated_at')
        .order('score', { ascending: false })
        .order('wins', { ascending: false })
        .order('games', { ascending: true })
        .limit(limit);
    if (error) throw error;
    return (data || []).map((row) => ({
        name: row.name,
        flag: row.flag,
        score: Number(row.score) || 0,
        wins: Number(row.wins) || 0,
        games: Number(row.games) || 0,
        updatedAt: row.updated_at ? Date.parse(row.updated_at) : Date.now()
    }));
}

async function upsertLeaderboardEntry(entry) {
    if (!supabaseEnabled) {
        const rows = loadLeaderboard();
        const key = entry.phone ? `phone:${entry.phone}` : `${entry.name}|${entry.flag}`;
        const idx = entry.phone
            ? rows.findIndex((r) => `phone:${String(r.phone || '')}` === key)
            : rows.findIndex((r) => `${r.name}|${r.flag}` === key);

        if (idx === -1) {
            rows.push(entry);
        } else {
            const prev = rows[idx];
            rows[idx] = {
                ...prev,
                score: Math.max(prev.score || 0, entry.score),
                wins: Math.max(prev.wins || 0, entry.wins),
                games: Math.max(prev.games || 0, entry.games),
                phone: entry.phone || prev.phone || '',
                updatedAt: Date.now()
            };
        }
        saveLeaderboard(rows);
        return;
    }

    const playerKey = entry.phone ? `phone:${entry.phone}` : `${entry.name}|${entry.flag}`;
    const { data: existing, error: existingError } = await supabase
        .from('leaderboard')
        .select('score,wins,games')
        .eq('player_key', playerKey)
        .maybeSingle();
    if (existingError) throw existingError;

    const payload = {
        player_key: playerKey,
        name: entry.name,
        flag: entry.flag,
        score: Math.max(Number(existing?.score || 0), entry.score),
        wins: Math.max(Number(existing?.wins || 0), entry.wins),
        games: Math.max(Number(existing?.games || 0), entry.games),
        updated_at: new Date().toISOString()
    };

    const { error: upsertError } = await supabase
        .from('leaderboard')
        .upsert(payload, { onConflict: 'player_key' });
    if (upsertError) throw upsertError;
}

app.get('/api/leaderboard', async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    try {
        const rows = await fetchLeaderboardRows(limit);
        res.json({ rows, source: supabaseEnabled ? 'supabase' : 'file' });
    } catch {
        const rows = loadLeaderboard()
            .sort((a, b) => (b.score - a.score) || (b.wins - a.wins) || (a.games - b.games))
            .slice(0, limit);
        res.json({ rows, source: 'file-fallback' });
    }
});

app.post('/api/leaderboard', async (req, res) => {
    const entry = normalizeEntry(req.body || {});
    const campaignLevel = Math.max(1, Number(req.body?.campaignLevel) || 1);
    const superPowers = Math.max(0, Number(req.body?.superPowers || 0));
    const doubleSpears = Math.max(0, Number(req.body?.doubleSpears || 0));
    const walls = Math.max(0, Number(req.body?.walls || 0));
    const artillery = Math.max(0, Number(req.body?.artillery || 0));
    const crowhunt = Math.max(0, Number(req.body?.crowhunt || 0));
    const fireSpears = Math.max(0, Number(req.body?.fireSpears || 0));
    try {
        await upsertLeaderboardEntry(entry);
        if (entry.phone) {
            upsertUserProgress(entry.phone, {
                score: entry.score,
                wins: entry.wins,
                games: entry.games,
                campaignLevel,
                superPowers,
                doubleSpears,
                walls,
                artillery,
                crowhunt,
                fireSpears
            });
        }
        res.json({ ok: true, source: supabaseEnabled ? 'supabase' : 'file' });
    } catch {
        // Emergency fallback so gameplay never breaks if DB is down.
        try {
            const rows = loadLeaderboard();
            const key = entry.phone ? `phone:${entry.phone}` : `${entry.name}|${entry.flag}`;
            const existingIndex = entry.phone
                ? rows.findIndex((r) => `phone:${String(r.phone || '')}` === key)
                : rows.findIndex((r) => `${r.name}|${r.flag}` === key);
            if (existingIndex === -1) rows.push(entry);
            else {
                const prev = rows[existingIndex];
                rows[existingIndex] = {
                    ...prev,
                    score: Math.max(prev.score || 0, entry.score),
                    wins: Math.max(prev.wins || 0, entry.wins),
                    games: Math.max(prev.games || 0, entry.games),
                    phone: entry.phone || prev.phone || '',
                    updatedAt: Date.now()
                };
            }
            saveLeaderboard(rows);
            if (entry.phone) {
                upsertUserProgress(entry.phone, {
                    score: entry.score,
                    wins: entry.wins,
                    games: entry.games,
                    campaignLevel,
                    superPowers,
                    doubleSpears,
                    walls,
                    artillery,
                    crowhunt,
                    fireSpears
                });
            }
            res.json({ ok: true, source: 'file-fallback' });
        } catch {
            res.status(500).json({ ok: false, error: 'leaderboard_write_failed' });
        }
    }
});

app.post('/api/auth/register', (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 30);
    const phone = normalizePhone(req.body?.phone || '');
    const age = Math.max(7, Math.min(99, Number(req.body?.age) || 0));
    const password = String(req.body?.password || '');
    if (!name || phone.length !== 12 || !age || password.length < 4) {
        res.status(400).json({ ok: false, error: 'invalid_payload' });
        return;
    }
    const users = ensureLegacyBonus(loadUsers());
    if (users.some((u) => u.phone === phone)) {
        res.status(409).json({ ok: false, error: 'phone_exists' });
        return;
    }
    const user = {
        id: String(Date.now()),
        name,
        phone,
        age,
        score: 500,
        wins: 0,
        games: 0,
        campaignLevel: 1,
        superPowers: 5,
        doubleSpears: 0,
        walls: 0,
        artillery: 0,
        crowhunt: 0,
        fireSpears: 0,
        passwordHash: hashPassword(password),
        createdAt: Date.now()
    };
    users.push(user);
    saveUsers(users);
    res.json({ ok: true, user: toPublicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
    const phone = normalizePhone(req.body?.phone || '');
    const password = String(req.body?.password || '');
    if (phone.length !== 12 || password.length < 4) {
        res.status(401).json({ ok: false, error: 'invalid_credentials' });
        return;
    }
    const users = ensureLegacyBonus(loadUsers());
    const userIdx = findUserIndexByPhone(users, phone);
    const user = userIdx >= 0 ? users[userIdx] : null;
    if (!user || !verifyPassword(password, user.passwordHash)) {
        res.status(401).json({ ok: false, error: 'invalid_credentials' });
        return;
    }
    // Upgrade legacy unsalted hash to salted hash transparently
    if (user.passwordHash !== hashPassword(password)) {
        user.passwordHash = hashPassword(password);
        saveUsers(users);
    }
    res.json({ ok: true, user: toPublicUser(user) });
});

app.post('/api/auth/reset-password', (req, res) => {
    const phone = normalizePhone(req.body?.phone || '');
    const newPassword = String(req.body?.newPassword || '');
    const age = Number(req.body?.age || 0);
    const oldPassword = String(req.body?.oldPassword || '');

    if (phone.length !== 12 || newPassword.length < 4) {
        res.status(400).json({ ok: false, error: 'invalid_payload' });
        return;
    }
    const users = ensureLegacyBonus(loadUsers());
    const idx = findUserIndexByPhone(users, phone);
    if (idx === -1) {
        res.status(404).json({ ok: false, error: 'user_not_found' });
        return;
    }
    const user = users[idx];
    // Security challenge: must know old password OR the registered account age
    const passedOldPass = oldPassword && verifyPassword(oldPassword, user.passwordHash);
    const passedAge = age && Number(user.age) === age;

    if (!passedOldPass && !passedAge) {
        res.status(403).json({ ok: false, error: 'security_check_failed', message: "Eski parol yoki ro'yxatdan o'tgan yoshingiz tasdiqlanmadi!" });
        return;
    }

    users[idx].passwordHash = hashPassword(newPassword);
    saveUsers(users);
    res.json({ ok: true });
});

app.get('/api/auth/user', (req, res) => {
    const raw = String(req.query.phone || '').trim();
    const phone = normalizePhone(raw);
    if (!phone || (!phone.startsWith('tg_') && phone.length !== 12)) {
        res.status(404).json({ ok: false, error: 'user_not_found' });
        return;
    }
    const users = ensureLegacyBonus(loadUsers());
    const idx = findUserIndexByPhone(users, phone);
    const user = idx >= 0 ? users[idx] : null;
    if (!user) {
        res.status(404).json({ ok: false, error: 'user_not_found' });
        return;
    }
    res.json({ ok: true, user: toPublicUser(user) });
});

app.post('/api/auth/telegram', async (req, res) => {
    const tgUser = req.body?.user;
    if (!tgUser || !tgUser.id) {
        return res.status(400).json({ ok: false, error: 'missing_tg_user' });
    }
    const tgId = String(tgUser.id);
    const phone = 'tg_' + tgId;
    const name = ([tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || tgUser.username || 'Jangchi').slice(0, 30);
    let photoUrl = tgUser.photo_url || '';

    if (!photoUrl) {
        try {
            const { getTelegramUserPhotoUrl } = require('./telegramBot');
            photoUrl = (await getTelegramUserPhotoUrl(tgId)) || '';
        } catch (_) {}
    }

    const users = ensureLegacyBonus(loadUsers());
    let idx = users.findIndex(u => u.phone === phone || String(u.tgId) === tgId);

    if (idx === -1) {
        const newUser = {
            id: String(Date.now()),
            tgId,
            name,
            phone,
            photoUrl,
            username: tgUser.username || '',
            age: 20,
            score: 500,
            wins: 0,
            losses: 0,
            forfeits: 0,
            games: 0,
            friends: [],
            campaignLevel: 1,
            superPowers: 5,
            doubleSpears: 2,
            walls: 2,
            artillery: 1,
            crowhunt: 1,
            fireSpears: 2,
            createdAt: Date.now()
        };
        users.push(newUser);
        saveUsers(users);
        idx = users.length - 1;
        console.log(`[Telegram Auth] Yangi Telegram o'yinchisi avtomatik ro'yxatdan o'tdi: ${name} (TG ID: ${tgId})`);
    } else {
        let changed = false;
        if (name && (!users[idx].name || users[idx].name === 'Player' || users[idx].name === "Noma'lum")) {
            users[idx].name = name;
            changed = true;
        }
        if (photoUrl && users[idx].photoUrl !== photoUrl) {
            users[idx].photoUrl = photoUrl;
            changed = true;
        }
        if (changed) saveUsers(users);
    }
    res.json({ ok: true, user: toPublicUser(users[idx]) });
});

// Proxy / Redirect to Telegram Profile Photo
app.get('/api/telegram/avatar/:tgId', async (req, res) => {
    const tgId = req.params.tgId;
    if (!tgId) return res.status(400).send('Missing tgId');
    try {
        const { getTelegramUserPhotoUrl } = require('./telegramBot');
        const photoUrl = await getTelegramUserPhotoUrl(tgId);
        if (photoUrl) {
            return res.redirect(photoUrl);
        }
        return res.status(404).send('No avatar');
    } catch (err) {
        return res.status(500).send(err.message);
    }
});

// Detailed Player Profile endpoint
app.get('/api/player-profile/:id', (req, res) => {
    const rawId = String(req.params.id || '').trim();
    if (!rawId) return res.status(400).json({ ok: false, error: 'missing_id' });

    const users = loadUsers();
    let user = users.find(u => u.id === rawId || u.phone === rawId || String(u.tgId) === rawId);

    if (!user) {
        const leaderboard = loadLeaderboard();
        const entry = leaderboard.find(e => e.phone === rawId || e.name === rawId);
        if (entry) {
            const games = Math.max(0, Number(entry.games) || 0);
            const wins = Math.max(0, Number(entry.wins) || 0);
            const forfeits = Math.max(0, Number(entry.forfeits) || 0);
            const losses = entry.losses !== undefined ? Math.max(0, Number(entry.losses) || 0) : Math.max(0, games - wins);
            user = {
                id: entry.phone || entry.name,
                name: entry.name,
                flag: entry.flag || '🇺🇿',
                phone: entry.phone || '',
                photoUrl: entry.photoUrl || '',
                score: entry.score || 0,
                wins: wins,
                losses: losses,
                forfeits: forfeits,
                games: games,
                campaignLevel: entry.campaignLevel || 1,
                friends: []
            };
        }
    }

    if (!user) {
        return res.status(404).json({ ok: false, error: 'player_not_found' });
    }

    res.json({ ok: true, player: toPublicUser(user) });
});

// ========================================================
// DUEL INVITATIONS (DUELGA TAKLIFLAR) API
// ========================================================
app.get('/api/duel-invites', (req, res) => {
    const playerId = String(req.query.playerId || '').trim();
    if (!playerId) return res.json({ ok: true, incoming: [], outgoing: [], pendingCount: 0 });

    const allInvites = loadDuelInvites();
    const incoming = allInvites.filter(inv =>
        (inv.toPlayerId === playerId || inv.toPhone === playerId || (inv.toTgId && inv.toTgId === playerId)) &&
        inv.status !== 'cancelled'
    );
    const outgoing = allInvites.filter(inv =>
        inv.fromPlayerId === playerId || inv.fromPhone === playerId || (inv.fromTgId && inv.fromTgId === playerId)
    );

    const pendingCount = incoming.filter(inv => inv.status === 'pending').length;
    res.json({ ok: true, incoming, outgoing, pendingCount });
});

app.post('/api/duel-invites/send', async (req, res) => {
    const { fromPlayerId, fromName, fromFlag, fromPhoto, fromTgId, fromPhone,
            toPlayerId, toName, toFlag, toPhoto, toTgId, toPhone,
            options } = req.body || {};

    if (!fromPlayerId || !toPlayerId) {
        return res.status(400).json({ ok: false, error: 'missing_players' });
    }

    const allInvites = loadDuelInvites();
    const inviteId = 'inv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

    // Look up target recipient in users.json to ensure toTgId is known
    const users = loadUsers();
    const targetUser = users.find(u => u.id === toPlayerId || u.phone === toPlayerId || String(u.tgId) === toPlayerId);
    const resolvedToTgId = toTgId || (targetUser ? targetUser.tgId : '');
    const resolvedToPhoto = toPhoto || (targetUser ? targetUser.photoUrl : '');

    const newInvite = {
        id: inviteId,
        fromPlayerId: String(fromPlayerId),
        fromName: String(fromName || 'Jangchi'),
        fromFlag: String(fromFlag || '🇺🇿'),
        fromPhoto: String(fromPhoto || ''),
        fromTgId: fromTgId ? String(fromTgId) : '',
        fromPhone: fromPhone ? String(fromPhone) : '',
        toPlayerId: String(toPlayerId),
        toName: String(toName || (targetUser ? targetUser.name : 'Raqib')),
        toFlag: String(toFlag || '🏳️'),
        toPhoto: String(resolvedToPhoto || ''),
        toTgId: resolvedToTgId ? String(resolvedToTgId) : '',
        toPhone: toPhone ? String(toPhone) : (targetUser ? targetUser.phone : ''),
        status: 'pending',
        scheduledTime: null,
        scheduledTimeStr: '',
        options: options || {},
        createdAt: Date.now(),
        reminderSent: false,
        roomName: `room_duel_${inviteId}`,
        joinedPlayers: [],
        firstJoinTime: null,
        firstPlayerId: null,
        winner: null,
        forfeitedPlayer: null
    };

    allInvites.push(newInvite);
    saveDuelInvites(allInvites);

    const pendingCount = allInvites.filter(inv =>
        (inv.toPlayerId === newInvite.toPlayerId || inv.toPhone === newInvite.toPlayerId) &&
        inv.status === 'pending'
    ).length;

    // Real-time notification if recipient socket is online
    const targetSocket = onlineByPlayerId.get(newInvite.toPlayerId) ||
                         (newInvite.toPhone && onlineByPlayerId.get(newInvite.toPhone));
    if (targetSocket) {
        targetSocket.emit('newDuelInvite', { invite: newInvite, pendingCount });
        targetSocket.emit('duelInvitesCount', { count: pendingCount });
    }

    // Telegram Bot notification if recipient has Telegram ID
    if (newInvite.toTgId) {
        try {
            const { sendTelegramDuelAlert, GAME_URL } = require('./telegramBot');
            const playUrl = `${GAME_URL}?view=invites&invite_id=${newInvite.id}`;
            await sendTelegramDuelAlert(
                newInvite.toTgId,
                `⚔️ *Sizga yangi Kamonboz duel taklifi keldi!*\n\n*${newInvite.fromName}* sizni jangga chorlamoqda!\nTaklifni qabul qilish va vaqtini belgilash uchun quyidagi tugmani bosing:`,
                playUrl,
                "⚔️ Taklifni ko'rish (Play)"
            );
        } catch (e) {
            console.error('Telegram alert error on invite send:', e.message);
        }
    }

    res.json({ ok: true, invite: newInvite, pendingCount });
});

app.post('/api/duel-invites/respond', async (req, res) => {
    const { inviteId, accept, scheduledTime, scheduledTimeStr } = req.body || {};
    if (!inviteId) return res.status(400).json({ ok: false, error: 'missing_invite_id' });

    const allInvites = loadDuelInvites();
    const idx = allInvites.findIndex(inv => inv.id === inviteId);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'invite_not_found' });

    const invite = allInvites[idx];
    if (accept) {
        invite.status = 'accepted';
        invite.scheduledTime = Number(scheduledTime) || Date.now();
        invite.scheduledTimeStr = String(scheduledTimeStr || 'Hozir');

        saveDuelInvites(allInvites);

        // Telegram Bot alert to challenger (fromTgId)
        if (invite.fromTgId) {
            try {
                const { sendTelegramDuelAlert, GAME_URL } = require('./telegramBot');
                const playUrl = `${GAME_URL}?duel_room=${invite.roomName}&invite_id=${invite.id}`;
                await sendTelegramDuelAlert(
                    invite.fromTgId,
                    `⚔️ *Kamonboz: Duel taklifingiz qabul qilindi!*\n\n*${invite.toName}* siz bilan jangga rozi bo'ldi!\n⏰ *Jang vaqti:* soat ${invite.scheduledTimeStr}\n\nBelgilangan vaqtda botdan eslatma boradi. O'z vaqtida kiring, kechikkan o'yinchi mag'lub deb hisoblanadi!`,
                    playUrl,
                    "⚔️ Jangga kirish (Play)"
                );
            } catch (e) {
                console.error('Telegram alert error on accept:', e.message);
            }
        }

        // Telegram Bot confirmation to accepter (toTgId)
        if (invite.toTgId) {
            try {
                const { sendTelegramDuelAlert, GAME_URL } = require('./telegramBot');
                const playUrl = `${GAME_URL}?duel_room=${invite.roomName}&invite_id=${invite.id}`;
                await sendTelegramDuelAlert(
                    invite.toTgId,
                    `⚔️ *Duel rejalashtirildi!*\n\n*${invite.fromName}* bilan jang vaqti belgilandi:\n⏰ *Vaqti:* soat ${invite.scheduledTimeStr}\nBelgilangan vaqtda eslatma yuboramiz!`,
                    playUrl,
                    "⚔️ Jangga kirish (Play)"
                );
            } catch (_) {}
        }

        // Socket notifications
        const fromSocket = onlineByPlayerId.get(invite.fromPlayerId) || (invite.fromPhone && onlineByPlayerId.get(invite.fromPhone));
        if (fromSocket) {
            fromSocket.emit('duelInviteAccepted', { invite });
        }
        const toSocket = onlineByPlayerId.get(invite.toPlayerId) || (invite.toPhone && onlineByPlayerId.get(invite.toPhone));
        if (toSocket) {
            toSocket.emit('duelInviteAccepted', { invite });
        }
    } else {
        invite.status = 'declined';
        saveDuelInvites(allInvites);

        if (invite.fromTgId) {
            try {
                const { sendTelegramDuelAlert, GAME_URL } = require('./telegramBot');
                await sendTelegramDuelAlert(
                    invite.fromTgId,
                    `❌ *${invite.toName}* sizning duel taklifingizni rad etdi.`,
                    GAME_URL,
                    "🏹 Bosh menyu"
                );
            } catch (_) {}
        }

        const fromSocket = onlineByPlayerId.get(invite.fromPlayerId) || (invite.fromPhone && onlineByPlayerId.get(invite.fromPhone));
        if (fromSocket) {
            fromSocket.emit('duelInviteDeclined', { invite });
        }
    }

    res.json({ ok: true, invite });
});

app.post('/api/duel-invites/cancel', (req, res) => {
    const { inviteId } = req.body || {};
    if (!inviteId) return res.status(400).json({ ok: false, error: 'missing_invite_id' });
    const allInvites = loadDuelInvites();
    const idx = allInvites.findIndex(inv => inv.id === inviteId);
    if (idx !== -1) {
        allInvites[idx].status = 'cancelled';
        saveDuelInvites(allInvites);
    }
    res.json({ ok: true });
});

// Scheduled Duels & 2-Minute Forfeit Monitor
function startScheduledDuelsMonitor() {
    setInterval(async () => {
        try {
            const allInvites = loadDuelInvites();
            let changed = false;
            const now = Date.now();

            for (const inv of allInvites) {
                if (inv.status !== 'accepted') continue;

                // 1. Send scheduled duel reminder when time has arrived
                if (!inv.reminderSent && inv.scheduledTime && now >= (inv.scheduledTime - 45000)) {
                    inv.reminderSent = true;
                    changed = true;

                    const { sendTelegramDuelAlert, GAME_URL } = require('./telegramBot');
                    const playUrl = `${GAME_URL}?duel_room=${inv.roomName}&invite_id=${inv.id}`;

                    if (inv.fromTgId) {
                        sendTelegramDuelAlert(
                            inv.fromTgId,
                            `🔔 *DUEL VAQTI KELDI!*\n\n⚔️ *${inv.fromName}* vs *${inv.toName}*\nJang maydoni tayyor! 2 daqiqa ichida jangga kiring:\nKechikkan o'yinchi mag'lub deb hisoblanadi!`,
                            playUrl,
                            "⚔️ Jangga kirish (Play)"
                        ).catch(() => {});
                    }

                    if (inv.toTgId) {
                        sendTelegramDuelAlert(
                            inv.toTgId,
                            `🔔 *DUEL VAQTI KELDI!*\n\n⚔️ *${inv.fromName}* vs *${inv.toName}*\nJang maydoni tayyor! 2 daqiqa ichida jangga kiring:\nKechikkan o'yinchi mag'lub deb hisoblanadi!`,
                            playUrl,
                            "⚔️ Jangga kirish (Play)"
                        ).catch(() => {});
                    }

                    const s1 = onlineByPlayerId.get(inv.fromPlayerId) || (inv.fromPhone && onlineByPlayerId.get(inv.fromPhone));
                    if (s1) s1.emit('duelTimeArrived', { invite: inv });
                    const s2 = onlineByPlayerId.get(inv.toPlayerId) || (inv.toPhone && onlineByPlayerId.get(inv.toPhone));
                    if (s2) s2.emit('duelTimeArrived', { invite: inv });
                }

                // 2. 2-Minute Forfeit Check:
                if (inv.firstJoinTime && inv.status === 'accepted') {
                    const elapsed = now - inv.firstJoinTime;
                    const joinedCount = Array.isArray(inv.joinedPlayers) ? inv.joinedPlayers.length : 0;

                    if (joinedCount === 1 && elapsed >= 120000) {
                        inv.status = 'forfeited';
                        const winnerId = inv.firstPlayerId;
                        const loserId = (inv.fromPlayerId === winnerId || inv.fromPhone === winnerId)
                            ? (inv.toPlayerId || inv.toPhone)
                            : (inv.fromPlayerId || inv.fromPhone);

                        inv.winner = winnerId;
                        inv.forfeitedPlayer = loserId;
                        changed = true;

                        console.log(`[Duel Forfeit] Raqib 2 daqiqada kirmadi! G'olib: ${winnerId}, Dueldan qochgan: ${loserId}`);

                        const users = loadUsers();
                        const loserIdx = users.findIndex(u => u.id === loserId || u.phone === loserId || String(u.tgId) === loserId);
                        if (loserIdx !== -1) {
                            users[loserIdx].forfeits = (Number(users[loserIdx].forfeits) || 0) + 1;
                            users[loserIdx].losses = (Number(users[loserIdx].losses) || 0) + 1;
                            users[loserIdx].games = (Number(users[loserIdx].games) || 0) + 1;
                            users[loserIdx].score = Math.max(0, (Number(users[loserIdx].score) || 0) - 30);
                            saveUsers(users);
                        }

                        const winnerIdx = users.findIndex(u => u.id === winnerId || u.phone === winnerId || String(u.tgId) === winnerId);
                        if (winnerIdx !== -1) {
                            users[winnerIdx].wins = (Number(users[winnerIdx].wins) || 0) + 1;
                            users[winnerIdx].games = (Number(users[winnerIdx].games) || 0) + 1;
                            users[winnerIdx].score = (Number(users[winnerIdx].score) || 0) + 50;
                            saveUsers(users);
                        }

                        const winnerSocket = onlineByPlayerId.get(winnerId);
                        if (winnerSocket) {
                            winnerSocket.emit('duelOpponentForfeited', {
                                winner: true,
                                scoreGained: 50,
                                message: "Raqib duelga 2 daqiqa ichida kelmadi va jangdan qochdi! Sizga texnik g'alaba va +50 ball berildi!"
                            });
                        }

                        const { sendTelegramDuelAlert, GAME_URL } = require('./telegramBot');
                        const loserTgId = (loserId === inv.fromPlayerId || loserId === inv.fromPhone) ? inv.fromTgId : inv.toTgId;
                        const winnerTgId = (winnerId === inv.fromPlayerId || winnerId === inv.fromPhone) ? inv.fromTgId : inv.toTgId;

                        if (loserTgId) {
                            sendTelegramDuelAlert(
                                loserTgId,
                                `❌ *Siz duelga o'z vaqtida (2 daqiqa ichida) kirmadingiz!*\nDueldan qochgan deb hisoblanib, -30 ball jarima berildi.`,
                                GAME_URL,
                                "🏹 Bosh menyu"
                            ).catch(() => {});
                        }
                        if (winnerTgId) {
                            sendTelegramDuelAlert(
                                winnerTgId,
                                `🏆 *Raqibingiz jangga kelmadi!*\nSizga texnik g'alaba berildi va +50 ball mukofot taqdim etildi!`,
                                GAME_URL,
                                "🏹 Bosh menyu"
                            ).catch(() => {});
                        }
                    }
                }
            }

            if (changed) {
                saveDuelInvites(allInvites);
            }
        } catch (e) {
            console.error('Scheduled duels monitor error:', e.message);
        }
    }, 10000);
}

const waitingQueue = [];
const rooms = {};
const roomsByCode = {};
const onlineByPlayerId = new Map();
const pendingFriendInvites = new Map();
const pendingFriendAddRequests = new Map();

const TURN_TIMEOUT_SECONDS = 30;

function clearRoomTurnTimer(roomName) {
    const room = rooms[roomName];
    if (room && room.turnTimer) {
        clearTimeout(room.turnTimer);
        room.turnTimer = null;
    }
}

function clearCoinTossTimer(roomName) {
    const room = rooms[roomName];
    if (room && room.coinToss && room.coinToss.timer) {
        clearTimeout(room.coinToss.timer);
        room.coinToss.timer = null;
    }
}

function executeCoinToss(roomName) {
    const room = rooms[roomName];
    if (!room || !room.coinToss || !room.coinToss.active || room.coinToss.flipping) return;
    room.coinToss.flipping = true;
    clearCoinTossTimer(roomName);

    // Agar hech kim tanlamagan bo'lsa (masalan vaqt tugaganda)
    if (room.coinToss.choices[0] === null && room.coinToss.choices[1] === null) {
        const randChoice = Math.random() < 0.5 ? 'rasm' : 'raqam';
        room.coinToss.choices[0] = randChoice;
        room.coinToss.choices[1] = randChoice === 'rasm' ? 'raqam' : 'rasm';
        room.coinToss.firstChooser = 0;
    } else if (room.coinToss.choices[0] === null) {
        room.coinToss.choices[0] = room.coinToss.choices[1] === 'rasm' ? 'raqam' : 'rasm';
    } else if (room.coinToss.choices[1] === null) {
        room.coinToss.choices[1] = room.coinToss.choices[0] === 'rasm' ? 'raqam' : 'rasm';
    }

    // Tanga tashlash natijasi: 50% rasm, 50% raqam
    const result = Math.random() < 0.5 ? 'rasm' : 'raqam';
    room.coinToss.result = result;

    // G'olib o'yinchi indexini aniqlash:
    const winnerIndex = (room.coinToss.choices[0] === result) ? 0 : 1;
    room.coinToss.winnerIndex = winnerIndex;
    room.turnIndex = winnerIndex; // G'olib o'yinchi birinchi o'q uzadi

    console.log(`[Coin Toss] Room ${roomName}: choices=${JSON.stringify(room.coinToss.choices)}, result=${result}, winner=${winnerIndex}`);

    io.to(roomName).emit('coinFlipStart', {
        choices: room.coinToss.choices,
        firstChooser: room.coinToss.firstChooser,
        result: result,
        winnerIndex: winnerIndex
    });

    // Animatsiya tugagach (3.8 soniya), rasmiy ravishda o'yinni boshlash
    setTimeout(() => {
        if (!room || room.gameOver) return;
        room.coinToss.active = false;
        io.to(roomName).emit('coinFlipComplete', {
            winnerIndex: room.turnIndex,
            turnIndex: room.turnIndex,
            wind: room.wind
        });
        startRoomTurnTimer(roomName);
    }, 3800);
}

function startRoomTurnTimer(roomName) {
    const room = rooms[roomName];
    if (!room || room.gameOver) return;
    clearRoomTurnTimer(roomName);

    io.to(roomName).emit('turnTimerStart', {
        duration: TURN_TIMEOUT_SECONDS,
        turnIndex: room.turnIndex
    });

    room.turnTimer = setTimeout(() => {
        handleRoomTurnTimeout(roomName);
    }, TURN_TIMEOUT_SECONDS * 1000);
}

function recordGameResult(winnerSocket, loserSocket, reason) {
    if (!winnerSocket && !loserSocket) return;
    const winnerPhone = winnerSocket?.profile?.phone || winnerSocket?.profile?.playerId;
    const loserPhone = loserSocket?.profile?.phone || loserSocket?.profile?.playerId;
    const users = loadUsers();
    let changed = false;

    if (winnerPhone) {
        const wIdx = findUserIndexByPhone(users, winnerPhone);
        if (wIdx !== -1) {
            users[wIdx].wins = (Number(users[wIdx].wins) || 0) + 1;
            users[wIdx].games = (Number(users[wIdx].games) || 0) + 1;
            users[wIdx].score = (Number(users[wIdx].score) || 0) + 40;
            changed = true;
        }
    }

    if (loserPhone) {
        const lIdx = findUserIndexByPhone(users, loserPhone);
        if (lIdx !== -1) {
            users[lIdx].losses = (Number(users[lIdx].losses) || 0) + 1;
            users[lIdx].games = (Number(users[lIdx].games) || 0) + 1;
            if (reason === 'timeout_forfeit' || reason === 'opponent_left') {
                users[lIdx].forfeits = (Number(users[lIdx].forfeits) || 0) + 1;
                users[lIdx].score = Math.max(0, (Number(users[lIdx].score) || 0) - 25);
            } else {
                users[lIdx].score = Math.max(0, (Number(users[lIdx].score) || 0) - 15);
            }
            changed = true;
        }
    }

    if (changed) saveUsers(users);
}

function handleRoomTurnTimeout(roomName) {
    const room = rooms[roomName];
    if (!room || room.gameOver) return;

    if (room.inFlight) {
        const flightDuration = Date.now() - (room.flightStartTime || 0);
        if (flightDuration < 8000) {
            // Hali nayza parvozda, kuta turamiz
            room.turnTimer = setTimeout(() => handleRoomTurnTimeout(roomName), 2500);
            return;
        }
        room.inFlight = false;
    }

    // 30 soniyada o'q uzilmasa o'yinchi yutqazadi va raqib chekingan deb topiladi
    room.gameOver = true;
    clearRoomTurnTimer(roomName);
    const timedOutIndex = room.turnIndex;
    const winnerIndex = timedOutIndex === 0 ? 1 : 0;
    const winnerId = room.players ? room.players[winnerIndex] : null;
    const timedOutId = room.players ? room.players[timedOutIndex] : null;
    console.log(`[Turn Timeout] Room ${roomName}: Player ${timedOutIndex} timed out after 30s. Winner: Player ${winnerIndex}`);

    const winnerSocket = io.sockets.sockets.get(winnerId);
    const loserSocket = io.sockets.sockets.get(timedOutId);
    recordGameResult(winnerSocket, loserSocket, 'timeout_forfeit');

    io.to(roomName).emit('gameOver', {
        winnerIndex,
        winnerId,
        reason: 'timeout_forfeit',
        timedOutIndex
    });
}

function removeFromWaitingQueue(socketId) {
    const idx = waitingQueue.findIndex((s) => s && s.id === socketId);
    if (idx !== -1) waitingQueue.splice(idx, 1);
}

function generateWind() {
    const strength = (Math.random() * 20 - 10).toFixed(2);
    return parseFloat(strength);
}

function getRandomMap() {
    const maps = [
        'field', 'castle', 'desert', 'winter', 'mountain',
        'samarkand', 'bukhara', 'istanbul', 'oasis', 'canyon', 'volcano',
        'registan', 'sakura', 'taiga', 'citadel'
    ];
    return maps[Math.floor(Math.random() * maps.length)];
}

function getRandomWeather() {
    const weathers = ['sunny', 'night', 'rain', 'storm', 'snow'];
    return weathers[Math.floor(Math.random() * weathers.length)];
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    function startGame(player1, player2, roomName) {
        console.log('startGame called, roomName:', roomName);
        const existingOptions = rooms[roomName] && rooms[roomName].options ? rooms[roomName].options : { map: getRandomMap(), weather: getRandomWeather(), birds: true, birdCount: 20, animals: false };

        // O'yinchilarning o'ng va chap tomonga joylashishi har o'yinda 50/50 tasodifiy bo'ladi
        const swapSides = Math.random() < 0.5;
        const leftPlayer = swapSides ? player2 : player1;
        const rightPlayer = swapSides ? player1 : player2;

        rooms[roomName] = {
            players: [leftPlayer.id, rightPlayer.id],
            turnIndex: -1, // Qur'a tashlanmaguncha kutiladi
            wind: generateWind(),
            gameOver: false,
            health: [100, 100],
            shield: [5, 5],
            super: [
                Math.max(0, Number(leftPlayer.profile?.superPowers ?? 5)),
                Math.max(0, Number(rightPlayer.profile?.superPowers ?? 5))
            ],
            walls: [
                { active: false, x: 0, hp: 0 },
                { active: false, x: 0, hp: 0 }
            ],
            defending: [false, false],
            ducking: [false, false],
            jumping: [false, false],
            inFlight: false,
            options: existingOptions,
            coinToss: {
                active: true,
                choices: [null, null],
                firstChooser: null,
                flipping: false,
                result: null,
                winnerIndex: null,
                timer: null
            }
        };

        leftPlayer.roomId = roomName;
        rightPlayer.roomId = roomName;

        const gameStartDataLeft = {
            playerIndex: 0,
            turnIndex: -1,
            hasCoinToss: true,
            wind: rooms[roomName].wind,
            opponentId: rightPlayer.id,
            opponentProfile: rightPlayer.profile,
            health: rooms[roomName].health,
            shield: rooms[roomName].shield,
            super: rooms[roomName].super,
            walls: rooms[roomName].walls,
            options: rooms[roomName].options,
            roomName: roomName
        };
        console.log('Sending gameStart to leftPlayer (index 0), roomName:', roomName);
        leftPlayer.emit('gameStart', gameStartDataLeft);

        const gameStartDataRight = {
            playerIndex: 1,
            turnIndex: -1,
            hasCoinToss: true,
            wind: rooms[roomName].wind,
            opponentId: leftPlayer.id,
            opponentProfile: leftPlayer.profile,
            health: rooms[roomName].health,
            shield: rooms[roomName].shield,
            super: rooms[roomName].super,
            walls: rooms[roomName].walls,
            options: rooms[roomName].options,
            roomName: roomName
        };
        console.log('Sending gameStart to rightPlayer (index 1), roomName:', roomName);
        rightPlayer.emit('gameStart', gameStartDataRight);

        // Turn timer qur'a natijasidan so'ng startRoomTurnTimer orqali ishga tushadi.
        // Agar o'yinchilar 7.5 soniya davomida tanlamasa, avtomatik qur'a tashlanadi:
        rooms[roomName].coinToss.timer = setTimeout(() => {
            executeCoinToss(roomName);
        }, 7500);
    }

    socket.on('coinChoice', (data) => {
        const roomName = socket.roomId;
        const room = rooms[roomName];
        if (!room || !room.coinToss || !room.coinToss.active || room.coinToss.flipping) return;

        const playerIndex = room.players.indexOf(socket.id);
        if (playerIndex === -1) return;

        const choice = (data && data.choice === 'raqam') ? 'raqam' : 'rasm';
        const otherIndex = playerIndex === 0 ? 1 : 0;
        const otherChoice = (choice === 'rasm') ? 'raqam' : 'rasm';

        // Agar hali hech kim tanlamagan bo'lsa:
        if (room.coinToss.choices[0] === null && room.coinToss.choices[1] === null) {
            room.coinToss.choices[playerIndex] = choice;
            room.coinToss.choices[otherIndex] = otherChoice;
            room.coinToss.firstChooser = playerIndex;
            executeCoinToss(roomName);
        } else if (room.coinToss.choices[playerIndex] === null) {
            // Birinchi o'yinchi avvalroq tanlagan bo'lsa, qolgan tomon unga biriktiriladi
            executeCoinToss(roomName);
        }
    });

    function bindOnlineProfile(profile) {
        if (!profile || !profile.playerId) return;
        socket.profile = { ...(socket.profile || {}), ...profile };
        onlineByPlayerId.set(profile.playerId, socket);
    }

    socket.on('registerProfile', (profile) => {
        if (!profile || !profile.playerId) return;
        bindOnlineProfile(profile);
    });

    socket.on('updateProfile', (profile) => {
        if (!profile || !profile.playerId) return;
        bindOnlineProfile(profile);
    });

    function generateCode() {
        return Math.floor(1000 + Math.random() * 9000).toString();
    }

    socket.on('createGame', (data) => {
        socket.profile = data.profile || { name: "O'yinchi", flag: "🏳️", avatar: "👤", charType: 0 };
        bindOnlineProfile(socket.profile);
        const code = generateCode();
        const roomName = `room_code_${code}`;
        socket.join(roomName);
        socket.roomId = roomName;
        roomsByCode[code] = {
            player1: socket,
            roomName: roomName,
            options: data.options || { map: getRandomMap(), weather: getRandomWeather(), birds: true, birdCount: 20, animals: false }
        };
        socket.emit('gameCreated', code);
    });

    socket.on('joinGame', (data) => {
        const { profile, code } = data || {};
        const cleanCode = String(code || '').replace(/^(room_|duel_)/i, '').trim().toUpperCase();
        socket.profile = profile || { name: "O'yinchi", flag: "🏳️", avatar: "👤" };
        bindOnlineProfile(socket.profile);

        const targetCode = roomsByCode[cleanCode] ? cleanCode : (roomsByCode[code] ? code : null);

        if (targetCode && roomsByCode[targetCode]) {
            const roomData = roomsByCode[targetCode];
            const player1 = roomData.player1;
            const player2 = socket;
            const roomName = roomData.roomName;

            // pre-fill room with options so startGame can read it
            rooms[roomName] = { options: roomData.options };

            delete roomsByCode[targetCode];
            player2.join(roomName);
            startGame(player1, player2, roomName);
        } else {
            socket.emit('joinError', { code: cleanCode || code });
        }
    });

    socket.on('findGame', (payload) => {
        const profile = payload && payload.profile ? payload.profile : payload;
        const options = payload && payload.options ? payload.options : null;
        socket.profile = profile || { name: "Raqib", flag: "🏳️", avatar: "👤" };
        bindOnlineProfile(socket.profile);
        socket.pendingOptions = options || { map: getRandomMap(), weather: getRandomWeather(), birds: true, birdCount: 20, animals: false };
        removeFromWaitingQueue(socket.id);

        if (waitingQueue.length > 0) {
            const pickIndex = Math.floor(Math.random() * waitingQueue.length);
            const player1 = waitingQueue.splice(pickIndex, 1)[0];
            if (!player1 || player1.id === socket.id) {
                waitingQueue.push(socket);
                socket.emit('waiting');
                return;
            }
            const roomName = `room_${player1.id}_${socket.id}`;
            const player2 = socket;
            player1.join(roomName);
            player2.join(roomName);
            const mergedOptions = player1.pendingOptions || socket.pendingOptions || { map: getRandomMap(), weather: getRandomWeather(), birds: true, birdCount: 20, animals: false };
            rooms[roomName] = { options: mergedOptions };
            startGame(player1, player2, roomName);
            return;
        }

        waitingQueue.push(socket);
        socket.emit('waiting');
    });

    socket.on('friendsPresence', (payload) => {
        const ids = Array.isArray(payload?.ids) ? payload.ids : [];
        const statuses = {};
        ids.forEach((id) => { statuses[id] = onlineByPlayerId.has(id); });
        socket.emit('friendsPresence', { statuses });
    });

    socket.on('lookupFriendById', (payload) => {
        if (payload?.profile?.playerId) {
            bindOnlineProfile(payload.profile);
        }
        const friendId = String(payload?.friendId || '').replace(/\D/g, '').slice(0, 5);
        const myPlayerId = String(socket.profile?.playerId || '');
        if (!myPlayerId) {
            socket.emit('friendLookupResult', { ok: false, reason: 'invalid' });
            return;
        }
        if (friendId.length !== 5) {
            socket.emit('friendLookupResult', { ok: false, reason: 'invalid' });
            return;
        }
        if (friendId === myPlayerId) {
            socket.emit('friendLookupResult', { ok: false, reason: 'self' });
            return;
        }
        const target = onlineByPlayerId.get(friendId);
        if (!target || !target.profile) {
            socket.emit('friendLookupResult', { ok: false, reason: 'not_found' });
            return;
        }
        pendingFriendAddRequests.set(friendId, {
            fromPlayerId: myPlayerId,
            fromSocketId: socket.id
        });
        target.emit('friendAddRequest', { fromProfile: socket.profile });
        socket.emit('friendLookupResult', {
            ok: true,
            pending: true,
            friend: {
                playerId: friendId,
                name: target.profile.name,
                flag: target.profile.flag,
                online: true
            }
        });
    });

    socket.on('friendAddRequestResponse', (payload) => {
        const fromPlayerId = String(payload?.fromPlayerId || '');
        const accept = !!payload?.accept;
        const toPlayerId = String(socket.profile?.playerId || '');
        if (!fromPlayerId || !toPlayerId) return;

        const pending = pendingFriendAddRequests.get(toPlayerId);
        if (!pending || pending.fromPlayerId !== fromPlayerId) return;
        pendingFriendAddRequests.delete(toPlayerId);

        const inviter = onlineByPlayerId.get(fromPlayerId);
        if (!inviter || !inviter.profile) return;

        if (!accept) {
            inviter.emit('friendLookupResult', { ok: false, reason: 'declined' });
            return;
        }

        inviter.emit('friendAdded', {
            byRequest: true,
            friend: {
                playerId: toPlayerId,
                name: socket.profile?.name || "Do'st",
                flag: socket.profile?.flag || '🏳️',
                online: true
            }
        });
        socket.emit('friendAdded', {
            byRequest: true,
            friend: {
                playerId: fromPlayerId,
                name: inviter.profile?.name || "Do'st",
                flag: inviter.profile?.flag || '🏳️',
                online: true
            }
        });

        // Do'stlikni users.json ga doimiy saqlash
        try {
            const users = loadUsers();
            const u1 = users.find(u => u.id === toPlayerId || u.phone === toPlayerId);
            const u2 = users.find(u => u.id === fromPlayerId || u.phone === fromPlayerId);
            let updated = false;
            if (u1) {
                if (!Array.isArray(u1.friends)) u1.friends = [];
                if (!u1.friends.includes(fromPlayerId)) { u1.friends.push(fromPlayerId); updated = true; }
            }
            if (u2) {
                if (!Array.isArray(u2.friends)) u2.friends = [];
                if (!u2.friends.includes(toPlayerId)) { u2.friends.push(toPlayerId); updated = true; }
            }
            if (updated) saveUsers(users);
        } catch (_) {}
    });

    socket.on('inviteFriend', (payload) => {
        const toPlayerId = payload?.toPlayerId;
        if (!toPlayerId || !socket.profile?.playerId) return;
        const target = onlineByPlayerId.get(toPlayerId);
        if (!target) {
            socket.emit('friendInviteResult', { ok: false, reason: 'offline' });
            return;
        }
        pendingFriendInvites.set(toPlayerId, {
            fromPlayerId: socket.profile.playerId,
            fromSocketId: socket.id,
            options: payload?.options || { map: getRandomMap(), weather: getRandomWeather(), birds: true, birdCount: 20, animals: false }
        });
        target.emit('friendInvite', {
            fromProfile: socket.profile,
            options: payload?.options || {}
        });
        socket.emit('friendInviteResult', { ok: true });
    });

    socket.on('friendInviteResponse', (payload) => {
        const fromPlayerId = payload?.fromPlayerId;
        const accept = !!payload?.accept;
        if (!socket.profile?.playerId || !fromPlayerId) return;
        const pending = pendingFriendInvites.get(socket.profile.playerId);
        if (!pending || pending.fromPlayerId !== fromPlayerId) return;
        pendingFriendInvites.delete(socket.profile.playerId);
        const inviter = onlineByPlayerId.get(fromPlayerId);
        if (!inviter) return;
        if (!accept) {
            inviter.emit('friendInviteResult', { ok: false, reason: 'declined' });
            return;
        }
        const roomName = `room_friend_${inviter.id}_${socket.id}`;
        inviter.join(roomName);
        socket.join(roomName);
        rooms[roomName] = { options: pending.options || { map: getRandomMap(), weather: getRandomWeather(), birds: true, birdCount: 20, animals: false } };
        startGame(inviter, socket, roomName);
    });

    // Duel takliflarini socket orqali olish va yuborish
    socket.on('getDuelInvites', () => {
        const myId = String(socket.profile?.playerId || socket.profile?.phone || '');
        if (!myId) return;
        const allInvites = loadDuelInvites();
        const incoming = allInvites.filter(inv =>
            (inv.toPlayerId === myId || inv.toPhone === myId || (inv.toTgId && inv.toTgId === myId)) &&
            inv.status !== 'cancelled'
        );
        const outgoing = allInvites.filter(inv =>
            inv.fromPlayerId === myId || inv.fromPhone === myId || (inv.fromTgId && inv.fromTgId === myId)
        );
        const pendingCount = incoming.filter(inv => inv.status === 'pending').length;
        socket.emit('duelInvitesData', { incoming, outgoing, pendingCount });
    });

    socket.on('joinDuelRoom', (payload) => {
        const inviteId = payload?.inviteId;
        const roomName = payload?.roomName;
        const myId = String(socket.profile?.playerId || socket.profile?.phone || socket.id);

        if (!inviteId && !roomName) return;

        const allInvites = loadDuelInvites();
        const inv = allInvites.find(i => i.id === inviteId || i.roomName === roomName);
        if (!inv) {
            socket.emit('duelRoomError', { message: "Duel xonasi topilmadi yoki bekor qilingan!" });
            return;
        }

        if (inv.status === 'forfeited' || inv.status === 'completed' || inv.status === 'cancelled') {
            socket.emit('duelRoomError', { message: `Ushbu duel allaqachon tugagan (${inv.status})!` });
            return;
        }

        socket.join(inv.roomName);
        socket.roomId = inv.roomName;
        if (!Array.isArray(inv.joinedPlayers)) inv.joinedPlayers = [];
        if (!inv.joinedPlayers.includes(myId)) {
            inv.joinedPlayers.push(myId);
        }

        // Birinchi bo'lib kirgan o'yinchi - 120 soniyalik (2 daqiqa) kutish taymerini yoqadi
        if (!inv.firstJoinTime) {
            inv.firstJoinTime = Date.now();
            inv.firstPlayerId = myId;
            saveDuelInvites(allInvites);

            socket.emit('duelWaitingOpponent', {
                remainingSeconds: 120,
                opponentName: (myId === inv.fromPlayerId || myId === inv.fromPhone) ? inv.toName : inv.fromName,
                roomName: inv.roomName
            });

            // Raqibga kirish haqida signal yuborish
            const otherPlayerId = (myId === inv.fromPlayerId || myId === inv.fromPhone) ? (inv.toPlayerId || inv.toPhone) : (inv.fromPlayerId || inv.fromPhone);
            const otherTgId = (myId === inv.fromPlayerId || myId === inv.fromPhone) ? inv.toTgId : inv.fromTgId;
            const otherSocket = onlineByPlayerId.get(otherPlayerId);
            if (otherSocket) {
                otherSocket.emit('duelOpponentJoinedRoom', {
                    inviteId: inv.id,
                    roomName: inv.roomName,
                    opponentName: socket.profile?.name || "Raqib"
                });
            }
            if (otherTgId) {
                try {
                    const { sendTelegramDuelAlert, GAME_URL } = require('./telegramBot');
                    sendTelegramDuelAlert(
                        otherTgId,
                        `⚡ *Raqibingiz duel maydoniga kirdi!*\n*${socket.profile?.name || 'Raqib'}* sizni kutmoqda! 2 daqiqa ichida kiring, aks holda mag'lub deb hisoblanasiz:`,
                        `${GAME_URL}?duel_room=${inv.roomName}&invite_id=${inv.id}`,
                        "⚔️ Jangga kirish (Play)"
                    ).catch(() => {});
                } catch (_) {}
            }
        } else if (inv.joinedPlayers.length >= 2) {
            // Ikkala o'yinchi ham kirdi - 2 daqiqalik forfeyt taymerini to'xtatamiz va jangni boshlaymiz!
            inv.firstJoinTime = null;
            saveDuelInvites(allInvites);

            const roomClients = Array.from(io.sockets.adapter.rooms.get(inv.roomName) || []);
            if (roomClients.length >= 2) {
                const p1Socket = io.sockets.sockets.get(roomClients[0]);
                const p2Socket = io.sockets.sockets.get(roomClients[1]);
                if (p1Socket && p2Socket) {
                    rooms[inv.roomName] = { options: inv.options || { map: getRandomMap(), weather: getRandomWeather(), birds: true, birdCount: 20, animals: false } };
                    startGame(p1Socket, p2Socket, inv.roomName);
                }
            }
        }
    });

    socket.on('cancelFind', () => {
        removeFromWaitingQueue(socket.id);
    });

    socket.on('throwSpear', (data) => {
        const { angle, power, isArtillery, isFire } = data;
        const roomName = socket.roomId;
        const room = rooms[roomName];

        if (!room || room.gameOver) return;

        const currentPlayerId = room.players[room.turnIndex];
        if (socket.id !== currentPlayerId) return;

        clearRoomTurnTimer(roomName);
        if (room.consecutiveTimeouts) room.consecutiveTimeouts[room.turnIndex] = 0;

        io.to(roomName).emit('spearThrown', {
            playerIndex: room.turnIndex,
            angle: angle,
            power: power,
            isArtillery: isArtillery,
            isFire: !!isFire
        });
        room.inFlight = true;
        room.flightStartTime = Date.now();
        room.inFlightIsFire = !!isFire;
        room.inFlightIsArtillery = !!isArtillery;
    });

    socket.on('useSuperPower', (payload) => {
        const roomName = socket.roomId;
        const room = rooms[roomName];
        if (!room || room.gameOver || !room.inFlight) return;
        const playerIndex = room.players.indexOf(socket.id);
        if (playerIndex === -1) return;
        if (playerIndex === room.turnIndex) return; // thrower cannot intercept own projectile
        if ((room.super[playerIndex] || 0) <= 0) return;

        room.super[playerIndex] -= 1;
        const nextTurn = room.turnIndex === 0 ? 1 : 0;
        room.turnIndex = nextTurn;
        room.wind = generateWind();
        room.inFlight = false;

        io.to(roomName).emit('superState', {
            playerIndex,
            remaining: room.super[playerIndex]
        });

        io.to(roomName).emit('superIntercept', {
            byPlayerIndex: playerIndex,
            remaining: room.super[playerIndex],
            hitX: Number(payload?.hitX),
            hitY: Number(payload?.hitY),
            nextTurn: room.turnIndex,
            wind: room.wind
        });
        startRoomTurnTimer(roomName);
    });

    socket.on('defenseState', (data) => {
        const roomName = socket.roomId;
        const room = rooms[roomName];
        if (!room || room.gameOver) return;

        const playerIndex = room.players.indexOf(socket.id);
        if (playerIndex === -1) return;

        room.defending[playerIndex] = !!(data && data.active);
        socket.to(roomName).emit('defenseStateChanged', {
            playerIndex,
            active: room.defending[playerIndex]
        });
    });

    socket.on('duckState', (data) => {
        const roomName = socket.roomId;
        const room = rooms[roomName];
        if (!room || room.gameOver) return;
        const playerIndex = room.players.indexOf(socket.id);
        if (playerIndex === -1) return;
        room.ducking[playerIndex] = !!(data && data.active);
        socket.to(roomName).emit('duckStateChanged', {
            playerIndex,
            active: room.ducking[playerIndex]
        });
    });

    socket.on('jumpState', (data) => {
        const roomName = socket.roomId;
        const room = rooms[roomName];
        if (!room || room.gameOver) return;
        const playerIndex = room.players.indexOf(socket.id);
        if (playerIndex === -1) return;
        if (!room.jumping) room.jumping = [false, false];
        room.jumping[playerIndex] = !!(data && data.active);
        socket.to(roomName).emit('jumpStateChanged', {
            playerIndex,
            active: room.jumping[playerIndex]
        });
    });

    socket.on('wallPlaced', (data) => {
        const roomName = socket.roomId;
        const room = rooms[roomName];
        if (!room || room.gameOver) return;
        const ownerIndex = Number(data?.ownerIndex);
        const x = Number(data?.x || 0);
        const hp = Math.max(1, Math.min(5, Number(data?.hp || 5)));
        const playerIndex = room.players.indexOf(socket.id);
        if (playerIndex === -1 || playerIndex !== ownerIndex) return;
        room.walls[ownerIndex] = { active: true, x, hp };
        io.to(roomName).emit('wallStateChanged', { ownerIndex, active: true, x, hp });
    });

    socket.on('wallMoved', (data) => {
        const roomName = socket.roomId;
        const room = rooms[roomName];
        if (!room || room.gameOver) return;
        const ownerIndex = Number(data?.ownerIndex);
        const x = Number(data?.x || 0);
        const playerIndex = room.players.indexOf(socket.id);
        if (playerIndex === -1 || playerIndex !== ownerIndex) return;
        if (!room.walls[ownerIndex] || !room.walls[ownerIndex].active) return;
        room.walls[ownerIndex].x = x;
        io.to(roomName).emit('wallStateChanged', {
            ownerIndex,
            active: true,
            x,
            hp: room.walls[ownerIndex].hp
        });
    });

    socket.on('wallHit', (data) => {
        const roomName = socket.roomId;
        const room = rooms[roomName];
        if (!room || room.gameOver) return;
        if (socket.id !== room.players[room.turnIndex]) return;
        if (!room.inFlight) return;
        const ownerIndex = Number(data?.ownerIndex);
        if (!Number.isFinite(ownerIndex) || !room.walls[ownerIndex] || !room.walls[ownerIndex].active) return;
        const isFire = !!(data?.isFire || room.inFlightIsFire);
        const isArtillery = !!(data?.isArtillery || room.inFlightIsArtillery);
        if (isArtillery || isFire) {
            room.walls[ownerIndex].hp = 0;
        } else {
            room.walls[ownerIndex].hp = Math.max(0, Number(room.walls[ownerIndex].hp || 5) - 1);
        }
        io.to(roomName).emit('wallHitFx', {
            ownerIndex,
            hitX: Number(data?.hitX || 0),
            hitY: Number(data?.hitY || 0),
            isArtillery,
            isFire
        });
        if (room.walls[ownerIndex].hp <= 0) {
            room.walls[ownerIndex] = { active: false, x: 0, hp: 0 };
            io.to(roomName).emit('wallStateChanged', { ownerIndex, active: false, x: 0, hp: 0 });
        } else {
            io.to(roomName).emit('wallStateChanged', {
                ownerIndex,
                active: true,
                x: room.walls[ownerIndex].x,
                hp: room.walls[ownerIndex].hp
            });
        }
        room.inFlight = false;
        room.turnIndex = room.turnIndex === 0 ? 1 : 0;
        room.wind = generateWind();
        io.to(roomName).emit('nextTurn', {
            turnIndex: room.turnIndex,
            wind: room.wind
        });
        startRoomTurnTimer(roomName);
    });

    socket.on('throwComplete', (data) => {
        const { hitOpponent, hitX, hitY, hitAngle } = data;
        const roomName = socket.roomId;
        const room = rooms[roomName];

        if (!room || room.gameOver) return;
        if (socket.id !== room.players[room.turnIndex]) return;
        if (!room.inFlight) return; // ignore stale/duplicate completion events
        room.inFlight = false;
        const isFire = !!(data?.isFire || room.inFlightIsFire);
        const isArtillery = !!(data?.isArtillery || room.inFlightIsArtillery);

        const applyHitPayload = (payload) => {
            if (!payload || !payload.hitOpponent) return;
            let targetIndex = payload.targetIndex !== undefined ? payload.targetIndex : (room.turnIndex === 0 ? 1 : 0);
            const hitZone = payload.hitZone || 'body';
            const hitIsFire = !!(payload.isFire || isFire);
            const hitIsArtillery = !!(payload.isArtillery || isArtillery);
            // Anti-cheat: clamp client-reported damage to legitimate physics bounds
            const maxAllowed = hitIsArtillery ? 75 : (hitIsFire ? (hitZone === 'head' ? 95 : (hitZone === 'leg' ? 45 : 70)) : (hitZone === 'head' ? 55 : (hitZone === 'leg' ? 25 : 40)));
            const baseDamage = Math.max(0, Math.min(Number(payload.damage) || 0, maxAllowed));
            const defending = room.defending && room.defending[targetIndex];
            const ducking = room.ducking && room.ducking[targetIndex];
            const jumping = room.jumping && room.jumping[targetIndex];
            let appliedDamage = baseDamage;
            let shieldHit = false;
            let shieldActiveBlock = false;
            let shieldlessDefense = false;
            let shieldBroke = false;
            let duckDodged = false;
            let jumpDodged = false;

            if (jumping && hitZone === 'leg') {
                appliedDamage = 0;
                jumpDodged = true;
            } else if (hitIsArtillery) {
                if (room.shield[targetIndex] > 0 && defending) {
                    shieldHit = true;
                    shieldActiveBlock = true;
                    appliedDamage = 0;
                    room.shield[targetIndex] = 0; // Artillery breaks shield completely
                } else if (room.shield[targetIndex] > 0 && payload.isShieldHit) {
                    shieldHit = true;
                    appliedDamage = 0;
                    room.shield[targetIndex] = 0; // Artillery breaks shield completely
                } else {
                    appliedDamage = Math.ceil(room.health[targetIndex] / 2);
                }
            } else if (hitIsFire) {
                // Olovli nayza / kamon o'qi: raqib qalqon tutsa ham kuydirib ziyon yetkazadi
                if (ducking && (hitZone === 'head' || hitZone === 'body')) {
                    appliedDamage = 0;
                    duckDodged = true;
                } else if (room.shield[targetIndex] > 0 && defending && (hitZone === 'head' || hitZone === 'body')) {
                    shieldHit = true;
                    shieldActiveBlock = true;
                    appliedDamage = 25; // Olov qalqonni qizdirib ziyon keltiradi
                    room.shield[targetIndex] -= 1;
                } else if (room.shield[targetIndex] > 0 && payload.isShieldHit && hitZone === 'body') {
                    shieldHit = true;
                    appliedDamage = 35; // Olov qalqondan o'tadi
                    room.shield[targetIndex] -= 1;
                } else if (room.shield[targetIndex] <= 0 && defending) {
                    shieldlessDefense = true;
                    appliedDamage = Math.max(25, Math.round(baseDamage * 0.75));
                } else {
                    appliedDamage = baseDamage;
                }
            } else if (ducking && (hitZone === 'head' || hitZone === 'body')) {
                appliedDamage = 0;
                duckDodged = true;
            } else if (room.shield[targetIndex] > 0 && defending && (hitZone === 'head' || hitZone === 'body')) {
                shieldHit = true;
                shieldActiveBlock = true;
                appliedDamage = 0;
                room.shield[targetIndex] -= 1;
            } else if (room.shield[targetIndex] > 0 && payload.isShieldHit && hitZone === 'body') {
                shieldHit = true;
                appliedDamage = Math.min(5, Math.max(0, baseDamage || 5));
                room.shield[targetIndex] -= 1;
            } else if (room.shield[targetIndex] <= 0 && defending) {
                shieldlessDefense = true;
                appliedDamage = Math.max(5, Math.round(baseDamage * 0.45));
            }
            if (shieldHit && room.shield[targetIndex] <= 0) {
                room.shield[targetIndex] = 0;
                shieldBroke = true;
            }
            if (appliedDamage > 0) room.health[targetIndex] -= appliedDamage;
            io.to(roomName).emit('hitRegistered', {
                targetIndex,
                damage: appliedDamage,
                newHealth: room.health[targetIndex],
                newShield: room.shield[targetIndex],
                hitX: payload.hitX,
                hitY: payload.hitY,
                isShieldHit: shieldHit,
                shieldActiveBlock,
                shieldlessDefense,
                shieldBroke,
                duckDodged,
                jumpDodged,
                hitZone,
                hitAngle: payload.hitAngle,
                isFire: hitIsFire,
                isArtillery: hitIsArtillery
            });
            if (room.health[targetIndex] <= 0) {
                room.gameOver = true;
                clearRoomTurnTimer(roomName);
                const winnerIndex = targetIndex === 0 ? 1 : 0;
                const winnerId = room.players ? room.players[winnerIndex] : null;
                const loserId = room.players ? room.players[targetIndex] : null;
                const winnerSocket = io.sockets.sockets.get(winnerId);
                const loserSocket = io.sockets.sockets.get(loserId);
                recordGameResult(winnerSocket, loserSocket, 'normal');
                io.to(roomName).emit('gameOver', {
                    winnerIndex,
                    winnerId,
                    reason: 'normal'
                });
                return true;
            }
            return false;
        };

        if (hitOpponent) {
            if (applyHitPayload({ ...data, hitOpponent: true, hitX, hitY, hitAngle })) return;
        } else {
            // Tell others about ground hit so it sticks
            io.to(roomName).emit('groundHit', { hitX, hitY, hitAngle });
        }

        if (data.extraHit && !room.gameOver) {
            if (applyHitPayload({ ...data.extraHit, hitOpponent: true })) return;
        }

        room.turnIndex = room.turnIndex === 0 ? 1 : 0;
        room.wind = generateWind();
        io.to(roomName).emit('nextTurn', {
            turnIndex: room.turnIndex,
            wind: room.wind
        });
        startRoomTurnTimer(roomName);
    });

    socket.on('entityHit', (data) => {
        const roomName = socket.roomId;
        const room = rooms[roomName];
        if (!room || room.gameOver || !room.inFlight) return;
        if (socket.id !== room.players[room.turnIndex]) return;
        if (roomName) {
            socket.to(roomName).emit('entityHit', data);
        }
        // Switch turn like groundHit
        room.inFlight = false;
        room.turnIndex = room.turnIndex === 0 ? 1 : 0;
        room.wind = generateWind();
        io.to(roomName).emit('nextTurn', {
            turnIndex: room.turnIndex,
            wind: room.wind
        });
        startRoomTurnTimer(roomName);
    });

    socket.on('chatMessage', (msg) => {
        const roomName = socket.roomId;
        if (roomName) {
            io.to(roomName).emit('chatMessage', { senderId: socket.id, msg: msg });
        }
    });

    socket.on('sendEmote', (data) => {
        const roomName = socket.roomId;
        const room = rooms[roomName];
        if (!room || !roomName) return;
        const playerIndex = room.players.indexOf(socket.id);
        if (playerIndex === -1) return;
        io.to(roomName).emit('playerEmote', {
            playerIndex,
            emote: String(data?.emote || '👍').slice(0, 10),
            emoteId: String(data?.emoteId || '')
        });
    });

    // Revansh so'rovi
    socket.on('rematchRequest', (data) => {
        const roomName = data?.roomName || socket.roomId;
        const room = rooms[roomName];
        if (!room || !room.players) return;
        // Raqibga revansh so'rovini yuborish
        const opponentId = room.players.find(id => id !== socket.id);
        if (opponentId) {
            io.to(opponentId).emit('rematchRequest');
        }
    });

    // Revansh qabul qilindi
    socket.on('rematchAccept', (data) => {
        console.log('rematchAccept received, data:', data);
        const roomName = data?.roomName || socket.roomId;
        console.log('roomName from data or socket.roomId:', roomName);
        const room = rooms[roomName];
        if (!room || !room.players) {
            console.log('Room not found or no players');
            return;
        }

        // Xonani qayta ishga tushirish
        clearRoomTurnTimer(roomName);
        room.gameOver = false;
        room.turnIndex = 0;
        room.wind = generateWind();
        room.inFlight = false;
        room.health = [100, 100];
        room.shield = [5, 5];
        room.super = [room.super[0], room.super[1]];
        room.walls = [{ active: false, x: 0, hp: 0 }, { active: false, x: 0, hp: 0 }];

        // Ikkala o'yinchiga yangi o'yin boshlandi xabari
        io.to(roomName).emit('rematchStart');

        // O'yin ma'lumotlarini yuborish - startGame funksiyasidan foydalanish
        const player1 = io.sockets.sockets.get(room.players[0]);
        const player2 = io.sockets.sockets.get(room.players[1]);
        console.log('player1:', player1 ? 'found' : 'not found', 'player2:', player2 ? 'found' : 'not found');
        if (player1 && player2) {
            startGame(player1, player2, roomName);
        }
    });

    // Revansh rad etildi
    socket.on('rematchDecline', (data) => {
        const roomName = data?.roomName || socket.roomId;
        const room = rooms[roomName];
        if (!room || !room.players) return;
        clearRoomTurnTimer(roomName);
        clearCoinTossTimer(roomName);
        // Raqibga rad etildi xabari
        const opponentId = room.players.find(id => id !== socket.id);
        if (opponentId) {
            io.to(opponentId).emit('rematchDeclined');
        }
        delete rooms[roomName];
    });

    socket.on('disconnect', () => {
        removeFromWaitingQueue(socket.id);
        if (socket.profile && socket.profile.playerId) {
            onlineByPlayerId.delete(socket.profile.playerId);
            pendingFriendInvites.delete(socket.profile.playerId);
            pendingFriendAddRequests.delete(socket.profile.playerId);
        }

        // Clean up un-joined code rooms
        for (const code in roomsByCode) {
            if (roomsByCode[code].player1.id === socket.id) {
                delete roomsByCode[code];
            }
        }

        const roomName = socket.roomId;
        if (roomName && rooms[roomName]) {
            const room = rooms[roomName];
            clearRoomTurnTimer(roomName);
            clearCoinTossTimer(roomName);
            if (!room.gameOver && Array.isArray(room.players) && room.players.length === 2) {
                const remainingPlayerId = room.players.find(id => id !== socket.id);
                const winnerIndex = room.players.indexOf(remainingPlayerId);
                room.gameOver = true;
                if (remainingPlayerId) {
                    const winnerSocket = io.sockets.sockets.get(remainingPlayerId);
                    recordGameResult(winnerSocket, socket, 'opponent_left');
                    io.to(remainingPlayerId).emit('gameOver', {
                        winnerIndex: winnerIndex >= 0 ? winnerIndex : 0,
                        winnerId: remainingPlayerId,
                        reason: 'opponent_left'
                    });
                }
            }
            io.to(roomName).emit('opponentDisconnected');
            delete rooms[roomName];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    try {
        const { startTelegramBot } = require('./telegramBot');
        startTelegramBot();
    } catch (e) {
        console.error('Telegram bot startup error:', e.message);
    }
    try {
        startScheduledDuelsMonitor();
    } catch (e) {
        console.error('Scheduled duels monitor start error:', e.message);
    }
    try {
        startKeepAlive();
    } catch (e) {
        console.error('Keep-alive startup error:', e.message);
    }
});

function startKeepAlive() {
    const targetUrl = process.env.RENDER_EXTERNAL_URL || process.env.GAME_URL || 'https://nayza-jangi.onrender.com';
    if (!targetUrl || targetUrl.includes('localhost') || targetUrl.includes('127.0.0.1')) return;

    const pingEndpoint = `${targetUrl.replace(/\/$/, '')}/ping`;
    const PING_INTERVAL = 10 * 60 * 1000; // Har 10 daqiqada (Render 15 daqiqa harakatsizlikda uxlaydi)
    const https = require('https');

    console.log(`[Keep-Alive] Render uyg'oq turishi uchun avto-ping yoqildi: ${pingEndpoint}`);

    // Ilk pingni 2 daqiqadan so'ng yuborish
    setTimeout(() => {
        pingOnce(pingEndpoint, https);
    }, 2 * 60 * 1000);

    // Keyingi pinglarni har 10 daqiqada davomiy yuborish
    setInterval(() => {
        pingOnce(pingEndpoint, https);
    }, PING_INTERVAL);
}

function pingOnce(endpoint, https) {
    try {
        const client = endpoint.startsWith('https') ? https : http;
        const req = client.get(endpoint, (res) => {
            res.resume();
        });
        req.on('error', () => { });
        req.setTimeout(15000, () => req.destroy());
    } catch (_) { }
}

// Force redeploy 1397934648782924302
