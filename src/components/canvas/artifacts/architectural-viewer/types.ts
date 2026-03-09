import * as THREE from "three";

export interface RoomDef {
  name: string;
  x: number;       // left edge (world units, meters)
  z: number;       // front edge
  width: number;   // x-extent
  depth: number;   // z-extent
  floor: number;   // 0 = ground, 1 = upper
  type: RoomType;
  hasCeiling?: boolean; // default true; false for terraces
}

export type RoomType =
  | "living"
  | "kitchen"
  | "dining"
  | "bedroom"
  | "bathroom"
  | "office"
  | "hallway"
  | "stairs"
  | "terrace"
  | "retail"
  | "closet";

export interface WallSegment {
  start: THREE.Vector2;
  end: THREE.Vector2;
  floor: number;
  isExterior: boolean;
  thickness: number;
}

export interface Opening {
  wallIndex: number;
  position: number;   // 0-1 along wall length
  width: number;
  height: number;
  sillHeight: number; // distance from floor
  type: "door" | "window" | "glass-wall";
}

export interface DoorMesh {
  mesh: THREE.Mesh;
  pivot: THREE.Group;
  isOpen: boolean;
  targetAngle: number;
  currentAngle: number;
  roomName: string;
}

export interface BuildingConfig {
  floors: number;
  floorHeight: number;
  rooms: RoomDef[];
  wallThickness: number;
  exteriorWallThickness: number;
}

export interface ArchitecturalViewerProps {
  floors: number;
  height: number;
  footprint: number;
  gfa: number;
  buildingType?: string;
  rooms?: Array<{
    name: string;
    area: number;
    type?: string;
    x?: number;
    z?: number;
    width?: number;
    depth?: number;
  }>;
}
