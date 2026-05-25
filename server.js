const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const cors = require('cors');

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    // Recomendación técnica: Mantener en polling si el WebSocket falla mucho en Render
    transports: ['polling', 'websocket'] 
});

io.on('connection', (socket) => {
    let tiktokConnection = null;

    socket.on('join', (username) => {
        if (!username) return;

        // Limpiar conexión previa si existe
        if (tiktokConnection) {
            tiktokConnection.disconnect();
        }

        // V19.0 - Configuración de Resiliencia
        tiktokConnection = new WebcastPushConnection(username, {
            processInitialData: true,
            enableWebsocketUpgrade: false, // FORZAR POLLING: Más estable contra bloqueos de IP
            fetchOptions: {
                timeout: 10000
            },
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }
        });

        tiktokConnection.connect().then(state => {
            socket.emit('connected', { 
                roomInfo: state.roomInfo,
                msg: `Conectado al LIVE de ${username}` 
            });
            console.log(`[${username}] Conectado exitosamente.`);
        }).catch(err => {
            console.error(`[${username}] Error al conectar:`, err.message);
            // Señal para que el App de Android rote el Proxy
            socket.emit('error', err.message.includes('502') ? 'Error 502: Proxy Bloqueado' : err.message);
        });

        // --- EVENTOS PRINCIPALES ---

        tiktokConnection.on('chat', (data) => {
            // Enriquecemos la data con user_type para detectar al host (Broadcaster)
            // user_type 2 suele ser el host en la estructura interna de TikTok
            socket.emit('comment', data);
        });

        tiktokConnection.on('gift', (data) => {
            socket.emit('gift', data);
        });

        tiktokConnection.on('envelope', (data) => {
            socket.emit('envelope', data);
        });

        tiktokConnection.on('subscribe', (data) => {
            socket.emit('subscribe', data);
        });

        tiktokConnection.on('follow', (data) => {
            socket.emit('follow', data);
        });

        tiktokConnection.on('share', (data) => {
            socket.emit('share', data);
        });

        tiktokConnection.on('like', (data) => {
            socket.emit('like', data);
        });

        tiktokConnection.on('social', (data) => {
            socket.emit('social', data);
        });

        tiktokConnection.on('repost', (data) => {
            socket.emit('repost', data);
        });

        // --- MANEJO DE ERRORES Y DESCONEXIÓN ---

        tiktokConnection.on('error', (err) => {
            console.error(`[${username}] Error de conexión:`, err);
            socket.emit('error', err.toString());
        });

        tiktokConnection.on('disconnected', (reason) => {
            console.log(`[${username}] Desconectado: ${reason}`);
            socket.emit('error', 'offline');
        });

        tiktokConnection.on('streamEnd', () => {
            console.log(`[${username}] El directo ha finalizado.`);
            socket.emit('error', 'offline');
        });
    });

    socket.on('ping', () => {
        socket.emit('pong');
    });

    socket.on('disconnect', () => {
        if (tiktokConnection) {
            tiktokConnection.disconnect();
            tiktokConnection = null;
        }
    });
});

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
    console.log(`Proxy V19.0 (Anti-Ban) escuchando en puerto ${PORT}`);
    console.log(`Modo Polling forzado: Activo`);
});
