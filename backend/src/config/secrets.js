const logger = require('./logger');

// Loads application secrets from AWS Secrets Manager into process.env before
// any other module (database, redis, broker adapters, etc.) reads them.
//
// In development, AWS_SECRETS_MANAGER_SECRET_ID is unset and this is a no-op —
// secrets come from backend/.env via dotenv as usual.
//
// In production, set AWS_SECRETS_MANAGER_SECRET_ID to the ARN/name of a secret
// containing a flat JSON object of key/value pairs (e.g. ANTHROPIC_API_KEY,
// ALPACA_API_KEY, JWT_SECRET, DB_PASSWORD, ...). Values already present in
// process.env (set directly on the host/container) take precedence, so ops
// can still override individual values per-deployment without editing the
// secret.
async function loadSecrets() {
  const secretId = process.env.AWS_SECRETS_MANAGER_SECRET_ID;
  if (!secretId) return;

  const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

  try {
    const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    const secrets = JSON.parse(result.SecretString);

    let applied = 0;
    for (const [key, value] of Object.entries(secrets)) {
      if (process.env[key] === undefined || process.env[key] === '') {
        process.env[key] = String(value);
        applied++;
      }
    }

    logger.info({ secretId, keysFound: Object.keys(secrets).length, applied }, 'Loaded secrets from AWS Secrets Manager');
  } catch (err) {
    logger.error({ err: err.message, secretId }, 'Failed to load secrets from AWS Secrets Manager');
    throw err;
  }
}

module.exports = { loadSecrets };
