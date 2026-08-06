/**
 * Generate the first Flymby public chart batch.
 *
 * Source lists are fetched from their public providers. TMDB matching and
 * metadata enrichment are requested through the deployed FlyHub Worker, so
 * this script never stores the TMDB credential locally. It only produces
 * reviewable R2 JSON snapshots and an idempotent D1 registration SQL file.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchDoulistItems, fetchSubjectCollectionItems } from "../lib/douban.js";
import { ENDATA_TV_TYPE, fetchEndataDayItems } from "../lib/endata.js";
import { fetchGuduoBillboardItems } from "../lib/guduo.js";
import { fetchMalRankingItems } from "../lib/mal.js";
import { fetchBangumiCalendarDay, fetchBangumiRankedAnime, fetchBangumiTodayCalendar } from "../lib/bangumi.js";
import { fetchBahamutQuarterly } from "../lib/bahamut.js";
import { fetchGuomanWeekday, GUOMAN_DAYS } from "../lib/guoman-weekdays.js";
import { fetchLetterboxdListItems } from "../lib/letterboxd.js";
import { fetchMalScheduleItems, type MalWeekday } from "../lib/mal.js";
import { fetchTraktListItems } from "../lib/trakt.js";
import { GLOBAL_STUDIOS } from "../lib/global-studios.js";
import TSPDT_ITEMS from "./tspdt-1000-data.json";

type MediaType = "movie" | "tv";
type BlockCategory = "movie" | "tv" | "anime";

interface SourceItem {
	title: string;
	altTitles?: string[];
	tmdbId?: number;
	mediaType?: MediaType;
	year?: number;
}

interface TmdbListItem {
	id: number;
	title?: string;
	name?: string;
	overview?: string | null;
	poster_path?: string | null;
	backdrop_path?: string | null;
	genre_ids?: number[];
	vote_average?: number | null;
	release_date?: string | null;
	first_air_date?: string | null;
}

interface TmdbSearchItem extends TmdbListItem {
	media_type?: string;
}

interface TmdbDetailsItem extends TmdbListItem {
	genres?: { id?: number }[];
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

interface ChartDefinition {
	id: string;
	title: string;
	category: BlockCategory;
	mediaType: MediaType;
	isAnime: boolean;
	/** TMDB 直出榜单无需二次片名匹配。 */
	tmdbEndpoint?: string;
	/** 多个 TMDB 发现条件聚合为同一个精选榜单。 */
	tmdbEndpoints?: readonly string[];
	/** 第三方榜单先读取标题，再经 Worker 搜索与详情接口补全元数据。 */
	fetchItems?: () => Promise<SourceItem[]>;
}

const API_BASE_URL =
	process.env.FLYHUB_BLOCKS_API_BASE_URL ||
	"https://flyhub-blocks.yaii.workers.dev";
const OUTPUT_DIRECTORY =
	process.env.FLYHUB_BLOCKS_BATCH_OUTPUT_DIR || "/tmp/flyhub-blocks-first-batch";
const ANIMATION_GENRE_ID = 16;
const REQUEST_DELAY_MS = 120;
const MATCH_CONCURRENCY = 8;

const GLOBAL_STUDIO_DISCOVER_ENDPOINTS = GLOBAL_STUDIOS.map((studio) =>
	`/tmdb/discover/movie?language=zh-CN&page=1&with_companies=${studio.companyId}&sort_by=primary_release_date.desc`,
);

const GLOBAL_STREAMING_DISCOVER_ENDPOINTS = [
	"/tmdb/discover/tv?language=zh-CN&page=1&with_networks=213",
	"/tmdb/discover/tv?language=zh-CN&page=1&with_networks=2739",
	"/tmdb/discover/tv?language=zh-CN&page=1&with_networks=49",
	"/tmdb/discover/tv?language=zh-CN&page=1&with_networks=2552",
	"/tmdb/discover/tv?language=zh-CN&page=1&with_networks=1024",
	"/tmdb/discover/movie?language=zh-CN&page=1&with_companies=420",
	"/tmdb/discover/movie?language=zh-CN&page=1&with_companies=174",
	"/tmdb/discover/movie?language=zh-CN&page=1&with_companies=33",
	"/tmdb/discover/movie?language=zh-CN&page=1&with_companies=5",
	"/tmdb/discover/movie?language=zh-CN&page=1&with_companies=4",
	"/tmdb/discover/movie?language=zh-CN&page=1&with_companies=41077",
] as const;

const MAL_TOP_KNOWN_IDS: Record<string, number> = {
	"Kingdom 3rd Season": 46437,
	"Mo Dao Zu Shi: Wanjie Pian": 80732,
	"Tian Guan Cifu Er": 112398,
	"Guimi Zhi Zhu: Xiaochou Pian": 232230,
	"Doupo Cangqiong: San Nian Zhi Yue": 79481,
	"Hibike! Euphonium 3": 62564,
	"Ashita no Joe 2": 25117,
};

const MAL_POPULAR_KNOWN_IDS: Record<string, number> = {
	"JoJo no Kimyou na Bouken (TV)": 45790,
	Charlotte: 63145,
};

const BANGUMI_TOP_KNOWN_IDS: Record<string, number> = {
	明日之丈2: 25117,
	"无职转生～到了异世界就拿出真本事～ 第2部分": 94664,
	"爆漫王。3": 36041,
	"JOJO的奇妙冒险 星尘斗士 埃及篇": 45790,
};

