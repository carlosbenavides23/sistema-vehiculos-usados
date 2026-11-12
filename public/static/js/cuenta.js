"use strict";
(() => {
  const one=id=>document.getElementById(id), form=one('cuenta-form'), estado=one('cuenta-estado');
  let registro=false;
  async function api(path,body) {
    const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name="csrf-token"]').content},body:body?JSON.stringify(body):undefined});
    const data=await response.json();
    if(!response.ok) throw new Error(data.mensaje||'No se pudo completar la operación.');
    return data;
  }
  function mostrar(data) {
    const user=data.usuario;
    estado.textContent=user?`Sesión iniciada: ${user.email} · ${user.rol}`:data.mensaje||'';
    form.hidden=Boolean(user);one('salir-cuenta').hidden=!user;
  }
  api('/api/cuenta').then(mostrar).catch(()=>{});
  one('mostrar-password').onclick=()=>{const campo=one('password'), visible=campo.type==='password';campo.type=visible?'text':'password';one('mostrar-password').textContent=visible?'Ocultar contraseña':'Mostrar contraseña';one('mostrar-password').setAttribute('aria-pressed',String(visible));};
  one('modo-cuenta').onclick=()=>{registro=!registro;one('rol-field').hidden=!registro;one('password').autocomplete=registro?'new-password':'current-password';one('enviar-cuenta').textContent=registro?'Crear cuenta':'Iniciar sesión';one('modo-cuenta').textContent=registro?'Ya tengo cuenta':'Crear cuenta';};
  form.onsubmit=async event=>{event.preventDefault();const button=one('enviar-cuenta');button.disabled=true;estado.textContent='Procesando…';try{const body={email:one('email').value,password:one('password').value};if(registro)body.rol=one('rol').value;mostrar(await api(`/api/cuenta/${registro?'registro':'login'}`,body));one('password').value='';}catch(e){estado.textContent=e.message||'Revisá la conexión e intentá nuevamente.';}finally{button.disabled=false;}};
  one('salir-cuenta').onclick=async()=>{const button=one('salir-cuenta');button.disabled=true;try{mostrar(await api('/api/cuenta/logout',{}));}catch(e){estado.textContent=e.message;}finally{button.disabled=false;}};
})();
