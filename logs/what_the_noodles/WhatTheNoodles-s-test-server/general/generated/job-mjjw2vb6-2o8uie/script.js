// Modern JavaScript with ES6+ Features

// DOM Elements
const app = document.getElementById('app');
const actionBtn = document.getElementById('action-btn');
const output = document.getElementById('output');

// State Management
const state = {
    count: 0,
    lastAction: null
};

// Utility Functions
const formatDate = () => {
    return new Date().toLocaleString();
};

const generateRandomColor = () => {
    const colors = ['#3498db', '#2ecc71', '#e74c3c', '#f1c40f', '#9b59b6', '#1abc9c'];
    return colors[Math.floor(Math.random() * colors.length)];
};

// Event Listeners
actionBtn.addEventListener('click', () => {
    // Update state
    state.count++;
    state.lastAction = 'click';
    
    // Update UI
    updateUI();
    
    // Add animation
    animateButton();
});

// Functions
function updateUI() {
    output.innerHTML = `
        <div class="result-card">
            <p>You clicked the button <span class="highlight">${state.count}</span> times!</p>
            <p>Last action: ${formatDate()}</p>
        </div>
    `;
    
    // Change button color
    actionBtn.style.backgroundColor = generateRandomColor();
}

function animateButton() {
    actionBtn.style.transform = 'scale(0.95)';
    
    setTimeout(() => {
        actionBtn.style.transform = 'scale(1)';
    }, 150);
}

// Initialize
function init() {
    console.log('App initialized at:', formatDate());
    
    // Add some initial styling
    app.style.opacity = '0';
    app.style.transition = 'opacity 0.5s ease-in-out';
    
    setTimeout(() => {
        app.style.opacity = '1';
    }, 100);
}

// Run initialization when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
