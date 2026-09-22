/**
 * 抓取红果真人短剧热门榜单，并将前 100 条写入 FlyHub Blocks 的 R2/D1 快照。
 * 短剧不伪造 TMDB ID，快照通过 source + seriesId 标识内容。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface HongguoSeriesItem {
	series_id?: unknown;
	series_name?: unknown;
	series_title?: unknown;
	series_cover?: unknown;
	series_intro?: unknown;
	episode_cnt?: unknown;
	id?: unknown;
	seriesId?: unknown;
	title?: unknown;
	cover?: unknown;
	description?: unknown;
	episodeVids?: unknown;
}

interface HongguoRankContent {
	isSuccess?: boolean;
	rankList?: unknown;
	pagination?: {
		pageNum?: unknown;
		totalPages?: unknown;
	};
}

interface HongguoRankPayload {
	content?: unknown;
}

interface ShortDramaSnapshotItem {
	title: string;
	tmdbId: 0;
	seriesId: string;
	source: "hongguo";
	episodeCount: number | null;
	vote_average: null;
	poster_path: string | null;
	backdrop_path: null;
	genre_ids: [];
	media_type: "tv";
	overview: string | null;
}

const BLOCK_ID = "flymby-hongguo-hot-short-drama";
const BLOCK_TITLE = "红果热门短剧";
const API_BASE_URL =
	process.env.FLYHUB_BLOCKS_API_BASE_URL ||
	"https://flyhub-blocks.yaii.workers.dev";
const OUTPUT_DIRECTORY =
	process.env.FLYHUB_BLOCKS_HONGGUO_OUTPUT_DIR ||
	"/tmp/flyhub-blocks-hongguo-hot";
const MAX_ITEMS = 100;
const MAX_RANK_PAGES = 10;
const HONGGUO_RANK_URL = "https://hongguoduanju.com/rank/hot-real-drama";
const HONGGUO_RANK_LOADER = "rank_hot-real-drama/page";

/** 只接受去除首尾空白后的字符串。 */
function textValue(value: unknown): string {
	return typeof value === "string"
		? value.trim()
		: typeof value === "number"
			? String(value)
			: "";
}

/** 读取非负整数，异常字段保持为空。 */
function integerValue(value: unknown): number | null {
	if (typeof value === "number" && Number.isInteger(value) && value >= 0)
		return value;
	if (typeof value === "string" && /^\d+$/.test(value.trim()))
		return Number.parseInt(value.trim(), 10);
	return null;
}

/** 把红果分类条目转换为不会误跳 TMDB 的短剧快照。 */
function toSnapshotItem(
	rawItem: HongguoSeriesItem,
): ShortDramaSnapshotItem | null {
	const seriesId =
		textValue(rawItem.seriesId) ||
		textValue(rawItem.series_id) ||
		textValue(rawItem.id);
	const title =
		textValue(rawItem.title) ||
		textValue(rawItem.series_name) ||
		textValue(rawItem.series_title);
	const episodeVids = Array.isArray(rawItem.episodeVids)
		? rawItem.episodeVids
		: [];
	const episodeCount =
		integerValue(rawItem.episode_cnt) ||
		(episodeVids.length > 0 ? episodeVids.length : null);
	if (!/^\d+$/.test(seriesId) || !title) return null;
	return {
		title,
		tmdbId: 0,
		seriesId,
		source: "hongguo",
		episodeCount,
		vote_average: null,
		poster_path:
			textValue(rawItem.cover) || textValue(rawItem.series_cover) || null,
		backdrop_path: null,
		genre_ids: [],
		media_type: "tv",
		overview:
			textValue(rawItem.description) || textValue(rawItem.series_intro) || null,
	};
}

