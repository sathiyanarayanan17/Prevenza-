#!/usr/bin/env node
/*
 * Local web server for the Prevenza website. Development use only. Uses node:http and nothing else.
 *
 *   npm run web            serves the repository root on http://127.0.0.1:5173/ and opens /web/
 *   PORT=8080 npm run web  uses another port
 *
 * Pages must be served over http: browsers block the OCR worker and WebAssembly on file:// pages.
 * The server listens on 127.0.0.1 only, never on the network, and refuses any path that leaves the repository root.
 */
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const HOST = "127.0.0.1";
const DEFAULT_PORT = 5173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".gz": "application/gzip",
  ".traineddata": "application/octet-stream",
};

// Tesseract ships some files named "*.wasm.js": they are JavaScript, not WebAssembly.
function mimeFor(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith(".wasm.js")) return "text/javascript; charset=utf-8";
  if (lower.endsWith(".traineddata.gz")) return "application/gzip";
  return MIME[path.extname(lower)] || "application/octet-stream";
}

// Same idea as the pages' own policy: no network, no frames. 'wasm-unsafe-eval' is only for the OCR engine.
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; " +
    "worker-src 'self' blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Cache-Control": "no-store",
};

/**
 * Turns a request target into a file path inside the repository, or returns { status } for a refusal.
 * Raw text is checked before anything is decoded or normalized, so "/../" and encoded variants are all refused.
 */
function resolveRequest(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl[0] !== "/") return { status: 400 };
  let pathname = rawUrl.split("?")[0].split("#")[0];
  if (pathname === "/") return { redirect: "/web/" };

  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (e) {
    return { status: 400 };
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return { status: 400 };
  // Any dot-dot segment, in the raw or the decoded path, is refused outright.
  const segments = (pathname + "/" + decoded).split("/");
  if (segments.some((s) => s === "..")) return { status: 403 };

  if (decoded.endsWith("/")) decoded += "index.html";
  const file = path.resolve(ROOT, "." + decoded);
  const rel = path.relative(ROOT, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return { status: 403 };
  // Never serve version-control data, installed tools or local secrets.
  const top = rel.split(path.sep)[0];
  if (top === ".git" || top === "node_modules" || top === ".env") return { status: 404 };
  return { file };
}

function send(res, status, body, extra) {
  res.writeHead(status, Object.assign({ "Content-Type": "text/plain; charset=utf-8" }, SECURITY_HEADERS, extra));
  res.end(body);
}

function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", { Allow: "GET, HEAD" });
  const target = resolveRequest(req.url);
  if (target.redirect) return send(res, 302, "", { Location: target.redirect });
  if (target.status) return send(res, target.status, target.status === 403 ? "Forbidden" : "Bad request");

  fs.stat(target.file, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, "Not found");
    res.writeHead(
      200,
      Object.assign({ "Content-Type": mimeFor(target.file), "Content-Length": stat.size }, SECURITY_HEADERS)
    );
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(target.file)
      .on("error", () => res.destroy())
      .pipe(res);
  });
}

function createServer() {
  return http.createServer(handler);
}

/** Starts the server. port 0 picks a free port (used by the tests). Resolves to { server, port, url }. */
function start(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port === undefined ? DEFAULT_PORT : port, HOST, () => {
      const actual = server.address().port;
      resolve({ server, port: actual, url: "http://" + HOST + ":" + actual });
    });
  });
}

module.exports = { start, createServer, resolveRequest, mimeFor, ROOT, HOST };

if (require.main === module) {
  const port = process.env.PORT ? Number(process.env.PORT) : DEFAULT_PORT;
  start(port).then(
    ({ url }) => {
      console.log("Prevenza website: " + url + "/web/");
      console.log("Serving " + ROOT + " on " + HOST + " only. Press Ctrl+C to stop.");
    },
    (e) => {
      console.error("Could not start the server: " + e.message);
      process.exit(1);
    }
  );
}
