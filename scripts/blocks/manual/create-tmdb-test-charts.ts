/**
 * Build three small public test charts from the deployed FlyHub Blocks TMDB
 * proxy. The script only prepares R2 JSON snapshots and D1 SQL; deployment
 * remains an explicit Wrangler operation so it is safe to review first.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

type MediaType = "movie" | "tv";
type BlockCategory = "movie" | "tv" | "anime";

interface TmdbListItem {
	id: number;
	title?: string;
	name?: string;
	overview?: string;
	poster_path?: string | null;
	backdrop_path?: string | null;
	genre_ids?: number[];
	vote_average?: number | null;
	release_date?: string | null;
	first_air_date?: string | null;
}

interface TmdbListResponse {
	results?: TmdbListItem[];
}

interface SnapshotItem {
	title: string;
	tmdbId: number;
	vote_average: number | null;
	poster_path: string | null;
	backdrop_path: string | null;
	genre_ids: number[];
	media_type: MediaType;
	release_date?: string | null;
	first_air_date?: string | null;
	overview: string | null;
}

interface TestChartDefinition {
	id: string;
	title: string;
	category: BlockCategory;
	mediaType: MediaType;
	endpoint: string;
	/** 动画分类供 Flymby 将内容标识为动画。 */
	isAnime: boolean;
}

const API_BASE_URL =
	process.env.FLYHUB_BLOCKS_API_BASE_URL ||
	"https://flyhub-blocks.yaii.workers.dev";
const OUTPUT_DIRECTORY =
	process.env.FLYHUB_BLOCKS_TEST_OUTPUT_DIR || "/tmp/flyhub-blocks-test-charts";

/** 测试榜单定义：全部请求已部署 Worker，客户端可使用同一公开入口读取。 */
const TEST_CHARTS: readonly TestChartDefinition[] = [
	{
		id: "flymby-test-tmdb-popular-movies",
		title: "测试 · TMDB 热门电影",
		category: "movie",
		mediaType: "movie",
		endpoint: "/tmdb/movie/popular?language=zh-CN&page=1",
		isAnime: false,
	},
	{
		id: "flymby-test-tmdb-popular-tv",
		title: "测试 · TMDB 热门剧集",
		category: "tv",
		mediaType: "tv",
		endpoint: "/tmdb/tv/popular?language=zh-CN&page=1",
		isAnime: false,
	},
	{
		id: "flymby-test-tmdb-top-animation",
		title: "测试 · TMDB 高分动画",
		category: "anime",
		mediaType: "tv",
		endpoint:
			"/tmdb/discover/tv?language=zh-CN&page=1&with_genres=16&sort_by=vote_average.desc&vote_count.gte=500&without_genres=18",
		isAnime: true,
	},
];

/** Escape a value for the generated, single-purpose SQLite SQL file. */
function sqlText(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

/** Convert one TMDB list item into the public Block snapshot contract. */
function toSnapshotItem(item: TmdbListItem, mediaType: MediaType): SnapshotItem | null {
	const title = `${item.title || item.name || ""}`.trim();
	if (!Number.isFinite(item.id) || item.id <= 0 || title.length === 0) {
		return null;
	}
	return {
		title,
		tmdbId: item.id,
		vote_average: typeof item.vote_average === "number" ? item.vote_average : null,
		poster_path: item.poster_path || null,
		backdrop_path: item.backdrop_path || null,
		genre_ids: Array.isArray(item.genre_ids) ? item.genre_ids : [],
		media_type: mediaType,
		...(mediaType === "movie"
			? { release_date: item.release_date || null }
			: { first_air_date: item.first_air_date || null }),
		overview: item.overview || null,
	};
}

/** Fetch a source list from the deployed Worker without exposing the TMDB secret locally. */
async function fetchChartItems(definition: TestChartDefinition): Promise<SnapshotItem[]> {
	const response = await fetch(new URL(definition.endpoint, API_BASE_URL));
	if (!response.ok) {
		throw new Error(`${definition.id} 请求失败：HTTP ${response.status}`);
	}
	const payload = (await response.json()) as TmdbListResponse;
	const items = (payload.results || [])
		.map((item) => toSnapshotItem(item, definition.mediaType))
		.filter((item): item is SnapshotItem => item !== null);
	if (items.length === 0) {
		throw new Error(`${definition.id} 没有可发布的 TMDB 条目`);
	}
	return items;
}

/** Build the FlyHub importable block payload persisted in D1. */
function createBlockJson(definition: TestChartDefinition): string {
	return JSON.stringify({
		id: definition.id,
		title: definition.title,
		mediaType: definition.mediaType,
		preset: "poster-list",
		showRank: true,
		showOverview: false,
		source: {
			path: `/blocks/data/${definition.id}`,
			itemEnvelope: "data",
		},
		...(definition.isAnime ? { metadata: { isAnime: true } } : {}),
	});
}

/** Generate R2 snapshot files plus idempotent D1 registration SQL. */
async function main(): Promise<void> {
	await mkdir(OUTPUT_DIRECTORY, { recursive: true });
	const now = new Date().toISOString();
	// Cloudflare D1 --file does not accept SQL BEGIN/COMMIT statements.
	const statements: string[] = [];
	console.info("codex-flyhub-test-charts 阶段=生成测试榜单 结果=开始");

	for (const definition of TEST_CHARTS) {
		const items = await fetchChartItems(definition);
		const snapshot = {
			type: "community_block",
			count: items.length,
			lastUpdated: now,
			title: definition.title,
			data: items,
		};
		await writeFile(
			join(OUTPUT_DIRECTORY, `${definition.id}.json`),
			JSON.stringify(snapshot),
			"utf8",
		);

		const blockJson = createBlockJson(definition);
		const dataKey = `blocks/public/${definition.id}.json`;
		statements.push(
			`INSERT INTO block_snapshots (block_id, item_count, script_path, updated_at) VALUES (${sqlText(definition.id)}, ${items.length}, ${sqlText("scripts/blocks/manual/create-tmdb-test-charts.ts")}, ${sqlText(now)}) ON CONFLICT(block_id) DO UPDATE SET item_count = excluded.item_count, script_path = excluded.script_path, updated_at = excluded.updated_at;`,
		);
		statements.push(
			`INSERT INTO community_blocks (block_id, category, title, block_json, preset, data_key, item_count, installs, author, language, created_at, hidden) VALUES (${sqlText(definition.id)}, ${sqlText(definition.category)}, ${sqlText(definition.title)}, ${sqlText(blockJson)}, 'poster-list', ${sqlText(dataKey)}, ${items.length}, 0, 'Flymby', 'zh-CN', ${sqlText(now)}, 0) ON CONFLICT(block_id) DO UPDATE SET category = excluded.category, title = excluded.title, block_json = excluded.block_json, preset = excluded.preset, data_key = excluded.data_key, item_count = excluded.item_count, author = excluded.author, language = excluded.language, hidden = excluded.hidden;`,
		);
		console.info(
			`codex-flyhub-test-charts 阶段=生成测试榜单 榜单=${definition.title} 条目数=${items.length} 结果=成功`,
		);
	}

	await writeFile(
		join(OUTPUT_DIRECTORY, "register-test-charts.sql"),
		statements.join("\n"),
		"utf8",
	);
	console.info(
		`codex-flyhub-test-charts 阶段=生成注册SQL 输出目录=${OUTPUT_DIRECTORY} 结果=成功`,
	);
}

await main();
