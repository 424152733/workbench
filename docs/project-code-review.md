# 保险顾问工作台代码 Review

**日期：** 2026-10-16  
**范围：** `workbench/src/` 前端结构、API/服务层、数据库初始化、测试与运行配置。此次为静态结构 review，没有执行付费模型调用或针对真实客户数据的测试。

> 以下保留初次 review 的发现；文末“重构执行记录”更新本轮落地状态和验证结果。

## 总体结论

项目已经形成可辨认的基础边界：前端 API、路由、平台规则、富文本和文章预览已拆成独立模块；后端也有 API 控制器、数据库服务、提示词模块及不同测试文件。当前主要维护风险是 `App.jsx` 与 `WorkbenchService` 随功能增加继续膨胀，导致状态、副作用和页面组合难以独立理解和验证。

## 优先级较高的发现

### P1 · API 默认暴露在所有网络接口，且跨域允许任意来源

`backend/main.js` 使用 `app.enableCors({ origin: true })`，并监听 `0.0.0.0`。控制器没有认证层；接口包括客户资料、保单、内容操作和会触发付费模型的生成请求。对于个人本机工作台，这意味着同一网络中的其他设备，以及可能从浏览器访问本机服务的网页，都可能触达这些接口；生成路由还可能被用于消耗账户额度。

建议：默认绑定 `127.0.0.1`，默认 CORS 仅允许本地前端来源；如确实需要局域网访问，增加明确的 `API_HOST`/来源白名单，并先加入认证与请求保护，再开放访问。

### P1 · 两个业务域集中在大型文件中

- `src/App.jsx` 约 1400 行，约 58 个 `useState`，同时维护壳层、客户/待办、内容编辑、设置、通知和多个表单状态。页面由组件内部的 `renderHome`、`renderClients`、`renderTopicEditor`、`renderContent` 函数拼装；弹窗也集中在同一文件。跨域状态互相影响，单独验证客户流程或内容流程都要挂载整个应用。
- `backend/workbench.service.js` 约 1138 行，同时实现客户、保单、跟进待办、内容草稿、模型提示、排期、设置、图片资源和导出。数据库事务和远端模型调用交织在同一服务中，后续改动容易扩大影响面。

建议前端分为 `dashboard`、`customers`、`content` 三个 feature；客户和内容各自拥有页面组件及领域 hook。`App` 保留壳层、导航、共享通知和跨域状态。后端按 `CustomersService`、`FollowUpTasksService`、`ContentService`、`SettingsService`/`AssetsService` 拆分，控制器按路由域拆分。

## 可提取的前端组件和状态

1. **共享展示组件**：将 `PanelHeading` 从 `App.jsx` 移至 `src/components/PanelHeading.jsx`；抽取 `MetricCard`、统一的 `PageHeader` 和可复用的 `FollowUpTaskActions`。其中任务操作在首页、客户档案、待办表格三处出现，应共用加载、权限/状态判断和操作回调外观。
2. **客户 feature**：`ClientsPage`、`CustomerDrawer`、`CustomerTable`、`FollowUpTaskTable` 与 `CustomerInsights` 放入 `src/features/customers/`。将筛选、客户档案、待办 CRUD、完成记录和通知刷新归到 `useCustomerWorkspace` 或更小的 `useCustomers` / `useFollowUpTasks` hooks。
3. **内容 feature**：`ContentPage`、`TopicList`、`DraftEditor`、`PlatformReviewPanel`、`ImageGallery` 及设置弹窗放入 `src/features/content/`。选题、草稿、润色、图卡和审核状态集中在内容领域 hook，不与客户状态共处 App。
4. **首页 feature**：将客户来源圆环、待办分组、续保/保单摘要抽为 `DashboardPage` 及若干无副作用视图组件；圆环切片计算可移入纯函数，便于独立验证。
5. **状态边界**：共享的 `performApiAction` 可成为小型 hook；颜色映射、选项列表和日期格式移入 `config/` 或 `utils/`。不要把所有行为抽到一个万能 hook，也不要为抽象而给组件传入无穷多的零散 props。

推荐按“保持行为不变的小组件 → 客户领域 → 内容领域 → Dashboard/App 壳层”的顺序渐进拆分，每一步通过现有构建和相关测试后再继续。当前 `ArticlePlatformPreview`、`RichText`、`api.js`、`navigation.js`、`platforms.js` 已经是可沿用的模块边界。

## 其他发现

### P2 · 前端保留未使用的演示数据

`initialClients`、`topicSeed`、`sampleDrafts` 在 `App.jsx` 中定义，但没有被运行路径引用。它们增加文件长度，也会让后来维护者误判前端仍有本地模拟数据源。建议删除，或在确有演示/空状态需求时迁入单独的 mock fixtures 并由测试显式导入。

### P2 · 数据库初始化脚本同时承担结构与示例数据

