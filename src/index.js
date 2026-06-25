const APP_URL = "https://i.mjh.nz/SamsungTVPlus/.channels.json.gz";

const EPG_URL = "https://i.mjh.nz/SamsungTVPlus/{region}.xml.gz";

const PLAYBACK_URL = "https://jmp2.uk/{slug}";

const APP_CACHE_TIME = 3600; // 1小时
const EPG_CACHE_TIME = 3600; // 1小时

export default {
    async fetch(request) {
        const url = new URL(request.url);

        try {
            switch (url.pathname) {
                case "/":
                    return await statusPage(request);

                case "/playlist.m3u8":
                    return await playlist(url);

                case "/epg.xml":
                    return await epg(url);

                default:
                    return new Response("Not Found", {
                        status: 404,
                    });
            }
        } catch (err) {
            return new Response(
                `Error: ${err.stack || err.message}`, {
                    status: 500,
                    headers: {
                        "Content-Type": "text/plain",
                    },
                }
            );
        }
    },
};

async function fetchGzipJson(url) {
    const resp = await fetch(url);

    if (!resp.ok) {
        throw new Error(
            `Failed to download ${url}: ${resp.status}`
        );
    }

    const ds = new DecompressionStream("gzip");

    const stream = resp.body.pipeThrough(ds);

    const text =
        await new Response(stream).text();

    return JSON.parse(text);
}

async function fetchGzipText(url) {
    const resp = await fetch(url);

    if (!resp.ok) {
        throw new Error(
            `Failed to download ${url}: ${resp.status}`
        );
    }

    const ds = new DecompressionStream("gzip");

    const stream = resp.body.pipeThrough(ds);

    return await new Response(stream).text();
}

/**
 * 获取频道数据
 */
async function getAppData() {
    const cache = caches.default;

    const cacheKey =
        new Request(APP_URL);

    const cached =
        await cache.match(cacheKey);

    if (cached) {
        return await cached.json();
    }

    const data =
        await fetchGzipJson(APP_URL);

    const response =
        new Response(
            JSON.stringify(data), {
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": `public,max-age=${APP_CACHE_TIME}`,
                },
            }
        );

    await cache.put(
        cacheKey,
        response.clone()
    );

    return data;
}

/**
 * 生成M3U
 */
async function playlist(url) {
    const data = await getAppData();

    const regionParam =
        url.searchParams.get("regions") ||
        "all";

    const groupParam =
        url.searchParams.get("groups") || "";

    const includeParam =
        url.searchParams.get("include") || "";

    const excludeParam =
        url.searchParams.get("exclude") || "";

    const sort =
        url.searchParams.get("sort") ||
        "chno";

    let startChno =
        url.searchParams.get("start_chno");

    if (startChno !== null) {
        startChno = parseInt(startChno);
    }

    const regions = regionParam
        .split("|")
        .map((x) => x.trim().toLowerCase());

    const groups = groupParam
        .split("|")
        .filter(Boolean)
        .map((x) =>
            decodeURIComponent(x).toLowerCase()
        );

    const include = includeParam
        .split("|")
        .filter(Boolean);

    const exclude = excludeParam
        .split("|")
        .filter(Boolean);

    let channels = {};

    for (const region in data.regions) {
        if (
            regions.includes("all") ||
            regions.includes(
                region.toLowerCase()
            )
        ) {
            Object.assign(
                channels,
                data.regions[region].channels || {}
            );
        }
    }

    const channelIds =
        Object.keys(channels);

    channelIds.sort((a, b) => {
        if (sort === "name") {
            return channels[a].name
                .trim()
                .localeCompare(
                    channels[b].name.trim()
                );
        }

        return (
            (channels[a].chno || 0) -
            (channels[b].chno || 0)
        );
    });

    // 根据当前 Playlist 生成对应的 EPG URL
    let epgUrl =
        `${url.origin}/epg.xml`;

    const regionParts =
        regionParam.split("|");

    if (
        regionParts.length === 1 &&
        regionParam.toLowerCase() !== "all"
    ) {
        epgUrl +=
            `?regions=${encodeURIComponent(regionParam)}`;
    }

    let output =
        `#EXTM3U x-tvg-url="${epgUrl}"\n`;

    for (const id of channelIds) {
        const channel = channels[id];

        if (channel.license_url) {
            continue;
        }

        const channelId =
            `samsung-${id}`;

        if (
            include.length &&
            !include.includes(channelId)
        ) {
            continue;
        }

        if (
            exclude.includes(channelId)
        ) {
            continue;
        }

        const group =
            channel.group || "";

        if (
            groups.length &&
            !groups.includes(
                group.toLowerCase()
            )
        ) {
            continue;
        }

        let chnoAttr = "";

        if (startChno !== null) {
            if (startChno > 0) {
                chnoAttr =
                    ` tvg-chno="${startChno}"`;
                startChno++;
            }
        } else if (
            channel.chno !== undefined &&
            channel.chno !== null
        ) {
            chnoAttr =
                ` tvg-chno="${channel.chno}"`;
        }

        const playbackUrl =
            PLAYBACK_URL.replace(
                "{slug}",
                data.slug.replace(
                    "{id}",
                    id
                )
            );

        output +=
            `#EXTINF:-1 ` +
            `channel-id="${channelId}" ` +
            `tvg-id="${id}" ` +
            `tvg-logo="${channel.logo}" ` +
            `group-title="${group}"` +
            `${chnoAttr},${channel.name}\n` +
            `${playbackUrl}\n`;
    }

    return new Response(output, {
        headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
        },
    });
}

