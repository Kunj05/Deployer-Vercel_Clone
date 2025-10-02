// server.js
const express = require('express');
const { createServer } = require('http');
const WebSocket = require('ws');
const Redis = require('ioredis');
const queue = require('./queue');
const pool = require('./db');
const { generateSlug } = require('random-word-slugs')
require('dotenv').config();

const API_PORT = process.env.API_PORT || 9000;
const redis = new Redis(process.env.REDIS_URL);

const app = express();
app.use(express.json());

// ---------- API ENDPOINT ----------
app.post('/project', async (req, res) => {
    const job = req.body;
    job.build_id = job.build_id || generateSlug(3).replace(/-/g, '_');
    if (!job.build_id || !job.repo_url) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Save job in Postgres
        await pool.query(
            `INSERT INTO build_jobs (build_id, user_id, repo_url, env_vars, status, retry_count, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
             ON CONFLICT (build_id) DO UPDATE 
             SET repo_url = EXCLUDED.repo_url, env_vars = EXCLUDED.env_vars, status = EXCLUDED.status, updated_at = NOW()`,
            [
                job.build_id,
                job.user_id || null,
                job.repo_url,
                job.env_vars ? JSON.stringify(job.env_vars) : '{}',
                'queued',
                0
            ]
        );

        // Push job to Bull queue
        await queue.add('build_job', job, {
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: true,
            removeOnFail: false
        });

        console.log(`Enqueued job ${job.build_id}`);

        res.status(200).json({
            status: 'queued',
            data: { buildId: job.build_id, message: 'Job successfully queued' }
        });
    } catch (err) {
        console.error('Failed to enqueue job:', err);
        res.status(500).json({ status: 'error', message: 'Failed to queue the job' });
    }
});


// ---------- MERGE WITH WEBSOCKET ----------
const server = createServer(app); // <-- Create HTTP server
const wss = new WebSocket.Server({ server }); // <-- Attach WebSocket to same server

console.log(`Starting WebSocket + API server on port ${API_PORT}`);

// WebSocket handling
wss.on('connection', (ws) => {
    console.log('Client connected');
    let subscribedChannel = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.build_id) {
                if (subscribedChannel) {
                    redis.unsubscribe(subscribedChannel);
                    console.log(`Unsubscribed from ${subscribedChannel}`);
                }
                subscribedChannel = `logs:${data.build_id}`;
                redis.subscribe(subscribedChannel, (err) => {
                    if (err) {
                        console.error('Failed to subscribe:', err);
                        ws.send(JSON.stringify({ error: 'Failed to subscribe' }));
                    } else {
                        console.log(`Subscribed to ${subscribedChannel}`);
                        ws.send(JSON.stringify({ message: `Subscribed to build ${data.build_id}` }));
                    }
                });
            } else {
                ws.send(JSON.stringify({ error: 'Missing build_id in message' }));
            }
        } catch (e) {
            ws.send(JSON.stringify({ error: 'Invalid JSON message' }));
        }
    });

    redis.on('message', (channel, msg) => {
        if (channel === subscribedChannel && ws.readyState === WebSocket.OPEN) {
            ws.send(msg);
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

// Start both API + WebSocket
server.listen(API_PORT, () => {
    console.log(`🚀 API + WebSocket server running on port ${API_PORT}`);
});

// CREATE TABLE build_jobs (
//     build_id VARCHAR(100) PRIMARY KEY,
//     user_id VARCHAR(100),
//     repo_url TEXT NOT NULL,
//     env_vars JSONB DEFAULT '{}',
//     status VARCHAR(30) NOT NULL,
//     retry_count INT DEFAULT 0,
//     build_size BIGINT,
//     build_duration BIGINT,
//     created_at TIMESTAMP DEFAULT NOW(),
//     updated_at TIMESTAMP DEFAULT NOW()
// );
