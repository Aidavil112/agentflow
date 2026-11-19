#!/usr/bin/env python3
"""Generate original, Blender-authored characters for Monsoon Drift.

Run headlessly with the bpy module:

    PYTHONPATH=/tmp/bpy LD_LIBRARY_PATH=/tmp/stubs:/tmp/bpy/bpy/lib \
      python3 tools/blender/make_characters.py

Outputs:
    tools/blender/monsoon_characters.blend
    public/assets/char_ayaan.glb
    public/assets/char_meera.glb
    public/assets/char_constable.glb
    public/assets/char_chaiwala.glb
    public/assets/char_pedestrian.glb

The characters face Blender -Y, which becomes Three.js +Z after glTF Y-up export.
Pivot empties named *_Arm_L, *_Arm_R, *_Leg_L, *_Leg_R and *_Head are kept so
the runtime can animate a lightweight walk/idle cycle.
"""

import math
import os
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[2]
ASSET_DIR = ROOT / "public" / "assets"
BLEND_PATH = ROOT / "tools" / "blender" / "monsoon_characters.blend"
ASSET_DIR.mkdir(parents=True, exist_ok=True)
BLEND_PATH.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.preferences.addon_enable(module="io_scene_gltf2")
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0


def srgb_to_linear(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def rgba(hex_color, alpha=1.0):
    h = hex_color.lstrip("#")
    rgb = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return (*[srgb_to_linear(c) for c in rgb], alpha)


def material(name, hex_color, roughness=0.65, metallic=0.0, emission=None, emission_strength=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = rgba(hex_color)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba(hex_color)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        glow = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        if glow and emission:
            glow.default_value = rgba(emission)
        strength = bsdf.inputs.get("Emission Strength")
        if strength and emission_strength:
            strength.default_value = emission_strength
    return mat


def smooth(obj):
    for polygon in obj.data.polygons:
        polygon.use_smooth = True


def bevel(obj, width=0.025, segments=2):
    modifier = obj.modifiers.new("Soft edges", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    modifier.angle_limit = math.radians(35)


def link_to(collection, obj):
    for col in list(obj.users_collection):
        col.objects.unlink(obj)
    collection.objects.link(obj)
    return obj


def empty(collection, name, parent, location=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.08
    collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    return obj


def primitive(collection, parent, name, kind, location, scale, rotation, mat, soft=True, bevel_width=0.0):
    if kind == "box":
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    elif kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=12, radius=1, location=(0, 0, 0))
    elif kind == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=1, depth=1, location=(0, 0, 0))
    elif kind == "cone":
        bpy.ops.mesh.primitive_cone_add(vertices=14, radius1=0, radius2=1, depth=1, location=(0, 0, 0))
    else:
        raise ValueError(kind)
    obj = bpy.context.object
    obj.name = name
    obj.data.name = name + "_Mesh"
    link_to(collection, obj)
    obj.parent = parent
    obj.location = location
    obj.scale = scale
    obj.rotation_euler = rotation
    if mat:
        obj.data.materials.append(mat)
    if soft:
        smooth(obj)
    if bevel_width:
        bevel(obj, bevel_width)
    return obj


def add_face(head, collection, prefix, skin, hair, style):
    p = f"{prefix}_"
    primitive(collection, head, p + "Face", "sphere", (0, -0.015, 0.14), (0.205, 0.185, 0.235), (0, 0, 0), skin)
    primitive(collection, head, p + "Nose", "cone", (0, -0.19, 0.12), (0.032, 0.032, 0.085), (math.pi / 2, 0, 0), skin, soft=False)
    for side, x in (("L", -0.072), ("R", 0.072)):
        primitive(collection, head, p + f"Eye_{side}", "sphere", (x, -0.174, 0.175), (0.024, 0.012, 0.02), (0, 0, 0), material(p + "Eye_White", "#f7f0e6", 0.35))
        primitive(collection, head, p + f"Pupil_{side}", "sphere", (x, -0.186, 0.177), (0.010, 0.007, 0.011), (0, 0, 0), material(p + "Pupil", "#15131c", 0.3))
    primitive(collection, head, p + "Mouth", "box", (0, -0.183, 0.055), (0.075, 0.012, 0.009), (0, 0, 0), material(p + "Lip", "#8f3f49", 0.6), bevel_width=0.005)
    for side, x in (("L", -0.205), ("R", 0.205)):
        primitive(collection, head, p + f"Ear_{side}", "sphere", (x, 0.0, 0.12), (0.04, 0.025, 0.065), (0, 0, 0), skin)

    if style == "long_hair":
        primitive(collection, head, p + "Hair_Back", "sphere", (0, 0.10, 0.11), (0.215, 0.16, 0.30), (0, 0, 0), hair)
        for side, x in (("L", -0.19), ("R", 0.19)):
            primitive(collection, head, p + f"Hair_Side_{side}", "sphere", (x, 0.035, -0.04), (0.055, 0.12, 0.25), (0, 0, 0), hair)
        primitive(collection, head, p + "Hair_Top", "sphere", (0, 0.015, 0.285), (0.215, 0.19, 0.105), (0, 0, 0), hair)
        primitive(collection, head, p + "Bindi", "sphere", (0, -0.187, 0.235), (0.018, 0.008, 0.018), (0, 0, 0), material(p + "Bindi", "#e63946", 0.35, emission="#ff344f", emission_strength=0.6))
    elif style == "cap":
        primitive(collection, head, p + "Hair_Top", "sphere", (0, 0.02, 0.265), (0.205, 0.18, 0.085), (0, 0, 0), hair)
        primitive(collection, head, p + "Cap_Crown", "sphere", (0, 0.0, 0.31), (0.225, 0.195, 0.12), (0, 0, 0), material(p + "Cap", "#16233d", 0.55))
        primitive(collection, head, p + "Cap_Brim", "box", (0, -0.18, 0.285), (0.23, 0.16, 0.025), (0, 0, 0), material(p + "Cap_Brim", "#0e182c", 0.55), bevel_width=0.012)
    elif style == "helmet":
        primitive(collection, head, p + "Helmet", "sphere", (0, 0.0, 0.19), (0.245, 0.225, 0.245), (0, 0, 0), material(p + "Helmet", "#ff9f1c", 0.35, 0.18))
        primitive(collection, head, p + "Visor", "box", (0, -0.205, 0.19), (0.18, 0.035, 0.075), (0, 0, 0), material(p + "Visor", "#071526", 0.12, 0.35), bevel_width=0.012)
        primitive(collection, head, p + "Helmet_Stripe", "box", (0, -0.01, 0.40), (0.05, 0.18, 0.012), (0, 0, 0), material(p + "Helmet_Accent", "#20e3b2", 0.4), bevel_width=0.006)
    elif style == "turban":
        primitive(collection, head, p + "Turban", "sphere", (0, 0.02, 0.28), (0.245, 0.215, 0.145), (0, 0, 0), material(p + "Turban", "#e07a5f", 0.75))
        primitive(collection, head, p + "Turban_Fold", "box", (0, -0.02, 0.365), (0.19, 0.16, 0.028), (0.2, 0, 0), material(p + "Turban_Fold", "#f2cc8f", 0.7), bevel_width=0.01)
    else:
        primitive(collection, head, p + "Hair_Top", "sphere", (0, 0.025, 0.27), (0.21, 0.19, 0.10), (0, 0, 0), hair)


def add_base(collection, prefix, cfg):
    p = f"{prefix}_"
    skin = material(p + "Skin", cfg["skin"], 0.72)
    hair = material(p + "Hair", cfg["hair"], 0.8)
    primary = material(p + "Body_Paint", cfg["primary"], 0.62)
    secondary = material(p + "Secondary", cfg["secondary"], 0.7)
    pants = material(p + "Pants", cfg["pants"], 0.78)
    shoe = material(p + "Shoe", cfg["shoe"], 0.55)
    accent = material(p + "Accent", cfg["accent"], 0.4, 0.15, emission=cfg["accent"], emission_strength=0.18)

    root = empty(collection, p + "Root", None, (0, 0, 0))
    primitive(collection, root, p + "Torso", "box", (0, 0, 1.10), (0.31, 0.19, 0.46), (0, 0, 0), primary, bevel_width=0.05)
    primitive(collection, root, p + "Chest_Panel", "box", (0, -0.196, 1.16), (0.19, 0.018, 0.30), (0, 0, 0), secondary, bevel_width=0.025)
    primitive(collection, root, p + "Waist", "box", (0, 0, 0.76), (0.27, 0.17, 0.12), (0, 0, 0), pants, bevel_width=0.03)
    primitive(collection, root, p + "Neck", "cylinder", (0, 0, 1.49), (0.085, 0.085, 0.12), (0, 0, 0), skin)
    primitive(collection, root, p + "Belt", "box", (0, -0.01, 0.82), (0.29, 0.185, 0.035), (0, 0, 0), material(p + "Belt", "#1b1722", 0.5), bevel_width=0.012)
    primitive(collection, root, p + "Belt_Buckle", "box", (0, -0.195, 0.82), (0.06, 0.012, 0.045), (0, 0, 0), accent, bevel_width=0.008)

    head = empty(collection, p + "Head", root, (0, 0, 1.52))
    add_face(head, collection, prefix, skin, hair, cfg["hair_style"])
    primitive(collection, head, p + "Neck_Guard", "cylinder", (0, 0, -0.02), (0.10, 0.10, 0.055), (0, 0, 0), secondary)

    arms = {}
    for side, x in (("L", -0.335), ("R", 0.335)):
        arm = empty(collection, p + f"Arm_{side}", root, (x, 0, 1.37))
        arms[side] = arm
        primitive(collection, arm, p + f"Sleeve_{side}", "cylinder", (0, 0, -0.20), (0.105, 0.105, 0.40), (0, 0, 0), primary, bevel_width=0.025)
        primitive(collection, arm, p + f"Forearm_{side}", "cylinder", (0, 0, -0.54), (0.082, 0.082, 0.36), (0, 0, 0), skin, bevel_width=0.02)
        primitive(collection, arm, p + f"Hand_{side}", "sphere", (0, -0.015, -0.755), (0.085, 0.07, 0.105), (0, 0, 0), skin)
        primitive(collection, arm, p + f"Wrist_{side}", "cylinder", (0, 0, -0.705), (0.09, 0.09, 0.055), (0, 0, 0), accent)

    legs = {}
    for side, x in (("L", -0.135), ("R", 0.135)):
        leg = empty(collection, p + f"Leg_{side}", root, (x, 0, 0.80))
        legs[side] = leg
        primitive(collection, leg, p + f"Thigh_{side}", "cylinder", (0, 0, -0.22), (0.125, 0.125, 0.44), (0, 0, 0), pants, bevel_width=0.025)
        primitive(collection, leg, p + f"Shin_{side}", "cylinder", (0, 0, -0.60), (0.105, 0.105, 0.38), (0, 0, 0), pants, bevel_width=0.02)
        primitive(collection, leg, p + f"Shoe_{side}", "box", (0, -0.075, -0.81), (0.13, 0.22, 0.10), (0, 0, 0), shoe, bevel_width=0.035)
        primitive(collection, leg, p + f"Shoe_Accent_{side}", "box", (0, -0.075, -0.755), (0.115, 0.205, 0.018), (0, 0, 0), accent, bevel_width=0.01)

    return {"root": root, "head": head, "arms": arms, "legs": legs, "materials": {
        "skin": skin, "hair": hair, "primary": primary, "secondary": secondary,
        "pants": pants, "shoe": shoe, "accent": accent,
    }}


def add_style(collection, prefix, cfg, parts):
    p = f"{prefix}_"
    m = parts["materials"]
    style = cfg["style"]

    if style == "rider":
        primitive(collection, parts["root"], p + "Jacket_Collar", "box", (0, -0.02, 1.39), (0.33, 0.205, 0.075), (0, 0, 0), m["secondary"], bevel_width=0.03)
        primitive(collection, parts["root"], p + "Cross_Strap", "box", (0, -0.205, 1.12), (0.065, 0.018, 0.68), (0, 0, 0.55), m["accent"], bevel_width=0.012)
        primitive(collection, parts["root"], p + "Backpack", "box", (0, 0.205, 1.12), (0.24, 0.10, 0.38), (0, 0, 0), m["secondary"], bevel_width=0.04)
        for side in ("L", "R"):
            primitive(collection, parts["arms"][side], p + f"Elbow_Pad_{side}", "sphere", (0, 0, -0.40), (0.115, 0.105, 0.08), (0, 0, 0), m["secondary"])
    elif style == "kurta":
        primitive(collection, parts["root"], p + "Kurta_Hem", "box", (0, 0, 0.64), (0.36, 0.22, 0.18), (0, 0, 0), m["primary"], bevel_width=0.035)
        primitive(collection, parts["root"], p + "Dupatta", "box", (0.10, -0.215, 1.05), (0.18, 0.025, 0.78), (0, 0, -0.18), m["secondary"], bevel_width=0.025)
        primitive(collection, parts["root"], p + "Neck_Scarf", "box", (0, -0.205, 1.40), (0.26, 0.03, 0.10), (0, 0, 0), m["accent"], bevel_width=0.02)
        for side in ("L", "R"):
            primitive(collection, parts["arms"][side], p + f"Bangle_{side}", "cylinder", (0, 0, -0.66), (0.095, 0.095, 0.025), (0, 0, 0), m["accent"])
    elif style == "constable":
        vest = material(p + "Reflective_Vest", "#d8ffef", 0.35, 0.05, emission="#8effd7", emission_strength=0.35)
        primitive(collection, parts["root"], p + "Vest", "box", (0, -0.205, 1.14), (0.30, 0.035, 0.42), (0, 0, 0), vest, bevel_width=0.025)
        for z in (0.98, 1.18, 1.38):
            primitive(collection, parts["root"], p + f"Vest_Strip_{int(z*100)}", "box", (0, -0.228, z), (0.31, 0.012, 0.035), (0, 0, 0), m["accent"], bevel_width=0.008)
        primitive(collection, parts["root"], p + "Shoulder_Tab", "box", (0, -0.02, 1.43), (0.36, 0.22, 0.045), (0, 0, 0), m["secondary"], bevel_width=0.018)
        primitive(collection, parts["arms"]["R"], p + "Baton", "cylinder", (0, -0.05, -0.95), (0.025, 0.025, 0.50), (0, 0, 0), m["shoe"], bevel_width=0.01)
        primitive(collection, parts["arms"]["R"], p + "Baton_Tip", "sphere", (0, -0.05, -1.20), (0.032, 0.032, 0.032), (0, 0, 0), m["accent"])
    elif style == "chaiwala":
        apron = material(p + "Apron", "#f7ede2", 0.82)
        primitive(collection, parts["root"], p + "Apron", "box", (0, -0.205, 0.96), (0.28, 0.025, 0.48), (0, 0, 0), apron, bevel_width=0.02)
        primitive(collection, parts["root"], p + "Apron_Logo", "sphere", (0, -0.222, 1.08), (0.085, 0.012, 0.085), (0, 0, 0), m["accent"])
        primitive(collection, parts["arms"]["R"], p + "Kettle_Body", "sphere", (0, -0.10, -0.88), (0.13, 0.13, 0.15), (0, 0, 0), material(p + "Kettle", "#b8c4d6", 0.28, 0.55))
        primitive(collection, parts["arms"]["R"], p + "Kettle_Spout", "cylinder", (0.12, -0.10, -0.85), (0.025, 0.025, 0.22), (0, math.pi / 2, 0.4), material(p + "Kettle", "#b8c4d6", 0.28, 0.55))
        primitive(collection, parts["arms"]["R"], p + "Kettle_Handle", "cylinder", (0, -0.10, -0.71), (0.095, 0.095, 0.025), (math.pi / 2, 0, 0), m["shoe"])
        primitive(collection, parts["head"], p + "Mustache", "box", (0, -0.188, 0.075), (0.11, 0.018, 0.022), (0, 0, 0), m["hair"], bevel_width=0.008)
    elif style == "pedestrian":
        raincoat = material(p + "Raincoat", "#2ec4b6", 0.38, 0.05)
        primitive(collection, parts["root"], p + "Raincoat_Hem", "box", (0, 0, 0.66), (0.37, 0.23, 0.24), (0, 0, 0), raincoat, bevel_width=0.04)
        primitive(collection, parts["root"], p + "Hood", "sphere", (0, 0.08, 1.48), (0.25, 0.22, 0.18), (0, 0, 0), raincoat)
        umbrella = empty(collection, p + "Umbrella", parts["arms"]["R"], (0.12, -0.12, -0.70))
        primitive(collection, umbrella, p + "Umbrella_Handle", "cylinder", (0, 0, 0.35), (0.018, 0.018, 0.70), (0, 0, 0), m["shoe"], bevel_width=0.005)
        primitive(collection, umbrella, p + "Umbrella_Canopy", "cone", (0, 0, 0.78), (0.72, 0.72, 0.26), (0, 0, 0), material(p + "Umbrella", "#ff6b6b", 0.6), bevel_width=0.01)
        primitive(collection, umbrella, p + "Umbrella_Tip", "cone", (0, 0, 0.94), (0.035, 0.035, 0.12), (0, 0, 0), m["accent"], soft=False)
        primitive(collection, parts["arms"]["L"], p + "Shopping_Bag", "box", (0, -0.05, -0.92), (0.20, 0.10, 0.26), (0, 0, 0), material(p + "Bag", "#f2cc8f", 0.8), bevel_width=0.015)
        primitive(collection, parts["arms"]["L"], p + "Bag_Handle", "cylinder", (0, -0.05, -0.77), (0.075, 0.075, 0.018), (math.pi / 2, 0, 0), m["secondary"])


CONFIGS = [
    {
        "key": "ayaan", "prefix": "Ayaan", "style": "rider", "hair_style": "helmet",
        "skin": "#c98d63", "hair": "#17131d", "primary": "#ff9f1c", "secondary": "#1b2a44",
        "pants": "#2b3a5c", "shoe": "#121722", "accent": "#20e3b2",
        "label": "Ayaan · street racer",
    },
    {
        "key": "meera", "prefix": "Meera", "style": "kurta", "hair_style": "long_hair",
        "skin": "#d9a176", "hair": "#211622", "primary": "#20e3b2", "secondary": "#7b61ff",
        "pants": "#e9d8c3", "shoe": "#3a2b3f", "accent": "#ffd166",
        "label": "Meera · monsoon courier",
    },
    {
        "key": "constable", "prefix": "Constable", "style": "constable", "hair_style": "cap",
        "skin": "#b97a52", "hair": "#1a1620", "primary": "#dce8ff", "secondary": "#16233d",
        "pants": "#1b2740", "shoe": "#0e121c", "accent": "#d8ff54",
        "label": "Constable Rao · traffic cop",
    },
    {
        "key": "chaiwala", "prefix": "Chaiwala", "style": "chaiwala", "hair_style": "turban",
        "skin": "#a96745", "hair": "#2b1c1a", "primary": "#e07a5f", "secondary": "#6d4c3d",
        "pants": "#3d3a35", "shoe": "#171512", "accent": "#ffd166",
        "label": "Chaiwala · stall owner",
    },
    {
        "key": "pedestrian", "prefix": "Pedestrian", "style": "pedestrian", "hair_style": "short",
        "skin": "#d19a70", "hair": "#241b2a", "primary": "#2ec4b6", "secondary": "#1b3a4b",
        "pants": "#34495e", "shoe": "#111827", "accent": "#ff6b6b",
        "label": "Pedestrian · rainy commute",
    },
]


def build_character(cfg):
    collection = bpy.data.collections.new(cfg["prefix"])
    scene.collection.children.link(collection)
    parts = add_base(collection, cfg["prefix"], cfg)
    add_style(collection, cfg["prefix"], cfg, parts)
    return collection, parts["root"]


def export_collection(collection, root, filename):
    layer = bpy.context.view_layer.layer_collection.children.get(collection.name)
    if layer:
        bpy.context.view_layer.active_layer_collection = layer
    bpy.ops.object.select_all(action="DESELECT")
    for obj in collection.all_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.context.view_layer.update()
    filepath = str(ASSET_DIR / filename)
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_extras=False,
        export_normals=True,
        export_texcoords=True,
        export_draco_mesh_compression_enable=False,
    )
    print(f"exported {filename}: {len(collection.all_objects)} objects")


def main():
    for cfg in CONFIGS:
        collection, root = build_character(cfg)
        export_collection(collection, root, f"char_{cfg['key']}.glb")

    # Add a simple editing camera/light so the .blend opens nicely in Blender.
    camera_data = bpy.data.cameras.new("Preview Camera")
    camera = bpy.data.objects.new("Preview Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = (5.2, -7.5, 3.3)
    camera.rotation_euler = (math.radians(72), 0, math.radians(35))
    camera_data.lens = 50
    scene.camera = camera

    light_data = bpy.data.lights.new("Preview Key", "AREA")
    light = bpy.data.objects.new("Preview Key", light_data)
    scene.collection.objects.link(light)
    light.location = (4, -5, 7)
    light_data.energy = 850
    light_data.shape = "DISK"
    light_data.size = 5

    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    print(f"saved {BLEND_PATH}")


if __name__ == "__main__":
    main()