/**
 * EPG
 */
async function epg(url) {
    const regions =
        url.searchParams.get("regions");

    let region = "all";

    if (regions) {
        const parts =
            regions.split("|");

        if (parts.length === 1) {
            region = parts[0];
        }
    }

    const epgUrl =
        EPG_URL.replace(
            "{region}",
            region
        );

    const cache = caches.default;

    const cacheKey =
        new Request(epgUrl);

    const cached =
        await cache.match(cacheKey);

    if (cached) {
        return cached;
    }

    const xml =
        await fetchGzipText(epgUrl);

    const response =
        new Response(xml, {
            headers: {
                "Content-Type": "application/xml",
                "Cache-Control": `public,max-age=${EPG_CACHE_TIME}`,
            },
        });

    await cache.put(
        cacheKey,
        response.clone()
    );

    return response;
}

async function statusPage(request) {

    const host = new URL(request.url).host;

    const data = await getAppData();

    let cards = "";

    // All 卡片
    cards +=
        `
    <div class="region-card">
        <div class="card-summary">
            <div class="title">All</div>
        </div>

        <div class="content">
            <div class="copy-item"
                 data-copy="https://${host}/playlist.m3u8">
                Playlist URL
            </div>

            <div class="copy-item"
                 data-copy="https://${host}/epg.xml">
                EPG URL
            </div>
        </div>
    </div>
    `;

    // Region 卡片
    for (const [region, regionData] of Object.entries(data.regions)) {

        const encodedRegion =
            encodeURIComponent(region);

        const groups = new Set();

        for (const channel of Object.values(
                regionData.channels || {}
            )) {
            if (channel.group) {
                groups.add(channel.group);
            }
        }

        let groupsHtml = "";

        for (const group of [...groups].sort()) {

            const groupUrl =
                `https://${host}/playlist.m3u8?regions=${encodedRegion}&groups=${encodeURIComponent(group)}`;

            groupsHtml +=
                `
            <div class="copy-item group"
                 data-copy="${groupUrl}">
                 ${group}
            </div>
            `;
        }

        const displayName = regionData.name.replace(/ /g, '<br class="title-br"> ');

        cards +=
            `
        <div class="region-card">

            <div class="card-summary">

                <div class="title">
                    ${displayName}
                </div>

                <div class="stats-line">
                    ${groups.size} Groups  |  ${Object.keys(regionData.channels || {}).length} Channels
                </div>

            </div>

            <div class="content">

                <div class="url-row">
                    <div class="copy-item"
                         data-copy="https://${host}/playlist.m3u8?regions=${encodedRegion}">
                        Playlist URL
                    </div>

                    <div class="copy-item"
                         data-copy="https://${host}/epg.xml?regions=${encodedRegion}">
                        EPG URL
                    </div>
                </div>

                <div class="groups">
                    ${groupsHtml}
                </div>

            </div>

        </div>
        `;
    }

    const html =
        `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Samsung TV Plus</title>

<style>

*{
    margin:0;
    padding:0;
    box-sizing:border-box;
}

body{
    background:#020617;
    color:#fff;
    font-family:sans-serif;
    overflow:hidden;
}

.container{
    display:flex;
    height:100vh;
}

.region-card{

    flex:1;

    position:relative;

    display:flex;

    align-items:center;

    justify-content:center;

    transition:.4s;

    overflow:hidden;

    cursor:pointer;
}

.container:hover .region-card{
    filter:brightness(.45);
}

.container:hover .region-card:hover{
    filter:brightness(1);
}

.region-card:hover{
    flex:8;
}

.region-card:nth-child(6n+1){
background:#2563eb;
}

.region-card:nth-child(6n+2){
background:#7c3aed;
}

.region-card:nth-child(6n+3){
background:#059669;
}

.region-card:nth-child(6n+4){
background:#dc2626;
}

.region-card:nth-child(6n+5){
background:#d97706;
}

.region-card:nth-child(6n){
background:#0891b2;
}

.card-summary{
    text-align:center;
}

.region-card:hover .card-summary{

    position:absolute;

    top:25px;

    left:25px;

    text-align:left;
}

.title{
    font-size:24px;
    font-weight:bold;
}

.region-card:hover .title-br{
    display:none;
}

.stats-line{
    display:none;
    margin-top:8px;
    opacity:.8;
    font-size:13px;
}

.region-card:hover .stats-line{
    display:block;
}

.content{

    position:absolute;

    top:110px;

    left:20px;

    right:20px;

    opacity:0;

    transition:.3s;

    overflow:auto;

    max-height:80vh;
}

.region-card:hover .content{
    opacity:1;
}

.url-row{
    display:flex;
    gap:10px;
    margin-bottom:10px;
}

.url-row .copy-item{
    flex:1;
    text-align:center;
}

.copy-item{
    padding:12px;
    border-radius:12px;
    background:rgba(255,255,255,.15);
    cursor:pointer;
}

.copy-item:hover{
    background:rgba(255,255,255,.25);
}

.groups{

    display:flex;

    flex-wrap:wrap;

    gap:10px;

    margin-top:15px;
}

.group{

    border-radius:999px;

    padding:8px 14px;

    font-size:13px;

    font-weight:bold;
}

.groups .group:nth-child(8n+1){background:#ef4444;}
.groups .group:nth-child(8n+2){background:#f97316;}
.groups .group:nth-child(8n+3){background:#eab308;color:#000;}
.groups .group:nth-child(8n+4){background:#22c55e;}
.groups .group:nth-child(8n+5){background:#06b6d4;}
.groups .group:nth-child(8n+6){background:#3b82f6;}
.groups .group:nth-child(8n+7){background:#8b5cf6;}
.groups .group:nth-child(8n){background:#ec4899;}

.toast{
    position:fixed;
    top:50%;
    left:50%;
    transform:translate(-50%,-50%) scale(.8);
    background:rgba(34,197,94,.95);
    color:#fff;
    font-size:20px;
    font-weight:700;
    padding:20px 50px;
    border-radius:50px;
    opacity:0;
    pointer-events:none;
    transition:all .3s cubic-bezier(.4,0,.2,1);
    z-index:99999;
    box-shadow:0 8px 30px rgba(0,0,0,.3);
    backdrop-filter:blur(8px);
}

.toast-icon{
    width:22px;
    height:22px;
    margin-right:8px;
    vertical-align:middle;
}

.toast.show{
    opacity:1;
    transform:translate(-50%,-50%) scale(1);
}

</style>
</head>

<body>

<div class="container">
${cards}
</div>

<div id="toast" class="toast">
    <svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
    URL Copied
</div>

<script>

const toast =
    document.getElementById("toast");

function showToast(text){

    toast.textContent = text;

    toast.classList.add("show");

    setTimeout(() => {

        toast.classList.remove("show");

    }, 1500);
}

document
.querySelectorAll(".copy-item")
.forEach(item => {

    item.addEventListener("click", async () => {

        try{

            await navigator.clipboard.writeText(
                item.dataset.copy
            );

            showToast("✓ URL Copied");

        }catch(err){

            showToast("Copy Failed");
        }
    });

});

</script>

</body>
</html>
`;

    return new Response(html, {
        headers: {
            "Content-Type": "text/html; charset=utf-8"
        }
    });
}
