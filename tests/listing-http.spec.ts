import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
async function main() {
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'community-http-'));
 const socket=net.createServer();await new Promise<void>(r=>socket.listen(0,'127.0.0.1',r));
 const port=(socket.address() as net.AddressInfo).port;await new Promise<void>(r=>socket.close(()=>r()));
 Object.assign(process.env,{BOT_TOKEN:'123456789:test-only',ARBITER_TG_IDS:'999',ARBITER_MNEMONIC:Array(24).fill('test').join(' '),PLATFORM_ADDRESS:'0:'+'0'.repeat(64),DB_PATH:path.join(folder,'test.sqlite'),MINI_APP_PORT:String(port),COMMUNITY_INTEGRATION_KEY:'k'.repeat(48)});
 require('../src/miniapp').startMiniAppServer();
 const base=`http://127.0.0.1:${port}`;
 const request=(route:string, method='GET', body?:any, auth=true)=>fetch(base+route,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+'k'.repeat(48)}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const input={token:'http_test_listing_123456789',seller_tg_id:100,amount_units:'12000000000',description:'Gift #123',channel_id:'-100123',escrow_enabled:true};
 assert.equal((await request('/api/community/listings','POST',input,false)).status,403);
 assert.equal((await request('/api/community/listings','POST',input)).status,200);
 assert.equal((await request(`/api/community/listings/${input.token}/publish`,'POST',{message_id:1,post_url:'https://t.me/channel/1'})).status,200);
 assert.equal((await request(`/api/community/listings/${input.token}/active`,'POST',{active:'false'})).status,400);
 assert.equal((await request(`/api/community/listings/${input.token}/active`,'POST',{active:false})).status,200);
 assert.equal((await request('/api/community/events?after=-1')).status,400);
 assert.equal((await request('/api/community/events?after=0', 'GET',undefined,false)).status,403);
 assert.equal((await request('/api/community/events?after=0')).status,200);
 assert.equal((await request('/api/bootstrap','GET',undefined,true)).status,401); // Service key is not user auth.
 require('../src/db').db.close();fs.rmSync(folder,{recursive:true,force:true});
 console.log('PASS: real HTTP routes, service authentication, validation, listing activation, event cursor and user-auth separation');
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
