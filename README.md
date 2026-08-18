# Lace Market AP/BABY Monitor

每 10 分钟检查 Lace Market 上以下品牌的 `Dresses` 新上架商品：

- Angelic Pretty（AP）
- Baby, the Stars Shine Bright（BABY/BTSSB）

发现新品后，邮件会包含商品名称、品牌、价格、状态、卖家地区和可点击的商品链接。监控使用按创建时间倒序的水位线算法，旧商品翻页或重新排序不会被当作新品。

## GitHub Actions 配置

在仓库的 **Settings → Secrets and variables → Actions** 中添加：

| Secret | 必填 | 说明 |
| --- | --- | --- |
| `SMTP_USER` | 是 | 用于发信的 Gmail 地址，也是默认收件人 |
| `SMTP_APP_PASSWORD` | 是 | Gmail 应用专用密码，不是 Gmail 登录密码 |
| `ALERT_EMAIL` | 否 | 若希望发送到另一邮箱，可填写该地址 |

Gmail 应用专用密码需要 Google 账号启用两步验证。不要将密码写入代码、Issue 或 Actions 日志。

配置 Secrets 后，在 **Actions → Monitor Lace Market → Run workflow** 手动运行一次。之后 GitHub Actions 会按计划继续运行，无需保持本地电脑开机。

## 本地验证

```bash
npm ci
npx playwright install chromium
npm test
npm run monitor:dry-run
```

`monitor:dry-run` 会读取网页并显示检测结果，但不会发邮件或修改状态文件。
