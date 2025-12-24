# Three.js Interactive Environment

A simple 3D environment built with Three.js featuring floating platforms, lighting, shadows, and interactive camera controls.

## Features

- Interactive 3D environment with floating platforms
- Realistic lighting and shadows
- Orbit camera controls
- Responsive design
- Smooth animations

## Installation

1. Clone the repository
2. Install dependencies: `npm install`
3. Start development server: `npm run dev`
4. Open http://localhost:3000 in your browser

## Controls

- **Left Click + Drag**: Rotate camera
- **Right Click + Drag**: Pan camera
- **Scroll**: Zoom in/out
- **Arrow Keys**: Move camera (basic implementation)

## Technologies Used

- Three.js
- TypeScript
- Vite
- HTML/CSS

## Project Structure

```
src/
├── index.ts          # Main entry point
├── environment.ts    # Scene setup
├── scene.ts          # 3D objects creation
├── camera.ts         # Camera configuration
├── controls.ts       # Input handling
└── renderer.ts       # Animation loop
```

## License

MIT License
