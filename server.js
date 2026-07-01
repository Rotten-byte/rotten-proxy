const express = require('express');
const http = require('http');const { Server } = require('socket.io');
const TIKTOK_LIB = require('tiktok-live-connector');

const WebcastPushConnection = TIKTOK_LIB.WebcastPushConnection || TIKTOK_LIB;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🚀 PROXY V19.3 - SIGNATURE FIX ACTIVE');
});

io.on('connection', (socket) => {
    let tiktokConnection = null;

    socket.on('join', (username) => {
        if (!username) return;
        const cleanUser = username.replace('@', '').trim().toLowerCase();

        if (tiktokConnection) tiktokConnection.disconnect();

        console.log(`🔗 Intento de firma para @${cleanUser}...`);

        try {
            // CONFIGURACIÓN MÍNIMA: Dejamos que la librería decida los parámetros
            tiktokConnection = new WebcastPushConnection(cleanUser, {
                processInitialData: true,
                enableExtendedGiftInfo: true,
                requestPollingIntervalMs: 2000,
                // NO incluimos clientParams manuales para evitar el error 404 de firma
            });

            tiktokConnection.connect().then(state => {
                console.log(`✅ CONECTADO: ${cleanUser}`);
                socket.emit('connected', { status: "success", roomId: state.roomId });
            }).catch(err => {
                console.error(`❌ Error Firma: ${err.message}`);
                socket.emit('error', `TikTok: ${err.message}`);
            });

            // Eventos básicos
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
            socket.emit('error', "Proxy Internal Error");
        }
    });

    socket.on('disconnect', () => {
        if (tiktokConnection) tiktokConnection.disconnect();
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Proxy V19.3 - Puerto ${PORT} - Signer Auto`);
});
