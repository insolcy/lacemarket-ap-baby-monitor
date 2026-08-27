# Lace Market AP/BABY Monitor

每 10 分钟检查 Lace Market 上以下品牌的 `Dresses` 新上架商品：

- Angelic Pretty（AP）
- Baby, the Stars Shine Bright（BABY/BTSSB）

监控直接使用 Lace Market 的官方 `New`、品牌和美国地区筛选，并完整扫描其所有分页；只有商品卡片带有精确 `New` 标签且详情分类属于 Dresses 时才发送邮件。Relist、非 Dresses 分类和非美国卖家商品不会触发通知。邮件包含商品首图、名称、品牌、价格、状态、卖家地区和可点击链接；点击图片也会打开商品页。同一商品 URL 一经处理便永久去重，已知商品出现在新品前后都不会截断扫描。

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
关闭当前浏览器、切换代理 IP，并从当前失败页面继续扫描；默认最多额外切换 10 次。
代理密码和 session ID 都不会写入日志。

Gmail 应用专用密码需要 Google 账号启用两步验证。不要将密码写入代码、Issue 或 Actions 日志。

配置 Secrets 后，在 **Actions → Monitor Lace Market → Run workflow** 选择 `dry_run` 手动运行一次。确认云端检查成功后，再恢复每 10 分钟的 `schedule`；在代理尚未配置前，计划触发保持暂停，以免持续产生 Cloudflare 403 失败任务。

GitHub 的计划任务可能因平台负载出现少量延迟，因此“每 10 分钟”表示计划频率，不保证精确到某一秒。

发信成功后会验证 SMTP 是否接受全部配置收件人；公开 Actions 日志只记录接受数量，不输出邮箱地址。

## 本地验证

```bash
npm ci
npx playwright install chromium
npm test
npm run monitor:dry-run
```

`monitor:dry-run` 会读取网页并显示检测结果，但不会发邮件或修改状态文件。
