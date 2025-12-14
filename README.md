
# RenYuki: AI 驱动的 Galgame 生成器

> 基于第三方 AI 中转站（OpenAI 兼容接口）的全栈视觉小说生成 Demo  
> 从用户输入到剧本/立绘/分支剧情，全部由模型在线生成（TTS 暂时禁用）

## 1. 项目概览

RenYuki 是一个面向浏览器的交互式 Galgame 生成器，提供从前端到后端的一整套流水线：

- 用户输入：名字、剧情设定，可选上传男女主照片
- 服务端：调用第三方 AI 中转站生成结构化 JSON 剧本、立绘图片、场景背景（TTS 暂时禁用）
- 客户端：以视觉小说形式渲染，包含分支选择、好感度系统、本地存档/读档

本仓库主要用于展示「如何用第三方 AI 中转站构建完整的生成式应用」，包含 API 设计、前端播放体验、PWA、以及 Edge 环境适配等实践。

## 2. 核心能力

### 2.1 角色立绘与人脸融合

- 支持上传真人照片作为主角/女主的脸部素材
- 服务端使用 `doubao-seedream-4-5-251128` 生成人物立绘/背景，并尽量保持人脸特征一致
- 未上传照片时，自动生成 Kyoto Animation 风格的动漫角色
- 客户端做一次简易扣图（白底洪水填充 + 羽化），把白色背景抠除为透明 PNG

### 2.2 分支剧本与好感度

- 服务端通过 `gemini-2.5-flash`（可用 `LINGYAAI_CHAT_MODEL` 覆盖）输出严格 schema 的 JSON：
  - `GameScript` / `StoryNode` / `Choice` 结构见 `types.ts`
  - 每个节点包含：中/日文台词、角色身份、表情、背景 prompt、BGM key、可选分支
- `VisualNovelPlayer` 根据节点驱动剧情：
  - 线性剧情通过 `nextNodeId` 串联
  - 分支选择会修改好感度 `affinity`，最终在结局页展示

### 2.3 语音与音频系统

- TTS：暂时禁用（`POST /api/generate-voice` 返回 410）
- BGM：静态 mp3 存放在 `public/music/`
  - `GameCreationWizard` 首次生成时将所有 BGM 文件转为 base64 缓存
  - `VisualNovelPlayer` 根据节点的 `bgm` 字段选择曲目
  - 内置简单 cross-fade 实现无缝切换

### 2.4 本地存档与读档

- 使用 IndexedDB (`services/storageService.ts`) 存储完整存档：
  - 当前节点 ID
  - 好感度
  - 剧本结构
  - 所有生成的立绘/背景/TTS/BGM base64
  - 用户头像信息
- 支持功能：
  - 自动存档：生成完成后自动写入一份存档
  - 手动存档：结局页/播放中支持再次保存
  - 存档列表：主页“记忆库”展示最近的存档
  - 导入/导出：存档以 JSON 文件导出，可在其他环境导入恢复

### 2.5 PWA 与移动端体验

- 使用 Next.js App Router + `manifest.webmanifest` + 自定义 `service-worker.js`
- 针对移动端做了一些工程化处理：
  - iOS：引导用户“添加到主屏幕后再使用”，解决自动播放/全屏限制
  - Android：监听 `beforeinstallprompt`，提供 PWA 安装提示弹层
  - 横屏要求：检测 `pointer: coarse` 与 `orientation`，在手机上强制横屏体验
  - 全屏控制：顶栏提供全局全屏切换按钮

## 3. 架构与目录结构

**技术栈**

- 前端：Next.js (App Router) + React 18 + TypeScript
- UI：Tailwind CSS（通过 CDN 注入）
- AI 接入：第三方 AI 中转站（OpenAI 兼容的 Chat Completions + Images Generations 接口）
- 存储：IndexedDB（浏览器本地），无服务端数据库

**主要目录**

- `app/`  
  - `layout.tsx`：全局布局、PWA 与字体配置  
  - `page.tsx`：Next 入口，渲染 `App.tsx`  
  - `api/*`：Next.js API Routes（脚本生成、立绘生成、TTS、任务系统、健康检查）
- `App.tsx`  
  - 整个前端应用的状态机：主页、创建向导、播放、Dev Console、PWA/Paywall/横竖屏控制
- `components/`  
  - `GameCreationWizard.tsx`：创建新嘎拉，采集用户输入并调用后端生成  
  - `VisualNovelPlayer.tsx`：视觉小说播放器，处理 BGM、分支选择、好感度显示  
  - `DevConsole.tsx`：开发/调试面板，包含 Edge 任务模式  
  - 其他基础组件：`Button`, `Typewriter`, `LoginScreen` 等
- `services/`  
  - `aiService.ts`：前端调用 `/api/*` 封装（脚本/立绘/背景）  
  - `storageService.ts`：IndexedDB 存档服务  
  - `edgeoneTasks.ts`：异步任务 API 封装（配合 `/api/tasks/*`）
- `lib/`  
  - `aiServer.ts`：服务端 AI 编排（脚本/立绘/背景/BGM 加载）  
  - `taskStore.ts`：内存任务存储，用于简易异步任务接口  
  - `taskGenerator.ts`, `aiServer.ts` 等辅助逻辑
- `functions/api/`  
  - 为腾讯云 EdgeOne Pages Functions 准备的无状态接口实现
- `public/`  
  - `music/`：BGM mp3  
  - `icons/`：PWA 相关图标  
  - `service-worker.js`, `manifest.webmanifest`
- `pay/`  
  - 打赏二维码与展示图片（前端 Paywall UI 使用）

## 4. 本地开发

