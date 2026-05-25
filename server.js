const { WebcastPushConnection } = require('tiktok-live-connector');
const io = require('socket.io')(process.env.PORT || 3000, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

console.log("🚀 ROTTEN PROXY V19.0 - MODO RESILIENTE");

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('join', (username) => {
        if (!username) return;
        const cleanUser = username.replace('@', '').trim();
        
        if (tiktok) tiktok.disconnect();

        // CAMBIOS VITALES: Desactivamos WebsocketUpgrade para evitar detección
        tiktok = new WebcastPushConnection(cleanUser, {
            processInitialData: false,
            enableExtendedGiftInfo: true,
            enableWebsocketUpgrade: false, // Forzamos Polling (más lento pero más difícil de banear)
            requestPollingIntervalMs: 2000,
            clientParams: {
                "app_language": "es-ES",
                "device_platform": "web"
            }
        });

        tiktok.connect().then(state => {
            console.log(`✅ Conectado a @${cleanUser}`);
            socket.emit('connected', { roomId: state.roomId });
        }).catch(err => {
            console.error("❌ Error:", err.message);
            // Enviamos el error para que la App rote de proxy automáticamente
            socket.emit('error', `TikTok Error: ${err.message}`);
        });

        tiktok.on('chat', (data) => socket.emit('comment', data));
        tiktok.on('gift', (data) => socket.emit('gift', data));
        tiktok.on('like', (data) => socket.emit('like', data));
        tiktok.on('follow', (data) => socket.emit('follow', data));
        tiktok.on('share', (data) => socket.emit('share', data));
        tiktok.on('social', (data) => socket.emit('social', data));
        tiktok.on('disconnected', () => socket.emit('disconnected'));
        tiktok.on('streamEnd', () => socket.emit('streamEnd'));
    });

    socket.on('disconnect', () => { if (tiktok) tiktok.disconnect(); });
});
