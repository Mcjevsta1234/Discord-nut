// Entry point for the application
import { setupEnvironment } from './environment';
import { initializeRenderer } from './renderer';
import { createScene } from './scene';
import { createCamera } from './camera';
import { createControls } from './controls';

// Setup environment
const { scene, camera, renderer } = setupEnvironment();

// Create scene content
createScene(scene);

// Setup camera
createCamera(camera);

// Setup controls
createControls(camera, renderer);

// Start rendering loop
initializeRenderer(renderer, scene, camera);
