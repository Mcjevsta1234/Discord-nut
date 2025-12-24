const request = require('supertest');
const express = require('express');
const adminRoutes = require('../admin');
const { setupLogger } = require('../../utils/logger');
const jwt = require('jsonwebtoken');

// Setup test app
const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);

// Mock middleware
jest.mock('../../middleware/auth', () => ({
  authenticateToken: jest.fn((req, res, next) => {
    // Mock successful authentication
    req.user = { username: 'admin', role: 'admin' };
    next();
  }),
  requireAdmin: jest.fn((req, res, next) => {
    next();
  })
}));

// Mock rate limit
jest.mock('express-rate-limit', () => () => (req, res, next) => next());

// Mock controllers
jest.mock('../../controllers/adminController', () => ({
  getServerStatus: jest.fn((req, res) => {
    res.json({ success: true, data: { status: 'running' } });
  }),
  startServer: jest.fn((req, res) => {
    res.json({ success: true, message: 'Server started' });
  }),
  stopServer: jest.fn((req, res) => {
    res.json({ success: true, message: 'Server stopped' });
  }),
  createBackup: jest.fn((req, res) => {
    res.status(201).json({ success: true, message: 'Backup created' });
  }),
  listBackups: jest.fn((req, res) => {
    res.json({ success: true, data: [] });
  }),
  restoreBackup: jest.fn((req, res) => {
    res.json({ success: true, message: 'Backup restored' });
  }),
  deleteBackup: jest.fn((req, res) => {
    res.json({ success: true, message: 'Backup deleted' });
  }),
  listPlayers: jest.fn((req, res) => {
    res.json({ success: true, data: [] });
  }),
  kickPlayer: jest.fn((req, res) => {
    res.json({ success: true, message: 'Player kicked' });
  }),
  banPlayer: jest.fn((req, res) => {
    res.json({ success: true, message: 'Player banned' });
  }),
  getChatMessages: jest.fn((req, res) => {
    res.json({ success: true, data: [] });
  }),
  banChatWord: jest.fn((req, res) => {
    res.json({ success: true, message: 'Chat word banned' });
  }),
  broadcastMessage: jest.fn((req, res) => {
    res.json({ success: true, message: 'Message broadcasted' });
  }),
  getServerConfig: jest.fn((req, res) => {
    res.json({ success: true, data: {} });
  }),
  updateServerConfig: jest.fn((req, res) => {
    res.json({ success: true, message: 'Config updated' });
  }),
  getLogs: jest.fn((req, res) => {
    res.json({ success: true, data: [] });
  }),
  getSystemHealth: jest.fn((req, res) => {
    res.json({ success: true, data: {} });
  }),
  getSystemStats: jest.fn((req, res) => {
    res.json({ success: true, data: {} });
  }),
  listMods: jest.fn((req, res) => {
    res.json({ success: true, data: [] });
  }),
  installMod: jest.fn((req, res) => {
    res.status(201).json({ success: true, message: 'Mod installed' });
  }),
  listScheduledTasks: jest.fn((req, res) => {
    res.json({ success: true, data: [] });
  }),
  createTask: jest.fn((req, res) => {
    res.status(201).json({ success: true, message: 'Task created' });
  })
}));

const adminController = require('../../controllers/adminController');

// Mock JWT secret
process.env.JWT_SECRET = 'test-secret';

