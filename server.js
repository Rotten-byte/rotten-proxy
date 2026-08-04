const { TikTokLive } = require('@tiktool/live');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const httpServer = http.createServer(app);

// 1. RUTA DE SALUD (Crítico para Railway)
app.get('/', (req, res) => {
    res.status(200).send('OK - Rotten Proxy AFK is running');
});

const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

function getApiKey() {
    const keys = [
        process.env.TIKTOOL_API_KEY,
        process.env.TIKTOOL_API_KEY2
    ].filter(k => k && k.trim().length > 10);
    return keys.length === 0 ? null : keys[Math.floor(Math.random() * keys.length)].trim();
}

io.on('connection', (socket) => {
    const state = { conn: null, username: null, active: false };
    console.log("✅ Nueva conexión desde la App");

    function connectToTikTok(username, sessionId) {
        if (!state.active) return;
        
        // Desconexión segura de una instancia previa si existe
        if (state.conn) {
            try { state.conn.disconnect(); } catch(e) {}
        }

        const apiKey = getApiKey();
        if (!apiKey) {
            socket.emit('error', 'No API Key en Railway');
            return;
        }

        try {
            const conn = new TikTokLive({
                uniqueId: username.replace('@', '').trim(),
                apiKey: apiKey,
                sessionId: sessionId,
                mode: 'relayed',
            });
            state.conn = conn;

            // Reenvío de eventos
            conn.on('chat', (data) => socket.emit('comment', data));
            conn.on('gift', (data) => socket.emit('gift', data));
            conn.on('like', (data) => socket.emit('like', data));
            conn.on('follow', (data) => socket.emit('follow', data));
            conn.on('share', (data) => socket.emit('share', data));

            // DETECCIÓN DE EVENTOS DE CIERRE
            ['disconnected', 'close', 'streamEnd'].forEach((evt) => {
                conn.on(evt, () => { 
                    console.log(`⚠️ Evento ${evt} en @${username}`);
                    socket.emit('error', 'TikTok Connection Lost'); 
                });
            });

            conn.connect()
                .then(() => socket.emit('connected'))
                .catch((err) => {
                    console.error("Error en conn.connect():", err.message);
                    socket.emit('error', err.message || 'Error de conexión');
                });

        } catch (e) { 
            console.error("Error al inicializar TikTokLive:", e); 
        }
    }

    socket.on('join', (username, sessionId) => {
        state.active = true;
        connectToTikTok(username, sessionId);
    });

    // CORRECCIÓN CRÍTICA AQUÍ:
    socket.on('disconnect', () => {
        console.log("❌ App desconectada, cerrando socket de TikTok...");
        state.active = false;
        if (state.conn) {
            try {
                // El try-catch evita que el server se caiga si el WebSocket 
                // se cierra antes de estar totalmente establecido.
                state.conn.disconnect();
            } catch (e) {
                console.log("⚠️ Aviso: Error controlado al desconectar (WebSocket no estaba listo).");
            }
            state.conn = null;
        }
    });
});

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor Privado en puerto ${PORT}`);
});
