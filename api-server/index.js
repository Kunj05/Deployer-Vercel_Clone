// api-server.js
const express = require('express');
const queue = require('./queue');
require('dotenv').config();

const app = express();
const PORT = 9000;

app.use(express.json());

app.post('/project', async (req, res) => {
    const job = req.body;

    if (!job.buildId || !job.repoUrl || !job.envVars) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        await queue.add('build_job', job, {
            attempts: 5, 
            backoff: {
                type: 'exponential',
                delay: 2000 
            },
            removeOnComplete: true,
            removeOnFail: false
        });

        console.log(`Enqueued job ${job.buildId}`);

        res.status(200).json({
            status: 'queued',
            data: {
                buildId: job.buildId,
                message: 'Job successfully queued'
            }
        });
    } catch (err) {
        console.error('Failed to enqueue job:', err);
        res.status(500).json({ status: 'error', message: 'Failed to queue the job' });
    }
});

app.listen(PORT, () => {
    console.log(`API Server running at port ${PORT}`);
});
