const { setupLogger } = require('../utils/logger');

const logger = setupLogger();

/**
 * Request logging middleware
 */
const requestLogger = (req, res, next) => {
  const start = Date.now();

  // Log request
  logger.info('HTTP Request', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });

  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(...args) {
    const duration = Date.now() - start;

    logger.info('HTTP Response', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });

    originalEnd.apply(this, args);
  };

  next();
};

/**
 * Security event logger
 */
const securityLogger = (event, details = {}) => {
  logger.warn('Security Event', {
    event,
    ...details,
    timestamp: new Date().toISOString()
  });
};

/**
 * Admin action logger
 */
const adminActionLogger = (action, user, details = {}) => {
  logger.info('Admin Action', {
    action,
    user: user.username || user.id,
    ip: details.ip,
    ...details,
    timestamp: new Date().toISOString()
  });
};

module.exports = {
  requestLogger,
  securityLogger,
  adminActionLogger
};