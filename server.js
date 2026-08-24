const { TikTokLive } = require('@tiktool/live');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const httpServer = http.createServer(app);

function cleanUsername(username) {
  return String(username || '')
    .trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?tiktok\.com\/@/i, '')
    .split(/[/?#\s]/)[0]
    .toLowerCase();
}

function getAuthorizedUsers() {
  return (process.env.AUTHORIZED_USERS || '')
    .split(',')
    .map(cleanUsername)
    .filter(Boolean);
}

function allowAllUsers() {
  return String(process.env.ALLOW_ALL_USERS || '').toLowerCase() === 'true';
}

function isAuthorized(username) {
  const clean = cleanUsername(username);
  if (allowAllUsers()) return true;

  const users = getAuthorizedUsers();
  if (users.length === 0) {
    console.warn('No hay AUTHORIZED_USERS configurado. Usa AUTHORIZED_USERS=usuario1,usuario2 o ALLOW_ALL_USERS=true');
    return false;
  }

  return users.includes(clean);
}

function emitUnauthorized(socket, username) {
  const clean = cleanUsername(username);
  const message = `@${clean} no está autorizado para usar este bot`;
  console.warn(`Usuario NO autorizado: @${clean}`);
  socket.emit('unauthorized', {
    ok: false,
    username: clean,
    message,
  });
  socket.emit('error', message);
  setTimeout(() => socket.disconnect(true), 250);
}

app.get('/', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'Rotten Proxy AFK',
    message: 'running',
    authorizedUsersCount: getAuthorizedUsers().length,
    allowAllUsers: allowAllUsers(),
  });
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    uptime: process.uptime(),
    authorizedUsersCount: getAuthorizedUsers().length,
    allowAllUsers: allowAllUsers(),
  });
});

app.get('/access/:username', (req, res) => {
  const username = cleanUsername(req.params.username);
  res.status(200).json({
    ok: true,
    username,
    authorized: isAuthorized(username),
  });
});

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingInterval: 25000,
  pingTimeout: 60000,
  transports: ['websocket', 'polling'],
});

const NO_DATA_RECONNECT_MS = Number(process.env.NO_DATA_RECONNECT_MS || 0);

console.log(
  `Usuarios autorizados: ${
    allowAllUsers()
      ? 'TODOS'
      : getAuthorizedUsers().length > 0
        ? getAuthorizedUsers().join(', ')
        : 'NINGUNO'
  }`
);

function getApiKey() {
  const keys = [
    process.env.TIKTOOL_API_KEY,
    process.env.TIKTOOL_API_KEY2,
    process.env.TIKTOOL_API_KEY3,
    process.env.TIKTOOL_API_KEY4,
    process.env.TIKTOOL_API_KEY5,
  ].filter((key) => key && key.trim().length > 10);

  return keys.length === 0 ? null : keys[Math.floor(Math.random() * keys.length)].trim();
}

function clone(data) {
  try {
    return JSON.parse(JSON.stringify(data || {}));
  } catch (_) {
    return {};
  }
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const text = String(value || '').trim();
    if (text && text !== 'null' && text !== 'undefined') return text;
  }
  return '';
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function imageUrlValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.startsWith('http') ? value : '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = imageUrlValue(item);
      if (url) return url;
    }
    return '';
  }
  if (typeof value === 'object') {
    return (
      imageUrlValue(value.urlList) ||
      imageUrlValue(value.url_list) ||
      imageUrlValue(value.urls) ||
      imageUrlValue(value.url) ||
      imageUrlValue(value.uri) ||
      imageUrlValue(value.avatarUrl) ||
      imageUrlValue(value.profilePictureUrl) ||
      ''
    );
  }
  return '';
}

function firstImageUrl(...values) {
  for (const value of values) {
    const url = imageUrlValue(value);
    if (url) return url;
  }
  return '';
}

