const crypto = require('crypto');
const logger = require('./logger');

// AES-256-GCM: authenticated encryption — safer than CBC for sensitive credentials
const KEY = Buffer.from(
  process.env.ENCRYPTION_KEY || 'dev_key_32_chars_minimum_change_me!!!',
  'utf8'
).slice(0, 32);

function encryptCredentials(obj) {
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    let enc = cipher.update(JSON.stringify(obj), 'utf8', 'hex');
    enc += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${tag}:${enc}`;
  } catch (err) {
    logger.error({ err }, 'Credential encryption failed');
    throw new Error('Failed to encrypt broker credentials');
  }
}

function decryptCredentials(stored) {
  try {
    const parts = stored.split(':');
    if (parts.length < 3) throw new Error('Invalid encrypted format');
    const [ivHex, tagHex, ...encParts] = parts;
    const enc = encParts.join(':'); // re-join in case any credential value contained ':'
    const iv  = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    let dec = decipher.update(enc, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return JSON.parse(dec);
  } catch (err) {
    logger.error({ err }, 'Credential decryption failed');
    throw new Error('Failed to decrypt broker credentials — possible key mismatch');
  }
}

module.exports = { encryptCredentials, decryptCredentials };
