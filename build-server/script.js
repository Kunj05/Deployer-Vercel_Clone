const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const mime = require('mime-types');
const Redis = require('ioredis');
const { Pool } = require('pg');
require('dotenv').config();

const publisher = new Redis(process.env.REDIS_URL);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});
 
const s3Client = new S3Client({
    region: process.env.REGION_NAME,
    credentials: {
        accessKeyId: process.env.ACCESS_KEY_ID,
        secretAccessKey: process.env.SECERT_ACCESS_KEY,
    }
});

function isRetryableError(logText) {
    const message = logText.toLowerCase();

    const retryableKeywords = [
        'network error',
        'timeout',
        'econnreset',
        'eai_again', 
        'temporarily unavailable',
        'fetch failed',
        'npm err! code eai_again',
        'npm err! network'
    ];

    return retryableKeywords.some((keyword) => message.includes(keyword));
}

const BUILD_ID = process.env.BUILD_ID; 
const LOG_FILE_PATH = path.join(__dirname, 'build.log');

let logFileStream;

async function publishLog(log) {
    publisher.publish(`logs:${BUILD_ID}`, JSON.stringify({ log }));
    logFileStream.write(log + '\n');
}

async function updateJobStatus(status, extra = {}) {
    try {
        const client = await pool.connect();
        const fields = ['status', 'updated_at'];
        const values = [status, new Date()];
        let idx = 3;

        for (const key in extra) {
            fields.push(key);
            values.push(extra[key]);
        }

        const setString = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');

        const query = `UPDATE jobs SET ${setString} WHERE build_id = $${fields.length + 1}`;
        values.push(BUILD_ID);

        await client.query(query, values);
        client.release();

        await publishLog(`Job status updated: ${status}`);
    } catch (err) {
        console.error('Failed to update job status:', err);
    }
}


async function uploadLogFile() {
    publishLog('Uploading build log file...');
    const logS3Key = `__outputs/${BUILD_ID}/build.log`;

    try {
        const command = new PutObjectCommand({
            Bucket: 'deployer-vercel-clone',
            Key: logS3Key,
            Body: fs.createReadStream(LOG_FILE_PATH),
            ContentType: 'text/plain'
        });
        await s3Client.send(command);
        publishLog('Build log uploaded');
    } catch (err) {
        console.error('Failed to upload build log:', err);
        publishLog(`Failed to upload build log: ${err.message}`);
    }
}

async function uploadFiles(distFolderContents, distFolderPath, baseFolderPath) {
    publishLog('Starting to upload build files...');
    for (const dirent of distFolderContents) {
        const filePath = path.join(distFolderPath, dirent.name);
        const s3Key = path.relative(baseFolderPath, filePath).replace(/\\/g, '/');

        if (dirent.isDirectory()) {
            const subDirContents = fs.readdirSync(filePath, { withFileTypes: true });
            await uploadFiles(subDirContents, filePath, baseFolderPath);
            continue;
        }

        publishLog(`Uploading ${dirent.name}...`);
        
        try {
            const command = new PutObjectCommand({
                Bucket: 'deployer-vercel-clone',
                Key: `__outputs/${BUILD_ID}/${s3Key}`,
                Body: fs.createReadStream(filePath),
                ContentType: mime.lookup(filePath) || 'application/octet-stream'
            });
            await s3Client.send(command);
            publishLog(`Uploaded ${dirent.name}`);
        } catch (uploadError) {
            console.error(`Failed to upload ${dirent.name}: ${uploadError.message}`);
            publishLog(`Failed to upload ${dirent.name}: ${uploadError.message}`);
        }
    }
}

async function init() {
    logFileStream = fs.createWriteStream(LOG_FILE_PATH, { flags: 'a' });

    await updateJobStatus('running');

    publishLog('Build Started...');
    const outDirPath = path.join(__dirname, 'output');

    const p = exec(`cd ${outDirPath} && npm install && npm run build`, { shell: true });

    p.stdout.on('data', (data) => {
        process.stdout.write(data);
        publishLog(data.toString());
    });

    p.stderr.on('data', (data) => {
        process.stderr.write(data);
        publishLog(`error: ${data.toString()}`);
    });

    p.on('close', async (code) => {
        if (code === 0) {
            publishLog('Build Complete');

            const distFolderPath = path.join(outDirPath, 'dist');
            let totalSize = 0;
            if (fs.existsSync(distFolderPath)) {
                const distFiles = fs.readdirSync(distFolderPath);
                totalSize = distFiles.reduce((acc, file) => {
                    const filePath = path.join(distFolderPath, file);
                    if (fs.statSync(filePath).isFile()) {
                        return acc + fs.statSync(filePath).size;
                    }
                    return acc;
                }, 0);
            }

            await updateJobStatus('success', { build_size: totalSize });

            try {
                const files = await fs.promises.readdir(outDirPath);
                publishLog('Files in output directory: ' + files.join(', '));

                if (!fs.existsSync(distFolderPath)) {
                    throw new Error(`Directory not found: ${distFolderPath}`);
                }

                const distFolderContents = fs.readdirSync(distFolderPath, { withFileTypes: true });
                publishLog(`Found ${distFolderContents.length} files in dist folder.`);

                await uploadFiles(distFolderContents, distFolderPath, distFolderPath);
                await uploadLogFile();

                publishLog('Done');
                logFileStream.end();

            } catch (err) {
                console.error(err);

                let logContents = '';
                try {
                    logContents = readFileSync(LOG_FILE_PATH, 'utf-8');
                } catch (readErr) {
                    console.error('Failed to read log for error classification:', readErr);
                }

                const retryable = isRetryableError(logContents + err.message);
                const newStatus = retryable ? 'retryable_failed' : 'permanent_failed';

                await updateJobStatus(newStatus, {
                    error_message: err.message
                });
            }
        } else {
            publishLog(`Build process exited with code ${code}`);
            let logContents = '';
            try {
                logContents = readFileSync(LOG_FILE_PATH, 'utf-8');
            } catch (err) {
                console.error('Failed to read log file:', err);
            }

            const retryable = isRetryableError(logContents);
            const newStatus = retryable ? 'retryable_failed' : 'permanent_failed';

            await updateJobStatus(newStatus, {
                error_message: `Build failed with exit code ${code}`
            });
        }
    });
}

init();
