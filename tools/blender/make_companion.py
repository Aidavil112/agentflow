#!/usr/bin/env python3
"""Generate SATHI-1, an original Blender-authored AI co-pilot for Monsoon Drift.

This model is NOT a copy of Andee / kuafuai/andee. That repository was reviewed
only as a conceptual reference for a friendly on-device agent companion. Andee is
Apache-2.0 with additional conditions: embedding its software/derivatives in
another product needs written authorisation (A.1(d)), and its name/logo/product
identity are not licensed (A.3). No Andee source, image, logo, trademark or
exact horned blue-head character design is used here.

SATHI-1 is deliberately different: a hovering teal/orange service drone with a
single horizontal visor, three status bars, one antenna, two side rotors and a
lower holo ring. Its tintable material is named ``Sathi_Body_Paint``.

Run headlessly with the bpy module:

    PYTHONPATH=/tmp/bpy LD_LIBRARY_PATH=/tmp/stubs:/tmp/bpy/bpy/lib \
      python3 tools/blender/make_companion.py

Outputs:
    tools/blender/monsoon_companion.blend
    public/assets/ai_companion.glb

Set ``SATHI_RENDER=1`` to also attempt a Workbench still at
``public/assets/ai_companion_preview.png``. Headless sandboxes without real
EGL/GL usually cannot render, so the still is optional.

The front of the model faces Blender -Y, which becomes Three.js +Z after the
glTF Y-up export. Pivot empties named Sathi_Head, Sathi_Rotor_L,
Sathi_Rotor_R and Sathi_Halo are kept for runtime hover / scan animation.
"""

import math
import os
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[2]
ASSET_DIR = ROOT / "public" / "assets"
BLEND_PATH = ROOT / "tools" / "blender" / "monsoon_companion.blend"
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


def material(name, hex_color, roughness=0.5, metallic=0.0, emission=None, emission_strength=0.0):
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


def bevel(obj, width=0.02, segments=2):
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


def primitive(collection, parent, name, kind, location, scale, rotation, mat, soft=True, bevel_width=0.0, **kwargs):
    if kind == "box":
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    elif kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=kwargs.get("segments", 24), ring_count=kwargs.get("rings", 16), radius=1, location=(0, 0, 0))
    elif kind == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(vertices=kwargs.get("vertices", 20), radius=1, depth=1, location=(0, 0, 0))
    elif kind == "cone":
        bpy.ops.mesh.primitive_cone_add(vertices=kwargs.get("vertices", 20), radius1=0, radius2=1, depth=1, location=(0, 0, 0))
    elif kind == "torus":
        bpy.ops.mesh.primitive_torus_add(
            major_radius=kwargs.get("major_radius", 0.28),
            minor_radius=kwargs.get("minor_radius", 0.025),
            major_segments=kwargs.get("major_segments", 32),
            minor_segments=kwargs.get("minor_segments", 8),
            location=(0, 0, 0),
        )
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


