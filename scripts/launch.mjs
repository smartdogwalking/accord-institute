import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
const stateDir=path.join(root,'.runtime'),pidFile=path.join(stateDir,'launcher.json');
const localURL='http://127.0.0.1:4180';
async function up(){try{return(await fetch(localURL+'/api/session',{signal:AbortSignal.timeout(1500)})).ok;}catch{return false;}}
function open(){if(process.env.AGREEMENT_NO_BROWSER!=='1')spawn('open',[localURL],{stdio:'ignore'});}
if(await up()){open();console.log('Accord Institute is already running.');process.exit(0);}
if(!existsSync('node_modules')||!existsSync('.next/BUILD_ID')){console.error('Run Setup Accord Institute.command first.');process.exit(1);}
if(!existsSync('.env.local'))writeFileSync('.env.local',readFileSync('.env.example'),{mode:0o600});
mkdirSync(stateDir,{recursive:true,mode:0o700});
// This launcher starts only the application. It never downloads or runs model weights.
const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','4180'],{cwd:root,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},stdio:'inherit'});
writeFileSync(pidFile,JSON.stringify({launcher:process.pid,app:app.pid}),{mode:0o600});
function stop(){app.kill('SIGTERM');try{unlinkSync(pidFile);}catch{}}
process.once('SIGINT',()=>{stop();process.exit(0);});process.once('SIGTERM',()=>{stop();process.exit(0);});process.once('exit',stop);
app.once('exit',code=>{stop();process.exit(code??0);});
for(let n=0;n<60;n++){if(await up()){open();console.log('Accord Institute is running locally. Connect your OpenAI API key in Connection & instructions.');break;}await new Promise(r=>setTimeout(r,500));}
