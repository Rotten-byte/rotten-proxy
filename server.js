const { TikTokLive } = require('@tiktool/live');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const SERVICE_NAME = 'Rotten Proxy AFK';
const GIFT_MODE = 'final-gifts-dedupe-totals-v2';

const app = express();
const httpServer = http.createServer(app);

function envNumber(name, defaultValue) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : defaultValue;
}

function envBoolean(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['true', '1', 'yes', 'y', 'si', 'sí'].includes(String(value).trim().toLowerCase());
}

const PORT = process.env.PORT || 8080;
const MAX_RETRIES = envNumber('MAX_RETRIES', 10);
const RECONNECT_BASE_MS = envNumber('RECONNECT_BASE_MS', 3000);
const RECONNECT_STEP_MS = envNumber('RECONNECT_STEP_MS', 1000);
const NO_DATA_RECONNECT_MS = envNumber('NO_DATA_RECONNECT_MS', 0);
const GIFT_DEDUPE_MS = envNumber('GIFT_DEDUPE_MS', 4000);
const EMIT_GIFT_PROGRESS = envBoolean('EMIT_GIFT_PROGRESS', false);

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
  return envBoolean('ALLOW_ALL_USERS', false);
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
  const message = `@${clean} no esta autorizado para usar este bot`;
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
    service: SERVICE_NAME,
    message: 'running',
    giftMode: GIFT_MODE,
    authorizedUsersCount: getAuthorizedUsers().length,
    allowAllUsers: allowAllUsers(),
  });
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    uptime: process.uptime(),
    giftMode: GIFT_MODE,
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

function firstObject(...values) {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  return {};
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') continue;
    const text = String(value || '').trim();
    if (text && text !== 'null' && text !== 'undefined') return text;
  }
  return '';
}

function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const number = Number(value.trim().replace(/,/g, ''));
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = numberValue(value);
    if (number !== null && number > 0) return Math.floor(number);
  }
  return 0;
}

function firstFiniteNumber(defaultValue, ...values) {
  for (const value of values) {
    const number = numberValue(value);
    if (number !== null) return Math.floor(number);
  }
  return defaultValue;
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'bigint') return value !== 0n;
  if (typeof value !== 'string') return null;

  const text = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'si', 'sí'].includes(text)) return true;
  if (['false', '0', 'no', 'n'].includes(text)) return false;
  return null;
}

