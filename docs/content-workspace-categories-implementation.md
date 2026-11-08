# 内容工作台多分类实施记录

**日期：** 2026-10-18<br>
**状态：** 代码已实现；迁移已在本地服务启动时执行

## 已实现

- 内容工作台增加“大话保险 / 产品解读 / 客户案例”三个分类。分类切换、选题链接和发布记录筛选使用 `type` 查询参数；旧 `/content` 链接默认进入大话保险。
- 选题、平台稿件、图卡、图片、审核和发布历史复用现有工作流。发布记录保存登记时的分类和来源快照。
- 旧产品文案版本迁入通用稿件版本表；内容工作台提供历史版本查看和恢复，恢复后稿件回到草稿并重新审核。旧产品文案写入/审核/恢复接口改为只读迁移提示，避免新旧两套稿件继续分叉。
- 产品解读从产品中心选择产品及已确认资料版本，服务端按产品 ID 和资料提取 ID 一起校验，并保存产品名称、版本、事实、待核实项和来源文件快照。未确认或后来变为未确认的资料不能生成、润色或审核稿件。产品中心显示关联解读及其入口。
- 客户案例关联产品中心中的具体产品和已确认资料版本，并登记经授权真实案例、综合案例或情景示例；不提供 CRM 客户选择字段。可选填写保费或利益数据及其来源。案例生成时产品资料和案例数值依据一并带入，收益率等数值不得由模型自行推算。真实案例需要服务端确认授权和脱敏后才可生成、润色或审核；综合案例和情景示例在正文及小红书封面持续保留性质标识，审核时也会再次校验。
- 产品解读和客户案例新建表单提供内容角度下拉框及 3 条本地标题模板。模板结合已关联产品名称和所选角度；涉及现金价值、利益演示的角度只有在已确认资料包含相应事实时才开放。客户案例需先填脱敏摘要，真实案例还需确认授权及脱敏。点击标题会填入选题字段，用户可以继续编辑。此本地模板流程不调用模型；大话保险选题推荐由 DeepSeek 生成。
- 三类规则由共享分类定义提供。产品解读、客户案例可分别保存补充表达设定；保险事实、来源可追溯和边界说明作为共享生成规则。
- 迁移 `009_content_workspace_categories.sql` 将旧产品中心平台稿件和版本映射到通用稿件，并在事务内检查源稿件/版本与迁移映射数量。旧稿件在关联资料未经确认时降为草稿。

## 主要代码

- 分类规则、案例标识和主题模板：[content-types.js](../src/features/content/content-types.js)、[content-case-safety.js](../backend/content-case-safety.js)、[topic-recommendations.js](../src/features/content/topic-recommendations.js)
- 内容表单和分类工作区：[ContentPage.jsx](../src/features/content/ContentPage.jsx)、[ContentOverlays.jsx](../src/features/content/ContentOverlays.jsx)
- 内容生成与门禁：[content-operations.js](../backend/content-operations.js)、[content-prompts.js](../backend/content-prompts.js)
- 产品中心和发布快照：[product-center-operations.js](../backend/product-center-operations.js)、[publication-operations.js](../backend/publication-operations.js)
- 数据迁移：[009_content_workspace_categories.sql](../backend/migrations/009_content_workspace_categories.sql)、[010_content_case_product_context.sql](../backend/migrations/010_content_case_product_context.sql)

## 验收状态

- 已运行的检查：`npm run build`、`npm run test:ui-logic`、主题推荐/提示词/案例标识单元测试、后端 `node --check`、`git diff --check`。
- 已重启本地服务并验证 `/api/health` 与两类 `/api/topics` 查询返回 HTTP 200，确认新增案例数值字段迁移已生效。未运行 API 集成测试；项目规定该测试只能连接一次性可丢弃 PostgreSQL 数据库。
- 浏览器已检查产品解读和客户案例表单、案例数值来源字段、长表单滚动及资料未确认时推荐按钮禁用状态。当前示例产品没有已确认资料版本，因此无法在浏览器中展示真实推荐结果；推荐模板本身由单元测试覆盖。暗色和窄屏仍待人工验收。

## 边界与后续

- 首期客户案例使用人工整理的脱敏摘要；不连接 CRM，也不把模型生成当成脱敏或合规审核。
- 产品事实快照保存创建选题时选定的已确认版本。产品中心保留旧数据表，迁移不会删除旧记录。
- 当前分类是代码内置的三类；新增分类仍需增加字段策略、提示词和审核规则，不提供任意自定义分类配置。

## 2026-10-21 产品解读文案调整

- 产品中心提取的来源引用、文件名、页码、原文摘录和待核实清单留在内部快照，不传入产品解读的生文素材；仅将产品名称、版本、定位和逐条确认的事实交给模型。产品解读的 `sources` 字段留空。
- 产品解读按选题从已确认事实中挑选最相关的 3–5 条，用具体责任、条件和限制解释对读者的实际含义，并补充读者应核对的事项，避免生成内部资料摘要或只有“以合同为准”的空泛提醒。
- 资料没有具体费率或报价数字时，提示现有材料无法支持准确金额，并且只列材料明确要求的报价条件；不推算、不猜测。
- 验证：产品提示词单元测试新增读者导向、内部出处不外显及缺少费率时不编造的断言；未调用真实 DeepSeek 服务。
