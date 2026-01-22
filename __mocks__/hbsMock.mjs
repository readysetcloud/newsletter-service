import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const templatePath = join(__dirname, '..', 'templates', 'analytics-report.hbs');
const templateContent = readFileSync(templatePath, 'utf-8');

export default templateContent;
