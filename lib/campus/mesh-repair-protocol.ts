import * as THREE from 'three';
import { subtractVolumes, type CutVolume } from './clip-volume';

export type PackedGeometry = {
  attributes: {
    name: string;
    array: THREE.TypedArray;
    itemSize: number;
    normalized: boolean;
  }[];
  index: Uint32Array | null;
  groups: { start: number; count: number; materialIndex: number }[];
  bounds: number[] | null;
  sphere: number[] | null;
};
export type PackedVolume = { bounds: number[]; planes: number[][] };
export type RepairRequest = {
  id: number;
  geometry: PackedGeometry;
  matrix: number[];
  volumes: PackedVolume[];
};
export type RepairResponse = {
  id: number;
  geometry: PackedGeometry | null;
  milliseconds: number;
  failed?: boolean;
};

// Copy renderer-owned buffers before transfer. Transferring the originals would
// detach arrays that Three.js still needs for drawing, picking and disposal.
export function packGeometry(geometry: THREE.BufferGeometry): PackedGeometry {
  return {
    attributes: Object.entries(geometry.attributes).map(([name, attribute]) => {
      if (
        attribute instanceof THREE.InterleavedBufferAttribute ||
        attribute instanceof THREE.Float16BufferAttribute
      ) {
        const array = new Float32Array(attribute.count * attribute.itemSize);
        for (let i = 0; i < attribute.count; i++)
          for (let c = 0; c < attribute.itemSize; c++)
            array[i * attribute.itemSize + c] = attribute.getComponent(i, c);
        return { name, array, itemSize: attribute.itemSize, normalized: false };
      }
      return {
        name,
        array: attribute.array.slice(),
        itemSize: attribute.itemSize,
        normalized: attribute.normalized,
      };
    }),
    index: geometry.index ? new Uint32Array(geometry.index.array) : null,
    groups: geometry.groups.map((group) => ({
      ...group,
      materialIndex: group.materialIndex ?? 0,
    })),
    bounds: geometry.boundingBox
      ? [
          ...geometry.boundingBox.min.toArray(),
          ...geometry.boundingBox.max.toArray(),
        ]
      : null,
    sphere: geometry.boundingSphere
      ? [
          ...geometry.boundingSphere.center.toArray(),
          geometry.boundingSphere.radius,
        ]
      : null,
  };
}
export function unpackGeometry(packed: PackedGeometry) {
  const geometry = new THREE.BufferGeometry();
  for (const attr of packed.attributes)
    geometry.setAttribute(
      attr.name,
      new THREE.BufferAttribute(attr.array, attr.itemSize, attr.normalized),
    );
  if (packed.index)
    geometry.setIndex(new THREE.BufferAttribute(packed.index, 1));
  geometry.groups = packed.groups;
  if (packed.bounds)
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3().fromArray(packed.bounds),
      new THREE.Vector3().fromArray(packed.bounds, 3),
    );
  if (packed.sphere)
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3().fromArray(packed.sphere),
      packed.sphere[3],
    );
  return geometry;
}
export function transferBuffers(geometry: PackedGeometry) {
  const buffers = geometry.attributes.map((a) => a.array.buffer as ArrayBuffer);
  if (geometry.index) buffers.push(geometry.index.buffer as ArrayBuffer);
  return [...new Set(buffers)];
}
export function packVolumes(volumes: CutVolume[]): PackedVolume[] {
  return volumes.map((volume) => ({
    bounds: [...volume.bounds.min.toArray(), ...volume.bounds.max.toArray()],
    planes: volume.planes.map((plane) => [
      ...plane.normal.toArray(),
      plane.constant,
    ]),
  }));
}
export function processRepair(request: RepairRequest): RepairResponse {
  const began = performance.now();
  const source = unpackGeometry(request.geometry);
  const volumes = request.volumes.map((v) => ({
    bounds: new THREE.Box3(
      new THREE.Vector3().fromArray(v.bounds),
      new THREE.Vector3().fromArray(v.bounds, 3),
    ),
    planes: v.planes.map(
      (p) => new THREE.Plane(new THREE.Vector3().fromArray(p), p[3]),
    ),
  }));
  const result = subtractVolumes(
    source,
    new THREE.Matrix4().fromArray(request.matrix),
    volumes,
  );
  const geometry = result ? packGeometry(result) : null;
  source.dispose();
  result?.dispose();
  return { id: request.id, geometry, milliseconds: performance.now() - began };
}
