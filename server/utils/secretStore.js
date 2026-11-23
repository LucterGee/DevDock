const PREFIX = 'enc:v1:';

// safeStorage 不可用时，用户本次输入的密钥只保留在内存中
const memorySecrets = new Map();

const getSafeStorage = () => {
  try {
    const electron = require('electron');
    const safeStorage = electron && electron.safeStorage;
    if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function') return safeStorage;
  } catch (error) {
    // 非 Electron 环境
  }
  return null;
};

const isAvailable = () => {
  const safeStorage = getSafeStorage();
  if (!safeStorage) return false;
  try {
    return Boolean(safeStorage.isEncryptionAvailable());
  } catch (error) {
    return false;
  }
};

const isEncrypted = (value) => String(value || '').startsWith(PREFIX);

// 不可用时返回空串：宁可不落盘，也不写明文
const encryptSecret = (plain) => {
  const text = String(plain || '');
  if (!text || !isAvailable()) return '';
  try {
    return PREFIX + getSafeStorage().encryptString(text).toString('base64');
  } catch (error) {
    return '';
  }
};

const decryptSecret = (stored) => {
  const value = String(stored || '');
  if (!value || !isEncrypted(value) || !isAvailable()) return '';
  try {
    return getSafeStorage().decryptString(Buffer.from(value.slice(PREFIX.length), 'base64'));
  } catch (error) {
    return '';
  }
};

const setMemorySecret = (id, plain) => {
  if (!id) return;
  memorySecrets.set(String(id), String(plain || ''));
};

const getMemorySecret = (id) => (id ? memorySecrets.get(String(id)) || '' : '');

const clearMemorySecret = (id) => {
  if (id) memorySecrets.delete(String(id));
};

module.exports = {
  PREFIX,
  isAvailable,
  isEncrypted,
  encryptSecret,
  decryptSecret,
  setMemorySecret,
  getMemorySecret,
  clearMemorySecret,
};
