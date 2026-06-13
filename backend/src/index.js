require('dotenv').config();
const { loadSecrets } = require('./config/secrets');
const logger = require('./config/logger');

// Secrets must be in process.env before server.js (and the config modules it
// requires) read them at module-load time.
loadSecrets()
  .then(() => require('./server'))
  .catch((err) => {
    logger.error({ err: err.message }, '❌ Failed to load secrets, exiting');
    process.exit(1);
  });
