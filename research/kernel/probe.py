# Which native-code routes are available to this (unattended, no-install) session?
import importlib, shutil, sys
print("python", sys.version.split()[0], sys.executable)
for m in ["numba", "llvmlite", "cffi", "numpy", "cython", "pythran", "wasmtime", "wasmer"]:
    try:
        mod = importlib.import_module(m); print("have", m, getattr(mod, "__version__", "?"))
    except Exception as e:
        print("no  ", m, type(e).__name__)
for b in ["cargo", "rustc", "clang", "gcc", "go", "swiftc", "javac", "zig", "wat2wasm", "emcc"]:
    print("bin ", b, shutil.which(b))
