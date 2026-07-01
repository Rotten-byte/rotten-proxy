const { WebcastPushConnection } = require('tiktok-live-connector');const io = require('socket.io')(process.env.PORT || 3000, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

console.log("🚀 ROTTEN PROXY V23.0 - MODO SESSIONID Y LOGS UNIFICADOS");

// Lista de User-Agents modernos para mayor resiliencia
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

io.on('connection', (socket) => {
    let tiktok = null;

    // Escuchamos el evento 'join' que ahora recibe un objeto {username, sessionId}
    socket.on('join', (data) => {
        // Compatibilidad: si envían solo un string, lo manejamos, si es objeto, extraemos datos
        const username = typeof data === 'string' ? data : data.username;
        const sessionId = typeof data === 'object' ? data.sessionId : null;

        if (!username) {
            socket.emit('error', 'Usuario no proporcionado');
            return;
        }
        
        const cleanUser = username.replace('@', '').trim();
        const hasSession = sessionId && sessionId.length > 5;
        
        console.log(`🔗 [${new Date().toLocaleTimeString()}] Intento de conexión: @${cleanUser} ${hasSession ? '(Con SessionID)' : '(Sin sesión)'}`);
        socket.emit('log', `Buscando live de @${cleanUser}...`);

        if (tiktok) {
            tiktok.disconnect();
            tiktok = null;
        }

        const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

        // CONFIGURACIÓN AVANZADA: Integración de SessionID y Bypass de Signatures
        tiktok = new WebcastPushConnection(cleanUser, {
            processInitialData: true,
            enableExtendedGiftInfo: true,
            enableWebsocketUpgrade: true,
            sessionId: hasSession ? sessionId : undefined, // <--- ELIMINA ERRORES 404 Y CAPTCHAS
            requestPollingIntervalMs: 2000,
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
            console.log(`✅ Conectado a @${cleanUser} (Room: ${state.roomId})`);
            socket.emit('connected', { roomId: state.roomId });
            socket.emit('log', `¡Conectado! ${hasSession ? 'Bypass de sesión activo.' : 'Sin sesión (IP pública).'}`);
        }).catch(err => {
            let errorMsg = err.message;
            console.error(`❌ Error en @${cleanUser}:`, errorMsg);
            
            // Traducimos errores comunes para que la App Android los entienda
            if (errorMsg.includes("404")) {
                errorMsg = "TIKTOK_404: IP Bloqueada o Live no encontrado.";
            } else if (errorMsg.includes("signature") || errorMsg.includes("sign")) {
                errorMsg = "SIGNATURE_ERROR: TikTok requiere SessionID para validar.";
            }

            socket.emit('error', errorMsg);
            socket.emit('log', `Error: ${errorMsg}`);
        });

        // Reenvío de eventos a la App Android
        tiktok.on('chat', (data) => socket.emit('comment', data));
        tiktok.on('gift', (data) => socket.emit('gift', data));
        tiktok.on('like', (data) => socket.emit('like', data));
        tiktok.on('follow', (data) => socket.emit('follow', data));
        tiktok.on('share', (data) => socket.emit('share', data));
        tiktok.on('repost', (data) => socket.emit('repost', data));

        tiktok.on('disconnected', () => {
            console.log(`🔌 Conexión con @${cleanUser} cerrada.`);
            socket.emit('log', "Servidor desconectado.");
            socket.emit('disconnected');
        });

        tiktok.on('streamEnd', () => {
            console.log(`🎬 El live de @${cleanUser} ha terminado.`);
            socket.emit('log', "El usuario terminó el Live.");
            socket.emit('error', "404"); // Dispara rotación en la app si el live termina
        });
    });

    socket.on('disconnect', () => {
        if (tiktok) {
            tiktok.disconnect();
            tiktok = null;
        }
    });
});

// Monitor de salud del servidor
setInterval(() => {
    const mem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    console.log(`[STATUS] Memoria: ${mem}MB | Conexiones activas: ${io.engine.clientsCount}`);
}, 60000);
