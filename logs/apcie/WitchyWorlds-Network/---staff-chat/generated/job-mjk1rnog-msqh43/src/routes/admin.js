const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

// Rate limiting for admin routes
const adminRateLimit = rateLimit({
  windowMs: require('config').get('rateLimit.windowMs'),
  max: require('config').get('rateLimit.maxRequests'),
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests from this IP, please try again later.'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Authentication middleware for all admin routes
router.use(adminRateLimit);
router.use(authenticateToken);
router.use(requireAdmin);

// Server management routes
router.post('/server/start', adminController.startServer);
router.post('/server/stop', adminController.stopServer);
router.post('/server/restart', adminController.restartServer);
router.get('/server/status', adminController.getServerStatus);

// Backup management routes
router.post('/backup/create', adminController.createBackup);
router.get('/backup/list', adminController.listBackups);
router.post('/backup/restore/:backupId', adminController.restoreBackup);
router.delete('/backup/:backupId', adminController.deleteBackup);

// Player management routes
router.get('/players', adminController.listPlayers);
router.post('/players/kick/:playerId', adminController.kickPlayer);
router.post('/players/ban/:playerId', adminController.banPlayer);
router.post('/players/unban/:playerId', adminController.unbanPlayer);

// Chat management routes
router.get('/chat/messages', adminController.getChatMessages);
router.post('/chat/ban-word', adminController.banChatWord);
router.delete('/chat/ban-word/:word', adminController.unbanChatWord);
router.post('/chat/broadcast', adminController.broadcastMessage);

// Configuration routes
router.get('/config', adminController.getServerConfig);
router.put('/config', adminController.updateServerConfig);
router.get('/config/backup', adminController.backupConfig);
router.post('/config/restore', adminController.restoreConfig);

// Log management routes
router.get('/logs', adminController.getLogs);
router.get('/logs/download/:logId', adminController.downloadLog);

// System health routes
router.get('/health', adminController.getSystemHealth);
router.get('/stats', adminController.getSystemStats);

// Mod management routes
router.get('/mods', adminController.listMods);
router.post('/mods/install', adminController.installMod);
router.post('/mods/uninstall/:modId', adminController.uninstallMod);
router.post('/mods/update/:modId', adminController.updateMod);

// Scheduled tasks routes
router.get('/tasks', adminController.listScheduledTasks);
router.post('/tasks/create', adminController.createTask);
router.delete('/tasks/:taskId', adminController.deleteTask);
router.post('/tasks/:taskId/execute', adminController.executeTask);

module.exports = router;