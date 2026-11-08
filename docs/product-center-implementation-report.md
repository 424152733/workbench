# 产品中心首期实施记录

**日期：** 2026-10-17
**状态：** MVP 已实现；多资料汇总迁移和本机页面加载已验证

## 已交付

- 新增一级菜单和 `/products` 路由，产品中心与「大话保险」选题、稿件分开保存。
- 支持新华保险产品档案的创建、编辑、检索和删除。险种与保险公司使用独立字典表；初始只启用新华保险，保留后续增加人保财险及其他险种的结构。
- 支持 PDF、DOCX、TXT 资料导入和本机文本提取。扫描件没有 OCR；无法解析的资料会显示失败或待检查状态。
- 点击“汇总提取全部资料”后，使用 DeepSeek V4.1 Flash 一次整理该产品全部已解析的资料。PDF 引用须匹配对应文件的页码和原文，DOCX/TXT 引用须匹配对应文件原文；没有可验证出处的要点不会进入可确认内容。
- 每条要点可编辑并逐条核对。只有全部事实经过人工确认，才可生成平台文案。
- 支持知乎、小红书、公众号独立文案、富文本阅读预览、编辑保存、人工审核及审核后复制。所有内容分类均使用 DeepSeek V4.1 Flash 生成并由 humanizer-zh 润色；实际图片生成使用 Runware GPT Image。
- 已审核后复制的内容会附上简短的产品责任边界说明；资料出处保留在稿件核对区，便于发布前查验。
- 平台的目标读者、语气、内容结构和篇幅建议可分别配置；提示词仍保留事实和保障边界约束。
- 所有分类的平台稿件生成及 humanizer-zh 润色均使用 DeepSeek。平台稿件在润色步骤成功后才保存。
- 文案编辑、重新生成、要点复核和历史版本恢复都会留下版本快照；恢复历史内容后状态回到草稿，必须重新审核。
- 每篇草稿记录生成时的平台表达配置快照，便于追溯当时采用的受众、语气、结构和篇幅偏好。
- 产品删除或资料删除会通过数据库外键级联清除关联的要点、文案和版本，并清理存储文件；删除确认会显示受影响的数据数量。
- 第一阶段没有调用 Baoyu 或图片模型，不会消耗 Runware 生图额度。
- 产品中心标题行仅保留右侧“刷新”按钮，与标题垂直对齐；新建入口统一放在产品档案卡片，使用实心“新建产品”按钮。
- DeepSeek 使用 OpenAI 兼容接口：`DEEPSEEK_BASE_URL` 默认 `https://api.deepseek.com`，`DEEPSEEK_TEXT_MODEL` 默认 `deepseek-flash`（DeepSeek V4.1 Flash）。产品资料要点、内容工作台全部文本生成、Baoyu 图片提示词规划及 humanizer-zh 润色读取 `DEEPSEEK_API_KEY`；只有实际图片生成读取 `RUNWARE_API_KEY`。

## 主要实现位置

- 页面及产品工作区：`src/features/products/ProductCenterPage.jsx`、`src/features/products/useProductCenterWorkspace.js`、`src/features/products/products.css`
- 共享预览：复用 `src/article-preview.jsx`、`src/richText.js` 和 `src/features/content/XhsPlatformPreview.jsx`
- 产品 API：`src/api.js`、`backend/api.controller.js`
- 产品业务和提示词：`backend/product-center-operations.js`、`backend/product-center-prompts.js`
- 文档解析：`backend/product-document-parser.js`
- 数据迁移：`backend/migrations/002_product_center.sql`、`backend/migrations/003_product_platform_settings.sql`、`backend/migrations/004_product_copy_config_snapshot.sql`
- 多资料来源关系：`backend/migrations/013_product_extraction_sources.sql`

## 验证

