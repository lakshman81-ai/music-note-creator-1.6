
// @ts-ignore
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
// @ts-ignore
import EssentiaWASMModule from 'essentia.js/dist/essentia-wasm.web.js';

// The 'essentia.js' main entry point uses a UMD build that depends on Node.js built-ins (fs, path, crypto).
// This causes build warnings and runtime crashes in browser environments like Google AI Studio.
// To fix this, we import the ES/Web builds directly, which are browser-compatible.

// However, the Web/ES builds export the initialized Module object directly (or via IIFE),
// whereas the UMD build exports a factory function. The app code expects a factory function.
// We create a shim factory here.

const EssentiaWASM = () => {
  return new Promise((resolve) => {
    // EssentiaWASMModule is the singleton Module object.
    // It is likely already initializing (run() is called in the source file).
    // We resolve it immediately (as a Promise-like wrapper).
    // Note: If WASM loading is async, accessing it immediately *might* be too early,
    // but typically the app waits for user interaction or further async steps.
    // Ideally we would hook onRuntimeInitialized, but since the module is already executed,
    // we might have missed the event.

    // Check if it's a Promise (some builds are)
    if (EssentiaWASMModule instanceof Promise) {
        EssentiaWASMModule.then(resolve);
    } else {
        // Resolve with the module object
        resolve(EssentiaWASMModule);
    }
  });
};

export { Essentia, EssentiaWASM };
