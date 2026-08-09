/**
 * 抓取红果“最热”分类，并将前 100 条写入 FlyHub Blocks 的 R2/D1 快照。
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
}

interface HongguoCategoryPayload {
	isSuccess?: boolean;
	recommendList?: unknown;
	categoryData?: { recommendList?: unknown };
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
const HONGGUO_CATEGORY_URL =
	"https://hongguoduanju.com/category?sort_type=1&__loader=category_page&__ssrDirect=true";

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
	const seriesId = textValue(rawItem.series_id);
	const title =
		textValue(rawItem.series_name) || textValue(rawItem.series_title);
	if (!/^\d+$/.test(seriesId) || !title) return null;
	return {
		title,
		tmdbId: 0,
		seriesId,
		source: "hongguo",
		episodeCount: integerValue(rawItem.episode_cnt),
		vote_average: null,
		poster_path: textValue(rawItem.series_cover) || null,
		backdrop_path: null,
		genre_ids: [],
		media_type: "tv",
		overview: textValue(rawItem.series_intro) || null,
	};
}

/** 读取红果最热分类并按作品 ID 去重。 */
async function fetchHongguoHotItems(): Promise<ShortDramaSnapshotItem[]> {
	const response = await fetch(HONGGUO_CATEGORY_URL, {
		headers: {
			Accept: "application/json",
			"User-Agent": "FlyHubBlocks/1.0 HongguoShortDrama",
		},
	});
	if (!response.ok)
		throw new Error(`红果最热分类请求失败：HTTP ${response.status}`);
	const payload = (await response.json()) as HongguoCategoryPayload;
	if (payload.isSuccess !== true) throw new Error("红果最热分类返回失败状态");
	// 关键变量：优先使用 Loader 当前的顶层 recommendList，并兼容嵌套结构。
	const rawItems = Array.isArray(payload.recommendList)
		? payload.recommendList
		: Array.isArray(payload.categoryData?.recommendList)
			? payload.categoryData.recommendList
			: [];
	const seenIds = new Set<string>();
	const items: ShortDramaSnapshotItem[] = [];
	for (const rawItem of rawItems) {
		if (!rawItem || typeof rawItem !== "object") continue;
		const item = toSnapshotItem(rawItem as HongguoSeriesItem);
		if (!item || seenIds.has(item.seriesId)) continue;
		seenIds.add(item.seriesId);
		items.push(item);
		if (items.length >= MAX_ITEMS) break;
	}
	if (items.length === 0) throw new Error("红果最热分类没有可发布条目");
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
}

await main();
