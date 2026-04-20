const { WebcastPushConnection } = require('tiktok-live-connector');
const io = require('socket.io')(process.env.PORT || 3000, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

console.log("========================================");
console.log("🚀 ROTTEN STREAM PROXY V16.0 ACTIVO");
console.log("🚀 LIKES, REPOSTS Y REGALOS SINCRONIZADOS");
console.log("========================================");

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('join', (username) => {
        console.log(`🔗 Conectando a @${username}...`);
        tiktok = new WebcastPushConnection(username);

        tiktok.connect().then(state => {
            console.log(`✅ Conectado al Live de @${username}`);
            socket.emit('status', 'Conectado ✅');
        }).catch(err => {
            console.error("❌ Error al conectar:", err);
            socket.emit('status', 'Error de conexión');
        });

        // 💬 COMENTARIOS
        tiktok.on('chat', (data) => {
            socket.emit('comment', {
                uniqueId: data.uniqueId,
                nickname: data.nickname,
                text: data.comment
            });
        });

        // 🎁 REGALOS (Sincronizado con contador)
        tiktok.on('gift', (data) => {
            socket.emit('gift', {
                uniqueId: data.uniqueId,
                nickname: data.nickname,
                giftName: data.giftName,
                repeatCount: data.repeatCount || 1 // ✅ Importante para regalos seguidos
            });
        });

        // ❤️ LIKES (¡NUEVO! Sincronizado para el bot)
        tiktok.on('like', (data) => {
            socket.emit('like', {
                uniqueId: data.uniqueId,
                nickname: data.nickname,
                totalLikeCount: data.totalLikeCount // ✅ Esto activa los agradecimientos cada 3000
            });
        });

        // 👤 SEGUIDORES
        tiktok.on('follow', (data) => {
            socket.emit('follow', {
                uniqueId: data.uniqueId,
                nickname: data.nickname
            });
        });

        // 📢 COMPARTIR
        tiktok.on('share', (data) => {
            socket.emit('share', {
                uniqueId: data.uniqueId,
                nickname: data.nickname
            });
        });

        // 🔁 REPOST (¡NUEVO!)
        tiktok.on('social', (data) => {
            if (data.displayType && data.displayType.includes('repost')) {
                socket.emit('repost', {
                    uniqueId: data.uniqueId,
                    nickname: data.nickname
                });
            }
        });

        tiktok.on('disconnected', () => {
            console.log("⚠️ Live finalizado por el usuario.");
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
