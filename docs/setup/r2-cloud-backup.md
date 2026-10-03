# Cloudflare R2 云备份 — 5 分钟完整设置指南

> **背景**：Chrome「清除浏览数据 → 网站数据」会把 IndexedDB 整个清空，导致 PWA 内本地备份一起死。本指南带你把每日自动备份加密快照同步推一份到 Cloudflare R2，从此 Chrome 清缓存不再丢数据。
>
> **预计耗时**：5 分钟（其中 4 分钟是点 UI）
>
> **需要的东西**：Cloudflare 账号（免费）、Vercel 账号（已有）、浏览器
>
> **前置条件**：项目已经部署到 Vercel（或本地 dev server 跑 `server.ts`）

---

## 总览：8 步走完

```
1. Cloudflare 创建 R2 bucket                          [30s]
2. Cloudflare 创建 API token（4 个值）                 [1min]
3. Vercel 配 4 个环境变量                             [1min]
4. 等待 Vercel 自动 redeploy                          [30s]
5. （仅本地 dev）配 .env.local                        [30s]
6. 跑验证脚本确认链路通                              [10s]
7. 打开 app → 设置 E2EE 密码 + 启用 R2 备份          [30s]
8. 点「立即推送」做端到端验证                        [10s]
```

---

## 第 1 步：Cloudflare 创建 R2 bucket

