module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.e2e-spec.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  // Transform ESM-only packages (jose is used by jwks-rsa)
  transformIgnorePatterns: ['node_modules/(?!(jose)/)'],
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
};
