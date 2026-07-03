const { resolveClient } = require('./tenant');

async function getClientByNumber(num) {
  return resolveClient(num);
}

module.exports = { getClientByNumber };
