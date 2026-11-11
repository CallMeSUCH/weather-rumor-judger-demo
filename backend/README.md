# 气象信息判别器 · 数据网关

本地后端只使用 Python 标准库，负责：

1. 托管 `web/` 静态页面；
2. 提供公开数据源 API；
3. 磁盘缓存 + 快照哈希（URL、拉取时间、SHA-256）。

## 启动

在项目根目录运行：

```bash
python backend/server.py 8766
```

打开：

```text
http://127.0.0.1:8766
```

端口 8765 可用于纯静态页面；8766 是“静态页 + API”的完整后端。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/terms` | 术语卡 |
| GET | `/api/cases` | 案例 |
| GET | `/api/sources` | 信源 |
| GET | `/api/evidence/oni` | NOAA CPC ONI |
| GET | `/api/evidence/geocode?name=北京` | 地理编码 |
| GET | `/api/evidence/weather?...` | Open-Meteo 天气/历史 |
| GET | `/api/evidence/typhoon?name=山竹` | 台风样本 |
| GET | `/api/evidence/registry` | 数据适配器注册表 |

## 数据源边界

- 优先使用官方或可公开验证的接口；
- CMA 站点档案需要实名账号和 API 权限；
- 未配置凭证时返回“未配置”，不返回伪造数据；
- 第三方再分析、商业数据只作辅助，不冒充官方观测；
- 缓存目录 `backend/cache/` 不纳入版本控制。

## 环境变量（可选）

```text
CMA_API_USER=...
CMA_API_PWD=...
CMA_API_BASE=http://api.data.cma.cn:8090/api
```

不要把真实账号、密码或 token 写入仓库。

## 作者

CallMeSUCH · <https://github.com/CallMeSUCH>
