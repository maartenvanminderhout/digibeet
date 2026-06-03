const GITHUB_OWNER = "digibeet";
const GITHUB_REPO = "onder-de-boogen-github";
const GITHUB_BRANCH = "main";
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DEFAULT_TARGET_PATH = "assets/images/";
const ALLOWED_ORIGINS = new Set([
  "https://digibeet.github.io",
  "http://localhost:8000",
  "http://localhost:8080",
  "http://127.0.0.1:8000",
  "http://127.0.0.1:8080"
]);

function getCorsHeaders(request: Request) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://digibeet.github.io";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

function jsonResponse(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(request),
      "Content-Type": "application/json"
    }
  });
}

function sanitizeFilename(filename: string) {
  const normalized = filename
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/\.+/g, ".");

  const safeName = normalized.split("/").pop()?.split("\\").pop() || "";
  const extension = safeName.includes(".") ? safeName.split(".").pop() || "" : "";
  const basename = extension ? safeName.slice(0, -(extension.length + 1)) : safeName;

  if (!basename || !ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error("Alleen .jpg, .jpeg, .png en .webp bestanden zijn toegestaan.");
  }

  return `${basename}.${extension}`;
}

function normalizeTargetPath(targetPath: unknown) {
  if (targetPath !== DEFAULT_TARGET_PATH) {
    throw new Error(`targetPath moet ${DEFAULT_TARGET_PATH} zijn.`);
  }

  return DEFAULT_TARGET_PATH;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(request) });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, { success: false, error: "Alleen POST is toegestaan." }, 405);
  }

  try {
    const githubToken = Deno.env.get("GITHUB_TOKEN");
    if (!githubToken) {
      return jsonResponse(request, { success: false, error: "GITHUB_TOKEN is niet ingesteld." }, 500);
    }

    const { filename, contentType, base64Content, targetPath } = await request.json();

    if (typeof filename !== "string" || typeof contentType !== "string" || typeof base64Content !== "string") {
      return jsonResponse(request, { success: false, error: "filename, contentType en base64Content zijn verplicht." }, 400);
    }

    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      return jsonResponse(request, { success: false, error: "Alleen jpg, jpeg, png en webp afbeeldingen zijn toegestaan." }, 400);
    }

    if (base64Content.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Content)) {
      return jsonResponse(request, { success: false, error: "base64Content is ongeldig." }, 400);
    }

    const safeFilename = sanitizeFilename(filename);
    const safeTargetPath = normalizeTargetPath(targetPath);
    const path = `${safeTargetPath}${safeFilename}`;
    const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(path).replaceAll("%2F", "/")}`;

    const githubResponse = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify({
        message: `Upload image via admin: ${safeFilename}`,
        content: base64Content,
        branch: GITHUB_BRANCH
      })
    });

    const githubResult = await githubResponse.json();
    if (!githubResponse.ok) {
      return jsonResponse(request, {
        success: false,
        error: githubResult?.message || "Upload naar GitHub is mislukt."
      }, githubResponse.status);
    }

    return jsonResponse(request, {
      success: true,
      path,
      html_url: githubResult?.content?.html_url,
      public_url: `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}/${path}`
    });
  } catch (error) {
    return jsonResponse(request, {
      success: false,
      error: error instanceof Error ? error.message : "Onbekende fout."
    }, 400);
  }
});
