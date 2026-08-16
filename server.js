function connectToTikTok(username, sessionId) {
 if (!state.active) return;
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
 
 ['disconnected', 'close', 'streamEnd'].forEach((evt) => {
 conn.on(evt, () => {
 console.log(`⚠️ Evento ${evt} en @${username}, reintentando...`);
 socket.emit('error', 'TikTok Connection Lost - Retrying');
 if (state.active) {
 setTimeout(() => connectToTikTok(username, sessionId), 3000);
 }
 });
 });
 
 conn.connect()
 .then(() => {
 console.log(`✅ Conectado a @${username}`);
 socket.emit('connected');
 
 // Check si está recibiendo datos después de 10 segundos
 setTimeout(() => {
 if (!hasReceivedData && state.active) {
 console.warn(`⚠️ No data received from @${username}, reconnecting...`);
 socket.emit('error', 'No data received - Retrying');
 setTimeout(() => connectToTikTok(username, sessionId), 3000);
 }
 }, 10000);
 })
 .catch((err) => {
 console.error(`❌ Error conectando a @${username}:`, err.message || err);
 socket.emit('error', err.message || 'Error de conexión');
 if (state.active) {
 setTimeout(() => connectToTikTok(username, sessionId), 3000);
 }
 });
 } catch (e) {
 console.error("Error creando conexión:", e.message || e);
 socket.emit('error', 'Error creando conexión');
 }
}
