const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TIKTOK_LIB = require('tiktok-live-connector');

// --- FIX DE CONSTRUCTOR PARA v1.x.x ---
const WebcastPushConnection = TIKTOK_LIB.WebcastPushConnection || TIKTOK_LIB;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

// Endpoint para que Render mantenga el servicio vivo
app.get('/', (req, res) => {
    res.send('🚀 ROTTEN PROXY V19.2 - SISTEMA DE FIRMAS OK');
});

io.on('connection', (socket) => {
    let tiktokConnection = null;

    console.log(`📡 Cliente conectado: ${socket.id}`);

    socket.on('join', (username) => {
        if (!username) return;
        const cleanUser = username.replace('@', '').trim().toLowerCase();

        if (tiktokConnection) tiktokConnection.disconnect();

        console.log(`🔗 Conectando a @${cleanUser} (Mode: en-US)...`);

        try {
            tiktokConnection = new WebcastPushConnection(cleanUser, {
                processInitialData: true,
                enableExtendedGiftInfo: true,
                requestPollingIntervalMs: 2000,
                clientParams: {
                    "app_language": "en-US", // FIX 404: en-US es más estable para firmas
                    "device_platform": "web"
                }
            });

            tiktokConnection.connect().then(state => {
                console.log(`✅ LIVE: ${cleanUser}`);
                socket.emit('connected', { status: "success", roomId: state.roomId });
            }).catch(err => {
                console.error(`❌ Error TikTok: ${err.message}`);
                socket.emit('error', `TikTok: ${err.message}`);
            });

            // --- EVENTOS ---
            tiktokConnection.on('chat', (data) => socket.emit('comment', data));
            tiktokConnection.on('gift', (data) => socket.emit('gift', data));
            tiktokConnection.on('follow', (data) => socket.emit('follow', data));
            tiktokConnection.on('share', (data) => socket.emit('share', data));
            tiktokConnection.on('like', (data) => socket.emit('like', data));

            // --- REPOSTS & SOCIAL ---
            tiktokConnection.on('social', (data) => {
                socket.emit('social', data);
                if (data.displayType && data.displayType.includes('repost')) {
                    console.log(`🔁 Repost de: ${data.uniqueId}`);
                    socket.emit('repost', data);
                }
            });

            tiktokConnection.on('error', (err) => {
                socket.emit('error', `Stream Error: ${err.message}`);
            });

        } catch (e) {
            console.error("🔥 Crash Prevented:", e.message);
            socket.emit('error', "Internal Proxy Error");
        }
    });

    socket.on('disconnect', () => {
        if (tiktokConnection) tiktokConnection.disconnect();
        console.log(`❌ Cliente desconectado`);
    });
});

server.listen(PORT, () => {
    console.log(`
    🚀 ROTTEN PROXY V19.2
    ---------------------
    Puerto: ${PORT}
    Idioma: en-US (Firma Estable)
    Reposts: Activados
    `);
});
