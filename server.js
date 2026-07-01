const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector'); // Importación limpia v1.x

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.get('/', (req, res) => res.send('🚀 PROXY V20.0 - BYPASS ACTIVE'));

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('join', (username) => {
        if (!username) return;
        const user = username.replace('@', '').trim().toLowerCase();
        
        if (tiktok) {
            tiktok.disconnect();
            tiktok = null;
        }

        console.log(`🔗 Shadow Connection: ${user}`);

        try {
            // CONFIGURACIÓN MÍNIMA ABSOLUTA
            // No enviamos clientParams ni headers manuales para evitar conflicto de firmas
            tiktok = new WebcastPushConnection(user);

            tiktok.connect().then(state => {
                console.log(`✅ CONECTADO: ${state.roomId}`);
                socket.emit('connected', { status: "success", roomId: state.roomId });
            }).catch(err => {
                console.error("❌ Error Firma:", err.message);
                // Si da 404, enviamos el error exacto para que la App rote
                socket.emit('error', `TikTok: ${err.message}`);
            });

            // Reenvío de eventos
            tiktok.on('chat', (d) => socket.emit('comment', d));
            tiktok.on('gift', (d) => socket.emit('gift', d));
            tiktok.on('social', (d) => {
                if (d.displayType && d.displayType.includes('repost')) {
                    socket.emit('repost', d);
                }
            });

        } catch (e) {
            console.error("🔥 Crash:", e.message);
            socket.emit('error', `Internal Error: ${e.message}`);
        }
    });

    socket.on('disconnect', () => {
        if (tiktok) tiktok.disconnect();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Proxy V20.0 - Puerto ${PORT}`));
