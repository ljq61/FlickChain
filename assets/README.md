# FlickChain 手模型

`flick-hand.blend` 由 Blender 5.1.2 的本机 Blender MCP 制作，可继续编辑；`gold_coin.blend` 是原有独立资产，本次脚本没有写它。

- 游戏文件：`public/models/flick-hand.glb`，264232 bytes，自包含颜色材质，无纹理外链或解码器依赖。SHA-256：`55de7a6852687bdc6a6b87c84cd5ac5bb2f7da509e70a6276a8de2126a6a4a96`。
- 皮肤：拳体、食指、三根收拢手指、拇指与腕部为同一块封闭连通的 `hand_skin`，4073顶点、6950面；袖口、指甲和指节线为装饰。
- 比例：米制；导出后 +Y 向上、+Z 食指朝前。待机食指轴线高度0.025m，指尖z=0.106m。
- 骨骼：`hand_root` 固定拳体，食指11段辅助骨骼分摊弧度；保留 `index_mcp/index_pip/index_dip` 接口，总计12根骨骼。
- 动作：`FlickCharge`，0–24 帧，24fps，1秒；从伸直平放到弯曲回收。游戏按蓄力比例采样，取消时回到0。
- 命中：`hit_axis_00..07` 是跟随骨骼的8个轴点；整手点击点由真实变形表面采样。手模型无物理碰撞体。
- 抖动：游戏对外层节点施加高蓄力微抖；开启减少动态效果后关闭。

可复现建模脚本为 `scripts/create-flick-hand.py`，通过 `scripts/blender-mcp.mjs execute_blender_code` 发送给已配置的 MCP 服务。运行需要本机 Blender MCP 连接及宿主批准；脚本使用当前工作站的绝对项目路径。它只替换自身创建的 `FlickHand_Asset` 集合及带 `flickchain_authored` 标记的动作，不清空原场景。导出后可用 `scripts/export-flick-hand.py` 重导当前手场景。

`flick-hand-authoring.json` 保存最终制作与拓扑记录。最新模型证据和游戏截图见 [连体手与圆桌验收](../docs/validation/2026-10-10-continuous-hand-round-table.md)。本机 `blender-mcp-*.json` 等连接/中间结果不作为最终模型版本，也不纳入本轮提交。

`gold_coin.blend` 和 `../blender/hands.blend` 保留为原有建模源文件，本轮未覆盖；游戏加载的手以此目录 `flick-hand.blend` 的导出GLB为准。
