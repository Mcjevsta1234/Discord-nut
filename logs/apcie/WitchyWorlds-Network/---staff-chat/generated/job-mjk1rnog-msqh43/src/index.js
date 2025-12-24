const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { loadConfig } = require('./config/config');
const { setupLogger } = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const adminRoutes = require('./routes/admin');
const { setupCronJobs } = require('./services/scheduler');

// Load configuration and setup logger
loadConfig();
const logger = setupLogger();

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