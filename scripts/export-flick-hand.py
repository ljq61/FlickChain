"""Re-export the task's asset collection, leaving the original scene untouched."""
import bpy
from pathlib import Path
ROOT = Path('F:/workproject/FlickChain')
scene = bpy.data.scenes['FlickChain_Hand_Studio']
bpy.context.window.scene = scene
scene.frame_set(0)
bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.data.collections['FlickHand_Asset'].objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = bpy.data.objects['FlickHand_Rig']
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/flick-hand.glb'),
    export_format='GLB',use_selection=True,export_animation_mode='ACTIONS',
    export_animations=True,export_skins=True,export_yup=True,
    export_force_sampling=True,export_frame_range=True)
bpy.data.libraries.write(str(ROOT/'assets/flick-hand.blend'), {scene}, fake_user=True)
print('Exported FlickCharge action and standalone source blend')
