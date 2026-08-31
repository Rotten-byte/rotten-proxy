
const EMIT_GIFT_PROGRESS = envBoolean('EMIT_GIFT_PROGRESS', false);
const STREAM_ELEMENTS_WS_URL = process.env.STREAMELEMENTS_WS_URL || 'wss://astro.streamelements.com/';
const STREAM_ELEMENTS_RECONNECT_BASE_MS = envNumber('STREAMELEMENTS_RECONNECT_BASE_MS', 3000);
const STREAM_ELEMENTS_RECONNECT_MAX_MS = envNumber('STREAMELEMENTS_RECONNECT_MAX_MS', 30000);
const STREAM_ELEMENTS_TIP_DEDUPE_MS = envNumber('STREAMELEMENTS_TIP_DEDUPE_MS', 10 * 60 * 1000);
const STREAM_ELEMENTS_DEBUG = envBoolean('STREAMELEMENTS_DEBUG', false);


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
    allowAllUsers: allowAllUsers(),
    streamElementsConfigured: hasStreamElementsToken(),
    streamElementsDefaultChannel: getDefaultStreamElementsChannel(),
    streamElementsTopic: 'channel.tips',
  });
    allowAllUsers: allowAllUsers(),
    streamElementsConfigured: hasStreamElementsToken(),
    streamElementsDefaultChannel: getDefaultStreamElementsChannel(),
    streamElementsTopic: 'channel.tips',
  });

function getStreamElementsAuth() {
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
  const explicitType = firstString(
    process.env.STREAMELEMENTS_TOKEN_TYPE,
    process.env.STREAM_ELEMENTS_TOKEN_TYPE
  ).toLowerCase();

  const token = firstString(jwt, apiKey, oauth2);
  if (!token) return null;

  let tokenType = explicitType;
  if (!tokenType) {
    tokenType = jwt ? 'jwt' : apiKey ? 'apikey' : 'oauth2';
  }
  if (!['jwt', 'apikey', 'oauth2'].includes(tokenType)) tokenType = 'jwt';

  return { token, tokenType };
}

function hasStreamElementsToken() {
  return Boolean(getStreamElementsAuth());
}

function getStreamElementsRoom() {
  return firstString(
    process.env.STREAMELEMENTS_ROOM,
    process.env.STREAM_ELEMENTS_ROOM,
    process.env.STREAMELEMENTS_CHANNEL_ID,
    process.env.STREAM_ELEMENTS_CHANNEL_ID
  );
}

function getWebSocketCtor() {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  try {
    return require('ws');
  } catch (_) {
    return null;
  }
}

function addWebSocketListener(ws, eventName, handler) {
  if (typeof ws.addEventListener === 'function') {
    ws.addEventListener(eventName, (event) => {
      handler(event && Object.prototype.hasOwnProperty.call(event, 'data') ? event.data : event, event);
    });
    return;
  }

  if (typeof ws.on === 'function') ws.on(eventName, handler);
}
