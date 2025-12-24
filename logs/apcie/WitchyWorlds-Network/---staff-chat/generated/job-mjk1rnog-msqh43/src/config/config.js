const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

/**
 * Load configuration from .env file and validate required variables
 */
function loadConfig() {
  const envFile = path.join(process.cwd(), '.env');
  
  if (fs.existsSync(envFile)) {
    const result = dotenv.config({ path: envFile });
    if (result.error) {
      console.warn('Warning: Could not load .env file:', result.error.message);
    }
  }

  // Set default values for missing environment variables
  const defaults = {
    PORT: 3000,
    NODE_ENV: 'development',
    LOG_LEVEL: 'info',
    JWT_SECRET: 'dev-secret-key-change-in-production',
    JWT_EXPIRES_IN: '7d',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'admin123',
    PALWORLD_SERVER_PATH: '/opt/palworld/server',
    PALWORLD_BACKUP_PATH: '/opt/palworld/backups',
    PALWORLD_LOG_PATH: '/opt/palworld/logs',
    MAX_BACKUP_COUNT: 10,
    BACKUP_SCHEDULE: '0 2 * * *',
    SERVER_START_TIMEOUT: 60000,
    SERVER_STOP_TIMEOUT: 30000,
    RATE_LIMIT_WINDOW_MS: 900000,
    RATE_LIMIT_MAX_REQUESTS: 100,
    CORS_ORIGIN: 'http://localhost:3000'
  };

  // Apply defaults
  Object.keys(defaults).forEach(key => {
    if (!process.env[key]) {
      process.env[key] = defaults[key].toString();
    }
  });

  // Validate required environment variables
  const required = ['JWT_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('Error: Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }

  // Warn about using default values in production
  if (process.env.NODE_ENV === 'production') {
    if (process.env.JWT_SECRET === defaults.JWT_SECRET) {
      console.warn('Warning: Using default JWT_SECRET in production. This is insecure!');
    }
    if (process.env.ADMIN_PASSWORD === defaults.ADMIN_PASSWORD) {
      console.warn('Warning: Using default admin password in production. This is insecure!');
    }
  }
}

/**
 * Get configuration value with optional default
 */
function getConfig(key, defaultValue = null) {
  return process.env[key] || defaultValue;
}

/**
 * Get all configuration
 */
function getAllConfig() {
  return process.env;
}

/**
 * Check if running in development mode
 */
function isDevelopment() {
  return process.env.NODE_ENV === 'development';
}

/**
 * Check if running in production mode
 */
function isProduction() {
  return process.env.NODE_ENV === 'production';
}

module.exports = {
  loadConfig,
  getConfig,
  getAllConfig,
  isDevelopment,
  isProduction
};