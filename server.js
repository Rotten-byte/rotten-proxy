const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TIKTOK_LIB = require('tiktok-live-connector');

const WebcastPushConnection = TIKTOK_LIB.WebcastPushConnection || TIKTOK_LIB;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('🚀 PROXY V19.5 - BYPASS ACTIVE'));

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('join', (username) => {
        if (!username) return;
        const user = username.replace('@', '').trim().toLowerCase();
        if (tiktok) tiktok.disconnect();

        console.log(`📡 Intentando bypass para @${user}...`);

        try {
            tiktok = new WebcastPushConnection(user, {
                processInitialData: true,
                enableExtendedGiftInfo: true,
                requestPollingIntervalMs: 2000,
                // --- CONFIGURACIÓN DE BYPASS ---
                clientParams: {
                    "app_language": "en-US",
                    "device_platform": "web",
                    "browser_name": "Mozilla",
                    "browser_version": "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
                },
                requestOptions: {
                    timeout: 10000,
                    headers: {
                        'Referer': 'https://www.tiktok.com/',
                        'Origin': 'https://www.tiktok.com/',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
                    }
                }
            });

            tiktok.connect().then(state => {
                console.log(`✅ CONECTADO: ${user}`);
                socket.emit('connected', { status: "success", roomId: state.roomId });
            }).catch(err => {
                console.error(`❌ Fallo de Firma: ${err.message}`);
                // Enviamos error amigable para activar la rotación en Android
                socket.emit('error', `TikTok: ${err.message}`);
            });

            // Eventos
            tiktok.on('chat', (d) => socket.emit('comment', d));
            tiktok.on('gift', (d) => socket.emit('gift', d));
            tiktok.on('social', (d) => {
                if (d.displayType && d.displayType.includes('repost')) socket.emit('repost', d);
            });

        } catch (e) {
            socket.emit('error', "Proxy Error");
        }
    });

    socket.on('disconnect', () => { if (tiktok) tiktok.disconnect(); });
});

server.listen(PORT, () => console.log(`Proxy V19.5 listo`));
