from __future__ import annotations

import hashlib
import re
import shutil
import sys
from pathlib import Path

import csscompressor
import htmlmin
import rjsmin


ROOT = Path.cwd().resolve()
DIST = ROOT / "dist"

IGNORED_DIRS = {
    ".git",
    ".github",
    ".claude",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    "__pycache__",
    "build",
    ".builddeps",
    "dist",
    "env",
    "ENV",
    "htmlcov",
    "logs",
    "node_modules",
    "out",
    "temp",
    "tmp",
    "tools",
    "docs",
    "schemas",
    "scripts",
    "tests",
    "venv",
    ".venv",
    "xp",
}

IGNORED_FILES = {
    ".coverage",
    ".env",
    ".gitignore",
    "npm-debug.log",
    "server.py",
    "yarn-debug.log",
    "yarn-error.log",
}


def main() -> int:
    reset_dist()
    shutil.copytree(ROOT, DIST, ignore=ignore_local_artifacts)
    minify_static_files(DIST)
    return 0


def reset_dist() -> None:
    dist = DIST.resolve()
    if dist == ROOT or dist.parent != ROOT or dist.name != "dist":
        raise RuntimeError(f"Refusing to remove unsafe dist path: {dist}")

    if dist.exists():
        shutil.rmtree(dist)


def ignore_local_artifacts(directory: str, names: list[str]) -> list[str]:
    ignored: list[str] = []
    directory_path = Path(directory).resolve()
    for name in names:
        if directory_path == ROOT / "data" and name != "parquet":
            ignored.append(name)
            continue
        if directory_path == ROOT / "data" / "parquet" and name != "site":
            ignored.append(name)
            continue
        if name in IGNORED_DIRS or name in IGNORED_FILES:
            ignored.append(name)
            continue

        suffix = Path(name).suffix.lower()
        if suffix in {".bak", ".key", ".log", ".orig", ".p12", ".pem", ".pfx", ".tmp"}:
            ignored.append(name)

    return ignored


def minify_static_files(root: Path) -> None:
    # Minifica JS e CSS primeiro: o hash de cache-busting tem que ser do conteudo
    # final, o mesmo que o navegador vai baixar.
    for suffix_group in ((".css", ".js"), (".html",)):
        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            if "vendor" in path.relative_to(root).parts:
                continue

            suffix = path.suffix.lower()
            if suffix not in suffix_group:
                continue

            if suffix == ".html":
                # Antes de minificar o HTML, injeta a versao nos assets locais.
                add_asset_versions(path, root)

            original = path.read_text(encoding="utf-8")
            minified = minify_text(original, suffix)
            path.write_text(minified, encoding="utf-8")

            before = len(original.encode("utf-8"))
            after = len(minified.encode("utf-8"))
            print(f"Minificado {path.relative_to(root)}: {before} -> {after} bytes")


# Assets locais que precisam furar o cache do navegador a cada deploy.
VERSIONED_ASSETS = (
    "app.js",
    "atlas_core.js",
    "disaggregation_models.js",
    "fiscal_models.js",
    "gdp_models.js",
    "parquet_loader.js",
    "point_in_polygon_pipeline.js",
    "publishing_security_engine.js",
    "public_resources_models.js",
    "static_data_adapter.js",
    "style.css",
    "ui_transparency_models.js",
)


def content_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:10]


def add_asset_versions(html_path: Path, root: Path) -> None:
    """Reescreve app.js -> app.js?v=<hash> nos HTMLs.

    Por que: o Cloudflare serve JS/CSS com max-age=14400 (4 h), enquanto o HTML vai
    com 600 s. Sem isso, o HTML novo chega mas o navegador continua usando o app.js
    velho do proprio disco por ate 4 horas -- o deploy "nao aparece". Com o hash no
    caminho, conteudo novo = URL nova, e o cache antigo simplesmente nao e usado.
    O hash so muda quando o arquivo muda, entao deploys sem alteracao seguem cacheados.
    """
    html = html_path.read_text(encoding="utf-8")
    changed = False

    for asset in VERSIONED_ASSETS:
        asset_path = root / asset
        if not asset_path.exists():
            continue

        digest = content_hash(asset_path)
        # Casa src="app.js" / href="style.css" (com ou sem ./), sem query previa.
        pattern = re.compile(r'((?:src|href)=")(\./)?' + re.escape(asset) + r'(")')
        html, count = pattern.subn(rf'\1\g<2>{asset}?v={digest}\3', html)
        if count:
            changed = True
            print(f"  cache-busting: {asset} -> ?v={digest} ({count}x em {html_path.name})")

    if changed:
        html_path.write_text(html, encoding="utf-8")


def minify_text(text: str, suffix: str) -> str:
    if suffix == ".js":
        return rjsmin.jsmin(text)

    if suffix == ".css":
        return csscompressor.compress(text)

    if suffix == ".html":
        return htmlmin.minify(
            text,
            remove_comments=True,
            remove_empty_space=True,
            reduce_boolean_attributes=True,
        )

    return text


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Erro ao preparar dist: {exc}", file=sys.stderr)
        raise
