# ZEUS Panel — Render edition

این پوشه نسخه‌ی آماده‌ی Render از Worker ارسالی است. هسته‌ی پنل، APIها، subscription/status، WebSocket و اتصال‌های TCP خروجی از طریق لایه‌ی سازگاری Node اجرا می‌شوند.

## سریع‌ترین روش Deploy

1. محتویات همین پوشه را در یک Repository گیت‌هاب قرار بده.
2. در Render گزینه **New → Blueprint** را بزن و Repository را متصل کن.
3. Render فایل `render.yaml` را می‌خواند و Web Service را می‌سازد.
4. بعد از Deploy، آدرس `https://YOUR-SERVICE.onrender.com/panel` را باز کن.
5. Health check روی `/healthz` تنظیم شده است.

`RECOVERY_TOKEN` در Blueprint به‌طور خودکار یک مقدار امن می‌گیرد. اگر خواستی مقدار مشخص خودت را داشته باشی، آن را در Environment سرویس تغییر بده.

## Free یا Persistent؟

`render.yaml` روی پلن Free ساخته شده و برای تست سریع مناسب است. در Free، فایل‌سیستم ephemeral است؛ بنابراین دیتابیس SQLite و تغییرات محلی ممکن است با restart/redeploy/spin-down از بین بروند.

برای استفاده‌ی پایدار، `render-persistent.yaml` نمونه‌ی سرویس پولی با Persistent Disk روی `/var/data` است. هنگام ساخت Blueprint می‌توانی نام فایل Blueprint را روی `render-persistent.yaml` قرار بدهی، یا بعداً به سرویس پولی ارتقا بدهی و Disk را روی `/var/data` متصل کنی.

## Environment Variables

- `DATA_DIR=/var/data`
- `PUBLIC_PORT=443`
- `RECOVERY_TOKEN`: توکن بازیابی رمز پنل
- `ALLOW_CLOUDFLARE_EDGE_IPS=0`: فقط اگر دامنه‌ی سفارشی خودت واقعاً پشت Cloudflare Proxy است روی `1` بگذار.
- `UPDATE_SOURCE_URL`: اختیاری؛ آدرس سورس upstream برای updater داخلی.

## نکته شبکه

برای اتصال عمومی از دامنه Render و `wss://` روی پورت 443 استفاده کن. پورت‌های Edge مخصوص Cloudflare مثل 2053/2083/2087/2096/8443 در Web Service معمولی Render معادل مستقیم ندارند.

## فایل‌ها

- `Source.js`: Worker اصلی
- `server.js`: HTTP/WebSocket adapter برای Render
- `runtime/`: D1/TCP/WebSocket/Cache compatibility layer
- `render.yaml`: Blueprint رایگان برای تست
- `render-persistent.yaml`: Blueprint نمونه با Persistent Disk
- `Dockerfile`: اجرای Node.js 22
