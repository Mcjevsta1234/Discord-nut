document.addEventListener('DOMContentLoaded', () => {
    // --- Console Logic ---
    const consoleInput = document.getElementById('consoleInput');
    const consoleOutput = document.getElementById('consoleOutput');

    const ALLOWED_COMMANDS = ['/spark', '/list', '/help', '/tps', '/healthreport', '/status'];
    const FORBIDDEN_COMMANDS = ['/stop', '/op', '/deop', '/ban', '/kick', '/pardon'];

    if (consoleInput) {
        consoleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const cmd = consoleInput.value.trim().toLowerCase();
                if (!cmd) return;

                appendLine(`> ${cmd}`, 'user-cmd');
                processCommand(cmd);
                consoleInput.value = '';
            }
        });
    }

    function appendLine(text, type = '') {
        const line = document.createElement('div');
        line.className = `line ${type}`;
        line.innerText = text;
        consoleOutput.appendChild(line);
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }

    function processCommand(cmd) {
        // Simulate API Latency
        setTimeout(() => {
            const baseCmd = cmd.split(' ')[0];

            if (FORBIDDEN_COMMANDS.includes(baseCmd)) {
                appendLine(`[Error]: You do not have permission to execute power commands.`, 'error');
                return;
            }

            if (cmd.includes('/spark tps')) {
                appendLine(`[spark]: TPS from last 1m, 5m, 15m:`, 'cmd-out');
                appendLine(`* 20.0, 19.98, 20.0`, 'cmd-out');
            } else if (cmd.includes('/spark healthreport')) {
                appendLine(`[spark]: Health Report generated: https://spark.aethernode.com/r/xyz123`, 'cmd-out');
                appendLine(`[spark]: Memory: 2.4GB / 6.0GB`, 'cmd-out');
            } else if (cmd === '/list') {
                appendLine(`[Server]: There are 12/100 players online.`, 'cmd-out');
            } else if (cmd === '/help') {
                appendLine(`Available commands: ${ALLOWED_COMMANDS.join(', ')}`, 'cmd-out');
            } else {
                appendLine(`[Server]: Unknown command or insufficient permissions.`, 'error');
            }
        }, 400);
    }

    // --- Reveal Animations ---
    const observerOptions = {
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
            }
        });
    }, observerOptions);

    document.querySelectorAll('[data-reveal]').forEach(el => observer.observe(el));

    // --- Navbar Scroll Effect ---
    window.addEventListener('scroll', () => {
        const nav = document.querySelector('.navbar');
        if (window.scrollY > 50) {
            nav.style.padding = '1rem 0';
            nav.style.background = 'rgba(15, 23, 42, 0.95)';
        } else {
            nav.style.padding = '1.5rem 0';
            nav.style.background = 'rgba(15, 23, 42, 0.8)';
        }
    });
});