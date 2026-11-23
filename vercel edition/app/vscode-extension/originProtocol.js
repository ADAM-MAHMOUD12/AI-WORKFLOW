const LOCAL_TASKFLOW_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/i;

function parseTaskflowOrigin(value) {
  if (typeof value !== "string" || value.length > 255) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      ![url.origin, `${url.origin}/`].includes(value)) return null;
    if (LOCAL_TASKFLOW_ORIGIN.test(url.origin) || url.protocol === "https:") return url;
  } catch {
    return null;
  }
  return null;
}

function isTaskflowOrigin(value) {
  return parseTaskflowOrigin(value) !== null;
}

function normalizeTaskflowOrigin(value) {
  const url = parseTaskflowOrigin(value);
  return url?.origin || "";
}

function isTaskflowApiOrigin(value, appOrigin) {
  const apiUrl = parseTaskflowOrigin(value);
  const appUrl = parseTaskflowOrigin(appOrigin);
  if (!apiUrl || !appUrl) return false;
  if (apiUrl.origin === appUrl.origin) return true;
  return LOCAL_TASKFLOW_ORIGIN.test(apiUrl.origin) &&
    LOCAL_TASKFLOW_ORIGIN.test(appUrl.origin) &&
    apiUrl.hostname === appUrl.hostname;
}

function isTrustedTaskflowOrigin(origin, pairedOrigins, pendingOrigin) {
  if (!origin) return false;
  if ((pairedOrigins instanceof Set && pairedOrigins.has(origin)) ||
    (Array.isArray(pairedOrigins) && pairedOrigins.includes(origin)) ||
    origin === pendingOrigin) return true;
  return LOCAL_TASKFLOW_ORIGIN.test(origin);
}

module.exports = {
  isTaskflowOrigin,
  isTaskflowApiOrigin,
  isTrustedTaskflowOrigin,
  normalizeTaskflowOrigin,
};
