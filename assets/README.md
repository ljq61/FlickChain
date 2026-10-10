# FlickChain 手模型

当前手模型（2026-10-11）来自用户调整过骨骼和蒙皮的 `../blender/pointing-hand-rigged.blend`，由 Blender 5.2.1 LTS 导出。`flick-hand.blend` 是游戏适配副本；`gold_coin.blend` 为原有独立资产。

- 游戏文件：[flick-hand.glb](../public/models/flick-hand.glb)，106380 bytes，自包含材质，无纹理外链或解码器依赖。SHA-256：`a5d027e6381b2c3ca303b06a86d249f42e06c3a619b1d707ed0f2cb5d6f7b028`。
- 网格：`hand_skin`，1647顶点、1857面（Blender导出副本）；保留用户原始权重、袖口开口及分部拓扑，旧封闭连续皮肤属于历史版本。
- 比例：导出基准比例0.24，运行时整手再乘0.8，为上一版游戏显示的80%；+Y向上、+Z食指朝前，手背朝上、手心朝桌面。导出待机点击轴高度约0.05778m、目标桌面净空0.003m；游戏中相应轴高约0.04622m、净空约0.0024m，逐帧回归保证净空大于0.0019m。
- 骨骼：`Hand` 在导出副本映射为 `hand_root`，三节食指映射为 `index_mcp/index_pip/index_dip`；Thumb及原有附属骨保留，源骨骼共8根，GLB另含导出器生成的中性骨，共9个joint。源文件骨骼和蒙皮不被导出脚本改写。
- 动作：源 `Index_Curl` 的12–36帧采样为 `FlickCharge`，0–30帧、30fps、1秒；游戏按蓄力比例采样，取消时回到0，不播放原动作的等待和回正段。
- 命中：`hit_axis_00..07` 是跟随骨骼的8个轴点；整手点击点由真实变形表面采样。手模型无物理碰撞体。
- 材质与抖动：运行时统一暖肤色、非金属、柔和高光；高蓄力微抖只作用于外层节点，减少动态效果时关闭。

## 重导当前模型

在 Blender 打开 [pointing-hand-rigged.blend](../blender/pointing-hand-rigged.blend)，在 Python Console 执行下列代码，把路径替换为本机仓库路径：

```python
path = '/path/to/FlickChain/scripts/export-pointing-hand.py'
exec(compile(open(path).read(), path, 'exec'), {'__file__': path})
```

[export-pointing-hand.py](../scripts/export-pointing-hand.py) 使用临时副本规范化朝向、尺度、动作与点击标记，输出游戏GLB、适配 `.blend` 和制作元数据；完成后恢复源场景，不保存或覆盖用户编辑源。[export-flick-hand.py](../scripts/export-flick-hand.py) 是此脚本的兼容入口。glTF使用线性蒙皮，用户源文件的保体积设置保持不变。

重导后执行 `npm test` 和 `npm run build`，检查真实GLB动作、点击点、逐帧净空和产物一致性。`scripts/create-flick-hand.py` 仅为旧生成模型的历史脚本，不能用于重建当前用户模型。

`flick-hand-authoring.json` 保存当前制作与拓扑记录。最新证据见 [手模型、物理与音效验收](../docs/validation/2026-10-11-hand-physics-audio.md)。音频作者、CC0来源、剪辑和合成滑音说明见 [audio-sources.md](audio-sources.md)。

`gold_coin.blend` 和 `../blender/hands.blend` 保留为原有建模源文件。本轮提交包含当前用户模型、其原始FBX和适配导出，排除 `.blend1` 自动备份、编辑前快照与本机连接记录。
