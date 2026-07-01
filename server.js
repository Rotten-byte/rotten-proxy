const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// --- DETECCIÓN UNIVERSAL DEL CONSTRUCTOR ---
const TIKTOK_LIB = require('tiktok-live-connector');
let WebcastPushConnection;

try {
    if (typeof TIKTOK_LIB.WebcastPushConnection === 'function') {
        WebcastPushConnection = TIKTOK_LIB.WebcastPushConnection;
    } else if (typeof TIKTOK_LIB === 'function') {
        WebcastPushConnection = TIKTOK_LIB;
    } else if (TIKTOK_LIB.default && typeof TIKTOK_LIB.default.WebcastPushConnection === 'function') {
        WebcastPushConnection = TIKTOK_LIB.default.WebcastPushConnection;
    } else {
        WebcastPushConnection = TIKTOK_LIB.WebcastPushConnection || TIKTOK_LIB;
    }
} catch (e) {
    console.error("Error identificando el constructor:", e);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.get('/', (req, res) => res.send('🚀 PROXY V19.9 - UNIVERSAL FIX ACTIVE'));

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('join', (username) => {
        if (!username) return;
        const user = username.replace('@', '').trim().toLowerCase();
        if (tiktok) { try { tiktok.disconnect(); } catch(e){} }

        console.log(`🔗 Intentando conectar a: ${user}`);

        try {
            // Verificación final antes de instanciar
            if (typeof WebcastPushConnection !== 'function') {
                throw new Error("Constructor no encontrado");
            }

            tiktok = new WebcastPushConnection(user, {
                processInitialData: true,
                enableExtendedGiftInfo: true,
                requestPollingIntervalMs: 2000,
                clientParams: {
                    "app_language": "en-US",
                    "device_platform": "web"
                }
            });

            tiktok.connect().then(state => {
                console.log(`✅ LIVE: ${user} (ID: ${state.roomId})`);
                socket.emit('connected', { status: "success", roomId: state.roomId });
            }).catch(err => {
                console.error("❌ Error TikTok:", err.message);
                socket.emit('error', `TikTok: ${err.message}`);
            });

            // Eventos
            tiktok.on('chat', (d) => socket.emit('comment', d));
            tiktok.on('gift', (d) => socket.emit('gift', d));
            tiktok.on('social', (d) => {
                if (d.displayType && d.displayType.includes('repost')) socket.emit('repost', d);
            });

        } catch (e) {
            console.error("🔥 Error crítico:", e.message);
            socket.emit('error', `Proxy-Error: ${e.message}`);
        }
    });

    socket.on('disconnect', () => { if (tiktok) tiktok.disconnect(); });
});

server.listen(process.env.PORT || 3000, () => {
    console.log(`🚀 V19.9 - Constructor: ${typeof WebcastPushConnection}`);
});
