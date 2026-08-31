# Lace Market AP/BABY Monitor

每 10 分钟检查 Lace Market 上以下品牌的 `Dresses` 新上架商品：

- Angelic Pretty（AP）
- Baby, the Stars Shine Bright（BABY/BTSSB）

监控直接使用 Lace Market 的官方 `New`、品牌和美国地区筛选。正常情况下每个品牌只读取第一页；若新品超过一页，则继续翻页直到找到上一轮已经见过的 URL 锚点。只有锚点之前、商品卡片带有精确 `New` 标签且详情分类属于 Dresses 的商品才发送邮件。若在配置的分页上限内找不到锚点，整轮会失败且不推进状态，避免把旧库存误报为上新。

Relist、非 Dresses 分类和非美国卖家商品不会触发通知。邮件包含商品首图、名称、品牌、价格、状态、卖家地区和可点击链接；点击图片也会打开商品页。同一商品 URL 一经处理便永久去重。浏览器会拦截图片、字体、媒体、样式表和广告/统计域名，减少住宅代理流量；商品首图 URL 仍从页面的懒加载属性中读取，邮件图片不受影响。

从旧水位线算法升级时，首轮成功扫描只建立新版 `New + USA` 基线，不发送历史商品邮件；下一轮开始才提醒真正新增的 URL。页面若丢失 `New`、品牌或美国地区筛选，或分页超过配置上限，整轮会失败且不会推进状态。

## GitHub Actions 配置

在仓库的 **Settings → Secrets and variables → Actions** 中添加：

| Secret | 必填 | 说明 |
| --- | --- | --- |
| `SMTP_USER` | 是 | 用于发信的 Gmail 地址，也始终是收件人之一 |
| `SMTP_APP_PASSWORD` | 是 | Gmail 应用专用密码，不是 Gmail 登录密码 |
| `ALERT_EMAIL` | 否 | 额外收件人；多个地址用英文逗号分隔，不会替代 `SMTP_USER` |
| `PROXY_SERVER` | 云端运行需要 | 站点允许访问的可信 HTTP/HTTPS/SOCKS 代理地址 |
| `PROXY_USERNAME` | 视代理而定 | 代理用户名 |
| `PROXY_PASSWORD` | 是 | IPRoyal Residential 代理密码；程序会保留国家、城市和 lifetime 参数，只更换 session ID |

云端任务会在每次运行时创建新的 8 位 IPRoyal sticky session。若 Lace Market 返回
Cloudflare 403、429、503、挑战页，或 Chromium 报告明确的代理隧道连接失败，程序会
关闭当前浏览器、切换代理 IP，并从当前失败页面继续扫描；生产配置每轮最多额外切换
2 次。若三条 IP 都失败，则进入故障冷却期，每小时只探测一次，避免每 10 分钟反复消耗
代理流量；恢复后的首轮只用每个品牌第一页重建基线，不补发故障期间的历史商品。
代理密码和 session ID 都不会写入日志。

Gmail 应用专用密码需要 Google 账号启用两步验证。不要将密码写入代码、Issue 或 Actions 日志。

配置 Secrets 后，在 **Actions → Monitor Lace Market → Run workflow** 选择 `dry_run` 手动运行一次。确认云端检查成功后，再恢复每 10 分钟的 `schedule`；在代理尚未配置前，计划触发保持暂停，以免持续产生 Cloudflare 403 失败任务。

## 可靠的每 10 分钟调度

GitHub 原生 `schedule` 在平台高负载时可能延迟或丢弃。生产环境使用
Cloudflare Worker `lacemarket-github-scheduler` 每 10 分钟调用一次 GitHub
`workflow_dispatch`；GitHub 自带 cron 改为每小时第 3 分钟运行一次，仅作为错峰备用。
工作流的 `concurrency` 会防止两个来源造成并发写状态。

Worker 配置位于 `scheduler/`，只保存一个 Cloudflare Secret：

- `GITHUB_TOKEN`：Fine-grained GitHub PAT，仅允许访问本仓库，Repository permissions
  中只授予 `Actions: Read and write`。

部署与验证：

```bash
# 临时文件位于仓库外，内容为 GITHUB_TOKEN=<Fine-grained PAT>
wrangler deploy --config scheduler/wrangler.jsonc --secrets-file /安全的临时路径/scheduler.env
wrangler tail --config scheduler/wrangler.jsonc
```

部署完成后立即删除临时 Secret 文件。不要将 Token 写入代码、提交记录或命令行参数。
Cloudflare Cron 初次创建或修改后，全球生效最长可能需要约 15 分钟。

发信成功后会验证 SMTP 是否接受全部配置收件人；公开 Actions 日志只记录接受数量，不输出邮箱地址。

## 本地验证

```bash
npm ci
npx playwright install chromium
npm test
npm run monitor:dry-run
```

`monitor:dry-run` 会读取网页并显示检测结果，但不会发邮件或修改状态文件。
