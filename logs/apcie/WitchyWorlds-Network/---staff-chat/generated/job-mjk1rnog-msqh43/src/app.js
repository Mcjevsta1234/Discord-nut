const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { loadConfig } = require('./config/config');
const { setupLogger } = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const adminRoutes = require('./routes/admin');
const { setupCronJobs } = require('./services/scheduler');

// Initialize configuration and logger
loadConfig();
const logger = setupLogger();

const createApp = () => {
  const app = express();
  const config = require('config');

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  }));

  app.use(cors({
    origin: config.get('cors.origin'),
    credentials: true,
  }));

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Request logging
  app.use(require('./middleware/logger'));

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: require('../package.json').version,
      environment: process.env.NODE_ENV || 'development'
    });
  });

  // API Routes
  app.use('/api/admin', adminRoutes);

  // Root endpoint
  app.get('/', (req, res) => {
    res.json({
      message: 'Palworld Server Management API',
      version: require('../package.json').version,
      documentation: '/api-docs'
    });
  });

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found'
      }
    });
  });

  // Global error handler
  app.use(errorHandler);

  return app;
};

module.exports = createApp;