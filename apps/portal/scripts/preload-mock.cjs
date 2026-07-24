/**
 * CJS preload shim for server-only mock.
 * Loaded via NODE_OPTIONS='--require scripts/preload-mock.cjs' before tsx.
 * Patches Module._resolveFilename to intercept 'server-only' imports.
 */
const Module = require('module');
const path = require('path');

const origResolve = Module._resolveFilename;
const mockPath = path.resolve(__dirname, 'server-only-mock-shim.cjs');

Module._resolveFilename = function (request, parent, isMain) {
  if (request === 'server-only') {
    return mockPath;
  }
  return origResolve.apply(this, arguments);
};
