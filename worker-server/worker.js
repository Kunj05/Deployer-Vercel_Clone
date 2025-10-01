// worker.js
const { Worker } = require('bullmq');
const { ECSClient, RunTaskCommand } = require('@aws-sdk/client-ecs');
require('dotenv').config();

const ecsClient = new ECSClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY
    }
});

const config = {
    CLUSTER: process.env.AWS_CLUSTER_ARN,
    TASK: process.env.AWS_TASK_ARN,
    SUBNET: process.env.SUBNET_ID,
    SECURITY_GROUP: process.env.SECURITY_GROUP_ID
};

const worker = new Worker('build_queue', async job => {
    const { buildId, repoUrl, envVars } = job.data;

    console.log(`Processing job: ${buildId}`);

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
                    name: 'deployer-build-image',
                    environment: [
                        { name: 'GIT_REPOSITORY_URL', value: repoUrl },
                        { name: 'PROJECT_ID', value: buildId },
                        ...Object.entries(envVars).map(([key, val]) => ({
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
        console.log(`Fargate task launched for job ${buildId}`);
    } catch (err) {
        console.error(`Error launching Fargate task for ${buildId}:`, err);
        throw err; 
    }
}, {
    connection: {
        host: 'localhost',
        port: 6379,
        // password: 'your_password' (if needed)
    }
});

// Optional: handle failure globally
worker.on('failed', (job, err) => {
    console.error(`Job ${job.id} failed after ${job.attemptsMade} attempts:`, err.message);
});