/** 判断未知值是否为可安全读取的普通对象。 */
function recordValue(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/** 解析 Modern.js Loader 的完整 JSON 或 deferred data 分段响应。 */
function parseLoaderPayload(responseText: string): HongguoRankPayload {
	const trimmedText = responseText.trim();
	if (!trimmedText) throw new Error("红果热门榜单返回空响应");
	try {
		const payload = JSON.parse(trimmedText) as unknown;
		const record = recordValue(payload);
		if (record) return record as HongguoRankPayload;
	} catch {
		// 当前榜单 Loader 会在首段 JSON 后继续返回 data: 分段，交给下方逐段解析。
	}

	let rootPayload: Record<string, unknown> | null = null;
	let deferredSegmentCount = 0;
	for (const rawLine of trimmedText.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;
		if (!line.startsWith("data:")) {
			if (rootPayload !== null) continue;
			try {
				rootPayload = recordValue(JSON.parse(line) as unknown);
			} catch {
				// 非 JSON 协议行不参与业务数据解析。
			}
			continue;
		}
		const segment = recordValue(JSON.parse(line.slice(5).trim()) as unknown);
		if (!segment) continue;
		deferredSegmentCount += 1;
		if (rootPayload === null) rootPayload = {};
		for (const [key, value] of Object.entries(segment)) {
			const currentValue = rootPayload[key];
			if (
				currentValue === undefined ||
				currentValue === `__deferred_promise:${key}`
			) {
				rootPayload[key] = value;
			}
		}
	}
	if (rootPayload === null || deferredSegmentCount === 0)
		throw new Error("红果热门榜单响应无法解析");
	return rootPayload as HongguoRankPayload;
}

/** 构造红果真人短剧热门榜单指定分页的 Loader 地址。 */
function buildHongguoRankUrl(page: number): URL {
	const url = new URL(HONGGUO_RANK_URL);
	// 关键变量：红果当前会把显式 page=1 重定向到不存在的新路径，第一页必须省略页码。
	if (page > 1) url.searchParams.set("page", String(page));
	url.searchParams.set("__loader", HONGGUO_RANK_LOADER);
	url.searchParams.set("__ssrDirect", "true");
	return url;
}

/** 读取红果真人短剧热门榜单并按作品 ID 去重。 */
async function fetchHongguoHotItems(): Promise<ShortDramaSnapshotItem[]> {
	const seenIds = new Set<string>();
	const items: ShortDramaSnapshotItem[] = [];
	let page = 1;
	let totalPages = 1;
	while (
		page <= totalPages &&
		page <= MAX_RANK_PAGES &&
		items.length < MAX_ITEMS
	) {
		const response = await fetch(buildHongguoRankUrl(page), {
			headers: {
				Accept: "application/json, text/modernjs-deferred",
				"User-Agent": "FlyHubBlocks/1.0 HongguoShortDrama",
			},
		});
		if (!response.ok)
			throw new Error(
				`红果热门榜单请求失败：页码=${page} HTTP=${response.status}`,
			);
		const responseText = await response.text();
		const payload = parseLoaderPayload(responseText);
		const content = recordValue(payload.content) as HongguoRankContent | null;
		if (!content || content.isSuccess !== true)
			throw new Error(`红果热门榜单返回失败状态：页码=${page}`);
		// 关键变量：新 Rank Loader 的真实业务列表位于 deferred content.rankList。
		const rawItems = Array.isArray(content.rankList) ? content.rankList : [];
		if (rawItems.length === 0)
			throw new Error(`红果热门榜单没有可发布条目：页码=${page}`);
		for (const rawItem of rawItems) {
			if (!rawItem || typeof rawItem !== "object") continue;
			const item = toSnapshotItem(rawItem as HongguoSeriesItem);
			if (!item || seenIds.has(item.seriesId)) continue;
			seenIds.add(item.seriesId);
			items.push(item);
			if (items.length >= MAX_ITEMS) break;
		}
		const pagination = content.pagination;
		totalPages = integerValue(pagination?.totalPages) || page;
		console.info(
			`codex-hongguo-hot-block 阶段=抓取榜单分页 结果=成功 页码=${page} ` +
				`总页数=${totalPages} 响应类型=${response.headers.get("content-type") || "未知"} ` +
				`原始条目数量=${rawItems.length} 累计条目数量=${items.length}`,
		);
		page += 1;
	}
	if (items.length === 0) throw new Error("红果热门榜单没有可发布条目");
	return items;
}

/** 使用 Worker 专用发布接口原子写入 R2 快照和 D1 榜单定义。 */
async function publishSnapshot(items: ShortDramaSnapshotItem[]): Promise<void> {
	const publishToken = process.env.FLYHUB_BLOCKS_PUBLISH_TOKEN;
	if (!publishToken) {
		console.info(
			"codex-hongguo-hot-block 阶段=发布快照 结果=跳过 原因=未配置发布密钥",
		);
		return;
	}
	const response = await fetch(
		new URL("/admin/api/publish-snapshot", API_BASE_URL),
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${publishToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				blockId: BLOCK_ID,
				title: BLOCK_TITLE,
				category: "tv",
				mediaType: "tv",
				contentType: "short_drama",
				items,
			}),
		},
	);
	if (!response.ok) {
		const reason = await response.text();
		throw new Error(
			`红果热门短剧发布失败：HTTP ${response.status} ${reason.slice(0, 200)}`,
		);
	}
}

/** 生成可检查的本地快照，并在配置密钥后同步到 Cloudflare。 */
async function main(): Promise<void> {
	console.info("codex-hongguo-hot-block 阶段=抓取热门短剧 结果=开始");
	try {
		const items = await fetchHongguoHotItems();
		const now = new Date().toISOString();
		await mkdir(OUTPUT_DIRECTORY, { recursive: true });
		await writeFile(
			join(OUTPUT_DIRECTORY, `${BLOCK_ID}.json`),
			JSON.stringify({
				type: "community_block",
				count: items.length,
				lastUpdated: now,
				title: BLOCK_TITLE,
				data: items,
			}),
			"utf8",
		);
		await publishSnapshot(items);
		console.info(
			`codex-hongguo-hot-block 阶段=抓取热门短剧 结果=成功 条目数量=${items.length}`,
		);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		console.error(
			`codex-hongguo-hot-block 阶段=抓取热门短剧 结果=失败 原因=${reason}`,
		);
		throw error;
	}
}

await main();
