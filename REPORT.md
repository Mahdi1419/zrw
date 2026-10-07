# گزارش نسخه Render

این نسخه از پروژه‌ی تبدیل‌شده‌ی Worker برای اجرای مستقیم روی Render ساخته شده است.

- HTTP و WebSocket روی Web Service Render اجرا می‌شوند.
- `cloudflare:sockets.connect()` به TCP socket سمت Node تبدیل می‌شود.
- `WebSocketPair` با upgrade واقعی Node جایگزین شده است.
- D1 با SQLite و API سازگار `prepare/bind/first/all/run` اجرا می‌شود.
- Cache API و `ctx.waitUntil()` توسط runtime محلی شبیه‌سازی می‌شوند.
- IP کلاینت از `CF-Connecting-IP`، `X-Forwarded-For` یا `X-Real-IP` تشخیص داده می‌شود.
- Recovery از `RECOVERY_TOKEN` استفاده می‌کند.
- updater داخلی سورس upstream را دریافت و نسخه‌ی runtime-compatible را hot-load می‌کند.

## Storage

Render Free دارای فایل‌سیستم ephemeral است. برای دیتابیس دائمی باید سرویس پولی با Persistent Disk روی `/var/data` استفاده شود.
