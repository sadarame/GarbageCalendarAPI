// Print only to a trusted terminal. Never persist or share this token publicly.
const {initializeApp, applicationDefault} = require('firebase-admin/app');
const {getAuth} = require('firebase-admin/auth');
const useGcloud = process.argv.includes('--gcloud');
const credential = useGcloud ? {getAccessToken: async () => ({access_token: require('node:child_process').execFileSync('gcloud', ['auth','print-access-token'], {encoding:'utf8'}).trim(), expires_in: 3000})} : applicationDefault();
initializeApp({credential, projectId: 'garbagecalendar-1923d',
 ...(useGcloud ? {serviceAccountId:'garbage-schedule-login@garbagecalendar-1923d.iam.gserviceaccount.com'} : {}),
 ...(process.env.ADMIN_SIGNER_SERVICE_ACCOUNT ? {serviceAccountId:process.env.ADMIN_SIGNER_SERVICE_ACCOUNT} : {})});
getAuth().createCustomToken('regional-schedule-operator', {scheduleAdmin: true})
 .then(token => process.stdout.write(token+'\n'))
 .catch(error => {console.error(error.message);process.exitCode=1;});
