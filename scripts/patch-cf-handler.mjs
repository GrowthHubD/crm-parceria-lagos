#!/usr/bin/env node
// Pós-processo do build OpenNext pra Cloudflare Workers.
//
// Workers não suportam dynamic require em runtime. O handler bundleado pelo
// OpenNext herda do NextNodeServer um método `getMiddlewareManifest` que faz
// `require(this.middlewareManifestPath)` quando minimalMode=false. Como temos
// proxy.ts desabilitado pra CF, o manifest é vazio — então sobrescrevemos pra
// retornar o objeto inline e nunca chamar require().
//
// Roda automaticamente via npm script `cf:build` (ver package.json).

import fs from "node:fs";

const HANDLER = ".open-next/server-functions/default/handler.mjs";

const TARGET = "getMiddlewareManifest(){return this.minimalMode?null:require(this.middlewareManifestPath)}";
const REPLACEMENT = "getMiddlewareManifest(){return {version:3,middleware:{},sortedMiddleware:[],functions:{}}}";

const src = fs.readFileSync(HANDLER, "utf8");
if (!src.includes(TARGET)) {
  if (src.includes(REPLACEMENT)) {
    console.log("[patch-cf-handler] já patchado, skip.");
    process.exit(0);
  }
  console.error("[patch-cf-handler] target não encontrado — handler.mjs mudou de formato. Investigar.");
  process.exit(1);
}

const out = src.split(TARGET).join(REPLACEMENT);
fs.writeFileSync(HANDLER, out);
console.log("[patch-cf-handler] handler.mjs patched OK.");
