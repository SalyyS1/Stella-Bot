import { randomUUID } from 'crypto';
import { config } from '../../config';

// Drives the GitHub Actions build: dispatch, wait, fetch the jar. Nothing is
// compiled or executed on this host — that is the whole point of building
// elsewhere, so this file only ever speaks HTTP.
//
// Token handling: read from the environment at call time, sent only in the
// Authorization header, never logged and never included in a user-facing message.
// Only status codes are logged, because GitHub error bodies can echo request
// content back.

const API = 'https://api.github.com';

export type BuildFailure =
    | 'disabled'
    | 'not-configured'
    | 'payload-too-big'
    | 'dispatch-failed'
    | 'run-not-found'
    | 'timeout'
    | 'build-failed'
    | 'artifact-missing'
    | 'artifact-too-big'
    | 'download-failed';

export interface BuildSuccess {
    ok: true;
    zip: Buffer;
    runUrl: string;
}

export interface BuildError {
    ok: false;
    reason: BuildFailure;
    // Present once a run exists, so a failed build can still be traced to its log.
    runUrl?: string;
}

export type BuildResult = BuildSuccess | BuildError;

function token(): string {
    return process.env.PLUGIN_BUILD_TOKEN || '';
}

// Fail closed: with no repo or no token there is nothing to dispatch to, and the
// feature must behave as switched off rather than half-working.
export function isBuildConfigured(): boolean {
    return (
        config.pluginBuild.enabled &&
        !!config.pluginBuild.repo &&
        !!token()
    );
}

function headers(): Record<string, string> {
    return {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token()}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'stella-bot'
    };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Ask GitHub to start the workflow. Returns the correlation id embedded in the
// run's name, which is how the run is found again: workflow_dispatch does not
// return a run id.
async function dispatch(sourceB64: string): Promise<string | null> {
    const buildId = randomUUID();
    const url =
        `${API}/repos/${config.pluginBuild.repo}/actions/workflows/` +
        `${config.pluginBuild.workflowFile}/dispatches`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ref: config.pluginBuild.ref,
            inputs: {
                build_id: buildId,
                // Base64 so the source survives as one opaque input. The workflow
                // decodes it into a file and never interpolates it into a shell
                // command — see the comments in build-plugin.yml.
                source_b64: sourceB64
            }
        })
    }).catch(error => {
        console.error('[pluginBuild] dispatch network error:', error);
        return null;
    });

    if (!response) return null;
    if (response.status !== 204) {
        console.error(`[pluginBuild] dispatch rejected: HTTP ${response.status}`);
        return null;
    }
    return buildId;
}

interface RunInfo {
    id: number;
    status: string;
    conclusion: string | null;
    htmlUrl: string;
}

// Find our run by the name the workflow sets from build_id. Scanning recent runs
// is the documented way round workflow_dispatch not returning an id.
async function findRun(buildId: string): Promise<RunInfo | null> {
    const url =
        `${API}/repos/${config.pluginBuild.repo}/actions/runs` +
        `?event=workflow_dispatch&per_page=30`;
    const response = await fetch(url, { headers: headers() }).catch(() => null);
    if (!response?.ok) {
        if (response) console.error(`[pluginBuild] list runs: HTTP ${response.status}`);
        return null;
    }

    const body = await response.json().catch(() => null) as {
        workflow_runs?: Array<{
            id: number;
            name?: string;
            display_title?: string;
            status: string;
            conclusion: string | null;
            html_url: string;
        }>;
    } | null;

    const wanted = `build-${buildId}`;
    const run = body?.workflow_runs?.find(
        r => r.name === wanted || r.display_title === wanted
    );
    if (!run) return null;
    return {
        id: run.id,
        status: run.status,
        conclusion: run.conclusion,
        htmlUrl: run.html_url
    };
}

// Download the artifact zip. GitHub normally answers with a redirect to a signed
// storage URL; that redirect is followed by hand so the Authorization header is
// NOT resent to the other host, which would hand our token to a third party.
async function downloadArtifact(runId: number): Promise<Buffer | 'missing' | 'too-big' | 'failed'> {
    const listUrl = `${API}/repos/${config.pluginBuild.repo}/actions/runs/${runId}/artifacts`;
    const listResponse = await fetch(listUrl, { headers: headers() }).catch(() => null);
    if (!listResponse?.ok) {
        if (listResponse) console.error(`[pluginBuild] list artifacts: HTTP ${listResponse.status}`);
        return 'failed';
    }

    const list = await listResponse.json().catch(() => null) as {
        artifacts?: Array<{ id: number; name: string; size_in_bytes: number; expired: boolean }>;
    } | null;

    const artifact = list?.artifacts?.find(a => a.name === 'plugin-jar' && !a.expired);
    if (!artifact) return 'missing';
    if (artifact.size_in_bytes > config.pluginBuild.maxJarBytes) return 'too-big';

    const zipUrl = `${API}/repos/${config.pluginBuild.repo}/actions/artifacts/${artifact.id}/zip`;
    const redirect = await fetch(zipUrl, {
        headers: headers(),
        redirect: 'manual'
    }).catch(() => null);
    if (!redirect) return 'failed';

    // 302 to a signed storage URL is what GitHub does today, which is why
    // redirect: 'manual' is set — following it automatically would resend our
    // Authorization header to that other host. A 200 with the zip inline is also
    // accepted: it is still our own authenticated response, and refusing it would
    // throw away a finished build over a detail of GitHub's transport.
    const location = redirect.headers.get('location');
    if (!location && !redirect.ok) {
        console.error(`[pluginBuild] artifact download: no redirect (HTTP ${redirect.status})`);
        return 'failed';
    }

    // A ternary rather than a reassigned variable: `redirect` is already narrowed
    // to non-null above, so assigning a possibly-null fetch result into the same
    // binding would not typecheck under strict.
    //
    // Deliberately no headers on the signed URL: it carries its own credentials
    // and must not receive ours.
    const blob = location ? await fetch(location).catch(() => null) : redirect;

    if (!blob?.ok) {
        if (blob) console.error(`[pluginBuild] artifact blob: HTTP ${blob.status}`);
        return 'failed';
    }

    const declared = Number(blob.headers.get('content-length') || 0);
    if (declared && declared > config.pluginBuild.maxJarBytes) return 'too-big';

    const bytes = Buffer.from(await blob.arrayBuffer());
    // Re-check after reading: content-length can be absent or wrong.
    if (bytes.byteLength > config.pluginBuild.maxJarBytes) return 'too-big';
    return bytes;
}

