/**
 * Mock Pterodactyl Console Logic
 * Simulates a WebSocket connection to a Minecraft server.
 * Handles command parsing and response simulation.
 */

document.addEventListener('DOMContentLoaded', () => {
    const consoleInput = document.getElementById('console-input');
    const consoleOutput = document.getElementById('console-output');

    if (!consoleInput || !consoleOutput) return;

    // Auto-scroll to bottom on load
    consoleOutput.scrollTop = consoleOutput.scrollHeight;

    consoleInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const command = consoleInput.value.trim();
            if (command) {
                // Echo command
                logToConsole(`> ${command}`, 'normal');
                consoleInput.value = '';
                
                // Process command with delay to simulate network latency
                setTimeout(() => {
                    processCommand(command);
                }, 200 + Math.random() * 300);
            }
        }
    });

    function processCommand(cmd) {
        const lowerCmd = cmd.toLowerCase();
        const args = lowerCmd.split(' ');
        const baseCmd = args[0];

        // BLOCKED COMMANDS
        if (baseCmd === '/stop' || baseCmd === 'stop') {
            logToConsole("[Pterodactyl Daemon]: Error: Command blocked for security reasons in demo mode.", 'error');
            return;
        }

        if (baseCmd === '/op' || baseCmd === 'op') {
            logToConsole("[Server thread/WARN]: You do not have permission to use this command.", 'error');
            return;
        }

        // ALLOWED COMMANDS
        switch (baseCmd) {
            case '/help':
            case 'help':
                logToConsole("--- Showing help page 1 of 1 ---", 'info');
                logToConsole("/spark <profiler|tps|health> - Performance tools", 'normal');
                logToConsole("/list - List online players", 'normal');
                logToConsole("/tps - Check ticks per second", 'normal');
                logToConsole("/say <message> - Broadcast message", 'normal');
                break;

            case '/list':
            case 'list':
                logToConsole("[Server thread/INFO]: There are 0/20 players online.", 'normal');
                break;

            case '/tps':
            case 'tps':
                logToConsole("[Server thread/INFO]: TPS from last 1m, 5m, 15m: 20.0, 20.0, 20.0", 'success');
                break;

            case '/spark':
            case 'spark':
                if (args[1] === 'tps') {
                    logToConsole("[spark]: TPS: 20.0 (100%)", 'success');
                    logToConsole("[spark]: MSPT: 2.4ms (min: 1.1ms, max: 4.5ms)", 'normal');
                } else if (args[1] === 'healthreport' || (args[1] === 'health' && args[2] === '--memory')) {
                    logToConsole("[spark]: Generating health report...", 'info');
                    setTimeout(() => {
                        logToConsole("[spark]: Memory Usage: 2.1 GB / 8.0 GB (26%)", 'normal');
                        logToConsole("[spark]: CPU Usage: 4.2% (Ryzen 9 7950X)", 'normal');
                    }, 500);
                } else {
                    logToConsole("[spark]: Spark v1.10.34", 'info');
                    logToConsole("[spark]: Use /spark tps or /spark healthreport", 'normal');
                }
                break;
            
            case '/say':
            case 'say':
                const msg = cmd.substring(cmd.indexOf(' ') + 1);
                logToConsole(`[Server] ${msg}`, 'info');
                break;

            default:
                logToConsole(`[Server thread/INFO]: Unknown command: ${baseCmd}`, 'normal');
                break;
        }
    }

    function logToConsole(text, type) {
        const line = document.createElement('div');
        line.className = 'line';
        
        const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
        
        let content = `<span class="time">[${time}]</span> `;
        
        if (type === 'error') {
            content += `<span class="error">${text}</span>`;
        } else if (type === 'success') {
            content += `<span class="success">${text}</span>`;
        } else if (type === 'info') {
            content += `<span class="info">${text}</span>`;
        } else {
            content += `<span class="normal">${text}</span>`;
        }

        line.innerHTML = content;
        consoleOutput.appendChild(line);
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }

    // Simulate random server log activity occasionally
    setInterval(() => {
        if (Math.random() > 0.9) {
            const logs = [
                "[Server thread/INFO]: Villager entity 432 saved to disk.",
                "[Server thread/INFO]: Saving chunks for level 'ServerLevel'...",
                "[Server thread/INFO]: Done saving.",
                "[Server thread/INFO]: [Spark] Garbage collector freed 402MB."
            ];
            const randomLog = logs[Math.floor(Math.random() * logs.length)];
            logToConsole(randomLog, 'normal');
        }
    }, 15000);
});

/* 
 * NOTE FOR DEVELOPERS:
 * To connect this to a REAL Pterodactyl API:
 * 1. You need an API Key from your Pterodactyl Panel.
 * 2. Use the WebSocket API (Wings) to subscribe to the server console.
 * 3. Replace the processCommand function with a websocket.send() call.
 * 4. Replace the logToConsole calls with websocket.onmessage listeners.
 */