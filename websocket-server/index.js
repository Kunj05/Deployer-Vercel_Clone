const WebSocket = require('ws');
const Redis = require('ioredis');
require('dotenv').config();

const PORT = process.env.WS_PORT || 8080;

const redis = new Redis(process.env.REDIS_URL);

const wss = new WebSocket.Server({ port: PORT });

console.log(`WebSocket server started on port ${PORT}`);

wss.on('connection', (ws, req) => {
    console.log('Client connected');

    let subscribedChannel = null;

    // Expect client to send JSON message with buildId to subscribe
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.buildId) {
                if (subscribedChannel) {
                    redis.unsubscribe(subscribedChannel);
                    console.log(`Unsubscribed from ${subscribedChannel}`);
                }
                subscribedChannel = `logs:${data.buildId}`;
                redis.subscribe(subscribedChannel, (err, count) => {
                    if (err) {
                        console.error('Failed to subscribe:', err);
                        ws.send(JSON.stringify({ error: 'Failed to subscribe' }));
                    } else {
                        console.log(`Subscribed to ${subscribedChannel}`);
                        ws.send(JSON.stringify({ message: `Subscribed to build ${data.buildId}` }));
                    }
                });
            } else {
                ws.send(JSON.stringify({ error: 'Missing buildId in message' }));
            }
        } catch (e) {
            ws.send(JSON.stringify({ error: 'Invalid JSON message' }));
        }
    });

    redis.on('message', (channel, message) => {
        if (channel === subscribedChannel && ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        if (subscribedChannel) {
            redis.unsubscribe(subscribedChannel);
            subscribedChannel = null;
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });
});
