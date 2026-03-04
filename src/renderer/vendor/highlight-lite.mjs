const registry = new Map();

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function applyRules(source, rules) {
    let html = escapeHtml(source);
    for (const rule of rules) {
        html = html.replace(rule.pattern, rule.replacer);
    }
    return html;
}

function commonCodeRules() {
    return [
        {
            pattern: /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g,
            replacer: '<span class="hljs-string">$1</span>',
        },
        {
            pattern: /(`(?:\\.|[^`\\])*`)/g,
            replacer: '<span class="hljs-string">$1</span>',
        },
        {
            pattern: /\b(\d+(?:\.\d+)?)\b/g,
            replacer: '<span class="hljs-number">$1</span>',
        },
        {
            pattern: /\b(true|false|null|undefined)\b/g,
            replacer: '<span class="hljs-literal">$1</span>',
        },
    ];
}

const highlighters = {
    javascript(source) {
        return applyRules(source, [
            {
                pattern: /\b(import|from|export|default|return|if|else|for|while|switch|case|break|continue|try|catch|finally|throw|new|class|extends|const|let|var|function|async|await|typeof|instanceof|in|of)\b/g,
                replacer: '<span class="hljs-keyword">$1</span>',
            },
            {
                pattern: /\b(this|super)\b/g,
                replacer: '<span class="hljs-variable">$1</span>',
            },
            {
                pattern: /(\/\/.*$)/gm,
                replacer: '<span class="hljs-comment">$1</span>',
            },
            {
                pattern: /(\/\*[\s\S]*?\*\/)/g,
                replacer: '<span class="hljs-comment">$1</span>',
            },
            ...commonCodeRules(),
        ]);
    },
    typescript(source) {
        return applyRules(source, [
            {
                pattern: /\b(interface|type|implements|public|private|protected|readonly|enum|namespace|declare|abstract|as|satisfies)\b/g,
                replacer: '<span class="hljs-keyword">$1</span>',
            },
            ...commonCodeRules(),
            {
                pattern: /\b(import|from|export|default|return|if|else|for|while|switch|case|break|continue|try|catch|finally|throw|new|class|extends|const|let|var|function|async|await|typeof|instanceof|in|of)\b/g,
                replacer: '<span class="hljs-keyword">$1</span>',
            },
            {
                pattern: /(\/\/.*$)/gm,
                replacer: '<span class="hljs-comment">$1</span>',
            },
            {
                pattern: /(\/\*[\s\S]*?\*\/)/g,
                replacer: '<span class="hljs-comment">$1</span>',
            },
        ]);
    },
    json(source) {
        return applyRules(source, [
            {
                pattern: /("(?:\\.|[^"\\])*")(\s*:)/g,
                replacer: '<span class="hljs-attr">$1</span>$2',
            },
            ...commonCodeRules(),
        ]);
    },
    html(source) {
        return applyRules(source, [
            {
                pattern: /(&lt;\/?)([a-zA-Z][\w:-]*)(.*?&gt;)/g,
                replacer: '$1<span class="hljs-name">$2</span>$3',
            },
            {
                pattern: /([a-zA-Z:-]+)=(&quot;.*?&quot;)/g,
                replacer: '<span class="hljs-attr">$1</span>=<span class="hljs-string">$2</span>',
            },
        ]);
    },
    xml(source) {
        return highlighters.html(source);
    },
    css(source) {
        return applyRules(source, [
            {
                pattern: /([.#]?[a-zA-Z_-][\w-]*)(\s*\{)/g,
                replacer: '<span class="hljs-selector-class">$1</span>$2',
            },
            {
                pattern: /([a-z-]+)(\s*:)/g,
                replacer: '<span class="hljs-attribute">$1</span>$2',
            },
            ...commonCodeRules(),
            {
                pattern: /(\/\*[\s\S]*?\*\/)/g,
                replacer: '<span class="hljs-comment">$1</span>',
            },
        ]);
    },
    markdown(source) {
        return applyRules(source, [
            {
                pattern: /^(#{1,6} .*)$/gm,
                replacer: '<span class="hljs-section">$1</span>',
            },
            {
                pattern: /(\*\*[^*]+\*\*|__[^_]+__)/g,
                replacer: '<span class="hljs-strong">$1</span>',
            },
            {
                pattern: /(`[^`]+`)/g,
                replacer: '<span class="hljs-code">$1</span>',
            },
            {
                pattern: /(\[[^\]]+\]\([^)]+\))/g,
                replacer: '<span class="hljs-link">$1</span>',
            },
        ]);
    },
    bash(source) {
        return applyRules(source, [
            {
                pattern: /^(#!.*|#.*)$/gm,
                replacer: '<span class="hljs-comment">$1</span>',
            },
            {
                pattern: /\b(if|then|else|fi|for|do|done|case|esac|function|in|while)\b/g,
                replacer: '<span class="hljs-keyword">$1</span>',
            },
            {
                pattern: /(\$[A-Za-z_][\w]*)/g,
                replacer: '<span class="hljs-variable">$1</span>',
            },
            ...commonCodeRules(),
        ]);
    },
    python(source) {
        return applyRules(source, [
            {
                pattern: /\b(def|class|return|if|elif|else|for|while|try|except|finally|with|as|import|from|pass|break|continue|yield|lambda|async|await)\b/g,
                replacer: '<span class="hljs-keyword">$1</span>',
            },
            {
                pattern: /(#.*$)/gm,
                replacer: '<span class="hljs-comment">$1</span>',
            },
            ...commonCodeRules(),
        ]);
    },
    plaintext(source) {
        return escapeHtml(source);
    },
};

function resolveLanguage(language) {
    const value = String(language || "plaintext").toLowerCase();
    return registry.get(value) || highlighters[value] || highlighters.plaintext;
}

const hljs = {
    registerLanguage(name) {
        const key = String(name || "").toLowerCase();
        if (!key) {
            return;
        }
        registry.set(key, highlighters[key] || highlighters.plaintext);
    },
    highlight(source, options = {}) {
        const language = String(options.language || "plaintext").toLowerCase();
        const renderer = resolveLanguage(language);
        return {
            language,
            value: renderer(String(source || "")),
        };
    },
    highlightAuto(source) {
        const samples = ["javascript", "typescript", "json", "html", "css", "markdown", "bash", "python"];
        let best = {language: "plaintext", value: escapeHtml(source), score: 0};
        for (const language of samples) {
            const value = resolveLanguage(language)(String(source || ""));
            const score = (value.match(/hljs-/g) || []).length;
            if (score > best.score) {
                best = {language, value, score};
            }
        }
        return {
            language: best.language,
            value: best.value,
        };
    },
};

export default hljs;
