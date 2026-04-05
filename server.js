const { WebcastPushConnection } = require('tiktok-live-connector');
const io = require('socket.io')(3000, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

console.log("========================================");
console.log("🚀 ROTTEN STREAM PROXY INICIADO");
console.log("   Puerto: 3000");
console.log("   Esperando conexión de la App Android...");
console.log("========================================");

io.on('connection', (socket) => {
    let tiktok = null;
    console.log("📱 [Proxy] App Android conectada");

    socket.on('join', (username) => {
        console.log(`🔗 [TikTok] Intentando conectar a @${username}...`);

        tiktok = new WebcastPushConnection(username);

        tiktok.connect().then(state => {
            console.log(`✅ [TikTok] Conectado exitosamente al Live de @${username}`);
            socket.emit('status', 'Conectado ✅');
        }).catch(err => {
            console.error("❌ [TikTok] Error de conexión:", err.message);
            socket.emit('status', 'Error de conexión');
        });

        // Reenviar comentarios a Android
        tiktok.on('chat', (data) => {
            console.log(`💬 @${data.uniqueId}: ${data.comment}`);
            socket.emit('comment', {
                user: data.uniqueId,
                text: data.comment
            });
        });

        tiktok.on('disconnected', () => {
            console.log("⚠️ [TikTok] Live finalizado o desconectado");
            socket.emit('status', 'Live finalizado');
        });
    });

    socket.on('disconnect', () => {
        if (tiktok) tiktok.disconnect();
        console.log("❌ [Proxy] App Android desconectada");
    });
});
