var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var MAX_VAULT = 8 * 1024 * 1024;
var MAX_BLOB = 4 * 1024 * 1024;
var HEX64 = /^[0-9a-f]{64}$/;
async function sha256(texto) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256, "sha256");
function cors(req, env) {
  const permitidos = String(env.ALLOWED_ORIGIN || "*").split(",").map((s) => s.trim()).filter(Boolean);
  const origen = req.headers.get("Origin");
  const h = {
    "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, If-Match, X-Create-Password",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
  if (permitidos.includes("*"))
    h["Access-Control-Allow-Origin"] = "*";
  else if (origen && permitidos.includes(origen))
    h["Access-Control-Allow-Origin"] = origen;
  return h;
}
__name(cors, "cors");
var json = /* @__PURE__ */ __name((status, obj, h) => new Response(JSON.stringify(obj), { status, headers: { ...h, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }), "json");
async function idDesdeToken(req) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get("Authorization") || "");
  return m ? sha256("vinilos-vault:" + m[1]) : null;
}
__name(idDesdeToken, "idDesdeToken");
async function leerCuerpo(req, max) {
  if (Number(req.headers.get("Content-Length")) > max)
    return null;
  const buf = await req.arrayBuffer();
  return buf.byteLength > max ? null : buf;
}
__name(leerCuerpo, "leerCuerpo");
async function manejar(req, env) {
  const h = cors(req, env);
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: h });
  const url = new URL(req.url);
  const p = url.pathname;
  const kv = env.VINILOS;
  if (!kv)
    return json(500, { error: "Falta el enlace KV \xABVINILOS\xBB en el Worker." }, h);
  if (p === "/" || p === "/api/health")
    return json(200, { ok: true, app: "inventario-vinilos", crearConContrasena: !!env.CREATE_PASSWORD }, h);
  if (p === "/api/vaults" && req.method === "POST") {
    if (env.CREATE_PASSWORD && req.headers.get("X-Create-Password") !== env.CREATE_PASSWORD)
      return json(403, { error: "Contrase\xF1a de creaci\xF3n incorrecta." }, h);
    const cuerpo = await leerCuerpo(req, 4096);
    let token;
    try {
      token = JSON.parse(new TextDecoder().decode(cuerpo)).token;
    } catch {
      return json(400, { error: "Petici\xF3n no v\xE1lida." }, h);
    }
    if (!HEX64.test(token || ""))
      return json(400, { error: "Token no v\xE1lido." }, h);
    const id = await sha256("vinilos-vault:" + token);
    if (await kv.get("vault:" + id))
      return json(409, { error: "Ya existe." }, h);
    await kv.put("vault:" + id, JSON.stringify({ rev: 0, data: null, creado: Date.now(), actualizado: Date.now() }));
    return json(201, { ok: true, rev: 0 }, h);
  }
  if (p === "/api/vault") {
    const id = await idDesdeToken(req);
    if (!id)
      return json(401, { error: "Falta el c\xF3digo de la colecci\xF3n." }, h);
    const v = await kv.get("vault:" + id, "json");
    if (!v)
      return json(404, { error: "No existe ninguna colecci\xF3n con ese c\xF3digo en este servidor." }, h);
    if (req.method === "GET") {
      if (url.searchParams.get("meta") === "1")
        return json(200, { rev: v.rev, empty: !v.data, actualizado: v.actualizado }, h);
      return json(200, { rev: v.rev, data: v.data, actualizado: v.actualizado }, h);
    }
    if (req.method === "PUT") {
      const buf = await leerCuerpo(req, MAX_VAULT + 4096);
      if (!buf)
        return json(413, { error: "Demasiado grande." }, h);
      let data;
      try {
        data = JSON.parse(new TextDecoder().decode(buf)).data;
      } catch {
        return json(400, { error: "Petici\xF3n no v\xE1lida." }, h);
      }
      if (typeof data !== "string")
        return json(400, { error: "Faltan los datos." }, h);
      if (Number(req.headers.get("If-Match")) !== v.rev)
        return json(409, { error: "Hay una versi\xF3n m\xE1s reciente." }, h);
      const nuevo = { ...v, rev: v.rev + 1, data, actualizado: Date.now() };
      await kv.put("vault:" + id, JSON.stringify(nuevo));
      return json(200, { rev: nuevo.rev }, h);
    }
    if (req.method === "DELETE") {
      let cursor;
      do {
        const lista = await kv.list({ prefix: `blob:${id}:`, cursor });
        await Promise.all(lista.keys.map((k) => kv.delete(k.name)));
        cursor = lista.list_complete ? null : lista.cursor;
      } while (cursor);
      await kv.delete("vault:" + id);
      return json(200, { ok: true }, h);
    }
    return json(405, { error: "M\xE9todo no permitido." }, h);
  }
  const mb = /^\/api\/blobs\/([0-9a-f]{64})$/.exec(p);
  if (mb) {
    const id = await idDesdeToken(req);
    if (!id)
      return json(401, { error: "Falta el c\xF3digo de la colecci\xF3n." }, h);
    if (!await kv.get("vault:" + id))
      return json(404, { error: "No existe ninguna colecci\xF3n con ese c\xF3digo en este servidor." }, h);
    const clave = `blob:${id}:${mb[1]}`;
    if (req.method === "PUT") {
      const buf = await leerCuerpo(req, MAX_BLOB);
      if (!buf)
        return json(413, { error: "Demasiado grande." }, h);
      await kv.put(clave, buf);
      return json(200, { ok: true }, h);
    }
    if (req.method === "GET" || req.method === "HEAD") {
      const buf = await kv.get(clave, "arrayBuffer");
      if (!buf)
        return req.method === "HEAD" ? new Response(null, { status: 404, headers: h }) : json(404, { error: "No encontrada." }, h);
      return new Response(req.method === "HEAD" ? null : buf, {
        status: 200,
        headers: { ...h, "Content-Type": "application/octet-stream", "Content-Length": String(buf.byteLength), "Cache-Control": "private, max-age=31536000, immutable" }
      });
    }
    return json(405, { error: "M\xE9todo no permitido." }, h);
  }
  return json(404, { error: "Ruta desconocida." }, h);
}
__name(manejar, "manejar");
var worker_default = {
  async fetch(req, env) {
    try {
      return await manejar(req, env);
    } catch (e) {
      return json(500, { error: "Error interno." }, cors(req, env));
    }
  }
};

// ../../../../wr/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../wr/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-qrglkY/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../../wr/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-qrglkY/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
