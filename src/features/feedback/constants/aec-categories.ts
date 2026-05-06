import type { LucideIcon } from "lucide-react";
import {
  Layers,
  Box,
  PenTool,
  FileText,
  Sparkles,
  Globe,
  Cpu,
  Ruler,
  Zap,
  Hammer,
  Building2,
} from "lucide-react";

export interface AecCategory {
  label: string;
  icon: LucideIcon;
  color: string;
}

export const AEC_CATEGORIES: AecCategory[] = [
  { label: "BIM / IFC", icon: Layers, color: "var(--rs-blueprint)" },
  { label: "3D Modeling", icon: Box, color: "#8B5CF6" },
  { label: "Floor Plans", icon: PenTool, color: "var(--rs-blueprint-2)" },
  { label: "Cost / BOQ", icon: FileText, color: "var(--rs-burnt)" },
  { label: "Rendering", icon: Sparkles, color: "#C06090" },
  { label: "PDF / Docs", icon: FileText, color: "var(--rs-sage)" },
  { label: "Collaboration", icon: Globe, color: "#6366F1" },
  { label: "Revit / Rhino", icon: Cpu, color: "var(--rs-ember)" },
  { label: "Site Analysis", icon: Ruler, color: "#14B8A6" },
  { label: "Sustainability", icon: Zap, color: "#22C55E" },
  { label: "Structural", icon: Hammer, color: "#A855F7" },
  { label: "MEP Systems", icon: Building2, color: "#3B82F6" },
];
