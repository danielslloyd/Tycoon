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
      // Determine node size based on type and city type
      let size = 5;

      if (node.city_type === 'major') {
        size = 15;  // Large for major cities
      } else if (node.city_type === 'midsize') {
        size = 10;  // Medium for midsize cities
      } else if (node.type === 'production') {
        size = 3 + (node.production_capacity / this.gameState.settings.WELL_CAPACITY_MAX) * 10;
      } else if (node.demand_base) {
        size = 3 + (node.demand_base / 10000) * 8;
      } else if (node.type === 'terminal') {
        size = 12;
      }

      // Determine node color
      let color = 0x666666;  // Default gray

      if (node.city_type === 'major') {
        color = 0xffd700;  // Gold for major cities
      } else if (node.city_type === 'midsize') {
        color = 0xffa500;  // Orange for midsize cities
      } else if (node.type === 'production') {
        if (node.has_well) {
          const owner = this.gameState.players[node.well_owner];
          color = parseInt(owner.color.replace('#', '0x'));
        } else {
          color = 0x555555;  // Dark gray for available production
        }
      } else if (node.demand_base) {
        color = 0x888888;  // Light gray for demand nodes
      } else if (node.type === 'terminal') {
        color = 0x00ffff;  // Cyan for terminals
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
    // Clear and recreate edges if flow map is enabled (for thickness variation)
    if (this.gameState.showFlowMap) {
      // Remove old edge objects
      for (const obj of this.edgeObjects) {
        this.scene.remove(obj);
      }
      this.edgeObjects = [];

      // Recreate edges with flow-based thickness
      this.createFlowMapEdges();
    } else {
      // Update edge colors based on ownership/type
      for (let i = 0; i < this.gameState.edges.length && i < this.edgeObjects.length; i++) {
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
    }

    // Update node colors
    for (let i = 0; i < this.gameState.nodes.length; i++) {
      const node = this.gameState.nodes[i];
      const nodeObj = this.nodeObjects[i];

      if (!nodeObj || nodeObj.userData.type !== 'node') continue;

      let color = 0x666666;

      if (node.city_type === 'major') {
        color = 0xffd700;  // Gold for major cities
      } else if (node.city_type === 'midsize') {
        color = 0xffa500;  // Orange for midsize cities
      } else if (node.type === 'production' && node.has_well) {
        const owner = this.gameState.players[node.well_owner];
        color = parseInt(owner.color.replace('#', '0x'));
      } else if (node.type === 'terminal') {
        color = 0x00ffff;  // Cyan for terminals
      } else if (node.demand_base) {
        color = 0x888888;  // Gray for demand nodes
      } else if (node.type === 'production') {
        color = 0x555555;  // Dark gray for available production
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

  // Create flow map edges with variable thickness
  createFlowMapEdges() {
    // Find max flow volume for normalization
    let maxFlow = 1;
    for (const edge of this.gameState.edges) {
      if (edge.flow_volume > maxFlow) {
        maxFlow = edge.flow_volume;
      }
    }

    for (const edge of this.gameState.edges) {
      const nodeA = this.gameState.nodes[edge.node_a];
      const nodeB = this.gameState.nodes[edge.node_b];

      // Calculate line thickness based on flow volume
      const flowRatio = edge.flow_volume / maxFlow;
      const thickness = 1 + flowRatio * 8;  // 1-9 pixel thickness

      // Determine color based on flow volume
      let color, opacity;
      if (edge.flow_volume === 0) {
        color = 0x222222;
        opacity = 0.2;
      } else {
        // Color gradient from blue (low) to red (high)
        const hue = (1 - flowRatio) * 0.6;  // 0.6 = blue, 0 = red
        const rgb = this.hslToRgb(hue, 1, 0.5);
        color = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
        opacity = 0.5 + flowRatio * 0.5;
      }

      // Create thick line using cylinder
      if (thickness > 2) {
        const direction = new THREE.Vector3(
          nodeB.x - nodeA.x,
          nodeB.y - nodeA.y,
          0
        );
        const length = direction.length();
        const geometry = new THREE.CylinderGeometry(thickness / 2, thickness / 2, length, 8);
        const material = new THREE.MeshBasicMaterial({
          color: color,
          opacity: opacity,
          transparent: true
        });

        const cylinder = new THREE.Mesh(geometry, material);

        // Position and orient the cylinder
        cylinder.position.set(
          (nodeA.x + nodeB.x) / 2,
          (nodeA.y + nodeB.y) / 2,
          0
        );

        const axis = new THREE.Vector3(0, 1, 0);
        cylinder.quaternion.setFromUnitVectors(axis, direction.normalize());

        cylinder.userData = { type: 'edge', edgeId: edge.id };
        this.scene.add(cylinder);
        this.edgeObjects.push(cylinder);
      } else {
        // Use simple line for thin edges
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array([
          nodeA.x, nodeA.y, 0,
          nodeB.x, nodeB.y, 0
        ]);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.LineBasicMaterial({
          color: color,
          linewidth: 1,
          opacity: opacity,
          transparent: true
        });

        const line = new THREE.Line(geometry, material);
        line.userData = { type: 'edge', edgeId: edge.id };
        this.scene.add(line);
        this.edgeObjects.push(line);
      }
    }
  }

  // Convert HSL to RGB
  hslToRgb(h, s, l) {
    let r, g, b;

    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }

    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
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

      // Show node info popup
      this.showNodePopup(this.selectedNode);

      // Trigger event for UI update
      if (window.game) {
        window.game.onNodeSelected(this.selectedNode);
      }
    }
  }

  // Show node information popup
  showNodePopup(nodeId) {
    const node = this.gameState.nodes[nodeId];
    const popup = document.getElementById('node-info');
    const title = document.getElementById('node-title');
    const details = document.getElementById('node-details');

    let info = '';

    // City type
    if (node.city_type === 'major') {
      info += `<div class="stat-row"><span class="stat-label">City:</span><span class="stat-value" style="color: #ffd700">Major City</span></div>`;
    } else if (node.city_type === 'midsize') {
      info += `<div class="stat-row"><span class="stat-label">City:</span><span class="stat-value" style="color: #ffa500">Midsize City</span></div>`;
    }

    // Production
    if (node.production_capacity) {
      info += `<div class="stat-row"><span class="stat-label">Production:</span><span class="stat-value">${formatNumber(node.production_capacity)} bbl/turn</span></div>`;
      if (node.has_well) {
        const owner = this.gameState.players[node.well_owner];
        info += `<div class="stat-row"><span class="stat-label">Owner:</span><span class="stat-value" style="color: ${owner.color}">${owner.name}</span></div>`;
      }
    }

    // Demand
    if (node.demand_base) {
      info += `<div class="stat-row"><span class="stat-label">Demand:</span><span class="stat-value">${formatNumber(Math.floor(node.current_demand))} bbl/turn</span></div>`;
      info += `<div class="stat-row"><span class="stat-label">Growth:</span><span class="stat-value">${(node.demand_growth_rate * 100).toFixed(1)}%</span></div>`;
    }

    // Terminal
    if (node.is_import_terminal) {
      info += `<div class="stat-row"><span class="stat-label">Type:</span><span class="stat-value">Import Terminal</span></div>`;
    }

    title.textContent = `Node #${nodeId}`;
    details.innerHTML = info;
    popup.style.display = 'block';
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
