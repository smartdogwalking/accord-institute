import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try{
 const {launcher}=JSON.parse(readFileSync(path.join(root,'.runtime/launcher.json'),'utf8'));
 if(!Number.isSafeInteger(launcher)||launcher<=1)throw new Error();
 const command=execFileSync('/bin/ps',['-p',String(launcher),'-o','command='],{encoding:'utf8'});
 if(!command.includes(path.join(root,'scripts/launch.mjs')))throw new Error();
 process.kill(launcher,'SIGTERM');console.log('Accord Institute stopped. Saved work remains in the encrypted vault.');
}catch{console.log('No matching Accord Institute launcher was found. If you started the server manually, close that Terminal process.');}