function normalizePayload(type, rawData) {
  const data = clone(rawData);
  const user = data.user || data.userInfo || data.author || data.sender || {};
  const gift = data.gift || data.giftInfo || data.giftDetails || {};

  data.uniqueId = firstString(data.uniqueId, data.username, user.uniqueId, user.username, user.unique_id, user.id);
  data.nickname = firstString(data.nickname, data.displayName, user.nickname, user.nickName, user.displayName, data.uniqueId);
  data.userId = firstString(data.userId, user.userId, user.user_id, user.id);
  data.profilePictureUrl = firstString(
    firstImageUrl(
      data.profilePictureUrl,
      data.avatarUrl,
      data.profilePicture,
      user.profilePictureUrl,
      user.avatarUrl,
      user.profilePicture,
      user.avatarThumb,
      user.avatarMedium,
      user.avatarLarger
    ),
    data.profilePictureUrl,
    data.avatarUrl,
    user.profilePictureUrl,
    user.avatarUrl,
    user.avatarThumb,
    user.avatarMedium
  );

  if (type === 'gift') {
    data.giftName = firstString(data.giftName, data.gift_name, gift.giftName, gift.name, gift.title, 'regalo');
    data.repeatCount = firstNumber(data.repeatCount, data.repeat_count, data.giftRepeatCount, data.comboCount, data.count, 1);
    data.giftType = Number(data.giftType ?? gift.giftType ?? 0);
    data.repeatEnd = Boolean(data.repeatEnd ?? data.repeat_end ?? data.giftRepeatEnd ?? true);
    data.giftId = Number(data.giftId || gift.giftId || gift.id || 0);
    data.diamondCount = firstNumber(
      data.diamondCount,
      data.diamond_count,
      data.diamondValue,
      data.diamonds,
      data.coins,
      data.price,
      gift.diamondCount,
      gift.diamond_count,
      gift.diamondValue,
      gift.diamonds,
      gift.coins,
      gift.price
    );
  }

  return data;
}

function summarize(data) {
  return JSON.stringify(data).replace(/\s+/g, ' ').slice(0, 350);
}