function firstBoolean(defaultValue, ...values) {
  for (const value of values) {
    const bool = booleanValue(value);
    if (bool !== null) return bool;
  }
  return defaultValue;
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
      imageUrlValue(value.giftImage) ||
      imageUrlValue(value.image) ||
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

function normalizePayload(type, rawData, options = {}) {
  const data = clone(rawData);
  const user = firstObject(data.user, data.userInfo, data.author, data.sender, data.fromUser, data.userDetails);
  const gift = firstObject(data.gift, data.giftInfo, data.giftDetails, data.giftExtra);
  const giftDetails = firstObject(data.giftDetails, data.giftInfo, data.extendedGiftInfo, data.gift, data.giftExtra);
  const common = firstObject(data.common, data.commonInfo);

  data.uniqueId = firstString(
    data.uniqueId,
    data.username,
    data.unique_id,
    user.uniqueId,
    user.username,
    user.unique_id,
    user.displayId,
    user.id
  );
  data.nickname = firstString(
    data.nickname,
    data.displayName,
    data.nickName,
    user.nickname,
    user.nickName,
    user.displayName,
    data.uniqueId
  );
  data.userId = firstString(data.userId, data.user_id, data.userID, user.userId, user.user_id, user.id, user.idStr);
  data.msgId = firstString(data.msgId, data.messageId, data.msg_id, common.msgId, common.messageId, common.msg_id);
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
      user.avatarLarger,
      user.avatarLarge
    ),
    data.profilePictureUrl,
    data.avatarUrl,
    user.profilePictureUrl,
    user.avatarUrl
  );

  if (type === 'like') {
    data.likeCount = firstPositiveNumber(data.likeCount, data.like_count, data.count, data.likes, data.likeCountSinceLast, 1) || 1;
  }

  if (type === 'gift') {
    const source = options.source || data.eventSource || 'gift';
    data.eventSource = source;

    data.giftName = firstString(
      data.giftName,
      data.gift_name,
      data.giftTitle,
      data.gift_title,
      gift.giftName,
      gift.gift_name,
      gift.name,
      gift.title,
      giftDetails.giftName,
      giftDetails.gift_name,
      giftDetails.name,
      giftDetails.title,
      'regalo'
    );

    data.giftId = firstPositiveNumber(
      data.giftId,
      data.gift_id,
      gift.giftId,
      gift.gift_id,
      gift.id,
      giftDetails.giftId,
      giftDetails.gift_id,
      giftDetails.id
    );
    data.gift_id = data.giftId;

    data.giftType = firstFiniteNumber(
      0,
      data.giftType,
      data.gift_type,
      gift.giftType,
      gift.gift_type,
      giftDetails.giftType,
      giftDetails.gift_type
    );
    data.gift_type = data.giftType;

    const repeatCount = firstPositiveNumber(
      data.repeatCount,
      data.repeat_count,
      data.giftRepeatCount,
      data.gift_repeat_count,
      data.comboCount,
      data.combo_count,
      data.groupCount,
      data.group_count,
      data.quantity,
      data.amount,
      data.count,
      gift.repeatCount,
      gift.repeat_count,
      gift.giftRepeatCount,
      gift.gift_repeat_count,
      gift.comboCount,
      gift.combo_count,
      gift.groupCount,
      gift.group_count,
      gift.quantity,
      gift.amount,
      gift.count,
      giftDetails.repeatCount,
      giftDetails.repeat_count,
      giftDetails.giftRepeatCount,
      giftDetails.gift_repeat_count,
      giftDetails.comboCount,
      giftDetails.combo_count,
      giftDetails.quantity,
      giftDetails.amount,
      giftDetails.count,
      1
    ) || 1;

    data.repeatCount = repeatCount;
    data.repeat_count = repeatCount;
    data.giftRepeatCount = repeatCount;
    data.gift_repeat_count = repeatCount;
    data.comboCount = repeatCount;
    data.combo_count = repeatCount;
    data.quantity = repeatCount;
    data.amount = repeatCount;
    data.count = repeatCount;

    const explicitRepeatEnd = firstBoolean(
      null,
      data.repeatEnd,
      data.repeat_end,
      data.giftRepeatEnd,
      data.gift_repeat_end,
      data.isFinal,
      data.is_final,
      data.streakEnd,
      data.streak_end,
      gift.repeatEnd,
      gift.repeat_end,
      gift.giftRepeatEnd,
      gift.gift_repeat_end,
      gift.isFinal,
      gift.is_final,
      gift.streakEnd,
      gift.streak_end,
      giftDetails.repeatEnd,
      giftDetails.repeat_end,
      giftDetails.giftRepeatEnd,
      giftDetails.gift_repeat_end,
      giftDetails.isFinal,
      giftDetails.is_final,
      giftDetails.streakEnd,
      giftDetails.streak_end
    );
    const repeatEnd = explicitRepeatEnd === null ? true : explicitRepeatEnd;

    data.repeatEnd = repeatEnd;
    data.repeat_end = repeatEnd;
    data.giftRepeatEnd = repeatEnd;
    data.gift_repeat_end = repeatEnd;
    data.isFinal = repeatEnd;
    data.is_final = repeatEnd;
    data.isStreakInProgress = data.giftType === 1 && repeatEnd === false;

    const unitDiamonds = firstPositiveNumber(
      data.diamondCount,
      data.diamond_count,
      data.diamondValue,
      data.diamond_value,
      data.diamond,
      data.diamonds,
      gift.diamondCount,
      gift.diamond_count,
      gift.diamondValue,
      gift.diamond_value,
      gift.diamond,
      gift.diamonds,
      giftDetails.diamondCount,
      giftDetails.diamond_count,
      giftDetails.diamondValue,
      giftDetails.diamond_value,
      giftDetails.diamond,
      giftDetails.diamonds,
      data.giftPrice,
      data.gift_price,
      gift.giftPrice,
      gift.gift_price,
      giftDetails.giftPrice,
      giftDetails.gift_price,
      data.price,
      gift.price,
      giftDetails.price,
      data.cost,
      gift.cost,
      giftDetails.cost,
      data.coin,
      gift.coin,
      giftDetails.coin,
      data.coins,
      gift.coins,
      giftDetails.coins
    );

    const rawTotalDiamonds = firstPositiveNumber(
      data.totalDiamonds,
      data.total_diamonds,
      data.totalDiamondCount,
      data.total_diamond_count,
      data.totalCoins,
      data.total_coins,
      data.eventDiamonds,
      data.event_diamonds,
      data.finalDiamonds,
      data.final_diamonds,
      gift.totalDiamonds,
      gift.total_diamonds,
      gift.totalDiamondCount,
      gift.total_diamond_count,
      gift.totalCoins,
      gift.total_coins,
      giftDetails.totalDiamonds,
      giftDetails.total_diamonds,
      giftDetails.totalDiamondCount,
      giftDetails.total_diamond_count,
      giftDetails.totalCoins,
      giftDetails.total_coins
    );
    const calculatedTotal = unitDiamonds > 0 ? unitDiamonds * repeatCount : 0;
    const totalDiamonds = rawTotalDiamonds || calculatedTotal;

    data.unitDiamonds = unitDiamonds;
    data.unitDiamondCount = unitDiamonds;
    data.diamondCount = unitDiamonds;
    data.diamond_count = unitDiamonds;
    data.diamondValue = unitDiamonds;
    data.diamond_value = unitDiamonds;
    data.totalDiamonds = totalDiamonds;
    data.total_diamonds = totalDiamonds;
    data.totalCoins = totalDiamonds;
    data.total_coins = totalDiamonds;
    data.eventDiamonds = totalDiamonds;
    data.event_diamonds = totalDiamonds;
    data.giftPictureUrl = firstImageUrl(
      data.giftPictureUrl,
      data.giftImage,
      data.image,
      gift.giftPictureUrl,
      gift.giftImage,
      gift.image,
      giftDetails.giftPictureUrl,
      giftDetails.giftImage,
      giftDetails.image
    );
  }

  return data;
}

