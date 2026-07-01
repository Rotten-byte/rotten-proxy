const TikTokConnector = require('tiktok-live-connector');
// FIX: Detecta automáticamente si debe usar { WebcastPushConnection } o la clase directa
const WebcastPushConnection = TikTokConnector.WebcastPushConnection || TikTokConnector;

const io = require('socket.io')(process.env.PORT || 3000, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

console.log("🚀 ROTTEN PROXY V19.0 - MODO ANTIBAN PRO ACTIVO");

// Lista de User-Agents modernos para evitar bloqueos
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('join', (username) => {
        if (!username) return;
        
        const cleanUser = username.replace('@', '').trim();
        console.log(`🔗 [${new Date().toLocaleTimeString()}] Intentando conectar a @${cleanUser}...`);
        
        // Limpiamos conexión previa si existe
        if (tiktok) {
            tiktok.disconnect();
            tiktok = null;
        }

        // Seleccionamos un User-Agent al azar para cada conexión
        const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

        // CONFIGURACIÓN ANTIBAN PRO
        tiktok = new WebcastPushConnection(cleanUser, {
            processInitialData: false,
            enableExtendedGiftInfo: true,
            enableWebsocketUpgrade: true,
            requestPollingIntervalMs: 2500, // Intervalo más humano para evitar bans
            clientParams: {
                "app_language": "es-ES",
                "device_platform": "web",
                "browser_name": "Mozilla",
                "browser_platform": "Win32"
            },
            requestOptions: {
                headers: {
                    'User-Agent': randomUA
                }
            }
        });

        tiktok.connect().then(state => {
            console.log(`✅ ¡ÉXITO! Conectado a @${cleanUser} (RoomId: ${state.roomId})`);
            socket.emit('connected', { roomId: state.roomId });
            socket.emit('status', 'LIVE');
        }).catch(err => {
            console.error(`❌ Error en @${cleanUser}:`, err.message);
            socket.emit('error', err.message);
        });

        // Reenvío de eventos a la App Android
        tiktok.on('chat', (data) => socket.emit('comment', data));
        tiktok.on('gift', (data) => socket.emit('gift', data));
        tiktok.on('like', (data) => socket.emit('like', data));
        tiktok.on('follow', (data) => socket.emit('follow', data));
        tiktok.on('share', (data) => socket.emit('share', data));
        
        // DETECCIÓN DE REPOST (NUEVO)
        tiktok.on('social', (data) => {
            if (data.displayType && data.displayType.includes('repost')) {
                socket.emit('repost', data);
            }
            socket.emit('social', data);
        });

        tiktok.on('disconnected', () => {
            console.log(`🔌 @${cleanUser} se ha desconectado del proxy.`);
            socket.emit('disconnected', 'Stream finalizado');
        });

        tiktok.on('streamEnd', () => {
            console.log(`🎬 El stream de @${cleanUser} terminó.`);
            socket.emit('streamEnd');
        });
    });

    socket.on('disconnect', () => {
        if (tiktok) {
            tiktok.disconnect();
            tiktok = null;
        }
    });
});

// Monitor de memoria para evitar que Render mate el proceso
setInterval(() => {
    const mem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    console.log(`[${new Date().toLocaleTimeString()}] Proxy Online | Memoria: ${mem}MB`);
}, 60000);
