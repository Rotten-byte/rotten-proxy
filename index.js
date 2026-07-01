const { WebcastPushConnection } = require('tiktok-live-connector');
const http = require('http');
const { Server } = require('socket.io');

// ESTO EVITA EL "FAILED SERVICE": Crea un servidor que responde a Render
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ROTTEN PROXY ONLINE');
});

const io = new Server(server, {
    cors: { origin: "*" }
});

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
            sessionId: sid || undefined, // Evita errores 404
            requestPollingIntervalMs: 2000
        });

        tiktok.connect()
            .then(s => {
                socket.emit('connected', { roomId: s.roomId });
                socket.emit('log', `Conectado a @${user}`);
            })
            .catch(e => socket.emit('error', e.message));

        // Eventos
        tiktok.on('chat', (d) => socket.emit('comment', d));
        tiktok.on('gift', (d) => socket.emit('gift', d));
        tiktok.on('like', (d) => socket.emit('like', d));
        tiktok.on('follow', (d) => socket.emit('follow', d));
        tiktok.on('share', (d) => socket.emit('share', d));
    });

    socket.on('disconnect', () => { if (tiktok) tiktok.disconnect(); });
});

// USAR EL PUERTO DE RENDER
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor en puerto ${PORT}`);
});