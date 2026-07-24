const { TikTokLive } = require('@tiktool/live');
const http = require('http');

const PORT = process.env.PORT || 3000;

const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK - Rotten Proxy AFK corriendo');
});

const io = require('socket.io')(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

httpServer.listen(PORT, () => {
    console.log(`🌐 Servidor escuchando en puerto ${PORT}`);
});

console.log("🚀 ROTTEN PROXY AFK V22.0 - MULTI-KEY & SESSION BYPASS");

// Función para obtener una llave al azar de las disponibles
function getApiKey() {
    const keys = [
        process.env.TIKTOOL_API_KEY,
        process.env.TIKTOOL_API_KEY2
    ].filter(k => k && k.length > 5); // Filtramos solo las que existen
    
    if (keys.length === 0) return null;
    return keys[Math.floor(Math.random() * keys.length)];
}

const RECONNECT_BASE_MS = 6000;
const RECONNECT_MAX_MS = 30000;

function backoffDelay(attempt) {
    const delay = RECONNECT_BASE_MS * Math.pow(2, Math.min(attempt, 3));
    return Math.min(delay, RECONNECT_MAX_MS);
}

io.on('connection', (socket) => {
    const state = {
        conn: null,
        username: null,
        sessionId: null, // Guardamos la sesión
        active: false,
        attempts: 0,
        retryTimer: null,
    };

    function clearRetryTimer() {
        if (state.retryTimer) {
            clearTimeout(state.retryTimer);
            state.retryTimer = null;
        }
    }

    function teardownConnection() {
        if (state.conn) {
            try { state.conn.disconnect(); } catch (_) {}
            state.conn = null;
        }
    }

    function scheduleReconnect() {
        if (!state.active) return;
        const delay = backoffDelay(state.attempts);
        state.attempts += 1;
        console.log(`⏳ [${state.username}] reconectando en ${delay / 1000}s...`);
        socket.emit('status', 'RECONNECTING');
        clearRetryTimer();
        state.retryTimer = setTimeout(() => connectToTikTok(state.username, state.sessionId), delay);
    }

    function connectToTikTok(username, sessionId) {
        if (!state.active) return;
        teardownConnection();

        // Aseguramos que username sea String para evitar el error .replace
        const cleanUser = String(username).replace('@', '').trim();
        state.username = cleanUser;
        state.sessionId = sessionId;

        const apiKey = getApiKey();
        if (!apiKey) {
            console.error("❌ ERROR: No hay API Keys configuradas en Railway.");
            socket.emit('error', 'API Key missing on server');
            return;
        }

        console.log(`🔗 Conectando @${cleanUser} usando Key: ${apiKey.slice(0,4)}...`);

        const conn = new TikTokLive({
            uniqueId: cleanUser,
            apiKey: apiKey,
            sessionId: sessionId, // <--- USAMOS EL SESSION ID PARA EL 403
            mode: 'relayed',
        });
        state.conn = conn;

        // Eventos
        conn.on('chat', (data) => socket.emit('comment', data));
        conn.on('gift', (data) => socket.emit('gift', data));
        conn.on('like', (data) => socket.emit('like', data));
        conn.on('member', (data) => socket.emit('member', data));
        conn.on('social', (data) => socket.emit('social', data));

        ['disconnected', 'disconnect', 'close', 'streamEnd'].forEach((evt) => {
            conn.on(evt, () => {
                if (state.active) {
                    console.log(`🔌 @${cleanUser} desconectado (${evt}).`);
                    scheduleReconnect();
                }
            });
        });

        conn.connect()
            .then(() => {
                console.log(`✅ ¡CONECTADO! @${cleanUser}`);
                state.attempts = 0;
                socket.emit('status', 'LIVE');
            })
            .catch((err) => {
                const errorMsg = err.message || String(err);
                console.error(`❌ Error en @${cleanUser}:`, errorMsg);
                
                socket.emit('error', errorMsg);
                state.conn = null;

                if (errorMsg.includes('403') || errorMsg.includes('Forbidden')) {
                    console.log(`🛑 Bloqueo 403. Rotando IP...`);
                    socket.emit('status', 'IP_BLOQUEADA');
                } else {
                    scheduleReconnect();
                }
            });
    }

    // Recibimos username y sessionId desde la App
    socket.on('join', (username, sessionId) => {
        state.active = true;
        state.attempts = 0;
        clearRetryTimer();
        connectToTikTok(username, sessionId);
    });

    socket.on('leave', () => {
        state.active = false;
        clearRetryTimer();
        teardownConnection();
    });

    socket.on('disconnect', () => {
        state.active = false;
        clearRetryTimer();
        teardownConnection();
    });
});

process.on('uncaughtException', (err) => console.error('⚠️ Exception:', err));
process.on('unhandledRejection', (reason) => console.error('⚠️ Rejection:', reason));

setInterval(() => {
    const mem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    console.log(`[${new Date().toLocaleTimeString()}] Proxy Online | Memoria: ${mem}MB`);
}, 60000);
