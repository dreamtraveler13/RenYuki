
# RenYuki: AI 驱动的 Galgame 生成器

> 基于第三方 AI 中转站（OpenAI 兼容接口）的全栈视觉小说生成 Demo  
> 从用户输入到剧本/立绘/分支剧情，全部由模型在线生成

## 1. 项目概览

RenYuki 是一个面向浏览器的交互式 Galgame 生成器，提供从前端到后端的一整套流水线：

- 用户输入：名字、剧情设定，可选上传男女主照片
- 服务端：调用第三方 AI 中转站生成结构化 JSON 剧本、立绘图片、场景背景
- 客户端：以视觉小说形式渲染，包含分支选择、好感度系统、本地存档/读档

本仓库主要用于展示「如何用第三方 AI 中转站构建完整的生成式应用」，包含 API 设计、前端播放体验、PWA 等实践。

## 2. 核心能力

### 2.1 角色立绘与人脸融合

- 支持上传真人照片作为主角/女主的脸部素材
- 服务端使用 `doubao-seedream-4-5-251128` 生成人物立绘/背景，并尽量保持人脸特征一致
- 未上传照片时，自动生成 Kyoto Animation 风格的动漫角色
- 客户端做一次简易扣图（白底洪水填充 + 羽化），把白色背景抠除为透明 PNG

### 2.2 分支剧本与好感度

- 服务端通过 `gemini-3-flash-preview`（可用 `LINGYAAI_CHAT_MODEL` 覆盖）输出严格 schema 的 JSON：
  - `GameScript` / `StoryNode` / `Choice` 结构见 `types.ts`
  - 每个节点包含：中/日文台词、角色身份、表情、背景 prompt、BGM key、可选分支
- `VisualNovelPlayer` 根据节点驱动剧情：
  - 线性剧情通过 `nextNodeId` 串联
  - 分支选择会修改好感度 `affinity`，最终在结局页展示

### 2.3 音频系统

- BGM：静态 mp3 存放在 `public/music/`
  - `GameCreationWizard` 首次生成时将所有 BGM 文件转为 base64 缓存
  - `VisualNovelPlayer` 根据节点的 `bgm` 字段选择曲目
  - 内置简单 cross-fade 实现无缝切换

### 2.4 本地存档与读档

- 使用 IndexedDB (`services/storageService.ts`) 存储完整存档：
  - 当前节点 ID
  - 好感度
  - 剧本结构
  - 所有生成的立绘/背景/BGM base64
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
- `api/*`：Next.js API Routes（脚本生成、立绘生成、健康检查）
- `App.tsx`  
  - 整个前端应用的状态机：主页、创建向导、播放、PWA/Paywall/横竖屏控制
- `components/`  
  - `GameCreationWizard.tsx`：创建新嘎拉，采集用户输入并调用后端生成  
  - `VisualNovelPlayer.tsx`：视觉小说播放器，处理 BGM、分支选择、好感度显示  
  - 其他基础组件：`Button`, `Typewriter`, `LoginScreen` 等
- `services/`  
  - `aiService.ts`：前端调用 `/api/*` 封装（脚本/立绘/背景）  
  - `storageService.ts`：IndexedDB 存档服务
- `lib/`  
  - `aiServer.ts`：服务端 AI 编排（脚本/立绘/背景/BGM 加载）
- `public/`  
  - `music/`：BGM mp3  
  - `icons/`：PWA 相关图标  
  - `service-worker.js`, `manifest.webmanifest`

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

# 账号鉴权（建议必填，用于签发登录 Cookie）
AUTH_SECRET=一个足够长的随机字符串

# PostgreSQL（云端数据库）
DATABASE_URL=postgresql://user:password@host:5432/renyuki?sslmode=require

# 可选：前端调用 API 的基准地址（默认为空，即与 Next 应用同源）
# NEXT_PUBLIC_API_BASE=https://your.domain.com

# 聚合支付（易支付 V2 / RSA，推荐）
EPAY_BASE_URL=https://pays.org.cn
EPAY_PID=你的PID
EPAY_MCH_PRIVATE_KEY=你的商户私钥（PEM 或纯Base64均可）
EPAY_PLATFORM_PUBLIC_KEY=平台公钥（PEM 或纯Base64均可）
# 可选：强制校验 create/query 响应签名（默认只校验 notify 回调签名）
EPAY_REQUIRE_RESPONSE_SIGN=1

# 旧版（ZPAY/易支付 V1 / MD5，兼容保留，可选）
ZPAY_BASE_URL=https://zpayz.cn
ZPAY_PID=你的PID
ZPAY_PKEY=你的商户密钥

# 用于支付回调/跳转拼接公网地址（上线建议填写）
PUBLIC_BASE_URL=https://your.domain.com
```

初始化数据库（首次部署）：

```bash
psql "$DATABASE_URL" -f ./scripts/schema.sql
```

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

## 6. 安全与合规说明

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

## 7. 部署建议

项目基于标准 Next.js 架构，可部署到任意支持 Node.js 的平台，例如：

- Vercel（最推荐）
- Render / Railway
- 自建 Node.js 服务器 / 容器环境

部署要点：

- 设置环境变量 `LINGYAAI_API_KEY`
- 部署前运行 `npm run build`，确保类型和 ESLint 通过
- 如使用自定义前后端域名，可配置 `NEXT_PUBLIC_API_BASE`

## 8. License

MIT License