`DatabaseService.onModuleInit()` 每次 API 启动都会执行整个 `schema.sql`。这适合目前单机开发，但随着表和迁移增多，难以回溯部署版本，也容易让启动副作用变重。建议保留当前初始化可幂等的特性；当进入多环境部署前，将结构变更改为编号迁移，将示例数据独立为开发 seed。

### P2 · 内容服务和技能运行器承担过多职责

`WorkbenchService` 中模型调用、业务校验、数据库写入和响应拼装混在一起；`skill-runner.js` 同时处理 HTTP、技能文件、图像配置与外部图片请求。建议分别抽出 `TextGenerationClient`、`ImageGenerationClient` 和技能适配器，使模型错误处理与业务流程可分开验证。

### P3 · 样式文件按全局文件增长

`src/styles.css` 仍集中维护页面样式、主题覆盖和响应式规则。本轮已接入 Tailwind CSS v4，采用渐进迁移：布局、间距等简单样式逐步使用 Tailwind 工具类；复杂视觉、主题细节和 Ant Design 覆盖继续留在 CSS。后续仍可按 feature 拆分复杂样式，并在每次迁移时核对浅色/深色和窄屏表现。

### P3 · 交互层测试还没有覆盖页面和领域 hook

现有前端测试覆盖导航、平台规则、富文本和 API 调用形状，后端测试覆盖 API 与业务服务。拆出组件/hook 后，应优先测试状态转换、按钮 loading/错误恢复、表单校验及分页/筛选；避免直接测试纯展示细节。

## 已有的良好基础

- `src/api.js` 把 HTTP 调用集中封装，`navigation.js`、`platforms.js`、`richText.js` 让纯逻辑具有独立边界。
- `ArticlePlatformPreview` 已从主应用组件中分离，可作为平台预览组件的模式。
- 后端有独立的 `content-prompts.js` 和 `image-utils.js`；skill runner 与 API 测试分别覆盖文本/图片集成。
- `.env` 已列入 `workbench/.gitignore`，`.env.example` 提供了变量名模板。
- 数据库访问使用参数化查询，并提供事务封装；工作台对外发稿保持人工复制/审核流程。

## 建议的下一轮拆分目录

```text
workbench/src/
  app/                 # AppShell、导航与共享上下文
  components/           # PanelHeading、MetricCard、ConfirmAction 等纯 UI
  features/
    dashboard/          # DashboardPage 与图表/待办展示
    customers/           # 客户列表、档案抽屉、待办表格与 hooks
    content/             # 选题池、稿件编辑、审核与图文预览
  hooks/                 # 仅放跨 feature 的小型通用 hooks
  services/              # 从 api.js 继续拆分时的 HTTP/领域 API
  utils/                 # 日期、展示格式和纯计算
```

此结构是渐进拆分目标，不要求一次性移动所有文件。

## 重构执行记录（2026-10-16）

本轮按“保持接口和业务语义”的方式完成第一阶段拆分：

| Review 项 | 状态 | 实际改动 |
| --- | --- | --- |
| 本机 API 访问边界 | 已处理 | API 默认绑定 `127.0.0.1`；CORS 只允许本机开发/预览来源及无 Origin 请求；Vite 开发和预览服务也绑定回环地址。 |
| 前端大页面与弹层集中 | 已拆分 | `DashboardPage`、`ClientsPage`、`ContentPage` 和客户/内容弹层分别放到 feature 目录；共享 `PanelHeading` 和首页/待办表格复用的 `FollowUpTaskActions` 放入 `src/components/`。`App.jsx` 留导航壳、跨域协调和共享通知。 |
| 领域状态混在入口 | 已拆分一部分 | 客户、内容表单状态由各自的 `useCustomerWorkspaceState`、`useContentWorkspaceState` 管理；通用请求 loading 放在 `useApiAction`；选项和日期/请求 key 辅助逻辑独立成模块。跨页面 API 编排仍由 `App.jsx` 协调，后续可以按行为边界逐项迁出。 |
| 后端单一服务过大 | 已拆分 | 客户与跟进、内容、设置与图片资源操作分别移入 `customer-followup-operations.js`、`content-operations.js`、`settings-assets-operations.js`；`workbench.service.js` 作为控制器兼容的服务门面，保留同一个数据库和跨域调用上下文。共享校验与格式化规则在 `workbench-primitives.js`。 |
| 无引用的演示数据 | 已处理 | 删除 `App.jsx` 中未使用的客户、选题与草稿种子数据；内容生成演示辅助逻辑集中在后端 helper 文件。 |

### 验证结果

