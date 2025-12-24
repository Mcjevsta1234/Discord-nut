const adminController = require('../controllers/adminController');
const { setupLogger } = require('../utils/logger');
const jwt = require('jsonwebtoken');

// Mock services
jest.mock('../services/serverManager', () => ({
  getServerStatus: jest.fn(),
  startServer: jest.fn(),
  stopServer: jest.fn()
}));

jest.mock('../services/backupManager', () => ({
  createBackup: jest.fn(),
  listBackups: jest.fn(),
  restoreBackup: jest.fn(),
  deleteBackup: jest.fn()
}));

jest.mock('../services/playerManager', () => ({
  listPlayers: jest.fn(),
  kickPlayer: jest.fn(),
  banPlayer: jest.fn(),
  unbanPlayer: jest.fn()
}));

jest.mock('../services/chatManager', () => ({
  getChatMessages: jest.fn(),
  banChatWord: jest.fn(),
  unbanChatWord: jest.fn(),
  broadcastMessage: jest.fn()
}));

jest.mock('../services/configManager', () => ({
  getServerConfig: jest.fn(),
  updateServerConfig: jest.fn(),
  backupConfig: jest.fn(),
  restoreConfig: jest.fn()
}));

jest.mock('../services/logManager', () => ({
  getLogs: jest.fn(),
  downloadLog: jest.fn()
}));

jest.mock('../services/systemManager', () => ({
  getSystemHealth: jest.fn(),
  getSystemStats: jest.fn()
}));

jest.mock('../services/modManager', () => ({
  listMods: jest.fn(),
  installMod: jest.fn(),
  uninstallMod: jest.fn(),
  updateMod: jest.fn()
}));

jest.mock('../services/taskManager', () => ({
  listScheduledTasks: jest.fn(),
  createTask: jest.fn(),
  deleteTask: jest.fn(),
  executeTask: jest.fn()
}));

const mockReq = (overrides = {}) => ({
  params: {},
  query: {},
  body: {},
  user: { username: 'admin', role: 'admin' },
  ...overrides
});

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.download = jest.fn().mockReturnValue(res);
  return res;
};

const mockNext = jest.fn();

// Mock JWT secret
process.env.JWT_SECRET = 'test-secret';

