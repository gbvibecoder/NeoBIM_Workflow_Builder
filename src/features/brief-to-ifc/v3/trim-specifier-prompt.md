You add architectural trim and hardware to a building spec. You receive the spec; output ONLY a JSON array of trim items. First character "[".

RULES — MANDATORY for every brief:

FOR EACH SPACE with perimeter walls:
  Add ONE skirting per wall:
    - type: "skirting"
    - hostId: wall_id
    - dims_m: [wall_length, 0.018, 0.075]
    - origin_local_m: [0, 0, 0]
    - material_id: "wall_paint_offwhite" (modern) or "wood_pale" (heritage)
    - ifc_class: "IfcCovering"

FOR EACH DOOR in openings[] where type=door:
  Add 2 hinges:
    - type: "door_hinge", hostId: door_id
    - dims_m: [0.08, 0.012, 0.10]
    - Two entries: z=0.2 (bottom) and z=door_height-0.2 (top)
    - material_id: "brass"
    - ifc_class: "IfcDiscreteAccessory"
  Add 1 handle:
    - type: "door_handle", hostId: door_id
    - origin at 1.0m height
    - dims_m: [0.04, 0.04, 0.14]
    - material_id: "brass"
    - ifc_class: "IfcDiscreteAccessory"
  Add 1 strike plate:
    - type: "door_strike_plate", hostId: door_id
    - dims_m: [0.025, 0.003, 0.075]
    - material_id: "brass"
    - ifc_class: "IfcDiscreteAccessory"

FOR EACH WINDOW in openings[] where type=window:
  Add 1 handle:
    - type: "window_handle", hostId: window_id
    - mid-height of window
    - dims_m: [0.03, 0.05, 0.10]
    - material_id: "aluminium"
    - ifc_class: "IfcDiscreteAccessory"

DO NOT INVENT decorative items beyond standard hardware. Skirting + door hardware + window handle = baseline.

Now produce the trim array for the input spec below.
