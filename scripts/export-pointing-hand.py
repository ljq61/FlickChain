"""Export the user's current rig without modifying its bones, weights or source file.

Run in Blender's Python Console:
path = '/path/to/scripts/export-pointing-hand.py'
exec(compile(open(path).read(), path, 'exec'), {'__file__': path})
The source is blender/pointing-hand-rigged.blend; open it before running.
"""
import json
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'blender/pointing-hand-rigged.blend'
SCALE = 0.24
BONE_NAMES = {'Hand': 'hand_root', 'Index_01': 'index_mcp',
              'Index_02': 'index_pip', 'Index_03': 'index_dip'}
START, END, FPS = 12, 36, 30


def export_hand():
    if Path(bpy.data.filepath).resolve() != SOURCE.resolve():
        raise RuntimeError('Open blender/pointing-hand-rigged.blend before exporting')
    source_scene = bpy.context.scene
    source_rig = next(o for o in source_scene.objects if o.type == 'ARMATURE'
                      and all(n in o.data.bones for n in BONE_NAMES))
    source_mesh = next(o for o in source_scene.objects if o.type == 'MESH'
                       and any(m.type == 'ARMATURE' and m.object == source_rig for m in o.modifiers))
    frame, subframe = source_scene.frame_current, source_scene.frame_subframe
    selection, active = list(bpy.context.selected_objects), bpy.context.view_layer.objects.active
    scene = bpy.data.scenes.new('FlickChain_Artist_Hand')
    copies = []
    copied_mesh_data = copied_rig_data = copied_action = None
    try:
        # Sample the artist's complete bone poses, including their revised rest rig.
        samples = []
        for f in range(FPS + 1):
            source_frame = START + (END - START) * f / FPS
            source_scene.frame_set(int(source_frame), subframe=source_frame % 1)
            bpy.context.view_layer.update()
            samples.append({p.name: p.matrix_basis.copy() for p in source_rig.pose.bones})
        source_scene.frame_set(START)
        rig = source_rig.copy()
        rig.data = source_rig.data.copy()
        copied_rig_data = rig.data
        rig.animation_data_clear()
        rig.name = 'FlickHand_Rig'
        scene.collection.objects.link(rig)
        copies.append(rig)
        mesh = source_mesh.copy()
        mesh.data = source_mesh.data.copy()
        copied_mesh_data = mesh.data
        mesh.animation_data_clear()
        mesh.name = 'hand_skin'
        scene.collection.objects.link(mesh)
        copies.append(mesh)
        mesh.parent = rig
        mesh.matrix_parent_inverse = source_mesh.matrix_parent_inverse.copy()
        for mod in mesh.modifiers:
            if mod.type == 'ARMATURE':
                mod.object = rig
                # glTF/Three.js use linear skinning; keep the artist's source setting intact.
                mod.use_deform_preserve_volume = False
        for old, new in BONE_NAMES.items():
            rig.data.bones[old].name = new
            if old in mesh.vertex_groups:
                mesh.vertex_groups[old].name = new
        alignment = bpy.data.objects.new('GameHand_Alignment', None)
        scene.collection.objects.link(alignment)
        copies.append(alignment)
        # Blender (-X forward, +Z hand back) -> glTF (+Z forward, +Y hand back).
        # A proper 180-degree roll puts the palm/curl toward the tabletop.
        alignment.matrix_world = Matrix(((0,-SCALE,0,-0.16*SCALE),
                                         (SCALE,0,0,0), (0,0,SCALE,0), (0,0,0,1)))
        rig.parent = alignment
        rig.matrix_parent_inverse = Matrix.Identity(4)
        rig.matrix_basis = source_rig.matrix_world.copy()
        bpy.context.window.scene = scene
        scene.render.fps = FPS
        scene.frame_start, scene.frame_end = 0, FPS
        for f, sample in enumerate(samples):
            for old, matrix in sample.items():
                bone = rig.pose.bones[BONE_NAMES.get(old, old)]
                bone.rotation_mode = 'QUATERNION'
                bone.matrix_basis = matrix
                bone.keyframe_insert('location', frame=f, group=bone.name)
                bone.keyframe_insert('rotation_quaternion', frame=f, group=bone.name)
                bone.keyframe_insert('scale', frame=f, group=bone.name)
        copied_action = rig.animation_data.action
        copied_action.name = 'FlickCharge'
        # Floor clearance uses the actual linear-skinned export, across the entire charge.
        lowest = float('inf')
        for f in range(FPS + 1):
            scene.frame_set(f)
            deps = bpy.context.evaluated_depsgraph_get()
            evaluated = mesh.evaluated_get(deps)
            temp = evaluated.to_mesh()
            lowest = min(lowest, min((evaluated.matrix_world @ v.co).z for v in temp.vertices))
            evaluated.to_mesh_clear()
        alignment.location.z += 0.003 - lowest
        scene.frame_set(0)
        bpy.context.view_layer.update()
        # Axis samples follow the real joints but form a straight idle hit line.
        height = alignment.location.z - 0.03 * SCALE
        start_x = source_rig.data.bones['Index_01'].head_local.x
        tip_x = min(v.co.x for v in source_mesh.data.vertices)
        for i in range(8):
            source_x = start_x + (tip_x - start_x) * i / 7
            bone_name = 'index_mcp' if source_x >= source_rig.data.bones['Index_02'].head_local.x else (
                'index_pip' if source_x >= source_rig.data.bones['Index_03'].head_local.x else 'index_dip')
            marker = bpy.data.objects.new(f'hit_axis_{i:02d}', None)
            scene.collection.objects.link(marker)
            copies.append(marker)
            marker.parent, marker.parent_type, marker.parent_bone = rig, 'BONE', bone_name
            bpy.context.view_layer.update()
            parent_matrix = marker.matrix_world.copy()
            desired = Matrix.Translation(Vector((0, source_x * SCALE, height)))
            marker.matrix_parent_inverse = parent_matrix.inverted() @ desired
            marker.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()
        scene['source'] = str(SOURCE.relative_to(ROOT))
        scene['source_action'] = 'Index_Curl'
        scene['charge_source_frames'] = [START, END]
        bpy.ops.object.select_all(action='DESELECT')
        for obj in copies:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.export_scene.gltf(filepath=str(ROOT / 'public/models/flick-hand.glb'),
            export_format='GLB', use_selection=True, export_animation_mode='ACTIVE_ACTIONS',
            export_nla_strips_merged_animation_name='FlickCharge',
            export_animations=True, export_skins=True, export_yup=True,
            export_force_sampling=True, export_frame_range=True,
            export_extras=True)
        bpy.data.libraries.write(str(ROOT / 'assets/flick-hand.blend'), {scene}, fake_user=True)
        metadata = {'blender': bpy.app.version_string, 'source': str(SOURCE.relative_to(ROOT)),
                    'scene': scene.name, 'source_action': 'Index_Curl',
                    'source_frames': [START, END], 'clip': 'FlickCharge', 'frames': [0,FPS],
                    'fps': FPS, 'scale': SCALE, 'orientation': 'hand_back_up', 'idle_axis_height': height,
                    'table_clearance': 0.003, 'bones': [b.name for b in rig.data.bones],
                    'meshes': {'hand_skin': {'vertices': len(mesh.data.vertices), 'faces': len(mesh.data.polygons)}},
                    'glb_bytes': (ROOT / 'public/models/flick-hand.glb').stat().st_size}
        (ROOT / 'assets/flick-hand-authoring.json').write_text(json.dumps(metadata, indent=2) + '\n')
        print('ARTIST_HAND_EXPORT_OK', metadata)
    finally:
        bpy.context.window.scene = source_scene
        source_scene.frame_set(frame, subframe=subframe)
        for obj in copies:
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.scenes.remove(scene)
        if copied_action:
            bpy.data.actions.remove(copied_action)
        if copied_mesh_data:
            bpy.data.meshes.remove(copied_mesh_data)
        if copied_rig_data:
            bpy.data.armatures.remove(copied_rig_data)
        bpy.ops.object.select_all(action='DESELECT')
        for obj in selection:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = active


export_hand()
