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
const STREAM_ELEMENTS_WS_URL = process.env.STREAMELEMENTS_WS_URL || 'wss://astro.streamelements.com/';
const STREAM_ELEMENTS_RECONNECT_BASE_MS = envNumber('STREAMELEMENTS_RECONNECT_BASE_MS', 3000);
const STREAM_ELEMENTS_RECONNECT_MAX_MS = envNumber('STREAMELEMENTS_RECONNECT_MAX_MS', 30000);
const STREAM_ELEMENTS_TIP_DEDUPE_MS = envNumber('STREAMELEMENTS_TIP_DEDUPE_MS', 10 * 60 * 1000);
const STREAM_ELEMENTS_DEBUG = envBoolean('STREAMELEMENTS_DEBUG', false);
const STREAM_ELEMENTS_EMIT_PENDING_TIPS = envBoolean('STREAMELEMENTS_EMIT_PENDING_TIPS', false);
const STREAM_ELEMENTS_TOPICS = ['channel.tips', 'channel.activities', 'channel.tips.moderation'];

const diagnostics = {
  startedAt: new Date().toISOString(),
  connectedSockets: 0,
  lastStreamElementsStatus: null,
  lastStreamElementsMessage: null,
  lastStreamElementsError: null,
  lastStreamElementsClose: null,
  lastStreamElementsIgnoredTip: null,
  lastStreamElementsTip: null,
};
const recentGlobalStreamElementsTips = new Map();

function cleanUsername(username) {
  return String(username || '')
    .trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?tiktok\.com\/@/i, '')
    .split(/[/?#\s]/)[0]
    .toLowerCase();
}

function cleanStreamElementsChannel(input) {
  let value = String(input || '').trim();
  if (!value) return '';

  value = value.split('#')[0].split('?')[0].trim().replace(/^@/, '');
  const marker = 'streamelements.com/';
  const markerIndex = value.toLowerCase().indexOf(marker);
  if (markerIndex >= 0) value = value.slice(markerIndex + marker.length);

  value = value.replace(/^\/+|\/+$/g, '');
  if (value.includes('/')) value = value.split('/')[0];
  value = value.replace(/^@/, '').trim().toLowerCase();

  if (value === 'tip' || value === 'dashboard') return '';
  return value.replace(/[^a-z0-9_.-]/g, '');
}

function getDefaultStreamElementsChannel() {
  return cleanStreamElementsChannel(
    process.env.STREAMELEMENTS_CHANNEL ||
      process.env.STREAM_ELEMENTS_CHANNEL ||
      process.env.STREAMELEMENTS_USERNAME ||
      process.env.STREAM_ELEMENTS_USERNAME ||
      ''
  );
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
    streamElementsConfigured: hasStreamElementsToken(),
    streamElementsConfiguredChannels: getConfiguredStreamElementsChannels(),
    streamElementsDefaultChannel: getDefaultStreamElementsChannel(),
    streamElementsTopic: 'channel.tips',
  });
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    uptime: process.uptime(),
    giftMode: GIFT_MODE,
    authorizedUsersCount: getAuthorizedUsers().length,
    allowAllUsers: allowAllUsers(),
    streamElementsConfigured: hasStreamElementsToken(),
    streamElementsConfiguredChannels: getConfiguredStreamElementsChannels(),
    streamElementsDefaultChannel: getDefaultStreamElementsChannel(),
    streamElementsTopic: 'channel.tips',
    connectedSockets: diagnostics.connectedSockets,
    lastStreamElementsStatus: diagnostics.lastStreamElementsStatus,
    lastStreamElementsMessage: diagnostics.lastStreamElementsMessage,
    lastStreamElementsError: diagnostics.lastStreamElementsError,
    lastStreamElementsClose: diagnostics.lastStreamElementsClose,
    lastStreamElementsIgnoredTip: diagnostics.lastStreamElementsIgnoredTip,
    lastStreamElementsTip: diagnostics.lastStreamElementsTip,
  });
});

