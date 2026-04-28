const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const leaderboardDbPath = path.join(__dirname, 'ratings.json');
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
        score: Math.max(0, Number(body?.score) || 0),
        wins: Math.max(0, Number(body?.wins) || 0),
        games: Math.max(0, Number(body?.games) || 0),
        updatedAt: Date.now()
    };
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
        const key = `${entry.name}|${entry.flag}`;
        const existingIndex = rows.findIndex((r) => `${r.name}|${r.flag}` === key);

        if (existingIndex === -1) {
            rows.push(entry);
        } else {
            const prev = rows[existingIndex];
            rows[existingIndex] = {
                ...prev,
                score: Math.max(prev.score || 0, entry.score),
                wins: Math.max(prev.wins || 0, entry.wins),
                games: Math.max(prev.games || 0, entry.games),
                updatedAt: Date.now()
            };
        }
        saveLeaderboard(rows);
        return;
    }

    const playerKey = `${entry.name}|${entry.flag}`;
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
    try {
        await upsertLeaderboardEntry(entry);
        res.json({ ok: true, source: supabaseEnabled ? 'supabase' : 'file' });
    } catch {
        // Emergency fallback so gameplay never breaks if DB is down.
        try {
            const rows = loadLeaderboard();
            const key = `${entry.name}|${entry.flag}`;
            const existingIndex = rows.findIndex((r) => `${r.name}|${r.flag}` === key);
            if (existingIndex === -1) rows.push(entry);
            else {
                const prev = rows[existingIndex];
                rows[existingIndex] = {
                    ...prev,
                    score: Math.max(prev.score || 0, entry.score),
                    wins: Math.max(prev.wins || 0, entry.wins),
                    games: Math.max(prev.games || 0, entry.games),
                    updatedAt: Date.now()
                };
            }
            saveLeaderboard(rows);
            res.json({ ok: true, source: 'file-fallback' });
        } catch {
            res.status(500).json({ ok: false, error: 'leaderboard_write_failed' });
        }
    }
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

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    function startGame(player1, player2, roomName) {
        const existingOptions = rooms[roomName] && rooms[roomName].options ? rooms[roomName].options : { map: 'field', birds: false, animals: false };
        
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
            defending: [false, false],
            inFlight: false,
            options: existingOptions
        };

        player1.roomId = roomName;
        player2.roomId = roomName;

        player1.emit('gameStart', { 
            playerIndex: 0, 
            turnIndex: 0, 
            wind: rooms[roomName].wind,
            opponentId: player2.id,
            opponentProfile: player2.profile,
            health: rooms[roomName].health,
            shield: rooms[roomName].shield,
            super: rooms[roomName].super,
            options: rooms[roomName].options
        });
        player2.emit('gameStart', { 
            playerIndex: 1, 
            turnIndex: 0, 
            wind: rooms[roomName].wind,
            opponentId: player1.id,
            opponentProfile: player1.profile,
            health: rooms[roomName].health,
            shield: rooms[roomName].shield,
            super: rooms[roomName].super,
            options: rooms[roomName].options
        });
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
            options: data.options || { map: 'field', birds: false, animals: false }
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
        socket.pendingOptions = options || { map: 'field', weather: 'sunny', birds: false, animals: false };
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
            const mergedOptions = player1.pendingOptions || socket.pendingOptions || { map: 'field', weather: 'sunny', birds: false, animals: false };
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
            options: payload?.options || { map: 'field', weather: 'sunny', birds: false, animals: false }
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
        rooms[roomName] = { options: pending.options || { map: 'field', weather: 'sunny', birds: false, animals: false } };
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

    socket.on('throwComplete', (data) => {
        const { hitOpponent, hitX, hitY, hitAngle } = data;
        const roomName = socket.roomId;
        const room = rooms[roomName];

        if (!room || room.gameOver) return;
        if (socket.id !== room.players[room.turnIndex]) return;
        if (!room.inFlight) return; // ignore stale/duplicate completion events
        room.inFlight = false;

        if (hitOpponent) {
            let targetIndex = data.targetIndex !== undefined ? data.targetIndex : (room.turnIndex === 0 ? 1 : 0);
            const hitZone = data.hitZone || 'body';
            const baseDamage = Number(data.damage) || 0;
            const defending = room.defending && room.defending[targetIndex];
            let appliedDamage = baseDamage;
            let shieldHit = false;
            let shieldActiveBlock = false;
            let shieldlessDefense = false;
            let shieldBroke = false;
            
            if (room.shield[targetIndex] > 0 && defending && (hitZone === 'head' || hitZone === 'body')) {
                shieldHit = true;
                shieldActiveBlock = true;
                appliedDamage = 0;
                room.shield[targetIndex] -= 1;
            } else if (room.shield[targetIndex] > 0 && data.isShieldHit && hitZone === 'body') {
                shieldHit = true;
                appliedDamage = Math.min(5, Math.max(0, baseDamage || 5));
                room.shield[targetIndex] -= 1;
            } else {
                if (room.shield[targetIndex] <= 0 && defending) {
                    shieldlessDefense = true;
                    appliedDamage = Math.max(5, Math.round(baseDamage * 0.45));
                }
            }

            if (shieldHit && room.shield[targetIndex] <= 0) {
                room.shield[targetIndex] = 0;
                shieldBroke = true;
            }

            if (appliedDamage > 0) room.health[targetIndex] -= appliedDamage;
            
            io.to(roomName).emit('hitRegistered', {
                targetIndex: targetIndex,
                damage: appliedDamage,
                newHealth: room.health[targetIndex],
                newShield: room.shield[targetIndex],
                hitX: hitX,
                hitY: hitY,
                isShieldHit: shieldHit,
                shieldActiveBlock,
                shieldlessDefense,
                shieldBroke,
                hitZone,
                hitAngle: hitAngle
            });

            if (room.health[targetIndex] <= 0) {
                room.gameOver = true;
                io.to(roomName).emit('gameOver', { winnerIndex: room.turnIndex });
                return;
            }
        } else {
            // Tell others about ground hit so it sticks
            io.to(roomName).emit('groundHit', { hitX, hitY, hitAngle });
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
