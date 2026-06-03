const GITHUB_OWNER = "maartenvanminderhout";
const GITHUB_REPO = "digibeet";
const GITHUB_BRANCH = "main";
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DEFAULT_TARGET_PATH = "assets/images/";
const DEFAULT_GALLERY_PATH = "content/gallery.json";
const ALLOWED_ORIGIN = "https://maartenvanminderhout.github.io";

type GitHubContent = {
  content?: string;
  sha?: string;
  html_url?: string;
  download_url?: string;
  message?: string;
};

function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(),
      "Content-Type": "application/json"
    }
  });
}

function githubHeaders(githubToken: string) {
  return {
    "Authorization": `Bearer ${githubToken}`,
    "Content-Type": "application/json",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

function contentsApiUrl(path: string) {
  const encodedPath = encodeURIComponent(path).replaceAll("%2F", "/");
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodedPath}`;
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

function normalizeGalleryPath(galleryPath: unknown) {
  if (galleryPath !== DEFAULT_GALLERY_PATH) {
    throw new Error(`galleryPath moet ${DEFAULT_GALLERY_PATH} zijn.`);
  }

  return DEFAULT_GALLERY_PATH;
}

function assertSafeText(value: unknown, fieldName: string, required = false) {
  if (typeof value !== "string") {
    if (required) throw new Error(`${fieldName} is verplicht.`);
    return "";
  }

  const trimmed = value.trim();
  if (required && !trimmed) {
    throw new Error(`${fieldName} is verplicht.`);
  }

  return trimmed;
}

function encodeUtf8ToBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function decodeBase64ToUtf8(value: string) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new TextDecoder().decode(bytes);
}

async function getGithubContent(githubToken: string, path: string) {
  const response = await fetch(`${contentsApiUrl(path)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
    method: "GET",
    headers: githubHeaders(githubToken)
  });

  if (response.status === 404) {
    return { exists: false, content: null as GitHubContent | null };
  }

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result?.message || `GitHub-bestand ophalen is mislukt voor ${path}.`);
  }

  return { exists: true, content: result as GitHubContent };
}

async function putGithubContent(
  githubToken: string,
  path: string,
  message: string,
  content: string,
  sha?: string
) {
  const response = await fetch(contentsApiUrl(path), {
    method: "PUT",
    headers: githubHeaders(githubToken),
    body: JSON.stringify({
      message,
      content,
      branch: GITHUB_BRANCH,
      ...(sha ? { sha } : {})
    })
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result?.message || `GitHub-bestand schrijven is mislukt voor ${path}.`);
  }

  return result;
}

async function loadGallery(githubToken: string, galleryPath: string) {
  const existingGallery = await getGithubContent(githubToken, galleryPath);
  if (!existingGallery.exists || !existingGallery.content?.content) {
    return { items: [] as Record<string, string>[], sha: undefined as string | undefined };
  }

  const rawJson = decodeBase64ToUtf8(existingGallery.content.content);
  const parsed = JSON.parse(rawJson);
  if (!Array.isArray(parsed)) {
    throw new Error("gallery.json moet een JSON-array zijn.");
  }

  return { items: parsed as Record<string, string>[], sha: existingGallery.content.sha };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders() });
  }

  if (request.method !== "POST") {
    return jsonResponse({ success: false, error: "Alleen POST is toegestaan." }, 405);
  }

  try {
    const githubToken = Deno.env.get("GITHUB_TOKEN");
    if (!githubToken) {
      return jsonResponse({ success: false, error: "GITHUB_TOKEN is niet ingesteld." }, 500);
    }

    const {
      filename,
      contentType,
      base64Content,
      targetPath,
      title,
      description,
      galleryPath
    } = await request.json();

    if (typeof filename !== "string" || typeof contentType !== "string" || typeof base64Content !== "string") {
      return jsonResponse({ success: false, error: "filename, contentType en base64Content zijn verplicht." }, 400);
    }

    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      return jsonResponse({ success: false, error: "Alleen jpg, jpeg, png en webp afbeeldingen zijn toegestaan." }, 400);
    }

    if (base64Content.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Content)) {
      return jsonResponse({ success: false, error: "base64Content is ongeldig." }, 400);
    }

    const safeFilename = sanitizeFilename(filename);
    const safeTargetPath = normalizeTargetPath(targetPath);
    const safeGalleryPath = normalizeGalleryPath(galleryPath);
    const safeTitle = assertSafeText(title, "Titel", true);
    const safeDescription = assertSafeText(description, "Beschrijving");
    const imagePath = `${safeTargetPath}${safeFilename}`;

    const existingImage = await getGithubContent(githubToken, imagePath);
    await putGithubContent(
      githubToken,
      imagePath,
      `Upload image via admin: ${safeFilename}`,
      base64Content,
      existingImage.content?.sha
    );

    const gallery = await loadGallery(githubToken, safeGalleryPath);
    gallery.items.push({
      title: safeTitle,
      description: safeDescription,
      image: imagePath,
      createdAt: new Date().toISOString().slice(0, 10)
    });

    await putGithubContent(
      githubToken,
      safeGalleryPath,
      `Update gallery via admin: ${safeTitle}`,
      encodeUtf8ToBase64(`${JSON.stringify(gallery.items, null, 2)}\n`),
      gallery.sha
    );

    return jsonResponse({
      success: true,
      imagePath,
      imageUrl: `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}/${imagePath}`,
      galleryPath: safeGalleryPath,
      galleryUpdated: true
    });
  } catch (error) {
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Onbekende fout."
    }, 400);
  }
});
