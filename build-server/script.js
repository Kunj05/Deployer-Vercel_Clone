const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const mime = require('mime-types');
const Redis = require('ioredis')
require('dotenv').config();

const publisher = new Redis(process.env.REDIS_URL)

const s3Client = new S3Client({
    region: process.env.REGION_NAME,
    credentials: {
        accessKeyId:  process.env.ACCESS_KEY_ID,
        secretAccessKey: process.env.SECERT_ACCESS_KEY,
    }
});

const PROJECT_ID = process.env.PROJECT_ID;

function publishLog(log) {
    publisher.publish(`logs:${PROJECT_ID}`, JSON.stringify({ log }))
}

async function init() {
    console.log('Executing script.js');
    publishLog('Build Started...')
    const outDirPath = path.join(__dirname, 'output');

    const p = exec(`cd ${outDirPath} && npm install && npm run build`, { shell: true });
      
    p.stdout.on('data', (data) => {
        process.stdout.write(data); 
        publishLog(data.toString())
    });

    p.stderr.on('data', (data) => {
        process.stderr.write(data); 
        publishLog(`error: ${data.toString()}`)
    });

    p.on('close', async () => {
        console.log('Build Complete');
        publishLog(`Build Complete`)

        try {
            const files = await fs.promises.readdir(outDirPath);

            console.log('Files in output directory:');
            files.forEach(file => {
                console.log(file);
            });

            const distFolderPath = path.join(outDirPath, 'dist');
            if (!fs.existsSync(distFolderPath)) {
                console.error(`Directory not found: ${distFolderPath}`);
                process.exit(1);
            }

            const distFolderContents = fs.readdirSync(distFolderPath, { withFileTypes: true });
            console.log(`Found ${distFolderContents.length} files in dist folder.`);

            // Start uploading files after logging
            await uploadFiles(distFolderContents, distFolderPath, distFolderPath);

            publishLog(`Done`)
            console.log('Done...')        
        } 
        catch (err) {
            console.error(err);
        }
    });
}

async function uploadFiles(distFolderContents, distFolderPath, baseFolderPath) {
    // Publish log before uploading
    console.log('Starting to upload');
    publishLog(`Starting to upload`)
    for (const dirent of distFolderContents) {
        const filePath = path.join(distFolderPath, dirent.name);
        const s3Key = path.relative(baseFolderPath, filePath).replace(/\\/g, '/'); // Maintain relative path in S3

        if (dirent.isDirectory()) {
            const subDirContents = fs.readdirSync(filePath, { withFileTypes: true });
            await uploadFiles(subDirContents, filePath, baseFolderPath); // Recursive call
            continue; 
        }

        console.log('Uploading', filePath);
        publishLog(`uploading ${dirent.name}`)

        try {
            const command = new PutObjectCommand({
                Bucket: 'deployer-vercel-clone',
                Key: `__outputs/${PROJECT_ID}/${s3Key}`, // Use the relative path as the S3 key
                Body: fs.createReadStream(filePath),
                ContentType: mime.lookup(filePath) || 'application/octet-stream'
            });

            await s3Client.send(command);
            publishLog(`uploaded ${dirent.name}`)
            console.log('Uploaded', filePath);
        } 
        catch (uploadError) {
            console.error(`Failed to upload ${dirent.name}: ${uploadError.message}`);
        }    
    }
}

init();
