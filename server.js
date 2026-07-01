const tiktokLib = require('tiktok-live-connector');
const WebcastPushConnection = tiktokLib.WebcastPushConnection;
const http = require('http');

const PORT = process.env.PORT || 3000;

// Un solo servidor HTTP: responde "OK" a peticiones normales (para el health check
// externo que evita que Render duerma el servicio) y socket.io se monta encima.
const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK - Rotten Proxy corriendo');
});

const io = require('socket.io')(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

httpServer.listen(PORT, () => {
    console.log(`🌐 Servidor escuchando en puerto ${PORT}`);
});

console.log("🚀 ROTTEN PROXY V20.0 - MODO ANTIBAN + AUTO-RECONEXIÓN");

// --- Diagnóstico: confirma si la env var realmente llegó (sin exponer la key completa) ---
if (process.env.EULER_API_KEY) {
    const k = process.env.EULER_API_KEY;
    console.log(`🔑 EULER_API_KEY detectada: ${k.slice(0, 8)}...${k.slice(-4)} (${k.length} caracteres)`);
} else {
    console.log("⚠️ EULER_API_KEY NO está definida en este proceso. El signing va a fallar.");
}

// --- Config de reconexión (mismo espíritu que RECONNECT_SECONDS del bot Python) ---
const RECONNECT_BASE_MS = 6000;      // primer intento a los 6s (igual que Python)
const RECONNECT_MAX_MS = 30000;      // techo de backoff para no martillar a TikTok
const RECONNECT_MAX_ATTEMPTS = 0;    // 0 = infinito, igual que el "while self.running" de Python

const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

function randomUA() {
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function backoffDelay(attempt) {
    // 6s, 12s, 24s, 30s, 30s... (equivalente al sleep(RECONNECT_SECONDS) pero creciente)
    const delay = RECONNECT_BASE_MS * Math.pow(2, Math.min(attempt, 3));
    return Math.min(delay, RECONNECT_MAX_MS);
}

io.on('connection', (socket) => {
    // Estado propio de esta conexión de socket (equivalente a self.client / self.running del bot)
    const state = {
        conn: null,          // instancia actual de WebcastPushConnection
        username: null,
        active: false,       // true mientras el usuario quiera estar conectado (igual a self.running)
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
            try {
                state.conn.disconnect();
            } catch (_) {
                // ignoramos, igual que el except Exception: pass del bot
            }
            state.conn = null;
        }
    }

    function scheduleReconnect() {
        if (!state.active) return; // el usuario ya se fue, no reintentamos
        if (RECONNECT_MAX_ATTEMPTS > 0 && state.attempts >= RECONNECT_MAX_ATTEMPTS) {
            socket.emit('status', 'GIVING_UP');
            console.log(`🛑 [${state.username}] máximo de reintentos alcanzado.`);
            return;
        }
        const delay = backoffDelay(state.attempts);
        state.attempts += 1;
        console.log(`⏳ [${state.username}] reconectando en ${delay / 1000}s (intento ${state.attempts})...`);
        socket.emit('status', 'RECONNECTING');
        clearRetryTimer();
        state.retryTimer = setTimeout(() => connectToTikTok(state.username), delay);
    }

    function connectToTikTok(username) {
        if (!state.active) return;

        teardownConnection();

        const cleanUser = username.replace('@', '').trim();
        state.username = cleanUser;

        console.log(`🔗 [${new Date().toLocaleTimeString()}] Intentando conectar a @${cleanUser}...`);

        const conn = new WebcastPushConnection(cleanUser, {
            signApiKey: process.env.EULER_API_KEY, // sacala gratis en eulerstream.com
            processInitialData: false,
            enableExtendedGiftInfo: true,
            enableWebsocketUpgrade: true,
            requestPollingIntervalMs: 2500,
            clientParams: {
                "app_language": "es-ES",
                "device_platform": "web",
                "browser_name": "Mozilla",
                "browser_platform": "Win32"
            },
            requestOptions: {
                headers: { 'User-Agent': randomUA() }
            }
        });
        state.conn = conn;

        // Reenvío de eventos a la App Android
        conn.on('chat', (data) => socket.emit('comment', data));
        conn.on('gift', (data) => socket.emit('gift', data));
        conn.on('like', (data) => socket.emit('like', data));
        conn.on('follow', (data) => socket.emit('follow', data));
        conn.on('share', (data) => socket.emit('share', data));
        conn.on('social', (data) => socket.emit('social', data));

        conn.on('disconnected', () => {
            console.log(`🔌 @${cleanUser} se desconectó del proxy.`);
            socket.emit('disconnected', 'Stream finalizado');
            state.conn = null;
            scheduleReconnect(); // <-- esto es lo que faltaba: reintentar en vez de morir
        });

        conn.on('streamEnd', () => {
            console.log(`🎬 El stream de @${cleanUser} terminó.`);
            socket.emit('streamEnd');
            // Si el streamer cortó el live, no tiene sentido reintentar cada 6s.
            // Igual dejamos el intento programado pero con backoff más largo.
            scheduleReconnect();
        });

        conn.connect()
            .then((stateInfo) => {
                console.log(`✅ ¡ÉXITO! Conectado a @${cleanUser} (RoomId: ${stateInfo.roomId})`);
                state.attempts = 0; // se resetea el backoff al conectar bien, igual que reconnect_attempt en Python
                socket.emit('connected', { roomId: stateInfo.roomId });
                socket.emit('status', 'LIVE');
            })
            .catch((err) => {
                console.error(`❌ Error en @${cleanUser}:`, err.message);
                socket.emit('error', err.message);
                state.conn = null;
                scheduleReconnect(); // <-- antes esto no pasaba, el bot se quedaba muerto
            });
    }

    socket.on('join', (username) => {
        if (!username) return;
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

// --- Protección contra crashes del proceso completo ---
// Igual que el "except Exception" amplio del bot: logueamos y seguimos vivos
// en vez de dejar que Render reinicie el proceso (y tumbe TODAS las conexiones activas).
process.on('uncaughtException', (err) => {
    console.error('⚠️ uncaughtException (proceso sigue vivo):', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('⚠️ unhandledRejection (proceso sigue vivo):', reason);
});

setInterval(() => {
    const mem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    console.log(`[${new Date().toLocaleTimeString()}] Proxy Online | Memoria: ${mem}MB`);
}, 60000);
