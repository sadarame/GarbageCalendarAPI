// plan is fully offline. Database mutations require an explicit project and checksum.
const fs=require('node:fs');
const {makeManifest,validateManifest,applyManifest}=require('../lib/migration');
async function main() {
  const [operation,file,project,confirmation]=process.argv.slice(2);
  if (!['plan','import','rollback'].includes(operation)||!file||!project) throw Error('Usage: node scripts/migrate.js plan candidates.json project-id | import/rollback manifest.json project-id manifest-sha256');
  const input=JSON.parse(fs.readFileSync(file,'utf8'));
  if (operation==='plan') { console.log(JSON.stringify(makeManifest(input,project),null,2));return; }
  const manifest=validateManifest(input);
  if (manifest.project!==project||confirmation!==manifest.sha256) throw Error('Explicit project and checksum must match manifest');
  if (process.env.FIRESTORE_EMULATOR_HOST && !project.startsWith('demo-')) throw Error('Emulator requires demo project');
  if (!process.env.FIRESTORE_EMULATOR_HOST && project.startsWith('demo-')) throw Error('Demo project requires emulator');
  const {initializeApp,deleteApp}=require('firebase-admin/app');
  const {getFirestore}=require('firebase-admin/firestore');
  const app=initializeApp({projectId:project});const db=getFirestore(app);
  try {
    const result=await applyManifest(db,manifest,operation,project);
    console.log(JSON.stringify({project,batch:manifest.batch,operation,...result}));
    if(result.conflicts.length) process.exitCode=2;
  } finally {await db.terminate();await deleteApp(app);}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
