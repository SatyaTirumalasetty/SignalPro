require('dotenv').config();
const express = require('express');
const http = require('http');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const WebSocket = require('ws');

const { initializeDatabase } = require('./config/database');
const { helmetOptions } = require('./config/security');
const { setupRateLimiting } = require('./middleware/rateLimit');
const { errorHandler } = require('./middleware/errorHandler');
const { startCronJobs } = require('./services/brokerSync');
const alpacaMarketData = require('./services/alpacaMarketData');
const logger = require('./config/logger');

// Routes (will create these)
const authRoutes    = require('./routes/auth');
const userRoutes    = require('./routes/users');
const apiKeyRoutes  = require('./routes/apiKeys');
const brokerRoutes  = require('./routes/brokers');
const webhookRoutes = require('./routes/webhooks');
const marketRoutes = require('./routes/market');
const tradingRoutes = require('./routes/trading');
const analysisRoutes = require('./routes/analysis');
const billingRoutes = require('./routes/billing');
const subscriptionRoutes = require('./routes/subscriptions');
const adminRoutes = require('./routes/admin');
const backtestRoutes = require('./routes/backtest');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ─── Security & Middleware ────────────────────────────────────
app.use(helmet(helmetOptions));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// Rate Limiting
setupRateLimiting(app);

// ─── Health & Status ──────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptime: process.uptime()
  });
});

// ─── API Routes ───────────────────────────────────────────────
// Webhooks use raw body parsing (must come before express.json routes)
app.use('/api/webhooks', webhookRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/api-keys', apiKeyRoutes);
app.use('/api/brokers', brokerRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/trading', tradingRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/backtest', backtestRoutes);

// ─── 404 Handler ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.path });
});

// ─── Global Error Handler ─────────────────────────────────────
app.use(errorHandler);

// ─── WebSocket for Live Updates ───────────────────────────────
wss.on('connection', (ws) => {
  logger.info('WebSocket client connected');
  ws.isAlive = true;
  ws.subscriptions = new Set();
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'subscribe') {
        msg.symbols?.forEach(s => ws.subscriptions.add(s));
      } else if (msg.type === 'unsubscribe') {
        msg.symbols?.forEach(s => ws.subscriptions.delete(s));
      }
    } catch (e) {
      logger.error('WebSocket message parse error:', e);
    }
  });

  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => logger.info('WebSocket client disconnected'));
  ws.on('error', (err) => logger.error('WebSocket error:', err));
});

// WebSocket heartbeat (every 30 seconds)
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Broadcast price updates to all subscribed clients
function broadcastPriceUpdate(symbol, priceData) {
  const msg = JSON.stringify({ type: 'price', symbol, ...priceData });
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN && ws.subscriptions.has(symbol)) {
      ws.send(msg);
    }
  });
}

// Poll Alpaca for live quotes on all actively-subscribed symbols and broadcast
const LIVE_PRICE_POLL_MS = parseInt(process.env.LIVE_PRICE_POLL_MS) || 5000;

setInterval(async () => {
  if (!alpacaMarketData.isConfigured()) return;

  const symbols = new Set();
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.subscriptions.forEach((s) => symbols.add(s));
    }
  });
  if (symbols.size === 0) return;

  try {
    const quotes = await alpacaMarketData.getLatestQuotes([...symbols]);
    for (const [symbol, quote] of Object.entries(quotes)) {
      broadcastPriceUpdate(symbol, quote);
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Live price poll failed');
  }
}, LIVE_PRICE_POLL_MS);

module.exports = { app, server, wss, broadcastPriceUpdate };

// ─── Server Startup ───────────────────────────────────────────
const PORT = process.env.PORT || 3001;

async function start() {
  try {
    await initializeDatabase();
    logger.info('✅ Database initialized');
    
    startCronJobs();
    server.listen(PORT, () => {
      logger.info(`
╔════════════════════════════════════════════════╗
║        SignalPro Enterprise Backend            ║
║              🚀 Server Running                 ║
╠════════════════════════════════════════════════╣
║ Port: ${PORT}                                   ║
║ Environment: ${(process.env.NODE_ENV || 'development').padEnd(14)}      ║
║ Database: Connected                            ║
╚════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

start();

// ─── Graceful Shutdown ────────────────────────────────────────
process.on('SIGTERM', () => {
  logger.warn('⚠️  SIGTERM received, shutting down gracefully...');
  server.close(() => {
    logger.info('✅ Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('❌ Forced shutdown after 30s');
    process.exit(1);
  }, 30000);
});

process.on('SIGINT', () => {
  logger.warn('⚠️  SIGINT received, shutting down...');
  process.exit(0);
});
