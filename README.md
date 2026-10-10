# FlickChain《一弹到底》

手机优先的 Web 3D 物理接力游戏。所有硬币公共共享：一杆合法命中唯一目标后获得 1 分，原币在结算后消失，玩家从目标币的最终位置继续弹射。

当前状态（2026-10-10）：单人5关与本地双人可玩，已完成起手自由选币/接力锁币、Blender连体握拳手与默认圆桌。84项自动化测试、五关完整解法回放、类型检查、构建、鼠标与模拟触摸检查通过。阶段状态和待办见 [开发进度](docs/PROGRESS.md)，最新证据见 [连体手与圆桌验收](docs/validation/2026-10-10-continuous-hand-round-table.md)。真机触摸、性能和发行验收待完成。

## 本地运行

需要 Node.js 20.19+ 或 22.12+。

```sh
npm ci
npm run dev
```

打开终端显示的本地地址。空白区域拖动旋转 3D 视角；入关或双人换人后可选择任意公共硬币，首杆发射前可反复切换。合法命中后，必须从刚击中硬币的最终位置继续，不能重新选币。选币后镜头推近当前币，完整卡通握拳的手放在金币正后方，食指待机平行桌面；按住手或当前币蓄力时食指逐渐弯曲、指尖回收，高蓄力时手会轻微抖动，松手沿当前视角前方弹射；力度只由按住时长决定。减少动态效果设置会关闭抖动。近景中可通过旋转视角寻找其它硬币。一杆的目标只统计源币直接接触的硬币，双人犯规停稳后换人，换人后重新开放起手选币。

```sh
npm test
npm run validate:levels
npm run build
npm run preview
```

`dist/` 是静态产物；资源采用相对基址。音频由用户操作解锁，存档失败仅提示，仍可游玩。关卡与物理参数改动后须重新生成并验证完整解，步骤见 [关卡测试说明](tests/levels/README.md)。

手模型由 Blender MCP 按用户的卡通握拳图重做；源文件 [flick-hand.blend](assets/flick-hand.blend)，游戏资产 [flick-hand.glb](public/models/flick-hand.glb)。拳头、食指、拇指和腕部组成一个封闭连通的皮肤网格，食指通过辅助骨骼分摊弯曲，运行时采样 `FlickCharge`，其余手指保持握拳。加载失败可用“重建本局”重试。默认关卡使用直径1.6米的圆桌，显示、点击与物理边界一致。验证见 [连体手与圆桌验收](docs/validation/2026-10-10-continuous-hand-round-table.md)。

## 项目文档

- [产品需求 PRD](docs/PRD.md)：规则、模式、体验、范围和产品验收。
- [技术架构](docs/TECHNICAL_ARCHITECTURE.md)：物理、状态、接口、AI 与生命周期。
- [任务计划](docs/TASK_PLAN.md)：分阶段任务、责任角色、依赖和验证入口。
- [开发进度](docs/PROGRESS.md)：当前可玩范围、验证结果、剩余任务与资源版本。
- [来源与决策记录](docs/SOURCES_AND_DECISIONS.md)：历史需求、本轮默认决策和证据边界。
- [项目 Agent 说明](AGENTS.override.md)：开发门禁、职责与共享文件约束。
- [配置迁移验证](docs/CONFIGURATION_VALIDATION.md)：迁移文件、模型、解析和实际加载状态。

技术方向：TypeScript + Vite + Three.js + Rapier 3D WASM，HTML/CSS、Pointer Events、Web Audio。初期离线游玩、静态托管；运行时不接入大模型。

## 执行顺序

物理手感原型 → 整杆接力规则 → 单人/本地双人 MVP → Worker AI → 材质与 20 关内容 → 性能与平台发行。

PRD 规定产品行为，架构规定实现边界，任务计划规定顺序与完成条件。出现冲突时先更新决策记录并同步三份文档，避免各模块自行选择规则。详细调校参数均为候选，需实际浏览器与设备验证。
