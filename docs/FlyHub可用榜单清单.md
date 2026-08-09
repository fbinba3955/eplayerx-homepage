# FlyHub 可用榜单清单

> 整理日期：2026-08-09
> 范围：当前 `scripts/blocks/` 中已有抓取/发布实现的中文或可中文化榜单，以及可直接以 TMDB 生成的基础榜单。  
> 注意：这里的“可用”代表当前代码具备抓取和发布路径。第三方站点的可访问性会随反爬、接口和页面结构变化，仍需通过工作流结果和生产快照时间持续检查。

## 当前接入与发布状态

| 分类 | 榜单 | 更新频率 | 接入状态 | 发布状态 |
| --- | --- | --- | --- | --- |
| 剧场精选 | 爱奇艺、腾讯视频、优酷 6 个剧场榜单 | 每月 | 已接入 | 已发布 |
| 电影厂牌 | 全球 20 个电影厂牌榜单 | 每周 | 已接入 | 已发布 |
| 流媒体平台 | Netflix、Disney+、HBO、Apple TV+、Prime Video | 每周 | 已接入 | 已发布 |
| 地区剧集 | 国产、港、台、韩、日、泰、欧美 7 个热门榜 | 每日 | 已接入 | 已发布 |
| 综艺 | 国内口碑综艺榜、国外口碑综艺榜 | 每周 | 已接入 | 已发布 |

### 自动刷新覆盖

- 后台当前展示的 83 个榜单已经全部加入 `.github/workflows/blocks.yml`，不存在只展示、不刷新的遗漏 ID。
- 任务按内容变化频率划分为日更 26 个、周更 33 个、月更 24 个，手动执行时可按分组选择。
- GitHub 定时触发仍按每两小时运行一次，并在定时运行时刷新上述全部 83 个托管榜单。
- `IMDb 剧集 Top 250` 与 `猫眼电影 TOP100` 已接入统一生成器，不再依赖旧脚本单独发布。
- 统一生成器会校验工作流传入的榜单 ID；出现未定义 ID 时任务直接失败，不再静默跳过。

## 标签说明

| 标签 | 含义 |
| --- | --- |
| **首批需要** | 建议作为 Flymby 默认展示的基础入口，内容稳定且覆盖面高。 |
| **建议加入** | 适合第二批发布，按内容分区展示。 |
| **按需加入** | 专题性较强，适合后续增加，不宜一次全部铺在首页。 |
| **需确认** | 依赖易变第三方、Trakt 镜像或可能有匹配质量问题；发布前需逐条检查。 |
| **暂不加入** | 不符合当前中文 Flymby 展示范围、内容分级不适合，或只是内部子榜单。 |

## 一、首批需要：通用热门与高分榜

这组建议作为管理端“榜单”分区及 App 后续默认榜单的第一层入口。内容清晰、用户认知成本低。

| 分类 | 榜单名称 | 数据来源 | 更新 | 状态 | 当前情况 |
| --- | --- | --- | --- | --- | --- |
| 电影热门 | TMDB 热门电影 | TMDB `/movie/popular` | 每日 | **首批需要** | 已发布测试榜单 `flymby-test-tmdb-popular-movies`。 |
| 剧集热门 | TMDB 热门剧集 | TMDB `/tv/popular` | 每日 | **首批需要** | 已发布测试榜单 `flymby-test-tmdb-popular-tv`。 |
| 动画高分 | TMDB 高分动画 | TMDB Discover | 每周 | **首批需要** | 已发布测试榜单 `flymby-test-tmdb-top-animation`。 |
| 电影口碑 | 豆瓣电影 Top 250 | 豆瓣 subject collection | 每月 | **首批需要** | `monthly/douban-top250.ts`。 |
| 电影口碑 | 一周口碑电影榜 | 豆瓣 subject collection | 每周 | **首批需要** | `weekly/douban-weekly-best-movies.ts`。 |
| 剧集口碑 | 全球口碑剧集榜 | 豆瓣 subject collection | 每周 | **首批需要** | `weekly/douban-global-best-tv.ts`。 |
| 华语剧集 | 华语口碑剧集榜 | 豆瓣 subject collection | 每周 | **首批需要** | `weekly/douban-chinese-best-tv.ts`。 |
| 动画 | MyAnimeList 总榜 | MyAnimeList | 每月 | **首批需要** | `monthly/mal-top-anime.ts`。 |
| 动画 | MyAnimeList 最流行 | MyAnimeList | 每月 | **首批需要** | `monthly/mal-most-popular.ts`。 |
| 动画 | Bangumi 动画排行榜 | Bangumi API | 每月 | **首批需要** | `monthly/bangumi-top-anime.ts`。 |

