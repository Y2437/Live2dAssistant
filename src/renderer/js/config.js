 export const CONFIG = {
    DEFAULT_VIEW: "assistant",
    LIVE2D_MODEL: "../assets/live2d/Hiyori",
    LIVE2D_CONFIG: {
        HEIGHT: 520,
        WIDTH: 900,
        model: {
            jsonFile: "../assets/live2d/Hiyori/Hiyori.model3.json",
        },
        renderer: {
            type: "WebGL",
            preserveDrawingBuffer: true,
        },
    },
}