// Dispatch, wait for completion, return the artifact zip. The zip is handed back
// as-is rather than unpacked: Discord can carry it directly, so there is no need
// to pull an unzip library in — and no zip-slip risk to guard, because nothing
// here ever extracts it.
export async function buildPluginJar(files: Record<string, string>): Promise<BuildResult> {
    if (!config.pluginBuild.enabled) return { ok: false, reason: 'disabled' };
    if (!isBuildConfigured()) return { ok: false, reason: 'not-configured' };

    const filesJson = JSON.stringify({ files });
    // Check before dispatching, because GitHub's own limit surfaces as a bare 422
    // that says nothing about size — a caller could not tell it apart from a bad
    // ref or a missing workflow.
    const sourceB64 = Buffer.from(filesJson, 'utf8').toString('base64');
    if (sourceB64.length > config.pluginBuild.maxInputChars) {
        console.error(
            `[pluginBuild] payload ${sourceB64.length} ký tự base64, vượt trần ` +
            `${config.pluginBuild.maxInputChars} của workflow_dispatch`
        );
        return { ok: false, reason: 'payload-too-big' };
    }

    const buildId = await dispatch(sourceB64);
    if (!buildId) return { ok: false, reason: 'dispatch-failed' };

    const deadline = Date.now() + config.pluginBuild.maxWaitMs;
    let run: RunInfo | null = null;

    while (Date.now() < deadline) {
        await sleep(config.pluginBuild.pollIntervalMs);
        const found = await findRun(buildId);
        // Only overwrite on a hit. A later poll can fail transiently — a rate
        // limit, a dropped connection — and letting that null through would
        // downgrade a build we had already located to 'run-not-found', throwing
        // away the log URL the member needs. Keep the last thing we knew.
        if (found) run = found;
        // A run takes a moment to appear after dispatch; keep waiting rather than
        // treating "not yet listed" as an error.
        if (run?.status === 'completed') break;
    }

    if (!run) return { ok: false, reason: 'run-not-found' };
    if (run.status !== 'completed') {
        return { ok: false, reason: 'timeout', runUrl: run.htmlUrl };
    }
    if (run.conclusion !== 'success') {
        return { ok: false, reason: 'build-failed', runUrl: run.htmlUrl };
    }

    const artifact = await downloadArtifact(run.id);
    if (artifact === 'missing') {
        return { ok: false, reason: 'artifact-missing', runUrl: run.htmlUrl };
    }
    if (artifact === 'too-big') {
        return { ok: false, reason: 'artifact-too-big', runUrl: run.htmlUrl };
    }
    if (artifact === 'failed') {
        return { ok: false, reason: 'download-failed', runUrl: run.htmlUrl };
    }

    return { ok: true, zip: artifact, runUrl: run.htmlUrl };
}

export function buildFailureMessage(reason: BuildFailure): string {
    switch (reason) {
        case 'disabled':
            return 'Tính năng build jar đang tắt — bạn vẫn nhận được mã nguồn để tự build.';
        case 'not-configured':
            return 'Build jar chưa được cấu hình (thiếu PLUGIN_BUILD_REPO hoặc PLUGIN_BUILD_TOKEN).';
        case 'payload-too-big':
            return 'Mã nguồn dài quá trần của máy build. Bạn thử tách nhỏ tính năng ra rồi hỏi lại nhé — mã nguồn ở trên vẫn tự build được.';
        case 'dispatch-failed':
            return 'Không gọi được máy build. Mã nguồn vẫn ở trên nhé.';
        case 'run-not-found':
            return 'Máy build không khởi động. Mã nguồn vẫn ở trên nhé.';
        case 'timeout':
            return 'Build lâu quá nên Stella không đợi nữa. Mã nguồn vẫn ở trên nhé.';
        case 'build-failed':
            return 'Code không compile được — chuyện thường với code AI viết. Xem log để biết lỗi, hoặc sửa tay từ mã nguồn ở trên.';
        case 'artifact-missing':
            return 'Build xong nhưng không tìm thấy file jar.';
        case 'artifact-too-big':
            return 'File jar quá lớn để gửi qua Discord.';
        default:
            return 'Không tải được file jar. Mã nguồn vẫn ở trên nhé.';
    }
}
