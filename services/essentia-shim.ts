
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

let Essentia = EssentiaImport;

// Robustly resolve the Essentia class constructor
// Sometimes bundlers or different builds structure the default export differently
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

const EssentiaWASM = () => {
  return new Promise((resolve) => {
    // EssentiaWASMModule is the singleton Module object.
    // It is likely already initializing (run() is called in the source file).
    // We resolve it immediately (as a Promise-like wrapper).

    // Check if it's a Promise (some builds are)
    if (EssentiaWASMModule instanceof Promise) {
        EssentiaWASMModule.then(resolve);
    } else {
        // Resolve with the module object
        // Ensure onRuntimeInitialized is handled if needed, but usually for this build it's ready or will be
        if (EssentiaWASMModule && typeof EssentiaWASMModule === 'object') {
             if (EssentiaWASMModule.ready) {
                 EssentiaWASMModule.ready.then(() => resolve(EssentiaWASMModule));
             } else {
                 resolve(EssentiaWASMModule);
             }
        } else {
             resolve(EssentiaWASMModule);
        }
    }
  });
};

export { Essentia, EssentiaWASM };
