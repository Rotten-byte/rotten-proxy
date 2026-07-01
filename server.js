const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TIKTOK = require('tiktok-live-connector');

// --- IMPORTACIÓN RESILIENTE ---
// Detecta si la librería usa exportación nombrada o directa
const WebcastPushConnection = TIKTOK.WebcastPushConnection || TIKTOK;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('🚀 PROXY V19.6 - STABLE'));

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('join', (username) => {
        if (!username) return;
        const user = username.replace('@', '').trim().toLowerCase();
        
        if (tiktok) tiktok.disconnect();

        console.log(`🔗 Intentando conectar a: ${user}`);

        try {
            // Constructor ultra-limpio para evitar errores de tipo
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
                // Enviamos el mensaje real para que Android decida si rotar
                socket.emit('error', `TikTok: ${err.message}`);
            });

            // Eventos para la App
            tiktok.on('chat', (d) => socket.emit('comment', d));
            tiktok.on('gift', (d) => socket.emit('gift', d));
            tiktok.on('social', (d) => {
                if (d.displayType && d.displayType.includes('repost')) {
                    socket.emit('repost', d);
                }
            });

        } catch (e) {
            console.error("🔥 Error en constructor:", e.message);
            socket.emit('error', `Proxy-Internal-Error: ${e.message}`);
        }
    });

    socket.on('disconnect', () => {
        if (tiktok) tiktok.disconnect();
    });
});

server.listen(PORT, () => console.log(`Proxy V19.6 activo en puerto ${PORT}`));
