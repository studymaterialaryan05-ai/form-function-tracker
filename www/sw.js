const RELEASE_PREFIX = "form-function-release-";
const POINTER_CACHE = "form-function-release-pointer-v1";
const POINTER_URL = new URL("__form_function_latest_release__", self.registration.scope).href;
const RELEASE_ASSETS = ["./manifest.webmanifest", "./assets/icon.svg", "./supabase-config.js"];

function shellUrls(requestUrl) {
  return [...new Set([requestUrl, new URL("./index.html", self.registration.scope).href, new URL("./", self.registration.scope).href])];
}
async function latestCacheName() {
  const pointer = await caches.open(POINTER_CACHE);
  const value = await pointer.match(POINTER_URL);
  return value ? value.text() : null;
}
async function prepareRelease(shellResponse, requestUrl) {
  const html = await shellResponse.clone().text();
  const match = html.match(/src=["'](\.\/tracker-core\.js\?release=([a-f0-9]{16}))["']/);
  if (!match) throw new Error("App shell is not stamped with a release ID.");

  const releaseId = match[2];
  const helperUrl = new URL(match[1], self.registration.scope).href;
  const helperResponse = await fetch(helperUrl, { cache: "no-store" });
  if (!helperResponse.ok) throw new Error("Release helper could not be fetched.");

  const helperText = await helperResponse.clone().text();
  const assetResponses = await Promise.all(RELEASE_ASSETS.map(path => fetch(new URL(path, self.registration.scope), { cache: "no-store" })));
  if (assetResponses.some(response => !response.ok)) throw new Error("A required release asset could not be fetched.");
  const assetTexts = await Promise.all(assetResponses.map(response => response.clone().text()));
  const normalizedHtml = html.replace(/(\.\/tracker-core\.js)\?release=[a-f0-9]{16}/g, "$1");
  const bytes = new TextEncoder().encode(normalizedHtml + "\0" + helperText + "\0" + assetTexts.join("\0"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const computed = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("").slice(0, 16);
  if (computed !== releaseId) throw new Error("Shell and helper release IDs do not match.");

  const name = RELEASE_PREFIX + releaseId;
  if (await caches.has(name)) {
    const existing = await caches.open(name);
    if (await existing.match(helperUrl) && await existing.match(new URL("./index.html", self.registration.scope).href)) {
      const pointer = await caches.open(POINTER_CACHE);
      await pointer.put(POINTER_URL, new Response(name));
      return name;
    }
    await caches.delete(name);
  }
  const cache = await caches.open(name);
  const shellKeys = shellUrls(requestUrl);
  const assets = [...new Set([...shellKeys, helperUrl, ...RELEASE_ASSETS.map(path => new URL(path, self.registration.scope).href)])];
  try {
    for (const url of assets) {
      let response;
      if (url === helperUrl) response = helperResponse.clone();
      else if (shellKeys.includes(url)) response = shellResponse.clone();
      else response = assetResponses[RELEASE_ASSETS.map(path => new URL(path, self.registration.scope).href).indexOf(url)].clone();
      if (!response || !response.ok) throw new Error("A required release asset could not be fetched.");
      await cache.put(url, response);
    }
    const pointer = await caches.open(POINTER_CACHE);
    await pointer.put(POINTER_URL, new Response(name));
    return name;
  } catch (error) {
    await caches.delete(name);
    throw error;
  }
}
async function offlineShell(requestUrl) {
  const name = await latestCacheName();
  if (!name) return Response.error();
  const cache = await caches.open(name);
  for (const url of shellUrls(requestUrl)) {
    const response = await cache.match(url);
    if (response) return response;
  }
  return Response.error();
}
async function handleFetch(event) {
  const request = event.request;
  const url = new URL(request.url);
  const isShell = request.mode === "navigate" || url.pathname === new URL("./index.html", self.registration.scope).pathname;
  if (isShell) {
    try {
      const response = await fetch(request);
      if (!response.ok) throw new Error("Shell fetch failed.");
      await prepareRelease(response.clone(), request.url);
      return response;
    } catch (error) {
      return offlineShell(request.url);
    }
  }

  const releaseId = url.searchParams.get("release");
  if (url.pathname.endsWith("/tracker-core.js") && releaseId) {
    const releaseCache = await caches.open(RELEASE_PREFIX + releaseId);
    return await releaseCache.match(request) || Response.error();
  }

  const latest = await latestCacheName();
  if (latest) {
    const releaseCache = await caches.open(latest);
    const cached = await releaseCache.match(request);
    if (cached) return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok && latest) {
      const releaseCache = await caches.open(latest);
      await releaseCache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    return Response.error();
  }
}
self.addEventListener("install", event => event.waitUntil((async () => {
  const url = new URL("./index.html", self.registration.scope).href;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Initial app shell is unavailable.");
  await prepareRelease(response, url);
  await self.skipWaiting();
})()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(handleFetch(event));
});