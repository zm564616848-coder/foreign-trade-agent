# 智能问答 Agent 开通

本版本新增私人知识库与带来源问答。**当前没有真实 Supabase 项目或模型密钥，真实服务尚未开通。** 入口、后端、数据库脚本及测试已准备；不要把模拟测试当作真实 AI 回答验证。

## 1. 创建知识库数据库与私有文件存储

在 https://supabase.com 创建自己的项目，可先选择免费套餐（可用额度以平台实际显示为准），不要为了本应用自动升级付费计划。

1. 打开项目的 **SQL Editor**，执行仓库 [database/knowledge.sql](database/knowledge.sql)。它创建资料表、向量索引结构、行级访问策略、每日调用计数和私有存储桶 `logihub-knowledge`。
2. 在 **Authentication → Users** 创建一个自己的知识库用户（邮箱与密码）。这是本应用登录账号，与 Supabase 控制台账号不是一回事。私人使用时关闭允许公众注册，只创建你授权的用户。
3. 从项目设置取得 **Project URL** 和 **anon/public key 或 publishable key**。应用使用用户登录态和行级权限访问资料，**不需要 service_role 密钥**。

数据库策略目前为按用户隔离：用户只能读取、修改自己的资料和自己的存储路径。模型额度每日最多 30 次提问、10 次资料索引，由数据库原子计数；失败调用仍计入额度。创建项目后必须以两个独立用户实测隔离，当前没有真实项目，因此这一步尚未执行。

## 2. 开通模型 API

默认使用 OpenAI API：https://platform.openai.com/ 。ChatGPT 网页订阅不等于 API 额度；是否开通和费用由你在供应商平台确认，本实现没有购买任何套餐或触发真实模型消费。

- 回答及图片/视频画面分析：`gpt-4.1-mini`，可通过 `AGENT_LLM_MODEL` 设置兼容的视觉模型。
- 语义向量：`text-embedding-3-small`，固定 1536 维，与数据库定义一致。
- 模型 API Key 只放后端安全环境变量。不要发到聊天、截图、GitHub、前端 HTML 或 JavaScript。

如果未来改用其他供应商，需要对应适配及重新验证，不能只替换模型名称就声称兼容。

## 3. 在 Render 后端配置

已有服务：`foreign-trade-agent`。在 **Environment** 添加：

| 变量名 | 内容 |
| --- | --- |
| `AGENT_SUPABASE_URL` | 项目 URL，例如你自己的 `https://项目编号.supabase.co` |
| `AGENT_SUPABASE_ANON_KEY` | 该项目的 anon/public key 或 publishable key |
| `AGENT_LLM_API_KEY` | 你自己的模型 API 密钥，安全填写 |
| `AGENT_LLM_MODEL` | `gpt-4.1-mini` |

保存并重新部署。建议 Build Command 使用 `npm ci --cache /tmp/logihub-npm-cache && npm run check && npm test`，Start Command 为 `npm start`。旧服务的 `npm run check && npm test` 也有 `precheck` 兼容逻辑：仅在依赖缺失或版本不匹配时按 lockfile 安装，不修改依赖声明。

知识库资料和文件保存在 Supabase，不依赖 Render 免费实例的临时磁盘。免费 Render 冷启动可能需要等待，模型调用与数据库连接也可能增加处理时间。

同名变量也已在本聊天的云环境草稿中声明（不含值），云环境代理访问还需应用对应的 `api.openai.com`、`*.supabase.co` 网络规则。云环境配置与 Render 配置是独立的，不会自动同步密钥。云环境 Node.js 24 如有 HTTPS 代理，可用 `NODE_USE_ENV_PROXY=1 npm start` 保留代理路由和 TLS 验证。

## 4. 使用及功能边界

在工作台点击 **智能问答 Agent**，进入 Render 的 `agent.html`。GitHub Pages 只提供物流目录入口，Agent 登录、上传与问答由 Node 服务处理。

1. 使用创建的知识库邮箱和密码登录。
2. 上传 PDF、DOCX、TXT、MD、CSV、JPG、PNG、WebP、MP4 或 WebM；每份最多 20 MB，图片最多 8 MB。
3. 等待“可检索”状态后提问。回答附引用，可点击原文、图片和视频来源。
4. 视频最多抽取 3 帧，通过模型分析各画面并保留时间点，可点击跳转对应画面。**不转录音频，也不是完整逐帧视频理解**。可补充字幕或文字说明；浏览器无法解码时会提示，不伪造视频分析。
5. 视频若最初未能建立画面索引，后续仅加说明会作为文字索引。需要重新分析画面时，请在模型开通后重新上传视频。
6. PDF 仅自动解析文字层；扫描件需上传图片或补充文字。长文只索引前 60 页/60 个片段，并明确标记截断；表格 CSV 按文本检索，不提供电子表格公式执行。
7. 聊天上下文只保留本次页面会话；文件、文字分析和向量在云数据库持久保存。刷新或退出后可重新针对资料提问，但不会恢复聊天记录。

资料会通过后端发送给模型用于文字嵌入、图片分析或问答。上传文件不进入公开仓库。登录 token 使用 HttpOnly、Secure、SameSite=Strict Cookie；会话最长一小时，过期需重新登录。原资料预览链接五分钟过期，有效期内持有链接的人可访问，因此不要转发给未授权的人。

## 验证记录与待完成项

已通过自动测试：文件类型/大小、实际 PDF/Word 解析、上传与索引、向量检索、拒绝跨账号检索结果、引用编号校验、持久配额调用、视频时间点、私有文件签名、Cookie/跨站提交保护及缺少配置提示。供应商 HTTP 接口使用测试替身。

已通过 Chromium 交互：登录、文档上传、实际本地 MP4 抽帧、回答引用、图片预览、视频定位、退出后清空私密字段，以及手机/平板/桌面布局。数据库与模型仍为测试替身。

尚未完成：真实 Supabase SQL 执行及双用户 RLS/Storage 验证、真实模型授权和收费额度、实际客户资料导入、真实专业问题答案准确性验证。用户连接账号并安全配置后，应先上传一份获授权的非敏感资料，检查回答与引用一致，再逐步导入更多材料。
