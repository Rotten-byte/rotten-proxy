const express = require('express');
const { WebcastPushConnection } = require('tiktok-live-connector'); // Importación estándar v1.x
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('🚀 PROXY V19.6 - READY'));

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('join', (username) => {
        if (!username) return;
        const user = username.replace('@', '').trim().toLowerCase();
        
        if (tiktok) {
            tiktok.disconnect();
            tiktok = null;
        }

        console.log(`🔗 Conectando a: ${user}`);

        try {
            // Usamos el constructor estándar sin parámetros extra que causan el 404
            tiktok = new WebcastPushConnection(user);

            tiktok.connect().then(state => {
                console.log(`✅ Conectado a ${state.roomId}`);
                socket.emit('connected', { status: "success", roomId: state.roomId });
            }).catch(err => {
                console.error("❌ Error de TikTok:", err.message);
                socket.emit('error', `TikTok: ${err.message}`);
            });

            // Eventos mínimos necesarios
            tiktok.on('chat', (d) => socket.emit('comment', d));
            tiktok.on('gift', (d) => socket.emit('gift', d));
            tiktok.on('social', (d) => {
                if (d.displayType && d.displayType.includes('repost')) socket.emit('repost', d);
            });

        } catch (e) {
            console.error("🔥 Error Constructor:", e.message);
            socket.emit('error', `Constructor Error: ${e.message}`);
        }
    });

    socket.on('disconnect', () => {
        if (tiktok) tiktok.disconnect();
    });
});

server.listen(PORT, () => console.log(`Proxy V19.6 activo en puerto ${PORT}`));