app.get('/debug/paypal-test', (req, res) => {
  const secret = firstString(process.env.PAYPAL_TEST_SECRET, process.env.DEBUG_SECRET);
  const requestedSecret = firstString(req.query.secret);

  if (secret && requestedSecret !== secret) {
    res.status(401).json({ ok: false, message: 'PAYPAL_TEST_SECRET incorrecto' });
    return;
  }

  if (!secret && !envBoolean('ENABLE_PAYPAL_TEST_ENDPOINT', false)) {
    res.status(403).json({
      ok: false,
      message: 'Activa ENABLE_PAYPAL_TEST_ENDPOINT=true o configura PAYPAL_TEST_SECRET para usar esta prueba',
    });
    return;
  }

  const channel = cleanStreamElementsChannel(req.query.channel || getDefaultStreamElementsChannel());
  const rawAmount = firstString(req.query.amount, '$5 USD');
  const currency = firstString(req.query.currency, 'USD').toUpperCase();
  const amountValue = numberValue(rawAmount);
  const amountText = formatDonationAmount(amountValue, currency, rawAmount);
  const username = firstString(req.query.username, 'PruebaPayPal');
  const message = firstString(req.query.message, 'Prueba de alerta desde el server');
  const id = `debug-${Date.now()}`;

  const payload = {
    id,
    eventId: id,
    source: 'streamelements',
    provider: 'paypal',
    paymentMethod: 'paypal',
    status: 'success',
    approved: 'allowed',
    username,
    nickname: username,
    uniqueId: username,
    displayName: username,
    message,
    amount: amountValue !== null ? amountValue : amountText,
    amountText,
    formattedAmount: amountText,
    displayAmount: amountText,
    amountValue,
    currency,
    profilePictureUrl: '',
    avatarUrl: '',
    streamElementsChannel: channel,
    streamElementsRoom: 'debug',
    createdAt: new Date().toISOString(),
  };

  diagnostics.lastStreamElementsTip = {
    at: new Date().toISOString(),
    debug: true,
    connectedSockets: diagnostics.connectedSockets,
    username: payload.username,
    amount: payload.amount,
    amountText: payload.amountText,
    message: payload.message,
    channel: payload.streamElementsChannel,
    topic: 'debug',
  };

  io.emit('streamelementsTip', payload);
  res.status(200).json({
    ok: true,
    emittedTo: diagnostics.connectedSockets,
    event: 'streamelementsTip',
    payload,
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
    process.env.TIKTOOL_API_KEY6,
    process.env.TIKTOOL_API_KEY7,
    process.env.TIKTOOL_API_KEY8,
    process.env.TIKTOOL_API_KEY9,
    process.env.TIKTOOL_API_KEY10,
    process.env.TIKTOOL_API_KEY11,
    process.env.TIKTOOL_API_KEY12,
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

function textValue(value) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    const text = String(value || '').trim();
    return text && text !== 'null' && text !== 'undefined' ? text : '';
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return firstString(value.message, value.text, value.body, value.content, value.value, value.note, value.comment);
  }

  return '';
}

function firstText(...values) {
  for (const value of values) {
    const text = textValue(value);
    if (text) return text;
  }
  return '';
}

function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const match = value.trim().replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    const number = match ? Number(match[0]) : NaN;
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function firstNumberValue(...values) {
  for (const value of values) {
    const number = numberValue(value);
    if (number !== null) return number;
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

function normalizeStreamElementsTokenType(value, defaultValue = 'jwt') {
  const tokenType = String(value || defaultValue || 'jwt').trim().toLowerCase();
  return ['jwt', 'apikey', 'oauth2'].includes(tokenType) ? tokenType : 'jwt';
}

function streamElementsEnvSuffix(channel) {
  return cleanStreamElementsChannel(channel).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function tokenConfigFromValue(value, source, fallbackTokenType = 'jwt') {
  if (typeof value === 'string') {
    const token = value.trim();
    return token ? { token, tokenType: normalizeStreamElementsTokenType(fallbackTokenType), room: '', source } : null;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const jwt = firstString(value.token, value.jwt, value.JWT);
  const apiKey = firstString(value.apiKey, value.apikey, value.api_key, value.overlayToken, value.overlay_token);
  const oauth2 = firstString(value.oauth2, value.oauthToken, value.oauth_token, value.accessToken, value.access_token);
  const token = firstString(jwt, apiKey, oauth2);
  if (!token) return null;

  const explicitType = firstString(value.tokenType, value.token_type, value.type);
  const tokenType = normalizeStreamElementsTokenType(
    explicitType || (apiKey ? 'apikey' : oauth2 ? 'oauth2' : 'jwt')
  );

  return {
    token,
    tokenType,
    room: firstString(value.room, value.channelId, value.channel_id, value.channelRoom, value.channel_room),
    source,
  };
}

function getStreamElementsTokensJson() {
  const raw = firstString(process.env.STREAMELEMENTS_TOKENS_JSON, process.env.STREAM_ELEMENTS_TOKENS_JSON);
  const map = new Map();
  if (!raw) return map;

  try {
    const parsed = JSON.parse(raw);
    const addEntry = (channelInput, config) => {
      const channel = cleanStreamElementsChannel(channelInput);
      const tokenConfig = tokenConfigFromValue(config, 'tokens_json');
      if (channel && tokenConfig) map.set(channel, tokenConfig);
    };

    if (Array.isArray(parsed)) {
      parsed.forEach((item) => {
        const channel = firstString(
          item && item.channel,
          item && item.username,
          item && item.user,
          item && item.tipLink,
          item && item.tip_link,
          item && item.url,
          item && item.link
        );
        addEntry(channel, item);
      });
    } else if (parsed && typeof parsed === 'object') {
      Object.entries(parsed).forEach(([channel, config]) => addEntry(channel, config));
    }
  } catch (err) {
    console.error('STREAMELEMENTS_TOKENS_JSON invalido:', err.message || err);
  }

  return map;
}

function getStreamElementsChannelEnvAuth(channel) {
  const suffix = streamElementsEnvSuffix(channel);
  if (!suffix) return null;

  const jwt = firstString(
    process.env[`STREAMELEMENTS_TOKEN_${suffix}`],
    process.env[`STREAM_ELEMENTS_TOKEN_${suffix}`],
    process.env[`STREAMELEMENTS_JWT_${suffix}`],
    process.env[`STREAM_ELEMENTS_JWT_${suffix}`]
  );
  const apiKey = firstString(
    process.env[`STREAMELEMENTS_API_KEY_${suffix}`],
    process.env[`STREAM_ELEMENTS_API_KEY_${suffix}`],
    process.env[`STREAMELEMENTS_OVERLAY_TOKEN_${suffix}`],
    process.env[`STREAM_ELEMENTS_OVERLAY_TOKEN_${suffix}`]
  );
  const oauth2 = firstString(
    process.env[`STREAMELEMENTS_OAUTH_TOKEN_${suffix}`],
    process.env[`STREAM_ELEMENTS_OAUTH_TOKEN_${suffix}`]
  );
  const token = firstString(jwt, apiKey, oauth2);
  if (!token) return null;

  return {
    token,
    tokenType: normalizeStreamElementsTokenType(
      firstString(
        process.env[`STREAMELEMENTS_TOKEN_TYPE_${suffix}`],
        process.env[`STREAM_ELEMENTS_TOKEN_TYPE_${suffix}`]
      ) || (apiKey ? 'apikey' : oauth2 ? 'oauth2' : 'jwt')
    ),
    room: firstString(
      process.env[`STREAMELEMENTS_ROOM_${suffix}`],
      process.env[`STREAM_ELEMENTS_ROOM_${suffix}`],
      process.env[`STREAMELEMENTS_CHANNEL_ID_${suffix}`],
      process.env[`STREAM_ELEMENTS_CHANNEL_ID_${suffix}`]
    ),
    source: `env_${suffix}`,
  };
}

function getGlobalStreamElementsAuth() {
  const jwt = firstString(
    process.env.STREAMELEMENTS_TOKEN,
    process.env.STREAM_ELEMENTS_TOKEN,
    process.env.STREAMELEMENTS_JWT,
    process.env.STREAM_ELEMENTS_JWT
  );
  const apiKey = firstString(
    process.env.STREAMELEMENTS_API_KEY,
    process.env.STREAM_ELEMENTS_API_KEY,
    process.env.STREAMELEMENTS_OVERLAY_TOKEN,
    process.env.STREAM_ELEMENTS_OVERLAY_TOKEN
  );
  const oauth2 = firstString(
    process.env.STREAMELEMENTS_OAUTH_TOKEN,
    process.env.STREAM_ELEMENTS_OAUTH_TOKEN
  );
  const token = firstString(jwt, apiKey, oauth2);
  if (!token) return null;

  return {
    token,
    tokenType: normalizeStreamElementsTokenType(
      firstString(process.env.STREAMELEMENTS_TOKEN_TYPE, process.env.STREAM_ELEMENTS_TOKEN_TYPE) ||
        (apiKey ? 'apikey' : oauth2 ? 'oauth2' : 'jwt')
    ),
    room: getGlobalStreamElementsRoom(),
    source: 'global_env',
  };
}

function getStreamElementsAuth(channelInput = '') {
  const channel = cleanStreamElementsChannel(channelInput);
  if (channel) {
    const mappedAuth = getStreamElementsTokensJson().get(channel);
    if (mappedAuth) return mappedAuth;

    const envAuth = getStreamElementsChannelEnvAuth(channel);
    if (envAuth) return envAuth;
  }

  return getGlobalStreamElementsAuth();
}

function getConfiguredStreamElementsChannels() {
  const channels = new Set(getStreamElementsTokensJson().keys());

  Object.keys(process.env).forEach((key) => {
    if (/TOKEN_TYPE|ROOM|CHANNEL_ID/.test(key)) return;
    const match = key.match(/^STREAM_?ELEMENTS_(?:TOKEN|JWT|API_KEY|OVERLAY_TOKEN|OAUTH_TOKEN)_([A-Z0-9_]+)$/);
    if (match && match[1]) channels.add(match[1].toLowerCase());
  });

  return Array.from(channels).sort();
}

function hasStreamElementsToken(channelInput = '') {
  return Boolean(getStreamElementsAuth(channelInput)) || getConfiguredStreamElementsChannels().length > 0;
}

function getGlobalStreamElementsRoom() {
  return firstString(
    process.env.STREAMELEMENTS_ROOM,
    process.env.STREAM_ELEMENTS_ROOM,
    process.env.STREAMELEMENTS_CHANNEL_ID,
    process.env.STREAM_ELEMENTS_CHANNEL_ID
  );
}

function getStreamElementsRoom(channelInput = '') {
  const auth = getStreamElementsAuth(channelInput);
  return firstString(auth && auth.room, getGlobalStreamElementsRoom());
}

function getWebSocketRuntime() {
  try {
    return { ctor: require('ws'), name: 'ws' };
  } catch (_) {
    if (typeof globalThis.WebSocket === 'function') {
      return { ctor: globalThis.WebSocket, name: 'global' };
    }
  }
  return null;
}

function getWebSocketCtor() {
  const runtime = getWebSocketRuntime();
  return runtime ? runtime.ctor : null;
}

function addWebSocketListener(ws, eventName, handler) {
  if (typeof ws.on === 'function') {
    ws.on(eventName, handler);
    return;
  }

  if (typeof ws.addEventListener === 'function') {
    ws.addEventListener(eventName, (event) => {
      handler(event && Object.prototype.hasOwnProperty.call(event, 'data') ? event.data : event, event);
    });
    return;
  }
}

function sendWebSocketJson(ws, payload) {
  try {
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify(payload));
    return true;
  } catch (err) {
    console.error('Error enviando mensaje a StreamElements:', err.message || err);
    return false;
  }
}

function buildStreamElementsUrl(reconnectToken) {
  if (!reconnectToken) return STREAM_ELEMENTS_WS_URL;
  const separator = STREAM_ELEMENTS_WS_URL.includes('?') ? '&' : '?';
  return `${STREAM_ELEMENTS_WS_URL}${separator}reconnect_token=${encodeURIComponent(reconnectToken)}`;
}

function parseStreamElementsMessage(raw) {
  try {
    if (Buffer.isBuffer(raw)) return JSON.parse(raw.toString('utf8'));
    if (typeof raw === 'string') return JSON.parse(raw);
    if (raw && typeof raw === 'object' && typeof raw.toString === 'function') {
      return JSON.parse(raw.toString());
    }
  } catch (err) {
    console.error('Mensaje StreamElements invalido:', err.message || err);
  }
  return null;
}

function moneyText(amount) {
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0+$/g, '').replace(/\.$/g, '');
}

function formatDonationAmount(amountValue, currency, ...fallbacks) {
  const fallback = firstString(...fallbacks);
  const code = firstString(currency).toUpperCase();
  const amount = numberValue(amountValue);
  if (amount === null) return fallback || '';

  const text = moneyText(amount);
  if (code === 'USD' || code === 'MXN') return `$${text} ${code}`;
  return code ? `${text} ${code}` : text;
}

function normalizeStreamElementsTip(rawMessage, configuredChannel) {
  const tipData = firstObject(rawMessage.data, rawMessage.payload, rawMessage);
  const activityData = firstObject(tipData.data, tipData.activity, tipData.details);
  const donation = firstObject(tipData.donation, activityData.donation, tipData.tip, activityData.tip, tipData);
  const donor = firstObject(donation.user, activityData.user, tipData.user, donation.donor, activityData.donor, tipData.donor, activityData);
  const donationAmount = firstObject(donation.amount);
  const activityAmount = firstObject(activityData.amount);
  const tipAmount = firstObject(tipData.amount);
  const amountValue = firstNumberValue(
    donation.amountValue,
    donation.amount_value,
    donation.value,
    donation.tipAmount,
    donation.tip_amount,
    donation.total,
    donation.gross,
    donation.grossAmount,
    donation.gross_amount,
    donation.amount,
    donationAmount.value,
    donationAmount.amount,
    donationAmount.total,
    donationAmount.gross,
    donationAmount.grossAmount,
    donationAmount.gross_amount,
    activityData.amountValue,
    activityData.amount_value,
    activityData.value,
    activityData.tipAmount,
    activityData.tip_amount,
    activityData.total,
    activityData.gross,
    activityData.grossAmount,
    activityData.gross_amount,
    activityData.amount,
    activityAmount.value,
    activityAmount.amount,
    activityAmount.total,
    activityAmount.gross,
    activityAmount.grossAmount,
    activityAmount.gross_amount,
    tipData.amountValue,
    tipData.amount_value,
    tipData.value,
    tipData.tipAmount,
    tipData.tip_amount,
    tipData.total,
    tipData.gross,
    tipData.grossAmount,
    tipData.gross_amount,
    tipData.amount,
    tipAmount.value,
    tipAmount.amount,
    tipAmount.total,
    tipAmount.gross,
    tipAmount.grossAmount,
    tipAmount.gross_amount
  );
  const currency = firstString(
    donation.currency,
    donationAmount.currency,
    donationAmount.currencyCode,
    donationAmount.currency_code,
    activityData.currency,
    activityAmount.currency,
    activityAmount.currencyCode,
    activityAmount.currency_code,
    tipData.currency,
    tipAmount.currency,
    tipAmount.currencyCode,
    tipAmount.currency_code,
    'USD'
  ).toUpperCase();
  const amountText = formatDonationAmount(
    amountValue,
    currency,
    donation.amountText,
    donation.amount_text,
    donation.formattedAmount,
    donation.formatted_amount,
    donation.displayAmount,
    donation.display_amount,
    donationAmount.text,
    donationAmount.formatted,
    donationAmount.formattedAmount,
    donationAmount.formatted_amount,
    activityData.amountText,
    activityData.amount_text,
    activityData.formattedAmount,
    activityData.formatted_amount,
    activityData.displayAmount,
    activityData.display_amount,
    activityAmount.text,
    activityAmount.formatted,
    activityAmount.formattedAmount,
    activityAmount.formatted_amount,
    tipData.amountText,
    tipData.amount_text,
    tipData.formattedAmount,
    tipData.formatted_amount,
    tipData.displayAmount,
    tipData.display_amount,
    tipAmount.text,
    tipAmount.formatted,
    tipAmount.formattedAmount,
    tipAmount.formatted_amount
  );
  const appAmount = amountValue !== null ? amountValue : numberValue(amountText);

  if (appAmount === null && !amountText) return null;

  const username = firstString(
    donor.username,
    donor.displayName,
    donor.display_name,
    donor.name,
    donation.username,
    donation.name,
    activityData.username,
    activityData.displayName,
    activityData.display_name,
    activityData.name,
    tipData.username,
    tipData.displayName,
    tipData.display_name,
    'Alguien'
  );
  const id = firstString(
    tipData._id,
    tipData.id,
    tipData.activityId,
    tipData.activity_id,
    rawMessage.id,
    tipData.transactionId,
    tipData.transaction_id,
    donation.transactionId,
    donation.transaction_id
  );
  const streamElementsRoom = firstString(tipData.channel, donation.channel, activityData.channel, donor.channel, rawMessage.room);
  const provider = firstString(tipData.provider, donation.provider, activityData.provider, donation.paymentMethod, 'streamelements');
  const message = firstText(
    donation.message,
    donation.note,
    donation.comment,
    donation.text,
    donation.msg,
    donation.description,
    activityData.message,
    activityData.note,
    activityData.comment,
    activityData.text,
    activityData.msg,
    activityData.description,
    tipData.message,
    tipData.note,
    tipData.comment,
    tipData.text,
    tipData.msg,
    tipData.description
  );

  return {
    id: id || `${streamElementsRoom}|${username}|${amountText}|${message}|${firstString(tipData.createdAt, donation.createdAt)}`,
    eventId: id || rawMessage.id || '',
    source: 'streamelements',
    streamElementsTopic: firstString(rawMessage.topic, tipData.topic),
    type: firstString(tipData.type, activityData.type, 'tip'),
    provider,
    paymentMethod: firstString(donation.paymentMethod, activityData.paymentMethod, activityData.payment_method, tipData.paymentMethod, provider),
    status: firstString(tipData.status, donation.status, activityData.status),
    approved: firstString(tipData.approved, donation.approved, activityData.approved),
    transactionId: firstString(tipData.transactionId, tipData.transaction_id, donation.transactionId, donation.transaction_id),
    username,
    nickname: username,
    uniqueId: username,
    displayName: username,
    message,
    amount: appAmount !== null ? appAmount : amountText,
    amountText,
    formattedAmount: amountText,
    displayAmount: amountText,
    amountValue,
    currency,
    profilePictureUrl: firstImageUrl(
      donor.profilePictureUrl,
      donor.avatarUrl,
      donor.avatar,
      donor.picture,
      activityData.avatar,
      activityData.avatarUrl,
      activityData.profilePictureUrl,
      donation.profilePictureUrl,
      tipData.profilePictureUrl
    ),
    avatarUrl: firstImageUrl(donor.avatarUrl, donor.avatar, donor.picture, activityData.avatar, activityData.avatarUrl),
    streamElementsChannel: cleanStreamElementsChannel(configuredChannel),
    streamElementsRoom,
    createdAt: firstString(tipData.createdAt, donation.createdAt, activityData.createdAt, rawMessage.ts),
    updatedAt: firstString(tipData.updatedAt, donation.updatedAt, activityData.updatedAt),
  };
}

function shouldRejectStreamElementsTip(payload) {
  const status = String(payload.status || '').trim().toLowerCase();
  const approved = String(payload.approved || '').trim().toLowerCase();

  if (['failed', 'fail', 'cancelled', 'canceled', 'refunded', 'refund', 'chargeback', 'pending'].includes(status)) {
    return true;
  }
  if (approved === 'pending' && !STREAM_ELEMENTS_EMIT_PENDING_TIPS) return true;
  if (['denied', 'rejected', 'blocked', 'ignored'].includes(approved)) return true;
  return false;
}

function streamElementsTipKey(payload) {
  return firstString(
    payload.id,
    payload.eventId,
    payload.transactionId,
    `${payload.streamElementsRoom}|${payload.username}|${payload.amount}|${payload.message}|${payload.createdAt}`
  );
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
  diagnostics.connectedSockets += 1;

  const state = {
    conn: null,
    username: null,
    active: false,
    retryCount: 0,
    reconnectTimer: null,
    noDataTimer: null,
    recentFinalGifts: new Map(),
    totals: newGiftTotals(),
    streamElementsChannel: getDefaultStreamElementsChannel(),
    streamElementsWs: null,
    streamElementsRoom: '',
    streamElementsReconnectTimer: null,
    streamElementsRetryCount: 0,
    streamElementsNonce: 0,
    streamElementsSubscribeSentTopics: new Set(),
    streamElementsSubscribedTopics: new Set(),
    streamElementsSubscribeTopicByNonce: new Map(),
    streamElementsFatalError: false,
    recentStreamElementsTips: new Map(),
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

  function streamElementsChannelForSocket() {
    const configuredChannels = getConfiguredStreamElementsChannels();
    return state.streamElementsChannel ||
      getDefaultStreamElementsChannel() ||
      (configuredChannels.length === 1 ? configuredChannels[0] : '');
  }

  function emitStreamElementsStatus(payload) {
    const status = {
      at: new Date().toISOString(),
      socketId: socket.id,
      username: state.username,
      channel: streamElementsChannelForSocket(),
      room: state.streamElementsRoom,
      ...payload,
    };

    diagnostics.lastStreamElementsStatus = status;
    socket.emit('streamElementsStatus', status);
  }

  function cleanupRecentStreamElementsTips() {
    const now = Date.now();
    for (const [key, at] of state.recentStreamElementsTips.entries()) {
      if (now - at > STREAM_ELEMENTS_TIP_DEDUPE_MS) {
        state.recentStreamElementsTips.delete(key);
      }
    }
    for (const [key, at] of recentGlobalStreamElementsTips.entries()) {
      if (now - at > STREAM_ELEMENTS_TIP_DEDUPE_MS) {
        recentGlobalStreamElementsTips.delete(key);
      }
    }
  }

  function shouldSkipStreamElementsTip(payload) {
    cleanupRecentStreamElementsTips();
    const key = streamElementsTipKey(payload);
    if (recentGlobalStreamElementsTips.has(key)) return true;
    if (state.recentStreamElementsTips.has(key)) return true;
    recentGlobalStreamElementsTips.set(key, Date.now());
    state.recentStreamElementsTips.set(key, Date.now());
    return false;
  }

  function stopStreamElementsTips() {
    if (state.streamElementsReconnectTimer) {
      clearTimeout(state.streamElementsReconnectTimer);
      state.streamElementsReconnectTimer = null;
    }

    const ws = state.streamElementsWs;
    state.streamElementsWs = null;
    if (!ws) return;

    try {
      if (typeof ws.removeAllListeners === 'function') ws.removeAllListeners();
      if (ws.readyState === 0 && typeof ws.terminate === 'function') ws.terminate();
      else if (typeof ws.close === 'function') ws.close();
    } catch (err) {
      console.error('Error cerrando StreamElements WS:', err.message || err);
    }
  }

  function scheduleStreamElementsReconnect(reason, reconnectToken = '') {
    if (!state.active || state.streamElementsFatalError) return;
    if (state.streamElementsReconnectTimer) return;

    state.streamElementsRetryCount += 1;
    const delay = Math.min(
      STREAM_ELEMENTS_RECONNECT_MAX_MS,
      STREAM_ELEMENTS_RECONNECT_BASE_MS * state.streamElementsRetryCount
    );

    console.warn(`StreamElements reconectando en ${delay}ms: ${reason}`);
    emitStreamElementsStatus({
      ok: false,
      status: 'reconnecting',
      message: reason,
      retryCount: state.streamElementsRetryCount,
      retryInMs: delay,
    });

    state.streamElementsReconnectTimer = setTimeout(() => {
      state.streamElementsReconnectTimer = null;
      startStreamElementsTips(reconnectToken, false);
    }, delay);
  }

  function subscribeStreamElementsTips(ws, reconnectToken) {
    if (reconnectToken) return;

    const channel = streamElementsChannelForSocket();
    const auth = getStreamElementsAuth(channel);
    if (!auth) return;

    const room = getStreamElementsRoom(channel);
    STREAM_ELEMENTS_TOPICS.forEach((topic) => {
      if (state.streamElementsSubscribeSentTopics.has(topic)) return;

      const nonce = `${topic.replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}-${++state.streamElementsNonce}`;
      const request = {
        type: 'subscribe',
        nonce,
        data: {
          topic,
          token: auth.token,
          token_type: auth.tokenType,
        },
      };
      if (room) request.data.room = room;

      if (sendWebSocketJson(ws, request)) {
        state.streamElementsSubscribeSentTopics.add(topic);
        state.streamElementsSubscribeTopicByNonce.set(nonce, topic);
        emitStreamElementsStatus({
          ok: true,
          status: 'subscribing',
          topic,
          subscribedTopics: Array.from(state.streamElementsSubscribedTopics),
          tokenSource: auth.source,
        });
      }
    });
  }

  function handleStreamElementsMessage(ws, raw, reconnectToken) {
    if (state.streamElementsWs !== ws) return;

    const message = parseStreamElementsMessage(raw);
    if (!message) return;
    diagnostics.lastStreamElementsMessage = {
      at: new Date().toISOString(),
      type: firstString(message.type),
      topic: firstString(message.topic, message.data && message.data.topic),
      room: firstString(message.room, message.data && message.data.room),
      nonce: firstString(message.nonce),
      error: firstString(message.error),
      dataMessage: firstString(message.data && message.data.message),
    };
    if (STREAM_ELEMENTS_DEBUG) {
      console.log(`[${state.username || 'sin-live'}] StreamElements raw: ${summarize(message)}`);
    }

    if (message.type === 'welcome') {
      subscribeStreamElementsTips(ws, reconnectToken);
      return;
    }

    if (message.type === 'reconnect') {
      const token = firstString(message.data && message.data.reconnect_token);
      stopStreamElementsTips();
      startStreamElementsTips(token, false);
      return;
    }

    if (message.type === 'response') {
      const responseTopic = firstString(
        message.data && message.data.topic,
        state.streamElementsSubscribeTopicByNonce.get(firstString(message.nonce)),
        'channel.tips'
      );

      if (message.error) {
        const detail = firstString(message.data && message.data.message, message.error);
        console.error(`StreamElements subscribe error (${responseTopic}): ${message.error} ${detail}`);
        emitStreamElementsStatus({
          ok: false,
          status: 'error',
          topic: responseTopic,
          error: message.error,
          message: detail,
          subscribedTopics: Array.from(state.streamElementsSubscribedTopics),
        });

        if (responseTopic === 'channel.tips' && ['err_unauthorized', 'err_bad_request', 'invalid_message_type'].includes(message.error)) {
          state.streamElementsFatalError = true;
          stopStreamElementsTips();
        }
        return;
      }

      state.streamElementsRoom = firstString(message.data && message.data.room, state.streamElementsRoom);
      state.streamElementsRetryCount = 0;
      state.streamElementsSubscribedTopics.add(responseTopic);
      const responseAuth = getStreamElementsAuth(streamElementsChannelForSocket());
      emitStreamElementsStatus({
        ok: true,
        status: 'subscribed',
        topic: responseTopic,
        subscribedTopics: Array.from(state.streamElementsSubscribedTopics),
        tokenSource: responseAuth ? responseAuth.source : '',
      });
      console.log(
        `[${state.username || 'sin-live'}] StreamElements suscrito a ${responseTopic}` +
          `${state.streamElementsRoom ? ` room=${state.streamElementsRoom}` : ''}`
      );
      return;
    }

    const topic = firstString(message.topic, message.data && message.data.topic);
    if (message.type !== 'message' || !STREAM_ELEMENTS_TOPICS.includes(topic)) {
      return;
    }

    if (topic === 'channel.activities') {
      const activityType = firstString(message.data && message.data.type, message.data && message.data.data && message.data.data.type).toLowerCase();
      if (activityType && activityType !== 'tip') return;
    }

    const payload = normalizeStreamElementsTip(message, streamElementsChannelForSocket());
    if (!payload) return;

    if (shouldRejectStreamElementsTip(payload)) {
      diagnostics.lastStreamElementsIgnoredTip = {
        at: new Date().toISOString(),
        reason: 'status_or_moderation',
        topic,
        username: payload.username,
        amount: payload.amount,
        amountText: payload.amountText,
        message: payload.message,
        channel: payload.streamElementsChannel,
        provider: payload.provider,
        status: payload.status,
        approved: payload.approved,
      };
      console.log(`[${state.username || 'sin-live'}] tip StreamElements ignorado por estado: ${summarize(payload)}`);
      return;
    }

    if (shouldSkipStreamElementsTip(payload)) {
      diagnostics.lastStreamElementsIgnoredTip = {
        at: new Date().toISOString(),
        reason: 'duplicate',
        topic,
        username: payload.username,
        amount: payload.amount,
        amountText: payload.amountText,
        message: payload.message,
        channel: payload.streamElementsChannel,
        provider: payload.provider,
        status: payload.status,
        approved: payload.approved,
      };
      console.log(`[${state.username || 'sin-live'}] tip StreamElements duplicado ignorado: ${summarize(payload)}`);
      return;
    }

    io.emit('streamelementsTip', payload);
    diagnostics.lastStreamElementsTip = {
      at: new Date().toISOString(),
      debug: false,
      emittedTo: diagnostics.connectedSockets,
      username: payload.username,
      amount: payload.amount,
      amountText: payload.amountText,
      message: payload.message,
      channel: payload.streamElementsChannel,
      topic: payload.streamElementsTopic,
      provider: payload.provider,
      status: payload.status,
      approved: payload.approved,
    };
    console.log(`[${state.username || 'sin-live'}] streamelementsTip: ${summarize(payload)}`);
  }

  function startStreamElementsTips(reconnectToken = '', resetRetry = true) {
    const channel = streamElementsChannelForSocket();
    if (!state.active) return;

    if (!channel) {
      emitStreamElementsStatus({
        ok: false,
        status: 'missing_channel',
        message: 'Configura el usuario o link de StreamElements en la app',
      });
      return;
    }

    const auth = getStreamElementsAuth(channel);
    if (!auth) {
      state.streamElementsFatalError = true;
      emitStreamElementsStatus({
        ok: false,
        status: 'missing_token',
        message: `Falta token de StreamElements para ${channel}`,
        configuredChannels: getConfiguredStreamElementsChannels(),
      });
      return;
    }

    const webSocketRuntime = getWebSocketRuntime();
    if (!webSocketRuntime) {
      state.streamElementsFatalError = true;
      emitStreamElementsStatus({
        ok: false,
        status: 'missing_websocket',
        message: 'Este Node no tiene WebSocket global ni dependencia ws',
      });
      return;
    }

    stopStreamElementsTips();
    if (resetRetry) state.streamElementsRetryCount = 0;
    state.streamElementsFatalError = false;
    state.streamElementsRoom = '';
    state.streamElementsSubscribeSentTopics.clear();
    state.streamElementsSubscribedTopics.clear();
    state.streamElementsSubscribeTopicByNonce.clear();

    const url = buildStreamElementsUrl(reconnectToken);
    let ws;
    try {
      ws = new webSocketRuntime.ctor(url);
    } catch (err) {
      console.error('Error creando StreamElements WS:', err.message || err);
      scheduleStreamElementsReconnect(err.message || 'Error creando StreamElements WS', reconnectToken);
      return;
    }

    state.streamElementsWs = ws;
    emitStreamElementsStatus({
      ok: true,
      status: 'connecting',
      topic: 'channel.tips',
      tokenSource: auth.source,
      webSocketRuntime: webSocketRuntime.name,
    });

    addWebSocketListener(ws, 'open', () => {
      if (state.streamElementsWs !== ws) return;
      console.log(`[${state.username || 'sin-live'}] StreamElements WS conectado para ${channel}`);
      subscribeStreamElementsTips(ws, reconnectToken);
    });

    addWebSocketListener(ws, 'message', (raw) => {
      handleStreamElementsMessage(ws, raw, reconnectToken);
    });

    addWebSocketListener(ws, 'error', (err) => {
      if (state.streamElementsWs !== ws) return;
      const message = err && err.message ? err.message : 'StreamElements WS error';
      console.error('StreamElements WS error:', message);
      diagnostics.lastStreamElementsError = {
        at: new Date().toISOString(),
        message,
      };
      emitStreamElementsStatus({
        ok: false,
        status: 'error',
        message,
      });
    });

    if (typeof ws.on === 'function') {
      ws.on('unexpected-response', (_request, response) => {
        if (state.streamElementsWs !== ws) return;
        const message = `StreamElements respuesta inesperada HTTP ${response && response.statusCode}`;
        diagnostics.lastStreamElementsError = {
          at: new Date().toISOString(),
          message,
          statusCode: response && response.statusCode,
          headers: response && response.headers,
        };
        emitStreamElementsStatus({
          ok: false,
          status: 'unexpected_response',
          message,
          statusCode: response && response.statusCode,
        });
      });
    }

    addWebSocketListener(ws, 'close', (code, reasonOrEvent) => {
      if (state.streamElementsWs !== ws) return;
      state.streamElementsWs = null;

      const reason = firstString(
        reasonOrEvent && reasonOrEvent.reason,
        Buffer.isBuffer(reasonOrEvent) ? reasonOrEvent.toString('utf8') : reasonOrEvent,
        code && code.reason
      );
      const closeCode = typeof code === 'number' ? code : code && code.code;
      const message = `StreamElements WS cerrado${closeCode ? ` (${closeCode})` : ''}${reason ? `: ${reason}` : ''}`;
      console.warn(message);
      diagnostics.lastStreamElementsClose = {
        at: new Date().toISOString(),
        code: closeCode || null,
        reason,
      };
      scheduleStreamElementsReconnect(message);
    });
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
    startStreamElementsTips();
  });

  socket.on('setStreamElementsChannel', (input) => {
    state.streamElementsChannel = cleanStreamElementsChannel(input);
    state.streamElementsFatalError = false;
    socket.emit('streamElementsChannel', {
      ok: true,
      channel: state.streamElementsChannel,
      tipLink: state.streamElementsChannel
        ? `https://streamelements.com/${state.streamElementsChannel}/tip`
        : '',
    });
    console.log(`[${state.username || 'sin-live'}] StreamElements channel: ${state.streamElementsChannel || 'sin filtro'}`);
    if (state.active) startStreamElementsTips();
  });

  socket.on('disconnect', () => {
    console.log('Desconexion de socket');
    diagnostics.connectedSockets = Math.max(0, diagnostics.connectedSockets - 1);
    state.active = false;
    stopStreamElementsTips();
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
