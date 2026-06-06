const logger = require('../config/logger');

function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const isDev = process.env.NODE_ENV !== 'production';

  // Log error
  logger.error({
    message: err.message,
    status,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    ip: req.ip,
    stack: isDev ? err.stack : undefined,
  });

  // Send response
  const message = isDev ? err.message : 'Internal server error';
  const responseBody = {
    error: message,
    ...(isDev && { details: err.message, stack: err.stack }),
  };

  res.status(status).json(responseBody);
}

// Async error wrapper
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Validation error handler
function validationErrorHandler(errors) {
  if (errors.isEmpty()) return null;
  
  const messages = errors.array().map(e => ({
    field: e.param,
    message: e.msg,
  }));
  
  const error = new Error('Validation failed');
  error.status = 400;
  error.details = messages;
  return error;
}

module.exports = { errorHandler, asyncHandler, validationErrorHandler };
