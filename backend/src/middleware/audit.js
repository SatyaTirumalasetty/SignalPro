const { db } = require('../config/database');
const logger = require('../config/logger');

async function logAudit(userId, action, entityType, entityId, oldValues, newValues, status = 'success', errorMessage = null) {
  try {
    await db.none(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, status, error_message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)`,
      [userId, action, entityType, entityId, JSON.stringify(oldValues || null), JSON.stringify(newValues || null), null, status, errorMessage]
    );
  } catch (error) {
    logger.error('Failed to log audit:', error);
  }
}

function auditMiddleware(action, entityType) {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);
    
    res.json = function(data) {
      // Log after response is sent
      if (req.user) {
        const status = res.statusCode < 400 ? 'success' : 'failed';
        const entityId = req.params.id || data?.id;
        
        logAudit(
          req.user.id,
          action,
          entityType,
          entityId,
          req.body,
          data,
          status,
          res.statusCode < 400 ? null : data?.error
        ).catch(e => logger.error('Audit logging error:', e));
      }
      
      return originalJson(data);
    };
    
    next();
  };
}

module.exports = { logAudit, auditMiddleware };
