
// @ts-ignore
import EssentiaImport from 'essentia.js/dist/essentia.js-core.es.js';
// @ts-ignore
import EssentiaWASMModule from 'essentia.js/dist/essentia-wasm.web.js';

// The 'essentia.js' main entry point uses a UMD build that depends on Node.js built-ins (fs, path, crypto).
// This causes build warnings and runtime crashes in browser environments like Google AI Studio.
// To fix this, we import the ES/Web builds directly, which are browser-compatible.

let Essentia = EssentiaImport;

// Robustly resolve the Essentia class constructor
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

// EssentiaWASM factory function
const EssentiaWASM = () => {
  return new Promise((resolve, reject) => {
    // Check if EssentiaWASMModule is the factory function itself
    if (typeof EssentiaWASMModule === 'function') {
        // In browser, this returns a Promise that resolves to the module
        try {
            const result = EssentiaWASMModule({
                // Add any necessary configuration here if needed
                // For example, locating the wasm file
                locateFile: (path) => {
                    if (path.endsWith('.wasm')) {
                        return 'essentia-wasm.wasm'; // Assuming we moved it to public root
                    }
                    return path;
                }
            });

            if (result instanceof Promise) {
                result.then(resolve).catch(reject);
            } else if (result && result.ready) {
                result.ready.then(() => resolve(result));
            } else {
                resolve(result);
            }
        } catch (e) {
            console.error("EssentiaWASM factory invocation failed:", e);
            reject(e);
        }
    }
    // Check if it's already an object (initialized module or promise)
    else if (EssentiaWASMModule instanceof Promise) {
        EssentiaWASMModule.then(resolve).catch(reject);
    }
    else if (typeof EssentiaWASMModule === 'object') {
        if (EssentiaWASMModule.ready) {
             EssentiaWASMModule.ready.then(() => resolve(EssentiaWASMModule)).catch(reject);
        } else {
             resolve(EssentiaWASMModule);
        }
    } else {
        console.error("Unknown EssentiaWASMModule type:", typeof EssentiaWASMModule, EssentiaWASMModule);
        reject(new Error("Unknown EssentiaWASMModule type"));
    }
  });
};

export { Essentia, EssentiaWASM };
