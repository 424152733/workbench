# 保险顾问工作台 · 一期

一期当前包含「客户与保单」和「大话保险」两部分，前端为 React + Ant Design，后端为 NestJS（JavaScript），数据保存在 PostgreSQL。

## 本地运行

需要 Node.js 20 或更新版本、PostgreSQL 15 或更新版本、Bun，以及 Runware API Key。

```sh
npm install
cp .env.example .env
```

先在本地 PostgreSQL 创建数据库，并把连接地址写入 `.env`：

```sh
createdb insurance_workbench
```

启动前端和后端：

```sh
npm run dev:stack
```

`npm run dev:all` 是一键启动命令，`npm run dev:stack` 是同一命令的兼容别名。它会同时启动前端、NestJS API 和本机技能运行器，任一服务退出时会收尾其他服务；按 Ctrl+C 会一起停止。Vite 页面默认使用 `http://localhost:5173`，NestJS API 默认使用 `http://localhost:3001/api`。API 启动时会执行 `backend/schema.sql`，建表并写入可重复运行的示例数据。技能运行器默认监听 `127.0.0.1:3020`。

也可以分开启动：

```sh
npm run dev       # React / Vite
npm run dev:api   # NestJS API
```

## GPT 与技能运行器

在 `.env` 中设置 `RUNWARE_API_KEY`。工作台通过 Runware 的 OpenAI Responses 兼容接口，使用 GPT-6 Luna 生成选题和三平台初稿，并把每个平台的正文交给项目内的 `humanizer-zh` 指令润色。点击「调用 baoyu 生成」时，小红书使用 `baoyu-xhs-images`，知乎和公众号使用 `baoyu-article-illustrator` 分析文章并拆分配图；随后运行器通过 Runware 原生图像 API 调用 GPT-Image-2.5 Flare 逐张生成图片。所有文本步骤与图像步骤共用同一个 Runware API Key。

`npm run dev:stack` 会自动启动本机技能运行器。默认文本模型由 `RUNWARE_TEXT_MODEL` 控制，值为 `openai:gpt@6-luna`；图像模型由 `RUNWARE_IMAGE_MODEL` 控制，值为 `openai:gpt-image@2.5-flare`。图片批次并发数和超时时间可分别用 `BAOYU_IMAGE_BATCH_SIZE` 和 `BAOYU_IMAGE_BATCH_TIMEOUT_MS` 调整。`SKILL_RUNNER_URL` 默认是 `http://127.0.0.1:3020`；单独运行时，可在一个终端执行 `npm run dev:skill-runner`，另一个终端运行 API 和前端。技能运行器默认只监听本机；如需改为网络监听，需设置 `SKILL_RUNNER_HOST` 和 `SKILL_RUNNER_TOKEN`，并限制网络访问。

内容页图文预览卡片中的「样式设置」可以设置小红书生图模式：测试模式固定生成 1 张，生产模式由 Baoyu 根据内容规划 3–5 张卡片；模式默认是测试。视觉风格、卡片布局和配色，以及公众号/知乎文章插图的图示类型、风格和配色也可以配置。模式保存在 PostgreSQL 的 `settings.content.xhsImageMode`。若 Baoyu 规划的张数不符合所选模式，会在提交付费生图请求前报错。图片批次并发数由 `BAOYU_IMAGE_BATCH_SIZE` 单独控制，不会改变卡片总数。公众号 HTML 正文另有清爽简约、温暖柔和、杂志清晰三种排版样式。样式和排版设置保存在 PostgreSQL 的 `settings.content.imageStyles` 和 `settings.content.wechatTheme`，影响之后生成的图片或稿件。

Humanizer 和 baoyu 技能源码放在 `.agents/skills/`，项目偏好配置放在 `.baoyu-skills/`。上游来源、版本和许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。工作台不会登录或代发到知乎、小红书或微信公众号。

## 测试

后端集成测试需要一个可丢弃的 PostgreSQL 测试库：

```sh
npm run test:api
npm run build
```

测试会通过 NestJS HTTP API 验证客户、保单、稿件审核、排期、导出和图片资源流程，并使用假的 Responses API 与图片生成器验证 skill runner。测试需要可丢弃的 PostgreSQL 数据库，设置 `DATABASE_URL` 后运行；不要把生产库用于测试。测试不会调用真实模型或生成真实图片。

## 主要实现位置

- `src/App.jsx`：工作台页面和交互。
- `src/api.js`：前端 API 客户端。
- `backend/api.controller.js`：NestJS 路由。
- `backend/workbench.service.js`：客户与内容工作流。
- `backend/skill-runner.js`：加载项目内的 Humanizer 与 Baoyu 技能指令，并运行 Baoyu 图片生成脚本。
- `.agents/skills/`：humanizer-zh 与 baoyu 图文技能及其上游参考文件。
- `backend/schema.sql`：PostgreSQL 表和示例数据。
- `backend/test/api.test.js`：HTTP + PostgreSQL 集成测试。
