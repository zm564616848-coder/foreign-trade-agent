// Existing Render services run `npm run check && npm test`. Install locked
// dependencies only when absent/outdated, without requiring a dashboard edit.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const dependencies=JSON.parse(readFileSync(new URL('../package.json',import.meta.url))).dependencies||{};
const missing=Object.entries(dependencies).some(([name,version])=>{
  try{return JSON.parse(readFileSync(`${root}node_modules/${name}/package.json`)).version!==version;}catch{return true;}
});
if(missing){const result=spawnSync('npm',['ci','--cache','/tmp/logihub-npm-cache','--no-fund'],{cwd:root,stdio:'inherit'});process.exit(result.status??1);}
