"use strict";

module.exports = {
  async setup(ctx) {
    const { default: register } = await import(`./src/index.js?v=${Date.now()}`);
    return register(ctx);
  }
};
