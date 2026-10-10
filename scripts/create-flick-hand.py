"""Author one closed cartoon fist/index surface through Blender MCP. Game Y up/Z forward."""
import bpy, bmesh, math, json
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
ROOT=Path('F:/workproject/FlickChain')
OUT=ROOT/'public/models'
OUT.mkdir(parents=True,exist_ok=True)
scene=bpy.data.scenes.get('FlickChain_Hand_Studio') or bpy.data.scenes.new('FlickChain_Hand_Studio')
bpy.context.window.scene=scene
if bpy.context.object and bpy.context.object.mode!='OBJECT': bpy.ops.object.mode_set(mode='OBJECT')
old=bpy.data.collections.get('FlickHand_Asset')
if old:
    for obj in list(old.objects):
        data=obj.data
        bpy.data.objects.remove(obj,do_unlink=True)
        if data and data.users==0:
            if isinstance(data,bpy.types.Mesh): bpy.data.meshes.remove(data)
            elif isinstance(data,bpy.types.Armature): bpy.data.armatures.remove(data)
    bpy.data.collections.remove(old)
    for action in list(bpy.data.actions):
        if action.get('flickchain_authored') and action.users<=1: bpy.data.actions.remove(action)
collection=bpy.data.collections.new('FlickHand_Asset')
scene.collection.children.link(collection)
scene.unit_settings.system='METRIC'
scene.render.fps=24
scene.frame_start,scene.frame_end=0,24
def co(p): return Vector((p[0],-p[2],p[1]))
def active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
def material(name,rgb,roughness=.85):
    mat=bpy.data.materials.new(name); mat.use_nodes=True
    node=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    node.inputs['Base Color'].default_value=(*rgb,1)
    node.inputs['Roughness'].default_value=roughness
    mat.diffuse_color=(*rgb,1)
    return mat
skin=material('Hand_Peach',(.50,.245,.115))
nail=material('Hand_Nail',(.96,.77,.55),.6)
crease=material('Hand_Knuckle_Lines',(.14,.06,.03))
cuffmat=material('Hand_Cuff',(.34,.56,.48))
sleevemat=material('Hand_Sleeve',(.075,.255,.245))
def normals(mesh):
    bm=bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    if bm.calc_volume(signed=True)<0: bmesh.ops.reverse_faces(bm,faces=list(bm.faces))
    bm.to_mesh(mesh); bm.free(); mesh.update()
def mesh_object(name,verts,faces,mat):
    mesh=bpy.data.meshes.new(name+'_Mesh')
    mesh.from_pydata([co(v) for v in verts],[],faces); normals(mesh)
    obj=bpy.data.objects.new(name,mesh); collection.objects.link(obj)
    mesh.materials.append(mat); return obj
def ellipsoid(name,centre,radii,mat):
    bm=bmesh.new()
    bmesh.ops.create_uvsphere(bm,u_segments=24,v_segments=16,radius=1)
    for v in bm.verts: v.co=co(tuple(centre[i]+v.co[i]*radii[i] for i in range(3)))
    mesh=bpy.data.meshes.new(name+'_Mesh'); bm.to_mesh(mesh); bm.free(); normals(mesh)
    obj=bpy.data.objects.new(name,mesh); collection.objects.link(obj); mesh.materials.append(mat)
    return obj
def loft(name,rings,mat,sides=16):
    verts=[(x+w*math.cos(math.tau*i/sides),y+h*math.sin(math.tau*i/sides),z)
        for z,x,y,w,h in rings for i in range(sides)]
    faces=[tuple(reversed(range(sides)))]
    for r in range(len(rings)-1):
        for i in range(sides):
            a,b=r*sides+i,r*sides+(i+1)%sides
            faces.append((a,b,b+sides,a+sides))
    faces.append(tuple(range((len(rings)-1)*sides,len(rings)*sides)))
    return mesh_object(name,verts,faces,mat)
# All flesh parts overlap and are remeshed into ONE closed connected skin before binding.
palm=ellipsoid('hand_skin',(.035,.029,-.035),(.053,.026,.052),skin)
parts=[palm,ellipsoid('wrist_form',(.032,.025,-.078),(.029,.022,.035),skin)]
for i,x in enumerate([.023,.050,.075]):
    parts.append(ellipsoid('folded_digit_'+str(i),(x,.033,.008-i*.004),
        (.018,.022-i*.001,.023-i*.002),skin))
parts += [ellipsoid('thumb_base',(.081,.027,-.041),(.027,.023,.030),skin),
    ellipsoid('thumb_fold',(.076,.034,-.012),(.026,.020,.024),skin)]
profile=[(-.032,.018),(-.018,.0185),(0,.017),(.018,.016),(.036,.015),
    (.048,.0145),(.062,.014),(.078,.013),(.092,.012),(.100,.009),(.106,.001)]
