const { WebcastPushConnection } = require('tiktok-live-connector');
const io = require('socket.io')(process.env.PORT || 3000, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

console.log("========================================");
console.log("🚀 ROTTEN STREAM PROXY V17.0 ACTIVO");
console.log("📡 TRANSMITIENDO METADATA COMPLETA");
console.log("========================================");

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('join', (username) => {
        if (!username) return;
        
        console.log(`🔗 Intentando conectar a @${username}...`);
        
        // Limpieza de conexión previa si existe
        if (tiktok) {
            tiktok.disconnect();
        }

        tiktok = new WebcastPushConnection(username, {
            processInitialData: false,
            enableExtendedGiftInfo: true,
            enableWebsocketUpgrade: true
        });

        tiktok.connect().then(state => {
            console.log(`✅ Conectado al Live de @${username} (ID: ${state.roomId})`);
            socket.emit('status', 'Conectado ✅');
        }).catch(err => {
            console.error("❌ Error al conectar:", err);
            socket.emit('status', 'Error de conexión');
        });

        // ==========================================================
        // 💬 EVENTOS (Enviando 'data' completo para el Bot de Android)
        // ==========================================================

        // Comentarios
        tiktok.on('chat', (data) => {
            // Enviamos el objeto completo para que el bot vea las medallas
            socket.emit('comment', data);
        });

        // Regalos
        tiktok.on('gift', (data) => {
            socket.emit('gift', data);
        });

        // Likes
        tiktok.on('like', (data) => {
            socket.emit('like', data);
        });

        // Seguidores
        tiktok.on('follow', (data) => {
            socket.emit('follow', data);
        });

        // Compartir
        tiktok.on('share', (data) => {
            socket.emit('share', data);
        });

        // Eventos sociales (Repost, etc)
        tiktok.on('social', (data) => {
            socket.emit('social', data);
        });

        // ==========================================================
        // ESTADO DE LA CONEXIÓN
        // ==========================================================

        tiktok.on('disconnected', () => {
            console.log(`⚠️ Live de @${username} finalizado.`);
            socket.emit('status', 'Live finalizado');
        });

        tiktok.on('streamEnd', () => {
            console.log(`⚠️ Stream finalizado por el sistema.`);
            socket.emit('status', 'Live finalizado');
        });

        tiktok.on('error', (err) => {
            console.error("❌ Error en TikTok SDK:", err);
            socket.emit('status', 'Error en el directo');
        });
    });

    socket.on('disconnect', () => {
        if (tiktok) {
            tiktok.disconnect();
            console.log("❌ Cliente desconectado del Proxy.");
        }
    });
});

// Mensaje de consola para evitar que Render piense que el proceso murió
setInterval(() => {
    console.log(`[${new Date().toLocaleTimeString()}] Proxy funcionando...`);
}, 60000);
