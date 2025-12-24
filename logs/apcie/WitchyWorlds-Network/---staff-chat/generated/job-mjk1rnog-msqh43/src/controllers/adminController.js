const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const { z } = require('zod');
const { setupLogger } = require('../utils/logger');
const { getServerStatus, startServer, stopServer } = require('../services/serverManager');
const { createBackup, listBackups, restoreBackup, deleteBackup } = require('../services/backupManager');
const { listPlayers, kickPlayer, banPlayer, unbanPlayer } = require('../services/playerManager');
const { getChatMessages, banChatWord, unbanChatWord, broadcastMessage } = require('../services/chatManager');
const { getServerConfig, updateServerConfig, backupConfig, restoreConfig } = require('../services/configManager');
const { getLogs, downloadLog } = require('../services/logManager');
const { getSystemHealth, getSystemStats } = require('../services/systemManager');
const { listMods, installMod, uninstallMod, updateMod } = require('../services/modManager');
const { listScheduledTasks, createTask, deleteTask, executeTask } = require('../services/taskManager');

const logger = setupLogger();
const execAsync = util.promisify(exec);

// Validation schemas
const playerIdSchema = z.string().min(1, 'Player ID is required');
const backupIdSchema = z.string().min(1, 'Backup ID is required');
const modIdSchema = z.string().min(1, 'Mod ID is required');
const taskIdSchema = z.string().min(1, 'Task ID is required');
const chatWordSchema = z.string().min(1, 'Chat word is required');
const messageSchema = z.string().min(1, 'Message is required').max(500, 'Message too long');
const serverConfigSchema = z.object({
  maxPlayers: z.number().min(1).max(64),
  difficulty: z.enum(['Easy', 'Normal', 'Hard']),
  pvpEnabled: z.boolean(),
  friendlyFire: z.boolean(),
  dayNightCycle: z.number().min(60).max(86400),
});

// Helper function to handle async errors
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Server Management
exports.startServer = asyncHandler(async (req, res) => {
  const result = await startServer();
  res.json({
    success: true,
    message: 'Server started successfully',
    data: result
  });
});

exports.stopServer = asyncHandler(async (req, res) => {
  const result = await stopServer();
  res.json({
    success: true,
    message: 'Server stopped successfully',
    data: result
  });
});

exports.restartServer = asyncHandler(async (req, res) => {
  await stopServer();
  // Wait a moment before starting
  await new Promise(resolve => setTimeout(resolve, 5000));
  const result = await startServer();
  res.json({
    success: true,
    message: 'Server restarted successfully',
    data: result
  });
});

exports.getServerStatus = asyncHandler(async (req, res) => {
  const status = await getServerStatus();
  res.json({
    success: true,
    data: status
  });
});

// Backup Management
exports.createBackup = asyncHandler(async (req, res) => {
  const backup = await createBackup();
  res.status(201).json({
    success: true,
    message: 'Backup created successfully',
    data: backup
  });
});

exports.listBackups = asyncHandler(async (req, res) => {
  const backups = await listBackups();
  res.json({
    success: true,
    data: backups
  });
});

exports.restoreBackup = asyncHandler(async (req, res) => {
  const { backupId } = req.params;
  backupIdSchema.parse(backupId);
  
  const result = await restoreBackup(backupId);
  res.json({
    success: true,
    message: 'Backup restored successfully',
    data: result
  });
});

exports.deleteBackup = asyncHandler(async (req, res) => {
  const { backupId } = req.params;
  backupIdSchema.parse(backupId);
  
  await deleteBackup(backupId);
  res.json({
    success: true,
    message: 'Backup deleted successfully'
  });
});

// Player Management
exports.listPlayers = asyncHandler(async (req, res) => {
  const players = await listPlayers();
  res.json({
    success: true,
    data: players
  });
});

exports.kickPlayer = asyncHandler(async (req, res) => {
  const { playerId } = req.params;
  playerIdSchema.parse(playerId);
  
  const reason = req.body.reason || 'No reason provided';
  const result = await kickPlayer(playerId, reason);
  res.json({
    success: true,
    message: 'Player kicked successfully',
    data: result
  });
});

exports.banPlayer = asyncHandler(async (req, res) => {
  const { playerId } = req.params;
  playerIdSchema.parse(playerId);
  
  const reason = req.body.reason || 'No reason provided';
  const duration = req.body.duration; // Optional duration in ms
  
  const result = await banPlayer(playerId, reason, duration);
  res.json({
    success: true,
    message: 'Player banned successfully',
    data: result
  });
});

exports.unbanPlayer = asyncHandler(async (req, res) => {
  const { playerId } = req.params;
  playerIdSchema.parse(playerId);
  
  const result = await unbanPlayer(playerId);
  res.json({
    success: true,
    message: 'Player unbanned successfully',
    data: result
  });
});

// Chat Management
exports.getChatMessages = asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const messages = await getChatMessages(limit);
  res.json({
    success: true,
    data: messages
  });
});

