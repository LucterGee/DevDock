const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

const { expandHome, toDisplayPath } = require('./pathUtils');

const home = os.homedir();

test('展开 ~ 与 ~/ 前缀', () => {
  assert.equal(expandHome('~'), home);
  assert.equal(expandHome('~/Documents'), path.join(home, 'Documents'));
  assert.equal(expandHome('  ~/Documents  '), path.join(home, 'Documents'));
});

test('普通路径原样返回', () => {
  assert.equal(expandHome('/tmp/demo'), '/tmp/demo');
  assert.equal(expandHome('relative/dir'), 'relative/dir');
  assert.equal(expandHome('~/not-a-home'), path.join(home, 'not-a-home'));
});

test('空值返回空串', () => {
  assert.equal(expandHome(''), '');
  assert.equal(expandHome(null), '');
  assert.equal(expandHome(undefined), '');
});

test('展示时把 home 换成 ~', () => {
  assert.equal(toDisplayPath(home), '~');
  assert.equal(toDisplayPath(path.join(home, '.devdock', 'nginx')), '~/.devdock/nginx');
  assert.equal(toDisplayPath('/tmp/demo'), '/tmp/demo');
  assert.equal(toDisplayPath(''), '');
});

test('展示与展开可往返', () => {
  const original = path.join(home, '.devdock', 'nginx', 'routes');
  assert.equal(expandHome(toDisplayPath(original)), original);
});
