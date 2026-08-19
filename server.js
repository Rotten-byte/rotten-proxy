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
    if (state.conn) {
      try {
        state.conn.removeAllListeners();
        state.conn.disconnect();
      } catch (err) {
        console.error("⚠️ Error al desconectar:", err.message || err);
      }
      state.conn = null;
    }
  }

  function connectToTikTok(username, sessionId) {
    if (!state.active) return;
    
    // Limitar reintentos a máximo 10
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
    console.log(`📱 Intentando conectar a: @${username}`);
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

  // Cleanup si la conexión se cuelga
  socket.on('error', (err) => {
    console.error('Socket error:', err);
  });
});

// Manejo global de errores
process.on('uncaughtException', (err) => {
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
