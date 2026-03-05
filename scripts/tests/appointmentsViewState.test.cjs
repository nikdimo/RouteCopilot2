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

const modulePath = path.resolve(__dirname, '../../src/utils/appointmentsViewState.ts');
const { getAppointmentsViewState } = loadTypeScriptModule(modulePath);

assert.equal(
  getAppointmentsViewState('idle', 0),
  'loading',
  'initial state must render as loading'
);
assert.equal(
  getAppointmentsViewState('loading', 0),
  'loading',
  'in-flight fetch must render as loading'
);
assert.equal(
  getAppointmentsViewState('success', 0),
  'empty',
  'empty state must only render after successful load with zero meetings'
);
assert.equal(
  getAppointmentsViewState('success', 3),
  'ready',
  'successful load with meetings must render ready state'
);
assert.equal(
  getAppointmentsViewState('error', 0),
  'error',
  'failed fetch must render error state'
);

const coldStartSequence = [
  { status: 'idle', count: 0, expected: 'loading' },
  { status: 'loading', count: 0, expected: 'loading' },
  { status: 'success', count: 2, expected: 'ready' },
];
const actualSequence = coldStartSequence.map((step) =>
  getAppointmentsViewState(step.status, step.count)
);
assert.deepEqual(
  actualSequence,
  coldStartSequence.map((step) => step.expected),
  'cold-start flow must stay loading until meetings resolve'
);
assert(
  !actualSequence.slice(0, 2).includes('empty'),
  'cold-start loading steps must never render empty state'
);

console.log('appointmentsViewState tests passed');
