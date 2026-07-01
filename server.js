const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// --- IMPORTACIÓN DINÁMICA DE TIKTOK ---
const TIKTOK_LIB = require('tiktok-live-connector');

// Esta lógica detecta el constructor en cualquier versión (v0.x o v1.x)
let WebcastPushConnection;
if (TIKTOK_LIB.WebcastPushConnection) {
    WebcastPushConnection = TIKTOK_LIB.WebcastPushConnection;
} else if (typeof TIKTOK_LIB === 'function') {
    WebcastPushConnection = TIKTOK_LIB;
} else {
    // Si la librería se importó como un módulo ESM en CommonJS
    WebcastPushConnection = TIKTOK_LIB.default ? TIKTOK_LIB.default.WebcastPushConnection : TIKTOK_LIB;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('🚀 ROTTEN PROXY V19.7 - CONSTRUCTOR FIXED'));

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('join', (username) => {
        if (!username) return;
        const user = username.replace('@', '').trim().toLowerCase();
        
        if (tiktok) {
            try { tiktok.disconnect(); } catch(e){}
            tiktok = null;
        }

        console.log(`🔗 Conectando a: ${user}`);

        try {
            // Verificación de seguridad antes de instanciar
            if (typeof WebcastPushConnection !== 'function') {
                throw new Error("El constructor de TikTok no es una función. Revisa la versión de la librería.");
            }

            tiktok = new WebcastPushConnection(user, {
                processInitialData: true,
                enableExtendedGiftInfo: true,
                requestPollingIntervalMs: 2000
            });

            tiktok.connect().then(state => {
                console.log(`✅ Conectado a Sala ID: ${state.roomId}`);
                socket.emit('connected', { status: "success", roomId: state.roomId });
            }).catch(err => {
                console.error("❌ Error TikTok:", err.message);
                socket.emit('error', `TikTok: ${err.message}`);
            });

            tiktok.on('chat', (d) => socket.emit('comment', d));
            tiktok.on('gift', (d) => socket.emit('gift', d));
            tiktok.on('social', (d) => {
                if (d.displayType && d.displayType.includes('repost')) {
                    socket.emit('repost', d);
                }
            });

        } catch (e) {
            console.error("🔥 Error crítico:", e.message);
            socket.emit('error', `Proxy-Internal-Error: ${e.message}`);
        }
    });

    socket.on('disconnect', () => {
        if (tiktok) tiktok.disconnect();
    });
});

server.listen(PORT, () => {
    console.log(`
    🚀 PROXY V19.7 - MODO ESTABLE
    ----------------------------
    Constructor detectado: ${typeof WebcastPushConnection === 'function' ? 'OK ✅' : 'ERROR ❌'}
    `);
});
