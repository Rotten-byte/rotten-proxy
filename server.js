const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// --- EL FIX ESTÁ AQUÍ ---
// En la versión 1.2.2, se importa así:
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('🚀 Proxy TikTok Online'));

io.on('connection', (socket) => {
    let tiktokConnection = null;

    socket.on('join', (username) => {
        if (!username) return;
        const cleanUser = username.replace('@', '').trim().toLowerCase();

        if (tiktokConnection) {
            try { tiktokConnection.disconnect(); } catch(e) {}
        }

        console.log(`🔗 Conectando a @${cleanUser}...`);

        try {
            // Ahora esto funcionará porque WebcastPushConnection ya es la clase correcta
            tiktokConnection = new WebcastPushConnection(cleanUser, {
                processInitialData: true,
                enableExtendedGiftInfo: true,
                requestPollingIntervalMs: 2000
            });

            tiktokConnection.connect().then(state => {
                console.log(`✅ Conectado: ${cleanUser}`);
                // Avisamos a la app que REALMENTE estamos en el live
                socket.emit('connected', { roomId: state.roomId, status: "success" });
            }).catch(err => {
                console.error(`❌ Error TikTok: ${err.message}`);
                socket.emit('error', `TikTok: ${err.message}`);
            });

            // Eventos
            tiktokConnection.on('chat', (data) => socket.emit('comment', data));
            tiktokConnection.on('gift', (data) => socket.emit('gift', data));
            tiktokConnection.on('follow', (data) => socket.emit('follow', data));
            tiktokConnection.on('share', (data) => socket.emit('share', data));
            tiktokConnection.on('like', (data) => socket.emit('like', data));
            tiktokConnection.on('social', (data) => {
                if (data.displayType && data.displayType.includes('repost')) {
                    socket.emit('repost', data);
                }
            });

        } catch (e) {
            console.error("🔥 Error crítico:", e.message);
            socket.emit('error', `Constructor Error: ${e.message}`);
        }
    });

    socket.on('disconnect', () => {
        if (tiktokConnection) tiktokConnection.disconnect();
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Proxy V20.1 corriendo en puerto ${PORT}`);
});
