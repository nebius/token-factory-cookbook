"""Executes model-written CadQuery code in a separate process and exports the part.

Usage: python cad_runner.py <code.py> <params.json> <out_dir>

Writes <out_dir>/result.json plus model.stl and model.step on success.
The generated code is checked against an import allowlist and an AST denylist
before it runs, and the parent starts this process with an empty environment
(no API keys) and a timeout. That's a guardrail for a localhost demo, not a
security sandbox: for anything shared, run this step in a container or a remote
sandbox with no network and a read-only filesystem.
"""

from __future__ import annotations

import ast
import builtins
import json
import math
import sys
import traceback
from pathlib import Path

ALLOWED_IMPORTS = {"cadquery", "math", "numpy"}  # exact module names, no submodules
BLOCKED_BUILTINS = {
    "open", "exec", "eval", "compile", "__import__", "input", "breakpoint", "help", "exit", "quit",
    "globals", "locals", "vars", "getattr", "setattr", "delattr",
}
BLOCKED_NAMES = {
    # process, FFI and import escape hatches
    "os", "sys", "subprocess", "builtins", "importlib", "ctypes", "ctypeslib", "f2py", "testing", "lib",
    "system", "popen", "memmap", "DataSource",
    # cadquery modules that execute source (cqgi), open viewers (vis) or reach raw OpenCascade I/O
    "cqgi", "vis", "occ_impl", "OCP",
}
# File I/O on cadquery / numpy objects: export, exportStl, exporters, importStep, save,
# savetxt, load, loadtxt, tofile, fromfile, fromregex, dump, Write_s, Read_s...
BLOCKED_PREFIXES = ("export", "import", "save", "load", "dump", "read", "write", "tofile", "fromfile",
                    "fromregex", "genfromtxt")


class GuardError(Exception):
    pass


def _blocked(name: str) -> bool:
    return name.startswith("__") or name in BLOCKED_NAMES or name.lower().startswith(BLOCKED_PREFIXES)


def check_code(source: str) -> None:
    """Static allowlist/denylist check. A guardrail for a local demo, not a sandbox."""
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name not in ALLOWED_IMPORTS:
                    raise GuardError(f"import of '{alias.name}' is not allowed (only cadquery, math, numpy)")
        elif isinstance(node, ast.ImportFrom):
            if node.level or node.module not in ALLOWED_IMPORTS:
                raise GuardError(f"import from '{node.module}' is not allowed (only cadquery, math, numpy)")
            for alias in node.names:
                if alias.name == "*" or _blocked(alias.name):
                    raise GuardError(f"'from {node.module} import {alias.name}' is not allowed")
        elif isinstance(node, ast.Attribute) and _blocked(node.attr):
            raise GuardError(f"attribute '.{node.attr}' is not allowed")
        elif isinstance(node, ast.Name) and (node.id in BLOCKED_BUILTINS or _blocked(node.id)):
            raise GuardError(f"name '{node.id}' is not allowed")


def _guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
    # Runtime twin of the import check: the import statements in the model code go through here.
    if level or name not in ALLOWED_IMPORTS or any(f == "*" or _blocked(f) for f in fromlist or ()):
        raise ImportError(f"import of '{name}' is not allowed (only cadquery, math, numpy)")
    return builtins.__import__(name, globals, locals, fromlist, level)


def safe_builtins() -> dict:
    allowed = {k: v for k, v in vars(builtins).items() if k not in BLOCKED_BUILTINS}
    allowed["__import__"] = _guarded_import
    return allowed


def safe_fillet(wp, radius, selector=None):
    """Fillet edges, returning the input unchanged if OpenCascade can't do it."""
    try:
        target = wp.edges(selector) if selector else wp.edges()
        result = target.fillet(radius)
        if result.val().isValid():
            return result
    except Exception:
        pass
    return wp


def safe_chamfer(wp, length, selector=None):
    """Chamfer edges, returning the input unchanged if OpenCascade can't do it."""
    try:
        target = wp.edges(selector) if selector else wp.edges()
        result = target.chamfer(length)
        if result.val().isValid():
            return result
    except Exception:
        pass
    return wp


def resolve_params(spec: dict, overrides: dict) -> dict:
    values = {}
    for name, cfg in spec.items():
        if not isinstance(cfg, dict) or "value" not in cfg:
            raise ValueError(f"PARAMS['{name}'] must be a dict with at least a 'value' key")
        v = overrides.get(name, cfg["value"])
        lo, hi = cfg.get("min"), cfg.get("max")
        if lo is not None:
            v = max(lo, v)
        if hi is not None:
            v = min(hi, v)
        values[name] = int(round(v)) if cfg.get("type") == "int" else float(v)
    return values


def to_shape(cq, result):
    if isinstance(result, cq.Workplane):
        vals = [v for v in result.vals() if isinstance(v, cq.Shape)]
        if not vals:
            raise ValueError("build() returned a Workplane with no shapes on the stack")
        shape = vals[0] if len(vals) == 1 else cq.Compound.makeCompound(vals)
    elif isinstance(result, cq.Assembly):
        shape = result.toCompound()
    elif isinstance(result, cq.Shape):
        shape = result
    else:
        raise TypeError(f"build() must return a cq.Workplane or cq.Shape, got {type(result).__name__}")
    if not shape.Solids():
        raise ValueError("build() produced no solid volume (it returned only wires, faces or a sketch)")
    return shape


def main() -> None:
    code_path, params_path, out_dir = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    out_dir.mkdir(parents=True, exist_ok=True)
    result_path = out_dir / "result.json"

    try:
        source = code_path.read_text()
        check_code(source)

        import cadquery as cq

        namespace = {"__name__": "napkin_model", "__builtins__": safe_builtins(), "cq": cq, "math": math,
                     "safe_fillet": safe_fillet, "safe_chamfer": safe_chamfer}
        exec(compile(source, "model.py", "exec"), namespace)

        spec = namespace.get("PARAMS", {})
        build = namespace.get("build")
        if not callable(build):
            raise ValueError("the code must define build(p) that returns the part")
        overrides = json.loads(params_path.read_text()) if params_path.exists() else {}
        values = resolve_params(spec, overrides)

        shape = to_shape(cq, build(values))

        # Sit the part on the print bed: XY-centered, lowest point at z=0.
        bb = shape.BoundingBox()
        shape = shape.translate(cq.Vector(-(bb.xmin + bb.xmax) / 2, -(bb.ymin + bb.ymax) / 2, -bb.zmin))
        bb = shape.BoundingBox()

        cq.exporters.export(shape, str(out_dir / "model.stl"), tolerance=0.05, angularTolerance=0.15)
        cq.exporters.export(shape, str(out_dir / "preview.stl"), tolerance=0.25, angularTolerance=0.4)
        cq.exporters.export(shape, str(out_dir / "model.step"))

        result = {
            "ok": True,
            "size": [round(bb.xlen, 2), round(bb.ylen, 2), round(bb.zlen, 2)],
            "volume_mm3": round(shape.Volume(), 1),
            "solids": len(shape.Solids()),
            "valid": bool(shape.isValid()),
            "params": values,
            "spec": spec,
        }
    except Exception as exc:
        tb = traceback.format_exc(limit=6)
        result = {"ok": False, "error": f"{type(exc).__name__}: {exc}", "traceback": tb[-4000:]}

    result_path.write_text(json.dumps(result, default=str))


if __name__ == "__main__":
    main()
