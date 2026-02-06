// console.log(await window.api.ping());
const getElementById = (el,root=document) => root.querySelector(el);
const getAllElementsById = (el,root=document) => Array.from(root.querySelectorAll(el));
const DEFAULT_VIEW = "assistant";

function setNavBtnActive(viewKey) {
    const navBtns = getAllElementsById('.nav__btn');
    navBtns.forEach(navBtn => {
        navBtn.classList.toggle('is-active', navBtn.dataset.view === viewKey);
    })
}
function showView(viewKey) {
    const views = getAllElementsById('.view');
    setNavBtnActive(viewKey);
    views.forEach(view => {
        view.classList.toggle('is-active', view.dataset.view === viewKey);
    })
    const hintText=getElementById(`p.nav__hint[data-role="ActiveText"]`);
    hintText.textContent=`当前激活视图：${viewKey}`;
}
function wireNav() {
    const nav=getElementById(`nav.shell__nav`);
    nav.addEventListener('click',async (e)=>{
        if(!e.target.classList.contains("nav__btn")) return;
        const viewKey=e.target.dataset.view;
        await window.api.openWindow(viewKey);
    })
}
function wireIpc(){
    window.api.onShowView((payload)=>{
        showView(payload.viewKey);
    });
}
function boot(){
    wireNav();
    wireIpc();
    showView(DEFAULT_VIEW);
}
boot();

