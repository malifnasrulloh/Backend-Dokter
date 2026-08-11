const Redis = require('ioredis');
const { logger } = require('../middleware/logger');
const EventEmitter = require('node:events');

// Cek env REDIS_ENABLED. Default ke true jika tidak diset.
const redisEnabled = process.env.REDIS_ENABLED !== 'false';

let redis;

if (redisEnabled) {
  const redisConfig = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || process.env.REDIS_PASS || undefined,
    retryStrategy: (times) => {
      const delay = Math.min(times * 2000, 10000);
      if (times > 5) {
        console.warn(
          `[Redis] Gagal koneksi ${times} kali. Mencoba lagi dalam ${delay / 1000} detik...`
        );
      }
      return delay;
    },
    enableOfflineQueue: false,
    connectTimeout: 5000,
  };

  redis = new Redis(redisConfig);

  redis.on('connect', () => {
    console.log('[Redis] Connected to Redis server');
  });

  redis.on('error', (err) => {
    logger.error('[Redis] Connection Error:', err.message);
  });
} else {
  // Mock Redis Client jika dinonaktifkan
  class DummyRedis extends EventEmitter {
    constructor() {
      super();
      this.status = 'disabled';
    }
    async get() {
      return null;
    }
    async set() {
      return 'OK';
    }
    async del() {
      return 0;
    }
    async keys() {
      return [];
    }
    async flushdb() {
      return 'OK';
    }
    async incr() {
      return 0;
    }
    async expire() {
      return 0;
    }
    quit() {
      return Promise.resolve();
    }
    disconnect() {}
  }
  redis = new DummyRedis();
  console.log('[Redis] Service is disabled. Fallback to In-Memory mode.');
}

module.exports = redis;
