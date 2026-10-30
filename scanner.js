'use strict';
const APP_URL='https://script.google.com/macros/s/AKfycbyQjy5N30aaxIEOIpxTH2hgUhXkumoYUV6zSudzOeVlLqw0zMWFmiydq80Qi0JdcS9r/exec';
const el=id=>document.getElementById(id);
let stream=null,generation=0;
const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
function normalizeCode(value){const code=String(value||'').trim().toUpperCase();return code.length<=80&&/^[A-Z0-9]+(?:-[A-Z0-9]+){2,5}$/.test(code)?code:null;}
function assetUrl(code){const valid=normalizeCode(code);if(!valid)throw new Error('관리번호 형식을 확인해 주세요.');const url=new URL(APP_URL);url.searchParams.set('code',valid);return url.href;}
function message(text){el('message').textContent=text;}
function stop(){generation++;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;el('video').srcObject=null;el('video').hidden=true;el('stop').hidden=true;el('start').disabled=false;}
function cameraError(error){
  const policy=document.permissionsPolicy||document.featurePolicy;
  if(policy?.allowsFeature&&!policy.allowsFeature('camera'))return '이 페이지가 다른 앱이나 사이트 안에 삽입되어 카메라가 차단되었습니다. 스캔 페이지 주소를 Chrome 또는 삼성 인터넷의 새 탭에서 직접 열어 주세요.';
  if(error.name==='NotAllowedError'||error.name==='SecurityError')return '카메라 권한이 차단되어 있습니다. 브라우저의 이 사이트 권한에서 카메라를 허용하고, 휴대폰 설정에서도 해당 브라우저의 카메라 권한을 확인해 주세요.';
  if(error.name==='NotFoundError')return '사용 가능한 카메라를 찾지 못했습니다. 카메라가 있는 휴대폰에서 열어 주세요.';
  if(error.name==='NotReadableError'||error.name==='AbortError')return '다른 앱에서 카메라를 사용 중일 수 있습니다. 카메라 앱을 닫고 다시 눌러 주세요.';
  return error.message||'카메라를 시작하지 못했습니다. 관리번호로 검색할 수 있습니다.';
}
async function acquireCamera(){
  try{return await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});}
  catch(error){if(error.name!=='OverconstrainedError')throw error;return navigator.mediaDevices.getUserMedia({audio:false,video:true});}
}
let navigating=false,inputTimer=null;
function navigateAsset(code){if(navigating)return;const url=assetUrl(code);navigating=true;clearTimeout(inputTimer);stop();message('자산의 소유자·부서·사용장소를 불러옵니다.');window.location.assign(url);}
function found(value){const code=normalizeCode(value);if(!code)return false;el('code').value=code;navigateAsset(code);return true;}
async function start(){
  stop();const run=generation;el('start').disabled=true;el('stop').hidden=false;el('result').hidden=true;
  try{
    if(!window.isSecureContext)throw new Error('HTTPS 주소에서 스캔 페이지를 열어 주세요.');
    const policy=document.permissionsPolicy||document.featurePolicy;
    if(policy?.allowsFeature&&!policy.allowsFeature('camera'))throw new DOMException('Camera policy blocked','NotAllowedError');
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('이 환경은 카메라를 지원하지 않습니다. 최신 Chrome 또는 삼성 인터넷에서 직접 열어 주세요.');
    const candidate=await acquireCamera();if(run!==generation){candidate.getTracks().forEach(t=>t.stop());return;}
    stream=candidate;const video=el('video');video.muted=true;video.srcObject=stream;video.hidden=false;await video.play();
    message('QR이 선명하게 보이도록 거리를 조절해 주세요.');
    const tick=()=>{if(run!==generation)return;try{if(video.readyState>=2&&video.videoWidth){const scale=Math.min(1,1280/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);ctx.drawImage(video,0,0,canvas.width,canvas.height);const image=ctx.getImageData(0,0,canvas.width,canvas.height);const code=jsQR(image.data,image.width,image.height,{inversionAttempts:'attemptBoth'});if(code&&found(code.data))return;}}catch(error){stop();message('QR 인식기를 실행하지 못했습니다. 페이지를 새로고침해 주세요.');return;}if(run===generation)setTimeout(tick,180);};tick();
  }catch(error){if(run===generation){stop();message(cameraError(error));}}
}
el('start').onclick=start;el('stop').onclick=stop;
el('lookup').onclick=()=>{try{navigateAsset(el('code').value);}catch(error){message(error.message);}};
el('code').addEventListener('input',()=>{clearTimeout(inputTimer);const code=normalizeCode(el('code').value);if(code&&/^[A-Z]-\d{2}-\d{4}-\d{4}$/.test(code))inputTimer=setTimeout(()=>navigateAsset(code),650);});
el('code').addEventListener('keydown',e=>{if(e.key==='Enter')el('lookup').click();});
window.addEventListener('pagehide',()=>{clearTimeout(inputTimer);stop();});window.addEventListener('pageshow',()=>{navigating=false;});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(inputTimer);stop();}});