- `npm run build`：通过。Vite 仍提示一个共享依赖 chunk 约 632 KB；可在后续按依赖边界优化拆包，不影响本轮构建。
- `npm run test:ui-logic`：7 项通过。
- 安全与业务服务测试：16 项通过。
- API 集成测试：11 项通过，使用临时 PostgreSQL 数据库并在结束后删除。
- 浏览器 smoke test：工作首页、客户与保单、大话保险页面均可渲染；`/content` 和 `/clients?view=tasks` 刷新后都保留当前路由与待办视图；首页和待办表格的共用操作按钮可见。没有触发真实 GPT、Runware 或 Baoyu 付费调用，也没有在页面中创建、修改或删除业务数据。

### 仍待逐步处理

- `App.jsx` 保留应用壳、首次数据加载、地址栏同步、全局通知/日历/偏好设置和页面装配。全局导航通过偏好设置在左侧栏与顶部横向菜单之间切换，位置写入现有 preferences JSONB；若后续继续精简，可把首次加载与全局 overlay 装配移入独立 app 模块；客户和内容领域的交互动作已迁入各自 feature hook。
- 复杂视觉样式尚未按 feature 拆分；Tailwind 当前仅在首页布局做了小范围试点，后续迁移时应同时核对主题和窄屏表现。
- 数据库仍在启动时执行幂等 schema 初始化；多环境部署前应迁移到有版本的数据库迁移。
- 前端目前以纯逻辑测试和浏览器 smoke test 为主，没有单独的 React 组件测试基础设施。

## 路由交互逻辑拆分记录（2026-10-17）

针对 `App.jsx` 仍集中处理客户和内容操作的问题，进一步把领域副作用迁到路由所属 feature：

- `src/features/customers/useCustomerWorkspaceActions.js` 管理客户筛选/加载、客户和保单操作、跟进记录与待办流程；客户列表过滤和待办视图加载也随客户 feature 管理。
- `src/features/content/useContentWorkspaceActions.js` 管理选题、平台草稿、审核、表达与图片样式、候选选题、图片素材及草稿自动保存。
- `src/App.jsx` 的页面仍分别由 `DashboardPage`、`ClientsPage`、`ContentPage` 承载并使用 `React.lazy` 加载。App 主要负责外层导航、路由状态、共享数据/设置、全局弹层以及把 feature controller 传给当前页面；本轮文件为 386 行。

验证：`npm run build` 通过，`npm run test:ui-logic` 7 项通过，`git diff --check` 通过。本轮在浏览器直接打开 `/`、`/clients`、`/content`，三页均正常渲染且未观察到 console error；没有触发创建、修改、删除、生成或发布操作。本轮没有调用付费模型，也没有执行会连接业务数据库的 API 集成测试。

## Tailwind CSS 渐进接入记录（2026-10-17）

- 安装 `tailwindcss` 与 `@tailwindcss/vite` v4，并在 Vite 插件中启用 Tailwind。
- `src/tailwind.css` 只引入 theme 与 utilities layer，跳过 Preflight，避免全局 reset 改变 Ant Design 和现有页面的基础样式。
- `src/main.jsx` 在既有 `styles.css` 前加载 Tailwind；首页、客户与保单、大话保险页面中的间距、弹性布局和简单网格已开始改用工具类。
- 约定：新写的简单布局/间距优先用 Tailwind；继续使用 Ant Design 作为组件库；复杂图表/插画、主题 token、Ant Design 覆盖及多断点规则留在 CSS。不要用工具类覆盖 Ant Design 内部结构样式。
- 验证：`npm run build` 通过，`npm run test:ui-logic` 7 项通过。当前浏览器安全策略拒绝读取本地工作台页面，因此本轮代码调整未能在浏览器中复核；首页首轮试点已由用户检查，未发现样式问题。

## CSS 按功能拆分记录（2026-10-17）

- `src/styles.css` 现在只作为样式入口，统一导入基础样式、应用外壳、共享样式、各业务 feature、弹层、响应式规则和深色主题；组件入口继续保持单一导入点。
- 首页样式放在 `src/features/dashboard/dashboard.css`；客户与保单、服务记录样式放在 `src/features/customers/`；大话保险编辑器和文章预览放在 `src/features/content/`。
- `src/styles/` 负责基础样式、应用框架、跨页面共享组件、弹层、响应式规则及深色主题。
- 新增 feature 样式应跟随对应 feature 目录；简单布局和间距优先使用 Tailwind utility class。全局基础规则、跨 feature 共享样式、主题覆盖、复杂插画和 Ant Design 结构覆盖才放入 `src/styles/`。
- 深色主题和响应式样式仍集中维护，但各自独立于页面基础样式，避免每个 feature 重复维护同一组断点或主题选择器。修改组件时需同步检查其 light/dark 与窄屏规则。
- 验证：本轮 CSS 拆分未改动声明本身；`npm run build`、`npm run test:ui-logic` 均通过。浏览器访问受当前环境的本地页面权限策略拦截，未进行视觉复核。
