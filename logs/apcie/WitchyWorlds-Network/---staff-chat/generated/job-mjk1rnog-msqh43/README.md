# Palworld Server Management API

A comprehensive Node.js application for managing Palworld servers with admin features, backup management, player control, and system monitoring.

## Features

### Server Management
- Start, stop, and restart Palworld servers
- Real-time server status monitoring
- Automatic server health checks

### Backup Management
- Create and manage server backups
- Schedule automatic backups
- Restore from backups
- Backup retention management

### Player Management
- View connected players
- Kick and ban players
- Player activity tracking

### Chat Management
- View chat history
- Ban offensive words
- Broadcast messages to all players

### Configuration Management
- View and update server settings
- Configuration backup and restore
- Real-time config validation

### Log Management
- Centralized log viewing
- Log download functionality
- Log filtering and search

### System Monitoring
- Server health monitoring
- System resource tracking
- Performance metrics

### Mod Management
- Install and manage server mods
- Mod update functionality
- Mod compatibility checking

### Scheduled Tasks
- Create automated tasks
- Cron-based scheduling
- Task execution tracking

## Installation

### Prerequisites
- Node.js 18.0.0 or higher
- npm or yarn
- Palworld server installation

### Quick Start

1. Clone the repository
```bash
git clone <repository-url>
cd palworld-server
```

2. Install dependencies
```bash
npm install
```

3. Configure environment
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start the server
```bash
npm start
# or for development
npm run dev
```

## Configuration

Edit the `.env` file to configure your server:

```bash
# Server Configuration
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# Authentication
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d

# Admin Configuration
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme123

# Palworld Server Paths
PALWORLD_SERVER_PATH=/opt/palworld/server
PALWORLD_BACKUP_PATH=/opt/palworld/backups
PALWORLD_LOG_PATH=/opt/palworld/logs

# Server Management
MAX_BACKUP_COUNT=10
BACKUP_SCHEDULE=0 2 * * *
SERVER_START_TIMEOUT=60000
SERVER_STOP_TIMEOUT=30000

# Security
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
CORS_ORIGIN=http://localhost:3000
```

## API Documentation

### Authentication

All admin endpoints require authentication via JWT token.

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "your-password"
}
```

Response:
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

Include the token in subsequent requests:
```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Server Management

#### Get Server Status
```http
GET /api/admin/server/status
```

#### Start Server
```http
POST /api/admin/server/start
```

#### Stop Server
```http
POST /api/admin/server/stop
```

#### Restart Server
```http
POST /api/admin/server/restart
```

### Backup Management

#### Create Backup
```http
POST /api/admin/backup/create
```

#### List Backups
```http
GET /api/admin/backup/list
```

#### Restore Backup
```http
POST /api/admin/backup/restore/{backupId}
```

#### Delete Backup
```http
DELETE /api/admin/backup/{backupId}
```

### Player Management

#### List Players
```http
GET /api/admin/players
```

#### Kick Player
```http
POST /api/admin/players/kick/{playerId}
Content-Type: application/json

{
  "reason": "Reason for kick"
}
```

#### Ban Player
```http
POST /api/admin/players/ban/{playerId}
Content-Type: application/json

{
  "reason": "Reason for ban",
  "duration": 3600000
}
```

### Chat Management

#### Get Chat Messages
```http
GET /api/admin/chat/messages?limit=100
```

#### Ban Chat Word
```http
POST /api/admin/chat/ban-word
Content-Type: application/json

{
  "word": "badword"
}
```

#### Broadcast Message
```http
POST /api/admin/chat/broadcast
Content-Type: application/json

{
  "message": "Hello everyone!"
}
```

## Security

- JWT-based authentication
- Rate limiting on all endpoints
- Input validation and sanitization
- CORS protection
- Helmet security headers
- Admin-only access to sensitive operations

## Development

### Running Tests
```bash
npm test
```

### Code Linting
```bash
npm run lint
npm run lint:fix
```

### Code Formatting
```bash
npm run format
```

### Development Server
```bash
npm run dev
```

## Deployment

### Production Build
```bash
npm install --production
```

### Environment Variables
Ensure all required environment variables are set in production:

- `JWT_SECRET`: Strong secret key for JWT tokens
- `ADMIN_PASSWORD`: Secure admin password
- `PALWORLD_SERVER_PATH`: Path to your Palworld server installation

### Reverse Proxy Setup
For production, consider using a reverse proxy like Nginx:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Monitoring

The application includes comprehensive logging and monitoring:

- Request/response logging
- Error tracking
- Security event logging
- Admin action audit trail
- System health monitoring

Logs are stored in the configured log directory and can be monitored using tools like:
- Winston log files
- Log aggregation services
- Monitoring dashboards

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run linting and formatting
6. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues, questions, or feature requests:

- Create an issue on GitHub
- Check the documentation
- Review the API endpoints

## Notes

- Always use strong passwords and JWT secrets in production
- Regularly backup your server configuration
- Monitor server logs for security events
- Keep the application updated with security patches
- Use HTTPS in production environments