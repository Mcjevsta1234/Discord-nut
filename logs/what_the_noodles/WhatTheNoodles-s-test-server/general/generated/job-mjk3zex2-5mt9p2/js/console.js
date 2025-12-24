document.addEventListener('DOMContentLoaded', () => {
    const consoleInput = document.getElementById('console-input');
    const consoleOutput = document.getElementById('console-output');

    const FORBIDDEN_COMMANDS = ['/stop', '/op', '/deop', '/ban', '/kick', '/pardon'];
    
    const mockResponses = {
        '/spark tps': '[INFO]: TPS from last 1m, 5m, 15m: 20.0, 20.0, 19.98',
        '/spark healthreport --memory': '[INFO]: Memory Usage: 4.2GB / 8.0GB (52.5%) | GC: G1 Young Generation',
        '/list': '[INFO]: There are 12 of a max 100 players online: Notch, Jeb_, Dinnerbone...',
        '/help': '[INFO]: Available commands: /spark, /list, /help, /tps, /version',
        '/spark profiler': '[INFO]: Profiler started. Run /spark profiler --stop to view results.'
    };

    function appendLine(text, type = '') {
        const div = document.createElement('div');
        div.className = `line ${type}`;
        div.textContent = text;
        consoleOutput.appendChild(div);
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }

    consoleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const cmd = consoleInput.value.trim().toLowerCase();
            if (!cmd) return;

            appendLine(`> ${cmd}`, 'command');
            consoleInput.value = '';

            // Security Check
            const isForbidden = FORBIDDEN_COMMANDS.some(f => cmd.startsWith(f));
            
            if (isForbidden) {
                setTimeout(() => {
                    appendLine(`[ERROR]: You do not have permission to execute power commands.`, 'error');
                }, 200);
                return;
            }

            // Mock API Logic
            setTimeout(() => {
                if (mockResponses[cmd]) {
                    appendLine(mockResponses[cmd]);
                } else {
                    appendLine(`[INFO]: Command executed successfully. (Mock Pterodactyl API Response)`, 'success');
                }
            }, 400);
        }
    });

    // Simulate random logs
    setInterval(() => {
        if (Math.random() > 0.8) {
            const players = ['Steve', 'Alex', 'CreeperLover', 'MineKing'];
            const player = players[Math.floor(Math.random() * players.length)];
            appendLine(`[14:15:22 INFO]: ${player} joined the game`);
        }
    }, 10000);
});