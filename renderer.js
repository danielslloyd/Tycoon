// Renderer - Three.js visualization
class Renderer {
  constructor(gameState, container) {
    this.gameState = gameState;
    this.container = container;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.nodeObjects = [];
    this.edgeObjects = [];
    this.selectedNode = null;
    this.hoveredNode = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.init();
  }

  init() {
    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    // Create camera
    const aspect = this.container.clientWidth / this.container.clientHeight;
    const viewSize = 2500;
    this.camera = new THREE.OrthographicCamera(
      -viewSize * aspect / 2,
      viewSize * aspect / 2,
      viewSize / 2,
      -viewSize / 2,
      1,
      5000
    );
    this.camera.position.set(1000, 1000, 2000);
    this.camera.lookAt(1000, 1000, 0);

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.container.appendChild(this.renderer.domElement);

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight.position.set(1, 1, 1);
    this.scene.add(directionalLight);

    // Handle window resize
    window.addEventListener('resize', () => this.onWindowResize());

    // Handle mouse events
    this.renderer.domElement.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.renderer.domElement.addEventListener('click', (e) => this.onClick(e));

    // Start render loop
    this.animate();
  }

  // Create visual representation of the map
  createMap() {
    // Clear existing objects
    this.clearMap();

    // Create edges
    this.createEdges();

    // Create nodes
    this.createNodes();

    console.log('Map visualization created');
  }

  clearMap() {
    // Remove all node objects
    for (const obj of this.nodeObjects) {
      this.scene.remove(obj);
    }
    this.nodeObjects = [];

    // Remove all edge objects
    for (const obj of this.edgeObjects) {
      this.scene.remove(obj);
    }
    this.edgeObjects = [];
  }

  createEdges() {
    for (const edge of this.gameState.edges) {
      const nodeA = this.gameState.nodes[edge.node_a];
      const nodeB = this.gameState.nodes[edge.node_b];

      // Determine edge color based on transportation type
      let color = 0x444444;  // Default gray for truck-only

      if (edge.transportation.rail.available) {
        color = 0x8b4513;  // Brown for rail
      }

      if (edge.transportation.pipeline.owner !== null) {
        const owner = this.gameState.players[edge.transportation.pipeline.owner];
        color = parseInt(owner.color.replace('#', '0x'));
      }

      // Create line geometry
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array([
        nodeA.x, nodeA.y, 0,
        nodeB.x, nodeB.y, 0
      ]);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const material = new THREE.LineBasicMaterial({
        color: color,
        linewidth: 1,
        opacity: 0.6,
        transparent: true
      });

      const line = new THREE.Line(geometry, material);
      line.userData = { type: 'edge', edgeId: edge.id };

      this.scene.add(line);
      this.edgeObjects.push(line);
    }
  }

  createNodes() {
    for (const node of this.gameState.nodes) {
      // Determine node size based on type
      let size = 5;

      if (node.type === 'production') {
        size = 3 + (node.production_capacity / this.gameState.settings.WELL_CAPACITY_MAX) * 10;
      } else if (node.type === 'demand') {
        size = 3 + (node.demand_base / 10000) * 8;
      } else if (node.type === 'terminal') {
        size = 12;
      }

      // Determine node color
      let color = 0x666666;  // Default gray

      if (node.type === 'production') {
        if (node.has_well) {
          const owner = this.gameState.players[node.well_owner];
          color = parseInt(owner.color.replace('#', '0x'));
        } else {
          color = 0x555555;  // Dark gray for available production
        }
      } else if (node.type === 'demand') {
        color = 0x888888;  // Light gray for demand
      } else if (node.type === 'terminal') {
        color = 0xffa500;  // Orange for terminals
      }

      // Create sphere geometry
      const geometry = new THREE.SphereGeometry(size, 16, 16);
      const material = new THREE.MeshPhongMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.2
      });

      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.set(node.x, node.y, 0);
      sphere.userData = { type: 'node', nodeId: node.id };

      this.scene.add(sphere);
      this.nodeObjects.push(sphere);

      // Add marker for buildings
      if (node.buildings.refinery) {
        const markerGeometry = new THREE.RingGeometry(size + 2, size + 4, 32);
        const owner = this.gameState.players[node.buildings.refinery.owner];
        const markerMaterial = new THREE.MeshBasicMaterial({
          color: parseInt(owner.color.replace('#', '0x')),
          side: THREE.DoubleSide
        });
        const marker = new THREE.Mesh(markerGeometry, markerMaterial);
        marker.position.set(node.x, node.y, 0);
        this.scene.add(marker);
        this.nodeObjects.push(marker);
      }
    }
  }

  // Update visualization
  update() {
    // Update edge colors and thickness based on utilization
    for (let i = 0; i < this.gameState.edges.length; i++) {
      const edge = this.gameState.edges[i];
      const edgeObj = this.edgeObjects[i];

      if (!edgeObj) continue;

      // Update color based on pipeline ownership
      let color = 0x444444;

      if (edge.transportation.rail.available) {
        color = 0x8b4513;
      }

      if (edge.transportation.pipeline.owner !== null) {
        const owner = this.gameState.players[edge.transportation.pipeline.owner];
        color = parseInt(owner.color.replace('#', '0x'));

        // Update opacity based on utilization
        const utilization = edge.transportation.pipeline.utilization / edge.transportation.pipeline.capacity;
        edgeObj.material.opacity = 0.3 + utilization * 0.7;
      }

      edgeObj.material.color.setHex(color);
    }

    // Update node colors
    for (let i = 0; i < this.gameState.nodes.length; i++) {
      const node = this.gameState.nodes[i];
      const nodeObj = this.nodeObjects[i];

      if (!nodeObj || nodeObj.userData.type !== 'node') continue;

      let color = 0x666666;

      if (node.type === 'production' && node.has_well) {
        const owner = this.gameState.players[node.well_owner];
        color = parseInt(owner.color.replace('#', '0x'));
      } else if (node.type === 'terminal') {
        color = 0xffa500;
      } else if (node.type === 'demand') {
        color = 0x888888;
      }

      // Highlight selected node
      if (this.selectedNode === node.id) {
        nodeObj.material.emissiveIntensity = 0.8;
      } else if (this.hoveredNode === node.id) {
        nodeObj.material.emissiveIntensity = 0.5;
      } else {
        nodeObj.material.emissiveIntensity = 0.2;
      }

      nodeObj.material.color.setHex(color);
      nodeObj.material.emissive.setHex(color);
    }
  }

  // Mouse move handler
  onMouseMove(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Raycast for hover
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.nodeObjects);

    if (intersects.length > 0) {
      const obj = intersects[0].object;
      if (obj.userData.type === 'node') {
        this.hoveredNode = obj.userData.nodeId;
        this.renderer.domElement.style.cursor = 'pointer';
        return;
      }
    }

    this.hoveredNode = null;
    this.renderer.domElement.style.cursor = 'default';
  }

  // Click handler
  onClick(event) {
    if (this.hoveredNode !== null) {
      this.selectedNode = this.hoveredNode;

      // Trigger event for UI update
      if (window.game) {
        window.game.onNodeSelected(this.selectedNode);
      }
    }
  }

  // Window resize handler
  onWindowResize() {
    const aspect = this.container.clientWidth / this.container.clientHeight;
    const viewSize = 2500;

    this.camera.left = -viewSize * aspect / 2;
    this.camera.right = viewSize * aspect / 2;
    this.camera.top = viewSize / 2;
    this.camera.bottom = -viewSize / 2;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  // Animation loop
  animate() {
    requestAnimationFrame(() => this.animate());
    this.renderer.render(this.scene, this.camera);
  }
}