1. 登录 [dash.cloudflare.com](https://dash.cloudflare.com)
2. 左侧菜单点 **R2** → **Object Storage**
3. 如果首次访问会要求：
   - 绑定支付方式（**不会扣费**，免费层 10GB 存储 + 1000万次/月操作）
   - 选区域（**Auto** 即可，让 Cloudflare 智能调度）
4. 点 **Create bucket**
5. 填：
   - **Bucket name**：例如 `baimiao-backups`（**全小写、无空格**；这就是后面 `R2_BUCKET` 的值）
   - **Location**：选 `Automatic`（推荐）或离你最近的区域
6. 点 **Create bucket**

✅ 完成。**记下你的 bucket 名**（例：`baimiao-backups`）。

---

## 第 2 步：Cloudflare 创建 API token

> 严格按步骤来，**Secret Access Key 只显示一次**，不存就找不回来。

1. 仍在 R2 页面 → 右上角 **Manage R2 API Tokens**（或左侧菜单 **R2** → **Overview** → **Manage R2 API Tokens**）
2. 点 **Create API Token**
3. 配置：
   - **Token name**：任意描述性名，如 `baimiaobiji-backup`
   - **Permissions**：**Object Read & Write**（不能选 Read only，否则 PUT 会被拒）
   - **Bucket scope**：选 **Apply to specific buckets only** → 选中刚才创建的 bucket（**最小权限原则**，避免 token 通配所有 bucket）
   - **TTL**：选 **Forever**（推荐；或自定义过期日期，过期后需重发）
4. 点 **Create API Token**
5. **弹窗显示 4 个值**，**立即全部复制保存**到密码管理器 / 临时文本：
   - **Access Key ID**（如 `a1b2c3d4e5f6...`）
   - **Secret Access Key**（如 `longRandomString...`，**只显示这一次**）
   - **Endpoint URL**：形如 `https://<account-id>.r2.cloudflarestorage.com`，记下 `<account-id>` 部分
   - **Bucket**：刚才的 bucket 名

> ⚠️ **Secret Access Key 弹窗关掉就没了**。如果没存，重发 token 即可。

✅ 完成。**你手里现在有 4 个值**：
- `R2_ACCOUNT_ID`（从 Endpoint URL 截取）
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`（bucket 名）

---

## 第 3 步：Vercel 配环境变量

1. 登录 [vercel.com](https://vercel.com) → 选你的项目
2. 顶部 **Settings** → 左侧 **Environment Variables**
3. 依次添加 4 个变量（点 **Add New**）：

| Key | Value | Environment |
|---|---|---|
| `R2_ACCOUNT_ID` | 第 2 步记下的值 | Production + Preview + Development（勾全选） |
| `R2_ACCESS_KEY_ID` | 第 2 步记下的值 | 全选 |
| `R2_SECRET_ACCESS_KEY` | 第 2 步记下的值 | 全选 |
| `R2_BUCKET` | bucket 名 | 全选 |

> ⚠️ `R2_SECRET_ACCESS_KEY` 是敏感凭据。Vercel 加密存储，且勾全选意味着 Preview/Development 也能用。安全上没问题（你个人项目），但生产项目应只勾 Production。

4. 全部加完后点 **Save**

✅ 完成。

---

## 第 4 步：等 Vercel 自动 redeploy

环境变量改了之后，**Vercel 会自动触发一次 redeploy**。去项目的 **Deployments** tab 看：

- 最上面那条从「Building」→「Ready」约 30-90 秒
- 完成后 `/api/r2-presign` 端点才会真正读到你刚才配的环境变量

✅ 完成。

---

## 第 5 步：（仅本地开发）配 `.env.local`

> 如果只在 Vercel 跑应用、不本地 dev，跳过此步。

1. 在项目根目录（`D:/baimiaobiji`）复制 `.env.example` 为 `.env.local`：
   ```bash
   cp .env.example .env.local
   ```
2. 在 `.env.local` 里把 4 个 `R2_*` 的值替换成你的真实值
3. **不要**提交 `.env.local`（已在 `.gitignore`）

✅ 完成。

---

## 第 6 步：跑验证脚本（推荐，但可选）

脚本会跑完整的 presign + PUT + list + GET 链路，任何一环失败会给出具体错误和建议：

```bash
cd /path/to/baimiaobiji
npx tsx scripts/verify-r2.ts
```

**预期成功输出**：
```
🔍 R2 备份链路验证 (Issue #009)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 探测服务 /api/r2-presign (kind=put)...
   ✅ 拿到签名 URL (5min TTL)
   ✅ 用签名 URL PUT 测试 blob 成功 (HTTP 200)
📡 探测服务 /api/r2-presign (kind=get)...
   ✅ 拿到 GET 签名 URL
   ✅ 用签名 URL 下载并校验内容一致
📡 探测服务 /api/r2-list...
   ✅ 列出对象成功，找到测试 blob

🎉 整条链路通！可以打开 app 启用云备份了。
```

**常见失败与对策**：

| 报错关键词 | 原因 | 对策 |
|---|---|---|
| `503 R2 未在服务端配置` | 服务端 4 个 env 缺失 | 回第 3/5 步检查 Vercel 或 `.env.local` |
| `403 SignatureDoesNotMatch` | `R2_ACCESS_KEY_ID` 或 `R2_SECRET_ACCESS_KEY` 错 | 回第 2 步重新复制 token 值 |
| `404 NoSuchBucket` | `R2_BUCKET` 名错或 bucket 不存在 | 回第 1 步确认 bucket 名一字不差 |
| `InvalidAccessKeyId` | `R2_ACCESS_KEY_ID` 失效/被删 | 去 Cloudflare R2 → API Tokens 看 token 是否还 active |
| 网络超时 / fetch failed | 本地跑但服务没起 / Vercel 未 redeploy 完成 | 等 redeploy 完成；本地跑则需先 `npm run dev` |

✅ 完成。

---

## 第 7 步：App 内启用

1. 打开 app（部署后的 URL 或本地 `http://localhost:3000`）
2. 进 **设置** → **数据管理** → **加密云同步**
   - 如果没设过 E2EE 密码：在「应用密码 / 密钥」字段设一个强密码（**重要：记下来，丢失 = 云备份无法恢复**）
   - 勾「在这台设备上记住密码」（可选项，看你设备安全程度）
3. 进 **设置** → **数据管理** → **云备份（Cloudflare R2）**
   - 看顶部状态应是「🟢 已启用」开关可用（如显示「需先在加密云同步里设置 E2EE 密码」说明第 1 步没做）
   - **Bucket 名**：填你的 `R2_BUCKET` 值（默认与 env 一致）
   - **Key 前缀**：默认 `baimiaobiji`，可改
   - 打开 **启用** 开关
4. 点 **测试连接** → 应该显示「R2 连接正常（签名成功）」

✅ 完成。

---

## 第 8 步：端到端验证

点 **立即推送当前备份**：

- 几秒后状态行显示「最近上传成功：2026-08-20 14:32」
- 切到 Cloudflare dashboard → R2 → 你的 bucket → 应能看到 `baimiaobiji/2026-08-20/<uuid>.enc` 一个对象

如果失败，看 **失败消息**红字 + browser DevTools console：
- `R2 presign PUT 失败 (503)` → 服务端配置问题，回第 3 步
- `R2 PUT 失败 (403)` → token 权限错或 bucket 名错，回第 1/2 步
- `R2 PUT 失败 (网络)` → CSP / 网络问题，看 console 详细

✅ 完成。**此后每日自动备份会自动推一份加密快照到 R2**。Chrome 清缓存 / 重装浏览器 / 换设备后从 Settings → 云备份（R2） → 列出 → 选最新一条 → 恢复即可。

---

## 排错快速参考

| 症状 | 优先检查 |
|---|---|
| Settings 没看到「云备份（R2）」section | 浏览器硬刷新（Ctrl+Shift+R），确认 build 已包含 Issue #009 |
| toggle 灰掉 | E2EE 密码未设，回第 7 步前两段 |
| 「立即推送」一直转圈 | 看 console；大概率是 E2EE 密码为空 |
| R2 dashboard 看不到新对象 | 检查 prefix 是否配置错（Settings UI 显示什么） |
| bucket 里看到对象但恢复时解密失败 | E2EE 密码输错了；R2 端无法看到明文是预期的 |

---

## 安全说明（必读）

1. **E2EE 密码 = 唯一钥匙**：R2 上的对象是 AES-GCM-256 加密的，丢失密码 = 数据永久无法恢复。建议存到密码管理器（1Password / Bitwarden）。
2. **Secret Access Key 不要发给别人**：包括截图。如果你怀疑泄露，去 Cloudflare → API Tokens → Delete 重发。
3. **`.env.local` 不要 commit**：已在 `.gitignore` 里，但手动检查一下。
4. **token TTL**：选 Forever 是个人项目的常规做法。如果担心泄露风险，可设短 TTL（如 90 天）到时换。

---

## 下一步（可选）

- **多设备同步**：本指南只解决「防数据丢失」。若想在多设备间实时同步，需要 D1 + 实时同步层，是更大的架构变更，不在本 issue 范围。
- **自动 prune R2 端对象**：当前上传只 push 不清理。如果你 1 年没动 R2，会一直累积。后续 issue 可加「保留最近 30 天 R2 对象」功能。
- **撤销 token**：去 Cloudflare → API Tokens → Delete 即可立即失效。删除后现有签名 URL 5 分钟内还能用（已签发的 URL TTL 不变），之后全部失效。
## R2 API 访问令牌与目录权限

服务端现在要求 `R2_OWNER_TOKEN`（至少 32 字符）。使用 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 生成随机值，Express 请放进 `.env`（或通过 `DOTENV_CONFIG_PATH` 指向配置文件），Vercel 请在服务端环境变量中设置，并在设置页的「R2 访问令牌」输入同一值。令牌只保存在当前标签页的 sessionStorage；重新打开标签页后，需要重新输入，自动云备份才能继续。它与 E2EE 加密密码独立，不得使用 `VITE_` 环境变量或放进前端构建。

`R2_BUCKET` 是唯一允许访问的 bucket。`R2_KEY_PREFIX` 是服务端允许的目录根，默认为 `baimiaobiji`；浏览器可使用它的子目录。空列表前缀只列这个目录，不能列整个 bucket。原来使用其他目录的部署应把服务端目录根配置成原来的目录。

验证脚本同样从环境读取 `R2_OWNER_TOKEN` 与 `R2_KEY_PREFIX`，仅对 `/api/r2-presign` 和 `/api/r2-list` 发送 Bearer 令牌。R2 预签名对象 URL 不接收此令牌。

服务端 `GOOGLE_API_KEY` 后备密钥只用于 Google 官方 Gemini 地址。自定义 Gemini 代理需要用户自己的 API Key。AI/WebDAV 出站请求不再跟随重定向；请配置最终服务地址。WebDAV 仍支持 `.local` NAS，并保留协议、凭据和端口限制。
