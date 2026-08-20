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
 cors: { origin: "*", methods: ["GET", "POST"] },
 pingInterval: 25000,
 pingTimeout: 60000
});
// Whitelist desde variables de entorno
const AUTHORIZED_USERS = (process.env.AUTHORIZED_USERS || '')
 .split(',')
 .map(u => u.trim().toLowerCase())
 .filter(u => u.length > 0);
console.log(`✅ Usuarios autorizados: ${AUTHORIZED_USERS.length > 0 ? AUTHORIZED_USERS.join(', ') : 'NINGUNO'}`);
function isAuthorized(username) {
 if (AUTHORIZED_USERS.length === 0) {
 console.warn('⚠️ ADVERTENCIA: No hay usuarios autorizados configurados');
 return false;
 }
 return AUTHORIZED_USERS.includes(username.toLowerCase());
}
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
 const state = { conn: null, username: null, active: false, retryCount: 0, reconnectTimer: null };
 console.log("✅ Nueva conexión desde la App");

 function safeDisconnect() {
   if (state.reconnectTimer) {
     clearTimeout(state.reconnectTimer);
     state.reconnectTimer = null;
   }

   const conn = state.conn;
   // Clear the reference immediately so nothing else can try to reuse
   // this connection object while we're in the process of tearing it down.
   state.conn = null;

   if (!conn) return;

   try {
     conn.removeAllListeners();
   } catch (err) {
     console.error("⚠️ Error al remover listeners:", err.message || err);
   }

   // The underlying WebSocket may still be mid-handshake. Swallow any
   // 'error' it emits so it doesn't bubble up as an uncaught exception.
   try {
     const ws = conn.ws || (conn.connection && conn.connection.ws) || conn.webSocket || null;
     if (ws && typeof ws.on === 'function') {
       if (typeof ws.removeAllListeners === 'function') {
         ws.removeAllListeners('error');
       }
       ws.on('error', () => {});
     }
   } catch (err) {
     // best effort only, ignore
   }

   // Give the pending connection attempt a brief moment to settle before
   // trying to close it. Calling disconnect() while the WebSocket is still
   // connecting throws "WebSocket was closed before the connection was
   // established", which crashes the process if left unhandled.
   setTimeout(() => {
     try {
       const ws = conn.ws || (conn.connection && conn.connection.ws) || conn.webSocket || null;
       const readyState = ws ? ws.readyState : undefined;

       // readyState: 0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED
       if (ws && readyState === 0) {
         // Still mid-handshake: abort the pending connection instead of
         // calling disconnect() on it.
         try {
           if (typeof ws.terminate === 'function') {
             ws.terminate();
           } else if (typeof ws.close === 'function') {
             ws.close();
           }
         } catch (abortErr) {
           console.error("⚠️ Error al abortar conexión pendiente:", abortErr.message || abortErr);
         }
         return;
       }

       if (typeof conn.disconnect === 'function') {
         conn.disconnect();
       }
     } catch (err) {
       console.error("⚠️ Error al desconectar (ignorado):", err.message || err);
     }
   }, 100);
 }

 function connectToTikTok(username, sessionId) {
 if (!state.active) return;
 if (state.retryCount > 10) {
 console.error(`❌ Máximo de reintentos alcanzado para @${username}`);
 socket.emit('error', 'Max retries exceeded');
 state.active = false;
 return;
 }
 safeDisconnect();
 const apiKey = getApiKey();
 if (!apiKey) {
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
 try {
 socket.emit('comment', data);
 } catch (e) {
 console.error("Error emitiendo comment:", e.message);
 }
 });
 conn.on('gift', (data) => {
 hasReceivedData = true;
 try {
 socket.emit('gift', data);
 } catch (e) {
 console.error("Error emitiendo gift:", e.message);
 }
 });
 conn.on('like', (data) => {
 hasReceivedData = true;
 try {
 socket.emit('like', data);
 } catch (e) {
 console.error("Error emitiendo like:", e.message);
 }
 });
 conn.on('follow', (data) => {
 hasReceivedData = true;
 try {
 socket.emit('follow', data);
 } catch (e) {
 console.error("Error emitiendo follow:", e.message);
 }
 });
 conn.on('share', (data) => {
 hasReceivedData = true;
 try {
 socket.emit('share', data);
 } catch (e) {
 console.error("Error emitiendo share:", e.message);
 }
 });
 ['disconnected', 'close', 'streamEnd'].forEach((evt) => {
 conn.on(evt, () => {
 console.log(`⚠️ Evento ${evt} en @${username}, reintentando...`);
 socket.emit('error', 'TikTok Connection Lost - Retrying');
 if (state.active && state.retryCount <= 10) {
 state.retryCount++;
 console.log(`🔄 Intento de reconexión ${state.retryCount}/10 para @${username}`);
 state.reconnectTimer = setTimeout(() => connectToTikTok(username, sessionId), 3000 + (state.retryCount * 1000));
 }
 });
 });
 conn.connect()
 .then(() => {
 console.log(`✅ Conectado a @${username}`);
 state.retryCount = 0;
 socket.emit('connected');
 setTimeout(() => {
 if (!hasReceivedData && state.active) {
 console.warn(`⚠️ No data received from @${username}, reconnecting...`);
 socket.emit('error', 'No data received - Retrying');
 state.retryCount++;
 state.reconnectTimer = setTimeout(() => connectToTikTok(username, sessionId), 3000);
 }
 }, 10000);
 })
 .catch((err) => {
 console.error(`❌ Error conectando a @${username}:`, err.message || err);
 socket.emit('error', err.message || 'Error de conexión');
 if (state.active && state.retryCount <= 10) {
 state.retryCount++;
 console.log(`🔄 Intento de reconexión ${state.retryCount}/10 para @${username}`);
 state.reconnectTimer = setTimeout(() => connectToTikTok(username, sessionId), 3000 + (state.retryCount * 1000));
 }
 });
 } catch (e) {
 console.error("Error creando conexión:", e.message || e);
 socket.emit('error', 'Error creando conexión');
 }
 }
 socket.on('join', (username, sessionId) => {
 console.log(`📱 Intento de conexión de: @${username}`);
 // VERIFICAR AUTORIZACIÓN
 if (!isAuthorized(username)) {
 console.warn(`🚫 Usuario NO autorizado: @${username}`);
 socket.emit('error', 'No tienes acceso a este bot');
 socket.disconnect();
 return;
 }
 console.log(`✅ Usuario autorizado: @${username}`);
 state.active = true;
 state.username = username;
 state.retryCount = 0;
 connectToTikTok(username, sessionId);
 });
 socket.on('disconnect', () => {
 console.log(`❌ Desconexión de socket`);
 state.active = false;
 safeDisconnect();
 });
 socket.on('error', (err) => {
 console.error('Socket error:', err);
 });
});

process.on('uncaughtException', (err) => {
  // Known non-fatal error thrown by the WebSocket layer when disconnect()
  // races with a connection attempt that hasn't finished establishing yet.
  // safeDisconnect() already guards against this, but keep this as a
  // defense-in-depth measure so the process doesn't die if it slips through.
  if (err && err.message && err.message.includes('WebSocket was closed before the connection was established')) {
    console.error('⚠️ Excepción no atrapada (ignorada):', err.message);
    return;
  }
  console.error('❌ Excepción no atrapada:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
 console.error('❌ Promesa rechazada no manejada:', reason);
});

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, '0.0.0.0', () => {
 console.log(`🚀 Servidor Privado en puerto ${PORT}`);
});