io.on('connection', (socket) => {
  const state = {
    conn: null,
    username: null,
    active: false,
    retryCount: 0,
    reconnectTimer: null,
    noDataTimer: null,
  };

  console.log('Nueva conexion desde la app');
  socket.emit('hello', { ok: true, service: 'Rotten Proxy AFK' });

  function emitEvent(eventName, rawData) {
    const payload = normalizePayload(eventName, rawData);
    socket.emit(eventName, payload);
    if (!['comment', 'chat', 'like'].includes(eventName)) {
      console.log(`[${state.username}] ${eventName}: ${summarize(payload)}`);
    }
  }

  function emitSocial(rawData) {
    const payload = normalizePayload('social', rawData);
    socket.emit('social', payload);

    const socialType = [
      payload.displayType,
      payload.type,
      payload.label,
      payload.eventName,
      payload.action,
    ].join(' ');

    if (/repost/i.test(socialType)) socket.emit('repost', payload);
    if (/follow/i.test(socialType)) socket.emit('follow', payload);
    if (/share/i.test(socialType)) socket.emit('share', payload);

    console.log(`[${state.username}] social: ${summarize(payload)}`);
  }

  function safeDisconnect() {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (state.noDataTimer) {
      clearTimeout(state.noDataTimer);
      state.noDataTimer = null;
    }

    const conn = state.conn;
    state.conn = null;
    if (!conn) return;

    try {
      conn.removeAllListeners();
    } catch (err) {
      console.error('Error removiendo listeners:', err.message || err);
    }

    try {
      const ws = conn.ws || (conn.connection && conn.connection.ws) || conn.webSocket || null;
      if (ws && typeof ws.on === 'function') {
        if (typeof ws.removeAllListeners === 'function') ws.removeAllListeners('error');
        ws.on('error', () => {});
      }
    } catch (_) {}

    setTimeout(() => {
      try {
        const ws = conn.ws || (conn.connection && conn.connection.ws) || conn.webSocket || null;
        const readyState = ws ? ws.readyState : undefined;

        if (ws && readyState === 0) {
          if (typeof ws.terminate === 'function') ws.terminate();
          else if (typeof ws.close === 'function') ws.close();
          return;
        }

        if (typeof conn.disconnect === 'function') conn.disconnect();
      } catch (err) {
        console.error('Error desconectando (ignorado):', err.message || err);
      }
    }, 100);
  }

  function scheduleReconnect(username, sessionId, reason) {
    if (!state.active || state.retryCount > 10) return;
    if (!isAuthorized(username)) {
      state.active = false;
      emitUnauthorized(socket, username);
      return;
    }

    state.retryCount++;
    console.log(`Reconectando @${username} (${state.retryCount}/10): ${reason}`);
    socket.emit('error', reason);
    state.reconnectTimer = setTimeout(
      () => connectToTikTok(username, sessionId),
      3000 + state.retryCount * 1000
    );
  }

  function connectToTikTok(username, sessionId) {
    if (!state.active) return;
    const clean = cleanUsername(username);

    if (!isAuthorized(clean)) {
      state.active = false;
      emitUnauthorized(socket, clean);
      return;
    }

    if (state.retryCount > 10) {
      console.error(`Maximo de reintentos alcanzado para @${clean}`);
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
        uniqueId: clean,
        apiKey,
        mode: 'relayed',
      });

      state.conn = conn;
      let hasReceivedData = false;

      function markData() {
        hasReceivedData = true;
      }

      conn.on('error', (err) => {
        console.error(`TikTokLive error en @${clean}:`, err && err.message ? err.message : err);
      });

      conn.on('chat', (data) => {
        markData();
        emitEvent('comment', data);
      });
      conn.on('comment', (data) => {
        markData();
        emitEvent('comment', data);
      });
      conn.on('gift', (data) => {
        markData();
        const payload = normalizePayload('gift', data);
        const shouldEmit = payload.repeatEnd || payload.giftType !== 1;
        if (shouldEmit) emitEvent('gift', payload);
      });
      conn.on('giftCombo', (data) => {
        markData();
        emitEvent('gift', data);
      });
      conn.on('like', (data) => {
        markData();
        emitEvent('like', data);
      });
      conn.on('follow', (data) => {
        markData();
        emitEvent('follow', data);
      });
      conn.on('share', (data) => {
        markData();
        emitEvent('share', data);
      });
      conn.on('social', (data) => {
        markData();
        emitSocial(data);
      });
      conn.on('repost', (data) => {
        markData();
        emitEvent('repost', data);
      });
      conn.on('member', (data) => {
        markData();
        emitEvent('member', data);
      });
      conn.on('subscribe', (data) => {
        markData();
        emitEvent('subscribe', data);
      });

      ['disconnected', 'close', 'streamEnd'].forEach((eventName) => {
        conn.on(eventName, () => {
          console.log(`Evento ${eventName} en @${clean}`);
          scheduleReconnect(clean, sessionId, 'TikTok Connection Lost - Retrying');
        });
      });

      conn
        .connect()
        .then(() => {
          console.log(`Conectado a @${clean}`);
          state.retryCount = 0;
          socket.emit('connected', { username: clean, message: `Conectado a @${clean}` });

          if (NO_DATA_RECONNECT_MS > 0) {
            state.noDataTimer = setTimeout(() => {
              if (!hasReceivedData && state.active) {
                scheduleReconnect(clean, sessionId, 'No data received - Retrying');
              }
            }, NO_DATA_RECONNECT_MS);
          }
        })
        .catch((err) => {
          console.error(`Error conectando a @${clean}:`, err.message || err);
          scheduleReconnect(clean, sessionId, err.message || 'Error de conexion');
        });
    } catch (err) {
      console.error('Error creando conexion:', err.message || err);
      socket.emit('error', 'Error creando conexion');
    }
  }

  socket.on('join', (username, sessionId) => {
    const clean = cleanUsername(username);
    console.log(`Intento de conexion de: @${clean}`);

    if (!isAuthorized(clean)) {
      emitUnauthorized(socket, clean);
      return;
    }

    console.log(`Usuario autorizado: @${clean}`);
    state.active = true;
    state.username = clean;
    state.retryCount = 0;
    connectToTikTok(clean, sessionId);
  });

  socket.on('disconnect', () => {
    console.log('Desconexion de socket');
    state.active = false;
    safeDisconnect();
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err);
  });
});

process.on('uncaughtException', (err) => {
  if (err && err.message && err.message.includes('WebSocket was closed before the connection was established')) {
    console.error('Excepcion no atrapada ignorada:', err.message);
    return;
  }
  console.error('Excepcion no atrapada:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Promesa rechazada no manejada:', reason);
});

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor privado en puerto ${PORT}`);
});
