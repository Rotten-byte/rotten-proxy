const { TikTokLive } = require('@tiktool/live');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const app = express();
const httpServer = http.createServer(app);

app.get('/', (req, res) => {
 res.status(200).send('OK - Rotten Proxy AFK is running');
});

const io = new Server(httpServer, {
 cors: { origin: "*", methods: ["GET", "POST"] }
});

function getApiKey() {
 const keys = [
 process.env.TIKTOOL_API_KEY,
 process.env.TIKTOOL_API_KEY2,
 process.env.TIKTOOL_API_KEY3,
 process.env.TIKTOOL_API_KEY4,
 process.env.TIKTOOL_API_KEY5
 ].filter(k => k && k.trim().length > 10);
 return keys.length === 0 ? null : keys[Math.floor(Math.random() * keys.length)].trim();
}

io.on('connection', (socket) => {
 const state = { conn: null, username: null, active: false, retryCount: 0, isConnecting: false, isReconnecting: false };
 console.log("✅ Nueva conexión desde la App");

 function safeDisconnect() {
 if (!state.conn) return;
 const conn = state.conn;
 state.conn = null;
 try {
 if (typeof conn.removeAllListeners === 'function') {
 conn.removeAllListeners();
 }
 } catch (err) {
 console.error("⚠️ Error al remover listeners:", err.message || err);
 }
 try {
 if (typeof conn.disconnect === 'function') {
 conn.disconnect();
 }
 } catch (err) {
 console.error("⚠️ Error al desconectar:", err.message || err);
 }
 }

 function connectToTikTok(username, sessionId) {
 if (!state.active) return;
 if (state.isConnecting) {
 console.log(`⏳ Ya hay un intento de conexión en curso para @${username}, se omite el nuevo intento.`);
 return;
 }
 state.isConnecting = true;
 const apiKey = getApiKey();
 if (!apiKey) {
 state.isConnecting = false;
 socket.emit('error', 'No API Key en Railway');
 return;
 }
 try {
 const conn = new TikTokLive({
 uniqueId: username.replace('@', '').trim(),
 apiKey: apiKey,
 mode: 'relayed',
 });
 state.conn = conn;
 let hasReceivedData = false;

 conn.on('error', (err) => {
 console.error(`⚠️ TikTokLive error en @${username}:`, err && err.message ? err.message : err);
 });

 conn.on('chat', (data) => {
 hasReceivedData = true;
 socket.emit('comment', data);
 });
 conn.on('gift', (data) => {
 hasReceivedData = true;
 socket.emit('gift', data);
 });
 conn.on('like', (data) => {
 hasReceivedData = true;
 socket.emit('like', data);
 });
 conn.on('follow', (data) => {
 hasReceivedData = true;
 socket.emit('follow', data);
 });
 conn.on('share', (data) => {
 hasReceivedData = true;
 socket.emit('share', data);
 });

 function scheduleReconnect(reason) {
 if (!state.active) return;
 if (state.isReconnecting) {
 console.log(`⏳ Ya se está reconectando a @${username}, se ignora el evento "${reason}".`);
 return;
 }
 state.isReconnecting = true;
 state.retryCount++;
 console.log(`🔄 Intento de reconexión ${state.retryCount} para @${username} (motivo: ${reason})`);
 safeDisconnect();
 setTimeout(() => {
 state.isReconnecting = false;
 connectToTikTok(username, sessionId);
 }, 3000);
 }

 ['disconnected', 'close', 'streamEnd'].forEach((evt) => {
 conn.on(evt, () => {
 console.log(`⚠️ Evento ${evt} en @${username}`);
 if (state.isReconnecting) {
 console.log(`⏳ Reconexión ya en curso para @${username}, se ignora el evento ${evt}.`);
 return;
 }
 socket.emit('error', 'TikTok Connection Lost - Retrying');
 scheduleReconnect(evt);
 });
 });

 conn.connect()
 .then(() => {
 console.log(`✅ Conectado a @${username}`);
 state.isConnecting = false;
 state.retryCount = 0;
 socket.emit('connected');

 // Check si está recibiendo datos después de 10 segundos
 setTimeout(() => {
 if (!hasReceivedData && state.active) {
 console.warn(`⚠️ No data received from @${username}, reconnecting...`);
 socket.emit('error', 'No data received - Retrying');
 scheduleReconnect('no-data');
 }
 }, 10000);
 })
 .catch((err) => {
 console.error(`❌ Error conectando a @${username}:`, err.message || err);
 state.isConnecting = false;
 socket.emit('error', err.message || 'Error de conexión');
 scheduleReconnect('connect-error');
 });
 } catch (e) {
 state.isConnecting = false;
 console.error("Error creando conexión:", e.message || e);
 socket.emit('error', 'Error creando conexión');
 }
 }


 socket.on('join', (username, sessionId) => {
 console.log(`📱 Intentando conectar a: @${username}`);
 // Solo desconectamos la conexión previa cuando se trata de una NUEVA conexión de usuario,
 // nunca durante los reintentos automáticos dentro de connectToTikTok.
 safeDisconnect();
 state.active = true;
 state.username = username;
 state.retryCount = 0;
 state.isConnecting = false;
 state.isReconnecting = false;
 connectToTikTok(username, sessionId);
 });

 socket.on('disconnect', () => {
 console.log(`❌ Desconexión de socket`);
 state.active = false;
 safeDisconnect();
 });
});

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, '0.0.0.0', () => {
 console.log(`🚀 Servidor Privado en puerto ${PORT}`);
});
