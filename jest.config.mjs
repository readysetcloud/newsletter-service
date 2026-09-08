export default {
  // Runs before the module registry is built for each test file, so any AWS
  // client a test constructs is already pointed away from real AWS. See the
  // file for why this exists.
  setupFiles: ['<rootDir>/jest.setup.aws-guard.mjs'],
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
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dashboard-ui/'
  ],
  testEnvironment: 'node'
};
