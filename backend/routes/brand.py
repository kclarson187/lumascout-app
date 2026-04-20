"""
routes/brand.py — public read-only download endpoints for LumaScout brand
icons. Used by the app operator to grab App Store / Play Store-ready artwork
from the preview URL without needing shell access.

Public (no auth) by design — these assets are already effectively public
(they're bundled into every build of the app). No PII.

Endpoints (all under /api/brand):
  GET /api/brand/icons.zip                — full bundle (zip, 3 MB, downloadable)
  GET /api/brand/icons/{filename}         — individual PNG (icon-appstore-1024.png, etc.)
"""
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/brand", tags=["brand"])

EXPORT_DIR = "/app/backend/_brand_export"
ZIP_PATH = os.path.join(EXPORT_DIR, "lumascout-brand-icons.zip")
SRC_DIR = "/app/frontend/assets/images"

# Map friendly filenames → source file paths.
SINGLE_FILES = {
    "icon-appstore-1024.png": (ZIP_PATH, "icon-appstore-1024.png"),  # inside zip
    "icon-playstore-512.png": (ZIP_PATH, "icon-playstore-512.png"),
    "icon-1024.png": (os.path.join(SRC_DIR, "icon.png"), None),
    "adaptive-icon-1024.png": (os.path.join(SRC_DIR, "adaptive-icon.png"), None),
    "splash-1024.png": (os.path.join(SRC_DIR, "splash-icon.png"), None),
    "favicon-256.png": (os.path.join(SRC_DIR, "favicon.png"), None),
}


@router.get("/icons.zip")
async def download_brand_icons_zip():
    if not os.path.exists(ZIP_PATH):
        raise HTTPException(
            status_code=503,
            detail="Brand icon bundle not built yet — run python3 _build_icon_bundle.py",
        )
    return FileResponse(
        path=ZIP_PATH,
        filename="lumascout-brand-icons.zip",
        media_type="application/zip",
    )


@router.get("/icons/{filename}")
async def download_brand_icon(filename: str):
    entry = SINGLE_FILES.get(filename)
    if not entry:
        raise HTTPException(status_code=404, detail="Unknown icon filename")
    src, zip_member = entry
    if zip_member:
        # Extract on-demand from the zip
        import zipfile, io
        if not os.path.exists(src):
            raise HTTPException(status_code=503, detail="Brand bundle not built yet.")
        with zipfile.ZipFile(src) as zf:
            try:
                data = zf.read(zip_member)
            except KeyError:
                raise HTTPException(status_code=404, detail="Member missing from bundle.")
        import tempfile
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
        tmp.write(data)
        tmp.close()
        return FileResponse(path=tmp.name, filename=filename, media_type="image/png")
    if not os.path.exists(src):
        raise HTTPException(status_code=404, detail="File not on disk")
    return FileResponse(path=src, filename=filename, media_type="image/png")


@router.get("/icons")
async def list_brand_icons():
    return {
        "bundle": "/api/brand/icons.zip",
        "files": list(SINGLE_FILES.keys()),
        "hint": "GET /api/brand/icons/<filename> to download any single file.",
    }
