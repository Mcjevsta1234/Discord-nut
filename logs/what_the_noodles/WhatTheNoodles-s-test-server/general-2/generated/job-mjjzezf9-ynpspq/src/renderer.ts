import * as THREE from 'three';

export function initializeRenderer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  const clock = new THREE.Clock();
  
  const animate = () => {
    requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    
    // Update scene objects
    updateScene(scene, delta);
    
    // Render
    renderer.render(scene, camera);
  };
  
  animate();
}

function updateScene(scene: THREE.Scene, delta: number) {
  // Rotate some objects for visual interest
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh && object.geometry.type === 'BoxGeometry') {
      object.rotation.y += delta * 0.5;
    }
  });
}
