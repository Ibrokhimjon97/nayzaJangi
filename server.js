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
app.use(express.static(path.join(__dirname, 'public')));

const multer = require('multer');
const customModelsPath = path.join(__dirname, 'custom_models.json');

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

app.post('/api/models/create', upload.fields([
    { name: 'shieldIdle', maxCount: 1 },
    { name: 'shieldAim', maxCount: 1 },
    { name: 'shieldDuck', maxCount: 1 },
    { name: 'shieldDefend', maxCount: 1 },
    { name: 'shieldHurt', maxCount: 1 },
    { name: 'shieldBreak', maxCount: 1 },
    { name: 'noShieldIdle', maxCount: 1 },
    { name: 'noShieldAim', maxCount: 1 },
    { name: 'noShieldDuck', maxCount: 1 },
    { name: 'noShieldDefend', maxCount: 1 },
    { name: 'noShieldHurt', maxCount: 1 },
    { name: 'celebrate', maxCount: 1 },
    { name: 'bgMusic', maxCount: 1 }
]), (req, res) => {
    try {
        const name = req.body.name || 'Yangi Model';
        const files = req.files || {};
        if (!files.shieldIdle || !files.shieldAim || !files.shieldDuck || !files.shieldDefend || !files.shieldHurt || !files.shieldBreak || !files.noShieldIdle || !files.noShieldAim || !files.noShieldDuck || !files.noShieldDefend || !files.noShieldHurt) {
            return res.status(400).json({ ok: false, error: 'Barcha asosiy rasmlar yuklanishi shart.' });
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
                celebrate: files.celebrate ? 'custom_models/' + files.celebrate[0].filename : 'custom_models/' + files.shieldIdle[0].filename
            },
            bgMusic: files.bgMusic ? 'custom_models/' + files.bgMusic[0].filename : null
        };
        models.push(newModel);
        saveCustomModels(models);
        res.json({ ok: true, model: newModel });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

const leaderboardDbPath = path.join(__dirname, 'ratings.json');
const usersDbPath = path.join(__dirname, 'users.json');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseEnabled = Boolean(supabaseUrl && supabaseServiceRoleKey);
const supabase = supabaseEnabled
    ? createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } })
    : null;

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

function saveLeaderboard(entries) {
    fs.writeFileSync(leaderboardDbPath, JSON.stringify(entries, null, 2), 'utf8');
}

function normalizeEntry(body) {
    return {
        name: String(body?.name || 'Jangchi').slice(0, 30),
        flag: String(body?.flag || '🏳️').slice(0, 8),
        phone: String(body?.phone || '').replace(/\D/g, '').slice(-15),
        score: Number(body?.score) || 0,
        wins: Math.max(0, Number(body?.wins) || 0),
        games: Math.max(0, Number(body?.games) || 0),
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
    fs.writeFileSync(usersDbPath, JSON.stringify(users, null, 2), 'utf8');
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

function hashPassword(password) {
    return crypto.createHash('sha256').update(String(password || '')).digest('hex');
}

function normalizePhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 9) return `998${digits}`;
    if (digits.length === 12 && digits.startsWith('998')) return digits;
    if (digits.length > 9) return `998${digits.slice(-9)}`;
    return '';
}

function toPublicUser(user) {
    return {
        name: user.name,
        phone: user.phone,
        age: user.age,
        score: Number(user.score) || 0,
        wins: Math.max(0, Number(user.wins) || 0),
        games: Math.max(0, Number(user.games) || 0),
        campaignLevel: Math.max(1, Number(user.campaignLevel) || 1),
        superPowers: Math.max(0, Number(user.superPowers || 0)),
        doubleSpears: Math.max(0, Number(user.doubleSpears || 0)),
        walls: Math.max(0, Number(user.walls || 0))
    };
}

