import * as THREE from 'three';

export function createScene(scene: THREE.Scene) {
  // Create ground
  const groundGeometry = new THREE.PlaneGeometry(100, 100);
  const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x404040 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  ground.receiveShadow = true;
  scene.add(ground);
  
  // Add grid helper
  const gridHelper = new THREE.GridHelper(100, 100, 0x505050, 0x303030);
  scene.add(gridHelper);
  
  // Create floating platforms
  createFloatingPlatform(scene, -4, 0, -4);
  createFloatingPlatform(scene, 4, 0, -4);
  createFloatingPlatform(scene, 0, 2, 0);
  createFloatingPlatform(scene, -4, 2, 4);
  createFloatingPlatform(scene, 4, 2, 4);
  
  // Add lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 20, 10);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  scene.add(directionalLight);
}

function createFloatingPlatform(scene: THREE.Scene, x: number, y: number, z: number) {
  const geometry = new THREE.BoxGeometry(3, 0.2, 3);
  const material = new THREE.MeshStandardMaterial({ color: 0x888888 });
  const platform = new THREE.Mesh(geometry, material);
  platform.position.set(x, y, z);
  platform.castShadow = true;
  platform.receiveShadow = true;
  scene.add(platform);
  
  // Add some decorative elements
  const pillarGeometry = new THREE.CylinderGeometry(0.1, 0.1, 2, 16);
  const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x666666 });
  
  const corners = [
    [-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]
  ];
  
  corners.forEach(([px, pz]) => {
    const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    pillar.position.set(x + px, y - 1, z + pz);
    pillar.castShadow = true;
    scene.add(pillar);
  });
}
