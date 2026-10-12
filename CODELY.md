

## Codely Structured Memories

### User

### Feedback

### Project
- [2026-10-09 23:35:42] [2026-10-09] FlickChain 双轨 subagent 角色：.codex/agents/（codex 原生）与 .codely-cli/agents/（Codely 官方格式，同 id 七角色：physics-gameplay/presentation/ai-level/platform-engineer、test-reviewer、repo-scanner、escalation-engineer）并存；分工与门禁以 AGENTS.override.md 为准，Codely 侧 defaultAgentModel=codely-core，只读角色靠 tools 白名单，迁移记录在 docs/CONFIGURATION_VALIDATION.md。
- [2026-10-10 09:18:08] [2026-10-10] FlickChain UI 实测方案（AGENTS.override 要求 UI 用真实浏览器交互验证）：零依赖 CDP 直驱——Node22 内置 fetch/WebSocket，PUT http://127.0.0.1:<port>/json/new?about:blank 拿页面级 webSocketDebuggerUrl 直连；Chrome 二进制 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome，flags：--headless=new --remote-allow-origins=* --user-data-dir=<独立目录>；Input.dispatchMouseEvent 合成点击/拖拽（mousePressed→mouseMoved 带 buttons:1→mouseReleased）可完整走 选币→确认→空白处拖拽旋转→按住蓄力→弹射→结算；调试输入用 Runtime.evaluate 注入 window 级 pointer 事件探针日志。视觉验证用 PIL（/Library/Frameworks/.../python3.10 有 10.4.0）对 Page.captureScreenshot 截图做像素采样：单帧看不出闪烁，需定时多帧采样亮度振荡。关键：**默认不加 --enable-unsafe-swiftshader 时无头 Chrome 用真 GPU（ANGLE Metal M1 Max）**——颜色/材质验证必须用真 GPU 模式（SwiftShader 与真 GPU 的 MeshPhysical 金属路径观感不同）；swiftshader 仅作 WebGL 不可用时的回退。坑：①点选硬币后镜头会 lerp 向该币，采样点要用画面中心而非点击点；②截图突发+合成输入时序曾致拖拽手势中途被取消（测试伪影，事件探针可证非应用 bug）；③favicon.ico 404 为项目原有非回归。
- [2026-10-10 09:18:12] [2026-10-10] FlickChain three.js 渲染调色三坑（视觉迭代实测结论）：①scene.environment（RoomEnvironment PMREM）会把 MeshPhysical/Standard 材质的固有色洗成环境色——material.envMapIntensity 只控制镜面路径，管不住 IBL 漫反射辐照（平面朝上时还正对 PMREM 天花板亮灯产生近白高光）；调金属材质色相必须动 scene.environmentIntensity（0.7→0.3 后铜色显现、全场景更沉稳），漫反射材质（木纹）对渲染器稳定可放心调，金属/Physical 材质必须真 GPU 采样验证。②动画平面与相机视线共面=不可见：手指沿弹射方向弯曲永远背对镜头（相机总是沿弹射方向看），任何视角都只看到"柱子变高"；可见动作必须落在屏幕平面分量（垂直/横向），手指弯折面用 fingerGroup.rotateY(0.9) 转出视线平面后钩形才可读。③Vite dev 转译把 16 进制常量转十进制（0x8a3d1c→9059612），grep 服务端模块找 "0x..." 会误判为缓存未更新；验证服务端代码新旧的正确姿势是 grep 十进制值或直接看转译行。
- [2026-10-10 09:33:50] [2026-10-10] FlickChain 已建 git 仓库并推送 GitHub：https://github.com/ljq61/FlickChain（main 分支，origin 已配 https remote）。远端首提交是建仓自动生成的 LICENSE+README（a2d07a6），本地首个功能提交 rebase 其上，README 冲突以项目版为准（checkout --theirs）；.gitignore 已排除 node_modules/dist，.codely-cli/.codex 为有意入库的项目 agent 配置（docs/CONFIGURATION_VALIDATION.md 有记载）。后续轮次完成验证后应 commit+push 同步。
- [2026-10-10 09:33:50] [2026-10-10] FlickChain E2E 弹射力度标定坑：被击硬币会翻滚/滚动，滑行距离远超"滑动摩擦 μg"模型预测——p=0.76 命中后目标币被撞出桌面（FALL 犯规 failed），p≈0.63（按住 790ms）才是 1 关 b→a 几何的合法通关档（命中余量 16% 且目标币不出桌）。标定蓄力时长时按动能余量算窗口而非滑距模型；测试中还发现按住蓄力从手指锚点（币下方约 40px，命中半径 40px）按下可靠触发。
- [2026-10-10 22:45:21] [2026-10-10] FlickChain blender/pointing-hand-rigged.blend：pointing-hand FBX 已绑骨（Hand 根骨+静态 Thumb 钉骨+Index_01/02/03，MCP x≈-0.72/PIP -0.82/DIP -0.91/指尖 -1.0，y=-0.16）——手指沿 -X、掌心朝 -Z，+X euler 旋转=向掌心弯曲；bone heat 权重干净（指尖全 Index_03、袖套组件全 Hand、拇指无拖动）。Blender 5.2 实测坑：①pose bone 默认 QUATERNION 模式，写 rotation_euler 无声失效，必须先 rotation_mode='XYZ'（症状：只有显式设过 XYZ 的骨生效）；②OBJECT 模式 Bone.z_axis 在 edit 改 roll 后可能返回陈旧值，以 pose.bone.matrix_local/实测姿态为准；③EditBone.align_roll 目标与当前 Z 轴正好反 180°（如 -X 指向骨传 (0,0,-1))会翻转失败，需按 z_axis 响应迭代算 roll；④渲染引擎枚举是 'BLENDER_EEVEE'（无 _NEXT）。

### Reference