describe('AdminController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Server Management', () => {
    test('should get server status', async () => {
      const mockStatus = { status: 'running', players: 5 };
      const { getServerStatus } = require('../services/serverManager');
      getServerStatus.mockResolvedValue(mockStatus);

      const req = mockReq();
      const res = mockRes();

      await adminController.getServerStatus(req, res, mockNext);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockStatus
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('should start server', async () => {
      const mockResult = { success: true, message: 'Server started' };
      const { startServer } = require('../services/serverManager');
      startServer.mockResolvedValue(mockResult);

      const req = mockReq();
      const res = mockRes();

      await adminController.startServer(req, res, mockNext);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Server started successfully',
        data: mockResult
      });
    });

    test('should stop server', async () => {
      const mockResult = { success: true, message: 'Server stopped' };
      const { stopServer } = require('../services/serverManager');
      stopServer.mockResolvedValue(mockResult);

      const req = mockReq();
      const res = mockRes();

      await adminController.stopServer(req, res, mockNext);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Server stopped successfully',
        data: mockResult
      });
    });
  });

  describe('Backup Management', () => {
    test('should create backup', async () => {
      const mockBackup = { id: 'backup-1', name: 'test-backup' };
      const { createBackup } = require('../services/backupManager');
      createBackup.mockResolvedValue(mockBackup);

      const req = mockReq();
      const res = mockRes().status(201);

      await adminController.createBackup(req, res, mockNext);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Backup created successfully',
        data: mockBackup
      });
    });

    test('should list backups', async () => {
      const mockBackups = [
        { id: 'backup-1', name: 'backup-1' },
        { id: 'backup-2', name: 'backup-2' }
      ];
      const { listBackups } = require('../services/backupManager');
      listBackups.mockResolvedValue(mockBackups);

      const req = mockReq();
      const res = mockRes();

      await adminController.listBackups(req, res, mockNext);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockBackups
      });
    });

    test('should restore backup', async () => {
      const mockResult = { success: true, message: 'Restored' };
      const { restoreBackup } = require('../services/backupManager');
      restoreBackup.mockResolvedValue(mockResult);

      const req = mockReq({ params: { backupId: 'backup-1' } });
      const res = mockRes();

      await adminController.restoreBackup(req, res, mockNext);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Backup restored successfully',
        data: mockResult
      });
    });

    test('should return 400 for invalid backup ID', async () => {
      const req = mockReq({ params: { backupId: '' } });
      const res = mockRes();

      await adminController.restoreBackup(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('Player Management', () => {
    test('should list players', async () => {
      const mockPlayers = [
        { id: 'player-1', name: 'Player1' },
        { id: 'player-2', name: 'Player2' }
      ];
      const { listPlayers } = require('../services/playerManager');
      listPlayers.mockResolvedValue(mockPlayers);

      const req = mockReq();
      const res = mockRes();

      await adminController.listPlayers(req, res, mockNext);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockPlayers
      });
    });

    test('should kick player', async () => {
      const mockResult = { success: true, message: 'Kicked' };
      const { kickPlayer } = require('../services/playerManager');
      kickPlayer.mockResolvedValue(mockResult);

      const req = mockReq({
        params: { playerId: 'player-1' },
        body: { reason: 'Test reason' }
      });
      const res = mockRes();

      await adminController.kickPlayer(req, res, mockNext);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Player kicked successfully',
        data: mockResult
      });
    });

    test('should ban player', async () => {
      const mockResult = { success: true, message: 'Banned' };
      const { banPlayer } = require('../services/playerManager');
      banPlayer.mockResolvedValue(mockResult);

      const req = mockReq({
        params: { playerId: 'player-1' },
        body: { reason: 'Test reason', duration: 3600000 }
      });
      const res = mockRes();

      await adminController.banPlayer(req, res, mockNext);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Player banned successfully',
        data: mockResult
      });
    });
  });

  describe('Chat Management', () => {
    test('should get chat messages', async () => {
      const mockMessages = [
        { id: 1, message: 'Hello', timestamp: Date.now() },
        { id: 2, message: 'World', timestamp: Date.now() }
      ];
      const { getChatMessages } = require('../services/chatManager');
      getChatMessages.mockResolvedValue(mockMessages);

      const req = mockReq({ query: { limit: 10 } });
      const res = mockRes();

      await adminController.getChatMessages(req, res, mockNext);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockMessages
      });
    });

    test('should ban chat word', async () => {
      const mockResult = { success: true, message: 'Banned' };
      const { banChatWord } = require('../services/chatManager');
      banChatWord.mockResolvedValue(mockResult);

      const req = mockReq({ body: { word: 'badword' } });
      const res = mockRes();

      await adminController.banChatWord(req, res, mockNext);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Chat word banned successfully',
        data: mockResult
      });
    });

    test('should broadcast message', async () => {
      const mockResult = { success: true, message: 'Broadcasted' };
      const { broadcastMessage } = require('../services/chatManager');
      broadcastMessage.mockResolvedValue(mockResult);

      const req = mockReq({ body: { message: 'Test message' } });
      const res = mockRes();

      await adminController.broadcastMessage(req, res, mockNext);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Message broadcasted successfully',
        data: mockResult
      });
    });
  });

  describe('Configuration Management', () => {
    test('should get server config', async () => {
      const mockConfig = {
        maxPlayers: 32,
        difficulty: 'Normal',
        pvpEnabled: true
      };
      const { getServerConfig } = require('../services/configManager');
      getServerConfig.mockResolvedValue(mockConfig);

      const req = mockReq();
      const res = mockRes();

      await adminController.getServerConfig(req, res, mockNext);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockConfig
      });
    });

    test('should update server config', async () => {
      const mockResult = { success: true, message: 'Updated' };
      const { updateServerConfig } = require('../services/configManager');
      updateServerConfig.mockResolvedValue(mockResult);

      const req = mockReq({
        body: { maxPlayers: 64, difficulty: 'Hard' }
      });
      const res = mockRes();

      await adminController.updateServerConfig(req, res, mockNext);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Server configuration updated successfully',
        data: mockResult
      });
    });

    test('should return 400 for invalid config', async () => {
      const req = mockReq({
        body: { maxPlayers: 'invalid', difficulty: 'Invalid' }
      });
      const res = mockRes();

      await adminController.updateServerConfig(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('System Management', () => {
    test('should get system health', async () => {
      const mockHealth = {
        status: 'healthy',
        cpu: 50,
        memory: 60
      };
      const { getSystemHealth } = require('../services/systemManager');
      getSystemHealth.mockResolvedValue(mockHealth);

      const req = mockReq();
      const res = mockRes();

      await adminController.getSystemHealth(req, res, mockNext);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockHealth
      });
    });

    test('should get system stats', async () => {
      const mockStats = {
        cpuUsage: 45.5,
        memoryUsage: 67.8,
        diskUsage: 34.2
      };
      const { getSystemStats } = require('../services/systemManager');
      getSystemStats.mockResolvedValue(mockStats);

      const req = mockReq();
      const res = mockRes();

      await adminController.getSystemStats(req, res, mockNext);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockStats
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle service errors', async () => {
      const { getServerStatus } = require('../services/serverManager');
      getServerStatus.mockRejectedValue(new Error('Service error'));

      const req = mockReq();
      const res = mockRes();

      await adminController.getServerStatus(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});