exports.banChatWord = asyncHandler(async (req, res) => {
  const { word } = req.body;
  chatWordSchema.parse(word);
  
  const result = await banChatWord(word);
  res.json({
    success: true,
    message: 'Chat word banned successfully',
    data: result
  });
});

exports.unbanChatWord = asyncHandler(async (req, res) => {
  const { word } = req.params;
  chatWordSchema.parse(word);
  
  await unbanChatWord(word);
  res.json({
    success: true,
    message: 'Chat word unbanned successfully'
  });
});

exports.broadcastMessage = asyncHandler(async (req, res) => {
  const { message } = req.body;
  messageSchema.parse(message);
  
  const result = await broadcastMessage(message);
  res.json({
    success: true,
    message: 'Message broadcasted successfully',
    data: result
  });
});

// Configuration Management
exports.getServerConfig = asyncHandler(async (req, res) => {
  const config = await getServerConfig();
  res.json({
    success: true,
    data: config
  });
});

exports.updateServerConfig = asyncHandler(async (req, res) => {
  serverConfigSchema.parse(req.body);
  
  const result = await updateServerConfig(req.body);
  res.json({
    success: true,
    message: 'Server configuration updated successfully',
    data: result
  });
});

exports.backupConfig = asyncHandler(async (req, res) => {
  const backup = await backupConfig();
  res.status(201).json({
    success: true,
    message: 'Configuration backup created successfully',
    data: backup
  });
});

exports.restoreConfig = asyncHandler(async (req, res) => {
  const { backupId } = req.body;
  if (!backupId) {
    return res.status(400).json({
      success: false,
      error: 'Backup ID is required'
    });
  }
  
  const result = await restoreConfig(backupId);
  res.json({
    success: true,
    message: 'Configuration restored successfully',
    data: result
  });
});

// Log Management
exports.getLogs = asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const logs = await getLogs(limit);
  res.json({
    success: true,
    data: logs
  });
});

exports.downloadLog = asyncHandler(async (req, res) => {
  const { logId } = req.params;
  const logPath = await downloadLog(logId);
  
  if (!logPath) {
    return res.status(404).json({
      success: false,
      error: 'Log not found'
    });
  }
  
  res.download(logPath, (err) => {
    if (err) {
      logger.error('Error downloading log:', err);
      res.status(500).json({
        success: false,
        error: 'Failed to download log'
      });
    }
  });
});

// System Management
exports.getSystemHealth = asyncHandler(async (req, res) => {
  const health = await getSystemHealth();
  res.json({
    success: true,
    data: health
  });
});

exports.getSystemStats = asyncHandler(async (req, res) => {
  const stats = await getSystemStats();
  res.json({
    success: true,
    data: stats
  });
});

// Mod Management
exports.listMods = asyncHandler(async (req, res) => {
  const mods = await listMods();
  res.json({
    success: true,
    data: mods
  });
});

exports.installMod = asyncHandler(async (req, res) => {
  const { modUrl, modName } = req.body;
  
  if (!modUrl || !modName) {
    return res.status(400).json({
      success: false,
      error: 'Mod URL and name are required'
    });
  }
  
  const result = await installMod(modUrl, modName);
  res.status(201).json({
    success: true,
    message: 'Mod installed successfully',
    data: result
  });
});

exports.uninstallMod = asyncHandler(async (req, res) => {
  const { modId } = req.params;
  modIdSchema.parse(modId);
  
  const result = await uninstallMod(modId);
  res.json({
    success: true,
    message: 'Mod uninstalled successfully',
    data: result
  });
});

exports.updateMod = asyncHandler(async (req, res) => {
  const { modId } = req.params;
  modIdSchema.parse(modId);
  
  const result = await updateMod(modId);
  res.json({
    success: true,
    message: 'Mod updated successfully',
    data: result
  });
});

// Task Management
exports.listScheduledTasks = asyncHandler(async (req, res) => {
  const tasks = await listScheduledTasks();
  res.json({
    success: true,
    data: tasks
  });
});

exports.createTask = asyncHandler(async (req, res) => {
  const { name, cronExpression, action, enabled } = req.body;
  
  if (!name || !cronExpression || !action) {
    return res.status(400).json({
      success: false,
      error: 'Name, cron expression, and action are required'
    });
  }
  
  const result = await createTask({ name, cronExpression, action, enabled: enabled !== false });
  res.status(201).json({
    success: true,
    message: 'Task created successfully',
    data: result
  });
});

exports.deleteTask = asyncHandler(async (req, res) => {
  const { taskId } = req.params;
  taskIdSchema.parse(taskId);
  
  await deleteTask(taskId);
  res.json({
    success: true,
    message: 'Task deleted successfully'
  });
});

exports.executeTask = asyncHandler(async (req, res) => {
  const { taskId } = req.params;
  taskIdSchema.parse(taskId);
  
  const result = await executeTask(taskId);
  res.json({
    success: true,
    message: 'Task executed successfully',
    data: result
  });
});