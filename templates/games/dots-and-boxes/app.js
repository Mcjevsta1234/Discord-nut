// Dots and Boxes Game Logic
class DotsAndBoxes {
    constructor(gridSize = 4) {
        this.gridSize = gridSize;
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.currentPlayer = 1;
        this.scores = { 1: 0, 2: 0 };
        this.lines = new Set();
        this.lineOwners = new Map(); // Store which player drew each line
        this.boxes = {};
        
        // Visual settings
        this.dotRadius = 8;
        this.lineWidth = 6;
        this.padding = 60;
        
        this.colors = {
            player1: '#ff6b9d',
            player1Glow: '#ffb6b9',
            player2: '#4ecdc4',
            player2Glow: '#95e1d3',
            dot: '#5d4e6d',
            dotGlow: '#8b7a99',
            hover: '#ffd93d',
            hoverGlow: '#ffed4e',
            background: '#faf3e0'
        };
        
        this.hoveredLine = null;
        this.animatingBoxes = new Set();
        this.setupCanvas();
        this.setupEventListeners();
        this.draw();
    }
    
    setupCanvas() {
        const size = Math.min(600, window.innerWidth - 40);
        this.canvas.width = size;
        this.canvas.height = size;
        this.cellSize = (size - 2 * this.padding) / this.gridSize;
    }
    
