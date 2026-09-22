"use strict";

module.exports = {
  async setup(ctx) {
    const { default: register } = await import("./src/index.js");
    return register(ctx);
  }
};