### 4.1 环境准备

1. Node.js 18+  
2. 安装依赖：

```bash
npm install
```

3. 环境变量：在仓库根目录创建 `.env.local`：

```bash
LINGYAAI_API_KEY=你的_API_Key

# 可选：禁用“每日一次”生成限制（开发/自部署场景）
# DISABLE_DAILY_LIMIT=true

# 可选：前端调用 API 的基准地址（默认为空，即与 Next 应用同源）
# NEXT_PUBLIC_API_BASE=https://your.domain.com
```

手动用 cURL 复现“剧本生成”文本请求（与服务端同一 developer/user 消息结构）：

```bash
API_KEY=你的_API_Key
chmod +x ./scripts/lingya_generate_script.sh
API_KEY=$API_KEY ./scripts/lingya_generate_script.sh --raw
```

开发者模式查看“模型原始 JSON”（不做解析/校验/修补）：

- `POST /api/dev/generate-raw`

分段续写（到达 `nodeType: "user_choice"` 节点后，玩家输入一句话，服务端继续生成下一段）：

- `POST /api/continue-script`

> 注意：`LINGYAAI_API_KEY` 只在服务端使用，不会暴露给前端。

### 4.2 启动与调试

开发模式：

```bash
npm run dev        # http://localhost:3000
```

构建与生产运行：

```bash
npm run build
npm run start
```

代码规范检查：

```bash
npm run lint
```

### 4.3 手动验证流程（推荐）

1. 启动开发服务：`npm run dev`
2. 打开浏览器访问 `http://localhost:3000`
3. 主要流程：
   - 在首页进入“创建新嘎拉”
   - 输入主角/女主名字，可选上传照片
   - 填写剧情设定（中文/英文皆可）
   - 提交后等待生成（约 2–3 分钟，依赖网络与模型速度）
   - 生成完成后自动进入游玩界面
   - 随机选择分支，看好感度变化
   - 在结局页点击“存档”，然后回到首页进入“记忆库”读取

## 5. API 设计概览

### 5.1 Next.js API Routes

所有 API 位于 `app/api/*` 下，部分关键路由如下：

- `POST /api/generate-script`  
  入参：`{ protagonistName, heroineName?, plotDescription? }`  
  出参：`GameScript`

- `POST /api/generate-image`  
  入参：`{ prompt }`  
  出参：`{ imageUrl }`（背景图 URL，前端再下载）

- `POST /api/generate-protagonist`  
  入参：`{ emotion, userPhotoBase64?, referenceImageBase64?, mimeType? }`  
  出参：`{ imageUrl }`（主角立绘 URL，前端再下载）

- `POST /api/generate-heroine`  
  入参：`{ emotion, referenceImageBase64?, userPhotoBase64?, mimeType? }`  
  出参：`{ imageUrl }`（女主立绘 URL，前端再下载）

- `POST /api/generate-voice`  
  入参：`{ text }`  
  当前：410（TTS 暂时禁用）

### 5.2 异步任务接口（内存实现）

位于 `app/api/tasks/*`，配合 `services/edgeoneTasks.ts` 使用：

- `POST /api/tasks/generate`  
  入参：与 `/api/generate-script` 类似  
  行为：创建一个任务 ID，立即生成脚本并将 JSON 字符串写入内存任务结果

- `GET /api/tasks/status?task_id=...`  
  返回任务状态：`pending | running | done | error`

- `GET /api/tasks/download?task_id=...`  
  若任务完成，则以文件下载方式返回脚本 JSON

> 注意：这里的任务存储是基于 Node.js 进程内存，没有持久化，也不适合生产环境。主要用于演示 Edge/Pages 场景下的简单异步模型。

## 6. EdgeOne Pages Functions 集成

仓库包含 `functions/api` 目录，可用于部署到腾讯云 EdgeOne Pages Functions：

```text
functions/api/generate.js   # 同步生成并返回 JSON（带下载 header）
functions/api/status.js     # 410，提示改用 POST /api/generate
functions/api/download.js   # 410，提示改用 POST /api/generate
```

使用建议：

1. 无需 KV/数据库，所有数据在响应中直接返回
2. 如需将生成逻辑代理到私有后端，可在 Edge 环境设置 `AI_BACKEND_URL`，在 `_shared/generator.js` 中转发
3. 前端可通过设置 `NEXT_PUBLIC_EDGEONE_API_BASE` 指向 EdgeOne 域名

## 7. 安全与合规说明

- **API Key 安全**  
  - 仅在服务端通过 `process.env.LINGYAAI_API_KEY`（或 `process.env.API_KEY`）读取  
  - 不在客户端 bundle 中泄漏，不通过接口下发

- **数据持久化**  
  - 服务器不写入数据库或对象存储  
  - 任务结果与生成内容只在请求生命周期内或 Node 进程内存中存在  
  - 用户生成的图片/音频/剧本只保存在浏览器本地 IndexedDB

- **内容合规**  
  - README 与 UI 中已提示用户不要上传违法、色情、暴力或侵犯他人肖像权的图片  
  - 使用者需要自行确保在法律与服务条款允许的范围内使用模型与本项目

## 8. 部署建议

项目基于标准 Next.js 架构，可部署到任意支持 Node.js 的平台，例如：

- Vercel（最推荐）
- Render / Railway
- 自建 Node.js 服务器 / 容器环境

部署要点：

- 设置环境变量 `LINGYAAI_API_KEY`
- 部署前运行 `npm run build`，确保类型和 ESLint 通过
- 如使用自定义前后端域名，可配置 `NEXT_PUBLIC_API_BASE`

## 9. License

MIT License
