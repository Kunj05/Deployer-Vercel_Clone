const { Worker } = require('bullmq');
const { ECSClient, RunTaskCommand } = require('@aws-sdk/client-ecs');
const Redis = require('ioredis');
const pool = require('./db');  // <-- your Postgres connection
require('dotenv').config();

// AWS ECS Client
const ecsClient = new ECSClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY
    }
});

// ECS config
const config = {
    CLUSTER: process.env.AWS_CLUSTER_ARN,
    TASK: process.env.AWS_TASK_ARN,
    SUBNET: process.env.SUBNET_ID,
    SECURITY_GROUP: process.env.SECURITY_GROUP_ID
};

// Redis publisher for logs
const redis = new Redis(process.env.REDIS_URL);

// Helper: publish logs to websocket subscribers
async function publishLog(buildId, message) {
    await redis.publish(`logs:${buildId}`, JSON.stringify({ buildId, message, ts: new Date() }));
}

// Worker setup
const worker = new Worker(
    'build_queue',
    async job => {
        const { build_id, repo_url, env_vars } = job.data;

        console.log(`⚙️ Processing job: ${build_id}`);
        await publishLog(build_id, `Job picked up by worker`);

        // Update DB status = running
        await pool.query(
            `UPDATE build_jobs SET status = $1, updated_at = NOW() WHERE build_id = $2`,
            ['running', build_id]
        );

        const command = new RunTaskCommand({
            cluster: config.CLUSTER,
            taskDefinition: config.TASK,
            launchType: 'FARGATE',
            count: 1,
            networkConfiguration: {
                awsvpcConfiguration: {
                    assignPublicIp: 'ENABLED',
                    subnets: [config.SUBNET],
                    securityGroups: [config.SECURITY_GROUP]
                }
            },
            overrides: {
                containerOverrides: [
                    {
                        name: 'deployer-build-image', // container name in ECS task
                        environment: [
                            { name: 'GIT_REPOSITORY_URL', value: repo_url },
                            { name: 'BUILD_ID', value: build_id },
                            { name: 'DATABASE_URL', value: process.env.DATABASE_URL },//postgres://user:password@dbhost.supabase.co:5432/dbname
                            { name: 'REDIS_URL', value: process.env.REDIS_URL },//redis://:password@redis-host.upstash.io:6379
                            ...Object.entries(env_vars || {}).map(([key, val]) => ({
                                name: key,
                                value: val
                            }))
                        ]
                    }
                ]
            }
        });

        try {
            await ecsClient.send(command);
            console.log(`🚀 ECS Fargate task launched for ${build_id}`);
            await publishLog(build_id, `Fargate task launched successfully`);

            // Update DB → running (or waiting for ECS callback if you track completion)
        } catch (err) {
            console.error(`❌ Error launching Fargate task for ${build_id}:`, err);

            await pool.query(
                `UPDATE build_jobs SET status = $1, retry_count = retry_count + 1, updated_at = NOW() WHERE build_id = $2`,
                ['retryable_failed', build_id]
            );

            await publishLog(build_id, `Task failed: ${err.message}`);
            throw err; // let BullMQ retry
        }
    },
    {
        connection: {
            host: 'localhost',
            port: 6379,
            // password: 'your_password' (if using Redis auth)
        }
    }
);

// Worker error handling
worker.on('completed', async (job) => {
    const buildId = job.data.build_id;
    console.log(`✅ Job ${buildId} completed`);
    await pool.query(
        `UPDATE build_jobs SET status = $1, updated_at = NOW() WHERE build_id = $2`,
        ['success', buildId]
    );
    await publishLog(buildId, `Job completed successfully`);
});

worker.on('failed', async (job, err) => {
    const buildId = job.data.build_id;
    console.error(`❌ Job ${buildId} failed:`, err.message);

    // Check retry attempts
    if (job.attemptsMade >= job.opts.attempts) {
        // Permanent failure
        await pool.query(
            `UPDATE build_jobs SET status = $1, updated_at = NOW() WHERE build_id = $2`,
            ['permanent_failed', buildId]
        );
        await publishLog(buildId, `Job permanently failed after retries`);
    } else {
        // Retryable failure
        await pool.query(
            `UPDATE build_jobs SET status = $1, retry_count = retry_count + 1, updated_at = NOW() WHERE build_id = $2`,
            ['retryable_failed', buildId]
        );
        await publishLog(buildId, `Job failed (retrying): ${err.message}`);
    }
});
