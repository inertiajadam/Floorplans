/*
 | Fold a build's compiled stylesheet into its JS.
 |
 | Used by both the embed and the showcase builds: anything that mounts into a
 | Shadow DOM needs its CSS as a string to adopt, and shipping a separate
 | style.css costs a second request plus a flash of unstyled map while it is in
 | flight. Every chunk containing the placeholder gets the full stylesheet; the
 | standalone CSS asset is then dropped so nobody deploys a file that could
 | drift out of sync with the JS.
 |
 | The build FAILS if the placeholder is never found. That guard exists because
 | it regressed silently once — the minifier rewrote the placeholder as a
 | template literal, the regex stopped matching, and an unstyled map shipped
 | past a naive check.
 */

export function inlineStylesheet({ placeholder = '__EMBED_CSS__', version = '0.0.0' } = {}) {
    return {
        name: 'inline-stylesheet',
        apply: 'build',
        enforce: 'post',
        generateBundle(_options, bundle) {
            const cssFiles = Object.keys(bundle).filter((f) => f.endsWith('.css'));
            const css = cssFiles.map((f) => bundle[f].source ?? '').join('\n');

            /* Match every quote style: the minifier picks whichever is shortest. */
            const pattern = new RegExp(`["'\`]${placeholder}["'\`]`, 'g');

            let injected = false;
            for (const file of Object.keys(bundle)) {
                const chunk = bundle[file];
                if (chunk.type !== 'chunk' || !pattern.test(chunk.code)) continue;
                pattern.lastIndex = 0;
                chunk.code = chunk.code
                    .replace(pattern, JSON.stringify(css))
                    .replace(/__EMBED_VERSION__/g, version);
                injected = true;
            }

            if (css && !injected) {
                this.error(`Stylesheet compiled but never injected — ${placeholder} not found in any chunk.`);
            }
            if (!css) {
                this.error('No stylesheet was compiled — check the entry still imports its CSS.');
            }

            for (const f of cssFiles) delete bundle[f];
        },
    };
}
