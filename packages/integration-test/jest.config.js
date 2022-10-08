const baseConfig = require('../../jest.config.base.js')

module.exports = {
  ...baseConfig,
  roots: [ '<rootDir>/tests'],
  preset: 'ts-jest',
  // moduleDirectories: ['node_modules'],
  transformIgnorePatterns: [
    "node_modules/(?!@zkopru/.*)"
  ]
}
