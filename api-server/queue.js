const { Queue } = require('bullmq');
require('dotenv').config();

const queue = new Queue('build_queue', {
  connection: new Redis(process.env.REDIS_URL)
});

module.exports = queue;
