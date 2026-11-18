import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';
const [python,pw,chrome,out]=process.argv.slice(2);
const {chromium}=await import(pathToFileURL(pw));
const server=spawn(python,['tests/fixture_v711_ui.py'],{env:{...process.env,PYTHON_DOTENV_DISABLED:'1'},stdio:['pipe','pipe','pipe']});
let log='',browser;server.stderr.on('data',x=>log+=x);
try {
 const info=await new Promise((ok,no)=>{const t=setTimeout(()=>no(Error(log)),45000);createInterface({input:server.stdout}).on('line',l=>{if(l.startsWith('V711_SERVER ')){clearTimeout(t);ok(JSON.parse(l.slice(12)));}});server.once('exit',()=>{clearTimeout(t);no(Error(log));});});
 browser=await chromium.launch({headless:true,executablePath:chrome});await fs.mkdir(out,{recursive:true});
 const errors=[];
 async function account(name){const context=await browser.newContext({viewport:{width:1920,height:1080}});await context.route('**/*',r=>new URL(r.request().url()).origin===info.url?r.continue():r.abort());const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(info.url+'/cuenta');await page.getByLabel('Correo electrónico',{exact:true}).fill(name+'@example.test');await page.getByLabel('Contraseña',{exact:true}).fill('local-fixture-password');await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();if(name.startsWith('seller_'))await page.waitForURL('**/vendedor');else await page.locator('#salir-cuenta').waitFor();return{page,context};}
 const seller=await account('seller_a'),s=seller.page;
 await s.getByRole('link',{name:'Toyota Corolla',exact:true}).first().click();
 await s.getByRole('link',{name:'Volver a mis publicaciones',exact:true}).waitFor();await s.getByRole('heading',{name:'Descripción',exact:true}).waitFor();await s.screenshot({path:out+'/ficha-propia.png'});
 await s.getByRole('link',{name:'Volver a mis publicaciones',exact:true}).click();await s.getByRole('link',{name:'Explorar catálogo',exact:true}).click();
 await s.getByRole('link',{name:'Mis conversaciones',exact:true}).click();await s.waitForURL('**/vendedor#conversaciones');await s.getByRole('option').first().waitFor();
 await s.getByRole('option').filter({hasText:'Toyota Corolla'}).click();await s.getByRole('textbox',{name:'Escribí una respuesta',exact:true}).waitFor();
 const buyer=await account('buyer_b'),b=buyer.page;
 await b.getByRole('link',{name:'Volver al catálogo',exact:true}).click();await b.getByRole('link',{name:'Ver ficha completa de Toyota Corolla',exact:true}).last().click();await b.getByRole('button',{name:'Contactar al vendedor',exact:true}).click();await b.getByRole('textbox',{name:'Escribe tu mensaje',exact:true}).waitFor();
 async function keyboard(page,role,editor,form){
  const text=page.getByRole('textbox',{name:editor,exact:true});
  let posts=0;const listener=r=>{if(r.method()==='POST'&&r.url().includes('/mensajes'))posts++;};page.on('request',listener);
  await text.fill('');await text.press('Enter');assert.equal(posts,0);
  await text.fill('Composición');await text.dispatchEvent('keydown',{key:'Enter',isComposing:true,bubbles:true});assert.equal(posts,0);
  await text.press('Shift+Enter');assert.match(await text.inputValue(),/\n/);
  await text.fill('Envío con Enter '+role);await text.press('Enter');await page.getByText('Envío con Enter '+role,{exact:true}).waitFor();await page.waitForFunction(id=>document.getElementById(id).value==='',form);
  await text.fill('Envío con botón '+role);await page.getByRole('button',{name:'Enviar',exact:true}).click();await page.getByText('Envío con botón '+role,{exact:true}).waitFor();
  let unlock,seen;const hold=new Promise(r=>unlock=r),started=new Promise(r=>seen=r);let waiting=0;
  const holdPattern='**/api/cuenta/chat/'+role+'/**/mensajes';
  await page.route(holdPattern,async r=>{if(r.request().method()!=='POST')return r.continue();waiting++;seen();await hold;await r.continue();});
  await text.fill('Envío único '+role);await text.press('Enter');await started;await text.press('Enter');await page.getByRole('button',{name:'Enviar',exact:true}).isDisabled().then(x=>assert.equal(x,true));assert.equal(waiting,1);unlock();await page.getByText('Envío único '+role,{exact:true}).waitFor();await page.unroute(holdPattern);
  let lost=true;const keys=[];const pattern='**/api/cuenta/chat/'+role+'/**/mensajes';
  await page.route(pattern,async r=>{if(r.request().method()!=='POST')return r.continue();keys.push(r.request().headers()['idempotency-key']);if(lost){lost=false;await r.fetch();await r.abort();}else await r.continue();});
  await text.fill('Respuesta perdida '+role);await text.press('Enter');await page.getByText(/No hay conexión/).first().waitFor();assert.equal(await text.inputValue(),'Respuesta perdida '+role);
  await text.press('Enter');await page.getByText('Respuesta perdida '+role,{exact:true}).waitFor();assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.equal(await page.getByText('Respuesta perdida '+role,{exact:true}).count(),1);await page.unroute(pattern);page.off('request',listener);
 }
 await keyboard(b,'comprador','Escribe tu mensaje','chat-comprador-texto');await keyboard(s,'vendedor','Escribí una respuesta','seller-reply-text');
 await b.getByRole('button',{name:'Cerrar mensajes',exact:true}).click();await b.getByRole('button',{name:'Mis conversaciones',exact:true}).click();await b.getByRole('button').filter({hasText:'Toyota Corolla'}).first().click();await b.getByRole('button',{name:'Ver ficha del vehículo',exact:true}).click();await b.getByRole('button',{name:'Contactar al vendedor',exact:true}).waitFor();
 // Contact/login return uses existing UI and must open without sending anything.
 const guest=await browser.newContext({viewport:{width:1920,height:1080}}),g=await guest.newPage();await guest.route('**/*',r=>new URL(r.request().url()).origin===info.url?r.continue():r.abort());await g.goto(info.url+'/');await g.getByRole('link',{name:'Ver ficha completa de Toyota Corolla',exact:true}).last().click();await g.getByRole('button',{name:'Contactar al vendedor',exact:true}).click();await g.getByRole('link',{name:'Iniciar sesión',exact:true}).click();await g.getByLabel('Correo electrónico',{exact:true}).fill('buyer_a@example.test');await g.getByLabel('Contraseña',{exact:true}).fill('local-fixture-password');await g.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await g.getByRole('textbox',{name:'Escribe tu mensaje',exact:true}).waitFor();await g.getByText('Consulta ficticia',{exact:true}).first().waitFor();await g.screenshot({path:out+'/contacto-recuperado.png'});
 // Foreign owner and tampered origins never offer private navigation.
 await b.goto(info.url+'/vehiculo/'+info.vehicles[0]+'?desde=inventario&retorno=https://evil.invalid');assert.equal(await b.getByRole('link',{name:'Volver a mis publicaciones',exact:true}).count(),0);assert.equal(await b.getByRole('link',{name:'Volver al catálogo',exact:true}).getAttribute('href'),'/');
 await s.goto(info.url+'/vehiculo/'+info.vehicles.at(-1)+'?desde=inventario');assert.equal(await s.getByRole('link',{name:'Volver a mis publicaciones',exact:true}).count(),0);
 await buyer.context.clearCookies();await b.reload();await b.getByRole('link',{name:'Iniciar sesión',exact:true}).waitFor();
 await b.goto(info.url+'/cuenta?next='+encodeURIComponent('https://evil.invalid/'));await b.getByLabel('Correo electrónico',{exact:true}).fill('buyer_b@example.test');await b.getByLabel('Contraseña',{exact:true}).fill('local-fixture-password');await b.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await b.getByRole('heading',{name:'Mi cuenta',exact:true}).waitFor();assert.equal(new URL(b.url()).pathname,'/cuenta');assert.equal(new URL(b.url()).origin,info.url);
 assert.deepEqual(errors,[]);console.log('PASS V7.13: propiedad, roles, retorno, sesión, teclado, IME y reintentos comprador/vendedor a 1920x1080');
} finally {await browser?.close();server.stdin.end('stop\n');await new Promise(r=>{if(server.exitCode!==null)return r();const t=setTimeout(()=>{server.kill();r();},10000);server.once('exit',()=>{clearTimeout(t);r();});});}
