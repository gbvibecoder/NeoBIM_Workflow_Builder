You decompose a single named furniture/equipment item into its physical
parts for IFC building generation. Output ONLY a JSON array. No prose.
No markdown. No code fences.

INPUT
- archetype: {archetype}
- item_name: {item_name}
- item_type: {item_type}
- bounding_box_m: {bbox}  (footprint x, footprint y, height z)
- material_hint: {material_hint}
- brief_excerpt: {brief_excerpt}

COORDINATE FRAME
- Origin at item floor center.
- +X = item's depth-forward (away from user / into the scene)
- +Y = item's width-right
- +Z = up
- All part origins MUST fit inside the bounding box.

PART SCHEMA (each entry)
- id: snake_case, unique within this item
- subtype: descriptive (e.g., "tripod_leg_lower", "backdrop_pole")
- origin_local_m: [x, y, z] floats
- dims_m: [x, y, z] floats  (for "cylinder" shape: x=radius, y=radius,
  z=height — first two MUST match)
- shape: "box" or "cylinder"
- rotation_z_rad: float, default 0
- material_id: ONE OF the ALLOWED MATERIALS below
- ifc_class: "IfcFurnishingElement" | "IfcSystemFurnitureElement" |
  "IfcDiscreteAccessory"
- notes: optional

ALLOWED MATERIALS
chrome_steel, black_steel, carbon_fiber, aluminium, glass_clear,
wood_teak, wood_dark, wood_oak, wood_pine, leather_black, leather_brown,
rubber_black, paper_neutral, fabric_neutral, fabric_grey, camera_black,
concrete_polished, concrete_structural, plastic_white, plastic_black,
copper, brass, stone_marble, ceramic_white, wall_paint_offwhite

RULES
1. Decompose realistically. A tripod is NEVER a single box. A backdrop
   stand has at least 2 poles + crossbar + 2 feet + hanging sheet.
2. Use "cylinder" for legs, columns, poles, lenses, wheels.
3. Use "box" for seats, frames, plates, screens, paper sheets, fabric.
4. Splay tripod legs at 120 degree intervals around center.
5. 5-star stool bases get 5 arms at 72 degree intervals + 5 caster wheels.
6. Workstations include: tabletop + 4 legs + monitor + keyboard + mouse
   + chair (with chair as separate composite if requested).
7. Beds include: mattress + bedframe + 2 side tables (if archetype is
   master bedroom) + 1 headboard.
8. Wardrobes include: carcass + 2 or more doors + interior shelves.
9. Output the JSON array DIRECTLY. First character must be "[".

WORKED EXAMPLES

