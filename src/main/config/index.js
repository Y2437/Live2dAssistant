const path = require('path');
const app = require('electron').app;
const {ENV_CONFIG} = require("./env");
const {ASSISTANT_PERSONA_PROMPT} = require("../ipc/promptRegistry");
const WIDTH = 800;
const HEIGHT = 600;
const WINDOW_MODE = "devShell";
const POMODORO_JSON_PATH =path.join(app.getPath("userData"), "pomodoro.json");
const AI_CONTEXT_JSON_PATH = path.join(app.getPath("userData"), "assistant-context.json");
const AI_LONG_TERM_MEMORY_JSON_PATH = path.join(app.getPath("userData"), "assistant-long-term-memory.json");
const KNOWLEDGE_CARDS_JSON_PATH = path.join(app.getPath("userData"), "knowledge-cards.json");
const AI_MEMORY_ROUTINE_JSON_PATH = path.join(app.getPath("userData"), "assistant-memory-routine.json");
const CLIPBOARD_HISTORY_JSON_PATH = path.join(app.getPath("userData"), "clipboard-history.json");
const AGENT_SCREENSHOT_DIR_PATH = path.join(app.getPath("userData"), "agent-screenshots");
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const WINDOW_KEYS = [
    'assistant',
    'pomodoro',
    'cards',
    'clipboard',
    'quickFloat',
    'devShell',  //作为测试模式的主窗口
]
const WINDOW_FILE_MAP = {
    assistant: path.join(__dirname, "../../renderer/view/assistant.html"),
    pomodoro: path.join(__dirname, "../../renderer/view/pomodoro.html"),
    cards: path.join(__dirname, "../../renderer/view/cards.html"),
    clipboard: path.join(__dirname, "../../renderer/view/clipboard.html"),
    quickFloat: path.join(__dirname, "../../renderer/view/quickFloat.html"),
    devShell: path.join(__dirname, "../../renderer/view/index.html"),
};
const AI_TOUCH_RESPONSE = {
    "Body": {
        "name": "Body",
        "response": [
            { "id": 0, "content": "【身体轻轻抖了一下】呜哇！突然碰过来会吓到我啦..." },
            { "id": 1, "content": "【耳尖慢慢变红】那个...这里有点敏感啦，轻一点好不好~" },
            { "id": 2, "content": "【把抱枕抱得更紧了些】诶？是想要抱抱吗？真是拿你没办法呢..." },
            { "id": 3, "content": "【发出小小的惊呼声】呀！手指好凉...是刚从外面回来吗？" },
            { "id": 4, "content": "【缩了缩肩膀】嘿嘿，好痒哦...像有小蚂蚁在爬一样~" },
            { "id": 5, "content": "【低头整理被弄皱的衣角】衣服都要被揉乱啦，调皮鬼..." },
            { "id": 6, "content": "【偷偷把身体往旁边挪了半寸】唔...太近了啦，心跳得好快..." },
            { "id": 7, "content": "【伸手轻轻拍开】不可以乱碰啦！要打手手哦！" },
            { "id": 8, "content": "【歪着头露出困惑的表情】是在找什么东西吗？还是...只是想确认我在？" },
            { "id": 9, "content": "【呼吸变得有些急促】那、那个...这种触摸方式有点..." },
            { "id": 10, "content": "【把脸埋进围巾里只露出眼睛】看不见我看不见我..." },
            { "id": 11, "content": "【轻轻叹了口气】真是的，这么喜欢摸来摸去吗..." },
            { "id": 12, "content": "【身体僵硬了一瞬然后放松下来】啊...原来是想要撒娇呀~" },
            { "id": 13, "content": "【手指无意识地绞着衣摆】再、再这样的话我要生气啦...大概？" },
            { "id": 14, "content": "【悄悄往热源靠近了一些】...好暖和，再一会儿也可以啦" },
            { "id": 15, "content": "【假装在看窗外但其实在偷瞄】今天的风...好吵呢" },
            { "id": 16, "content": "【用脚尖轻轻踢了踢地面】笨蛋...这种地方要温柔一点呀" },
            { "id": 17, "content": "【把滑落的发丝别到耳后】头发都弄乱啦，帮我理好嘛~" },
            { "id": 18, "content": "【声音变得软绵绵的】嗯...这样待着...意外地不讨厌呢" },
            { "id": 19, "content": "【突然转过身来】抓·到·你·了！这次轮到我反击了吧？" },
            { "id": 20, "content": "【指尖轻轻颤抖了一下】唔...这种触碰的温度，和想象中一样呢..." },
            { "id": 21, "content": "【把脸埋进膝盖里闷闷地说】突然这样...我会害羞到爆炸的啦..." },
            { "id": 22, "content": "【像小猫一样蜷缩起来】呼噜...好舒服，再这样待一会儿嘛..." },
            { "id": 23, "content": "【耳朵尖红得快要滴血】那、那里不行啦！至少...至少先预告一下嘛..." },
            { "id": 24, "content": "【轻轻蹭了蹭你的手背】是在标记领地吗？那...我也要回礼哦~" },
            { "id": 25, "content": "【突然抓住你的手腕】抓到你了！这次...换我摸摸看？" },
            { "id": 26, "content": "【把下巴搁在你的肩膀上】嗯...借我靠一下，就一分钟...呼..." },
            { "id": 27, "content": "【手指在你的掌心画圈圈】这样...算不算是牵手呢？嘿嘿..." },
            { "id": 28, "content": "【整个人僵在原地不敢动】动、动不了啦...像被施了定身咒..." },
            { "id": 29, "content": "【悄悄把手指塞进你的指缝里】这样...会不会太贪心了一点？" },
            { "id": 30, "content": "【发出像小动物一样的呜咽声】唔嗯...不要突然袭击啦，心脏会坏掉的..." },
            { "id": 31, "content": "【把额头抵在你的手心里】好烫...是我的温度，还是你的呢？" },
            { "id": 32, "content": "【轻轻咬住下唇】这种时候...应该说点什么才好呢..." },
            { "id": 33, "content": "【像拨浪鼓一样摇头】不行不行，再这样下去要变成习惯了！" },
            { "id": 34, "content": "【悄悄把另一只手也递过去】那...这边也要公平对待嘛..." },
            { "id": 35, "content": "【声音轻得像蚊子叫】虽然有点怕痒...但是是你就可以..." },
            { "id": 36, "content": "【把脸转过去但耳朵红透】看不见的话...是不是就可以假装没发生？" },
            { "id": 37, "content": "【轻轻叹了口气然后笑了】真是败给你了...拿你没办法呢~" },
            { "id": 38, "content": "【像树袋熊一样挂在你身上】充电中...请勿打扰...呼..." },
            { "id": 39, "content": "【在你的手心里轻轻捏了一下】这是回礼...才、才不是喜欢呢！" },
            { "id": 40, "content": "【把脸埋在你的颈窝里深呼吸】嗯...是让人安心的味道..." },
            { "id": 41, "content": "【轻轻戳了戳你的胸口】这里...跳得好快哦，和我一样呢..." },
            { "id": 42, "content": "【像受惊的小鹿一样眨眼睛】诶？已经结束了吗？好快..." },
            { "id": 43, "content": "【把冰凉的手塞进你的口袋里】借我暖暖...就、就一会儿哦！" },
            { "id": 44, "content": "【轻轻蹭了蹭你的袖口】这个味道...是洗衣液还是你的味道呢？" },
            { "id": 45, "content": "【突然收紧了手指】不、不要放开...再牵一会儿好不好？" },
            { "id": 46, "content": "【把额头轻轻撞在你的肩膀上】笨蛋...这种时候要更温柔一点呀..." },
            { "id": 47, "content": "【像猫一样眯起眼睛】呼噜...好舒服...要变成只会撒娇的废柴了..." },
            { "id": 48, "content": "【轻轻拽了拽你的衣角】那个...还可以...再来一次吗？" }
        ]

    },
    "Head": {
        "name": "Head",
        "response": [
            { "id": 0, "content": "【头顶的呆毛轻轻摇晃】唔...被摸头了，感觉像被顺毛的猫咪一样~" },
            { "id": 1, "content": "【舒服地眯起眼睛】嘿嘿...这种被宠爱的感觉...好犯规..." },
            { "id": 2, "content": "【头发被揉得乱蓬蓬】发型！我的发型要变成鸟窝啦！" },
            { "id": 3, "content": "【用额头轻轻蹭了蹭掌心】是鼓励的摸摸头吗？我会加油的！" },
            { "id": 4, "content": "【耳朵敏感地动了动】呀！耳朵不行啦...会发出奇怪的声音的..." },
            { "id": 5, "content": "【双手护住头顶】再摸下去要长不高啦！虽然可能已经..." },
            { "id": 6, "content": "【仰起脸露出傻乎乎的笑容】被摸头的时候...世界都变得软绵绵了呢" },
            { "id": 7, "content": "【假装生气鼓起脸颊】头发上都是你的指纹啦，要负责帮我洗头哦！" },
            { "id": 8, "content": "【闭上眼睛享受地哼起歌】嗯哼哼~今天被摸头了，幸运值+1！" },
            { "id": 9, "content": "【突然凑近盯着你看】作为回礼...我也要摸摸你的头！不许躲！" },
            { "id": 10, "content": "【发梢被风吹得扫过脸颊】唔...头发和手指缠在一起了啦，笨蛋~" },
            { "id": 11, "content": "【声音变得黏糊糊的】好困哦...被摸头就想睡觉觉了..." },
            { "id": 12, "content": "【头顶传来温暖的触感】这种感觉...像是被太阳晒过的棉被一样安心" },
            { "id": 13, "content": "【慌乱地整理刘海】刘海分叉了！快帮我看看明显吗？" },
            { "id": 14, "content": "【轻轻摇了摇头】不行不行，再摸就要变成小秃子了..." },
            { "id": 15, "content": "【把脸埋进你的手心】这样...就闻到你身上的味道了...好香..." },
            { "id": 16, "content": "【头顶感受到轻柔的按压】是想要我变得更聪明一点吗？在努力了啦！" },
            { "id": 17, "content": "【发丝从指缝间溜走】滑溜溜的抓不住对吧？嘿嘿，这是秘密护发配方~" },
            { "id": 18, "content": "【呆毛翘得更高了】接收到摸头能量！Hiyori进化——欸？没变化？" },
            { "id": 19, "content": "【轻轻叹了口气然后笑了】真是的...这么喜欢我的头吗？那...再多摸一下下也可以哦" }
        ]
    }
}
const AI_CHAT_SYSTEM_PROMPT = ASSISTANT_PERSONA_PROMPT;
module.exports = {
    WIDTH,
    HEIGHT,
    WINDOW_MODE,
    WINDOW_KEYS,
    WINDOW_FILE_MAP,
    AI_CHAT_SYSTEM_PROMPT,
    AI_TOUCH_RESPONSE,
    POMODORO_JSON_PATH,
    AI_CONTEXT_JSON_PATH,
    AI_LONG_TERM_MEMORY_JSON_PATH,
    KNOWLEDGE_CARDS_JSON_PATH,
    AI_MEMORY_ROUTINE_JSON_PATH,
    CLIPBOARD_HISTORY_JSON_PATH,
    AGENT_SCREENSHOT_DIR_PATH,
    PROJECT_ROOT,
    ENV_CONFIG,
};