## 二、建议加入：日更热度榜

这组适合单独设为“正在热播”或“今日热度”分类，不和长期经典榜混排。

| 分类 | 榜单名称 | 数据来源 | 更新 | 状态 | 脚本 |
| --- | --- | --- | --- | --- | --- |
| 今日电影 | 今日电影实时数据 | 艺恩娱数 | 每日 | **建议加入，需确认** | `daily/endata-hot-movie.ts` |
| 今日剧集 | 今日剧集热度榜 | 艺恩娱数 | 每日 | **建议加入，需确认** | `daily/endata-hot-tv.ts` |
| 今日动画 | 今日动漫实时数据 | 艺恩娱数 | 每日 | **建议加入，需确认** | `daily/endata-hot-anime.ts` |
| 国产剧 | 国产网剧热度榜 | 骨朵 | 每日 | **建议加入，需确认** | `daily/guduo-network-drama.ts` |
| 国产剧 | 爱奇艺风云榜热播 TOP100 | 爱奇艺榜单 API | 每日 | **建议加入，需确认** | `daily/iqiyi-hot-tv.ts` |
| 国产剧 | 近期热门国产剧 | 豆瓣 subject collection | 每日 | **建议加入** | `daily/douban-hot-domestic-tv.ts` |
| 美剧 | 近期热门美剧 | 豆瓣 subject collection | 每日 | **建议加入** | `daily/douban-hot-american-tv.ts` |
| 韩剧 | 近期热门韩剧 | 豆瓣 subject collection | 每日 | **建议加入** | `daily/douban-hot-korean-tv.ts` |
| 日剧 | 近期热门日剧 | 豆瓣 subject collection | 每日 | **建议加入** | `daily/douban-hot-japanese-tv.ts` |
| 动画 | 近期热门动画 | 豆瓣 subject collection | 每日 | **建议加入** | `daily/douban-hot-animation.ts` |
| 综艺 | 近期热门综艺节目 | 豆瓣 subject collection | 每日 | **建议加入** | `daily/douban-hot-variety-shows.ts` |
| 动画 | AniList 动画趋势榜 | AniList GraphQL | 每日 | **建议加入** | `daily/anilist-trending.ts` |
| 动画 | Bangumi 今日放送 | Bangumi API | 每日 | **建议加入** | `daily/bangumi-calendar.ts` |
| 海外热度 | JustWatch 流媒体榜 | JustWatch GraphQL（美国区） | 每日 | **按需加入，需确认** | `daily/justwatch-streaming-charts.ts` |

## 三、建议加入：国际权威与长期经典

