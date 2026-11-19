"""Generate the original 3D vehicle and landmark assets for Monsoon Drift.

Run with Blender's bundled Python or the `bpy` module:

    blender --background --python tools/blender/make_assets.py
    # or
    PYTHONPATH=/path/to/bpy python3 tools/blender/make_assets.py

The script writes:
  tools/blender/monsoon_assets.blend  (editable Blender source)
  public/assets/*.glb                 (runtime glTF binaries)
"""

from __future__ import annotations

import math
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[2]
ASSET_DIR = ROOT / "public" / "assets"
BLEND_PATH = ROOT / "tools" / "blender" / "monsoon_assets.blend"
ASSET_DIR.mkdir(parents=True, exist_ok=True)
BLEND_PATH.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color, metallic=0.0, roughness=0.5, emission=0.0):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (*color, 1.0)
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission
    return mat


MAT = {
    "body": material("Body_Paint", (0.95, 0.32, 0.08), 0.28, 0.28),
    "teal": material("Teal_Accent", (0.02, 0.72, 0.68), 0.25, 0.25, 0.15),
    "saffron": material("Saffron", (1.0, 0.56, 0.08), 0.1, 0.35, 0.15),
    "cream": material("Warm_Cream", (0.96, 0.83, 0.58), 0.05, 0.55),
    "glass": material("Smoked_Glass", (0.025, 0.07, 0.11), 0.35, 0.12),
    "trim": material("Graphite_Trim", (0.035, 0.045, 0.06), 0.25, 0.42),
    "tire": material("Tire_Rubber", (0.018, 0.02, 0.025), 0.0, 0.82),
    "metal": material("Brushed_Metal", (0.58, 0.62, 0.66), 0.75, 0.25),
    "headlamp": material("Headlamp_Glow", (0.82, 0.95, 1.0), 0.0, 0.18, 2.2),
    "taillamp": material("Tail_Glow", (1.0, 0.08, 0.05), 0.0, 0.22, 1.8),
    "gold": material("Festival_Gold", (1.0, 0.72, 0.16), 0.5, 0.25, 0.3),
    "auto_yellow": material("Auto_Yellow", (0.98, 0.74, 0.05), 0.1, 0.36),
    "auto_green": material("Auto_Green", (0.02, 0.48, 0.28), 0.1, 0.38),
    "stone": material("Temple_Stone", (0.82, 0.61, 0.40), 0.02, 0.7),
    "roof": material("Canopy_Red", (0.62, 0.08, 0.13), 0.05, 0.55),
}


def collection(name):
    coll = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if not bpy.context.scene.collection.children.get(coll.name):
        bpy.context.scene.collection.children.link(coll)
    return coll


def move(obj, coll):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    coll.objects.link(obj)
    return obj


