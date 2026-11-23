const test = require('node:test');
const assert = require('node:assert/strict');

const secretStore = require('./secretStore');
const { openAiConfigList, sealAiConfigList, migratePlaintextSecrets } = require('./aiSecrets');

// 测试环境为纯 Node，safeStorage 不可用，正好覆盖降级路径
const available = secretStore.isAvailable();

test('测试环境未启用 safeStorage', () => {
  assert.equal(available, false);
});

test('不可加密时读取已有明文视为空', () => {
  const list = openAiConfigList([{ id: 'a', apiKey: 'sk-plain' }]);
  assert.equal(list[0].apiKey, '');
});

test('不可加密时新密钥只留内存，磁盘原值不动', () => {
  const previous = [{ id: 'a', apiKey: 'sk-existing' }];
  const sealed = sealAiConfigList([{ id: 'a', apiKey: 'sk-new' }], previous);
  assert.equal(sealed[0].apiKey, 'sk-existing');
  assert.equal(secretStore.getMemorySecret('a'), 'sk-new');
});

test('不可加密时空值回存不会擦掉磁盘原值', () => {
  const previous = [{ id: 'b', apiKey: 'sk-existing' }];
  const sealed = sealAiConfigList([{ id: 'b', apiKey: '' }], previous);
  assert.equal(sealed[0].apiKey, 'sk-existing');
});

test('内存中的密钥可被读回', () => {
  secretStore.setMemorySecret('c', 'sk-memory');
  const list = openAiConfigList([{ id: 'c', apiKey: '' }]);
  assert.equal(list[0].apiKey, 'sk-memory');
  secretStore.clearMemorySecret('c');
  assert.equal(openAiConfigList([{ id: 'c', apiKey: '' }])[0].apiKey, '');
});

test('不可加密时不迁移明文', () => {
  const result = migratePlaintextSecrets([{ id: 'd', apiKey: 'sk-plain' }]);
  assert.equal(result.changed, false);
  assert.equal(result.list[0].apiKey, 'sk-plain');
});

test('加密前缀识别', () => {
  assert.equal(secretStore.isEncrypted('enc:v1:abc'), true);
  assert.equal(secretStore.isEncrypted('sk-plain'), false);
  assert.equal(secretStore.isEncrypted(''), false);
});

test('不可加密时加密函数返回空串', () => {
  assert.equal(secretStore.encryptSecret('sk-test'), '');
  assert.equal(secretStore.decryptSecret('enc:v1:abc'), '');
});
