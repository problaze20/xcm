// settings.js
let storage = {};

module.exports = {
  get: async (key) => storage[key],
  set: async (key, value) => { storage[key] = value; }
};