Example 1 — "tripod", bbox [0.9, 0.9, 1.55]:
[
  {"id":"leg_1_lower","subtype":"tripod_leg_lower","origin_local_m":[0.4,0,0],"dims_m":[0.012,0.012,0.7],"shape":"cylinder","rotation_z_rad":0,"material_id":"carbon_fiber","ifc_class":"IfcFurnishingElement"},
  {"id":"leg_1_upper","subtype":"tripod_leg_upper","origin_local_m":[0.2,0,0.7],"dims_m":[0.012,0.012,0.55],"shape":"cylinder","rotation_z_rad":0,"material_id":"carbon_fiber","ifc_class":"IfcFurnishingElement"},
  {"id":"leg_2_lower","subtype":"tripod_leg_lower","origin_local_m":[-0.2,0.346,0],"dims_m":[0.012,0.012,0.7],"shape":"cylinder","rotation_z_rad":0,"material_id":"carbon_fiber","ifc_class":"IfcFurnishingElement"},
  {"id":"leg_2_upper","subtype":"tripod_leg_upper","origin_local_m":[-0.1,0.173,0.7],"dims_m":[0.012,0.012,0.55],"shape":"cylinder","rotation_z_rad":0,"material_id":"carbon_fiber","ifc_class":"IfcFurnishingElement"},
  {"id":"leg_3_lower","subtype":"tripod_leg_lower","origin_local_m":[-0.2,-0.346,0],"dims_m":[0.012,0.012,0.7],"shape":"cylinder","rotation_z_rad":0,"material_id":"carbon_fiber","ifc_class":"IfcFurnishingElement"},
  {"id":"leg_3_upper","subtype":"tripod_leg_upper","origin_local_m":[-0.1,-0.173,0.7],"dims_m":[0.012,0.012,0.55],"shape":"cylinder","rotation_z_rad":0,"material_id":"carbon_fiber","ifc_class":"IfcFurnishingElement"},
  {"id":"column","subtype":"tripod_center_column","origin_local_m":[0,0,1.25],"dims_m":[0.014,0.014,0.2],"shape":"cylinder","rotation_z_rad":0,"material_id":"aluminium","ifc_class":"IfcFurnishingElement"},
  {"id":"ball_head","subtype":"tripod_ball_head","origin_local_m":[0,0,1.4],"dims_m":[0.045,0.045,0.06],"shape":"cylinder","rotation_z_rad":0,"material_id":"black_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"plate","subtype":"quick_release_plate","origin_local_m":[0,0,1.46],"dims_m":[0.065,0.045,0.008],"shape":"box","rotation_z_rad":0,"material_id":"aluminium","ifc_class":"IfcDiscreteAccessory"},
  {"id":"camera_body","subtype":"camera_body","origin_local_m":[0,0,1.47],"dims_m":[0.15,0.1,0.105],"shape":"box","rotation_z_rad":0,"material_id":"camera_black","ifc_class":"IfcDiscreteAccessory"},
  {"id":"lens","subtype":"camera_lens","origin_local_m":[0,-0.13,1.52],"dims_m":[0.045,0.045,0.18],"shape":"cylinder","rotation_z_rad":1.5708,"material_id":"camera_black","ifc_class":"IfcDiscreteAccessory"}
]

Example 2 — "backdrop_stand", bbox [2.5, 0.32, 2.7]:
[
  {"id":"foot_l","subtype":"base_foot","origin_local_m":[-1.1,0,0],"dims_m":[0.6,0.08,0.04],"shape":"box","rotation_z_rad":0,"material_id":"black_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"foot_r","subtype":"base_foot","origin_local_m":[1.1,0,0],"dims_m":[0.6,0.08,0.04],"shape":"box","rotation_z_rad":0,"material_id":"black_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"pole_l","subtype":"vertical_pole","origin_local_m":[-1.1,0,0.04],"dims_m":[0.02,0.02,2.5],"shape":"cylinder","rotation_z_rad":0,"material_id":"aluminium","ifc_class":"IfcFurnishingElement"},
  {"id":"pole_r","subtype":"vertical_pole","origin_local_m":[1.1,0,0.04],"dims_m":[0.02,0.02,2.5],"shape":"cylinder","rotation_z_rad":0,"material_id":"aluminium","ifc_class":"IfcFurnishingElement"},
  {"id":"crossbar","subtype":"crossbar","origin_local_m":[0,0,2.54],"dims_m":[0.015,0.015,2.4],"shape":"cylinder","rotation_z_rad":1.5708,"material_id":"aluminium","ifc_class":"IfcFurnishingElement"},
  {"id":"paper_sheet","subtype":"backdrop_paper","origin_local_m":[0,0.05,0.3],"dims_m":[2.3,0.01,2.2],"shape":"box","rotation_z_rad":0,"material_id":"paper_neutral","ifc_class":"IfcFurnishingElement"}
]

Example 3 — "studio_stool", bbox [0.56, 0.56, 0.7]:
[
  {"id":"seat","subtype":"stool_seat","origin_local_m":[0,0,0.58],"dims_m":[0.35,0.35,0.05],"shape":"cylinder","rotation_z_rad":0,"material_id":"leather_black","ifc_class":"IfcFurnishingElement"},
  {"id":"plate","subtype":"underside_plate","origin_local_m":[0,0,0.55],"dims_m":[0.15,0.15,0.02],"shape":"cylinder","rotation_z_rad":0,"material_id":"black_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"column","subtype":"gas_column","origin_local_m":[0,0,0.12],"dims_m":[0.03,0.03,0.43],"shape":"cylinder","rotation_z_rad":0,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"arm_1","subtype":"base_arm","origin_local_m":[0.24,0,0.04],"dims_m":[0.22,0.03,0.03],"shape":"box","rotation_z_rad":0,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"arm_2","subtype":"base_arm","origin_local_m":[0.074,0.228,0.04],"dims_m":[0.22,0.03,0.03],"shape":"box","rotation_z_rad":1.2566,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"arm_3","subtype":"base_arm","origin_local_m":[-0.194,0.141,0.04],"dims_m":[0.22,0.03,0.03],"shape":"box","rotation_z_rad":2.5133,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"arm_4","subtype":"base_arm","origin_local_m":[-0.194,-0.141,0.04],"dims_m":[0.22,0.03,0.03],"shape":"box","rotation_z_rad":3.7699,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"arm_5","subtype":"base_arm","origin_local_m":[0.074,-0.228,0.04],"dims_m":[0.22,0.03,0.03],"shape":"box","rotation_z_rad":5.0265,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"wheel_1","subtype":"caster_wheel","origin_local_m":[0.24,0,0],"dims_m":[0.025,0.025,0.04],"shape":"cylinder","rotation_z_rad":0,"material_id":"rubber_black","ifc_class":"IfcDiscreteAccessory"},
  {"id":"wheel_2","subtype":"caster_wheel","origin_local_m":[0.074,0.228,0],"dims_m":[0.025,0.025,0.04],"shape":"cylinder","rotation_z_rad":0,"material_id":"rubber_black","ifc_class":"IfcDiscreteAccessory"},
  {"id":"wheel_3","subtype":"caster_wheel","origin_local_m":[-0.194,0.141,0],"dims_m":[0.025,0.025,0.04],"shape":"cylinder","rotation_z_rad":0,"material_id":"rubber_black","ifc_class":"IfcDiscreteAccessory"},
  {"id":"wheel_4","subtype":"caster_wheel","origin_local_m":[-0.194,-0.141,0],"dims_m":[0.025,0.025,0.04],"shape":"cylinder","rotation_z_rad":0,"material_id":"rubber_black","ifc_class":"IfcDiscreteAccessory"},
  {"id":"wheel_5","subtype":"caster_wheel","origin_local_m":[0.074,-0.228,0],"dims_m":[0.025,0.025,0.04],"shape":"cylinder","rotation_z_rad":0,"material_id":"rubber_black","ifc_class":"IfcDiscreteAccessory"}
]

Example 4 — "workstation_desk", bbox [1.4, 0.7, 1.2]:
[
  {"id":"tabletop","subtype":"desk_tabletop","origin_local_m":[0,0,0.72],"dims_m":[1.3,0.65,0.03],"shape":"box","rotation_z_rad":0,"material_id":"wood_oak","ifc_class":"IfcFurnishingElement"},
  {"id":"leg_fl","subtype":"desk_leg","origin_local_m":[-0.6,-0.28,0],"dims_m":[0.04,0.04,0.72],"shape":"cylinder","rotation_z_rad":0,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"leg_fr","subtype":"desk_leg","origin_local_m":[0.6,-0.28,0],"dims_m":[0.04,0.04,0.72],"shape":"cylinder","rotation_z_rad":0,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"leg_bl","subtype":"desk_leg","origin_local_m":[-0.6,0.28,0],"dims_m":[0.04,0.04,0.72],"shape":"cylinder","rotation_z_rad":0,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"leg_br","subtype":"desk_leg","origin_local_m":[0.6,0.28,0],"dims_m":[0.04,0.04,0.72],"shape":"cylinder","rotation_z_rad":0,"material_id":"chrome_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"monitor_stand","subtype":"monitor_arm","origin_local_m":[0,0.25,0.75],"dims_m":[0.06,0.06,0.3],"shape":"cylinder","rotation_z_rad":0,"material_id":"black_steel","ifc_class":"IfcFurnishingElement"},
  {"id":"monitor","subtype":"monitor_screen","origin_local_m":[0,0.28,1.0],"dims_m":[0.55,0.03,0.35],"shape":"box","rotation_z_rad":0,"material_id":"plastic_black","ifc_class":"IfcDiscreteAccessory"},
  {"id":"keyboard","subtype":"keyboard","origin_local_m":[0,-0.05,0.73],"dims_m":[0.44,0.15,0.02],"shape":"box","rotation_z_rad":0,"material_id":"plastic_black","ifc_class":"IfcDiscreteAccessory"},
  {"id":"mouse","subtype":"mouse","origin_local_m":[0.35,-0.05,0.73],"dims_m":[0.06,0.1,0.03],"shape":"box","rotation_z_rad":0,"material_id":"plastic_black","ifc_class":"IfcDiscreteAccessory"},
  {"id":"cable_tray","subtype":"cable_management_tray","origin_local_m":[0,0.2,0.65],"dims_m":[0.8,0.1,0.05],"shape":"box","rotation_z_rad":0,"material_id":"black_steel","ifc_class":"IfcDiscreteAccessory"}
]

Now decompose the input item above. Output ONLY the JSON array.
