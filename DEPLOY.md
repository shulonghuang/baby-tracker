# 宝宝喂养追踪 - 多人同步部署指南

## 前提条件
1. 一个 GitHub 账号（免费注册：github.com）
2. 一个 Render 账号（免费注册：render.com，可用 GitHub 直接登录）

## 5 分钟部署步骤

### 第 1 步：上传代码到 GitHub

1. 登录 github.com → 右上角 "+" → "New repository"
2. Repository name 填: `baby-tracker`
3. 选择 **Private**（私人仓库）
4. 点击 "Create repository"
5. 在新页面点击 "uploading an existing file"
6. 将以下 5 个文件**拖拽**到上传区：
   - `server.js`
   - `package.json`
   - `render.yaml`
   - `.gitignore`
   - `public/index.html`
7. 点击 "Commit changes"

### 第 2 步：部署到 Render

1. 登录 render.com → 右上角 "New +" → "Web Service"
2. 选择 "Connect a repository" → 找到 `baby-tracker` → Connect
3. 配置页面：
   - Name: `baby-tracker-api`（默认即可）
   - Build Command: `npm install`
   - Start Command: `npm start`
   - **Free Instance Type** 已默认选中（免费）
4. 点击底部的 "Create Web Service"
5. 等待 2-3 分钟，部署完成后会显示绿色 "Live" 状态
6. 复制你的服务地址（类似 `https://baby-tracker-api.onrender.com`）

### 第 3 步：连接前端

1. 在手机浏览器打开喂养追踪页面
2. 点击右上角 "👨‍👩‍👧 家庭同步"
3. 粘贴 Render 服务地址
4. 点击 "连接服务器" → "创建房间"
5. 获得 6 位房间码，分享给爷爷奶奶

### 第 4 步：家人加入

1. 家人在自己手机打开同一个链接
2. 点击 "👨‍👩‍👧 家庭同步"
3. 粘贴 Render 服务地址
4. 点击 "连接服务器" → "加入房间"
5. 输入 6 位房间码和昵称

---

**注意事项：**
- Render 免费版在 15 分钟无请求后会休眠，首次访问需等 30-60 秒唤醒
- 数据存储在 Render 服务器上，免费额度足够家庭日常使用
- 前端页面地址不变：https://a445c1d851cf41d4a2cfcaef2809bc0f.bj7.agentos-app.net
