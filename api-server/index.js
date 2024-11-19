const express = require('express');
const { generateSlug } = require('random-word-slugs');
const { ECSClient, RunTaskCommand } = require('@aws-sdk/client-ecs');
const { Server } = require('socket.io');
const Redis = require('ioredis');
require('dotenv').config();

const app=express();
const PORT=9000;
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));


const subscriber = new Redis(process.env.REDIS_URL)

const io = new Server({ cors: '*' })

io.on('connection', socket => {
    socket.on('subscribe', channel => {
        socket.join(channel)
        socket.emit('message', `Joined ${channel}`)
    })
})

io.listen(9002, () => console.log('Socket Server 9002'))

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
};


app.post('/project',async (req,res)=>{
    const { gitURL, slug } = req.body;
    const projectSlug = slug ? slug : generateSlug();
    
    console.log(gitURL," ",projectSlug);
    
    const command = new RunTaskCommand({
        cluster: config.CLUSTER,
        taskDefinition: config.TASK,
        launchType: 'FARGATE',
        count: 1,
        networkConfiguration: {
            awsvpcConfiguration: {
                assignPublicIp: 'ENABLED',
                subnets: [process.env.SUBNET_ID],
                securityGroups: [process.env.SECURITY_GROUP_ID]
            }
        },
        overrides: {
            containerOverrides: [
                {
                    name: 'deployer-build-image',
                    environment: [
                        { name: 'GIT_REPOSITORY_URL', value: gitURL },
                        { name: 'PROJECT_ID', value: projectSlug }
                    ]
                }
            ]
        }
    });
    

    try {
        await ecsClient.send(command);

        res.json({ status: 'queued', data: { projectSlug, url: `http://${projectSlug}.localhost:8000` } });
    } 
    catch (error) {
        console.error('Error running ECS task:', error);
        res.status(500).json({ status: 'error', message: 'Failed to queue the task' });
    }
})

async function initRedisSubscribe() {
    console.log('Subscribed to logs....')
    subscriber.psubscribe('logs:*')
    subscriber.on('pmessage', (pattern, channel, message) => {
        io.to(channel).emit('message', message)
    })
}

initRedisSubscribe()


app.listen(PORT,()=> console.log(`API Server Running at ${PORT}`))