def activate(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_transforms(obj):
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def bevel(obj, width=0.045, segments=2):
    activate(obj)
    mod = obj.modifiers.new("Soft_Edges", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(25)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def box(name, loc, size, mat, coll, bevel_width=0.04, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    obj.data.materials.append(mat)
    apply_transforms(obj)
    if bevel_width:
        bevel(obj, bevel_width)
    return move(obj, coll)


def cylinder(name, loc, radius, depth, mat, coll, vertices=20, rotation=(0, 0, 0), bevel_width=0.02):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=loc,
        rotation=rotation,
        end_fill_type="NGON",
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    apply_transforms(obj)
    activate(obj)
    bpy.ops.object.shade_smooth()
    if bevel_width:
        bevel(obj, bevel_width, 2)
    return move(obj, coll)


def custom_mesh(name, verts, faces, mat, coll, bevel_width=0.02):
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    coll.objects.link(obj)
    obj.data.materials.append(mat)
    if bevel_width:
        bevel(obj, bevel_width, 2)
    return obj


def quad(name, points, mat, coll):
    return custom_mesh(name, points, [(0, 1, 2, 3)], mat, coll, 0.0)


def wheel(name, loc, coll, radius=0.43, width=0.28):
    # Cylinder axis is X. Rotation is baked so the Three.js wheel object can spin on X.
    rot = (0, math.pi / 2, 0)
    cylinder(name, loc, radius, width, MAT["tire"], coll, 24, rot, 0.015)
    hub = cylinder(
        name + "_Hub",
        (loc[0] + (0.015 if loc[0] < 0 else -0.015), loc[1], loc[2]),
        radius * 0.54,
        width + 0.025,
        MAT["metal"],
        coll,
        16,
        rot,
        0.012,
    )
    return hub


def car_body(coll, prefix, length=4.2, width=2.05, roof=True, spoiler=True):
    half_l = length / 2
    half_w = width / 2

    # Lower body: a chamfered-looking beveled slab.
    box(prefix + "_Body", (0, 0, 0.62), (width, length, 0.72), MAT["body"], coll, 0.14)
    box(prefix + "_Lower_Skirt", (0, 0, 0.31), (width * 0.96, length * 0.96, 0.20), MAT["trim"], coll, 0.06)
    box(prefix + "_Front_Splitter", (0, -half_l - 0.02, 0.30), (width * 1.02, 0.18, 0.10), MAT["trim"], coll, 0.03)
    box(prefix + "_Rear_Diffuser", (0, half_l + 0.02, 0.30), (width * 0.92, 0.16, 0.12), MAT["trim"], coll, 0.03)

    # Cabin prism. Front of every vehicle is Blender -Y => Three.js +Z.
    f_bottom, r_bottom = -0.92, 1.22
    f_top, r_top = -0.34, 0.90
    z_bottom, z_top = 0.96, 1.62
    hw_bottom, hw_top = half_w * 0.88, half_w * 0.72
    verts = [
        (-hw_bottom, f_bottom, z_bottom), (hw_bottom, f_bottom, z_bottom),
        (hw_bottom, r_bottom, z_bottom), (-hw_bottom, r_bottom, z_bottom),
        (-hw_top, f_top, z_top), (hw_top, f_top, z_top),
        (hw_top, r_top, z_top), (-hw_top, r_top, z_top),
    ]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    custom_mesh(prefix + "_Cabin", verts, faces, MAT["body"], coll, 0.035)

    # Glass panels sit a few millimetres outside the cabin surfaces.
    inset = 0.012
    quad(prefix + "_Windshield", [
        (-hw_bottom * 0.88, f_bottom - inset, z_bottom + 0.10),
        (hw_bottom * 0.88, f_bottom - inset, z_bottom + 0.10),
        (hw_top * 0.88, f_top - inset, z_top - 0.10),
        (-hw_top * 0.88, f_top - inset, z_top - 0.10),
    ], MAT["glass"], coll)
    quad(prefix + "_Rear_Glass", [
        (-hw_top * 0.88, r_top + inset, z_top - 0.10),
        (hw_top * 0.88, r_top + inset, z_top - 0.10),
        (hw_bottom * 0.88, r_bottom + inset, z_bottom + 0.10),
        (-hw_bottom * 0.88, r_bottom + inset, z_bottom + 0.10),
    ], MAT["glass"], coll)
    for side in (-1, 1):
        sx = side * (hw_bottom * 0.90 + inset)
        quad(prefix + ("_Left_Window" if side < 0 else "_Right_Window"), [
            (sx, f_bottom + 0.10, z_bottom + 0.12),
            (sx, r_bottom - 0.10, z_bottom + 0.12),
            (side * (hw_top * 0.90 + inset), r_top - 0.08, z_top - 0.10),
            (side * (hw_top * 0.90 + inset), f_top + 0.08, z_top - 0.10),
        ], MAT["glass"], coll)

    # Livery, lamps and details.
    box(prefix + "_Hood_Stripe", (0, -1.42, 0.99), (0.24, 1.12, 0.025), MAT["teal"], coll, 0.012)
    box(prefix + "_Roof_Stripe", (0, 0.24, 1.635), (0.18, 1.20, 0.025), MAT["teal"], coll, 0.012)
    box(prefix + "_Headlamp_L", (-half_w * 0.62, -half_l - 0.03, 0.76), (0.46, 0.10, 0.18), MAT["headlamp"], coll, 0.025)
    box(prefix + "_Headlamp_R", (half_w * 0.62, -half_l - 0.03, 0.76), (0.46, 0.10, 0.18), MAT["headlamp"], coll, 0.025)
    box(prefix + "_Taillamp_L", (-half_w * 0.62, half_l + 0.03, 0.78), (0.48, 0.09, 0.16), MAT["taillamp"], coll, 0.025)
    box(prefix + "_Taillamp_R", (half_w * 0.62, half_l + 0.03, 0.78), (0.48, 0.09, 0.16), MAT["taillamp"], coll, 0.025)
    box(prefix + "_Grille", (0, -half_l - 0.04, 0.56), (width * 0.56, 0.09, 0.18), MAT["trim"], coll, 0.02)
    for side in (-1, 1):
        box(prefix + ("_Mirror_L" if side < 0 else "_Mirror_R"), (side * (half_w + 0.10), -0.62, 1.12), (0.20, 0.28, 0.13), MAT["trim"], coll, 0.035)

    if spoiler:
        box(prefix + "_Spoiler", (0, half_l - 0.12, 1.28), (width * 0.92, 0.28, 0.07), MAT["trim"], coll, 0.025)
        for side in (-1, 1):
            box(prefix + ("_Spoiler_Post_L" if side < 0 else "_Spoiler_Post_R"), (side * half_w * 0.65, half_l - 0.12, 1.10), (0.08, 0.10, 0.32), MAT["trim"], coll, 0.018)

    for x, y, n in [
        (-half_w * 0.82, -half_l * 0.62, "FL"),
        (half_w * 0.82, -half_l * 0.62, "FR"),
        (-half_w * 0.82, half_l * 0.62, "RL"),
        (half_w * 0.82, half_l * 0.62, "RR"),
    ]:
        wheel("Wheel_" + n, (x, y, 0.45), coll, 0.43, 0.30)


def make_hero_car():
    coll = collection("Hero_Car")
    car_body(coll, "Hero", 4.25, 2.08, True, True)
    # A compact roof light and rally details give the hero a unique silhouette.
    box("Hero_Roof_Scoop", (0, -0.08, 1.70), (0.56, 0.52, 0.13), MAT["trim"], coll, 0.035)
    box("Hero_Number_Bar", (0, -2.16, 0.90), (0.72, 0.04, 0.18), MAT["gold"], coll, 0.012)
    return coll


def make_city_car():
    coll = collection("City_Car")
    car_body(coll, "City", 3.95, 1.92, True, False)
    box("City_Taxi_Sign", (0, 0.18, 1.76), (0.70, 0.34, 0.16), MAT["gold"], coll, 0.06)
    return coll


def make_auto_rickshaw():
    coll = collection("Auto_Rickshaw")
    # Three-wheel chassis with an open front and a rounded canopy.
    box("Auto_Chassis", (0, 0.25, 0.48), (1.52, 2.75, 0.40), MAT["auto_green"], coll, 0.14)
    box("Auto_Floor", (0, 0.30, 0.72), (1.34, 2.45, 0.10), MAT["trim"], coll, 0.04)
    box("Auto_Front_Nose", (0, -1.38, 0.66), (1.14, 0.55, 0.62), MAT["auto_yellow"], coll, 0.12)
    box("Auto_Seat", (0, 0.62, 1.00), (1.14, 0.72, 0.42), MAT["trim"], coll, 0.08)
    box("Auto_Backrest", (0, 1.00, 1.30), (1.14, 0.14, 0.70), MAT["trim"], coll, 0.05)
    # Canopy roof and columns.
    box("Auto_Canopy", (0, 0.18, 1.92), (1.62, 2.18, 0.16), MAT["auto_yellow"], coll, 0.10)
    for x in (-0.72, 0.72):
        for y in (-0.86, 1.18):
            cylinder("Auto_Canopy_Pole", (x, y, 1.32), 0.045, 1.22, MAT["metal"], coll, 10, (0, 0, 0), 0.01)
    # Handlebar, front lamp and the single front wheel.
    cylinder("Auto_Handlebar", (0, -1.05, 1.03), 0.045, 0.95, MAT["metal"], coll, 12, (0, math.pi / 2, 0), 0.01)
    box("Auto_Headlamp", (0, -1.68, 0.82), (0.34, 0.09, 0.20), MAT["headlamp"], coll, 0.03)
    wheel("Wheel_FL", (0, -1.28, 0.42), coll, 0.38, 0.24)
    wheel("Wheel_RL", (-0.76, 1.02, 0.42), coll, 0.40, 0.26)
    wheel("Wheel_RR", (0.76, 1.02, 0.42), coll, 0.40, 0.26)
    box("Auto_Tail_L", (-0.48, 1.40, 0.74), (0.22, 0.08, 0.12), MAT["taillamp"], coll, 0.02)
    box("Auto_Tail_R", (0.48, 1.40, 0.74), (0.22, 0.08, 0.12), MAT["taillamp"], coll, 0.02)
    return coll


def make_temple():
    coll = collection("Temple_Landmark")
    for i, size in enumerate([(5.2, 4.6, 0.32), (4.5, 3.9, 0.28), (3.9, 3.3, 0.26)]):
        box("Temple_Step_" + str(i), (0, 0, 0.16 + i * 0.28), size, MAT["stone"], coll, 0.06)
    box("Temple_Platform", (0, 0, 1.10), (3.5, 2.9, 0.55), MAT["stone"], coll, 0.10)
    for x in (-1.25, 1.25):
        for y in (-0.95, 0.95):
            cylinder("Temple_Pillar", (x, y, 2.05), 0.18, 1.55, MAT["cream"], coll, 12, (0, 0, 0), 0.025)
    box("Temple_Shrine", (0, 0.20, 2.05), (2.0, 1.7, 1.25), MAT["cream"], coll, 0.12)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=10, radius=1, location=(0, 0.20, 3.20))
    dome = bpy.context.object
    dome.name = "Temple_Dome"
    dome.scale = (1.05, 0.92, 0.82)
    dome.data.materials.append(MAT["saffron"])
    apply_transforms(dome)
    activate(dome)
    bpy.ops.object.shade_smooth()
    move(dome, coll)
    bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=0.22, radius2=0.02, depth=0.85, location=(0, 0.20, 4.05))
    spire = bpy.context.object
    spire.name = "Temple_Spire"
    spire.data.materials.append(MAT["gold"])
    apply_transforms(spire)
    move(spire, coll)
    box("Temple_Arch_Sign", (0, -1.48, 2.72), (2.0, 0.10, 0.34), MAT["gold"], coll, 0.04)
    return coll


def make_chai_stall():
    coll = collection("Chai_Stall")
    box("Chai_Counter", (0, 0, 0.65), (2.7, 1.25, 1.15), MAT["roof"], coll, 0.08)
    box("Chai_Counter_Top", (0, 0, 1.26), (2.9, 1.40, 0.12), MAT["metal"], coll, 0.04)
    box("Chai_Canopy", (0, 0.20, 2.48), (3.2, 1.8, 0.14), MAT["auto_yellow"], coll, 0.08)
    for x in (-1.35, 1.35):
        for y in (-0.62, 0.62):
            cylinder("Chai_Pole", (x, y, 1.78), 0.055, 1.35, MAT["metal"], coll, 10, (0, 0, 0), 0.01)
    cylinder("Chai_Kettle", (0.65, 0.10, 1.48), 0.25, 0.34, MAT["metal"], coll, 14, (0, 0, 0), 0.03)
    for i in range(4):
        cylinder("Chai_Cup_" + str(i), (-0.75 + i * 0.32, -0.15, 1.40), 0.095, 0.16, MAT["cream"], coll, 10, (0, 0, 0), 0.01)
    box("Chai_Sign", (0, -0.76, 2.10), (2.2, 0.09, 0.55), MAT["teal"], coll, 0.05)
    return coll


COLLECTIONS = [
    ("Hero_Car", "hero_car.glb", make_hero_car),
    ("City_Car", "city_car.glb", make_city_car),
    ("Auto_Rickshaw", "auto_rickshaw.glb", make_auto_rickshaw),
    ("Temple_Landmark", "temple.glb", make_temple),
    ("Chai_Stall", "chai_stall.glb", make_chai_stall),
]


for _, _, factory in COLLECTIONS:
    factory()


def export_collection(coll_name, filename):
    coll = bpy.data.collections[coll_name]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in coll.objects:
        obj.select_set(True)
    if coll.objects:
        bpy.context.view_layer.objects.active = next(iter(coll.objects))
    bpy.ops.export_scene.gltf(
        filepath=str(ASSET_DIR / filename),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_materials="EXPORT",
    )
    print("Exported", filename, "objects:", len(coll.objects))


for coll_name, filename, _ in COLLECTIONS:
    export_collection(coll_name, filename)

bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
print("Saved Blender source:", BLEND_PATH)
