const request = require('supertest');
const createApp = require('../src/app');
const jwt = require('jsonwebtoken');

const app = createApp();

// Mock JWT secret for testing
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

describe('Admin API Endpoints', () => {
  let authToken;

  beforeAll(() => {
    // Create a test JWT token
    authToken = jwt.sign(
      { username: 'admin', role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  describe('Authentication', () => {
    test('should return 401 without token', async () => {
      const response = await request(app)
        .get('/api/admin/server/status')
        .expect(401);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    test('should return 401 with invalid token', async () => {
      const response = await request(app)
        .get('/api/admin/server/status')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Server Management', () => {
    test('should get server status with valid token', async () => {
      const response = await request(app)
        .get('/api/admin/server/status')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
    });

    test('should start server', async () => {
      const response = await request(app)
        .post('/api/admin/server/start')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message');
    });

    test('should stop server', async () => {
      const response = await request(app)
        .post('/api/admin/server/stop')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message');
    });
  });

  describe('Backup Management', () => {
    test('should create backup', async () => {
      const response = await request(app)
        .post('/api/admin/backup/create')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('data');
    });

    test('should list backups', async () => {
      const response = await request(app)
        .get('/api/admin/backup/list')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('should return 400 for invalid backup ID', async () => {
      const response = await request(app)
        .post('/api/admin/backup/restore/invalid-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Player Management', () => {
    test('should list players', async () => {
      const response = await request(app)
        .get('/api/admin/players')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('should return 400 for invalid player ID', async () => {
      const response = await request(app)
        .post('/api/admin/players/kick/invalid-id')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ reason: 'Test kick' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Chat Management', () => {
    test('should get chat messages', async () => {
      const response = await request(app)
        .get('/api/admin/chat/messages?limit=10')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('should ban chat word', async () => {
      const response = await request(app)
        .post('/api/admin/chat/ban-word')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ word: 'testword' })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message');
    });

    test('should broadcast message', async () => {
      const response = await request(app)
        .post('/api/admin/chat/broadcast')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ message: 'Test broadcast message' })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message');
    });
  });

  describe('Configuration Management', () => {
    test('should get server config', async () => {
      const response = await request(app)
        .get('/api/admin/config')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
    });

    test('should return 400 for invalid config', async () => {
      const response = await request(app)
        .put('/api/admin/config')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ invalidField: 'value' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('System Management', () => {
    test('should get system health', async () => {
      const response = await request(app)
        .get('/api/admin/health')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
    });

    test('should get system stats', async () => {
      const response = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
    });
  });

  describe('Error Handling', () => {
    test('should return 404 for unknown endpoint', async () => {
      const response = await request(app)
        .get('/api/admin/unknown')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });
});