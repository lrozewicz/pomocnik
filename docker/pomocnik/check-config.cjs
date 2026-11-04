// Validates a librechat.yaml with the same schema the server uses (configSchema.strict()).
// Usage: node docker/pomocnik/check-config.cjs <file>
const fs = require('fs');
const yaml = require('js-yaml');
const { configSchema } = require('librechat-data-provider');

const file = process.argv[2];
const result = configSchema.strict().safeParse(yaml.load(fs.readFileSync(file, 'utf8')));
if (!result.success) {
  console.error(`${file}: invalid config`);
  console.error(JSON.stringify(result.error.errors, null, 2));
  process.exit(1);
}
console.log(`${file}: OK (version ${result.data.version})`);
