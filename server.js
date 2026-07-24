const { TikTokLive } = require('@tiktool/live');
const http = require('http');
const PORT = process.env.PORT || 3000;

const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK - Rotten Proxy AFK running');
});

const io = require('socket.io')(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

httpServer.listen(PORT, () => {
    console.log(`🌐 Servidor en puerto ${PORT}`);
});

console.log("🚀 ROTTEN PROXY AFK V24.0 - FIX CONNECTED EVENT");

function getApiKey() {
    const keys = [
        process.env.TIKTOOL_API_KEY,
        process.env.TIKTOOL_API_KEY2
    ].filter(k => k && k.trim().length > 10);
    if (keys.length === 0) return null;
    return keys[Math.floor(Math.random() * keys.length)].trim();
}

io.on('connection', (socket) => {
    const state = { conn: null, username: null, sessionId: null, active: false, attempts: 0, retryTimer: null };

    function clearRetryTimer() {
        if (state.retryTimer) { clearTimeout(state.retryTimer); state.retryTimer = null; }
    }

    function teardownConnection() {
        if (state.conn) { try { state.conn.disconnect(); } catch (_) {} state.conn = null; }
    }

    function scheduleReconnect() {
        if (!state.active) return;
        const delay = Math.min(6000 * Math.pow(2, Math.min(state.attempts, 3)), 30000);
        state.attempts += 1;
        clearRetryTimer();
        state.retryTimer = setTimeout(() => connectToTikTok(state.username, state.sessionId), delay);
    }

    function connectToTikTok(username, sessionId) {
        if (!state.active) return;
        teardownConnection();

        const cleanUser = String(username).replace('@', '').trim();
        state.username = cleanUser;
        state.sessionId = sessionId;

        const apiKey = getApiKey();
        if (!apiKey) {
            socket.emit('error', 'No API Key configured on Railway');
            return;
        }

        console.log(`🔗 [${cleanUser}] Conectando...`);

        const conn = new TikTokLive({
            uniqueId: cleanUser,
            apiKey: apiKey,
            sessionId: sessionId,
            mode: 'relayed',
        });
        state.conn = conn;

        // Reenviar eventos a la App
        conn.on('chat', (data) => socket.emit('comment', data));
        conn.on('gift', (data) => socket.emit('gift', data));
        conn.on('like', (data) => socket.emit('like', data));
        conn.on('follow', (data) => socket.emit('follow', data));
        conn.on('share', (data) => socket.emit('share', data));

        ['disconnected', 'close', 'streamEnd'].forEach((evt) => {
            conn.on(evt, () => { if (state.active) scheduleReconnect(); });
        });

        conn.connect()
            .then(() => {
                console.log(`✅ ¡CONECTADO! @${cleanUser}`);
                state.attempts = 0;
                // --- CAMBIO CLAVE AQUÍ ---
                socket.emit('connected'); 
                // -------------------------
            })
            .catch((err) => {
                const errorMsg = err.message || String(err);
                console.error(`❌ Error en @${cleanUser}:`, errorMsg);
                socket.emit('error', errorMsg);
                scheduleReconnect();
            });
    }

    socket.on('join', (username, sessionId) => {
        state.active = true;
        state.attempts = 0;
        clearRetryTimer();
        connectToTikTok(username, sessionId);
    });

    socket.on('leave', () => {
        state.active = false; clearRetryTimer(); teardownConnection();
    });

    socket.on('disconnect', () => {
        state.active = false; clearRetryTimer(); teardownConnection();
    });
});

process.on('uncaughtException', (err) => console.error('⚠️ Exception:', err));
process.on('unhandledRejection', (reason) => console.error('⚠️ Rejection:', reason));
