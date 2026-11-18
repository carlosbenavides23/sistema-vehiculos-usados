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
 browser=await chromium.launch({headless:true,executablePath:chrome});await fs.mkdir(out,{recursive:true});const errors=[];
 async function session(name){const context=await browser.newContext({viewport:{width:1920,height:1080}});await context.route('**/*',r=>new URL(r.request().url()).origin===info.url?r.continue():r.abort());const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));if(name){await p.goto(info.url+'/cuenta');await p.getByLabel('Correo electrónico',{exact:true}).fill(name+'@example.test');await p.getByLabel('Contraseña',{exact:true}).fill('local-fixture-password');await p.getByRole('button',{name:'Iniciar sesión',exact:true}).click();if(name.startsWith('seller_'))await p.waitForURL('**/vendedor');else await p.locator('#salir-cuenta').waitFor();}return p;}
 const p=await session();await p.goto(info.url+'/');await p.getByRole('link',{name:'Vendedor: Vendedora Carla',exact:true}).first().click();await p.getByRole('heading',{name:'Vendedora Carla',exact:true}).waitFor();await p.getByRole('link',{name:'Ver ficha completa de Toyota Corolla',exact:true}).waitFor();
 const profile=p.url();assert.equal(await p.getByRole('link',{name:'Mis publicaciones',exact:true}).count(),0);
 const data=await (await p.request.get(info.url+'/api'+new URL(profile).pathname)).json();assert.equal(data.vehiculos.length,14);assert.equal(data.vehiculos.some(v=>v.id===info.vehicles[1]),false);assert.equal(data.vehiculos.some(v=>v.disponibilidad==='vendido'),true);assert.ok(data.vehiculos.every(v=>!('placa'in v)&&!('vendedor_id'in v)));assert.deepEqual(Object.keys(data.vendedor).sort(),['nombre','url']);
 await p.screenshot({path:out+'/perfil-publico.png'});
 await p.getByRole('link',{name:'Ver ficha completa de Toyota Corolla',exact:true}).click();await p.getByRole('link',{name:'Vendedora Carla',exact:true}).waitFor();await p.getByRole('link',{name:'Volver al perfil del vendedor',exact:true}).click();assert.equal(p.url(),profile);
 await p.getByRole('link',{name:'Ver ficha completa de Nissan Sentra 2',exact:true}).click();await p.getByRole('link',{name:'Vendedora Carla',exact:true}).waitFor();await p.getByRole('button',{name:'Contactar al vendedor',exact:true}).click();await p.getByRole('link',{name:'Iniciar sesión',exact:true}).waitFor();
 const s=await session('seller_a');await s.getByRole('link',{name:'Toyota Corolla',exact:true}).first().click();await s.getByRole('link',{name:'Volver a mis publicaciones',exact:true}).waitFor();await s.getByRole('link',{name:'Vendedora Carla',exact:true}).click();await s.getByRole('link',{name:'Mis publicaciones',exact:true}).click();await s.getByRole('heading',{name:'Gestioná tus vehículos',exact:true}).waitFor();
 const b=await session('buyer_a');await b.getByRole('link',{name:'Volver al catálogo',exact:true}).click();await b.getByRole('link',{name:'Vendedor: Vendedor B',exact:true}).click();await b.getByRole('heading',{name:'Vendedor B',exact:true}).waitFor();assert.equal(await b.getByRole('link',{name:'Mis publicaciones',exact:true}).count(),0);
 const empty=await session('seller_empty');await empty.getByRole('link',{name:'Explorar catálogo',exact:true}).click();
 // Empty seller has no card from which to obtain a URL: discover its local ID through verified private identity, only for test setup.
 const identity=await (await empty.request.get(info.url+'/api/cuenta')).json();await empty.goto(info.url+'/vendedores/'+identity.usuario.id);await empty.getByRole('heading',{name:'Sin publicaciones visibles',exact:true}).waitFor();
 await p.goto(info.url+'/vehiculo/1');await p.getByText('Vendedor no identificado',{exact:true}).waitFor();assert.equal(await p.getByRole('link',{name:'Volver a mis publicaciones',exact:true}).count(),0);
 assert.deepEqual(errors,[]);console.log('PASS V7.14: perfiles públicos, tarjetas, ficha, propietario, comprador, legado, vacío y privacidad a 1920x1080');
}finally{await browser?.close();server.stdin.end('stop\n');await new Promise(r=>{if(server.exitCode!==null)return r();const t=setTimeout(()=>{server.kill();r();},10000);server.once('exit',()=>{clearTimeout(t);r();});});}
