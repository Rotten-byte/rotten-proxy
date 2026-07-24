const { TikTokLive } = require('@tiktool/live');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const httpServer = http.createServer(app);

// 1. RUTA DE SALUD (Crítico para que Railway no mate el servidor)
app.get('/', (req, res) => {
    res.status(200).send('OK - Rotten Proxy AFK is running');
});

// 2. CONFIGURACIÓN DE SOCKET.IO
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// 3. GESTIÓN DE API KEYS (Priorizando variables de Railway)
function getApiKey() {
    const keys = [
        process.env.TIKTOOL_API_KEY,
        process.env.TIKTOOL_API_KEY2
    ].filter(k => k && k.trim().length > 10);
    
    if (keys.length === 0) return null;
    return keys[Math.floor(Math.random() * keys.length)].trim();
}

console.log("🚀 ROTTEN PROXY AFK V24.0 - SISTEMA INICIADO");

io.on('connection', (socket) => {
    const state = { 
        conn: null, 
        username: null, 
        sessionId: null, 
        active: false, 
        attempts: 0, 
        retryTimer: null 
    };

    console.log("✅ Nueva conexión desde la App");

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
            console.error("❌ ERROR: No hay TIKTOOL_API_KEY en las variables de Railway");
            socket.emit('error', 'No API Key configured on Railway');
            return;
        }

        console.log(`🔗 [${cleanUser}] Conectando con API Key: ${apiKey.substring(0,5)}***`);

        try {
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
                conn.on(evt, () => { 
                    console.log(`⚠️ Evento ${evt} en @${cleanUser}`);
                    if (state.active) scheduleReconnect(); 
                });
            });

            conn.connect()
                .then(() => {
                    console.log(`✅ ¡CONECTADO EXITOSAMENTE! @${cleanUser}`);
                    state.attempts = 0;
                    socket.emit('connected'); 
                })
                .catch((err) => {
                    const errorMsg = err.message || String(err);
                    console.error(`❌ Error en conexión TikTok para @${cleanUser}:`, errorMsg);
                    socket.emit('error', errorMsg);
                    scheduleReconnect();
                });
        } catch (e) {
            console.error("💥 Error fatal creando instancia TikTool:", e);
        }
    }

    socket.on('join', (username, sessionId) => {
        console.log(`📥 Solicitud JOIN para: ${username}`);
        state.active = true;
        state.attempts = 0;
        clearRetryTimer();
        connectToTikTok(username, sessionId);
    });

    socket.on('leave', () => {
        console.log("📤 Solicitud LEAVE");
        state.active = false; 
        clearRetryTimer(); 
        teardownConnection();
    });

    socket.on('disconnect', () => {
        console.log("❌ App desconectada");
        state.active = false; 
        clearRetryTimer(); 
        teardownConnection();
    });
});

// 4. ESCUCHA EN 0.0.0.0 (Crucial para Railway)
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`
    -------------------------------------------
    🌐 SERVIDOR PRIVADO ROTTEN AFK
    📍 Puerto: ${PORT}
    🚀 Estado: LISTO
    -------------------------------------------
    `);
});

// 5. MANEJO DE ERRORES PARA EVITAR CRASH
process.on('uncaughtException', (err) => console.error('⚠️ Exception Crítica:', err));
process.on('unhandledRejection', (reason) => console.error('⚠️ Rejection No Manejada:', reason));
