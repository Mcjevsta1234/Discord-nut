import * as THREE from 'three';

export function createCamera(camera: THREE.PerspectiveCamera) {
  // Initial camera position
  camera.position.set(0, 5, 10);
  camera.lookAt(0, 0, 0);
  
  // Camera animation
  const animateCamera = () => {
    const time = Date.now() * 0.001;
    
    camera.position.x = Math.sin(time) * 8;
    camera.position.z = Math.cos(time) * 8;
    camera.lookAt(0, 0, 0);
  };
  
  // Add to renderer loop
  const originalRender = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) => {
    animateCamera();
    renderer.render(scene, camera);
  };
  
  return originalRender;
}