def build_companion():
    collection = bpy.data.collections.new("Sathi_1_AI_CoPilot")
    scene.collection.children.link(collection)

    # Tintable shell + distinct non-Andee palette.
    body = material("Sathi_Body_Paint", "#20e3b2", 0.34, 0.32)
    shell = material("Sathi_Shell", "#12213c", 0.4, 0.58)
    dark = material("Sathi_Dark", "#070d1c", 0.52, 0.38)
    visor = material("Sathi_Visor", "#071a2b", 0.16, 0.42, emission="#38f7ff", emission_strength=1.5)
    glow = material("Sathi_Glow", "#d9fff6", 0.24, 0.1, emission="#8effd7", emission_strength=2.2)
    accent = material("Sathi_Accent", "#ff9f1c", 0.34, 0.2, emission="#ffb347", emission_strength=1.0)
    saffron = material("Sathi_India_Saffron", "#ff9933", 0.4, 0.1, emission="#ff9933", emission_strength=0.55)
    white = material("Sathi_India_White", "#f7f3e8", 0.5, 0.05, emission="#fff6da", emission_strength=0.35)
    green = material("Sathi_India_Green", "#138808", 0.45, 0.1, emission="#4fd267", emission_strength=0.55)

    root = empty(collection, "Sathi_Root", None, (0, 0, 0))

    # Floating core: a flattened faceted-looking shell, not a round blue head.
    head = empty(collection, "Sathi_Head", root, (0, 0, 0.72))
    primitive(collection, head, "Sathi_Core_Shell", "sphere", (0, 0, 0), (0.56, 0.46, 0.58), (0, 0, 0), body)
    primitive(collection, head, "Sathi_Back_Plate", "sphere", (0, 0.34, 0.02), (0.48, 0.18, 0.48), (0, 0, 0), shell)
    primitive(collection, head, "Sathi_Visor", "box", (0, -0.455, 0.08), (0.74, 0.075, 0.20), (0, 0, 0), visor, bevel_width=0.035)
    primitive(collection, head, "Sathi_Visor_Bar", "box", (0, -0.505, 0.08), (0.58, 0.018, 0.045), (0, 0, 0), glow, bevel_width=0.012)
    for index, x in enumerate((-0.20, 0, 0.20), start=1):
        primitive(collection, head, f"Sathi_Status_{index}", "box", (x, -0.505, -0.12), (0.09, 0.02, 0.035), (0, 0, 0), (saffron, white, green)[index - 1], bevel_width=0.008)

    # Single antenna with a glowing tip; no horns / ears.
    primitive(collection, head, "Sathi_Antenna_Stem", "cylinder", (0, 0.02, 0.60), (0.028, 0.028, 0.34), (0, 0, 0), dark)
    primitive(collection, head, "Sathi_Antenna_Tip", "sphere", (0, 0.02, 0.80), (0.065, 0.065, 0.065), (0, 0, 0), accent)
    primitive(collection, head, "Sathi_Antenna_Ring", "torus", (0, 0.02, 0.70), (1, 1, 1), (0, 0, 0), glow, major_radius=0.10, minor_radius=0.012)

    # Side service rotors, visibly mechanical rather than facial features.
    rotors = {}
    for side, x in (("L", -0.62), ("R", 0.62)):
        pivot = empty(collection, f"Sathi_Rotor_{side}", root, (x, 0.0, 0.70))
        rotors[side] = pivot
        primitive(collection, pivot, f"Sathi_Rotor_Hub_{side}", "cylinder", (0, 0, 0), (0.11, 0.15, 0.11), (math.pi / 2, 0, 0), shell)
        primitive(collection, pivot, f"Sathi_Rotor_Ring_{side}", "torus", (0, -0.015, 0), (1, 1, 1), (math.pi / 2, 0, 0), body, major_radius=0.21, minor_radius=0.028)
        primitive(collection, pivot, f"Sathi_Rotor_Core_{side}", "sphere", (0, -0.03, 0), (0.075, 0.045, 0.075), (0, 0, 0), glow)
        primitive(collection, pivot, f"Sathi_Rotor_Guard_{side}", "box", (0, 0.08, 0), (0.30, 0.035, 0.18), (0, 0, 0), shell, bevel_width=0.02)

    # Lower thruster and holographic hover ring.
    primitive(collection, root, "Sathi_Thruster", "cone", (0, 0.04, 0.24), (0.24, 0.24, 0.34), (math.pi, 0, 0), shell)
    primitive(collection, root, "Sathi_Thruster_Glow", "sphere", (0, 0.04, 0.09), (0.16, 0.16, 0.075), (0, 0, 0), glow)
    halo = empty(collection, "Sathi_Halo", root, (0, 0, 0.02))
    primitive(collection, halo, "Sathi_Halo_Ring", "torus", (0, 0, 0), (1, 1, 1), (0, 0, 0), visor, major_radius=0.36, minor_radius=0.022, major_segments=40)
    for index, angle in enumerate((0, math.pi / 2, math.pi, 3 * math.pi / 2), start=1):
        x = math.cos(angle) * 0.36
        y = math.sin(angle) * 0.36
        primitive(collection, halo, f"Sathi_Halo_Node_{index}", "sphere", (x, y, 0), (0.045, 0.045, 0.045), (0, 0, 0), accent)

    return collection, root


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


def add_editing_camera_and_light():
    camera_data = bpy.data.cameras.new("Sathi Preview Camera")
    camera = bpy.data.objects.new("Sathi Preview Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = (2.5, -4.8, 2.6)
    camera.rotation_euler = (math.radians(68), 0, math.radians(28))
    camera_data.lens = 48
    scene.camera = camera

    light_data = bpy.data.lights.new("Sathi Key", "AREA")
    light = bpy.data.objects.new("Sathi Key", light_data)
    scene.collection.objects.link(light)
    light.location = (3, -4, 5)
    light_data.energy = 900
    light_data.shape = "DISK"
    light_data.size = 4


def render_preview_still():
    """Optional Workbench still; requires real EGL/GL, unlike the bpy stubs."""
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.render.resolution_x = 800
    scene.render.resolution_y = 600
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(ASSET_DIR / "ai_companion_preview.png")
    bpy.ops.render.render(write_still=True)
    print(f"rendered {ASSET_DIR / 'ai_companion_preview.png'}")


def main():
    collection, root = build_companion()
    export_collection(collection, root, "ai_companion.glb")
    add_editing_camera_and_light()
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    print(f"saved {BLEND_PATH}")
    if os.environ.get("SATHI_RENDER") == "1":
        render_preview_still()


if __name__ == "__main__":
    main()