rings=[]
for i in range(len(profile)-1):
    a,ra=profile[i]; b,rb=profile[i+1]; count=max(1,math.ceil((b-a)/.004))
    for j in range(count):
        t=j/count; z=a+(b-a)*t; r=ra+(rb-ra)*t
        rings.append((z,0,.025,r,r*.9))
rings.append((.106,0,.025,.001,.001))
parts.append(loft('index_form',rings,skin,20))
bpy.ops.object.select_all(action='DESELECT')
for obj in parts: obj.select_set(True)
bpy.context.view_layer.objects.active=palm; bpy.ops.object.join()
union=palm.modifiers.new('Continuous_Hand_Union','REMESH')
union.mode='VOXEL'; union.voxel_size=.0018; union.use_smooth_shade=True
bpy.ops.object.modifier_apply(modifier=union.name)
relax=palm.modifiers.new('Round_Cartoon_Silhouette','SMOOTH')
relax.factor=.7; relax.iterations=5
bpy.ops.object.modifier_apply(modifier=relax.name)
reduce=palm.modifiers.new('Low_Poly_Surface','DECIMATE'); reduce.ratio=.22
bpy.ops.object.modifier_apply(modifier=reduce.name); normals(palm.data)
for poly in palm.data.polygons: poly.use_smooth=True
surface=BVHTree.FromPolygons([v.co for v in palm.data.vertices],[tuple(p.vertices) for p in palm.data.polygons])
def surface_strip(name,x,z,width,depth,mat):
    verts=[]
    for j in range(9):
        u=(j-4)/4
        for k in [-1,1]:
            hit,normal,_,_=surface.ray_cast(co((x+u*width,1,z+.005*(1-u*u)+k*depth)),Vector((0,0,-1)))
            if hit is None: raise RuntimeError('Detail misses hand surface')
            verts.append((hit.x,hit.z+.00015,-hit.y))
    return mesh_object(name,verts,[(2*j,2*j+1,2*j+3,2*j+2) for j in range(8)],mat)
creases=[surface_strip('knuckle_crease_'+str(i),x,.006-i*.004,.009,.00055,crease)
    for i,x in enumerate([.023,.050,.075])]
index_nail=loft('index_nail',[(.083,0,.037,.003,.0005),(.087,0,.038,.006,.0008),
    (.096,0,.0357,.0055,.0007),(.100,0,.0337,.002,.0004)],nail,12)
cuff=loft('cuff',[(-.111,.032,.025,.029,.022),(-.104,.032,.025,.031,.023),
    (-.094,.032,.025,.031,.023),(-.091,.032,.025,.028,.021)],cuffmat)
sleeve=loft('sleeve',[(-.151,.032,.025,.028,.022),(-.145,.032,.025,.032,.0225),
    (-.110,.032,.025,.032,.0225),(-.105,.032,.025,.029,.022)],sleevemat)
for obj in [cuff,sleeve,index_nail]:
    for poly in obj.data.polygons: poly.use_smooth=True
arm_data=bpy.data.armatures.new('FlickHand_Bones')
arm=bpy.data.objects.new('FlickHand_Rig',arm_data); collection.objects.link(arm); active(arm)
bpy.ops.object.mode_set(mode='EDIT')
# Auxiliary index joints spread the curve over short segments, avoiding LBS hinge collapse.
joint_z=[0,.010,.020,.030,.040,.048,.058,.068,.078,.087,.096,.106]
joint_names=['index_mcp','index_curve_01','index_curve_02','index_curve_03','index_curve_04',
    'index_pip','index_curve_06','index_curve_07','index_dip','index_curve_09','index_curve_10']
bone_points={'hand_root':((.032,.025,-.094),(.032,.025,-.062))}
for i,name in enumerate(joint_names):
    bone_points[name]=((0,.025,joint_z[i]),(0,.025,joint_z[i+1]))
for name,(head,tail) in bone_points.items():
    bone=arm_data.edit_bones.new(name); bone.head,bone.tail=co(head),co(tail)
    bone.align_roll(Vector((0,0,1)))
    if name!='hand_root':
        i=joint_names.index(name)
        bone.parent=arm_data.edit_bones['hand_root' if i==0 else joint_names[i-1]]
        bone.use_connect=i>0
bpy.ops.object.mode_set(mode='OBJECT'); arm.show_in_front=True
def smooth(a,b,x):
    t=max(0,min(1,(x-a)/(b-a))); return t*t*(3-2*t)