| 分类 | 榜单名称 | 数据来源 | 更新 | 状态 | 脚本 |
| --- | --- | --- | --- | --- | --- |
| 电影经典 | IMDb 电影 Top 250 | IMDb，当前经 Trakt 镜像 | 每月 | **建议加入，需确认** | `monthly/imdb-top250-movies.ts` |
| 剧集经典 | IMDb 剧集 Top 250 | IMDb Wayback 快照 | 每月 | **建议加入，需确认** | `monthly/imdb-top250-tv.ts` |
| 电影热度 | IMDb 热门电影 | IMDb，当前经 Trakt 镜像 | 每周 | **建议加入，需确认** | `weekly/imdb-popular-movies.ts` |
| 剧集热度 | IMDb 热门剧集 | IMDb，当前经 Trakt 镜像 | 每周 | **建议加入，需确认** | `weekly/imdb-popular-tv.ts` |
| 剧集热度 | 烂番茄当前热门剧集 | Rotten Tomatoes | 每周 | **建议加入，需确认** | `weekly/rt-popular-tv.ts` |
| 华语电影 | 猫眼电影 TOP100 | 猫眼 | 每月 | **建议加入，需确认** | `monthly/maoyan-top100.ts` |
| 电影史 | BFI Sight & Sound 100 | BFI 静态名单 | 手动 | **按需加入** | `manual/bfi-sight-sound-100.ts` |
| 剧集史 | Rolling Stone 100 佳剧 | Rolling Stone 静态名单 | 手动 | **按需加入** | `manual/rolling-stone-100-tv.ts` |
| 剧集史 | WGA 101 最佳编剧剧集 | WGA 静态名单 | 手动 | **按需加入** | `manual/wga-101-best-written-tv.ts` |
| 电影史 | TSPDT 1000 佳片 | TSPDT 静态数据 | 手动 | **按需加入** | `manual/tspdt-1000.ts` |
| 电影节 | 奥斯卡最佳影片 | Letterboxd / 固定映射 | 手动 | **按需加入** | `manual/letterboxd-oscar-best-picture.ts` |
| 电影节 | 戛纳金棕榈 | Letterboxd / 固定映射 | 手动 | **按需加入** | `manual/letterboxd-palme-dor.ts` |
| 剧集纪录片 | Letterboxd 纪录剧集 Top100 | Letterboxd | 手动 | **按需加入，需确认** | `manual/letterboxd-top100-docuseries.ts` |

## 四、建议加入：动画与追番分区

周更表应以“合集”展示，星期一至星期日是隐藏子榜单，不应在公共网格重复显示。

| 分类 | 榜单名称 | 数据来源 | 更新 | 状态 | 脚本 |
| --- | --- | --- | --- | --- | --- |
| 当季新番 | 季度新番 | AniList / AniChart | 每周 | **建议加入** | `weekly/anichart-seasonal.ts` |
| 追番 | 追番日历 | Bangumi + MAL + 巴哈姆特合并 | 每周 | **建议加入** | `weekly/anime-calendar-weekdays.ts` |
| 追番 | MyAnimeList 周更表 | MyAnimeList | 每周 | **建议加入** | `weekly/mal-weekdays.ts` |
| 追番 | 新番周更表 | 巴哈姆特 | 每周 | **建议加入，需确认** | `weekly/bahamut-weekdays.ts` |
| 国漫 | 国漫周更表 | GitHub JSON | 每周 | **建议加入，需确认** | `weekly/guoman-weekdays.ts` |
| 动画排行 | MyAnimeList 合集（播出中/人气/即将播出） | MyAnimeList | 每周 | **按需加入** | `weekly/mal-rankings.ts` |
| 动画专题 | 豆瓣人气动画 | 豆瓣豆列 | 手动 | **按需加入** | `manual/douban-popular-anime-doulist.ts` |
| 动画专题 | 高分动画长片 | 豆瓣豆列 | 手动 | **按需加入** | `manual/douban-top-animation-movies.ts` |
| 动画专题 | 治愈动画 | 豆瓣豆列 | 手动 | **按需加入** | `manual/douban-healing-anime.ts` |
| 国漫专题 | 国产动画电影 | 豆瓣豆列 | 手动 | **按需加入** | `manual/douban-cn-animation-movies.ts` |
| 内容分级 | Bangumi Ecchi 动画排行 | Bangumi | 手动 | **暂不加入** | `manual/bangumi-ecchi-anime-rank.ts` |

## 五、按需加入：华语、地区与剧集专题

这些榜单适合作为“地区剧集”“华语精选”“剧场专区”的二级分类，建议首批后按需发布。

