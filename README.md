# Lace Market AP/BABY Monitor

每 10 分钟检查 Lace Market 上以下品牌的 `Dresses` 新上架商品：

- Angelic Pretty（AP）
- Baby, the Stars Shine Bright（BABY/BTSSB）

发现美国卖家的新品后，邮件会包含商品名称、品牌、价格、状态、卖家地区和可点击的商品链接。非美国卖家的新品不会发送邮件，但会被记录为已处理，之后不会重复提醒。监控使用按创建时间倒序的水位线算法，旧商品翻页或重新排序不会被当作新品。

## GitHub Actions 配置

在仓库的 **Settings → Secrets and variables → Actions** 中添加：

| Secret | 必填 | 说明 |
| --- | --- | --- |
| `SMTP_USER` | 是 | 用于发信的 Gmail 地址，也始终是收件人之一 |
| `SMTP_APP_PASSWORD` | 是 | Gmail 应用专用密码，不是 Gmail 登录密码 |
| `ALERT_EMAIL` | 否 | 额外收件人；多个地址用英文逗号分隔，不会替代 `SMTP_USER` |
| `PROXY_SERVER` | 云端运行需要 | 站点允许访问的可信 HTTP/HTTPS/SOCKS 代理地址 |
| `PROXY_USERNAME` | 视代理而定 | 代理用户名 |
| `PROXY_PASSWORD` | 视代理而定 | 代理密码 |

Gmail 应用专用密码需要 Google 账号启用两步验证。不要将密码写入代码、Issue 或 Actions 日志。

配置 Secrets 后，在 **Actions → Monitor Lace Market → Run workflow** 选择 `dry_run` 手动运行一次。确认云端检查成功后，再恢复每 10 分钟的 `schedule`；在代理尚未配置前，计划触发保持暂停，以免持续产生 Cloudflare 403 失败任务。

GitHub 的计划任务可能因平台负载出现少量延迟，因此“每 10 分钟”表示计划频率，不保证精确到某一秒。

## 本地验证

```bash
npm ci
npx playwright install chromium
npm test
npm run monitor:dry-run
```

`monitor:dry-run` 会读取网页并显示检测结果，但不会发邮件或修改状态文件。
