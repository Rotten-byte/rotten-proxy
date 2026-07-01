const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const TIKTOK_LIB = require('tiktok-live-connector');

// Constructor Multi-Versión
const WebcastPushConnection = TIKTOK_LIB.WebcastPushConnection || TIKTOK_LIB;

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.get('/', (req, res) => res.send('🛡️ ROTTEN PROXY V21 - ONLINE'));

io.on('connection', (socket) => {
    let tiktok = null;
    let heartbeat = null;

    socket.on('join', (username) => {
        if (!username) return;
        const user = username.replace('@', '').trim().toLowerCase();
        
        if (tiktok) tiktok.disconnect();
        clearInterval(heartbeat);

        console.log(`🔗 [${new Date().toLocaleTimeString()}] Conectando a @${user}`);

        try {
            tiktok = new WebcastPushConnection(user, {
                processInitialData: true,
                enableExtendedGiftInfo: true,
                requestPollingIntervalMs: 2000,
                clientParams: { "app_language": "en-US", "device_platform": "web" }
            });

            tiktok.connect().then(state => {
                socket.emit('connected', { status: "success", roomId: state.roomId });
                console.log(`✅ @${user} - Conectado`);
                
                // Heartbeat para mantener la conexión Socket.io viva
                heartbeat = setInterval(() => {
                    socket.emit('proxy_heartbeat', { uptime: process.uptime() });
                }, 10000);

            }).catch(err => {
                socket.emit('error', `TikTok: ${err.message}`);
                console.error(`❌ Error TikTok: ${err.message}`);
            });

            // Reenvío de eventos
            tiktok.on('chat', (d) => socket.emit('comment', d));
            tiktok.on('gift', (d) => socket.emit('gift', d));
            tiktok.on('follow', (d) => socket.emit('follow', d));
            tiktok.on('share', (d) => socket.emit('share', d));
            tiktok.on('like', (d) => socket.emit('like', d));
            tiktok.on('social', (d) => {
                socket.emit('social', d);
                if (d.displayType?.includes('repost')) socket.emit('repost', d);
            });

        } catch (e) {
            socket.emit('error', `Constructor Error: ${e.message}`);
        }
    });

    socket.on('disconnect', () => {
        if (tiktok) tiktok.disconnect();
        clearInterval(heartbeat);
    });
});

server.listen(process.env.PORT || 3000, () => console.log('🚀 Proxy V21 Ready'));
