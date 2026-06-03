const SUPABASE_URL = "https://tgasilapvirxiquqjflv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRnYXNpbGFwdmlyeGlxdXFqZmx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODE3NTksImV4cCI6MjA5NDE1Nzc1OX0.2U8VGYk3CCQ0eiTTzhD2v3ZokEB5BVrJCQ_0NiaE6mc";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const TARGET_PATH = "assets/images/";
const UPLOAD_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/upload-to-github`;
const UPLOAD_HEADERS = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
  "apikey": SUPABASE_ANON_KEY
};

const form = document.querySelector("#uploadForm");
const fileInput = document.querySelector("#imageInput");
const uploadButton = document.querySelector("#uploadButton");
const statusBox = document.querySelector("#status");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(message, type = "") {
  statusBox.className = `status${type ? ` ${type}` : ""}`;
  statusBox.innerHTML = message;
}

function getExtension(filename) {
  const parts = filename.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

function validateFile(file) {
  if (!file) {
    throw new Error("Kies eerst een afbeelding.");
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error("Alleen jpg, jpeg, png en webp afbeeldingen zijn toegestaan.");
  }

  const extension = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error("De bestandsextensie moet .jpg, .jpeg, .png of .webp zijn.");
  }
}

function assertPlainBase64Content(base64Content) {
  if (base64Content.startsWith("data:")) {
    throw new Error("De afbeelding kon niet worden verwerkt: base64Content mag geen data-url prefix bevatten.");
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function readJsonResponse(response) {
  const responseText = await response.text();

  if (!responseText) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch (error) {
    return {
      success: false,
      error: response.ok
        ? "De server gaf een ongeldig antwoord terug."
        : `Uploaden is mislukt (${response.status} ${response.statusText || "onbekende fout"}).`
    };
  }
}

async function uploadImage(file) {
  validateFile(file);

  const base64Content = arrayBufferToBase64(await file.arrayBuffer());
  assertPlainBase64Content(base64Content);

  const response = await fetch(UPLOAD_FUNCTION_URL, {
    method: "POST",
    headers: UPLOAD_HEADERS,
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      base64Content,
      targetPath: TARGET_PATH
    })
  });

  const result = await readJsonResponse(response);
  if (!response.ok || !result?.success) {
    throw new Error(result?.error || `Uploaden is mislukt (${response.status} ${response.statusText || "onbekende fout"}).`);
  }

  return result;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const file = fileInput.files?.[0];
  uploadButton.disabled = true;
  setStatus("Bezig met uploaden…");

  try {
    const result = await uploadImage(file);
    setStatus(
      `Gelukt!<br>GitHub-pad: <strong>${escapeHtml(result.path)}</strong><br>` +
      `Publieke URL: <a href="${escapeHtml(result.public_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(result.public_url)}</a>`,
      "success"
    );
    form.reset();
  } catch (error) {
    setStatus(`Mislukt: ${escapeHtml(error.message)}`, "error");
  } finally {
    uploadButton.disabled = false;
  }
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) {
    setStatus("Nog geen bestand gekozen.");
    return;
  }

  try {
    validateFile(file);
    setStatus(`Gekozen bestand: <strong>${escapeHtml(file.name)}</strong>`);
  } catch (error) {
    setStatus(`Mislukt: ${escapeHtml(error.message)}`, "error");
  }
});
