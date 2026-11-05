// The landing hero's built-in trail, used before anything has been traced: real lines and a real tour of
// lukeed/polka at c36cf8b, read by DeepSeek V4.1 Flash 1017.
import type { Featured } from "@/server/trail/service";

export const FALLBACK_FEATURED: Featured = {
  owner: "lukeed",
  repo: "polka",
  sha: "c36cf8b5d1a57164e64fdd7d4e0d0f80ab262dc0",
  question: "What happens when an HTTP request hits a Polka app?",
  waypoints: [
    { title: "Boot and attach the handler", where: "polka/index.js:65" },
    { title: "Parsing the URL once", where: "url/index.js:1" },
    { title: "Route match, params, or sub-app", where: "polka/index.js:79" },
    { title: "Run the chain", where: "polka/index.js:90" },
    { title: "The 404 fallback", where: "polka/index.js:35" },
  ],
  terrain: [
    "const http = require('http');", "const Router = require('trouter');", "const { parse } = require('querystring');", "const parser = require('@polka/url');", "",
    "function lead(x) {", "  return x.charCodeAt(0) === 47 ? x : ('/' + x);", "}", "", "function value(x) {", "  let y = x.indexOf('/', 1);",
    "  return y > 1 ? x.substring(0, y) : x;", "}", "", "function mutate(str, req) {", "  req.url = req.url.substring(str.length) || '/';",
    "  req.path = req.path.substring(str.length) || '/';", "}", "", "function onError(err, req, res, next) {",
    "  let code = (res.statusCode = err.code || err.status || 500);", "  if (typeof err === 'string' || Buffer.isBuffer(err)) res.end(err);",
    "  else res.end(err.message || http.STATUS_CODES[code]);", "}", "", "class Polka extends Router {", "  constructor(opts={}) {", "    super(opts);",
    "    this.apps = {};", "    this.wares = [];", "    this.bwares = {};", "    this.parse = parser;", "    this.server = opts.server;",
    "    this.handler = this.handler.bind(this);", "    this.onError = opts.onError || onError; // catch-all handler",
    "    this.onNoMatch = opts.onNoMatch || this.onError.bind(null, { code:404 });", "  }", "", "  listen() {",
    "    (this.server = this.server || http.createServer()).on('request', this.handler);", "    this.server.listen.apply(this.server, arguments);",
    "    return this;", "  }", "", "  handler(req, res, info) {", "    info = info || this.parse(req);",
    "    let fns=[], arr=this.wares, obj=this.find(req.method, info.pathname);", "    req.originalUrl = req.originalUrl || req.url;",
    "    let base = value(req.path = info.pathname);", "    if (this.bwares[base] !== void 0) {", "      arr = arr.concat(this.bwares[base]);", "    }",
    "    if (obj) {", "      fns = obj.handlers;", "      req.params = obj.params;", "    } else if (this.apps[base] !== void 0) {",
    "      mutate(base, req); info.pathname=req.path; //=> updates", "      fns.push(this.apps[base].handler.bind(null, req, res, info));", "    }",
    "    fns.push(this.onNoMatch);", "    req.search = info.search;", "    req.query = parse(info.query);", "    let i=0, len=arr.length, num=fns.length;",
    "    if (len === i && num === 1) return fns[0](req, res);", "    let next = err => err ? this.onError(err, req, res, next) : loop();",
    "    let loop = _ => res.finished || (i < len) && arr[i++](req, res, next);", "    arr = arr.concat(fns);", "    len += num;", "    loop(); // init", "  }", "}",
  ],
};
