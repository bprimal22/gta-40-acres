import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildHedgeBatches } from './hedge-batches';

export type TreePlacement = {
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale: number;
  width?: number;
  height?: number;
};
export type HedgePlacement = {
  a: [number,number]; b: [number,number]; y:number; endY:number; width:number; height:number;
};

export class ForegroundTrees {
  group = new THREE.Group();
  private lods: THREE.LOD[] = [];
  private hedgeMeshes: THREE.InstancedMesh[] = [];
  private geometries = new Set<THREE.BufferGeometry>();
  private materials = new Set<THREE.Material>();
  private colliders: RAPIER.Collider[] = [];
  private disposed = false;
  count = 0;
  hedgeStats: ReturnType<typeof buildHedgeBatches>['stats'] | null = null;
  constructor(private physics: RAPIER.World) {
    this.group.name = 'Foreground broadleaf trees';
  }
  async load(placements: TreePlacement[], hedges: HedgePlacement[] = []) {
    const sources = await Promise.all(
      ['near', 'mid', 'far'].map((level) =>
        new GLTFLoader().loadAsync(`/assets/foreground-tree/${level}.glb`),
      ),
    );
    const sharedMaterials = new Map<string, THREE.Material>();
    const redundantMaterials = new Set<THREE.Material>();
    for (const { scene } of sources)
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        this.geometries.add(o.geometry);
        const original = Array.isArray(o.material) ? o.material : [o.material];
        const shared = original.map((m) => {
          const existing = sharedMaterials.get(m.name);
          if (existing) {
            if (existing !== m) redundantMaterials.add(m);
            return existing;
          }
          sharedMaterials.set(m.name, m);
          this.materials.add(m);
          // This exact bundled leaf asset has RGB JPEGs, opacity 1, and no
          // alpha map or vertex alpha. Its exported BLEND mode needlessly
          // rendered both sides in separate transparent passes without depth.
          if (m instanceof THREE.MeshStandardMaterial && m.name === 'island_tree_02_leaves') {
            m.transparent = false;
            m.depthWrite = true;
          }
          if (
            m instanceof THREE.MeshStandardMaterial &&
            !m.name.includes('leaves')
          )
            m.color.multiply(new THREE.Color(0x817b72));
          return m;
        });
        o.material = Array.isArray(o.material) ? shared : shared[0];
      });
    // All three generated LODs use identical material definitions. Reuse their
    // textures on the GPU rather than retaining three copies of each image.
    const retainedTextures = new Set<THREE.Texture>();
    for (const material of this.materials)
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) retainedTextures.add(value);
    const releasedTextures = new Set<THREE.Texture>();
    for (const material of redundantMaterials) {
      for (const value of Object.values(material))
        if (
          value instanceof THREE.Texture &&
          !retainedTextures.has(value) &&
          !releasedTextures.has(value)
        ) {
          value.dispose();
          releasedTextures.add(value);
        }
      material.dispose();
    }
    if (this.disposed) {
      this.release();
      return;
    }
    for (const p of placements) {
      const lod = new THREE.LOD();
      for (let i = 0; i < sources.length; i++) {
        const instance = sources[i].scene.clone(true);
        instance.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        lod.addLevel(instance, [0, 24, 65][i], 0.12);
      }
      lod.position.set(p.x, p.y, p.z);
      lod.rotation.y = p.rotation;
      lod.scale.set(3.1 * p.scale * (p.width ?? 1), 2.5 * p.scale * (p.height ?? 1), 3.1 * p.scale * (p.width ?? 1));
      this.group.add(lod);
      this.lods.push(lod);
      lod.updateWorldMatrix(true, true);
      // Match the visible woody trunk, including its bend, rather than using
      // a giant solid canopy as the obstacle.
      lod.levels[0].object.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        if (!materials.some((m) => m.name === 'island_tree_02')) return;
        const g = o.geometry,
          source = g.attributes.position;
        const vertices = new Float32Array(source.count * 3),
          point = new THREE.Vector3();
        for (let i = 0; i < source.count; i++) {
          point.fromBufferAttribute(source, i).applyMatrix4(o.matrixWorld);
          vertices.set(point.toArray(), i * 3);
        }
        this.colliders.push(
          this.physics.createCollider(
            RAPIER.ColliderDesc.trimesh(
              vertices,
              new Uint32Array(g.index!.array),
              RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
            ),
          ),
        );
      });
    }
    // Hedges retain the exact original cells/collider inputs, but use a
    // compact leafy cell and spatial batches instead of the full far tree.
    const sourceLeaf=[...sharedMaterials.values()].find(m=>m.name.includes('leaves'));
    if(!(sourceLeaf instanceof THREE.MeshStandardMaterial))throw new Error('Missing hedge leaf material');
    const hedge=buildHedgeBatches(hedges,sourceLeaf),cells=hedge.cells;
    this.geometries.add(hedge.geometry);this.materials.add(hedge.material);
    for(const mesh of hedge.batches){this.group.add(mesh);this.hedgeMeshes.push(mesh);}
    this.hedgeStats=hedge.stats;
    for(const p of cells)this.colliders.push(this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(p.width*.43,p.height*.45,p.width*.43).setTranslation(p.x,p.y+p.height*.45,p.z)));
    this.count = placements.length;
  }
  update(camera: THREE.Camera) {
    for (const lod of this.lods) {
      lod.visible = lod.position.distanceTo(camera.position) < 650;
      if (lod.visible) lod.update(camera);
    }
  }
  private release() {
    for(const mesh of this.hedgeMeshes)mesh.dispose();
    this.hedgeMeshes=[];
    const textures = new Set<THREE.Texture>();
    for (const material of this.materials) {
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
      material.dispose();
    }
    for (const texture of textures) texture.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    this.materials.clear();
    this.geometries.clear();
  }
  dispose() {
    this.disposed = true;
    this.group.removeFromParent();
    for (const collider of this.colliders)
      this.physics.removeCollider(collider, true);
    this.colliders = [];
    this.release();
  }
}
