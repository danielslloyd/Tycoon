// Renderer - Three.js visualization
class Renderer {
  constructor(gameState, container) {
    this.gameState = gameState;
    this.settings = gameState.settings;
    this.container = container;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.nodeObjects = [];
    this.edgeObjects = [];
    this.haloObjects = [];
    this.selectedNode = null;
    this.hoveredNode = null;
    this.hoveredEdge = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.flowMapMode = 'crude';  // 'crude' or 'refined'

    this.init();
  }

  init() {
    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.settings.VISUAL.BACKGROUND_COLOR);

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

    // Remove all halo objects
    for (const obj of this.haloObjects) {
      this.scene.remove(obj);
    }
    this.haloObjects = [];
  }

  createEdges() {
    for (const edge of this.gameState.edges) {
      const nodeA = this.gameState.nodes[edge.node_a];
      const nodeB = this.gameState.nodes[edge.node_b];

      // Determine edge color based on transportation type
      let color = this.settings.VISUAL.DEFAULT_EDGE_COLOR;  // Default gray

      // Draw railroads as zig-zag lines
      if (edge.transportation.rail.available) {
        color = this.settings.VISUAL.DEFAULT_RAILROAD_COLOR;  // Black for default railroads
        this.createZigZagLine(nodeA, nodeB, edge.id, color);
      }
      // Draw pipelines as double lines
      else if (edge.transportation.pipeline.owner !== null) {
        const owner = this.gameState.players[edge.transportation.pipeline.owner];
        color = parseInt(owner.color.replace('#', '0x'));
        this.createDoubleLine(nodeA, nodeB, edge.id, color);
      }
      // Default simple line for truck routes
      else {
        this.createSimpleLine(nodeA, nodeB, edge.id, color);
      }
    }
  }

  // Create a simple straight line
  createSimpleLine(nodeA, nodeB, edgeId, color) {
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
    line.userData = { type: 'edge', edgeId: edgeId };

    this.scene.add(line);
    this.edgeObjects.push(line);
  }

  // Create a zig-zag line for railroads
  createZigZagLine(nodeA, nodeB, edgeId, color) {
    const segments = this.settings.VISUAL.RAILROAD_ZIGZAG_SEGMENTS;
    const amplitude = this.settings.VISUAL.RAILROAD_ZIGZAG_AMPLITUDE;

    const positions = [];

    // Calculate perpendicular vector for zig-zag
    const dx = nodeB.x - nodeA.x;
    const dy = nodeB.y - nodeA.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    // Perpendicular unit vector
    const perpX = -dy / length;
    const perpY = dx / length;

    // Generate zig-zag points
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = nodeA.x + dx * t;
      const y = nodeA.y + dy * t;

      // Alternate zig-zag offset
      const offset = (i % 2 === 0 ? 1 : -1) * amplitude;

      positions.push(x + perpX * offset, y + perpY * offset, 0);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));

    const material = new THREE.LineBasicMaterial({
      color: color,
      linewidth: 1,
      opacity: 0.8,
      transparent: true
    });

    const line = new THREE.Line(geometry, material);
    line.userData = { type: 'edge', edgeId: edgeId };

    this.scene.add(line);
    this.edgeObjects.push(line);
  }

  // Create a double line for pipelines
  createDoubleLine(nodeA, nodeB, edgeId, color) {
    const spacing = this.settings.VISUAL.PIPELINE_LINE_SPACING;

    // Calculate perpendicular offset
    const dx = nodeB.x - nodeA.x;
    const dy = nodeB.y - nodeA.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    const perpX = -dy / length * spacing / 2;
    const perpY = dx / length * spacing / 2;

    // Create first line
    const geometry1 = new THREE.BufferGeometry();
    const positions1 = new Float32Array([
      nodeA.x + perpX, nodeA.y + perpY, 0,
      nodeB.x + perpX, nodeB.y + perpY, 0
    ]);
    geometry1.setAttribute('position', new THREE.BufferAttribute(positions1, 3));

    const material1 = new THREE.LineBasicMaterial({
      color: color,
      linewidth: this.settings.VISUAL.PIPELINE_LINE_WIDTH,
      opacity: 0.9,
      transparent: true
    });

    const line1 = new THREE.Line(geometry1, material1);
    line1.userData = { type: 'edge', edgeId: edgeId };

    // Create second line
    const geometry2 = new THREE.BufferGeometry();
    const positions2 = new Float32Array([
      nodeA.x - perpX, nodeA.y - perpY, 0,
      nodeB.x - perpX, nodeB.y - perpY, 0
    ]);
    geometry2.setAttribute('position', new THREE.BufferAttribute(positions2, 3));

    const material2 = new THREE.LineBasicMaterial({
      color: color,
      linewidth: this.settings.VISUAL.PIPELINE_LINE_WIDTH,
      opacity: 0.9,
      transparent: true
    });

    const line2 = new THREE.Line(geometry2, material2);
    line2.userData = { type: 'edge', edgeId: edgeId };

    this.scene.add(line1);
    this.scene.add(line2);
    this.edgeObjects.push(line1);
    this.edgeObjects.push(line2);
  }

  createNodes() {
    for (const node of this.gameState.nodes) {
      // Determine node size based on type and city type
      let size = this.settings.VISUAL.NODE_SIZE_BASE;

      if (node.city_type === 'major') {
        size = this.settings.VISUAL.NODE_SIZE_MAJOR_CITY;
      } else if (node.city_type === 'midsize') {
        size = this.settings.VISUAL.NODE_SIZE_MIDSIZE_CITY;
      } else if (node.type === 'production') {
        size = 3 + (node.production_capacity / this.settings.WELL_CAPACITY_MAX) * 10;
      } else if (node.demand_base) {
        size = 3 + (node.demand_base / 10000) * 8;
      } else if (node.type === 'terminal') {
        size = this.settings.VISUAL.NODE_SIZE_TERMINAL;
      }

      // Determine node color
      let color = this.settings.VISUAL.DEFAULT_NODE_COLOR;

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
      sphere.userData = { type: 'node', nodeId: node.id, size: size };

      this.scene.add(sphere);
      this.nodeObjects.push(sphere);

      // Add fuchsia halo for edge nodes
      if (node.isEdgeNode) {
        const haloSize = size * this.settings.VISUAL.EDGE_NODE_HALO_SIZE_MULTIPLIER;
        const haloGeometry = new THREE.RingGeometry(
          haloSize - this.settings.VISUAL.EDGE_NODE_HALO_THICKNESS,
          haloSize,
          32
        );
        const haloMaterial = new THREE.MeshBasicMaterial({
          color: this.settings.VISUAL.EDGE_NODE_HALO_COLOR,
          side: THREE.DoubleSide,
          opacity: 0.6,
          transparent: true
        });
        const halo = new THREE.Mesh(haloGeometry, haloMaterial);
        halo.position.set(node.x, node.y, 0);
        halo.userData = { type: 'edge_node_halo', nodeId: node.id };
        this.scene.add(halo);
        this.haloObjects.push(halo);
      }

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

    // Determine color based on flow map mode
    const flowColor = this.flowMapMode === 'crude' ?
      this.settings.VISUAL.FLOW_MAP_CRUDE_COLOR :
      this.settings.VISUAL.FLOW_MAP_REFINED_COLOR;

    for (const edge of this.gameState.edges) {
      const nodeA = this.gameState.nodes[edge.node_a];
      const nodeB = this.gameState.nodes[edge.node_b];

      // Calculate line thickness based on flow volume
      const flowRatio = edge.flow_volume / maxFlow;
      const thickness = this.settings.VISUAL.FLOW_MAP_MIN_THICKNESS +
                       flowRatio * (this.settings.VISUAL.FLOW_MAP_MAX_THICKNESS - this.settings.VISUAL.FLOW_MAP_MIN_THICKNESS);

      // Use single color with varying thickness and opacity
      let color, opacity;
      if (edge.flow_volume === 0) {
        color = this.settings.VISUAL.DEFAULT_EDGE_COLOR;
        opacity = 0.2;
      } else {
        color = flowColor;
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

    // Get mouse position in world coordinates
    const mouseWorld = this.getWorldPosition(event);

    // Find closest node and closest edge
    let closestNode = null;
    let closestNodeDist = Infinity;

    for (const node of this.gameState.nodes) {
      const dist = Math.sqrt(
        Math.pow(node.x - mouseWorld.x, 2) + Math.pow(node.y - mouseWorld.y, 2)
      );
      if (dist < closestNodeDist) {
        closestNodeDist = dist;
        closestNode = node;
      }
    }

    // Find closest edge
    let closestEdge = null;
    let closestEdgeDist = Infinity;

    for (const edge of this.gameState.edges) {
      const nodeA = this.gameState.nodes[edge.node_a];
      const nodeB = this.gameState.nodes[edge.node_b];

      // Calculate midpoint of edge
      const midX = (nodeA.x + nodeB.x) / 2;
      const midY = (nodeA.y + nodeB.y) / 2;

      const dist = Math.sqrt(
        Math.pow(midX - mouseWorld.x, 2) + Math.pow(midY - mouseWorld.y, 2)
      );

      if (dist < closestEdgeDist) {
        closestEdgeDist = dist;
        closestEdge = edge;
      }
    }

    // Determine what to highlight based on configurable threshold
    const threshold = this.settings.VISUAL.EDGE_HOVER_DISTANCE_MULTIPLIER;

    // Clear previous hover halos
    this.clearHoverHalos();

    if (closestEdgeDist * threshold < closestNodeDist) {
      // Edge is closer - highlight edge
      this.hoveredEdge = closestEdge.id;
      this.hoveredNode = null;
      this.highlightEdge(closestEdge.id);
      this.showEdgePopup(closestEdge.id);
      this.renderer.domElement.style.cursor = 'pointer';
    } else if (closestNode) {
      // Node is closer - highlight node
      this.hoveredNode = closestNode.id;
      this.hoveredEdge = null;
      this.createHoverHalo(closestNode);
      this.showNodePopup(closestNode.id);
      this.renderer.domElement.style.cursor = 'pointer';
    } else {
      this.hoveredNode = null;
      this.hoveredEdge = null;
      this.hidePopup();
      this.renderer.domElement.style.cursor = 'default';
    }
  }

  // Get world position from mouse event
  getWorldPosition(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const vector = new THREE.Vector3(x, y, 0.5);
    vector.unproject(this.camera);

    return { x: vector.x, y: vector.y };
  }

  // Create hover halo for node
  createHoverHalo(node) {
    // Find node object to get size
    const nodeObj = this.nodeObjects.find(obj => obj.userData.nodeId === node.id);
    if (!nodeObj) return;

    const size = nodeObj.userData.size || this.settings.VISUAL.NODE_SIZE_BASE;
    const haloSize = size * this.settings.VISUAL.HOVER_HALO_SIZE_MULTIPLIER;

    const haloGeometry = new THREE.RingGeometry(
      haloSize - this.settings.VISUAL.HOVER_HALO_THICKNESS,
      haloSize,
      32
    );
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: this.settings.VISUAL.HOVER_HALO_COLOR,
      side: THREE.DoubleSide,
      opacity: 0.8,
      transparent: true
    });
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    halo.position.set(node.x, node.y, 0.1);  // Slightly above node
    halo.userData = { type: 'hover_halo' };
    this.scene.add(halo);
    this.haloObjects.push(halo);
  }

  // Clear hover halos
  clearHoverHalos() {
    const hoverHalos = this.haloObjects.filter(obj => obj.userData.type === 'hover_halo' || obj.userData.type === 'edge_highlight');
    for (const halo of hoverHalos) {
      this.scene.remove(halo);
    }
    this.haloObjects = this.haloObjects.filter(obj => obj.userData.type !== 'hover_halo' && obj.userData.type !== 'edge_highlight');
  }

  // Highlight edge
  highlightEdge(edgeId) {
    const edge = this.gameState.edges[edgeId];
    const nodeA = this.gameState.nodes[edge.node_a];
    const nodeB = this.gameState.nodes[edge.node_b];

    // Create a thicker, highlighted version of the edge
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array([
      nodeA.x, nodeA.y, 0.1,
      nodeB.x, nodeB.y, 0.1
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color: 0xFFFFFF,
      linewidth: 3,
      opacity: 0.8,
      transparent: true
    });

    const line = new THREE.Line(geometry, material);
    line.userData = { type: 'edge_highlight' };
    this.scene.add(line);
    this.haloObjects.push(line);
  }

  // Click handler
  onClick(event) {
    // On click, just select the hovered item (node or edge)
    if (this.hoveredNode !== null) {
      this.selectedNode = this.hoveredNode;

      // Trigger event for UI update
      if (window.game) {
        window.game.onNodeSelected(this.selectedNode);
      }
    } else if (this.hoveredEdge !== null) {
      // Edge clicked - could add edge actions here
      console.log('Edge clicked:', this.hoveredEdge);
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

    // Edge node
    if (node.isEdgeNode) {
      info += `<div class="stat-row"><span class="stat-label">Type:</span><span class="stat-value" style="color: #ff00ff">Edge Node</span></div>`;
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

  // Show edge information popup
  showEdgePopup(edgeId) {
    const edge = this.gameState.edges[edgeId];
    const popup = document.getElementById('node-info');
    const title = document.getElementById('node-title');
    const details = document.getElementById('node-details');

    let info = '';

    // Edge length
    info += `<div class="stat-row"><span class="stat-label">Length:</span><span class="stat-value">${edge.length.toFixed(1)} units</span></div>`;

    // Railroad status
    if (edge.transportation.rail.available) {
      info += `<div class="stat-row"><span class="stat-label">Railroad:</span><span class="stat-value" style="color: #4caf50">Available</span></div>`;
    } else {
      info += `<div class="stat-row"><span class="stat-label">Railroad:</span><span class="stat-value" style="color: #888">Not Available</span></div>`;
    }

    // Pipeline status
    if (edge.transportation.pipeline.owner !== null) {
      const owner = this.gameState.players[edge.transportation.pipeline.owner];
      info += `<div class="stat-row"><span class="stat-label">Pipeline:</span><span class="stat-value" style="color: ${owner.color}">${owner.name}</span></div>`;
      info += `<div class="stat-row"><span class="stat-label">Capacity:</span><span class="stat-value">${formatNumber(edge.transportation.pipeline.capacity)} bbl</span></div>`;
      info += `<div class="stat-row"><span class="stat-label">Fee:</span><span class="stat-value">$${edge.transportation.pipeline.fee.toFixed(2)}/bbl</span></div>`;
    } else {
      info += `<div class="stat-row"><span class="stat-label">Pipeline:</span><span class="stat-value" style="color: #888">None</span></div>`;
    }

    // Flow volume
    if (edge.flow_volume > 0) {
      info += `<div class="stat-row"><span class="stat-label">Flow:</span><span class="stat-value">${formatNumber(edge.flow_volume)} bbl</span></div>`;
    }

    title.textContent = `Edge ${edge.node_a} → ${edge.node_b}`;
    details.innerHTML = info;
    popup.style.display = 'block';
  }

  // Hide popup
  hidePopup() {
    const popup = document.getElementById('node-info');
    if (popup) {
      popup.style.display = 'none';
    }
  }

  // Toggle flow map mode between crude and refined
  toggleFlowMapMode() {
    this.flowMapMode = this.flowMapMode === 'crude' ? 'refined' : 'crude';
    if (this.gameState.showFlowMap) {
      this.update();
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
