const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TIKTOK_LIB = require('tiktok-live-connector');

// --- FIX CRÍTICO PARA EL CONSTRUCTOR ---
// Algunas versiones exportan el objeto directamente, otras requieren desestructuración.
const WebcastPushConnection = TIKTOK_LIB.WebcastPushConnection || TIKTOK_LIB;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Puerto dinámico para Render
const PORT = process.env.PORT || 3000;

// Endpoint de salud (Evita que Render asuma que el servicio falló)
app.get('/', (req, res) => {
    res.send('🚀 ROTTEN PROXY V19.0 - ACTIVO');
});

io.on('connection', (socket) => {
    let tiktokConnection = null;
    let currentRoom = null;

    console.log(`📡 Nueva conexión de cliente: ${socket.id}`);

    socket.on('join', (username) => {
        if (!username) return;
        
        const cleanUser = username.replace('@', '').trim().toLowerCase();
        currentRoom = cleanUser;

        // Desconectar si ya había una conexión previa en este socket
        if (tiktokConnection) {
            tiktokConnection.disconnect();
        }

        console.log(`🔗 Intentando conectar a @${cleanUser}...`);

        try {
            // Configuración Anti-Ban y de Rendimiento
            tiktokConnection = new WebcastPushConnection(cleanUser, {
                processInitialData: true,
                enableExtendedGiftInfo: true,
                requestPollingIntervalMs: 2000,
                clientParams: {
                    "app_language": "es-ES",
                    "device_platform": "web"
                }
            });

            // Conectar a TikTok
            tiktokConnection.connect().then(state => {
                console.log(`✅ Conectado exitosamente a la sala de ${cleanUser} (ID: ${state.roomId})`);
                socket.emit('connected', { roomId: state.roomId, status: "success" });
            }).catch(err => {
                console.error(`❌ Error de conexión TikTok: ${err.message}`);
                socket.emit('error', `TikTok: ${err.message}`);
            });

            // --- MANEJO DE EVENTOS ---

            // Comentarios
            tiktokConnection.on('chat', (data) => socket.emit('comment', data));

            // Regalos
            tiktokConnection.on('gift', (data) => socket.emit('gift', data));

            // Seguidores
            tiktokConnection.on('follow', (data) => socket.emit('follow', data));

            // Compartir
            tiktokConnection.on('share', (data) => socket.emit('share', data));

            // Likes
            tiktokConnection.on('like', (data) => socket.emit('like', data));

            // --- DETECCIÓN DE REPOSTS (CRÍTICO PARA LA APP) ---
            tiktokConnection.on('social', (data) => {
                // Notificamos evento social genérico
                socket.emit('social', data);
                
                // Si el evento es específicamente un Repost, enviamos evento 'repost'
                if (data.displayType && data.displayType.includes('repost')) {
                    console.log(`🔁 Repost detectado de: ${data.uniqueId}`);
                    socket.emit('repost', data);
                }
            });

            // Manejo de errores internos para evitar que el servidor se caiga
            tiktokConnection.on('error', (err) => {
                console.error(`⚠️ Error en el stream de TikTok: ${err}`);
                socket.emit('error', `Stream Error: ${err.message}`);
            });

            tiktokConnection.on('disconnected', () => {
                console.log(`🔌 TikTok desconectó a @${cleanUser}`);
                socket.emit('error', 'TikTok desconectó la sesión');
            });

        } catch (e) {
            console.error("🔥 Error Crítico al instanciar conector:", e.message);
            socket.emit('error', "Error interno en el constructor del Proxy");
        }
    });

    // Limpieza al cerrar la app o perder conexión
    socket.on('disconnect', () => {
        console.log(`❌ Cliente desconectado: ${socket.id}`);
        if (tiktokConnection) {
            tiktokConnection.disconnect();
            tiktokConnection = null;
        }
    });
});

// Arrancar Servidor
server.listen(PORT, () => {
    console.log(`
    🚀 ROTTEN PROXY V19.0 - MODO ANTIBAN PRO
    ---------------------------------------
    Servidor corriendo en puerto: ${PORT}
    Detección de Reposts: ACTIVADA
    Fix de Constructor: APLICADO
    `);
});
