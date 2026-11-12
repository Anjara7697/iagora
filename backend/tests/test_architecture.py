"""Sens des dépendances entre couches et absence de cycle d'imports (AUDIT-ARCH-001).

Analyse statique (ast) des imports de premier niveau : un import placé dans une fonction est différé
et ne participe pas au chargement des modules.
"""

import ast
import pathlib

APP = pathlib.Path(__file__).resolve().parents[1] / "app"

# Couche → préfixes qu'elle ne doit pas importer.
FORBIDDEN = {
    "schemas": ("app.services", "app.agents", "app.api", "app.integrations"),
    "core": ("app.services", "app.agents", "app.api", "app.schemas"),
    "database": ("app.services", "app.agents", "app.api"),
    "models": ("app.services", "app.agents", "app.api", "app.schemas"),
    "services": ("app.agents", "app.api"),
}


def _module(path: pathlib.Path) -> str:
    parts = list(path.relative_to(APP.parent).with_suffix("").parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def _top_level_imports(path: pathlib.Path) -> set[str]:
    """Modules `app.*` importés au chargement du fichier (hors fonctions et `TYPE_CHECKING`)."""
    names: set[str] = set()
    for node in ast.parse(path.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Import):
            names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.add(node.module)
            # `from app.services import inbound` charge le sous-module `app.services.inbound`.
            names.update(f"{node.module}.{a.name}" for a in node.names)
    return {n for n in names if n.startswith("app.")}


def _files() -> dict[str, pathlib.Path]:
    return {_module(p): p for p in APP.rglob("*.py") if "__pycache__" not in p.parts}


def test_layers_do_not_import_upward():
    offenders = []
    for path in APP.rglob("*.py"):
        layer = path.relative_to(APP).parts[0]
        for name in _top_level_imports(path):
            if name.startswith(FORBIDDEN.get(layer, ())):
                offenders.append(f"{path.relative_to(APP)} → {name}")
    assert offenders == []


def test_no_import_cycle_between_services():
    files = _files()
    graph = {
        mod: {n for n in _top_level_imports(path) if n in files and n.startswith("app.services.")}
        for mod, path in files.items()
        if mod.startswith("app.services.")
    }
    cycles: list[list[str]] = []

    def visit(node: str, stack: list[str]) -> None:
        for nxt in graph.get(node, ()):
            if nxt in stack:
                cycles.append([*stack[stack.index(nxt) :], nxt])
            elif len(stack) < 12:
                visit(nxt, [*stack, nxt])

    for start in graph:
        visit(start, [start])
    assert cycles == [], cycles[:3]
