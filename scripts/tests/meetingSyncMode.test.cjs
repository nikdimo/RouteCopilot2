const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTypeScriptModule(modulePath) {
  const source = fs.readFileSync(modulePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: modulePath,
  }).outputText;

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require,
    __dirname: path.dirname(modulePath),
    __filename: modulePath,
  };
  vm.runInNewContext(transpiled, sandbox, { filename: modulePath });
  return module.exports;
}

const modulePath = path.resolve(__dirname, '../../src/utils/meetingSyncMode.ts');
const { getMeetingSyncMode } = loadTypeScriptModule(modulePath);

assert.equal(getMeetingSyncMode(false, false), 'local');
assert.equal(getMeetingSyncMode(false, true), 'local');
assert.equal(getMeetingSyncMode(true, false), 'remote_pending_auth');
assert.equal(getMeetingSyncMode(true, true), 'remote_auth');

const transition = [
  getMeetingSyncMode(false, false),
  getMeetingSyncMode(true, false),
  getMeetingSyncMode(true, true),
];

assert.deepEqual(transition, ['local', 'remote_pending_auth', 'remote_auth']);

console.log('meetingSyncMode tests passed');
