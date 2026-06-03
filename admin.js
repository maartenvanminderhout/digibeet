const SUPABASE_URL = "https://tgasilapvirxiquqjflv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRnYXNpbGFwdmlyeGlxdXFqZmx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODE3NTksImV4cCI6MjA5NDE1Nzc1OX0.2U8VGYk3CCQ0eiTTzhD2v3ZokEB5BVrJCQ_0NiaE6mc";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const TARGET_PATH = "assets/images/";
const GALLERY_PATH = "content/gallery.json";
const UPLOAD_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/upload-to-github`;
const UPLOAD_HEADERS = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
  "apikey": SUPABASE_ANON_KEY
};

const form = document.querySelector("#uploadForm");
const titleInput = document.querySelector("#titleInput");
const descriptionInput = document.querySelector("#descriptionInput");
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

function validateTitle(title) {
  if (!title.trim()) {
    throw new Error("Vul een titel in voordat je publiceert.");
  }
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
        : `Publiceren is mislukt (${response.status} ${response.statusText || "onbekende fout"}).`
    };
  }
}

async function publishGalleryItem({ title, description, file }) {
  validateTitle(title);
  validateFile(file);

  setStatus("Bezig: afbeelding voorbereiden…");
  const base64Content = arrayBufferToBase64(await file.arrayBuffer());
  assertPlainBase64Content(base64Content);

  setStatus("Bezig: afbeelding uploaden…");
  const response = await fetch(UPLOAD_FUNCTION_URL, {
    method: "POST",
    headers: UPLOAD_HEADERS,
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      base64Content,
      targetPath: TARGET_PATH,
      title: title.trim(),
      description: description.trim(),
      galleryPath: GALLERY_PATH
    })
  });

  const result = await readJsonResponse(response);
  if (!response.ok || !result?.success) {
    throw new Error(result?.error || `Publiceren is mislukt (${response.status} ${response.statusText || "onbekende fout"}).`);
  }

  return result;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const title = titleInput.value;
  const description = descriptionInput.value;
  const file = fileInput.files?.[0];
  uploadButton.disabled = true;

  try {
    validateTitle(title);
    validateFile(file);
    const result = await publishGalleryItem({ title, description, file });
    setStatus("Afbeelding geüpload. Galerij bijgewerkt. Klaar!", "success");
    setStatus(
      `Klaar!<br>` +
      `Image path: <strong>${escapeHtml(result.imagePath)}</strong><br>` +
      `Public url: <a href="${escapeHtml(result.imageUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(result.imageUrl)}</a><br>` +
      `Galerij: <strong>${escapeHtml(result.galleryPath)}</strong> is bijgewerkt en het item is toegevoegd aan gallery.json.`,
      "success"
    );
    form.reset();
  } catch (error) {
    setStatus(`Foutmelding: ${escapeHtml(error.message)}`, "error");
  } finally {
    uploadButton.disabled = false;
  }
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) {
    setStatus("Vul een titel in en kies een afbeelding.");
    return;
  }

  try {
    validateFile(file);
    setStatus(`Gekozen bestand: <strong>${escapeHtml(file.name)}</strong>`);
  } catch (error) {
    setStatus(`Foutmelding: ${escapeHtml(error.message)}`, "error");
  }
});
