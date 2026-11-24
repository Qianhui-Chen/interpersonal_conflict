# 合作冲突对话实验

项目采用前后端分离结构。前端和后端是两个独立应用，运行在不同端口，通过HTTP API和CORS通信。

## 项目结构

```text
program/
├─ frontend/                 独立前端应用，默认端口4173
│  ├─ index.html
│  ├─ styles.css
│  ├─ app.js
│  ├─ config.js              后端API地址
│  ├─ server.mjs             本地静态文件服务器
│  └─ package.json
├─ backend/                  独立后端应用，默认端口4174
│  ├─ server.mjs             REST API与CORS
│  ├─ src/                   实验配置、数据库与DeepSeek适配器
│  ├─ prompts/               服务器端提示词
│  ├─ data/experiment.db     SQLite数据库
│  ├─ .env.example           后端环境变量模板
│  └─ package.json
├─ start-all.mjs             同时启动两个独立进程
└─ package.json              本地启动快捷命令
```

后端不再提供HTML、CSS或浏览器脚本；前端也无法直接访问数据库、提示词或API密钥。

## 实验分组

- 输入 `1`：Disclosure + Slow，完成代码 `CB101`
- 输入 `2`：Disclosure + Fast，完成代码 `CB102`
- 输入 `3`：Non-disclosure + Slow，完成代码 `CB103`
- 输入 `4`：Non-disclosure + Fast，完成代码 `CB104`

## 环境要求

- Node.js 22.5或更高版本（后端使用内置 `node:sqlite`）

## 一次启动前后端

在项目根目录运行：

```powershell
npm start
```

启动后：

- 前端：`http://127.0.0.1:4173`
- 后端健康检查：`http://127.0.0.1:4174/api/health`

根目录命令会启动两个独立Node进程，只是提供本地开发便利，不会把它们合并成一个应用。

## 分别启动

也可以打开两个终端。

终端一：

```powershell
cd frontend
npm start
```

终端二：

```powershell
cd backend
npm start
```

## 前端配置

后端API地址位于：

```text
frontend/config.js
```

以后前后端部署到不同域名时，只需修改这里的 `API_BASE_URL`。

## 后端与DeepSeek配置

1. 将 `backend/.env.example` 复制为 `backend/.env`。
2. 本地界面测试可保留 `DEMO_MODE=true`。
3. 正式实验改为：

```text
DEMO_MODE=false
DEEPSEEK_API_KEY=你的密钥
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-flash
FRONTEND_ORIGIN=http://127.0.0.1:4173
```

API密钥、数据库和提示词只存在于 `backend`。后端使用非流式API请求取得完整Disclosure，再由前端执行实验时间控制。

服务器端提示词：`backend/prompts/disclosure-system.txt`

固定问题、披露主题、实验条件与代码：`backend/src/config.mjs`

## 时间规则

所有条件均以 `30ms/字` 输出。

- Fast：内容准备好后立即输出，无标点停顿。
- Slow：内容准备好后继续显示三个跳动点6秒；每个中文句号停顿3秒。
- Disclosure最后一个句号的停顿同时作为问题前停顿，不重复叠加。
- 第1–5轮只有披露组调用 DeepSeek，围绕本轮固定主题并结合用户刚发送的消息生成自我披露，再另起一段显示固定问题。非披露组直接显示固定问题。
- 第六轮不生成Disclosure，只输出固定建议；完成后倒计时2秒并显示实验代码。

## 数据库

数据库仅由后端创建和访问：`backend/data/experiment.db`

每轮记录：

- `session_id`
- `condition`
- `round_number`
- `user_message`
- `generated_acknowledgment`（仅保留历史承接语记录，新记录为 NULL）
- `generated_disclosure`（Non-disclosure和第六轮为NULL）
- `fixed_question`（第六轮保存固定建议）
- `api_latency_ms`（未调用API时为NULL）
- `created_at`

浏览器只保存匿名 `session_id`，刷新后通过后端API恢复对话和轮次。

## 检查

在项目根目录运行：

```powershell
npm run check
```

正式实验前请关闭演示模式、填写DeepSeek密钥、检查提示词，并确认前端API地址与后端CORS配置一致。
