import * as THREE from "three";

export interface RoomDef {
  name: string;
  x: number;       // left edge (world units, meters)
  z: number;       // front edge
  width: number;   // x-extent
  depth: number;   // z-extent
  floor: number;   // 0 = ground, 1 = upper, etc.
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
  | "closet"
  | "lobby"
  | "conference"
  | "openOffice"
  | "gym"
  | "lounge"
  | "gallery"
  | "classroom"
  | "ward"
  | "mechanical"
  | "storage"
  | "reception"
  | "restaurant"
  | "spa";

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

/** Style hints extracted from user prompt for adaptive building generation */
export interface BuildingStyle {
  glassHeavy: boolean;    // "glass building", "curtain wall", "glazed"
  hasRiver: boolean;      // "near river", "waterfront", "riverside"
  hasLake: boolean;       // "near lake", "lakeside"
  isModern: boolean;      // "modern", "contemporary", "minimalist"
  isTower: boolean;       // "tower", "skyscraper", "high-rise"
  exteriorMaterial: "glass" | "concrete" | "brick" | "wood" | "steel" | "stone" | "terracotta" | "mixed";
  environment: "urban" | "suburban" | "waterfront" | "park" | "desert" | "coastal" | "mountain" | "campus";
  usage: "residential" | "office" | "mixed" | "commercial" | "hotel" | "educational" | "healthcare" | "cultural" | "industrial" | "civic";
  promptText: string;     // raw prompt text for display
  typology: "tower" | "slab" | "courtyard" | "villa" | "warehouse" | "podium-tower" | "generic";
  facadePattern: "curtain-wall" | "punched-window" | "ribbon-window" | "brise-soleil" | "none";
  floorHeightOverride?: number;  // per-floor height in meters (default 3.6)
  maxFloorCap: number;           // rendering cap (default 30)
}

export interface BuildingConfig {
  floors: number;
  floorHeight: number;
  rooms: RoomDef[];
  wallThickness: number;
  exteriorWallThickness: number;
  style: BuildingStyle;
}

export interface ArchitecturalViewerProps {
  floors: number;
  height: number;
  footprint: number;
  gfa: number;
  buildingType?: string;
  style?: BuildingStyle;
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