def bind(obj,fixed=None):
    obj.parent=arm; mod=obj.modifiers.new('FlickHand_Skin','ARMATURE'); mod.object=arm
    groups={name:obj.vertex_groups.new(name=name) for name in bone_points}
    for v in obj.data.vertices:
        x,z=v.co.x,-v.co.y
        if fixed: weights={fixed:1}
        else:
            branch=smooth(-.024,.014,z)*(1-smooth(.010,.028,x))
            if z>.035: branch=1
            # Blend around each short segment's midpoint. A distributed small-angle
            # bone chain preserves the thick rounded finger at maximum charge.
            centres=[(joint_z[i]+joint_z[i+1])/2 for i in range(len(joint_names))]
            weights={'hand_root':1-branch}
            if z<=centres[0]: weights[joint_names[0]]=branch
            elif z>=centres[-1]: weights[joint_names[-1]]=branch
            else:
                for i in range(len(centres)-1):
                    if centres[i]<=z<centres[i+1]:
                        t=(z-centres[i])/(centres[i+1]-centres[i])
                        weights[joint_names[i]]=branch*(1-t)
                        weights[joint_names[i+1]]=branch*t
                        break
        for name,w in weights.items():
            if w>1e-7: groups[name].add([v.index],w,'REPLACE')
bind(palm)
for obj in [cuff,sleeve,*creases]: bind(obj,'hand_root')
bind(index_nail)
axis_z=[-.010,0,.024,.048,.063,.078,.092,.106]
axis_bones=[joint_names[max(0,min(len(joint_names)-1,next((i-1 for i,j in enumerate(joint_z) if j>z),len(joint_names)-1)))] for z in axis_z]
for i,(z,bone_name) in enumerate(zip(axis_z,axis_bones)):
    marker=bpy.data.objects.new(f'hit_axis_{i:02}',None); collection.objects.link(marker)
    marker.empty_display_type='SPHERE'; marker.empty_display_size=.0015
    marker.parent,marker.parent_type,marker.parent_bone=arm,'BONE',bone_name
    bone=arm_data.bones[bone_name]
    marker.matrix_parent_inverse=(arm.matrix_world@bone.matrix_local@Matrix.Translation((0,bone.length,0))).inverted()
    marker.location=co((0,.025,z))
orientations=[.15,.46,.79,.97,.95,.70,.28,-.20,-.65,-1.05,-1.36]
angles={name:orientations[i]-(orientations[i-1] if i else 0) for i,name in enumerate(joint_names)}
for frame in range(25):
    t=frame/24; curl=t*t*(3-2*t)
    for name,angle in angles.items():
        pose=arm.pose.bones[name]; pose.rotation_mode='XYZ'; pose.rotation_euler=(angle*curl,0,0)
        pose.keyframe_insert(data_path='rotation_euler',frame=frame,group=name)
arm.animation_data.action.name='FlickCharge'
arm.animation_data.action.use_fake_user=True
arm.animation_data.action['flickchain_authored']=True
bm=bmesh.new(); bm.from_mesh(palm.data); unseen=set(bm.verts); components=0
while unseen:
    components+=1; stack=[unseen.pop()]
    while stack:
        for edge in stack.pop().link_edges:
            for vertex in edge.verts:
                if vertex in unseen: unseen.remove(vertex); stack.append(vertex)
topology={'components':components,'boundary_edges':sum(e.is_boundary for e in bm.edges),
    'non_manifold_edges':sum(not e.is_manifold for e in bm.edges),'signed_volume':bm.calc_volume(signed=True)}
bm.free()
assert components==1 and topology['non_manifold_edges']==0 and topology['signed_volume']>0,topology
pose_min_y=[]
for frame in range(25):
    scene.frame_set(frame); deps=bpy.context.evaluated_depsgraph_get()
    evaluated=palm.evaluated_get(deps); mesh=evaluated.to_mesh()
    pose_min_y.append(min(v.co.z for v in mesh.vertices)); evaluated.to_mesh_clear()
assert min(pose_min_y)>.001,pose_min_y
scene.frame_set(0)
scene['asset_contract']='One closed hand_skin; metres; glTF Y up/Z forward; FlickCharge 0..1s'
scene['pose_note']='Fist fixed; index root weight blend; index joint articulation; tremor belongs to game'
bpy.ops.object.select_all(action='DESELECT')
for obj in collection.objects: obj.select_set(True)
bpy.context.view_layer.objects.active=arm
params=dict(filepath=str(OUT/'flick-hand.glb'),export_format='GLB',use_selection=True,
    export_animations=True,export_skins=True,export_yup=True,export_force_sampling=True,export_frame_range=True)
if 'export_animation_mode' in bpy.ops.export_scene.gltf.get_rna_type().properties.keys():
    params['export_animation_mode']='ACTIONS'
bpy.ops.export_scene.gltf(**params)
bpy.data.libraries.write(str(ROOT/'assets/flick-hand.blend'),{scene},fake_user=True)
summary={'blender':bpy.app.version_string,'scene':scene.name,'bones':list(bone_points),'clip':'FlickCharge',
    'frames':[0,24],'topology':topology,'pose_min_y':pose_min_y,
    'meshes':{o.name:{'vertices':len(o.data.vertices),'faces':len(o.data.polygons)}
        for o in collection.objects if o.type=='MESH'},'glb_bytes':(OUT/'flick-hand.glb').stat().st_size}
(ROOT/'assets/flick-hand-authoring.json').write_text(json.dumps(summary,indent=2))
print(json.dumps(summary))
