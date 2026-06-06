const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'SignalPro Enterprise API',
      version: '1.0.0',
      description: 'AI-powered algorithmic trading SaaS — REST API documentation',
    },
    servers: [
      { url: 'http://localhost:3001', description: 'Development' },
      { url: 'https://api.signalpro.io', description: 'Production' },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
        },
      },
    },
    security: [{ BearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Authentication & 2FA' },
      { name: 'Users', description: 'User profile management' },
      { name: 'API Keys', description: 'Programmatic access keys' },
      { name: 'Brokers', description: 'Broker connections & OAuth' },
      { name: 'Market', description: 'Market data & price feeds' },
      { name: 'Analysis', description: 'AI trading signal generation' },
      { name: 'Trading', description: 'Order & position management' },
      { name: 'Billing', description: 'Plans & payment processing' },
      { name: 'Subscriptions', description: 'Subscription lifecycle' },
      { name: 'Admin', description: 'Administrative operations' },
    ],
  },
  apis: ['./src/routes/*.js'],
};

module.exports = swaggerJsdoc(options);
