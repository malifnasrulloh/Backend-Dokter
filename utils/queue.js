const { Queue, Worker } = require('bullmq');
const { logger } = require('../middleware/logger');

const redisConnectionConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || process.env.REDIS_PASS || undefined,
  maxRetriesPerRequest: null,
};

const jobQueue = new Queue('SIMRSJobQueue', {
  connection: redisConnectionConfig,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },

    removeOnComplete: {
      count: Number.parseInt(process.env.QUEUE_MAX_COMPLETED_JOBS || '1000', 10),
      age: 3600,
    },

    removeOnFail: {
      count: Number.parseInt(process.env.QUEUE_MAX_FAILED_JOBS || '5000', 10),
      age: 86400,
    },
  },
});

const initQueueWorker = (jobHandlers = {}) => {
  const worker = new Worker(
    'SIMRSJobQueue',
    async (job) => {
      const { taskType, payload } = job.data;
      logger.info(`[Queue Worker] Memproses job ${job.id} tipe: ${taskType}`);

      const handler = jobHandlers[taskType];
      if (!handler) {
        throw new Error(`Tidak ada handler terdaftar untuk tipe task: ${taskType}`);
      }

      return await handler(payload, job);
    },
    {
      connection: redisConnectionConfig,
      concurrency: Number.parseInt(process.env.QUEUE_CONCURRENCY || '5', 10),
    }
  );

  worker.on('completed', (job) => {
    logger.info(`[Queue Worker] Job ${job.id} (${job.data.taskType}) selesai dengan sukses.`);
  });

  worker.on('failed', (job, err) => {
    logger.error(
      `[Queue Worker] Job ${job.id} (${job?.data?.taskType}) Gagal Permanen: ${err.message}`
    );
  });

  return worker;
};

module.exports = {
  jobQueue,
  initQueueWorker,
};