| 二级分类 | 可用榜单 | 来源 | 状态 | 脚本 |
| --- | --- | --- | --- | --- |
| 华语电影 | 华语电影 Top250、华语剧集 Top250、华语电影万人高分、90 年代华语经典、春节档电影、华语女性电影 Top300 | 豆瓣豆列/合集 | **按需加入** | `douban-domestic-top250-movies.ts`、`douban-domestic-top250-tv.ts`、`douban-100k-raters-domestic.ts`、`douban-90s-chinese-classic-movies.ts`、`douban-mainland-spring-festival-movies.ts`、`douban-women-films-top300.ts` |
| 海外电影 | 外语电影万人高分、韩国电影 Top100、日本电影 Top100、IMDb 5000 人评分华语电影 | 豆瓣豆列 | **按需加入** | `douban-100k-raters-foreign.ts`、`douban-top100-korean.ts`、`douban-top100-japanese.ts`、`douban-imdb-5k-cn-movies.ts` |
| 剧集地区 | 国产、港剧、台剧、韩剧、日剧、泰剧、欧美剧热门榜 | 豆瓣豆列 | **按需加入** | `douban-popular-cn-drama.ts`、`douban-popular-hk-drama.ts`、`douban-popular-tw-drama.ts`、`douban-popular-kr-drama.ts`、`douban-popular-jp-drama.ts`、`douban-popular-thai-drama.ts`、`douban-popular-western-tv.ts` |
| 剧集经典 | 国产、港剧、台剧、韩剧、日剧、英剧、美剧经典榜 | 豆瓣合集 | **按需加入** | `douban-classic-cn-drama.ts`、`douban-classic-hk-drama.ts`、`douban-classic-tw-drama.ts`、`douban-classic-kr-drama.ts`、`douban-classic-jp-drama.ts`、`douban-classic-uk-drama.ts`、`douban-classic-us-tv.ts` |
| 剧集专题 | 治愈剧、正阳门下小女人同类剧、豆瓣剧集 Top250 | 豆瓣豆列 | **按需加入** | `douban-healing-tv.ts`、`douban-zhengyang-suns-tv.ts`、`douban-tv-top250.ts` |
| 综艺 | 国内口碑综艺榜、国外口碑综艺榜 | 豆瓣 subject collection | **按需加入** | `weekly/douban-chinese-best-variety.ts`、`weekly/douban-global-best-variety.ts` |

> 上表中省略了 `manual/` 前缀；各条均位于 `scripts/blocks/manual/`。

## 六、按需加入：电影专题与片单

| 二级分类 | 可用榜单 | 来源 | 状态 | 脚本 |
| --- | --- | --- | --- | --- |
| 类型片 | 经典电影类型、高分类型电影、独立艺术电影、纪录片、高分短片 | 豆瓣豆列 | **按需加入** | `douban-classic-movie-genres.ts`、`douban-high-rated-by-genre.ts`、`douban-indie-art-films.ts`、`douban-popular-documentaries.ts`、`douban-top-short-films.ts` |
| 观影主题 | 值得重看、时间循环、真实事件、电影系列 | 豆瓣豆列 | **按需加入** | `douban-rewatchable-movies.ts`、`douban-time-loop-movies.ts`、`douban-true-story-films.ts`、`douban-movie-series.ts` |
| 系列宇宙 | 漫威 MCU 时间线 | 豆瓣笔记 | **按需加入** | `douban-marvel-mcu-timeline.ts` |
| 历史年度 | 豆瓣 2025 年度电影 | 豆瓣年度页 | **按需加入（历史）** | `douban-annual-2025.ts` |
| 电影专题 | Mtime Top100、电影是什么、CC Collection | 豆瓣/Letterboxd/CC | **按需加入，需确认** | `douban-mtime-top100.ts`、`letterboxd-what-is-reality.ts`、`cc-collection.ts` |
| 内容分级 | 血腥屠夫、LGBT 电影 | 豆瓣豆列 | **暂不加入默认网格** | `douban-slasher-doulist.ts`、`douban-lgbt-films.ts` |

## 七、平台与厂牌入口

这一类均直接展示为独立榜单入口，便于按具体平台或厂牌进入。

