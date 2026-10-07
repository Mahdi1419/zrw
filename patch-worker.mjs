export function patchWorker(source) {
  let s = source.replace(/\r\n/g, '\n');

  // Railway sits behind a reverse proxy; preserve Cloudflare header support and add Railway-standard fallbacks.
  s = s.replaceAll(
    'request.headers.get("CF-Connecting-IP") || "unknown"',
    '(request.headers.get("CF-Connecting-IP") || (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim() || request.headers.get("X-Real-IP") || "unknown")'
  );

  const replaceBetween = (startMarker, endMarker, replacement) => {
    const start = s.indexOf(startMarker);
    if (start < 0) throw new Error(`Patch marker not found: ${startMarker}`);
    const end = s.indexOf(endMarker, start);
    if (end < 0) throw new Error(`Patch end marker not found: ${endMarker}`);
    s = s.slice(0, start) + replacement + '\n\t\t' + s.slice(end);
  };

  replaceBetween(
    'if (url.pathname === "/api/recover" && request.method === "POST") {',
    'const authorized = await DbService.verifyApiAuth(request, env);',
`if (url.pathname === "/api/recover" && request.method === "POST") {
\t\t\tconst { api_token } = await readJsonBody(request);
\t\t\tif (!api_token) {
\t\t\t\treturn new Response(JSON.stringify({ error: "Recovery token is required" }), { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } });
\t\t\t}
\t\t\tlet isAuthorized = false;
\t\t\ttry {
\t\t\t\tif (env.PANEL_RECOVERY_TOKEN && api_token === env.PANEL_RECOVERY_TOKEN) {
\t\t\t\t\tisAuthorized = true;
\t\t\t\t} else if (env.RAILWAY_API_TOKEN && api_token === env.RAILWAY_API_TOKEN) {
\t\t\t\t\tisAuthorized = true;
\t\t\t\t} else if (env.RAILWAY_SERVICE_ID) {
\t\t\t\t\tconst rr = await fetch("https://backboard.railway.com/graphql/v2", {
\t\t\t\t\t\tmethod: "POST",
\t\t\t\t\t\theaders: { Authorization: "Bearer " + api_token, "Content-Type": "application/json" },
\t\t\t\t\t\tbody: JSON.stringify({ query: "query service($id:String!){service(id:$id){id}}", variables: { id: env.RAILWAY_SERVICE_ID } }),
\t\t\t\t\t});
\t\t\t\t\tconst rj = await rr.json().catch(() => ({}));
\t\t\t\t\tisAuthorized = !!(rr.ok && rj && rj.data && rj.data.service && rj.data.service.id === env.RAILWAY_SERVICE_ID);
\t\t\t\t}
\t\t\t} catch (e) {}
\t\t\tif (!isAuthorized) {
\t\t\t\treturn new Response(JSON.stringify({ error: "توکن بازیابی معتبر نیست یا به این سرویس Railway دسترسی ندارد" }), { status: 403, headers: { "Content-Type": "application/json; charset=utf-8" } });
\t\t\t}
\t\t\tawait env.DB.prepare("DELETE FROM settings WHERE key = 'panel_password'").run();
\t\t\tcachedPanelPassword = null;
\t\t\tLOGIN_ATTEMPTS.clear();
\t\t\treturn new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json; charset=utf-8" } });
\t\t}`
  );

  replaceBetween(
    'if (url.pathname === "/api/auto-update-setup" && request.method === "POST") {',
    'if (url.pathname === "/api/restart-core" && request.method === "POST") {',
`if (url.pathname === "/api/auto-update-setup" && request.method === "POST") {
\t\t\tconst body = await readJsonBody(request);
\t\t\tif (body.action === "check") {
\t\t\t\tconst autoUpdateRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'auto_update'").first();
\t\t\t\tconst isAutoUpdateEnabled = autoUpdateRow ? autoUpdateRow.value === "1" : true;
\t\t\t\treturn new Response(JSON.stringify({ has_token: true, auto_update: isAutoUpdateEnabled, platform: "railway" }), { headers: { "Content-Type": "application/json" } });
\t\t\t}
\t\t\tif (body.action === "enable") {
\t\t\t\tawait env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_update', '1')").run();
\t\t\t\treturn new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
\t\t\t}
\t\t\tif (body.action === "disable") {
\t\t\t\tawait env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_update', '0')").run();
\t\t\t\treturn new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
\t\t\t}
\t\t}`
  );

  replaceBetween(
    'if (url.pathname === "/api/update-panel" && request.method === "POST") {',
    'if (url.pathname === "/api/change-password" && request.method === "POST") {',
`if (url.pathname === "/api/update-panel" && request.method === "POST") {
\t\t\ttry {
\t\t\t\tif (!env.CONTROL || typeof env.CONTROL.fetch !== "function") throw new Error("Railway update controller is unavailable");
\t\t\t\tconst updateRes = await env.CONTROL.fetch("https://control.local/update", { method: "POST" });
\t\t\t\tconst updateData = await updateRes.json().catch(() => ({}));
\t\t\t\tif (!updateRes.ok || !updateData.success) throw new Error(updateData.error || "Update failed");
\t\t\t\treturn new Response(JSON.stringify({ success: true, platform: "railway", version: updateData.version || null }), { headers: { "Content-Type": "application/json" } });
\t\t\t} catch (err) {
\t\t\t\treturn new Response(JSON.stringify({ error: err.message }), { status: 400, headers: { "Content-Type": "application/json" } });
\t\t\t}
\t\t}`
  );

  // Make recovery copy match Railway without changing Cloudflare-related proxy features elsewhere in the UI.
  s = s.replace(
    'برای احراز هویت و اثبات مالکیت پـنـل، از طریق دکمه زیر وارد کلودفلر شوید و توکن دریافتی را کپی کرده و در کادر زیر وارد کنید.',
    'برای بازیابی رمز، توکن بازیابی تعریف‌شده در Railway یا Railway API Token دارای دسترسی به همین سرویس را وارد کنید.'
  );
  s = s.replace('دریافت توکن', 'دریافت توکن Railway');
  s = s.replace(/https:\/\/dash\.cloudflare\.com\/profile\/api-tokens\?[^\"]+/g, 'https://railway.com/account/tokens');

  return s;
}
