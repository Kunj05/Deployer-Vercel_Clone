const { Queue } = require('bullmq');
require('dotenv').config();

const queue = new Queue('build_queue', {
  connection: {
    host: 'localhost', // or use URL if hosted
    port: 6379,
    // password: 'your_password' (if needed)
  }
});

module.exports = queue;
