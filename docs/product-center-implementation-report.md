# 产品中心首期实施记录

**日期：** 2026-10-17
**状态：** MVP 已实现，待本机数据库迁移和浏览器验收

## 已交付

- 新增一级菜单和 `/products` 路由，产品中心与「大话保险」选题、稿件分开保存。
- 支持新华保险产品档案的创建、编辑、检索和删除。险种与保险公司使用独立字典表；初始只启用新华保险，保留后续增加人保财险及其他险种的结构。
- 支持 PDF、DOCX、TXT 资料导入和本机文本提取。扫描件没有 OCR；无法解析的资料会显示失败或待检查状态。
- 点击“GPT 提取要点”后才使用现有 Runware 文本模型。PDF 引用须匹配页码和原文，DOCX/TXT 引用须匹配原文；没有可验证出处的要点不会进入可确认内容。
- 每条要点可编辑并逐条核对。只有全部事实经过人工确认，才可生成平台文案。
- 支持知乎、小红书、公众号独立文案、富文本阅读预览、编辑保存、人工审核及审核后复制。
- 已审核后复制的内容会附上简短的产品责任边界说明；资料出处保留在稿件核对区，便于发布前查验。
- 平台的目标读者、语气、内容结构和篇幅建议可分别配置；提示词仍保留事实和保障边界约束。
- 生成调用 `humanizer-zh`。若润色器暂不可用，会保存 GPT 原稿并明确显示尚待人工润色，避免文本模型调用成功后因润色器故障丢失结果。
- 文案编辑、重新生成、要点复核和历史版本恢复都会留下版本快照；恢复历史内容后状态回到草稿，必须重新审核。
- 每篇草稿记录生成时的平台表达配置快照，便于追溯当时采用的受众、语气、结构和篇幅偏好。
- 产品删除或资料删除会通过数据库外键级联清除关联的要点、文案和版本，并清理存储文件；删除确认会显示受影响的数据数量。
- 第一阶段没有调用 Baoyu 或图片模型，不会消耗 Runware 生图额度。
- 产品中心标题行仅保留右侧“刷新”按钮，与标题垂直对齐；新建入口统一放在产品档案卡片，使用实心“新建产品”按钮。

## 主要实现位置

- 页面及产品工作区：`src/features/products/ProductCenterPage.jsx`、`src/features/products/useProductCenterWorkspace.js`、`src/features/products/products.css`
- 共享预览：复用 `src/article-preview.jsx`、`src/richText.js` 和 `src/features/content/XhsPlatformPreview.jsx`
- 产品 API：`src/api.js`、`backend/api.controller.js`
- 产品业务和提示词：`backend/product-center-operations.js`、`backend/product-center-prompts.js`
- 文档解析：`backend/product-document-parser.js`
- 数据迁移：`backend/migrations/002_product_center.sql`、`backend/migrations/003_product_platform_settings.sql`、`backend/migrations/004_product_copy_config_snapshot.sql`

## 验证

- `npm run build`：通过。
- Vite 构建同时报告一个超过 500 KB 的 chunk 体积提示；构建成功，该提示不影响运行。
- `npm run test:ui-logic`：9 项测试通过。
- `npm run test:product-center`：16 项测试通过，覆盖文件解析、来源引用校验、平台提示词、平台表达设置、产品事实确认、稿件失效处理和历史版本恢复。
- 其他不依赖业务数据库的后端回归：54 项测试通过。
- `node --check`：新增后端模块语法检查通过。
- 新增及修改源码的尾随空格检查：通过。
- 未运行依赖 `DATABASE_URL` 的完整 API 集成测试，也未对现有 PostgreSQL 数据库执行迁移或写入数据。
- 未通过浏览器实测页面。此前本机浏览器工具对 localhost 的访问仍受 Codex 托管 origin 策略限制；没有用其他方式绕过。需要在用户本机启动服务后验收完整交互。
- 2026-10-18 按页面反馈调整产品中心标题行与新建入口；`npm run build` 通过。Chrome `/products` 页面可访问性快照确认标题区保留“刷新”、档案卡片显示实心“新建产品”；窄屏布局未单独检查。

## 首次启动注意

API 启动时会按顺序自动应用未执行的 SQL 迁移。确认 PostgreSQL 服务可用后，重启 API，再打开“产品中心”。GPT 要点整理和平台文案生成依赖现有 `RUNWARE_API_KEY`；平台文案还会尝试调用现有 `humanizer-zh` skill runner。资料上传、解析、编辑和预览不需要调用模型。

扫描版 PDF 的 OCR、Baoyu 图文生成、批量多平台生成、产品字典管理 UI 仍属于后续能力。
