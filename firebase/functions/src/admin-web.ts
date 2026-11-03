import {readFileSync} from "node:fs";
import {join} from "node:path";
import {Request} from "firebase-functions/v2/https";
import {Response} from "express";
import {z} from "zod";

const origins = new Set([
  "https://garbagecalendar-region-admin.web.app",
  "https://garbagecalendar-region-admin.firebaseapp.com",
]);
const assets: Record<string, [string, string]> = {
  "/map": ["map.html", "text/html; charset=utf-8"],
  "/map.html": ["map.html", "text/html; charset=utf-8"],
  "/map.js": ["map.js", "application/javascript; charset=utf-8"],
  "/map.css": ["map.css", "text/css; charset=utf-8"],
  "/vendor/leaflet.js": ["vendor/leaflet.js", "application/javascript; charset=utf-8"],
  "/vendor/leaflet.css": ["vendor/leaflet.css", "text/css; charset=utf-8"],
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "application/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};

for (let index = 0; index < 11; index++) {
  assets[`/icons/${index}.png`] = [`icons/${index}.png`, "image/png"];
}

export function createAdminWebHandler(deps: {
  mapMunicipalities?: (input: unknown) => Promise<unknown>;
  mapSchedules?: (input: unknown) => Promise<unknown>;
  previewBulk?: (input: unknown) => Promise<unknown>;
  saveBulk?: (input: unknown) => Promise<unknown>;
  exportBulk?: (input: unknown) => Promise<unknown>;
  list: (input: unknown) => Promise<unknown>;
  save: (input: unknown) => Promise<unknown>;
}) {
  return async (req: Request, res: Response): Promise<void> => {
    res.set({"Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
    const path = req.path;
    if (path.startsWith("/api/")) {
      if (req.method !== "POST") { res.set("Allow", "POST").status(405).json({error: "POST required"}); return; }
      // Require same-origin JSON requests from the management page.
      if (!origins.has(req.get("origin") || "") || req.get("x-admin-request") !== "1" || !req.is("application/json")) {
        res.status(403).json({error: "管理画面から操作してください。"}); return;
      }
      try {
        if (path === "/api/listAdminSchedulesV2") res.json(await deps.list(req.body));
        else if (path === "/api/listMapMunicipalities" && deps.mapMunicipalities) res.json(await deps.mapMunicipalities(req.body));
        else if (path === "/api/listMapSchedules" && deps.mapSchedules) res.json(await deps.mapSchedules(req.body));
        else if (path === "/api/saveAdminScheduleV2") res.json(await deps.save(req.body));
        else if (path === "/api/previewAdminBulkV2" && deps.previewBulk) res.json(await deps.previewBulk(req.body));
        else if (path === "/api/saveAdminBulkV2" && deps.saveBulk) res.json(await deps.saveBulk(req.body));
        else if (path === "/api/exportAdminBulkV2" && deps.exportBulk) res.json(await deps.exportBulk(req.body));
        else res.status(404).json({error: "Not found"});
      } catch (error) {
        if (error instanceof z.ZodError) { res.status(400).json({error: "入力内容・出典URL・確認日・収集ルールを確認してください。"}); return; }
        const e = error as {code?: string; message?: string};
        if (e.code === "aborted") res.status(409).json({error: e.message});
        else if (e.code === "permission-denied") res.status(403).json({error: e.message});
        else res.status(500).json({error: "サーバーへの接続に失敗しました。入力を保存してから再試行してください。"});
      }
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.set("Allow", "GET, HEAD").status(405).end(); return; }
    const asset = Object.hasOwn(assets, path) ? assets[path] : undefined;
    if (!asset) { res.status(404).end(); return; }
    res.type(asset[1]).send(readFileSync(join(__dirname, "admin-web-assets", asset[0])));
  };
}
