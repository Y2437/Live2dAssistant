// console.log(await window.api.ping());
async function init(){
    let test=document.getElementsByClassName('test');
    test[0].textContent=await window.api.ping();
    console.log(await window.api.ping());
    console.log(await window.api.openWindow("devShell"));
}
init()