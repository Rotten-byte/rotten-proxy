const { WebcastPushConnection } = require('tiktok-live-connector');const io = require('socket.io')(process.env.PORT || 3000, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

console.log("🚀 ROTTEN PROXY V18.0 - MODO ANTIBAN ACTIVO");

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('join', (username) => {
        if (!username) return;
        
        const cleanUser = username.replace('@', '').trim();
        console.log(`🔗 Intentando conectar a @${cleanUser}...`);
        
        if (tiktok) tiktok.disconnect();

        // CONFIGURACIÓN MEJORADA
        tiktok = new WebcastPushConnection(cleanUser, {
            processInitialData: false,
            enableExtendedGiftInfo: true,
            enableWebsocketUpgrade: true,
            requestPollingIntervalMs: 2000,
            // Si consigues un sessionId, ponlo aquí para evitar el 100% de los bloqueos:
            // sessionId: "tu_session_id_aqui" 
            clientParams: {
                "app_language": "es-ES",
                "device_platform": "web"
            }
        });

        tiktok.connect().then(state => {
            console.log(`✅ ¡ÉXITO! Conectado a @${cleanUser}`);
            // NOTIFICAMOS A LA APP (Vital para la nueva lógica)
            socket.emit('connected', { roomId: state.roomId });
            socket.emit('status', 'LIVE');
        }).catch(err => {
            console.error("❌ Error de TikTok:", err.message);
            // ENVIAMOS EL ERROR REAL (Para que la App sepa si debe rotar de Proxy)
            socket.emit('error', err.message);
        });

        // Eventos de TikTok
        tiktok.on('chat', (data) => socket.emit('comment', data));
        tiktok.on('gift', (data) => socket.emit('gift', data));
        tiktok.on('like', (data) => socket.emit('like', data));
        tiktok.on('follow', (data) => socket.emit('follow', data));
        tiktok.on('share', (data) => socket.emit('share', data));
        tiktok.on('social', (data) => socket.emit('social', data));

        tiktok.on('disconnected', () => {
            console.log(`🔌 @${cleanUser} se ha desconectado.`);
            socket.emit('disconnected', 'Stream finalizado');
        });

        tiktok.on('streamEnd', () => socket.emit('streamEnd'));
    });

    socket.on('disconnect', () => {
        if (tiktok) tiktok.disconnect();
    });
});

setInterval(() => {
    console.log(`[${new Date().toLocaleTimeString()}] Proxy Online | Esperando conexiones...`);
}, 60000);
