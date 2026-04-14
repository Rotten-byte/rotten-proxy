const { WebcastPushConnection } = require('tiktok-live-connector');
const io = require('socket.io')(process.env.PORT || 3000, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

console.log("========================================");
console.log("🚀 ROTTEN STREAM PROXY V13.1 ACTIVO");
console.log("========================================");

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('join', (username) => {
        console.log(`🔗 Conectando a @${username}...`);
        tiktok = new WebcastPushConnection(username);

        tiktok.connect().then(state => {
            socket.emit('status', 'Conectado ✅');
        }).catch(err => {
            socket.emit('status', 'Error de conexión');
        });

        // 💬 COMENTARIOS (Ahora con Nickname)
        tiktok.on('chat', (data) => {
            socket.emit('comment', {
                uniqueId: data.uniqueId,
                nickname: data.nickname, // ✅ AHORA SÍ ENVIAMOS EL NICK
                text: data.comment
            });
        });

        // 🎁 REGALOS (Añadido)
        tiktok.on('gift', (data) => {
            if (data.giftId) {
                socket.emit('gift', {
                    uniqueId: data.uniqueId,
                    nickname: data.nickname,
                    giftName: data.giftName
                });
            }
        });

        // 👤 SEGUIDORES (Añadido)
        tiktok.on('follow', (data) => {
            socket.emit('follow', {
                uniqueId: data.uniqueId,
                nickname: data.nickname
            });
        });

        // 📢 COMPARTIR (Añadido)
        tiktok.on('share', (data) => {
            socket.emit('share', {
                uniqueId: data.uniqueId,
                nickname: data.nickname
            });
        });

        tiktok.on('disconnected', () => {
            socket.emit('status', 'Live finalizado');
        });
    });

    socket.on('disconnect', () => {
        if (tiktok) tiktok.disconnect();
    });
});
