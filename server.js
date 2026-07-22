const { TikTokLive } = require('@tiktool/live');
const http = require('http');

const PORT = process.env.PORT || 3000;

// Servidor HTTP para Health Check y Socket.io
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

console.log("🚀 ROTTEN PROXY AFK V21.0 - OPTIMIZADO CONTRA 403");

// Diagnóstico de API KEY
if (process.env.TIKTOOL_API_KEY) {
    const k = process.env.TIKTOOL_API_KEY;
    console.log(`🔑 TIKTOOL_API_KEY detectada: ${k.slice(0, 8)}...${k.slice(-4)}`);
} else {
    console.log("⚠️ TIKTOOL_API_KEY NO DEFINIDA");
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
        state.retryTimer = setTimeout(() => connectToTikTok(state.username), delay);
    }

    function connectToTikTok(username) {
        if (!state.active) return;
        teardownConnection();

        const cleanUser = username.replace('@', '').trim();
        state.username = cleanUser;

        console.log(`🔗 Intentando conectar a @${cleanUser}...`);

        const conn = new TikTokLive({
            uniqueId: cleanUser,
            apiKey: process.env.TIKTOOL_API_KEY,
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
                    console.log(`🔌 @${cleanUser} desconectado (evento: ${evt}).`);
                    scheduleReconnect();
                }
            });
        });

        conn.connect()
            .then(() => {
                console.log(`✅ ¡ÉXITO! @${cleanUser} conectado.`);
                state.attempts = 0;
                socket.emit('status', 'LIVE');
            })
            .catch((err) => {
                const errorMsg = err.message || String(err);
                console.error(`❌ Error en @${cleanUser}:`, errorMsg);
                
                socket.emit('error', errorMsg);
                state.conn = null;

                // --- MEJORA CRÍTICA: DETECCIÓN DE 403 ---
                if (errorMsg.includes('403') || errorMsg.includes('Forbidden')) {
                    console.log(`🛑 Bloqueo 403 detectado. Deteniendo reintentos para enfriar IP.`);
                    socket.emit('status', 'IP_BLOQUEADA');
                    // NO llamamos a scheduleReconnect para que la App decida rotar el proxy
                } else {
                    scheduleReconnect();
                }
            });
    }

    socket.on('join', (username) => {
        state.active = true;
        state.attempts = 0;
        clearRetryTimer();
        connectToTikTok(username);
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
