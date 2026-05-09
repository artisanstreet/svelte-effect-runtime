import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DOCS_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST_ROOT = path.join(DOCS_ROOT, ".vitepress", "dist");
const SUPPORTED_TYPES = ["text/html", "text/markdown"];
const CACHE_CONTROL =
  "public, max-age=0, s-maxage=300, stale-while-revalidate=86400";
const NOT_FOUND_MARKDOWN =
  "# Not found\n\nThe requested documentation page does not exist.\n";

function splitMediaType(value) {
  const [type = "", subtype = ""] = value.trim().toLowerCase().split("/");
  if (!type || !subtype) {
    return null;
  }

  return { type, subtype };
}

function parseQValue(rawValue) {
  if (rawValue === undefined) {
    return 1;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.min(1, Math.max(0, parsed));
}

export function parseAcceptHeader(headerValue) {
  if (!headerValue) {
    return [];
  }

  return headerValue
    .split(",")
    .map((part, index) => {
      const [mediaType, ...params] = part.split(";").map((segment) =>
        segment.trim()
      );
      const parsedType = splitMediaType(mediaType);
      if (!parsedType) {
        return null;
      }

      const qParam = params.find((param) =>
        param.toLowerCase().startsWith("q=")
      );
      const q = parseQValue(qParam?.slice(2));
      const specificity = parsedType.type === "*"
        ? 0
        : parsedType.subtype === "*"
        ? 1
        : 2;

      return {
        ...parsedType,
        q,
        specificity,
        index,
      };
    })
    .filter((entry) => entry !== null && entry.q > 0);
}

function matches(entry, candidate) {
  const parsedCandidate = splitMediaType(candidate);
  if (!parsedCandidate) {
    return false;
  }

  const typeMatches = entry.type === "*" || entry.type === parsedCandidate.type;
  const subtypeMatches = entry.subtype === "*" ||
    entry.subtype === parsedCandidate.subtype;

  return typeMatches && subtypeMatches;
}

function pickServerDefault(_acceptHeader) {
  return "text/html";
}

export function negotiateContentType(acceptHeader) {
  const parsedEntries = parseAcceptHeader(acceptHeader);
  if (parsedEntries.length === 0) {
    return pickServerDefault(acceptHeader);
  }

  const rankedCandidates = SUPPORTED_TYPES.map(
    (candidate, serverPreference) => {
      const bestMatch = parsedEntries
        .filter((entry) => matches(entry, candidate))
        .sort((left, right) => {
          if (right.q !== left.q) {
            return right.q - left.q;
          }

          if (right.specificity !== left.specificity) {
            return right.specificity - left.specificity;
          }

          return left.index - right.index;
        })[0];

      if (!bestMatch) {
        return null;
      }

      return {
        candidate,
        serverPreference,
        match: bestMatch,
      };
    },
  ).filter((entry) => entry !== null);

  if (rankedCandidates.length === 0) {
    return null;
  }

  rankedCandidates.sort((left, right) => {
    if (right.match.q !== left.match.q) {
      return right.match.q - left.match.q;
    }

    if (right.match.specificity !== left.match.specificity) {
      return right.match.specificity - left.match.specificity;
    }

    if (left.match.index !== right.match.index) {
      return left.match.index - right.match.index;
    }

    return left.serverPreference - right.serverPreference;
  });

  return rankedCandidates[0]?.candidate ?? null;
}

function normalizePathname(pathname) {
  const normalizedPath = path.posix.normalize(pathname);
  if (!normalizedPath.startsWith("/")) {
    return `/${normalizedPath}`;
  }

  return normalizedPath;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveRouteFiles(pathname) {
  const normalizedPath = normalizePathname(pathname);
  const cleanPath = normalizedPath === "/"
    ? ""
    : normalizedPath.replace(/^\/+|\/+$/g, "");

  const markdownCandidates = cleanPath
    ? [
      path.join(DOCS_ROOT, `${cleanPath}.md`),
      path.join(DOCS_ROOT, cleanPath, "index.md"),
    ]
    : [path.join(DOCS_ROOT, "index.md")];
  const htmlCandidates = cleanPath
    ? [
      path.join(DIST_ROOT, `${cleanPath}.html`),
      path.join(DIST_ROOT, cleanPath, "index.html"),
    ]
    : [path.join(DIST_ROOT, "index.html")];

  let markdownPath = null;
  for (const candidate of markdownCandidates) {
    if (await fileExists(candidate)) {
      markdownPath = candidate;
      break;
    }
  }

  let htmlPath = null;
  for (const candidate of htmlCandidates) {
    if (await fileExists(candidate)) {
      htmlPath = candidate;
      break;
    }
  }

  if (!markdownPath || !htmlPath) {
    return null;
  }

  return {
    htmlPath,
    markdownPath,
  };
}

function readRouteContent(filePath) {
  return readFile(filePath, "utf8");
}

function withSharedHeaders(response, contentType, status) {
  const headers = new Headers(response.headers);
  headers.set("Content-Type", `${contentType}; charset=utf-8`);
  headers.set("Vary", "Accept");
  headers.set("Cache-Control", CACHE_CONTROL);

  return new Response(response.body, {
    status,
    headers,
  });
}

async function createMarkdownResponse(routeFiles, method) {
  if (!routeFiles) {
    const body = method === "HEAD" ? null : NOT_FOUND_MARKDOWN;
    return withSharedHeaders(new Response(body), "text/markdown", 404);
  }

  const body = method === "HEAD"
    ? null
    : await readRouteContent(routeFiles.markdownPath);
  return withSharedHeaders(new Response(body), "text/markdown", 200);
}

async function createHtmlResponse(routeFiles, method) {
  const status = routeFiles ? 200 : 404;
  const htmlPath = routeFiles?.htmlPath ?? path.join(DIST_ROOT, "404.html");
  const htmlBody = method === "HEAD" ? null : await readRouteContent(htmlPath);
  return withSharedHeaders(new Response(htmlBody), "text/html", status);
}

function getRequestHeader(request, name) {
  if (request.headers instanceof Headers) {
    return request.headers.get(name);
  }

  const loweredName = name.toLowerCase();
  if (typeof request.headers?.get === "function") {
    return request.headers.get(loweredName) ?? request.headers.get(name);
  }

  if (request.headers && typeof request.headers === "object") {
    return request.headers[loweredName] ?? request.headers[name] ?? null;
  }

  return null;
}

function getRequestUrl(request) {
  const rawUrl = request.url ?? request.path ?? "/";
  try {
    return new URL(rawUrl);
  } catch {
    const host = getRequestHeader(request, "x-forwarded-host") ??
      getRequestHeader(request, "host") ??
      "localhost";
    const protocol = getRequestHeader(request, "x-forwarded-proto") ??
      "https";
    return new URL(rawUrl, `${protocol}://${host}`);
  }
}

export async function createDocsResponse(request) {
  const method = (request.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        Vary: "Accept",
      },
    });
  }

  const url = getRequestUrl(request);
  const negotiatedType = negotiateContentType(
    getRequestHeader(request, "accept"),
  );
  if (!negotiatedType) {
    return new Response("Not Acceptable", {
      status: 406,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": CACHE_CONTROL,
        Vary: "Accept",
      },
    });
  }

  const routeFiles = await resolveRouteFiles(url.pathname);
  if (negotiatedType === "text/markdown") {
    return createMarkdownResponse(routeFiles, method);
  }

  return createHtmlResponse(routeFiles, method);
}
