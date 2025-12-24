const winston = require('winston');
const path = require('path');
const { loadConfig } = require('../config/config');

// Load configuration
loadConfig();

/**
 * Setup Winston logger
 */
function setupLogger() {
  const logLevel = process.env.LOG_LEVEL || 'info';
  const logDir = process.env.PALWORLD_LOG_PATH || path.join(process.cwd(), 'logs');

  // Ensure log directory exists
  const fs = require('fs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Define log format
  const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
    winston.format.prettyPrint()
  );

  // Define console format for development
  const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, stack }) => {
      return `${timestamp} [${level}]: ${message}${stack ? '\n' + stack : ''}`;
    })
  );

  // Create transports
  const transports = [];

  // Console transport (always available)
  transports.push(new winston.transports.Console({
    format: consoleFormat,
    level: logLevel
  }));

  // File transports for different log levels
  transports.push(new winston.transports.File({
    filename: path.join(logDir, 'error.log'),
    level: 'error',
    format: logFormat
  }));

  transports.push(new winston.transports.File({
    filename: path.join(logDir, 'combined.log'),
    format: logFormat
  }));

  // Create logger
  const logger = winston.createLogger({
    level: logLevel,
    format: logFormat,
    transports,
    exitOnError: false
  });

  // Add request logging method
  logger.logRequest = (req, res) => {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info('HTTP Request', {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
    });
  };

  return logger;
}

module.exports = {
  setupLogger
};