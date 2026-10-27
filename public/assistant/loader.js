(() => {
  const run = () => {
    if (window.__isukaAssistantLoader) return;
    window.__isukaAssistantLoader = true;
    const button = document.createElement('button');
    button.className = 'isuka-assistant-launcher idle'; button.type='button'; button.setAttribute('aria-label','Ask Isuka');
    button.innerHTML='<img src="/assets/ISUKA%20BOT.png" alt="">';
    let showHint=true;try{showHint=!localStorage.getItem('isuka-assistant-hint');if(showHint)localStorage.setItem('isuka-assistant-hint','1');}catch{}
    if(showHint){const hint=document.createElement('span');hint.className='isuka-assistant-hint';hint.textContent='Ask Isuka';document.body.append(hint);setTimeout(()=>hint.remove(),6000);}
    document.body.append(button);
    let loaded=false;
    const open=()=>{sessionStorage.setItem('isuka-assistant-state','open');button.classList.remove('idle');if(!loaded){loaded=true;const s=document.createElement('script');s.src='/assistant/app.js';s.onload=()=>window.IsukaAssistant?.open();s.onerror=()=>{loaded=false;};document.body.append(s);}else window.IsukaAssistant?.open();};
    button.addEventListener('click',open);
    document.addEventListener('keydown',e=>{if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||'')){e.preventDefault();open();}});
    if(sessionStorage.getItem('isuka-assistant-state')==='open'||new URL(location.href).searchParams.has('assistant'))open();
  };
  if ('requestIdleCallback' in window) requestIdleCallback(run,{timeout:1800}); else setTimeout(run,500);
})();
