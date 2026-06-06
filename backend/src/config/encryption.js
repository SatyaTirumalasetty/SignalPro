const crypto = require('crypto');
const logger = require('./logger');

// Use proper 32-byte keys for AES-256
const KEY = Buffer.from(
  process.env.ENCRYPTION_KEY || 'dev_key_32_chars_minimum_change_me!!!',
  'utf8'
).slice(0, 32); // Ensure exactly 32 bytes

const IV = Buffer.from(
  process.env.ENCRYPTION_IV || '0123456789abcdef',
  'utf8'
).slice(0, 16); // Ensure exactly 16 bytes

function encrypt(text) {
  try {
    if (!text) return '';
    const cipher = crypto.createCipheriv('aes-256-cbc', KEY, IV);
    let encrypted = cipher.update(String(text), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  } catch (error) {
    logger.error('Encryption failed:', error);
    throw new Error('Encryption service unavailable');
  }
}

function decrypt(encryptedText) {
  try {
    if (!encryptedText) return '';
    const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, IV);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    logger.error('Decryption failed:', error);
    throw new Error('Decryption failed - corrupted data');
  }
}

module.exports = { encrypt, decrypt };