function summarize(data) {
  return JSON.stringify(data).replace(/\s+/g, ' ').slice(0, 350);
}

function newGiftTotals() {
  return {
    giftEvents: 0,
    giftUnits: 0,
    diamonds: 0,
  };
}

function publicGiftTotals(totals) {
  return {
    giftEvents: totals.giftEvents,
    giftUnits: totals.giftUnits,
    diamonds: totals.diamonds,
  };
}

function giftIdentity(payload) {
  const msgId = firstString(
    payload.msgId,
    payload.messageId,
    payload.message_id,
    payload.eventId,
    payload.event_id
  );
  if (msgId) return { key: `msg:${msgId}`, strong: true };

  const userKey = firstString(payload.userId, payload.uniqueId, payload.nickname, 'user').toLowerCase();
  const giftKey = payload.giftId > 0
    ? `id:${payload.giftId}`
    : `name:${String(payload.giftName || 'gift').toLowerCase()}`;
  const count = firstPositiveNumber(payload.repeatCount, payload.comboCount, payload.count, 1) || 1;
  const total = firstPositiveNumber(payload.totalDiamonds, payload.eventDiamonds, 0);

  return {
    key: `fallback:${userKey}|${giftKey}|${count}|${total}`,
    strong: false,
  };
}

io.on('connection', (socket) => {
  const state = {
    conn: null,
    username: null,
    active: false,
    retryCount: 0,
    reconnectTimer: null,
    noDataTimer: null,
    recentFinalGifts: new Map(),
    totals: newGiftTotals(),
  };

  console.log('Nueva conexion desde la app');
  socket.emit('hello', { ok: true, service: SERVICE_NAME, giftMode: GIFT_MODE });

  function cleanupRecentFinalGifts() {
    const now = Date.now();
    for (const [key, item] of state.recentFinalGifts.entries()) {
      if (now - item.at > GIFT_DEDUPE_MS) state.recentFinalGifts.delete(key);
    }
  }

  function shouldSkipFinalGift(payload) {
    cleanupRecentFinalGifts();
    const identity = giftIdentity(payload);
    const seen = state.recentFinalGifts.get(identity.key);
    if (!seen) return false;

    if (identity.strong) return true;
    return seen.source !== payload.eventSource;
  }

  function markFinalGift(payload) {
    cleanupRecentFinalGifts();
    const identity = giftIdentity(payload);
    state.recentFinalGifts.set(identity.key, {
      at: Date.now(),
      source: payload.eventSource,
    });
  }

  function attachAndAddGiftTotals(payload) {
    state.totals.giftEvents += 1;
    state.totals.giftUnits += firstPositiveNumber(payload.repeatCount, payload.comboCount, payload.count, 1) || 1;
    state.totals.diamonds += firstPositiveNumber(payload.totalDiamonds, payload.eventDiamonds, 0);

    const totals = publicGiftTotals(state.totals);
    payload.sessionTotals = totals;
    payload.sessionGiftEvents = totals.giftEvents;
    payload.sessionGiftUnits = totals.giftUnits;
    payload.sessionTotalDiamonds = totals.diamonds;
    return totals;
  }

  function emitEvent(eventName, rawData) {
    const payload = normalizePayload(eventName, rawData);
    socket.emit(eventName, payload);
    if (!['comment', 'chat', 'like'].includes(eventName)) {
      console.log(`[${state.username}] ${eventName}: ${summarize(payload)}`);
    }
  }

  function emitGift(rawData, source) {
    const payload = normalizePayload('gift', rawData, { source });

    if (payload.isStreakInProgress) {
      if (EMIT_GIFT_PROGRESS) socket.emit('giftProgress', payload);
      console.log(`[${state.username}] gift/${source} progreso ignorado para suma: ${summarize(payload)}`);
      return;
    }

    if (shouldSkipFinalGift(payload)) {
      console.log(`[${state.username}] gift/${source} duplicado ignorado: ${summarize(payload)}`);
      return;
    }

    markFinalGift(payload);
    const totals = attachAndAddGiftTotals(payload);

    socket.emit('gift', payload);
    socket.emit('giftTotal', {
      username: state.username,
      totals,
    });
    console.log(`[${state.username}] gift/${source}: ${summarize(payload)}`);
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
    state.recentFinalGifts.clear();
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
    if (!state.active || state.retryCount >= MAX_RETRIES) return;
    if (state.reconnectTimer) return;

    if (!isAuthorized(username)) {
      state.active = false;
      emitUnauthorized(socket, username);
      return;
    }

    state.retryCount += 1;
    const delay = RECONNECT_BASE_MS + state.retryCount * RECONNECT_STEP_MS;

    console.log(`Reconectando @${username} (${state.retryCount}/${MAX_RETRIES}): ${reason}`);
    socket.emit('error', reason);
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      connectToTikTok(username, sessionId);
    }, delay);
  }

  function connectToTikTok(username, sessionId) {
    if (!state.active) return;
    const clean = cleanUsername(username);

    if (!isAuthorized(clean)) {
      state.active = false;
      emitUnauthorized(socket, clean);
      return;
    }

    if (state.retryCount >= MAX_RETRIES) {
      console.error(`Maximo de reintentos alcanzado para @${clean}`);
      socket.emit('error', 'Max retries exceeded');
      state.active = false;
      return;
    }

    safeDisconnect();

    const apiKey = getApiKey();
    if (!apiKey) {
      socket.emit('error', 'No API Key en Railway');
      state.active = false;
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
        emitGift(data, 'gift');
      });
      conn.on('giftCombo', (data) => {
        markData();
        emitGift(data, 'giftCombo');
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
          socket.emit('connected', {
            username: clean,
            message: `Conectado a @${clean}`,
            giftMode: GIFT_MODE,
            totals: publicGiftTotals(state.totals),
          });

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
    state.totals = newGiftTotals();
    state.recentFinalGifts.clear();
    socket.emit('giftTotal', {
      username: clean,
      totals: publicGiftTotals(state.totals),
    });
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

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor privado en puerto ${PORT}`);
});
