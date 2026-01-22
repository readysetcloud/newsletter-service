export default {
  transform: {
    '^.+\\.[tj]sx?$': 'babel-jest'
  },
  transformIgnorePatterns: [
    "/node_modules/(?!(@octokit|@aws-sdk))",
    "/dashboard-ui/"
  ],
  moduleNameMapper: {
    '\\.hbs$': '<rootDir>/__mocks__/hbsMock.mjs'
  },
  testMatch: [
    '**/__tests__/**/*.[j]s?(x)',
    '**/?(*.)+(spec|test).[j]s?(x)',
    '**/?(*.)+(spec|test).mjs'
  ],
  testEnvironment: 'node'
};
