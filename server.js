const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const TIKTOK_LIB = require('tiktok-live-connector');

const WebcastPushConnection = TIKTOK_LIB.WebcastPushConnection || TIKTOK_LIB;

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('🚀 PROXY V19.4 - CAMUFLAJE ACTIVO'));

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('join', (username) => {
        if (!username) return;
        const user = username.replace('@', '').trim().toLowerCase();
        if (tiktok) tiktok.disconnect();

        console.log(`🔗 Intentando camuflaje para @${user}...`);

        try {
            tiktok = new WebcastPushConnection(user, {
                processInitialData: true,
                enableExtendedGiftInfo: true,
                requestPollingIntervalMs: 3000, // Más lento para no despertar sospechas
                requestOptions: {
                    headers: {
                        // User-Agent real de Windows 10 / Chrome
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
                    }
                }
            });

            tiktok.connect().then(state => {
                console.log(`✅ ÉXITO: @${user} conectado.`);
                socket.emit('connected', { status: "success", roomId: state.roomId });
            }).catch(err => {
                console.error(`❌ Error Firma: ${err.message}`);
                socket.emit('error', `TikTok: ${err.message}`);
            });

            // Re-enviar eventos a la App
            tiktok.on('chat', (d) => socket.emit('comment', d));
            tiktok.on('gift', (d) => socket.emit('gift', d));
            tiktok.on('follow', (d) => socket.emit('follow', d));
            tiktok.on('share', (d) => socket.emit('share', d));
            tiktok.on('like', (d) => socket.emit('like', d));
            tiktok.on('social', (d) => {
                socket.emit('social', d);
                if (d.displayType && d.displayType.includes('repost')) socket.emit('repost', d);
            });

        } catch (e) {
            socket.emit('error', "Internal Proxy Error");
        }
    });

    socket.on('disconnect', () => { if (tiktok) tiktok.disconnect(); });
});

server.listen(PORT, () => console.log(`Proxy V19.4 en puerto ${PORT}`));
