# 部署到 1Panel 服务器（逐步）

目标：前端是静态文件，后端是 Node + SQLite 单进程，公网流量只走 1Panel 的 Nginx，后端只听 127.0.0.1。
不需要你手写 Dockerfile 或编排容器；下面的命令按顺序贴进 1Panel 的「终端」或 SSH 即可。

前提：域名已解析到服务器，1Panel 配好 HTTPS 证书，并有监听 80/443 的 Nginx。
以下是通用部署示例，需要按服务器环境调整；本机验证不代表已经在你的生产服务器上验证。

---

## 0. 准备

```bash
# 建目录与专用低权限账号
sudo useradd -r -s /usr/sbin/nologin rw || true
sudo mkdir -p /opt/research-workspace /var/log/research-workspace
sudo chown -R rw:rw /opt/research-workspace /var/log/research-workspace
```

按 [Node.js 官方说明](https://nodejs.org/en/download) 安装 Node.js 24，确认运行版本：

```bash
node -v   # 要看到 v24.x
```

本说明使用 systemd 或进程守护运行 Node；容器方案见文末第 9 节。

## 1. 上传代码

把整个项目目录传到 `/opt/research-workspace`（含 `server/`、`src/`、`package.json`、`package-lock.json`）。
用 1Panel 的「文件」上传 zip 再解压，或 `rsync`：

```bash
rsync -az --exclude=node_modules --exclude=server/data --exclude=data --exclude=release --exclude='.env*' --exclude='*.env' ./ 用户@服务器IP:/opt/research-workspace/
sudo chown -R rw:rw /opt/research-workspace
```

不要对含持久化数据的部署目录使用未排除数据文件的 `rsync --delete`。

## 2. 构建前端静态文件

```bash
cd /opt/research-workspace
sudo -u rw npm ci --no-audit --no-fund
sudo -u rw npm run build          # 产出 dist/，tsc 类型检查也在这一步
```

`dist/` 就是纯静态文件，后面交给 Nginx。

## 3. 配置后端环境变量

```bash
sudo -u rw cp deploy/env.example deploy/research-workspace.env
sudo -u rw nano deploy/research-workspace.env
```

必须确认这几项：

| 键 | 值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 不要改成 0.0.0.0，公网入口是 Nginx |
| `DATA_DIR` | `/opt/research-workspace/data` | 持久化目录，备份就备这个 |
| `COOKIE_SECURE` | `1` | 走 https 时必须为 1 |
| `TRUST_PROXY` | `1` | 让登录限速拿到真实 IP（只有可信反代在前才开） |
| `ALLOW_SIGNUP` | `1`（临时） | 注册第一个账号时开，注册完立刻改回 `0` |
| `FILE_MAX_MB` | `25` | 服务端单文件上限，单位 MiB；前端当前也设有 25 MiB 上限 |
| `FILE_QUOTA_MB` | `500` | 每个账号的原文件总配额，单位 MiB |

## 4. 装成常驻服务（保活 + 开机自启）

```bash
sudo cp /opt/research-workspace/deploy/research-workspace.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now research-workspace
sudo systemctl status research-workspace --no-pager
curl -s http://127.0.0.1:8787/api/health     # 期望 {"ok":true,...}
```

`Restart=always` + `RestartSec=3` 负责进程崩了就拉起；`MemoryMax=256M` 给内存封顶，
超了会被杀然后自动重启，不会把整机拖死。日志在 `/var/log/research-workspace/`。

> 想在 1Panel 界面里管：网站/工具箱 → 进程守护（Supervisor）→ 添加，
> 启动命令填 `node /opt/research-workspace/server/src/main.ts`，
> 运行目录 `/opt/research-workspace`，环境变量指向 `deploy/research-workspace.env`。
> **systemd 与 1Panel 进程守护二选一**，两个都开会抢端口。

## 5. 建站点并反向代理

1Panel → 网站 → 创建网站：

1. **基本信息**：主域名填你的域名；类型选「静态网站」（运行目录指到 `dist`）。
   1Panel 生成的根目录形如 `/opt/1panel/www/sites/<域名>/index`，
   把 `/opt/research-workspace/dist/*` 复制进去，或者直接把网站根目录指到 `dist`：
   ```bash
   sudo mkdir -p /opt/1panel/www/sites/<域名>/index
   sudo cp -r /opt/research-workspace/dist/. /opt/1panel/www/sites/<域名>/index/
   ```
2. **HTTPS**：在「证书」里给这个站点签发/绑定已有的 Let's Encrypt 证书，并开启「强制 HTTPS」。
3. **反向代理**：站点设置 → 反向代理 → 添加代理：
   - 代理路径：`/api`
   - 目标地址：`http://127.0.0.1:8787`
   保存后打开该站点的「配置文件」，核对是否包含这几行（没有就照 `deploy/nginx-snippet.conf` 补）：
   ```nginx
   proxy_set_header Host              $host;
   proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
   proxy_set_header X-Forwarded-Proto $scheme;
   client_max_body_size 32m;
   ```
   旧站点升级时也要更新该限制并重新加载 Nginx；原来的 8m 会提前拒绝较大的文件或图片请求。默认原文件上限 25 MiB，AI 接口的 JSON 请求上限 20 MiB；若提高服务端文件上限，应同步核对前端上限和反代配置。
4. **单页应用刷新**：确认 `location /` 里有 `try_files $uri $uri/ /index.html;`，
   否则刷新 `/projects/xxx` 会 404。
5. **备份文件不许被下载**：如果备份目录在站点可达路径下，加一条 `location /backup/ { deny all; }`。

验证：

```bash
curl -I https://<域名>/                 # 200
curl -s https://<域名>/api/health       # {"ok":true,...}
```

## 6. 注册第一个账号，然后关掉注册

1. 浏览器打开 `https://<域名>/` → 登录页 → 切到「注册」→ 填邮箱和密码 → 创建账号。
2. 立刻关掉注册（否则任何人都能在这台服务器上建号）：
   ```bash
   sudo sed -i 's/^ALLOW_SIGNUP=.*/ALLOW_SIGNUP=0/' /opt/research-workspace/deploy/research-workspace.env
   sudo systemctl restart research-workspace
   ```
3. 以后要加第二个账号：把 `ALLOW_SIGNUP` 临时改回 `1`，重启，让对方注册，再改回 `0` 重启。
   两个账号的数据在库里靠 `userId` 完全隔离，接口层每条读写都带 `userId` 条件。

**没有忘记密码的找回入口**（没有邮件服务）。真忘了就在服务器上直接改库：
```bash
sudo -u rw sqlite3 /opt/research-workspace/data/research-workspace.db "SELECT id,email FROM users;"
# 界面里没有重置口令功能；最省事的做法是删掉该用户行后重新注册同一个邮箱
```

## 7. 备份（每天自动）

在线备份用 `node:sqlite` 的 backup API，会带上 WAL 里没落盘的页：

科研文件以 BLOB 保存在同一 SQLite 的 `researchFiles` 表，在线备份已包含这些原文件，无需另备一个附件目录。原文件会增加数据库与备份体积，需按账号配额预留磁盘空间。设置页「导出记录备份」只导出研究记录与界面偏好的 JSON，不包含文件库原文件或 AI 对话历史。

```bash
cd /opt/research-workspace && node scripts/backup-server.mjs
# 输出：[备份完成] .../data/backups/research-workspace-<时间>.db — 1 账号 / 3 项目 / ...
```

1Panel → 计划任务 → 添加 **Shell 脚本**：

- 任务名：`研序每日备份`
- 执行脚本：`cd /opt/research-workspace && /usr/local/bin/node scripts/backup-server.mjs >> /var/log/research-workspace/backup.log 2>&1`
- 周期：每天 03:30
- 保留：脚本自带 `--keep`（默认 14 天，可在 env 里改 `BACKUP_KEEP_DAYS`）

再往异地拷一份才叫备份（1Panel 的计划任务可以直接配对象存储/FTP 传输）。

## 8. 恢复

```bash
sudo systemctl stop research-workspace
cd /opt/research-workspace/data
sudo cp research-workspace.db research-workspace.db.broken-$(date +%F-%H%M)   # 先留现场
sudo cp backups/research-workspace-<要恢复的时间>.db research-workspace.db
sudo rm -f research-workspace.db-wal research-workspace.db-shm                # 清掉旧 WAL
sudo chown rw:rw research-workspace.db
sudo systemctl start research-workspace
curl -s http://127.0.0.1:8787/api/health
```

这条路径我做过自动化验证（`node scripts/verify-restore.mjs`）：写入 → 备份 → 删库 → 放回 → 数据完整且仍能登录，5 项全通过。

## 升级与回滚

```bash
cd /opt/research-workspace
node scripts/backup-server.mjs                       # 升级前先备份
sudo systemctl stop research-workspace
git pull            # 或重新 rsync 新版本
sudo -u rw npm ci && sudo -u rw npm run build
sudo cp -r dist/. /opt/1panel/www/sites/<域名>/index/
sudo systemctl start research-workspace
curl -s http://127.0.0.1:8787/api/health
```

数据库迁移是自动的（启动时按 `server/src/schema.ts` 里的版本顺序重放，失败整笔回滚）。
本次科研文件功能新增迁移 v7，启动后检查 `/api/health` 的数据库版本。请同时更新前端静态文件、后端代码与 Nginx 请求体限制；只替换前端会导致文件接口不可用。
要回滚版本：停服务 → 换回旧代码 → 用第 8 步恢复升级前那份备份。

## 9. 想用容器（可选）

不必照本手册第 4 步装 systemd，改用 1Panel 的「容器 → 编排」，把运行命令写成
`node server/src/main.ts`、挂载 `/opt/research-workspace/data` 到容器内同名路径、
`env_file: ./deploy/research-workspace.env`、端口**只绑定回环**（`127.0.0.1:8787:8787`）。
镜像选 `node:24-bookworm-slim`。这条路我不推荐在你这台内存紧的机器上默认用，
因为多一层容器对内存和排障都没好处。

## 10. 出问题时先看这几处

| 症状 | 先看 |
| --- | --- |
| `/api/*` 502 | `systemctl status research-workspace`；`tail -50 /var/log/research-workspace/err.log` |
| 上传提示 413 | Nginx 的 `client_max_body_size` 是否为 `32m`；文件是否超过当前上限；AI 图片请求是否超过 20 MiB |
| 文件列表或上传返回 404 | 后端是否已更新并重启，数据库是否迁移至 v7 |
| 提示文件空间不足 | 当前账号是否达到 `FILE_QUOTA_MB`，以及服务器磁盘是否有可用空间 |
| 注册被拒 | `ALLOW_SIGNUP` 是不是 0（这是默认，也是正确行为） |
| 登录后立刻回到登录页 | `COOKIE_SECURE` 与实际协议不匹配：http 访问却设了 Secure，或反代没传 `X-Forwarded-Proto` |
| 刷新页面 404 | Nginx 缺 `try_files ... /index.html` |
| 界面显示「N 条待同步」下不去 | 后端是否可达；点右上角账号 → 立即同步；队列在浏览器 localStorage 的 `rw.queue.v1` |
| 数据库被别的进程锁住 | `DATA_DIR` 是否被同时挂给两个实例 |
