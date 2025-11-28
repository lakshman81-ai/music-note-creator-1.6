
// @ts-ignore
import EssentiaImport from 'essentia.js/dist/essentia.js-core.es.js';
// @ts-ignore
import EssentiaWASMModuleImport from 'essentia.js/dist/essentia-wasm.web.js';

// The 'essentia.js' main entry point uses a UMD build that depends on Node.js built-ins (fs, path, crypto).
// This causes build warnings and runtime crashes in browser environments like Google AI Studio.
// To fix this, we import the ES/Web builds directly, which are browser-compatible.

// 1. Resolve Essentia Class
let Essentia = EssentiaImport;
if (typeof Essentia !== 'function') {
    if (Essentia.Essentia) {
        Essentia = Essentia.Essentia;
    } else if (Essentia.default) {
        Essentia = Essentia.default;
    }
}

if (typeof Essentia !== 'function') {
    console.error('[Essentia Shim] Failed to resolve Essentia constructor. Raw import:', EssentiaImport);
}

// 2. Resolve EssentiaWASM Factory
let EssentiaWASMModule = EssentiaWASMModuleImport;
if (typeof EssentiaWASMModule !== 'function') {
    // Sometimes imports come as { default: func } or { EssentiaWASM: func }
    if (EssentiaWASMModule.default) {
        EssentiaWASMModule = EssentiaWASMModule.default;
    } else if (EssentiaWASMModule.EssentiaWASM) {
        EssentiaWASMModule = EssentiaWASMModule.EssentiaWASM;
    }
}

// EssentiaWASM shim function (Promise-based factory)
const EssentiaWASM = () => {
  return new Promise((resolve, reject) => {
    if (typeof EssentiaWASMModule !== 'function') {
        // Fallback: It might be an object if already initialized or incorrect import
        if (typeof EssentiaWASMModule === 'object' && EssentiaWASMModule !== null) {
             if (EssentiaWASMModule.ready) {
                 EssentiaWASMModule.ready.then(mod => resolve(mod)).catch(reject);
                 return;
             }
             // It might be the module itself?
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
                    // Use absolute path to ensure we load from public root,
                    // regardless of current URL path.
                    return '/essentia-wasm.wasm';
                }
                return path;
            },
            // Hook for runtime initialization
            onRuntimeInitialized: () => {
                // This is called when WASM is ready, but the Promise returned by factory
                // (if it returns one) or the 'ready' property is usually preferred.
            }
        };

        const result = EssentiaWASMModule(moduleConfig);

        // Handle different return types (Promise vs Module object)
        if (result instanceof Promise) {
            result.then(moduleInstance => {
                if (!moduleInstance.EssentiaJS) {
                    console.warn("[Essentia Shim] Warning: EssentiaJS not found on resolved module. Checking if it needs time...");
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
