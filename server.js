const { WebcastPushConnection } = require('tiktok-live-connector');
const io = require('socket.io')(process.env.PORT || 3000, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

console.log("🚀 ROTTEN PROXY V17.0 - TRANSMISIÓN TOTAL ACTIVA");

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('join', (username) => {
        if (!username) return;
        
        // Limpiamos el nombre (quitamos @ y espacios)
        const cleanUser = username.replace('@', '').trim();
        console.log(`🔗 Conectando a @${cleanUser}...`);
        
        if (tiktok) tiktok.disconnect();

        tiktok = new WebcastPushConnection(cleanUser, {
            processInitialData: false,
            enableExtendedGiftInfo: true,
            enableWebsocketUpgrade: true,
            requestPollingIntervalMs: 2000 // Importante para evitar bloqueos
        });

        tiktok.connect().then(state => {
            console.log(`✅ Conectado a @${cleanUser}`);
            socket.emit('status', 'Conectado ✅');
        }).catch(err => {
            console.error("❌ Error:", err.message);
            socket.emit('status', 'Error de conexión');
        });

        // Enviamos DATA COMPLETA para que los filtros del bot funcionen
        tiktok.on('chat', (data) => socket.emit('comment', data));
        tiktok.on('gift', (data) => socket.emit('gift', data));
        tiktok.on('like', (data) => socket.emit('like', data));
        tiktok.on('follow', (data) => socket.emit('follow', data));
        tiktok.on('share', (data) => socket.emit('share', data));
        tiktok.on('social', (data) => socket.emit('social', data));

        tiktok.on('disconnected', () => socket.emit('status', 'Live finalizado'));
        tiktok.on('error', (err) => socket.emit('status', 'Error en el directo'));
    });

    socket.on('disconnect', () => {
        if (tiktok) tiktok.disconnect();
    });
});

setInterval(() => {
    console.log(`[${new Date().toLocaleTimeString()}] Proxy Online...`);
}, 60000);
