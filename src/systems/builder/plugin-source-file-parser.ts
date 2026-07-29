import { config } from '../../config';

// Turns the generator's markdown answer into a {path: content} map for the build
// payload. The model is asked to emit each file as a fenced block with its name on
// the line before it, so that shape is what we parse.
//
// This runs BEFORE anything is sent to GitHub, and it is where the payload's size
// and shape are pinned down. The workflow re-checks everything on its side too:
// this parser reduces junk reaching the runner, it is not the security boundary.

export interface ParsedFiles {
    files: Record<string, string>;
    // Names that were recognised but dropped, so the caller can say why a build
    // came out thinner than the source the member can see.
    //
    // Every entry here means real code went missing: a dotfile name, an empty
    // block, a size cap, or a .kt file the runner cannot compile. Build scripts do
    // NOT land here — NAME_LINE only matches source/manifest extensions, so
    // build.gradle and pom.xml are never recognised as filenames in the first
    // place. That is what lets the caller treat a non-empty skipped list as "do
    // not build this", rather than as routine noise it would have to filter.
    skipped: string[];
}

// A filename on its own line, optionally bolded or in backticks, immediately
// before a fenced block. Kept deliberately loose because the model's exact
// decoration varies between answers; the extension check below is the real gate.
//
// .kt is matched here on purpose even though ALLOWED refuses it. Matching is what
// puts the file into skipped, and a non-empty skipped list is what stops the
// build. Drop .kt from this pattern and a Kotlin file becomes invisible instead:
// skipped stays empty, the build gate opens, and the jar ships without that code.
const NAME_LINE = /^\s*[*_`#\s]*([\w./-]+\.(?:java|kt|yml|yaml))[*_`:\s]*$/i;
const FENCE = /^\s*```/;

// Only Java source and plugin metadata. Anything else is either a build script
// (which the workflow writes itself) or a mistake.
//
// Kotlin is refused because the runner has no Kotlin toolchain: the workflow
// writes its own build.gradle declaring `id 'java'` only. A .kt file would be
// copied in, silently never compiled, and Gradle would still report success — a
// jar missing code, carrying the studio's name. Refusing here turns that into a
// visible "cannot build automatically" instead. The prompt already asks for Java,
// so this only catches the model ignoring it.
const ALLOWED = /\.(java|yml|yaml)$/i;

// Never take a build script from generated text: Gradle build scripts are
// programs, so accepting one would let the AI's output run code on the runner.
// Belt-and-braces rather than the live path — NAME_LINE already refuses these
// extensions, and the workflow drops them again on its side. Kept so that
// loosening NAME_LINE later cannot quietly open the hole.
const BUILD_SCRIPTS = new Set([
    'build.gradle',
    'build.gradle.kts',
    'settings.gradle',
    'settings.gradle.kts',
    'gradle.properties',
    'gradlew',
    'gradlew.bat',
    'pom.xml'
]);

// Strip directories and any traversal. The runner rebuilds its own layout from
// flat names, so a path is never needed and `../` never has a reason to survive.
function safeName(raw: string): string | null {
    const base = raw.split(/[/\\]/).pop()?.trim();
    if (!base || base === '.' || base === '..') return null;
    if (base.startsWith('.')) return null;
    if (BUILD_SCRIPTS.has(base.toLowerCase())) return null;
    if (!ALLOWED.test(base)) return null;
    return base;
}

export function parsePluginFiles(source: string): ParsedFiles {
    const lines = source.split('\n');
    const files: Record<string, string> = {};
    const skipped: string[] = [];
    let totalBytes = 0;

    for (let i = 0; i < lines.length; i++) {
        const match = NAME_LINE.exec(lines[i]);
        if (!match) continue;

        // The name must be followed by a fence, allowing a blank line between.
        let fenceAt = i + 1;
        while (fenceAt < lines.length && !lines[fenceAt].trim()) fenceAt++;
        if (fenceAt >= lines.length || !FENCE.test(lines[fenceAt])) continue;

        // Collect to the closing fence. An unterminated block runs to the end of
        // the answer, which is the right reading of a truncated response.
        const body: string[] = [];
        let j = fenceAt + 1;
        for (; j < lines.length; j++) {
            if (FENCE.test(lines[j])) break;
            body.push(lines[j]);
        }
        i = j; // continue scanning after this block

        const raw = match[1];
        const name = safeName(raw);
        if (!name) {
            // Kotlin is now the likeliest reason a name is refused, and a bare
            // filename would leave the member guessing. The other refusals
            // (dotfiles, build scripts) are shapes the model rarely produces.
            skipped.push(/\.kt$/i.test(raw) ? `${raw} (không phải Java)` : raw);
            continue;
        }
        const content = body.join('\n').trim();
        if (!content) {
            skipped.push(raw);
            continue;
        }

        const bytes = Buffer.byteLength(content, 'utf8');
        if (bytes > config.pluginBuild.maxBytesPerFile) {
            skipped.push(`${name} (quá lớn)`);
            continue;
        }

        // A later block with the same name wins: when the model restates a file it
        // is normally correcting the earlier one. A replacement takes neither a new
        // file slot nor new budget, so both caps are measured against what the old
        // copy already holds — otherwise a corrected file counts twice and can push
        // a perfectly valid answer over the total.
        const previous = files[name];
        const previousBytes = previous ? Buffer.byteLength(previous, 'utf8') : 0;

        if (!previous && Object.keys(files).length >= config.pluginBuild.maxFiles) {
            skipped.push(`${name} (vượt số file)`);
            continue;
        }
        if (totalBytes - previousBytes + bytes > config.pluginBuild.maxTotalBytes) {
            skipped.push(`${name} (vượt tổng dung lượng)`);
            continue;
        }

        files[name] = content;
        totalBytes += bytes - previousBytes;
    }

    return { files, skipped };
}

// A Paper plugin cannot load without plugin.yml, and there is no point paying for
// a runner to discover that. Checked here so the caller can fail fast.
export function hasRequiredFiles(files: Record<string, string>): boolean {
    const names = Object.keys(files).map(n => n.toLowerCase());
    const hasManifest = names.includes('plugin.yml') || names.includes('plugin.yaml');
    // .java only: ALLOWED never lets a .kt file into files, so testing for it
    // here would be a dead branch suggesting Kotlin is supported.
    const hasCode = names.some(n => n.endsWith('.java'));
    return hasManifest && hasCode;
}
