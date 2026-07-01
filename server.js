const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.get('/', (req, res) => res.send('🛡️ ROTTEN PROXY V22.0 - GHOST MODE'));

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('join', (data) => {
        if (!data) return;
        
        // Soporte para SessionID manual para saltar el 404
        // Formato esperado: "usuario" o "usuario:sessionid"
        let username = data.replace('@', '').trim();
        let sessionId = null;

        if (username.includes(':')) {
            const parts = username.split(':');
            username = parts[0].toLowerCase();
            sessionId = parts[1];
            console.log(`🔑 Usando SessionID para @${username}`);
        } else {
            username = username.toLowerCase();
        }

        if (tiktok) { try { tiktok.disconnect(); } catch(e) {} }

        console.log(`🔗 [${new Date().toLocaleTimeString()}] Intentando Bypass 404 en @${username}`);

        try {
            tiktok = new WebcastPushConnection(username, {
                processInitialData: true,
                enableExtendedGiftInfo: true,
                requestPollingIntervalMs: 2000,
                sessionId: sessionId, // Esto mata el 404 si se proporciona
                clientParams: {
                    "app_language": "es-ES",
                    "device_platform": "web",
                    "browser_name": "Mozilla",
                    "browser_platform": "Win32"
                },
                requestOptions: {
                    timeout: 10000,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Accept-Language": "es-ES,es;q=0.9"
                    }
                }
            });

            tiktok.connect().then(state => {
                console.log(`✅ Conectado con éxito: ${username}`);
                socket.emit('connected', { status: "success", roomId: state.roomId });
            }).catch(err => {
                console.error(`❌ Error en @${username}: ${err.message}`);
                // Enviamos el error detallado para saber si es ban de IP
                socket.emit('error', `TikTok: ${err.message}`);
            });

            // Eventos
            tiktok.on('chat', (d) => socket.emit('comment', d));
            tiktok.on('gift', (d) => socket.emit('gift', d));
            tiktok.on('follow', (d) => socket.emit('follow', d));
            tiktok.on('share', (d) => socket.emit('share', d));
            tiktok.on('like', (d) => socket.emit('like', d));
            tiktok.on('social', (d) => socket.emit('social', d));

        } catch (e) {
            console.error("🔥 Error crítico:", e.message);
            socket.emit('error', `Constructor: ${e.message}`);
        }
    });

    socket.on('disconnect', () => {
        if (tiktok) tiktok.disconnect();
    });
});

server.listen(process.env.PORT || 3000, () => {
    console.log('🚀 ROTTEN PROXY V22.0 READY');
});
