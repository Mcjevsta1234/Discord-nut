import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

export function createControls(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxDistance = 50;
  controls.minDistance = 2;
  
  // Add keyboard controls
  const keys = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false
  };
  
  window.addEventListener('keydown', (e) => {
    if (e.code in keys) {
      keys[e.code as keyof typeof keys] = true;
    }
  });
  
  window.addEventListener('keyup', (e) => {
    if (e.code in keys) {
      keys[e.code as keyof typeof keys] = false;
    }
  });
  
  // Update controls in render loop
  const updateControls = () => {
    controls.update();
  };
  
  return updateControls;
}