function findUserIndexByPhone(users, phone) {
    const phoneNorm = normalizePhone(phone || '');
    if (!phoneNorm) return -1;
    const phoneTail = phoneNorm.slice(-9);
    return (users || []).findIndex((u) => {
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
        games: Math.max(Number(prev.games || 0), Number(progress.games || 0)),
        campaignLevel: Math.max(Number(prev.campaignLevel || 1), Number(progress.campaignLevel || 1)),
        superPowers: Number.isFinite(Number(progress.superPowers)) ? Math.max(0, Number(progress.superPowers)) : Math.max(0, Number(prev.superPowers || 0)),
        doubleSpears: Number.isFinite(Number(progress.doubleSpears)) ? Math.max(0, Number(progress.doubleSpears)) : Math.max(0, Number(prev.doubleSpears || 0)),
        walls: Number.isFinite(Number(progress.walls)) ? Math.max(0, Number(progress.walls)) : Math.max(0, Number(prev.walls || 0)),
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
                walls
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
                    walls
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
    if (!user || user.passwordHash !== hashPassword(password)) {
        res.status(401).json({ ok: false, error: 'invalid_credentials' });
        return;
    }
    res.json({ ok: true, user: toPublicUser(user) });
});

app.post('/api/auth/reset-password', (req, res) => {
    const phone = normalizePhone(req.body?.phone || '');
    const newPassword = String(req.body?.newPassword || '');
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
    users[idx].passwordHash = hashPassword(newPassword);
    saveUsers(users);
    res.json({ ok: true });
});

app.get('/api/auth/user', (req, res) => {
    const phone = normalizePhone(req.query.phone || '');
    if (phone.length !== 12) {
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

const waitingQueue = [];
const rooms = {};
const roomsByCode = {};
const onlineByPlayerId = new Map();
const pendingFriendInvites = new Map();
const pendingFriendAddRequests = new Map();

function removeFromWaitingQueue(socketId) {
    const idx = waitingQueue.findIndex((s) => s && s.id === socketId);
    if (idx !== -1) waitingQueue.splice(idx, 1);
}

function generateWind() {
    const strength = (Math.random() * 20 - 10).toFixed(2);
    return parseFloat(strength);
}

function getRandomMap() {
    const maps = ['field', 'castle', 'desert', 'winter'];
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

        rooms[roomName] = {
            players: [player1.id, player2.id],
            turnIndex: 0,
            wind: generateWind(),
            gameOver: false,
            health: [100, 100],
            shield: [5, 5],
            super: [
                Math.max(0, Number(player1.profile?.superPowers ?? 5)),
                Math.max(0, Number(player2.profile?.superPowers ?? 5))
            ],
            walls: [
                { active: false, x: 0, hp: 0 },
                { active: false, x: 0, hp: 0 }
            ],
            defending: [false, false],
            ducking: [false, false],
            inFlight: false,
            options: existingOptions
        };

        player1.roomId = roomName;
        player2.roomId = roomName;

        const gameStartData1 = {
            playerIndex: 0,
            turnIndex: 0,
            wind: rooms[roomName].wind,
            opponentId: player2.id,
            opponentProfile: player2.profile,
            health: rooms[roomName].health,
            shield: rooms[roomName].shield,
            super: rooms[roomName].super,
            walls: rooms[roomName].walls,
            options: rooms[roomName].options,
            roomName: roomName
        };
        console.log('Sending gameStart to player1, roomName:', roomName);
        player1.emit('gameStart', gameStartData1);

        const gameStartData2 = {
            playerIndex: 1,
            turnIndex: 0,
            wind: rooms[roomName].wind,
            opponentId: player1.id,
            opponentProfile: player1.profile,
            health: rooms[roomName].health,
            shield: rooms[roomName].shield,
            super: rooms[roomName].super,
            walls: rooms[roomName].walls,
            options: rooms[roomName].options,
            roomName: roomName
        };
        console.log('Sending gameStart to player2, roomName:', roomName);
        player2.emit('gameStart', gameStartData2);
    }

    function bindOnlineProfile(profile) {
        if (!profile || !profile.playerId) return;
        socket.profile = { ...(socket.profile || {}), ...profile };
        onlineByPlayerId.set(profile.playerId, socket);
    }

    socket.on('registerProfile', (profile) => {
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
        const { profile, code } = data;
        socket.profile = profile || { name: "O'yinchi", flag: "🏳️", avatar: "👤" };
        bindOnlineProfile(socket.profile);
        
        if (roomsByCode[code]) {
            const roomData = roomsByCode[code];
            const player1 = roomData.player1;
            const player2 = socket;
            const roomName = roomData.roomName;
            
            // pre-fill room with options so startGame can read it
            rooms[roomName] = { options: roomData.options };
            
            delete roomsByCode[code];
            player2.join(roomName);
            startGame(player1, player2, roomName);
        } else {
            socket.emit('joinError');
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

    socket.on('cancelFind', () => {
        removeFromWaitingQueue(socket.id);
    });

    socket.on('throwSpear', (data) => {
        const { angle, power } = data;
        const roomName = socket.roomId;
        const room = rooms[roomName];

        if (!room || room.gameOver) return;

        const currentPlayerId = room.players[room.turnIndex];
        if (socket.id !== currentPlayerId) return;

        io.to(roomName).emit('spearThrown', {
            playerIndex: room.turnIndex,
            angle: angle,
            power: power
        });
        room.inFlight = true;
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
        room.walls[ownerIndex].hp = Math.max(0, Number(room.walls[ownerIndex].hp || 5) - 1);
        io.to(roomName).emit('wallHitFx', {
            ownerIndex,
            hitX: Number(data?.hitX || 0),
            hitY: Number(data?.hitY || 0)
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
    });

    socket.on('throwComplete', (data) => {
        const { hitOpponent, hitX, hitY, hitAngle } = data;
        const roomName = socket.roomId;
        const room = rooms[roomName];

        if (!room || room.gameOver) return;
        if (socket.id !== room.players[room.turnIndex]) return;
        if (!room.inFlight) return; // ignore stale/duplicate completion events
        room.inFlight = false;

        const applyHitPayload = (payload) => {
            if (!payload || !payload.hitOpponent) return;
            let targetIndex = payload.targetIndex !== undefined ? payload.targetIndex : (room.turnIndex === 0 ? 1 : 0);
            const hitZone = payload.hitZone || 'body';
            const baseDamage = Number(payload.damage) || 0;
            const defending = room.defending && room.defending[targetIndex];
            const ducking = room.ducking && room.ducking[targetIndex];
            let appliedDamage = baseDamage;
            let shieldHit = false;
            let shieldActiveBlock = false;
            let shieldlessDefense = false;
            let shieldBroke = false;
            let duckDodged = false;

            if (ducking && (hitZone === 'head' || hitZone === 'body')) {
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
                hitZone,
                hitAngle: payload.hitAngle
            });
            if (room.health[targetIndex] <= 0) {
                room.gameOver = true;
                io.to(roomName).emit('gameOver', { winnerIndex: room.turnIndex });
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
    });

    socket.on('entityHit', (data) => {
        const roomName = socket.roomId;
        const room = rooms[roomName];
        if (!room || room.gameOver || !room.inFlight) return;
        if (socket.id !== room.players[room.turnIndex]) return;
        if(roomName) {
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
    });

    socket.on('chatMessage', (msg) => {
        const roomName = socket.roomId;
        if(roomName) {
            io.to(roomName).emit('chatMessage', { senderId: socket.id, msg: msg });
        }
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
            io.to(roomName).emit('opponentDisconnected');
            delete rooms[roomName];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
