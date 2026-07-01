const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// --- EL FIX CRÍTICO ESTÁ AQUÍ ---
// En la versión 1.2.2+, el constructor debe extraerse así:
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

console.log("🚀 ROTTEN PROXY V20.2 - MODO ANTIBAN PRO ACTIVO");

// Endpoint de salud para Render
app.get('/', (req, res) => res.send('🚀 Proxy TikTok Online'));

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('join', (username) => {
        if (!username) return;
        
        const cleanUser = username.replace('@', '').trim().toLowerCase();
        console.log(`🔗 [${new Date().toLocaleTimeString()}] Intentando conectar a @${cleanUser}...`);
        
        // Limpiar conexión previa
        if (tiktok) {
            try { tiktok.disconnect(); } catch(e) {}
            tiktok = null;
        }

        try {
            // Instancia el conector (Ahora NO dará error de constructor)
            tiktok = new WebcastPushConnection(cleanUser, {
                processInitialData: true,
                enableExtendedGiftInfo: true,
                requestPollingIntervalMs: 2000
            });

            tiktok.connect().then(state => {
                console.log(`✅ ¡ÉXITO! Conectado a @${cleanUser}`);
                // Avisamos a la App Android que la conexión es real
                socket.emit('connected', { roomId: state.roomId, status: "success" });
            }).catch(err => {
                console.error(`❌ Error en @${cleanUser}:`, err.message);
                socket.emit('error', `TikTok: ${err.message}`);
            });

            // Reenvío de eventos a la App
            tiktok.on('chat', (data) => socket.emit('comment', data));
            tiktok.on('gift', (data) => socket.emit('gift', data));
            tiktok.on('follow', (data) => socket.emit('follow', data));
            tiktok.on('share', (data) => socket.emit('share', data));
            tiktok.on('like', (data) => socket.emit('like', data));
            
            tiktok.on('social', (data) => {
                socket.emit('social', data);
                if (data.displayType && data.displayType.includes('repost')) {
                    socket.emit('repost', data);
                }
            });

            tiktok.on('error', (err) => {
                console.error("⚠️ Stream Error:", err.message);
                socket.emit('error', `Stream Error: ${err.message}`);
            });

        } catch (e) {
            console.error("🔥 Error fatal:", e.message);
            socket.emit('error', `Proxy-Error: ${e.message}`);
        }
    });

    socket.on('disconnect', () => {
        if (tiktok) tiktok.disconnect();
    });
});

// Logs de monitoreo cada minuto (Como el original)
setInterval(() => {
    const mem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    console.log(`[${new Date().toLocaleTimeString()}] Proxy Online | Memoria: ${mem}MB`);
}, 60000);

server.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