    setupEventListeners() {
        this.canvas.addEventListener('click', (e) => this.handleClick(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        
        document.getElementById('new-game').addEventListener('click', () => {
            const newSize = parseInt(document.getElementById('grid-size').value);
            this.resetGame(newSize);
        });
        
        document.getElementById('grid-size').addEventListener('change', (e) => {
            this.resetGame(parseInt(e.target.value));
        });
        
        window.addEventListener('resize', () => {
            this.setupCanvas();
            this.draw();
        });
    }
    
    resetGame(newSize = this.gridSize) {
        this.gridSize = newSize;
        this.currentPlayer = 1;
        this.scores = { 1: 0, 2: 0 };
        this.lines = new Set();
        this.lineOwners = new Map();
        this.boxes = {};
        this.hoveredLine = null;
        this.animatingBoxes = new Set();
        this.setupCanvas();
        this.updateScoreboard();
        this.draw();
    }
    
    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }
    
    getNearestLine(pos) {
        const { x, y } = pos;
        let nearest = null;
        let minDist = 20; // Max distance to consider
        
        // Check horizontal lines
        for (let row = 0; row <= this.gridSize; row++) {
            for (let col = 0; col < this.gridSize; col++) {
                const x1 = this.padding + col * this.cellSize;
                const y1 = this.padding + row * this.cellSize;
                const x2 = x1 + this.cellSize;
                const y2 = y1;
                
                if (x >= x1 && x <= x2 && Math.abs(y - y1) < minDist) {
                    const lineKey = `h-${row}-${col}`;
                    if (!this.lines.has(lineKey)) {
                        nearest = { type: 'h', row, col, x1, y1, x2, y2 };
                        minDist = Math.abs(y - y1);
                    }
                }
            }
        }
        
        // Check vertical lines
        for (let row = 0; row < this.gridSize; row++) {
            for (let col = 0; col <= this.gridSize; col++) {
                const x1 = this.padding + col * this.cellSize;
                const y1 = this.padding + row * this.cellSize;
                const x2 = x1;
                const y2 = y1 + this.cellSize;
                
                if (y >= y1 && y <= y2 && Math.abs(x - x1) < minDist) {
                    const lineKey = `v-${row}-${col}`;
                    if (!this.lines.has(lineKey)) {
                        nearest = { type: 'v', row, col, x1, y1, x2, y2 };
                        minDist = Math.abs(x - x1);
                    }
                }
            }
        }
        
        return nearest;
    }
    
    handleMouseMove(e) {
        const pos = this.getMousePos(e);
        const line = this.getNearestLine(pos);
        
        if (line && line !== this.hoveredLine) {
            this.hoveredLine = line;
            this.canvas.style.cursor = 'pointer';
            this.draw();
        } else if (!line && this.hoveredLine) {
            this.hoveredLine = null;
            this.canvas.style.cursor = 'default';
            this.draw();
        }
    }
    
    handleClick(e) {
        const pos = this.getMousePos(e);
        const line = this.getNearestLine(pos);
        
        if (line) {
            const lineKey = `${line.type}-${line.row}-${line.col}`;
            if (!this.lines.has(lineKey)) {
                this.lines.add(lineKey);
                // Store which player drew this line
                this.lineOwners.set(lineKey, this.currentPlayer);
                
                const boxesCompleted = this.checkBoxes(line);
                
                if (boxesCompleted > 0) {
                    this.scores[this.currentPlayer] += boxesCompleted;
                    this.updateScoreboard();
                    
                    // Check for game over
                    const totalBoxes = this.gridSize * this.gridSize;
                    if (this.scores[1] + this.scores[2] === totalBoxes) {
                        setTimeout(() => this.endGame(), 500);
                    }
                } else {
                    this.switchPlayer();
                }
                
                this.hoveredLine = null;
                this.draw();
            }
        }
    }
    
    checkBoxes(line) {
        let completed = 0;
        const { type, row, col } = line;
        
        if (type === 'h') {
            // Check box above
            if (row > 0) {
                completed += this.checkBox(row - 1, col) ? 1 : 0;
            }
            // Check box below
            if (row < this.gridSize) {
                completed += this.checkBox(row, col) ? 1 : 0;
            }
        } else {
            // Check box to the left
            if (col > 0) {
                completed += this.checkBox(row, col - 1) ? 1 : 0;
            }
            // Check box to the right
            if (col < this.gridSize) {
                completed += this.checkBox(row, col) ? 1 : 0;
            }
        }
        
        return completed;
    }
    
    checkBox(row, col) {
        const boxKey = `${row}-${col}`;
        if (this.boxes[boxKey]) return false;
        
        const top = `h-${row}-${col}`;
        const bottom = `h-${row + 1}-${col}`;
        const left = `v-${row}-${col}`;
        const right = `v-${row}-${col + 1}`;
        
        if (this.lines.has(top) && this.lines.has(bottom) && 
            this.lines.has(left) && this.lines.has(right)) {
            this.boxes[boxKey] = this.currentPlayer;
            return true;
        }
        
        return false;
    }
    
    switchPlayer() {
        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
        document.getElementById('current-turn').textContent = `Player ${this.currentPlayer}'s Turn`;
    }
    
    updateScoreboard() {
        document.getElementById('player1-score').textContent = this.scores[1];
        document.getElementById('player2-score').textContent = this.scores[2];
    }
    
    endGame() {
        const winner = this.scores[1] > this.scores[2] ? 1 : 
                      this.scores[2] > this.scores[1] ? 2 : 0;
        
        let message = winner === 0 ? "It's a tie!" : `Player ${winner} wins!`;
        message += `\n\nFinal Score:\nPlayer 1: ${this.scores[1]}\nPlayer 2: ${this.scores[2]}`;
        
        setTimeout(() => {
            if (confirm(message + "\n\nPlay again?")) {
                this.resetGame();
            }
        }, 100);
    }
    
    draw() {
        // Clear canvas with gradient
        const gradient = this.ctx.createLinearGradient(0, 0, this.canvas.width, this.canvas.height);
        gradient.addColorStop(0, '#faf3e0');
        gradient.addColorStop(0.5, '#f5e6d3');
        gradient.addColorStop(1, '#ffe5e7');
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw completed boxes with gradient
        for (let row = 0; row < this.gridSize; row++) {
            for (let col = 0; col < this.gridSize; col++) {
                const boxKey = `${row}-${col}`;
                if (this.boxes[boxKey]) {
                    const x = this.padding + col * this.cellSize;
                    const y = this.padding + row * this.cellSize;
                    const player = this.boxes[boxKey];
                    
                    // Create gradient for box
                    const boxGradient = this.ctx.createRadialGradient(
                        x + this.cellSize / 2, y + this.cellSize / 2, 0,
                        x + this.cellSize / 2, y + this.cellSize / 2, this.cellSize / 2
                    );
                    
                    if (player === 1) {
                        boxGradient.addColorStop(0, 'rgba(255, 107, 157, 0.4)');
                        boxGradient.addColorStop(1, 'rgba(255, 182, 185, 0.2)');
                    } else {
                        boxGradient.addColorStop(0, 'rgba(78, 205, 196, 0.4)');
                        boxGradient.addColorStop(1, 'rgba(168, 218, 220, 0.2)');
                    }
                    
                    this.ctx.fillStyle = boxGradient;
                    this.ctx.fillRect(x, y, this.cellSize, this.cellSize);
                    
                    // Add border to completed box
                    this.ctx.strokeStyle = player === 1 ? 'rgba(255, 107, 157, 0.6)' : 'rgba(78, 205, 196, 0.6)';
                    this.ctx.lineWidth = 2;
                    this.ctx.strokeRect(x + 2, y + 2, this.cellSize - 4, this.cellSize - 4);
                }
            }
        }
        
        // Draw lines with player-specific colors and glow
        this.ctx.lineWidth = this.lineWidth;
        this.ctx.lineCap = 'round';
        
        for (const lineKey of this.lines) {
            const [type, row, col] = lineKey.split('-');
            const r = parseInt(row);
            const c = parseInt(col);
            
            let x1, y1, x2, y2;
            
            if (type === 'h') {
                x1 = this.padding + c * this.cellSize;
                y1 = this.padding + r * this.cellSize;
                x2 = x1 + this.cellSize;
                y2 = y1;
            } else {
                x1 = this.padding + c * this.cellSize;
                y1 = this.padding + r * this.cellSize;
                x2 = x1;
                y2 = y1 + this.cellSize;
            }
            
            // Get the color based on which player drew this line
            const player = this.lineOwners.get(lineKey) || 1;
            const lineColor = player === 1 ? this.colors.player1 : this.colors.player2;
            const glowColor = player === 1 ? this.colors.player1Glow : this.colors.player2Glow;
            
            // Draw glow effect
            this.ctx.shadowBlur = 15;
            this.ctx.shadowColor = glowColor;
            this.ctx.strokeStyle = lineColor;
            this.ctx.beginPath();
            this.ctx.moveTo(x1, y1);
            this.ctx.lineTo(x2, y2);
            this.ctx.stroke();
            
            // Reset shadow
            this.ctx.shadowBlur = 0;
        }
        
        // Draw hover line with enhanced glow
        if (this.hoveredLine) {
            const { x1, y1, x2, y2 } = this.hoveredLine;
            
            // Outer glow
            this.ctx.shadowBlur = 20;
            this.ctx.shadowColor = this.colors.hoverGlow;
            this.ctx.strokeStyle = this.colors.hover;
            this.ctx.lineWidth = this.lineWidth + 2;
            this.ctx.beginPath();
            this.ctx.moveTo(x1, y1);
            this.ctx.lineTo(x2, y2);
            this.ctx.stroke();
            
            // Reset
            this.ctx.shadowBlur = 0;
            this.ctx.lineWidth = this.lineWidth;
        }
        
        // Draw dots with glow effect
        for (let row = 0; row <= this.gridSize; row++) {
            for (let col = 0; col <= this.gridSize; col++) {
                const x = this.padding + col * this.cellSize;
                const y = this.padding + row * this.cellSize;
                
                // Outer glow
                const glowGradient = this.ctx.createRadialGradient(x, y, 0, x, y, this.dotRadius * 2);
                glowGradient.addColorStop(0, 'rgba(93, 78, 109, 0.4)');
                glowGradient.addColorStop(1, 'rgba(93, 78, 109, 0)');
                this.ctx.fillStyle = glowGradient;
                this.ctx.beginPath();
                this.ctx.arc(x, y, this.dotRadius * 2, 0, Math.PI * 2);
                this.ctx.fill();
                
                // Main dot with gradient
                const dotGradient = this.ctx.createRadialGradient(
                    x - this.dotRadius / 3, y - this.dotRadius / 3, 0,
                    x, y, this.dotRadius
                );
                dotGradient.addColorStop(0, '#8b7a99');
                dotGradient.addColorStop(1, this.colors.dot);
                this.ctx.fillStyle = dotGradient;
                this.ctx.beginPath();
                this.ctx.arc(x, y, this.dotRadius, 0, Math.PI * 2);
                this.ctx.fill();
                
                // Highlight
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
                this.ctx.beginPath();
                this.ctx.arc(x - this.dotRadius / 3, y - this.dotRadius / 3, this.dotRadius / 3, 0, Math.PI * 2);
                this.ctx.fill();
            }
        }
    }
}

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', () => {
    const game = new DotsAndBoxes(4);
});
