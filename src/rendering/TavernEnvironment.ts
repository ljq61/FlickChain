import * as THREE from 'three';
import type { LevelConfig } from '../types/contracts';

const FLOOR_Y = -0.76;

/** Decorative room only: no colliders, picking or state independent of the game. */
export class TavernEnvironment extends THREE.Group {
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();
  private readonly roomClip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1.1);
  private readonly lampDirection = new THREE.Vector3();
  private readonly lampForward = new THREE.Vector3();
  private readonly tableDress = new THREE.Group();
  private readonly pendant = new THREE.Group();
  private readonly tableGeometries = new Set<THREE.BufferGeometry>();
  private readonly wood = this.material(0x493025);
  private readonly darkWood = this.material(0x30231b);
  private readonly brass = this.material(0xd69b42, 0.65, 0.42);
  private readonly steel = this.material(0x8bafaf, 0.6, 0.38);
  private readonly key = new THREE.SpotLight(0xffbf66, 10, 7, 0.5, 0.7, 2);
  private tableKey = '';
  private disposed = false;

  constructor() {
    super();
    this.name = 'tavern-environment';
    const box = this.geometry(new THREE.BoxGeometry(1, 1, 1));
    const cylinder = this.geometry(new THREE.CylinderGeometry(1, 1, 1, 16));
    const shoulder = this.geometry(new THREE.CylinderGeometry(0.4, 1, 1, 12));
    const batches = new Map<THREE.BufferGeometry, Map<THREE.Material, THREE.Matrix4[]>>();
    const place = (geometry: THREE.BufferGeometry, material: THREE.Material, position: number[], scale: number[], yaw = 0) => {
      let byMaterial = batches.get(geometry);
      if (!byMaterial) { byMaterial = new Map(); batches.set(geometry, byMaterial); }
      let matrices = byMaterial.get(material);
      if (!matrices) { matrices = []; byMaterial.set(material, matrices); }
      matrices.push(new THREE.Matrix4().compose(
        new THREE.Vector3(...position), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(...scale),
      ));
    };
    const wall = this.material(0x203136);
    const floorMaterial = this.material(0x202824);
    const seam = this.material(0x29312d);
    place(box, floorMaterial, [0, FLOOR_Y - 0.04, 0], [15, 0.08, 15]);
    // A few long floor boards carry the room perspective without a noisy texture.
    for (let x = -7; x <= 7; x += 0.7) place(box, seam, [x, FLOOR_Y + 0.0005, 0], [0.008, 0.001, 15]);
    for (const side of [-1, 1]) {
      place(box, wall, [0, 1.6, side * 6.8], [13.6, 4.72, 0.15]);
      place(box, wall, [side * 6.8, 1.6, 0], [0.15, 4.72, 13.6]);
    }

    const bottleMaterials = [this.material(0x296469, 0.08, 0.35), this.material(0x856533, 0.06, 0.42), this.material(0x3c5650, 0.08, 0.38)];
    const label = this.material(0x947143, 0, 0.9);
    const stopper = this.material(0x5b3820);
    const structuralWood = this.material(0x684d34);
    const rail = this.material(0x715132, 0.45, 0.65);
    const arch = this.geometry(new THREE.TorusGeometry(1.84, 0.075, 6, 40, Math.PI));
    // Four shallow stations keep a recognizable room visible as the camera rotates.
    for (let station = 0; station < 4; station++) {
      const yaw = station * Math.PI / 2;
      const position = (x: number, y: number, z: number) => [x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw)];
      const timber = (x: number, y: number, z: number, w: number, h: number, d: number, material = this.wood) => place(box, material, position(x, y, z), [w, h, d], yaw);
      // Espresso paneling, walnut shelves and a broad bar rail.
      timber(0, 0.62, -3.58, 3.85, 2.76, 0.1, this.darkWood);
      place(arch, structuralWood, position(0, 0.78, -3.05), [1, 1, 1], yaw);
      for (const x of [-1.84, 1.84]) {
        timber(x, 0.01, -3.05, 0.15, 1.54, 0.15, structuralWood);
        timber(x, 0.72, -3.05, 0.22, 0.075, 0.22, rail);
        timber(x, -0.68, -3.05, 0.22, 0.16, 0.22, structuralWood);
      }
      for (const x of [-1.96, 0, 1.96]) timber(x, 0.6, -3.48, 0.09, 2.8, 0.16);
      for (const y of [0.38, 1.04, 1.7]) {
        timber(0, y, -3.24, 3.9, 0.065, 0.55);
        timber(0, y + 0.027, -2.97, 3.9, 0.012, 0.016, rail);
      }
      timber(0, -0.35, -2.83, 3.86, 0.8, 0.36, this.darkWood);
      timber(0, 0.08, -2.78, 4.02, 0.09, 0.64);
      timber(0, -0.56, -2.56, 3.6, 0.025, 0.03, rail);
      for (const x of [-1.25, 0, 1.25]) timber(x, -0.36, -2.638, 0.045, 0.7, 0.024);
      // Bottles share only three primitive geometries; rows are deliberately sparse.
      for (let row = 0; row < 3; row++) {
        for (let index = 0; index < 7; index++) {
          const x = -1.53 + index * 0.5 + (row % 2 ? 0.05 : 0);
          const y = 0.414 + row * 0.66;
          const radius = 0.053 + (index % 3) * 0.009;
          const height = 0.2 + ((index + row) % 3) * 0.035;
          const material = bottleMaterials[(index + row + station) % bottleMaterials.length];
          place(cylinder, material, position(x, y + height / 2, -3.18), [radius, height, radius]);
          place(shoulder, material, position(x, y + height + 0.032, -3.18), [radius, 0.064, radius]);
          place(cylinder, material, position(x, y + height + 0.105, -3.18), [radius * 0.38, 0.09, radius * 0.38]);
          place(cylinder, stopper, position(x, y + height + 0.153, -3.18), [radius * 0.4, 0.02, radius * 0.4]);
          place(cylinder, label, position(x, y + height * 0.42, -3.18), [radius * 1.004, height * 0.27, radius * 1.004]);
        }
      }
    }

    // Seats remain below the play plane, safely outside the board and hand.
    const seat = this.material(0x784320, 0, 0.72);
    for (const [x, z, yaw] of [[-1.4, -1.28, 0.2], [1.4, -1.28, -0.2], [-1.6, 1.6, 0.4], [1.7, 1.55, -0.4]]) {
      place(cylinder, seat, [x, -0.255, z], [0.24, 0.075, 0.24]);
      place(cylinder, this.darkWood, [x, -0.305, z], [0.185, 0.035, 0.185]);
      for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
        const dx = sideX * 0.13, dz = sideZ * 0.13;
        place(box, structuralWood, [x + dx * Math.cos(yaw) + dz * Math.sin(yaw), -0.53, z - dx * Math.sin(yaw) + dz * Math.cos(yaw)], [0.045, 0.46, 0.045], yaw);
      }
      place(box, this.darkWood, [x, -0.61, z], [0.3, 0.026, 0.028], yaw);
      place(box, this.darkWood, [x, -0.61, z], [0.028, 0.026, 0.3], yaw);
    }
    for (const [geometry, byMaterial] of batches) for (const [material, matrices] of byMaterial) {
      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
      matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = material === floorMaterial;
      mesh.raycast = () => {};
      this.add(mesh);
    }

    const pendant = this.pendant;
    pendant.name = 'menu-lamp';
    pendant.position.set(0, 1.58, -0.13);
    // The menu fixture sits in the UI-safe top band, outside the room cutaway.
    const lampBrass = this.brass.clone();
    lampBrass.clippingPlanes = null;
    const lampCord = this.darkWood.clone();
    lampCord.clippingPlanes = null;
    this.materials.add(lampBrass); this.materials.add(lampCord);
    const profile = [[0.026, 0.225], [0.085, 0.21], [0.18, 0.155], [0.275, 0.05], [0.3, 0]];
    // Bottom-to-top winding faces outward. A back-facing inner shell leaves the mouth open.
    const shadeGeometry = this.geometry(new THREE.LatheGeometry(profile.slice().reverse().map(([radius, y]) => new THREE.Vector2(radius, y)), 40));
    const shade = new THREE.Mesh(shadeGeometry, lampBrass);
    shade.name = 'lamp-shade';
    const interior = this.material(0xffce81, 0.08, 0.75);
    interior.clippingPlanes = null;
    interior.side = THREE.BackSide;
    interior.emissive.set(0xffa64d);
    interior.emissiveIntensity = 0.35;
    const lining = new THREE.Mesh(shadeGeometry, interior);
    lining.name = 'lamp-interior';
    lining.scale.set(0.985, 0.985, 0.985);
    const lip = new THREE.Mesh(this.geometry(new THREE.TorusGeometry(0.3, 0.006, 6, 40)), lampBrass);
    lip.name = 'lamp-lip';
    lip.rotation.x = Math.PI / 2;
    const bulbMaterial = new THREE.MeshBasicMaterial({ color: 0xffefc1, toneMapped: false });
    this.materials.add(bulbMaterial);
    const bulb = new THREE.Mesh(this.geometry(new THREE.SphereGeometry(0.055, 24, 16)), bulbMaterial);
    bulb.name = 'lamp-bulb';
    // The menu camera sees the fixture from above: the globe must clear the near lip.
    bulb.position.y = -0.195;
    bulb.scale.y = 1.16;
    const holder = new THREE.Mesh(cylinder, lampCord);
    holder.name = 'lamp-bulb-holder';
    holder.position.y = -0.05;
    holder.scale.set(0.018, 0.2, 0.018);
    // One small local sprite softens the globe edge, without a bloom pass or another light.
    const glowPixels = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const radius = Math.hypot((x + 0.5 - 16) / 16, (y + 0.5 - 16) / 16);
      const offset = (y * 32 + x) * 4;
      glowPixels[offset] = glowPixels[offset + 1] = glowPixels[offset + 2] = 255;
      glowPixels[offset + 3] = Math.round(255 * Math.pow(Math.max(0, 1 - radius * radius), 2));
    }
    const glowTexture = new THREE.DataTexture(glowPixels, 32, 32);
    glowTexture.magFilter = glowTexture.minFilter = THREE.LinearFilter;
    glowTexture.needsUpdate = true;
    this.textures.add(glowTexture);
    const glowMaterial = new THREE.SpriteMaterial({ map: glowTexture, color: 0xffba63, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.materials.add(glowMaterial);
    const glow = new THREE.Sprite(glowMaterial);
    glow.name = 'lamp-bulb-glow';
    glow.position.copy(bulb.position);
    glow.scale.set(0.15, 0.15, 1);
    const cord = new THREE.Mesh(cylinder, lampCord);
    cord.position.y = 1.1;
    cord.scale.set(0.007, 1.75, 0.007);
    const socket = new THREE.Mesh(cylinder, lampBrass);
    socket.position.y = 0.258;
    socket.scale.set(0.032, 0.07, 0.032);
    const ribs: number[] = [];
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) for (let index = 1; index < profile.length; index++) {
      for (const [radius, y] of [profile[index - 1], profile[index]]) ribs.push((radius + 0.001) * Math.cos(angle), y + 0.001, (radius + 0.001) * Math.sin(angle));
    }
    const ribGeometry = this.geometry(new THREE.BufferGeometry());
    ribGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ribs, 3));
    const ribMaterial = new THREE.LineBasicMaterial({ color: 0x70471f });
    this.materials.add(ribMaterial);
    pendant.add(shade, lining, lip, bulb, holder, glow, cord, socket, new THREE.LineSegments(ribGeometry, ribMaterial));
    pendant.traverse((object) => { object.raycast = () => {}; });
    this.add(pendant, this.tableDress);

    // One small shadow map covers the board, coins and hand; scenery never casts.
    this.key.position.set(0, 1.55, -0.13);
    this.key.target.position.set(0, 0, 0.04);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.camera.near = 0.1;
    this.key.shadow.camera.far = 4;
    this.key.shadow.bias = -0.00012;
    this.key.shadow.normalBias = 0.0015;
    this.add(this.key, this.key.target);
  }

  private material(color: number, metalness = 0, roughness = 0.9): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ color, metalness, roughness, clippingPlanes: [this.roomClip] });
    this.materials.add(material);
    return material;
  }

  private geometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }

  /** The lamp is a menu focal point; overhead props never cover playable coins. */
  setMenuView(menu: boolean): void { this.pendant.visible = menu; }

  /** Cut the near room half away, like a dollhouse, for every orbit angle. */
  updateCamera(camera: THREE.Camera): void {
    camera.getWorldDirection(this.roomClip.normal);
    this.roomClip.normal.y = 0;
    this.roomClip.normal.normalize();
  }

  /** A small 3D menu fixture stays above the title, regardless of viewport. */
  presentMenuLamp(camera: THREE.PerspectiveCamera, width: number, height: number, centerX: number): void {
    const compactPortrait = width < height && height < 700;
    const shortLandscape = width > height && height < 600;
    const centerY = shortLandscape ? 0.06 : compactPortrait ? 0.08 : 0.085;
    this.lampDirection.set(centerX * 2 - 1, 1 - centerY * 2, 0.5).unproject(camera).sub(camera.position).normalize();
    const distance = Math.max(1, camera.position.length() * 0.65);
    this.pendant.position.copy(camera.position).addScaledVector(this.lampDirection, distance);
    camera.getWorldDirection(this.lampForward);
    const depth = distance * this.lampDirection.dot(this.lampForward);
    const pixelScale = 2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / height;
    const heightBudget = shortLandscape ? 0.14 : 0.15;
    this.pendant.scale.setScalar(Math.min(126, width * (compactPortrait ? 0.18 : 0.26), height * heightBudget) * pixelScale / 0.6);
  }

  /** Trims sit inside the authoritative footprint and never resize its surface. */
  setTable(table: LevelConfig['table'], thickness: number): void {
    const key = `${table.shape}:${table.width}:${table.depth}:${table.materialId}:${thickness}`;
    if (key === this.tableKey || this.disposed) return;
    this.tableKey = key;
    const radius = table.shape === 'circle' ? table.width / 2 : Math.hypot(table.width, table.depth) / 2;
    this.roomClip.constant = radius + 0.3;
    this.tableDress.clear();
    this.tableGeometries.forEach((geometry) => geometry.dispose());
    this.tableGeometries.clear();
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
      this.tableGeometries.add(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.raycast = () => {};
      this.tableDress.add(mesh);
      return mesh;
    };
    const trimMaterial = table.materialId === 'marble' ? this.steel : this.brass;
    if (table.shape === 'circle') {
      const radius = table.width / 2;
      for (const y of [0.0007, -thickness + 0.006]) {
        const trim = add(new THREE.TorusGeometry(radius - 0.003, 0.0026, 6, 96), trimMaterial, 0, y, 0);
        trim.rotation.x = Math.PI / 2;
      }
      add(new THREE.CylinderGeometry(radius * 0.94, radius * 0.93, 0.065, 64), this.darkWood, 0, -thickness - 0.0325, 0);
    } else {
      for (const side of [-1, 1]) {
        add(new THREE.BoxGeometry(table.width - 0.006, 0.002, 0.004), trimMaterial, 0, 0.0004, side * (table.depth / 2 - 0.003));
        add(new THREE.BoxGeometry(0.004, 0.002, table.depth - 0.006), trimMaterial, side * (table.width / 2 - 0.003), 0.0004, 0);
      }
      add(new THREE.BoxGeometry(table.width * 0.94, 0.065, table.depth * 0.94), this.darkWood, 0, -thickness - 0.0325, 0);
    }
    const height = -FLOOR_Y - thickness - 0.06;
    add(new THREE.CylinderGeometry(0.095, 0.13, height, 16), this.darkWood, 0, FLOOR_Y + height / 2 + 0.025, 0);
    for (const yaw of [0, Math.PI / 2]) {
      const foot = add(new THREE.BoxGeometry(Math.min(table.width, table.depth) * 0.7, 0.065, 0.12), this.darkWood, 0, FLOOR_Y + 0.035, 0);
      foot.rotation.y = yaw;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removeFromParent();
    this.key.shadow.dispose();
    this.traverse((object) => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
    this.geometries.forEach((geometry) => geometry.dispose());
    this.tableGeometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.textures.forEach((texture) => texture.dispose());
    this.clear();
  }
}