const WEEKDAY_NAMES: readonly MalWeekday[] = [
	"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];

const WEEKDAY_ANIME_KNOWN_IDS: Record<string, number> = {
	"Re：从零开始的异世界生活 第四季 丧失篇": 65942,
	"北斗神拳 -FIST OF THE NORTH STAR-": 295357,
	"Puzzle & Dragon": 80559,
	"Crayon Shin-chan": 30623,
	"Hokuto no Ken: Fist of the North Star": 295357,
	"One Piece": 37854,
	"Doraemon (2005)": 65733,
	"Sore Ike! Anpanman": 56389,
	"Bonobono (TV 2016)": 66751,
	"Chibi Maruko-chan (1995)": 57775,
	"Diamond no Ace: Act II Second Season": 60761,
	Rilakkuma: 299144,
	"Ninjala (TV)": 152271,
	"Shimajirou no Wow!": 201740,
	"Nezumi-kun no Chokki (TV)": 299962,
	"Metal Cardbot W": 223409,
	"Ichijouma Mankitsugurashi!": 295751,
};

/** 合并周更来源并按标题去重，防止同一作品在多日或多平台重复出现。 */
function mergeAnimeScheduleItems(...sources: SourceItem[][]): SourceItem[] {
	const seen = new Set<string>();
	const merged: SourceItem[] = [];
	for (const item of sources.flat()) {
		const key = item.tmdbId ? `tmdb-${item.tmdbId}` : item.title.trim().toLocaleLowerCase();
		if (!key || seen.has(key)) {
			continue;
		}
		seen.add(key);
		merged.push(item);
	}
	return merged;
}

/** 读取七天的指定动画来源，并输出后台详情页可展示的去重合集。 */
async function fetchFullWeekSchedule(
	loadDay: (weekday: number, name: MalWeekday) => Promise<SourceItem[]>,
): Promise<SourceItem[]> {
	const sources = await Promise.all(WEEKDAY_NAMES.map((name, index) => loadDay(index + 1, name)));
	return mergeAnimeScheduleItems(...sources);
}

/** 将网页里的常见 HTML 实体还原为片名文本。 */
function decodeHtmlEntities(value: string): string {
	return value
		.replace(/&#x([0-9a-fA-F]+);/g, (_all, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_all, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
		.replace(/&#0?39;|&#x27;|&#8217;/g, "'")
		.replace(/&#8211;/g, "–")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

const WEB_HEADERS = {
	"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
	Accept: "text/html",
};

/** 抓取烂番茄当前热门剧集，并移除来源标题中的季数后缀。 */
async function fetchRtPopularTvItems(): Promise<SourceItem[]> {
	const response = await fetch("https://editorial.rottentomatoes.com/guide/popular-tv-shows/", { headers: WEB_HEADERS });
	if (!response.ok) throw new Error(`烂番茄来源请求失败：HTTP ${response.status}`);
	const html = await response.text();
	const items: Array<{ rank: number; title: string }> = [];
	const pattern = /<div id="countdown-index-(\d+)"[\s\S]*?class="meta-title"[^>]*>([^<]+)<\/a>/g;
	for (const match of html.matchAll(pattern)) {
		const title = decodeHtmlEntities(match[2]).trim().replace(/:\s*(Season\s*\d+|Limited Series|Miniseries)$/i, "");
		if (title) items.push({ rank: Number.parseInt(match[1], 10), title });
	}
	if (items.length < 10) throw new Error(`烂番茄解析条目过少：${items.length}`);
	return items.sort((left, right) => left.rank - right.rank).map((item) => ({ title: item.title }));
}

/** 抓取 BFI Sight & Sound 的评论家前 100 电影。 */
async function fetchBfiSightSoundItems(): Promise<SourceItem[]> {
	const response = await fetch("https://www.bfi.org.uk/sight-and-sound/greatest-films-all-time", { headers: WEB_HEADERS });
	if (!response.ok) throw new Error(`BFI 来源请求失败：HTTP ${response.status}`);
	const films: Array<{ rank: number; title: string; year?: number }> = [];
	for (const chunk of (await response.text()).split("<article ").slice(1)) {
		if (!chunk.includes("PreviewCard__Article")) continue;
		const title = chunk.replace(/<!-- -->/g, "").match(/<h1>([^<]+)<\/h1>/);
		const rank = chunk.match(/ResultsPage__Rank[^>]*>=?(\d+)</);
		const year = chunk.match(/ResultsPage__P[^>]*>(\d{4})[^<]*</);
		if (!title || !rank) continue;
		films.push({
			rank: Number.parseInt(rank[1], 10),
			title: decodeHtmlEntities(title[1]).trim(),
			...(year ? { year: Number.parseInt(year[1], 10) } : {}),
		});
	}
	const ranked = films.filter((film) => film.rank <= 100).sort((left, right) => left.rank - right.rank);
	if (ranked.length < 50) throw new Error(`BFI 解析条目过少：${ranked.length}`);
	const knownIds: Record<string, number> = {
		"In the Mood for Love": 843, Mirror: 1396, Stalker: 1398, "Yi Yi": 25538, Daisies: 46919,
		"The Leopard": 1040, "Black Girl": 95597, "Beau travail": 14626, Parasite: 496243, "Close-Up": 30017,
	};
	return ranked.map((film) => ({ ...film, tmdbId: knownIds[film.title] }));
}

/** 从 Rolling Stone 的分页画廊中读取百大剧集。 */
async function fetchRollingStoneItems(): Promise<SourceItem[]> {
	const sourceUrl = "https://www.rollingstone.com/tv-movies/tv-movie-lists/best-tv-shows-of-all-time-1234598313/";
	const byRank = new Map<number, string>();
	let url: string | null = sourceUrl;
	while (url && byRank.size < 100) {
		const response = await fetch(url, { headers: WEB_HEADERS });
		if (!response.ok) throw new Error(`Rolling Stone 来源请求失败：HTTP ${response.status}`);
		const html = await response.text();
		const marker = html.match(/pmcGalleryExports\s*=\s*/);
		if (!marker || marker.index === undefined) throw new Error("Rolling Stone 未找到画廊数据");
		const start = marker.index + marker[0].length;
		let depth = 0;
		let inString = false;
		let json = "";
		for (let index = start; index < html.length; index += 1) {
			const char = html[index];
			if (inString) {
				if (char === "\\") index += 1;
				else if (char === '"') inString = false;
				continue;
			}
			if (char === '"') inString = true;
			if (char === "{") depth += 1;
			if (char === "}") depth -= 1;
			if (depth === 0 && char === "}") { json = html.slice(start, index + 1); break; }
		}
		if (!json) throw new Error("Rolling Stone 画廊数据不完整");
		const page = JSON.parse(json) as { gallery?: Array<{ positionDisplay?: number; title?: string }>; nextPageLink?: string | null };
		for (const item of page.gallery || []) {
			if (Number.isInteger(item.positionDisplay) && item.title) byRank.set(item.positionDisplay!, item.title);
		}
		url = page.nextPageLink || null;
	}
	if (byRank.size !== 100) throw new Error(`Rolling Stone 解析条目异常：${byRank.size}`);
	const knownIds: Record<string, number> = { "The Office (U.S.)": 2316, "The Office (U.K.)": 2996, "The Daily Show With Jon Stewart": 2224, "The Tonight Show Starring Johnny Carson": 2261, Girls: 42282, "Squid Game": 93405, SCTV: 2548 };
	return Array.from(byRank.entries()).sort((left, right) => left[0] - right[0]).map(([, rawTitle]) => {
		const sourceTitle = decodeHtmlEntities(rawTitle).trim().replace(/^[\u2018\u201C'"]/, "").replace(/[\u2019\u201D'"](?=\s*(\(|$))/, "").trim();
		return { title: sourceTitle.replace(/\s*\((U\.?S\.?|U\.?K\.?)\)$/i, "").trim(), tmdbId: knownIds[sourceTitle] };
	});
}

/** 抓取 WGA 101 最佳编剧剧集并按其原始名次顺序返回。 */
async function fetchWgaItems(): Promise<SourceItem[]> {
	const response = await fetch("https://www.wga.org/writers-room/101-best-lists/101-best-written-tv-series/list", { headers: WEB_HEADERS });
	if (!response.ok) throw new Error(`WGA 来源请求失败：HTTP ${response.status}`);
	const text = decodeHtmlEntities((await response.text()).replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "\n"));
	const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
	const items: SourceItem[] = [];
	const seen = new Set<string>();
	const knownIds: Record<string, number> = { "THE OFFICE (UK)": 2996, "THE OFFICE (U.S.)": 2316, "THE DAILY SHOW WITH JON STEWART": 2224, "SGT. BILKO (THE PHIL SILVERS SHOW)": 11747 };
	for (let index = 0; index < lines.length; index += 1) {
		if (!lines[index].startsWith("Aired:")) continue;
		for (let cursor = index - 1; cursor >= Math.max(index - 6, 0); cursor -= 1) {
			if (!/^\d+\.$/.test(lines[cursor])) continue;
			const rawTitle = lines[cursor + 1].replace(/\s*-\s*TIE$/i, "").trim();
			const title = rawTitle.replace(/\s*\((?:\d{4}|U\.?[SK]\.?)\)$/i, "").trim();
			if (!seen.has(`${lines[cursor]}-${rawTitle}`)) {
				seen.add(`${lines[cursor]}-${rawTitle}`);
				items.push({ title, tmdbId: knownIds[rawTitle] });
			}
			break;
		}
	}
	if (items.length !== 101) throw new Error(`WGA 解析条目异常：${items.length}`);
	return items;
}

/** 首批对外榜单定义，ID 与 FlymbyServer 网格入口保持一致。 */
const FIRST_BATCH_CHARTS: readonly ChartDefinition[] = [
	{
		id: "flymby-test-tmdb-popular-movies",
		title: "TMDB 热门电影",
		category: "movie",
		mediaType: "movie",
		isAnime: false,
		tmdbEndpoint: "/tmdb/movie/popular?language=zh-CN&page=1",
	},
	{
		id: "flymby-test-tmdb-popular-tv",
		title: "TMDB 热门剧集",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		tmdbEndpoint: "/tmdb/tv/popular?language=zh-CN&page=1",
	},
	{
		id: "flymby-test-tmdb-top-animation",
		title: "TMDB 高分动画",
		category: "anime",
		mediaType: "tv",
		isAnime: true,
		tmdbEndpoint:
			"/tmdb/discover/tv?language=zh-CN&page=1&with_genres=16&sort_by=vote_average.desc&vote_count.gte=500&without_genres=18",
	},
	{
		id: "community-douban-top250",
		title: "豆瓣电影 Top 250",
		category: "movie",
		mediaType: "movie",
		isAnime: false,
		fetchItems: () => fetchSubjectCollectionItems("movie_top250", 250),
	},
	{
		id: "community-douban-weekly-best-movies",
		title: "一周口碑电影榜",
		category: "movie",
		mediaType: "movie",
		isAnime: false,
		fetchItems: () => fetchSubjectCollectionItems("movie_weekly_best"),
	},
	{
		id: "community-douban-global-best-tv",
		title: "全球口碑剧集榜",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: () => fetchSubjectCollectionItems("tv_global_best_weekly"),
	},
	{
		id: "community-douban-chinese-best-tv",
		title: "华语口碑剧集榜",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: async () =>
			(await fetchSubjectCollectionItems("tv_chinese_best_weekly")).filter(
				(item) => item.title !== "COURT!",
			),
	},
	{
		id: "collection-domestic-theaters",
		title: "国内各大剧场精选",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: async () => {
			const theaterLists = await Promise.all([
				fetchDoulistItems("153511620", { types: ["tv"] }),
				fetchDoulistItems("128396349", { types: ["tv"] }),
				fetchDoulistItems("153511631", { types: ["tv"] }),
				fetchDoulistItems("155026800", { types: ["tv"] }),
				fetchDoulistItems("159320021", { types: ["tv"] }),
				fetchDoulistItems("159054707", { types: ["tv"] }),
			]);
			return mergeAnimeScheduleItems(...theaterLists);
		},
	},
	{
		id: "collection-global-movie-studios",
		title: "全球电影厂牌",
		category: "movie",
		mediaType: "movie",
		isAnime: false,
		tmdbEndpoints: GLOBAL_STUDIO_DISCOVER_ENDPOINTS,
	},
	{
		id: "collection-global-streaming-platforms",
		title: "全球流媒体平台",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		tmdbEndpoints: GLOBAL_STREAMING_DISCOVER_ENDPOINTS,
	},
	{
		id: "community-douban-hot-domestic-tv",
		title: "近期热门国产剧",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: async () =>
			(await fetchSubjectCollectionItems("tv_domestic")).filter(
				(item) => item.title !== "COURT!",
			),
	},
	{
		id: "community-douban-hot-korean-tv",
		title: "近期热门韩剧",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: async () =>
			(await fetchSubjectCollectionItems("tv_korean")).filter(
				(item) => item.title !== "逆转",
			),
	},
	{
		id: "community-douban-hot-american-tv",
		title: "近期热门美剧",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: async () => {
			const knownIds: Record<string, number> = {
				"海贼王(真人版) 第二季": 111110,
				"犯罪心理：演变 第十九季": 4057,
				"四季情 第二季": 243316,
			};
			return (await fetchSubjectCollectionItems("tv_american")).map((item) => ({
				...item,
				tmdbId: knownIds[item.title],
			}));
		},
	},
	{
		id: "community-douban-hot-animation",
		title: "近期热门动画",
		category: "anime",
		mediaType: "tv",
		isAnime: true,
		fetchItems: () => fetchSubjectCollectionItems("tv_animation"),
	},
	{
		id: "community-douban-hot-hong-kong-tv",
		title: "近期热门港剧",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: () => fetchDoulistItems("36864746", { types: ["tv"] }),
	},
	{
		id: "community-douban-hot-taiwan-tv",
		title: "近期热门台剧",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: () => fetchDoulistItems("156433013", { types: ["tv"] }),
	},
	{
		id: "community-douban-hot-thai-tv",
		title: "近期热门泰剧",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: () => fetchDoulistItems("116204055", { types: ["tv"] }),
	},
	{
		id: "community-endata-hot-movie",
		title: "今日电影实时数据",
		category: "movie",
		mediaType: "movie",
		isAnime: false,
		fetchItems: async () => {
			const knownIds: Record<string, number> = { 七三一: 1321624, 重生: 1301470 };
			return (await fetchEndataDayItems(ENDATA_TV_TYPE.movie, { limit: 30 }))
				.filter((item) => item.title !== "机械军团")
				.map((item) => ({ ...item, tmdbId: knownIds[item.title] }));
		},
	},
	{
		id: "community-endata-hot-tv",
		title: "今日剧集热度榜",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: async () => {
			const knownIds: Record<string, number> = {
				问心2: 233076, 动物: 214162, 都市传说: 322353, 卧底: 110576,
				女王驾到: 235728, "格蕾西·达琳迷案第一季": 271823,
				曼达洛人第一季: 82856, "曼达洛人第三季（The Mandalorian Season 3）": 82856,
			};
			return (await fetchEndataDayItems(ENDATA_TV_TYPE.tv, { limit: 30 })).map((item) => ({ ...item, tmdbId: knownIds[item.title] }));
		},
	},
	{
		id: "community-endata-hot-anime",
		title: "今日动漫实时数据",
		category: "anime",
		mediaType: "tv",
		isAnime: true,
		fetchItems: async () => {
			const knownIds: Record<string, number> = {
				沧元图: 229192, 剑来第2季: 259537, 剑来: 259537, "鬼灭之刃 柱训练篇": 85937,
				"鬼灭之刃 刀匠村篇": 85937, 鬼灭之刃: 85937, 光阴之外: 281233,
				师兄啊师兄: 218642, 凡人修仙传: 106449, 海贼王: 37854,
			};
			return (await fetchEndataDayItems(ENDATA_TV_TYPE.anime, { limit: 30 })).map((item) => ({ ...item, tmdbId: knownIds[item.title] }));
		},
	},
	{
		id: "community-guduo-network-drama",
		title: "国产网剧热度榜",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: () => fetchGuduoBillboardItems("NETWORK_DRAMA"),
	},
	{
		id: "community-iqiyi-hot-tv",
		title: "爱奇艺风云榜热播",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: fetchIqiyiHotTv,
	},
	{
		id: "community-douban-hot-japanese-tv",
		title: "近期热门日剧",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: () => fetchSubjectCollectionItems("tv_japanese"),
	},
	{
		id: "community-douban-hot-variety-shows",
		title: "近期热门综艺节目",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: () => fetchSubjectCollectionItems("tv_variety_show"),
	},
	{
		id: "community-douban-chinese-best-variety",
		title: "国内口碑综艺榜",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: () => fetchSubjectCollectionItems("show_chinese_best_weekly"),
	},
	{
		id: "community-douban-global-best-variety",
		title: "国外口碑综艺榜",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: () => fetchSubjectCollectionItems("show_global_best_weekly"),
	},
	{
		id: "community-anilist-trending",
		title: "AniList 动画趋势榜",
		category: "anime",
		mediaType: "tv",
		isAnime: true,
		fetchItems: fetchAniListTrendingItems,
	},
	{
		id: "community-bangumi-calendar",
		title: "Bangumi 今日放送",
		category: "anime",
		mediaType: "tv",
		isAnime: true,
		fetchItems: () => fetchBangumiTodayCalendar({ "Re：从零开始的异世界生活 第四季 丧失篇": 65942 }),
	},
	{
		id: "community-justwatch-streaming-charts",
		title: "JustWatch 流媒体榜",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: fetchJustWatchStreamingItems,
	},
	{
		id: "community-mal-top-anime",
		title: "MyAnimeList 总榜",
		category: "anime",
		mediaType: "tv",
		isAnime: true,
		fetchItems: () => fetchMalRankingItems({ knownIds: MAL_TOP_KNOWN_IDS }),
	},
	{
		id: "community-mal-most-popular",
		title: "MyAnimeList 最流行",
		category: "anime",
		mediaType: "tv",
		isAnime: true,
		fetchItems: () => fetchMalRankingItems({ type: "bypopularity", knownIds: MAL_POPULAR_KNOWN_IDS }),
	},
	{
		id: "community-bangumi-top-anime",
		title: "Bangumi 动画排行榜",
		category: "anime",
		mediaType: "tv",
		isAnime: true,
		// 首批详情页只展示前 50 条，避免首次抓取时间过长。
		fetchItems: () => fetchBangumiRankedAnime(50, BANGUMI_TOP_KNOWN_IDS),
	},
	{
		id: "community-anichart-seasonal",
		title: "季度新番",
		category: "anime",
		mediaType: "tv",
		isAnime: true,
		fetchItems: fetchAniListSeasonalItems,
	},
	{
		id: "community-douban-popular-anime-doulist",
		title: "豆瓣人气动画",
		category: "anime",
		mediaType: "tv",
		isAnime: true,
		fetchItems: () => fetchDoulistItems("42142125", { types: ["tv"], max: 300 }),
	},
	{
		id: "community-douban-top-animation-movies",
		title: "高分动画长片",
		category: "anime",
		mediaType: "movie",
		isAnime: true,
		fetchItems: () => fetchDoulistItems("223781"),
	},
	{
		id: "community-douban-healing-anime",
		title: "治愈动画",
		category: "anime",
		mediaType: "tv",
		isAnime: true,
		fetchItems: async () => {
			const sourceLists = await Promise.all([
				fetchDoulistItems("855500", { types: ["movie", "tv"], max: 150 }),
				fetchDoulistItems("1950208", { types: ["movie", "tv"], max: 150 }),
			]);
			return sourceLists.flat();
		},
	},
	{
		id: "community-douban-cn-animation-movies",
		title: "国产动画电影",
		category: "anime",
		mediaType: "movie",
		isAnime: true,
		fetchItems: async () => {
			const knownIds: Record<string, number> = { 魁拔Ⅲ战神崛起: 313302 };
			return (await fetchDoulistItems("149670450")).map((item) => ({
				...item,
				tmdbId: knownIds[item.title],
			}));
		},
	},
	{
		id: "community-imdb-top250-movies",
		title: "IMDb 电影 Top 250",
		category: "movie",
		mediaType: "movie",
		isAnime: false,
		fetchItems: () => fetchTraktListItems("justin", "imdb-top-rated-movies", "movies"),
	},
	{
		id: "community-imdb-popular-movies",
		title: "IMDb 热门电影",
		category: "movie",
		mediaType: "movie",
		isAnime: false,
		fetchItems: () => fetchTraktListItems("justin", "imdb-popular-movies", "movies"),
	},
	{
		id: "community-imdb-popular-tv",
		title: "IMDb 热门剧集",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: () => fetchTraktListItems("justin", "imdb-popular-tv-shows", "shows"),
	},
	{
		id: "community-letterboxd-oscar-best-picture",
		title: "奥斯卡最佳影片",
		category: "movie",
		mediaType: "movie",
		isAnime: false,
		fetchItems: async () => {
			const knownIds: Record<string, number> = { Parasite: 496243 };
			return (await fetchLetterboxdListItems("https://letterboxd.com/oscars/list/oscar-winning-films-best-picture/", 1))
				.map((item) => ({ ...item, tmdbId: knownIds[item.title] }));
		},
	},
	{
		id: "community-letterboxd-palme-dor",
		title: "戛纳金棕榈",
		category: "movie",
		mediaType: "movie",
		isAnime: false,
		fetchItems: async () => {
			const knownIds: Record<string, number> = {
				"It Was Just an Accident": 1456349, Parasite: 496243, Shoplifters: 505192,
				"The Class": 8841, "The Child": 11490, "The Eel": 20506, Underground: 11902,
				"Pelle the Conqueror": 11174, "The Road": 52556, "A Man and a Woman": 42726,
				"The Leopard": 1040, "The Damned": 87245,
			};
			return (await fetchLetterboxdListItems("https://letterboxd.com/festival_cannes/list/70-years-of-the-palme-dor-70-ans-de-la-palme/", 1))
				.map((item) => ({ ...item, tmdbId: knownIds[item.title] }));
		},
	},
	{
		id: "community-letterboxd-top100-docuseries",
		title: "纪录剧集 Top100",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: async () => {
			const knownItems: Record<string, Pick<SourceItem, "tmdbId" | "mediaType">> = {
				Life: { tmdbId: 16946 }, "The Hunt": { tmdbId: 64313 },
				"Queen: Days of Our Lives": { tmdbId: 74406, mediaType: "movie" },
				"28 Up": { tmdbId: 20561, mediaType: "movie" }, "The West": { tmdbId: 30715 },
				"42 Up": { tmdbId: 20565, mediaType: "movie" }, "49 Up": { tmdbId: 13365, mediaType: "movie" },
				"99": { tmdbId: 251559 },
			};
			return (await fetchLetterboxdListItems("https://letterboxd.com/official/list/top-100-documentary-miniseries/", 1))
				.map((item) => ({ ...item, ...knownItems[item.title] }));
		},
	},
	{
		id: "collection-mal-weekdays",
		title: "MyAnimeList 周更表",
		category: "anime",
		mediaType: "tv",
		isAnime: true,
		fetchItems: () => fetchFullWeekSchedule((_weekday, day) =>
			fetchMalScheduleItems(day, { knownIds: WEEKDAY_ANIME_KNOWN_IDS }),
		),
	},
	{
		id: "collection-bahamut-weekdays",
		title: "新番周更表",
		category: "anime",
		mediaType: "tv",
		isAnime: true,
		fetchItems: () => fetchFullWeekSchedule((weekday) => fetchBahamutQuarterly(weekday)),
	},
	{
		id: "collection-guoman-weekdays",
		title: "国漫周更表",
		category: "anime",
		mediaType: "tv",
		isAnime: true,
		fetchItems: () => fetchFullWeekSchedule((weekday) =>
			fetchGuomanWeekday(GUOMAN_DAYS[weekday - 1].file),
		),
	},
	{
		id: "collection-anime-calendar",
		title: "追番日历",
		category: "anime",
		mediaType: "tv",
		isAnime: true,
		fetchItems: () => fetchFullWeekSchedule(async (weekday, day) => {
			const [bangumi, mal, bahamut] = await Promise.all([
				fetchBangumiCalendarDay(weekday, WEEKDAY_ANIME_KNOWN_IDS),
				fetchMalScheduleItems(day, { knownIds: WEEKDAY_ANIME_KNOWN_IDS }),
				fetchBahamutQuarterly(weekday),
			]);
			return mergeAnimeScheduleItems(bangumi, mal, bahamut);
		}),
	},
	{
		id: "collection-mal-rankings",
		title: "MyAnimeList 合集",
		category: "anime",
		mediaType: "tv",
		isAnime: true,
		fetchItems: async () => {
			const [top, popular, upcoming] = await Promise.all([
				fetchMalRankingItems({ knownIds: MAL_TOP_KNOWN_IDS }),
				fetchMalRankingItems({ type: "bypopularity", knownIds: MAL_POPULAR_KNOWN_IDS }),
				fetchMalRankingItems({ type: "upcoming" }),
			]);
			return mergeAnimeScheduleItems(top, popular, upcoming);
		},
	},
	{
		id: "community-tspdt-1000",
		title: "TSPDT 1000 佳片",
		category: "movie",
		mediaType: "movie",
		isAnime: false,
		fetchItems: async () => TSPDT_ITEMS as SourceItem[],
	},
	{
		id: "community-rt-popular-tv",
		title: "烂番茄当前热门剧集",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: fetchRtPopularTvItems,
	},
	{
		id: "community-bfi-sight-sound-100",
		title: "BFI Sight & Sound 100",
		category: "movie",
		mediaType: "movie",
		isAnime: false,
		fetchItems: fetchBfiSightSoundItems,
	},
	{
		id: "community-rolling-stone-100-tv",
		title: "Rolling Stone 100 佳剧",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: fetchRollingStoneItems,
	},
	{
		id: "community-wga-101-best-written-tv",
		title: "WGA 101 最佳编剧剧集",
		category: "tv",
		mediaType: "tv",
		isAnime: false,
		fetchItems: fetchWgaItems,
	},
];

/** 等待短暂间隔，避免密集请求上游 TMDB 代理。 */
function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * 请求公开 Worker 时出现瞬时 TLS 断连可安全重试；快照生成始终以最终响应为准。
 */
async function fetchWorkerWithRetry(url: URL, requestName: string): Promise<Response> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			return await fetch(url);
		} catch (error) {
			lastError = error;
			console.warn(`codex-flyhub-first-batch 阶段=Worker重试 请求=${requestName} 次数=${attempt}`);
			await delay(250 * attempt);
		}
	}
	throw lastError instanceof Error ? lastError : new Error(`${requestName} 请求失败`);
}

/** 为生成的 SQLite SQL 文本进行单引号转义。 */
function sqlText(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

/** 将源数据转为公开快照的统一媒体结构。 */
function toSnapshotItem(item: TmdbDetailsItem, mediaType: MediaType): SnapshotItem | null {
	const title = `${item.title || item.name || ""}`.trim();
	if (!Number.isFinite(item.id) || item.id <= 0 || title.length === 0) {
		return null;
	}
	const genres = Array.isArray(item.genre_ids)
		? item.genre_ids
		: (item.genres || []).map((genre) => genre.id).filter((id): id is number => Number.isFinite(id));
	return {
		title,
		tmdbId: item.id,
		vote_average: typeof item.vote_average === "number" ? item.vote_average : null,
		poster_path: item.poster_path || null,
		backdrop_path: item.backdrop_path || null,
		genre_ids: genres,
		media_type: mediaType,
		...(mediaType === "movie"
			? { release_date: item.release_date || null }
			: { first_air_date: item.first_air_date || null }),
		overview: item.overview || null,
	};
}

/** 获取当前上海时区对应的 AniList 季度。 */
function getCurrentSeason(): { season: string; seasonYear: number } {
	const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
	const seasons = ["WINTER", "SPRING", "SUMMER", "FALL"] as const;
	return { season: seasons[Math.floor(now.getMonth() / 3)], seasonYear: now.getFullYear() };
}

/** 读取 AniList 当季人气动画，保留日文与罗马音作为 TMDB 匹配备选。 */
async function fetchAniListSeasonalItems(): Promise<SourceItem[]> {
	const { season, seasonYear } = getCurrentSeason();
	const response = await fetch("https://graphql.anilist.co", {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({
			query: "query($season:MediaSeason!,$seasonYear:Int!){Page(page:1,perPage:50){media(season:$season,seasonYear:$seasonYear,type:ANIME,sort:POPULARITY_DESC,format_in:[TV,TV_SHORT,ONA]){title{native romaji}}}}",
			variables: { season, seasonYear },
		}),
	});
	if (!response.ok) {
		throw new Error(`AniList 请求失败：HTTP ${response.status}`);
	}
	const payload = await response.json() as { data?: { Page?: { media?: { title?: { native?: string; romaji?: string } }[] } } };
	return (payload.data?.Page?.media || []).flatMap((media) => {
		const title = media.title?.native || media.title?.romaji;
		if (!title) {
			return [];
		}
		return [{ title, altTitles: media.title?.romaji && media.title.romaji !== title ? [media.title.romaji] : [] }];
	});
}

/** 读取 AniList 实时趋势动画，仅保留连续剧形态。 */
async function fetchAniListTrendingItems(): Promise<SourceItem[]> {
	const response = await fetch("https://graphql.anilist.co", {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({
			query: "query{Page(page:1,perPage:100){media(sort:TRENDING_DESC,type:ANIME){format title{native romaji}}}}",
		}),
	});
	if (!response.ok) {
		throw new Error(`AniList 趋势榜请求失败：HTTP ${response.status}`);
	}
	const payload = await response.json() as { data?: { Page?: { media?: { format?: string; title?: { native?: string; romaji?: string } }[] } } };
	const seriesFormats = new Set(["TV", "TV_SHORT", "ONA"]);
	return (payload.data?.Page?.media || []).flatMap((media) => {
		if (!seriesFormats.has(media.format || "")) {
			return [];
		}
		const title = media.title?.native || media.title?.romaji;
		return title ? [{ title, altTitles: media.title?.romaji && media.title.romaji !== title ? [media.title.romaji] : [] }] : [];
	}).slice(0, 50);
}

/** 读取爱奇艺电视剧热播榜，并保留片名年份用于 TMDB 匹配。 */
async function fetchIqiyiHotTv(): Promise<SourceItem[]> {
	const apiBase = "https://pcw-api.iqiyi.com/strategy/pcw/data/topRanksData";
	const knownIds: Record<string, number> = {
		灵魂摆渡: 75480, 灵魂摆渡2: 75480, 灵魂摆渡3: 75480,
		唐朝诡事录之长安: 211089, 深渊: 321036, 老舅: 277052, 樊笼: 316780,
	};
	const items: SourceItem[] = [];
	// 首次公开快照保留前 50 条，足以覆盖后台详情展示并避免单次发布耗时过长。
	for (let page = 1; page <= 2; page += 1) {
		const url = `${apiBase}?page_st=0&tag=0&category_id=2&date=&pg_num=${page}`;
		const response = await fetch(url, {
			headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36", Referer: "https://www.iqiyi.com/", Accept: "application/json" },
		});
		if (!response.ok) {
			throw new Error(`爱奇艺热播榜请求失败：HTTP ${response.status}`);
		}
		const payload = await response.json() as { data?: { formatData?: { data?: { content?: { title?: string; tags?: string }[] } } } };
		for (const entry of payload.data?.formatData?.data?.content || []) {
			if (!entry.title) {
				continue;
			}
			const year = Number.parseInt((entry.tags || "").slice(0, 4), 10);
			items.push({ title: entry.title, tmdbId: knownIds[entry.title], ...(Number.isFinite(year) ? { year } : {}) });
		}
		await delay(500);
	}
	return items;
}

/** 读取 JustWatch 美国区剧集趋势榜。 */
async function fetchJustWatchStreamingItems(): Promise<SourceItem[]> {
	const response = await fetch("https://apis.justwatch.com/graphql", {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({
			query: "query($country:Country!,$first:Int!){popularTitles(country:$country,first:$first,sortBy:TRENDING,filter:{objectTypes:[SHOW]}){edges{node{... on MovieOrShow{content(country:$country,language:\"en\"){title originalReleaseYear}}}}}}",
			variables: { country: "US", first: 50 },
		}),
	});
	if (!response.ok) {
		throw new Error(`JustWatch 榜单请求失败：HTTP ${response.status}`);
	}
	const payload = await response.json() as { data?: { popularTitles?: { edges?: { node?: { content?: { title?: string; originalReleaseYear?: number } } }[] } } };
	return (payload.data?.popularTitles?.edges || []).flatMap((edge) => {
		const content = edge.node?.content;
		return content?.title ? [{ title: content.title, year: content.originalReleaseYear }] : [];
	});
}

/** 通过 Worker 搜索指定媒体类型，必要时使用备选标题。 */
async function searchTmdbId(item: SourceItem, mediaType: MediaType, isAnime: boolean): Promise<number | null> {
	if (item.tmdbId) {
		return item.tmdbId;
	}
	const queries = [item.title, ...(item.altTitles || [])];
	for (const query of queries) {
		const url = new URL("/tmdb/search/keyword", API_BASE_URL);
		url.searchParams.set("query", query);
		url.searchParams.set("language", "zh-CN");
		const response = await fetchWorkerWithRetry(url, "TMDB搜索");
		if (!response.ok) {
			continue;
		}
		const results = await response.json() as TmdbSearchItem[];
		const candidates = results.filter((result) => result.media_type === mediaType);
		const matched = candidates.find((result) => {
			if (isAnime && mediaType === "tv") {
				return Array.isArray(result.genre_ids) && result.genre_ids.includes(ANIMATION_GENRE_ID);
			}
			if (mediaType === "movie" && item.year) {
				const year = Number.parseInt((result.release_date || "").slice(0, 4), 10);
				return Number.isFinite(year) && Math.abs(year - item.year) <= 1;
			}
			return true;
		});
		if (matched?.id) {
			return matched.id;
		}
	}
	return null;
}

/** 从 Worker 获取 TMDB 详情，用于生成包含海报、简介和评分的快照条目。 */
async function fetchTmdbDetails(tmdbId: number, mediaType: MediaType): Promise<TmdbDetailsItem | null> {
	const url = new URL(`/tmdb/${mediaType}/details`, API_BASE_URL);
	url.searchParams.set("id", String(tmdbId));
	url.searchParams.set("language", "zh-CN");
	const response = await fetchWorkerWithRetry(url, "TMDB详情");
	if (!response.ok) {
		return null;
	}
	return await response.json() as TmdbDetailsItem;
}

/** 将单个第三方标题解析为完整 TMDB 条目。 */
async function resolveSourceItem(
	definition: ChartDefinition,
	sourceItem: SourceItem,
): Promise<SnapshotItem | null> {
	const mediaType = sourceItem.mediaType || definition.mediaType;
	const tmdbId = await searchTmdbId(sourceItem, mediaType, definition.isAnime);
	if (!tmdbId) {
		return null;
	}
	const details = await fetchTmdbDetails(tmdbId, mediaType);
	await delay(REQUEST_DELAY_MS);
	return details ? toSnapshotItem(details, mediaType) : null;
}

/** 按榜单顺序解析第三方标题为完整 TMDB 条目，并以有限并发避免生成过慢。 */
async function resolveSourceItems(definition: ChartDefinition, sourceItems: SourceItem[]): Promise<SnapshotItem[]> {
	const results: Array<SnapshotItem | null> = new Array(sourceItems.length).fill(null);
	let nextIndex = 0;
	/** 一个工作协程负责按序领取并解析待处理标题。 */
	async function resolveWorker(): Promise<void> {
		while (nextIndex < sourceItems.length) {
			const currentIndex = nextIndex;
			nextIndex += 1;
			results[currentIndex] = await resolveSourceItem(definition, sourceItems[currentIndex]);
		}
	}
	await Promise.all(Array.from({ length: Math.min(MATCH_CONCURRENCY, sourceItems.length) }, () => resolveWorker()));

	const result: SnapshotItem[] = [];
	const usedIds = new Set<number>();
	for (const snapshotItem of results) {
		if (!snapshotItem || usedIds.has(snapshotItem.tmdbId)) {
			continue;
		}
		usedIds.add(snapshotItem.tmdbId);
		result.push(snapshotItem);
	}
	return result;
}

/** 读取 TMDB 直出榜单并转换为公开快照条目。 */
async function fetchTmdbChart(definition: ChartDefinition): Promise<SnapshotItem[]> {
	const response = await fetch(new URL(definition.tmdbEndpoint || "", API_BASE_URL));
	if (!response.ok) {
		throw new Error(`${definition.title} 请求失败：HTTP ${response.status}`);
	}
	const payload = await response.json() as TmdbListResponse;
	return (payload.results || [])
		.map((item) => toSnapshotItem(item, definition.mediaType))
		.filter((item): item is SnapshotItem => item !== null);
}

/** 合并多个 TMDB 发现条件，按 TMDB ID 去重并保持来源顺序。 */
async function fetchMultiTmdbChart(definition: ChartDefinition): Promise<SnapshotItem[]> {
	const unique = new Map<number, SnapshotItem>();
	for (const endpoint of definition.tmdbEndpoints || []) {
		const response = await fetch(new URL(endpoint, API_BASE_URL));
		if (!response.ok) {
			throw new Error(`${definition.title} 请求失败：HTTP ${response.status}`);
		}
		const payload = await response.json() as TmdbListResponse;
		for (const item of payload.results || []) {
			const snapshotItem = toSnapshotItem(item, definition.mediaType);
			if (snapshotItem && !unique.has(snapshotItem.tmdbId)) {
				unique.set(snapshotItem.tmdbId, snapshotItem);
			}
		}
	}
	return [...unique.values()];
}

/** 构造保存在 D1 的榜单定义，供 /blocks/import-payload 读取。 */
function createBlockJson(definition: ChartDefinition): string {
	return JSON.stringify({
		id: definition.id,
		title: definition.title,
		mediaType: definition.mediaType,
		preset: "poster-list",
		showRank: true,
		showOverview: false,
		source: { path: `/blocks/data/${definition.id}`, itemEnvelope: "data" },
		...(definition.isAnime ? { metadata: { isAnime: true } } : {}),
	});
}

/** 将已验证快照提交给 Worker，由其绑定的 R2 与 D1 完成原子发布。 */
async function publishSnapshot(
	definition: ChartDefinition,
	items: SnapshotItem[],
): Promise<void> {
	const publishToken = process.env.FLYHUB_BLOCKS_PUBLISH_TOKEN;
	if (!publishToken) {
		return;
	}
	const response = await fetch(new URL("/admin/api/publish-snapshot", API_BASE_URL), {
		method: "POST",
		headers: {
			Authorization: `Bearer ${publishToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			blockId: definition.id,
			title: definition.title,
			category: definition.category,
			mediaType: definition.mediaType,
			isAnime: definition.isAnime,
			items,
		}),
	});
	if (!response.ok) {
		throw new Error(`${definition.title} 发布失败：HTTP ${response.status}`);
	}
}

/** 生成首批全部 R2 快照文件及可重复执行的 D1 注册 SQL。 */
async function main(): Promise<void> {
	await mkdir(OUTPUT_DIRECTORY, { recursive: true });
	const now = new Date().toISOString();
	const statements: string[] = [];
	const requestedIds = (process.env.FLYHUB_BLOCKS_BATCH_IDS || "")
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
	const charts = requestedIds.length > 0
		? FIRST_BATCH_CHARTS.filter((chart) => requestedIds.includes(chart.id))
		: FIRST_BATCH_CHARTS;
	if (charts.length === 0) {
		throw new Error("未匹配到需要生成的首批榜单 ID。");
	}
	console.info(`codex-flyhub-first-batch 阶段=生成开始 榜单数=${charts.length}`);
	const failedCharts: string[] = [];

	for (const definition of charts) {
		try {
			let items: SnapshotItem[];
			if (definition.tmdbEndpoint) {
				items = await fetchTmdbChart(definition);
			} else if (definition.tmdbEndpoints) {
				items = await fetchMultiTmdbChart(definition);
			} else {
				console.info(`codex-flyhub-first-batch 阶段=读取来源 榜单=${definition.title}`);
				const sourceItems = await definition.fetchItems!();
				console.info(`codex-flyhub-first-batch 阶段=匹配TMDB 榜单=${definition.title} 来源条目数=${sourceItems.length}`);
				items = await resolveSourceItems(definition, sourceItems);
			}
			if (items.length === 0) {
				throw new Error(`${definition.title} 没有可发布条目。`);
			}
			const snapshot = { type: "community_block", count: items.length, lastUpdated: now, title: definition.title, data: items };
			await writeFile(join(OUTPUT_DIRECTORY, `${definition.id}.json`), JSON.stringify(snapshot), "utf8");
			await publishSnapshot(definition, items);

			const dataKey = `blocks/public/${definition.id}.json`;
			const blockJson = createBlockJson(definition);
			statements.push(`INSERT INTO block_snapshots (block_id, item_count, script_path, updated_at) VALUES (${sqlText(definition.id)}, ${items.length}, ${sqlText("scripts/blocks/manual/create-flymby-first-batch-charts.ts")}, ${sqlText(now)}) ON CONFLICT(block_id) DO UPDATE SET item_count = excluded.item_count, script_path = excluded.script_path, updated_at = excluded.updated_at;`);
			statements.push(`INSERT INTO community_blocks (block_id, category, title, block_json, preset, data_key, item_count, installs, author, language, created_at, hidden) VALUES (${sqlText(definition.id)}, ${sqlText(definition.category)}, ${sqlText(definition.title)}, ${sqlText(blockJson)}, 'poster-list', ${sqlText(dataKey)}, ${items.length}, 0, 'Flymby', 'zh-CN', ${sqlText(now)}, 0) ON CONFLICT(block_id) DO UPDATE SET category = excluded.category, title = excluded.title, block_json = excluded.block_json, preset = excluded.preset, data_key = excluded.data_key, item_count = excluded.item_count, author = excluded.author, language = excluded.language, hidden = excluded.hidden;`);
			await writeFile(join(OUTPUT_DIRECTORY, `register-${definition.id}.sql`), statements.slice(-2).join("\n"), "utf8");
			console.info(`codex-flyhub-first-batch 阶段=生成完成 榜单=${definition.title} 条目数=${items.length}`);
		} catch (error) {
			failedCharts.push(definition.id);
			const reason = error instanceof Error ? error.message : String(error);
			console.error(`codex-flyhub-first-batch 阶段=生成失败 榜单=${definition.title} 原因=${reason}`);
		}
	}

	await writeFile(join(OUTPUT_DIRECTORY, "register-first-batch.sql"), statements.join("\n"), "utf8");
	console.info(`codex-flyhub-first-batch 阶段=注册SQL 输出目录=${OUTPUT_DIRECTORY} 结果=成功`);
	if (failedCharts.length > 0) {
		throw new Error(`以下榜单未刷新成功：${failedCharts.join(", ")}`);
	}
}

await main();
