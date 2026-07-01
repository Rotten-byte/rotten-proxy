const { WebcastPushConnection } = require('tiktok-live-connector');
const http = require('http');
const { Server } = require('socket.io');

// 1. SERVIDOR HTTP PARA RENDER
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ROTTEN_OK'); // Render lee esto y se pone en verde
});

// 2. CONFIGURACIÓN DE SOCKETS
const io = new Server(server, { cors: { origin: "*" } });

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('join', (data) => {
        const user = typeof data === 'string' ? data : data.username;
        const sid = typeof data === 'object' ? data.sessionId : null;
        
        if (!user) return;
        if (tiktok) tiktok.disconnect();

        tiktok = new WebcastPushConnection(user, {
            processInitialData: true,
            enableExtendedGiftInfo: true,
            sessionId: sid || undefined,
            requestPollingIntervalMs: 2000
        });

        tiktok.connect().then(s => {
            socket.emit('connected', { roomId: s.roomId });
            console.log(`Conectado a ${user}`);
        }).catch(e => {
            socket.emit('error', e.message);
            console.log(`Error: ${e.message}`);
        });

        // Reenvío de eventos a la App
        tiktok.on('chat', (d) => socket.emit('comment', d));
        tiktok.on('gift', (d) => socket.emit('gift', d));
        tiktok.on('like', (d) => socket.emit('like', d));
    });

    socket.on('disconnect', () => { if (tiktok) tiktok.disconnect(); });
});

// 3. ARRANCAR EN EL PUERTO DE RENDER
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Escuchando en puerto ${PORT}`);
});
