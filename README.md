# FlickChain《一弹到底》

手机优先的 Web 3D 物理接力游戏。所有硬币公共共享：一杆合法命中唯一目标后获得 1 分，原币在结算后消失，玩家从目标币的最终位置继续弹射。

当前状态：首个可玩版本已实现单人 5 关与本地双人。Three.js 负责呈现，Rapier 负责真实物理，整杆停稳后统一判定。浏览器与自动化证据见 [MVP 验证记录](docs/validation/2026-10-09-mvp.md)。真机触摸、性能和发行验收待完成。

## 本地运行

需要 Node.js 20.19+ 或 22.12+。

```sh
npm ci
npm run dev
```

打开终端显示的本地地址。空白区域拖动旋转 3D 视角；点选任意公共硬币立即开始，弹射前可随时点其他硬币切换当前币。当前币后方平放着一根手指，按住手指（或硬币）蓄力，手指逐步弯向硬币并随力度发抖，松手沿当前视角前方弹射；力度只由按住时长决定。一杆只能涉及一枚目标币。双人共用全部硬币，合法接力继续、犯规停稳后换人，换人后重新选择下一杆硬币。

```sh
npm test
npm run validate:levels
npm run build
npm run preview
```

`dist/` 是静态产物；资源采用相对基址。音频由用户操作解锁，存档失败仅提示，仍可游玩。关卡与物理参数改动后须重新生成并验证完整解，步骤见 [关卡测试说明](tests/levels/README.md)。

## 项目文档

- [产品需求 PRD](docs/PRD.md)：规则、模式、体验、范围和产品验收。
- [技术架构](docs/TECHNICAL_ARCHITECTURE.md)：物理、状态、接口、AI 与生命周期。
- [任务计划](docs/TASK_PLAN.md)：分阶段任务、责任角色、依赖和验证入口。
- [来源与决策记录](docs/SOURCES_AND_DECISIONS.md)：历史需求、本轮默认决策和证据边界。
- [项目 Agent 说明](AGENTS.override.md)：开发门禁、职责与共享文件约束。
- [配置迁移验证](docs/CONFIGURATION_VALIDATION.md)：迁移文件、模型、解析和实际加载状态。

技术方向：TypeScript + Vite + Three.js + Rapier 3D WASM，HTML/CSS、Pointer Events、Web Audio。初期离线游玩、静态托管；运行时不接入大模型。

## 执行顺序

物理手感原型 → 整杆接力规则 → 单人/本地双人 MVP → Worker AI → 材质与 20 关内容 → 性能与平台发行。

PRD 规定产品行为，架构规定实现边界，任务计划规定顺序与完成条件。出现冲突时先更新决策记录并同步三份文档，避免各模块自行选择规则。详细调校参数均为候选，需实际浏览器与设备验证。
