const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const redis = require('redis');
const logger = require('../config/logger');

let redisClient = null;
let store = null;

// Initialize Redis connection (optional, falls back to memory)
async function initializeRedis() {
  try {
    redisClient = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    redisClient.on('error', (err) => logger.warn('Redis error:', err));
    await redisClient.connect();
    logger.info('✅ Redis connected for rate limiting');
    
    store = new RedisStore({
      client: redisClient,
      prefix: 'rate-limit:',
    });
  } catch (error) {
    logger.warn('Redis unavailable, using memory store for rate limiting');
    // Fall through to use default memory store
  }
}

function setupRateLimiting(app) {
  initializeRedis().catch((err) => {
    logger.warn('Could not initialize Redis:', err.message);
  });

  // Global rate limiter
  const globalLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    max: parseInt(process.env.MAX_REQUESTS_PER_MINUTE) || 120,
    message: { error: 'Too many requests, please slow down' },
    standardHeaders: true,
    legacyHeaders: false,
    store,
    skip: (req) => req.path === '/api/health',
  });

  // Strict limiter for auth endpoints
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    message: { error: 'Too many login attempts, try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    store,
  });

  // AI analysis limiter (per user per minute)
  const aiLimiter = rateLimit({
    windowMs: 60000,
    max: parseInt(process.env.MAX_AI_REQUESTS_PER_MINUTE) || 10,
    message: { error: 'AI analysis limit exceeded' },
    keyGenerator: (req) => req.user?.id || req.ip,
    store,
  });

  // Trading limiter (orders per minute)
  const tradeLimiter = rateLimit({
    windowMs: 60000,
    max: parseInt(process.env.MAX_TRADES_PER_MINUTE) || 5,
    message: { error: 'Too many trade orders, slow down' },
    keyGenerator: (req) => req.user?.id || req.ip,
    store,
  });

  // Apply global limiter to all routes
  app.use(globalLimiter);

  // Named limiters for use in specific routes
  return {
    authLimiter,
    aiLimiter,
    tradeLimiter,
  };
}

module.exports = { setupRateLimiting };
