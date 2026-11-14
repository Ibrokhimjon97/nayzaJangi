const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const GAME_URL = process.env.GAME_URL || process.env.RENDER_EXTERNAL_URL || 'https://nayzajangi.onrender.com';

if (!BOT_TOKEN) {
    console.warn('⚠️ TELEGRAM_BOT_TOKEN muhit o\'zgaruvchisi kiritilmagan. Bot ishga tushmadi.');
}

function apiRequest(method, payload) {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(payload || {});
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/${method}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve({ ok: false, error: 'JSON parse error' });
                }
            });
        });
        req.on('error', (err) => resolve({ ok: false, error: err.message }));
        req.write(bodyStr);
        req.end();
    });
}

let lastUpdateId = 0;
let isPolling = false;

async function pollUpdates() {
    if (!isPolling) return;
    try {
        const res = await apiRequest('getUpdates', {
            offset: lastUpdateId + 1,
            timeout: 25,
            allowed_updates: ['message', 'inline_query']
        });

        if (res && res.ok && Array.isArray(res.result)) {
            for (const update of res.result) {
                lastUpdateId = Math.max(lastUpdateId, update.update_id);
                handleUpdate(update).catch(err => console.error('Error handling update:', err));
            }
        }
    } catch (err) {
        console.error('Telegram polling error:', err.message);
    }

    if (isPolling) {
        setTimeout(pollUpdates, 500);
    }
}

async function handleUpdate(update) {
    if (update.message) {
        const msg = update.message;
        const chatId = msg.chat?.id;
        const text = (msg.text || '').trim();

        if (text.startsWith('/start')) {
            const parts = text.split(' ');
            const param = parts.length > 1 ? parts[1].trim() : '';

            if (param) {
                const roomName = param.replace(/^(room_code_|room_|duel_)/i, '').trim();
                const playUrl = `${GAME_URL}?room=${encodeURIComponent(roomName)}`;

                await apiRequest('sendMessage', {
                    chat_id: chatId,
                    text: `⚔️ *Sizni Kamonboz dueliga chaqirishdi!*\n\n🔑 Xona kodi: \`${roomName}\`\n\nQuyidagi tugmani bosing va to'g'ridan-to'g'ri jangga ulaning:`,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '⚔️ Jangga kirish (Play)', web_app: { url: playUrl } }
                            ],
                            [
                                { text: '👥 Do\'stlarni chaqirish', switch_inline_query: `duel_${roomName}` }
                            ]
                        ]
                    }
                });
            } else {
                await apiRequest('sendMessage', {
                    chat_id: chatId,
                    text: `🏹 *Kamonboz Duel o'yiniga xush kelibsiz!*\n\nHaqiqiy o'yinchilar bilan 1v1 kamon va nayza jangi!\n\n✨ *Yangi maydonlar:* Registon, Sakura bog'i, Sibir taygasi, Buyuk Qasr!\n\nO'yinni boshlash uchun quyidagi tugmani bosing:`,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🏹 O\'yinni boshlash (Play)', web_app: { url: GAME_URL } }
                            ],
                            [
                                { text: '⚔️ Do\'stni duelga chaqirish', switch_inline_query: 'duel' }
                            ]
                        ]
                    }
                });
            }
        } else if (text === '/duel') {
            await apiRequest('sendMessage', {
                chat_id: chatId,
                text: `⚔️ *Do'stingizni duelga qanday chaqirish mumkin?*\n\n1. O'yinga kiring va xona yarating.\n2. Xona ichida **"📲 Telegramda do'stni chaqirish"** tugmasini bosing.\n3. Yoki quyidagi tugma orqali istalgan chatda jangga chorlang:`,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🏹 O\'yinni ochish', web_app: { url: GAME_URL } }
                        ],
                        [
                            { text: '📲 Do\'stga taklif yuborish', switch_inline_query: 'duel' }
                        ]
                    ]
                }
            });
        }
    } else if (update.inline_query) {
        const q = update.inline_query;
        const queryText = (q.query || '').trim();
        let roomCode = '';
        if (queryText.startsWith('duel_')) {
            roomCode = queryText.replace('duel_', '').trim();
        } else if (queryText.startsWith('room_')) {
            roomCode = queryText.replace('room_', '').trim();
        } else if (queryText.startsWith('room_code_')) {
            roomCode = queryText.replace('room_code_', '').trim();
        }
        roomCode = roomCode.replace(/^(room_code_|room_|duel_)/i, '').trim();

        const playUrl = roomCode ? `${GAME_URL}?room=${encodeURIComponent(roomCode)}` : GAME_URL;
        const msgText = roomCode 
            ? `🏹 *Men seni Kamonboz jangiga chaqiraman!*\n\n🔑 Xona kodi: \`${roomCode}\`\n\n👇 To'g'ridan-to'g'ri jangga kirish uchun pastdagi tugmani bosing:`
            : `🏹 *Men seni Kamonboz dueliga chaqiraman!*\n\nKuching yetsa, jangga qo'shil va mahoratingni ko'rsat!`;

        await apiRequest('answerInlineQuery', {
            inline_query_id: q.id,
            cache_time: 5,
            results: [
                {
                    type: 'article',
                    id: 'kamonboz_duel',
                    title: roomCode ? `⚔️ Kamonboz jangi (Xona: ${roomCode})` : '⚔️ Kamonboz: 1v1 Duelga chaqirish',
                    description: 'Do\'stingizni jonli kamonbozlik jangiga chorlang!',
                    input_message_content: {
                        message_text: msgText,
                        parse_mode: 'Markdown'
                    },
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '⚔️ Jangga kirish (Play)', web_app: { url: playUrl } }
                            ]
                        ]
                    }
                }
            ]
        });
    }
}

function startTelegramBot() {
    if (isPolling) return;
    isPolling = true;
    console.log('Telegram bot (@Kamonboz_bot) ishga tushirildi!');
    pollUpdates();
}

function stopTelegramBot() {
    isPolling = false;
}

async function getTelegramUserPhotoUrl(tgId) {
    if (!tgId) return null;
    try {
        const res = await apiRequest('getUserProfilePhotos', { user_id: Number(tgId), limit: 1 });
        if (res && res.ok && res.result?.photos?.length > 0) {
            const photoArr = res.result.photos[0];
            const bestPhoto = photoArr[photoArr.length - 1];
            if (bestPhoto && bestPhoto.file_id) {
                const fileRes = await apiRequest('getFile', { file_id: bestPhoto.file_id });
                if (fileRes && fileRes.ok && fileRes.result?.file_path) {
                    return `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileRes.result.file_path}`;
                }
            }
        }
    } catch (err) {
        console.error('getTelegramUserPhotoUrl error:', err.message);
    }
    return null;
}

async function sendTelegramDuelAlert(chatId, text, buttonUrl, buttonText = "⚔️ O'yinga kirish") {
    if (!chatId) return { ok: false };
    const payload = {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown'
    };
    if (buttonUrl) {
        payload.reply_markup = {
            inline_keyboard: [
                [
                    { text: buttonText, web_app: { url: buttonUrl } }
                ]
            ]
        };
    }
    return await apiRequest('sendMessage', payload);
}

module.exports = {
    startTelegramBot,
    stopTelegramBot,
    apiRequest,
    getTelegramUserPhotoUrl,
    sendTelegramDuelAlert,
    BOT_TOKEN,
    GAME_URL
};