- `npm run build`：通过。
- Vite 构建同时报告一个超过 500 KB 的 chunk 体积提示；构建成功，该提示不影响运行。
- `npm run test:ui-logic`：27 项测试通过。
- `npm run test:product-center`：22 项测试通过，覆盖文件解析、多资料合并与来源引用校验、平台提示词、产品事实确认和稿件状态处理。
- 其他不依赖业务数据库的后端回归：共 99 项测试通过；未运行需要 `DATABASE_URL` 的 API 集成测试。
- `node --check`：新增后端模块语法检查通过。
- 新增及修改源码的尾随空格检查：通过。
- 未运行依赖 `DATABASE_URL` 的完整 API 集成测试，也未对现有 PostgreSQL 数据库执行迁移或写入数据。
- 首期实现时未通过浏览器实测完整流程；2026-10-21 本次更新已在本机浏览器确认产品中心正常加载，并通过 API 读取现有产品资料和历史要点。未点击汇总按钮，因为这会发起真实 DeepSeek 请求。
- 2026-10-18 按页面反馈调整产品中心标题行与新建入口；`npm run build` 通过。Chrome `/products` 页面可访问性快照确认标题区保留“刷新”、档案卡片显示实心“新建产品”；窄屏布局未单独检查。
- 2026-10-20 MiniMax 接入通过模拟响应测试：OpenAI 兼容请求、产品解读路由、skill runner 润色分流、MiniMax Key 缺失处理；产品中心及 UI 逻辑测试、前端构建通过。未调用真实 MiniMax 服务或付费模型。
- 2026-10-20 内容工作台文本模型统一切换到 MiniMax：选题推荐、三类内容稿件、humanizer-zh 以及 Baoyu 图卡/插画规划均使用 MiniMax；图片生成仍使用 Runware GPT Image。新增模拟路由测试覆盖 MiniMax 文本调用及图片规划和图片生成的模型分工；没有调用真实模型。
- 2026-10-21 排查内容工作台 MiniMax HTTP 401：官方接口地址、Bearer 鉴权方式和 M3.1-Flash 模型名均与当前实现一致；错误提示现会说明密钥类型检查方式，并只显示安全的上游错误码，不回传上游原始错误正文。未使用真实密钥重试模型调用。
- 2026-10-21 文本模型从 MiniMax 切换到 DeepSeek V4.1 Flash：文本生成、选题推荐、产品资料提取、humanizer-zh 润色和 Baoyu 图片规划均改用 DeepSeek OpenAI 兼容 API；Runware GPT Image 继续负责实际生图。模型 ID 使用官方推荐的 `deepseek-flash`，请求启用 JSON 输出和 high 思考档位。测试使用模拟响应，未调用真实 DeepSeek 或 Runware 服务。
- 2026-10-21 产品资料提取支持多文件汇总。一次调用合并该产品全部已解析 PDF、DOCX 和 TXT；资料未完成解析时会阻止提交，避免无提示地漏掉文件。合并事实仍按来源文件和页码逐条验证，重复事实合并，资料冲突列入待核实问题。新增 `product_extraction_documents` 保存要点版本的完整来源文件集合，旧版本由迁移按原文件回填。删除汇总所依赖的资料会同步清理整组要点和文案；内容工作台已引用的要点仍受删除保护。
- 多资料汇总验证：前端构建、产品中心 22 项测试、UI 逻辑 27 项测试及不依赖业务数据库的后端 99 项测试均通过。开发服务已重启并应用迁移；浏览器页面可加载，现有产品工作区和历史要点可读取。未调用 DeepSeek 真实接口，也未实际触发汇总生成，以免消耗模型额度。

## 首次启动注意

API 启动时会按顺序自动应用未执行的 SQL 迁移。确认 PostgreSQL 服务可用后，在 `.env` 中配置 `DEEPSEEK_API_KEY` 并重启 API 和 skill runner，再打开工作台。产品资料要点整理和内容工作台中的所有文本生成、润色及图片提示词规划依赖 DeepSeek；实际图片生成依赖 `RUNWARE_API_KEY`。资料上传、解析、编辑和预览不需要调用模型。

扫描版 PDF 的 OCR、Baoyu 图文生成、批量多平台生成、产品字典管理 UI 仍属于后续能力。