| 分类 | 榜单入口 | 内容 | 状态 | 相关脚本 |
| --- | --- | --- | --- | --- |
| 国内剧场 | 爱奇艺、腾讯视频、优酷剧场 | 爱奇艺迷雾/恋恋/小逗、腾讯 X、优酷白夜/生花等 | **已接入** | `create-flymby-first-batch-charts.ts` |
| 海外平台 | Netflix、Disney+、HBO、Apple TV+、Prime Video | 各平台热播剧集 | **已接入** | `create-flymby-first-batch-charts.ts` |
| 海外厂牌 | 20th Century、A24、Disney、Warner 等 | 各电影公司新片 | **已接入** | `create-flymby-first-batch-charts.ts` |
| 平台动态 | 流媒体平台动态 | 依赖 Trakt 的平台榜单 | **需确认** | `weekly/zh-fusion-streaming.ts` |
| 奖项/年代/导演 | 电影奖项、年代、导演合集 | Fusion 子榜单与合集 | **按需加入，需确认** | `manual/zh-fusion-awards.ts`、`zh-fusion-decades.ts`、`zh-fusion-directors.ts`、`zh-fusion-collections.ts` |
| 英文部件 | MDBList Widgets | 英文外部小组件 | **暂不加入** | `manual/en-mdblist-widgets.ts` |
| 阿拉伯语部件 | 阿拉伯语平台、厂牌、动画类型合集 | 阿拉伯语内容 | **暂不加入** | `weekly/arabic-*.ts`、`manual/arabic-fusion-collections.ts`、`register-ar-*.ts` |

## 八、当前不建议直接上架的来源

| 来源或榜单 | 原因 | 处理建议 |
| --- | --- | --- |
| Trakt 最新电影/剧集、Trakt 趋势电影/剧集、最新 4K | 当前产品已隐藏 Trakt 相关能力；数据源也依赖第三方列表。 | 不作为 Flymby 对外榜单入口；未来需要时再独立评估。 |
| IMDb 热门、IMDb 电影 Top250、全球流媒体平台动态 | 现有脚本间接依赖 Trakt。 | 可保留“需确认”状态；若要上架，先替换为 IMDb/ TMDB 直连实现。 |
| 所有 `register-*`、`patch-*`、`sync-titles`、`warm-*`、`backfill-*`、`set-title` 脚本 | 是注册、修复、预热和运维工具，不是榜单。 | 不在网格中展示。 |
| 周一至周日的隐藏子榜单 | 只供“追番日历”等合集读取。 | 只展示合集入口。 |

## 九、建议的后台网格分类和首批顺序

管理后台的“工具 → 榜单”建议按下面 6 个网格分区展示，而不是将所有榜单平铺：

1. **热门推荐**：TMDB 热门电影、TMDB 热门剧集、一周口碑电影、全球口碑剧集。
2. **今日热度**：艺恩电影/剧集/动画、豆瓣近期热门国产剧/美剧/韩剧/日剧/动画。
3. **高分经典**：豆瓣 Top250、IMDb Top250（确认后）、猫眼 Top100、BFI 100。
4. **动画追番**：TMDB 高分动画、MAL 总榜、MAL 最流行、Bangumi 总榜、季度新番、追番日历、国漫周更表。
5. **华语与地区**：华语口碑剧、国产剧热度、地区剧集专题、国内剧场精选。
6. **专题片单**：电影节、导演、年代、类型、平台/厂牌合集；默认折叠或作为后续扩展。

### 第一批实际发布建议（15 个）

1. TMDB 热门电影（已发布）
2. TMDB 热门剧集（已发布）
3. TMDB 高分动画（已发布）
4. 豆瓣电影 Top250
5. 一周口碑电影榜
6. 全球口碑剧集榜
7. 华语口碑剧集榜
8. 近期热门国产剧
9. 近期热门韩剧
10. 近期热门美剧
11. 近期热门动画
12. MyAnimeList 总榜
13. MyAnimeList 最流行
14. Bangumi 动画排行榜
15. 季度新番

这样能够先建立“电影、剧集、动画、华语、海外、经典、热度”完整入口，不会被大量长尾专题淹没。

## 十、发布前统一验收

- 每个榜单先本地执行一次对应发布脚本；确认返回条目数不为 0。
- 抽查至少前 10 条的片名、年份、类型和 TMDB 海报，确认没有同名误匹配。
- 先写 R2 快照，再将榜单注册为公开块；合集必须先有全部隐藏子榜单快照。
- 公共网格仅展示公开榜单；内部子榜单和运维脚本不展示。
- 日更/周更/月更脚本需提交到仓库并配置定时任务，否则只会停留在首次快照。
