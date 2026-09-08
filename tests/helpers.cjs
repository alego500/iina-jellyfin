const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadModule(relativePath, globals = {}) {
  const filename = path.resolve(__dirname, '..', relativePath);
  const context = { module: { exports: {} }, console, ...globals };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context.module.exports;
}

function loadSidebarMethods(relativePath, globals = {}) {
  const window = {};
  loadModule(relativePath, { window, ...globals });
  return Object.values(window)[0](() => {});
}

module.exports = { loadModule, loadSidebarMethods };
