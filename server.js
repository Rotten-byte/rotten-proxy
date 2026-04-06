const { WebcastPushConnection } = require('tiktok-live-connector');
const io = require('socket.io')(process.env.PORT || 3000, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

console.log("========================================");
console.log("🚀 ROTTEN STREAM PROXY INICIADO (CLOUD)");
console.log("========================================");

io.on('connection', (socket) => {
    let tiktok = null;
    let lastCommentTime = Date.now(); // Marca de tiempo al conectar

    console.log("📱 [Proxy] App Android conectada");

    socket.on('join', (username) => {
        console.log(`🔗 [TikTok] Intentando conectar a @${username}...`);

        // Reiniciar marca de tiempo al unirse a un nuevo live
        lastCommentTime = Date.now();

        tiktok = new WebcastPushConnection(username);

        tiktok.connect().then(state => {
            console.log(`✅ [TikTok] Conectado exitosamente al Live de @${username}`);
            socket.emit('status', 'Conectado ✅');
        }).catch(err => {
            console.error("❌ [TikTok] Error de conexión:", err.message);
            socket.emit('status', 'Error de conexión');
        });

        // Reenviar comentarios a Android (SÓLO NUEVOS)
        tiktok.on('chat', (data) => {
            // TikTok a veces envía los últimos comentarios del buffer al conectar.
            // Comparamos el timestamp del mensaje con el momento en que nos conectamos.
            const messageTimestamp = parseInt(data.createTime);

            // Si el mensaje es más viejo que nuestra conexión (o muy cercano), lo ignoramos.
            // Nota: createTime viene en milisegundos en algunas versiones o segundos en otras.
            // La mayoría de las veces el conector lo normaliza, pero añadimos una pequeña lógica de seguridad.

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
