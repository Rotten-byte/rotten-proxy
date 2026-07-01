const TikTokLiveConnector = require('tiktok-live-connector');

const WebcastPushConnection =
    TikTokLiveConnector.WebcastPushConnection ||
    TikTokLiveConnector.default?.WebcastPushConnection ||
    TikTokLiveConnector;

const io = require('socket.io')(process.env.PORT || 3000, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

console.log("🚀 ROTTEN PROXY V19.1 - MODO ANTIBAN ACTIVO");


if (typeof WebcastPushConnection !== "function") {
    console.error("❌ WebcastPushConnection no es válido.");
    console.error("Export recibido:", TikTokLiveConnector);
    process.exit(1);
}


// Lista de User-Agents modernos
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];


io.on('connection', (socket) => {

    let tiktok = null;


    socket.on('join', (username) => {

        if (!username) return;


        const cleanUser = username.replace('@', '').trim();

        console.log(
            `🔗 [${new Date().toLocaleTimeString()}] Intentando conectar a @${cleanUser}...`
        );


        // Cerrar conexión anterior
        if (tiktok) {
            try {
                tiktok.disconnect();
            } catch(e) {}

            tiktok = null;
        }


        const randomUA =
            userAgents[Math.floor(Math.random() * userAgents.length)];


        try {

            tiktok = new WebcastPushConnection(cleanUser, {

                processInitialData: false,

                enableExtendedGiftInfo: true,

                enableWebsocketUpgrade: true,

                requestPollingIntervalMs: 2500,


                clientParams: {
                    app_language: "es-ES",
                    device_platform: "web",
                    browser_name: "Mozilla",
                    browser_platform: "Win32"
                },


                requestOptions: {
                    headers: {
                        'User-Agent': randomUA
                    }
                }

            });


            // Eventos primero
            tiktok.on('chat', data => {
                socket.emit('comment', data);
            });


            tiktok.on('gift', data => {
                socket.emit('gift', data);
            });


            tiktok.on('like', data => {
                socket.emit('like', data);
            });


            tiktok.on('follow', data => {
                socket.emit('follow', data);
            });


            tiktok.on('share', data => {
                socket.emit('share', data);
            });


            tiktok.on('social', data => {
                socket.emit('social', data);
            });


            tiktok.on('disconnected', () => {

                console.log(
                    `🔌 @${cleanUser} desconectado`
                );

                socket.emit(
                    'disconnected',
                    'Stream finalizado'
                );
            });


            tiktok.on('streamEnd', () => {

                console.log(
                    `🎬 Stream terminado @${cleanUser}`
                );

                socket.emit('streamEnd');

            });



            // Conectar
            tiktok.connect()
                .then(state => {

                    console.log(
                        `✅ CONECTADO @${cleanUser} RoomId:${state.roomId}`
                    );


                    socket.emit('connected', {
                        roomId: state.roomId
                    });


                    socket.emit('status', 'LIVE');

                })
                .catch(err => {

                    console.error(
                        `❌ Error conectando @${cleanUser}:`,
                        err.message
                    );

                    socket.emit(
                        'error',
                        err.message
                    );

                });


        } catch(err) {

            console.error(
                "❌ Error creando conexión:",
                err
            );

            socket.emit(
                'error',
                err.message
            );

        }

    });



    socket.on('disconnect', () => {

        if (tiktok) {

            try {
                tiktok.disconnect();
            } catch(e){}

            tiktok = null;
        }

    });


});



setInterval(() => {

    const mem = Math.round(
        process.memoryUsage().heapUsed / 1024 / 1024
    );


    console.log(
        `[${new Date().toLocaleTimeString()}] Proxy Online | Memoria: ${mem}MB`
    );


},60000);
