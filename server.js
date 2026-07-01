const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TIKTOK = require('tiktok-live-connector');

// Constructor dinámico (Ya verificado en V19.7)
const WebcastPushConnection = TIKTOK.WebcastPushConnection || TIKTOK;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.get('/', (req, res) => res.send('🚀 PROXY V19.8 - SIGNATURE OVERDRIVE'));

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('join', (username) => {
        if (!username) return;
        const user = username.replace('@', '').trim().toLowerCase();
        if (tiktok) { try { tiktok.disconnect(); } catch(e){} }

        console.log(`🔗 Bypass de Firma para: ${user}`);

        try {
            tiktok = new WebcastPushConnection(user, {
                processInitialData: true,
                enableExtendedGiftInfo: true,
                // FORZAMOS PARÁMETROS DE NAVEGADOR MODERNO
                clientParams: {
                    "app_language": "en-US",
                    "device_platform": "web",
                    "browser_name": "Mozilla",
                    "browser_version": "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
                }
            });

            tiktok.connect().then(state => {
                console.log(`✅ CONECTADO A SALA: ${state.roomId}`);
                socket.emit('connected', { status: "success", roomId: state.roomId });
            }).catch(err => {
                console.error("❌ Error Firma 404:", err.message);
                socket.emit('error', `TikTok Signature Error (404)`);
            });

            tiktok.on('chat', (d) => socket.emit('comment', d));
            tiktok.on('gift', (d) => socket.emit('gift', d));
            tiktok.on('social', (d) => {
                if (d.displayType && d.displayType.includes('repost')) socket.emit('repost', d);
            });

        } catch (e) {
            socket.emit('error', `Internal Error: ${e.message}`);
        }
    });

    socket.on('disconnect', () => { if (tiktok) tiktok.disconnect(); });
});

server.listen(process.env.PORT || 3000, () => console.log(`Proxy V19.8 Listo`));
