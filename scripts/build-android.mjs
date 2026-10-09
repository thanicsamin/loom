import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,cp,readdir,chmod,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
const run=(command,args,options={})=>new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:'inherit',...options});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(command+' exited with '+code)));});
const variant=process.argv.includes('--debug')?'debug':'release';
await run(process.execPath,['scripts/build-mobile.mjs']);
const tooling=join(homedir(),'.local/share/loom-android-tooling');
let java=process.env.JAVA_HOME;
if(!java){try{java=join(tooling,'jdk',(await readdir(join(tooling,'jdk'))).find(name=>name.startsWith('jdk-21')));}catch{}}
const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT||join(tooling,'sdk');
await stat(sdk).catch(()=>{throw Error('Set ANDROID_HOME to an installed Android SDK.');});
if(!java)throw Error('Set JAVA_HOME to JDK 17 or 21.');
const env={...process.env,JAVA_HOME:java,ANDROID_HOME:sdk};
const privateDir=process.env.LOOM_ANDROID_SIGNING_DIR||join(homedir(),'.local/share/loom-android-signing');
if(variant==='release'){
 await mkdir(privateDir,{recursive:true,mode:0o700});await chmod(privateDir,0o700);
 const configPath=join(privateDir,'signing.json');let signing;
 try{signing=JSON.parse(await readFile(configPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;signing={keystore:join(privateDir,'loom-release.jks'),password:randomBytes(32).toString('base64url')};await writeFile(configPath,JSON.stringify(signing),{mode:0o600,flag:'wx'});}
 Object.assign(env,{LOOM_ANDROID_KEYSTORE:signing.keystore,LOOM_ANDROID_STORE_PASSWORD:signing.password,LOOM_ANDROID_KEY_PASSWORD:signing.password});
 try{await stat(signing.keystore);}catch(e){if(e.code!=='ENOENT')throw e;await run(join(java,'bin','keytool'),['-genkeypair','-keystore',signing.keystore,'-storetype','JKS','-alias','loom','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Loom, O=Loom','-storepass:env','LOOM_ANDROID_STORE_PASSWORD','-keypass:env','LOOM_ANDROID_KEY_PASSWORD','-noprompt'],{env});await chmod(signing.keystore,0o600);}
}
const android=join(root,'mobile/android');
const gradleArgs=[variant==='release'?'assembleRelease':'assembleDebug',variant==='release'?'lintRelease':'lintDebug','--no-daemon','--console=plain'];
if(process.platform==='win32')await run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','gradlew.bat '+gradleArgs.join(' ')],{cwd:android,env});
else await run('./gradlew',gradleArgs,{cwd:android,env});
const destination=join(root,'release/android');await mkdir(destination,{recursive:true});const name='loom-android-'+JSON.parse(await readFile('package.json','utf8')).version+(variant==='debug'?'-debug':'')+'.apk';
await cp(join(android,'app/build/outputs/apk',variant,'app-'+variant+'.apk'),join(destination,name));
await writeFile(join(destination,name+'.sha256'),createHash('sha256').update(await readFile(join(destination,name))).digest('hex')+'  '+name+'\n');
console.log('APK: '+join(destination,name));
