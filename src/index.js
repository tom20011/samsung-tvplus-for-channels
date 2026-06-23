const APP_URL =
    "https://i.mjh.nz/SamsungTVPlus/.channels.json.gz";

const EPG_URL =
    "https://i.mjh.nz/SamsungTVPlus/{region}.xml.gz";

const PLAYBACK_URL =
    "https://jmp2.uk/{slug}";

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
    const host =
        new URL(request.url).host;

    const data =
        await getAppData();

    let html =
        `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Samsung TV Plus for Channels</title>
</head>
<body>

<h1>Regions & Groups</h1>

<h2>All</h2>

Playlist URL:
<b>
<a href="https://${host}/playlist.m3u8">
https://${host}/playlist.m3u8
</a>
</b>
<br>

EPG URL:
<b>
<a href="https://${host}/epg.xml">
https://${host}/epg.xml
</a>
</b>
`;

    for (const [region, regionData] of Object.entries(data.regions)) {

        const encodedRegion =
            encodeURIComponent(region);

        html +=
            `
<h2>${regionData.name}</h2>

Playlist URL:
<b>
<a href="https://${host}/playlist.m3u8?regions=${encodedRegion}">
https://${host}/playlist.m3u8?regions=${encodedRegion}
</a>
</b>
<br>

EPG URL:
<b>
<a href="https://${host}/epg.xml?regions=${encodedRegion}">
https://${host}/epg.xml?regions=${encodedRegion}
</a>
</b>

<ul>
`;

        const groups = new Set();

        for (const channel of Object.values(
                regionData.channels || {}
            )) {

            if (channel.group) {
                groups.add(channel.group);
            }
        }

        for (const group of [...groups].sort()) {

            const encodedGroup =
                encodeURIComponent(group);

            html +=
                `
<li>
<a href="https://${host}/playlist.m3u8?regions=${encodedRegion}&groups=${encodedGroup}">
${group}
</a>
</li>
`;
        }

        html += `
</ul>
`;
    }

    html += `
</body>
</html>
`;

    return new Response(html, {
        headers: {
            "Content-Type": "text/html; charset=utf-8",
        },
    });
}
