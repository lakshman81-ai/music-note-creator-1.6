
// @ts-ignore
import EssentiaImport from 'essentia.js/dist/essentia.js-core.es.js';
// @ts-ignore
import EssentiaWASMModuleImport from 'essentia.js/dist/essentia-wasm.web.js';

// The 'essentia.js' main entry point uses a UMD build that depends on Node.js built-ins (fs, path, crypto).
// This causes build warnings and runtime crashes in browser environments like Google AI Studio.
// To fix this, we import the ES/Web builds directly, which are browser-compatible.

// 1. Resolve Essentia Class
// Ensure we handle default exports and named exports correctly
let Essentia = EssentiaImport;

// If it's an object with 'Essentia' property, it might be a namespace import or named export wrapper
if (typeof Essentia !== 'function') {
    if (Essentia && Essentia.Essentia) {
        Essentia = Essentia.Essentia;
    } else if (Essentia && Essentia.default) {
        Essentia = Essentia.default;
    }
}

if (typeof Essentia !== 'function') {
    console.error('[Essentia Shim] Failed to resolve Essentia constructor. Raw import:', EssentiaImport);
} else {
    // console.log('[Essentia Shim] Resolved Essentia constructor successfully.');
}

// 2. Resolve EssentiaWASM Factory
let EssentiaWASMModule = EssentiaWASMModuleImport;
if (typeof EssentiaWASMModule !== 'function') {
    // Sometimes imports come as { default: func } or { EssentiaWASM: func }
    if (EssentiaWASMModule && EssentiaWASMModule.default) {
        EssentiaWASMModule = EssentiaWASMModule.default;
    } else if (EssentiaWASMModule && EssentiaWASMModule.EssentiaWASM) {
        EssentiaWASMModule = EssentiaWASMModule.EssentiaWASM;
    }
}

// EssentiaWASM shim function (Promise-based factory)
const EssentiaWASM = () => {
  return new Promise((resolve, reject) => {
    // Fallback: If imported variable is not a function, check if it's already an object (initialized module)
    if (typeof EssentiaWASMModule !== 'function') {
        if (typeof EssentiaWASMModule === 'object' && EssentiaWASMModule !== null) {
             if (EssentiaWASMModule.ready) {
                 EssentiaWASMModule.ready.then(mod => resolve(mod)).catch(reject);
                 return;
             }
             // It might be the module itself if ready promise is gone/resolved?
             // Check for a known property like EssentiaJS
             if (EssentiaWASMModule.EssentiaJS) {
                 resolve(EssentiaWASMModule);
                 return;
             }
        }
        const err = new Error(`[Essentia Shim] EssentiaWASMModule is not a function or valid object. Type: ${typeof EssentiaWASMModule}`);
        console.error(err, EssentiaWASMModule);
        reject(err);
        return;
    }

    try {
        // Configure the Emscripten module
        const moduleConfig = {
            locateFile: (path, scriptDirectory) => {
                if (path.endsWith('.wasm')) {
                    // Use absolute path to ensure we load from public root
                    return '/essentia-wasm.wasm';
                }
                return path;
            },
            // Hook for runtime initialization if needed, though Promise is preferred
            onRuntimeInitialized: () => {
                // console.log('[Essentia Shim] WASM Runtime initialized');
            }
        };

        const result = EssentiaWASMModule(moduleConfig);

        // Handle different return types (Promise vs Module object)
        if (result instanceof Promise) {
            result.then(moduleInstance => {
                if (!moduleInstance.EssentiaJS) {
                    console.warn("[Essentia Shim] Warning: EssentiaJS not found on resolved module.");
                }
                resolve(moduleInstance);
            }).catch(reject);
        } else if (result && result.ready) {
            // Emscripten 'ready' promise
            result.ready.then(moduleInstance => {
                 resolve(moduleInstance);
            }).catch(reject);
        } else {
            // Assume it returns the module object directly (sync) or compatible object
            resolve(result);
        }
    } catch (e) {
        console.error("[Essentia Shim] Error invoking EssentiaWASM factory:", e);
        reject(e);
    }
  });
};

export { Essentia, EssentiaWASM };
