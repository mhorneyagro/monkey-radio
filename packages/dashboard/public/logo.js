/** Load repo-root logo PNG with cache-busting from mtime. */
export async function applyRootLogo(img, variant = "white") {
  if (!img) return;
  try {
    const response = await fetch(`/api/logo/${variant}`);
    if (!response.ok) return;
    const data = await response.json();
    if (data.url) img.src = data.url;
  } catch {
    img.src = `/logo-${variant}.png`;
  }
}