describe('Admin Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Server Management Routes', () => {
    test('GET /server/status should return server status', async () => {
      const response = await request(app)
        .get('/api/admin/server/status')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: { status: 'running' }
      });
      expect(adminController.getServerStatus).toHaveBeenCalled();
    });

    test('POST /server/start should start server', async () => {
      const response = await request(app)
        .post('/api/admin/server/start')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Server started'
      });
      expect(adminController.startServer).toHaveBeenCalled();
    });

    test('POST /server/stop should stop server', async () => {
      const response = await request(app)
        .post('/api/admin/server/stop')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Server stopped'
      });
      expect(adminController.stopServer).toHaveBeenCalled();
    });
  });

  describe('Backup Management Routes', () => {
    test('POST /backup/create should create backup', async () => {
      const response = await request(app)
        .post('/api/admin/backup/create')
        .expect(201);

      expect(response.body).toEqual({
        success: true,
        message: 'Backup created'
      });
      expect(adminController.createBackup).toHaveBeenCalled();
    });

    test('GET /backup/list should list backups', async () => {
      const response = await request(app)
        .get('/api/admin/backup/list')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: []
      });
      expect(adminController.listBackups).toHaveBeenCalled();
    });

    test('POST /backup/restore/:backupId should restore backup', async () => {
      const response = await request(app)
        .post('/api/admin/backup/restore/backup-1')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Backup restored'
      });
      expect(adminController.restoreBackup).toHaveBeenCalled();
    });

    test('DELETE /backup/:backupId should delete backup', async () => {
      const response = await request(app)
        .delete('/api/admin/backup/backup-1')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Backup deleted'
      });
      expect(adminController.deleteBackup).toHaveBeenCalled();
    });
  });

  describe('Player Management Routes', () => {
    test('GET /players should list players', async () => {
      const response = await request(app)
        .get('/api/admin/players')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: []
      });
      expect(adminController.listPlayers).toHaveBeenCalled();
    });

    test('POST /players/kick/:playerId should kick player', async () => {
      const response = await request(app)
        .post('/api/admin/players/kick/player-1')
        .send({ reason: 'Test reason' })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Player kicked'
      });
      expect(adminController.kickPlayer).toHaveBeenCalled();
    });

    test('POST /players/ban/:playerId should ban player', async () => {
      const response = await request(app)
        .post('/api/admin/players/ban/player-1')
        .send({ reason: 'Test reason', duration: 3600000 })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Player banned'
      });
      expect(adminController.banPlayer).toHaveBeenCalled();
    });
  });

  describe('Chat Management Routes', () => {
    test('GET /chat/messages should get chat messages', async () => {
      const response = await request(app)
        .get('/api/admin/chat/messages?limit=10')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: []
      });
      expect(adminController.getChatMessages).toHaveBeenCalled();
    });

    test('POST /chat/ban-word should ban chat word', async () => {
      const response = await request(app)
        .post('/api/admin/chat/ban-word')
        .send({ word: 'badword' })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Chat word banned'
      });
      expect(adminController.banChatWord).toHaveBeenCalled();
    });

    test('POST /chat/broadcast should broadcast message', async () => {
      const response = await request(app)
        .post('/api/admin/chat/broadcast')
        .send({ message: 'Test message' })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Message broadcasted'
      });
      expect(adminController.broadcastMessage).toHaveBeenCalled();
    });
  });

  describe('Configuration Management Routes', () => {
    test('GET /config should get server config', async () => {
      const response = await request(app)
        .get('/api/admin/config')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {}
      });
      expect(adminController.getServerConfig).toHaveBeenCalled();
    });

    test('PUT /config should update server config', async () => {
      const response = await request(app)
        .put('/api/admin/config')
        .send({ maxPlayers: 64 })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Config updated'
      });
      expect(adminController.updateServerConfig).toHaveBeenCalled();
    });
  });

  describe('Log Management Routes', () => {
    test('GET /logs should get logs', async () => {
      const response = await request(app)
        .get('/api/admin/logs?limit=100')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: []
      });
      expect(adminController.getLogs).toHaveBeenCalled();
    });
  });

  describe('System Management Routes', () => {
    test('GET /health should get system health', async () => {
      const response = await request(app)
        .get('/api/admin/health')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {}
      });
      expect(adminController.getSystemHealth).toHaveBeenCalled();
    });

    test('GET /stats should get system stats', async () => {
      const response = await request(app)
        .get('/api/admin/stats')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {}
      });
      expect(adminController.getSystemStats).toHaveBeenCalled();
    });
  });

  describe('Mod Management Routes', () => {
    test('GET /mods should list mods', async () => {
      const response = await request(app)
        .get('/api/admin/mods')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: []
      });
      expect(adminController.listMods).toHaveBeenCalled();
    });

    test('POST /mods/install should install mod', async () => {
      const response = await request(app)
        .post('/api/admin/mods/install')
        .send({ modUrl: 'http://example.com/mod.zip', modName: 'Test Mod' })
        .expect(201);

      expect(response.body).toEqual({
        success: true,
        message: 'Mod installed'
      });
      expect(adminController.installMod).toHaveBeenCalled();
    });
  });

  describe('Task Management Routes', () => {
    test('GET /tasks should list scheduled tasks', async () => {
      const response = await request(app)
        .get('/api/admin/tasks')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: []
      });
      expect(adminController.listScheduledTasks).toHaveBeenCalled();
    });

    test('POST /tasks/create should create task', async () => {
      const response = await request(app)
        .post('/api/admin/tasks/create')
        .send({
          name: 'Test Task',
          cronExpression: '0 0 * * *',
          action: 'backup'
        })
        .expect(201);

      expect(response.body).toEqual({
        success: true,
        message: 'Task created'
      });
      expect(adminController.createTask).toHaveBeenCalled();
    });
  });

  describe('Route Middleware Integration', () => {
    test('should apply authentication middleware to all routes', async () => {
      // This test verifies that the authentication middleware is properly applied
      // Since we're mocking the middleware, we test that it's called
      const { authenticateToken } = require('../../middleware/auth');
      
      await request(app)
        .get('/api/admin/server/status')
        .expect(200);

      expect(authenticateToken).toHaveBeenCalled();
    });

    test('should apply admin role check to all routes', async () => {
      const { requireAdmin } = require('../../middleware/auth');
      
      await request(app)
        .get('/api/admin/server/status')
        .expect(200);

      expect(requireAdmin).toHaveBeenCalled();
    });

    test('should apply rate limiting to all routes', async () => {
      const rateLimit = require('express-rate-limit');
      
      await request(app)
        .get('/api/admin/server/status')
        .expect(200);

      expect(rateLimit).toHaveBeenCalled();
    });
  });
});