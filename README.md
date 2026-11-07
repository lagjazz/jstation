# JAPANESE STATION — TACTICAL FPS

一个可直接在浏览器中运行的 Three.js 第一人称射击 Demo：
夜晚的日本铁路车站「桜見台駅」，樱花、便利店、进站电车、HDR/PBR、Bloom 后期、
粒子射击反馈、敌人 AI、3D 空间音频与完整任务流程。

**零外部资源即可运行** —— 所有模型 / 纹理 / HDR / 音效都是程序化生成的；
放入真实 GLB / HDR / 音频文件后会自动优先加载（见下文“如何替换”）。

## 运行方式

无需 Node.js / 打包器。用任意静态服务器打开（GLTF/HDR 加载依赖 HTTP，避免 file:// CORS）：

```bash
python -m http.server 8080
```

然后访问 <http://localhost:8080>（推荐桌面 Chrome / Edge，WebGL2）。

## 操作说明

| 按键 | 功能 |
|---|---|
| 鼠标 | 视角 |
| WASD | 移动（低矮台阶/路沿自动迈上） |
| SHIFT | 奔跑 |
| SPACE | 跳跃 |
| CTRL | 蹲下 |
| LMB | 射击 |
| RMB | 机瞄 / 开镜（ADS：缩放视野、降低散布与灵敏度；DMR 为全屏狙击镜） |
| R | 换弹（弹匣会真的掉出再插回） |
| G | 投掷手雷（抛物线、可弹跳、2 秒引信） |
| 1–6 / 滚轮 / Q | 切换武器（4–6 需从武器箱或「ARMORY」天赋解锁） |
| 1 / 2 / 3（过关窗口内） | 选择天赋 |
| F3 | 调试面板（FPS / Draw Calls / 三角面 / 粒子） |
| M | 静音 |
| ESC | 解锁鼠标 / 暂停 |

> MISSION 14（無重力水槽）里空中按住 SPACE = 喷气上升;MISSION 12 的巨型叶片
> 踩上去会把你弹上树冠栈道。

任务：15 个关区的战役——从地铁站打到電脳街 / 月面基地 / 古墓 / 天空港 /
量子实验室 / 沉没大陆,再推进到永夜极光破冰船 / 轨道电梯 / 世界樹树冠 / 錆之峡谷 /
無重力水槽 / 鐘楼机关城。敌人分批增援（WAVE x/y）,击杀会掉落**急救包 / 弹药**——
**生命值没有自动恢复**,掉血之后只能靠捡急救包补回来。
全歼后显示 KILLS / ACCURACY / TIME,第十五关后 CAMPAIGN COMPLETE。

## 玩法系统（v2）

- **胜利条件随机化**（`js/objectives.js`，`MISSIONS[].objectives` 池）：每次进入关卡从该关的
  目标池里抽一种——**殲滅**（清空敌人）/ **持久**（顶住源源不断的增援 N 秒）/ **端末防衛**
  （保护数据终端，敌方破坏兵会走过去黑它，完整度归零即失败并重试本关）/ **拠点確保**（站在
  上传圈内且圈内无敌人时进度上涨）/ **情報回収**（拿到 3 个数据盘再撤到撤离信标）/
  **指揮官排除**（击杀 Boss 指挥官，其余敌人撤退）。HUD 顶部显示目标与进度，屏幕上有指路标记。
- **敌人 AI**（`js/enemy.js`）：发现你会**呼叫附近队友**；看不到你时不再“透视追踪”，而是去
  最后位置**搜索**；受伤/没子弹会**找掩体**（射线确认能挡住视线的位置）蹲下换弹再探头；
  突击类会**包抄侧翼**；掷弹兵/重装/指挥官会对**蹲点或躲掩体**的你扔手雷；连发点射 + 弹匣/
  换弹空窗；你移动越快越难被打中；子弹擦身有呼啸声。
- **新敌种**：防弹盾兵（正面打不穿，要绕侧/打腿/爆头）、医疗兵（给周围受伤队友回血，优先击杀）、
  无人机（悬停飞行、快速、被击落会坠毁）、**指挥官 Boss**（血条、66%/33% 血量时呼叫增援、扔雷）。
  后续波次会混入特种兵；战役越往后精英概率和血量越高。
- **出现规律**：增援波次随机采用 正面 / 背后包抄 / 两翼钳形 / 小队集结 / 冲锋 五种模式，
  优先从你视野外刷出；场上快清空时下一波会提前到。
- **武器**：AR-15、M9、M870 初始可用；**MP7 冲锋枪、M14 精确射手步枪（可穿透 1 人、全屏狙击镜）、
  M32 榴弹发射器（抛物线爆炸弹）**需拾取武器箱或天赋解锁。第一人称有**戴手套的双手和袖子**握枪，
  霰弹枪左手跟着泵动。
- **掉落物**：弹药 / 急救包 / **防弹插板**（护甲吸收 60% 伤害）/ **手雷** / **武器箱** /
  **OVERDRIVE**（10 秒 +50% 伤害）/ **HASTE**（10 秒加速 + 快速换弹）。掉落在尸体所在高度
  （高架栈道上也正确），地面有彩色光圈。
- **成长**：击杀得 XP（爆头/精英更多，完成目标有奖励），升级获得天赋点，过关窗口里三选一
  （15 种天赋，可叠加：体力、护甲、快手、强装弹、爆头倍率、移速、弹匣、医疗、拾荒、稳定射击、
  手雷容量、击杀回血、防爆、不屈、武器库）。重开战役清零。
- **可变场景**（`js/props.js` + `js/variants.js`）：每次进关在空旷地面随机摆放**掩体**（木箱堆、
  弹药柜、沙袋墙、水泥隔离墩，真实碰撞 + 挡子弹 + 敌人会用它当掩体）和**红色爆炸油桶**
  （打几枪会漏火然后爆炸，可连锁）；并随机天气/光照：**濃霧 / 雷雨（GPU 雨丝 + 闪电 + 雷声）/
  停電（灯光闪烁）/ 警戒（红色调 + 警报）/ 黄昏 / 猛吹雪**。
- **声音**：枪声改为分层合成（瞬态爆裂 + 膛口 + 低频冲击 + 枪机声 + 环境尾音），每把枪 3–4 个
  随机变体；所有声音过**按地图生成的混响**（站厅、石墓、天空、水下……）；新增爆炸、手雷弹跳、
  子弹呼啸、盾牌弹开、心跳（低血量）、雷声等。**背景音乐**为程序化自适应配乐（`js/music.js`）：
  每个世界有自己的调式/速度/和弦，平时是 pad + 琶音，交火时鼓、贝斯逐渐加入。
- **画面**：敌人/武器/掉落物/道具都改为高细节程序化模型并**合并为少量 draw call**
  （`js/meshKit.js`：每顶点粗糙度/金属度 + 烘焙 AO）；带贴图的材质自动加凹凸细节；
  新增最终调色 Pass（`js/postfx.js`：对比/饱和/冷暗暖亮、镜头暗角、边缘色散、胶片颗粒、
  低血量去色 + 红色脉冲、增益描边、狙击镜遮罩；LOW 画质关闭）。
- **碰撞/边界**：碰撞改为空间哈希网格（查询只看附近格子）；玩家可自动迈上 ≤0.48 m 的台阶；
  敌人之间、敌人与玩家之间不再互相穿模；敌人命中框按部位分（头 ×2、躯干 ×1、四肢 ×0.72）
  且跟随动画；手雷/榴弹与碰撞体真实反弹。

### 性能

- 敌人：每个约 12 个 draw call（原约 43 个），几何按兵种缓存复用；尸体 7 秒后下沉移除。
- 实测（13 名敌人交火）：`_update` 平均 0.52 ms（原 0.79 ms），draw calls 508（原 873）。
- 子弹与敌人视线射线只检测**当前地图**的网格（不再遍历 16 张地图）；HUD 只在数值变化时写 DOM；
  所有新模型/材质/掉落物/道具/混响在加载阶段预热，关卡中不会再首次编译着色器或上传缓冲区。

## 项目结构

```
jstation/
├── index.html          # 入口 + import map（three@0.165 CDN）+ HUD/界面 DOM
├── REQUIREMENTS.md     # 三份原始需求合并版（prompt.txt / moremaps1.md / moremaps2.md）
├── REBUILD.md          # MISSION 04–15 重建验收契约（逐关清单 + 引擎硬规则）
├── css/style.css       # 极简军事风 UI
├── js/
│   ├── main.js         # 入口
│   ├── game.js         # 总装：渲染器/后期/任务/开火管线/画质切换
│   ├── config.js       # 全部可调参数（武器、玩家、敌人、画质预设）
│   ├── layout.js       # 车站坐标
│   ├── assetManager.js # GLB/HDR/Texture/Audio 加载 + 失败 fallback
│   ├── environment.js  # HDR → PMREM → scene.environment（PBR 环境光照）
│   ├── textures.js     # 程序化 canvas 纹理（大理石/混凝土/招牌/广告…）
│   ├── materials.js    # 共享 PBR 材质（地面湿润 clearcoat、玻璃 transmission）
│   ├── station.js      # 主大厅（闸机/售票机/长椅/LED/日文指示牌/樱花庭院）
│   ├── store.js        # 駅コンビニ（玻璃门面、自动门、货架、暖光）
│   ├── platform.js     # 站台（黄线/站台门/轨道/雨棚/夜景天际线）
│   ├── train.js        # 4 节通勤电车：进站→制动→开门→停靠→关门→出站
│   ├── sakura.js       # 樱花树 + GPU 花瓣粒子（飘落/漂移/旋转）
│   ├── player.js       # PointerLock 控制、碰撞、后坐/震屏合成
│   ├── weapon.js       # 3 把程序化枪械 + 持枪动画（呼吸/摆动/冲刺/换弹）
│   ├── enemy.js        # 敌人 FSM：巡逻/追踪/攻击/受击/死亡（随机出生点池 + 精英敌人 + 枪口火焰/灯光/烟雾；铰接四肢 + 双手持枪姿态/瞄准 blend/后坐）
│   ├── pickups.js      # 击杀战利品：急救包/弹药/护甲/手雷/武器箱/OVERDRIVE/HASTE
│   ├── enemyModel.js   # 敌人高细节程序化模型（按骨骼段烘焙，按兵种缓存）
│   ├── meshKit.js      # PartList → 单个 BufferGeometry（顶点色 + 每顶点粗糙度/金属度）
│   ├── gameSystems.js  # 玩法层：目标/成长/护甲/手雷/爆炸/道具/天气/音乐强度/HUD 连接
│   ├── objectives.js   # 六种胜利条件
│   ├── progression.js  # XP / 等级 / 15 种天赋
│   ├── explosives.js   # 手雷、榴弹、爆炸（伤害衰减 + 火球特效）
│   ├── props.js        # 每局随机掩体 + 爆炸油桶
│   ├── variants.js     # 天气/光照变体 + GPU 雨雪
│   ├── music.js        # 程序化自适应背景音乐
│   ├── postfx.js       # 最终调色 Pass
│   ├── hudExtras.js    # 护甲/XP/目标/路标/Boss 血条/天赋卡等 HUD
│   ├── newAreas.js     # MISSION 04–09 主题世界（cyber/moon/tomb/skyport/lab/atlantis）
│   ├── newAreas2.js    # MISSION 10–12（ice/orbit/canopy）+ 极光 fbm Shader + 通用点场 pointField
│   ├── newAreas3.js    # MISSION 13–15（canyon/aquarium/clockwork）+ fresnel 水球 + 沙暴/巨齿鲨/旋转齿轮
│   ├── mapChunks.js    # 大地图分块加载：ChunkGrid 17m 网格按视距开关渲染 + LOD/代理 + splat 材质
│   ├── particleManager.js # 粒子池（火花/烟/尘/碎屑/玻璃/弹痕/曳光）
│   ├── audioManager.js # Web Audio 全程序合成音效 + PositionalAudio + 日语广播
│   ├── collision.js    # AABB 碰撞世界
│   ├── build.js/hud.js/utils.js
└── assets/
    ├── models/  # station.glb train.glb rifle.glb enemy.glb
    ├── hdr/     # station_night.hdr
    ├── textures/
    └── audio/   # 可选 .wav/.ogg/.mp3 覆盖同名合成音效
```

## 如何替换资源

资源清单集中在 `js/config.js` 的 `ASSETS` 中。放入文件即自动生效；
文件不存在时自动回退到程序化内容（加载失败不会崩溃）。

- **替换 GLB**：放到 `assets/models/`，文件名与 `ASSETS.models` 一致
  （`enemy.glb` / `rifle.glb` / `train.glb` / `station.glb`）。
  代码会自动遍历网格、开启阴影、按包围盒缩放到目标尺寸；
  若模型含名为 `Idle/Walk/Run/Attack/Hit/Death/Reload` 的动画会自动用 AnimationMixer 播放，否则保留程序化动画。
  （`station.glb` 为整体场景叠加预留位。）
- **替换 HDR**：放 `assets/hdr/station_night.hdr`（等距柱状投影 .hdr），
  自动经 PMREM 作为 `scene.environment` 驱动 PBR 反射与环境光照。
- **替换枪械**：放 `assets/models/rifle.glb`（建议模型朝 +X 或 -Z，代码按最长轴自动转向并对准枪口）。
- **替换音效**：在 `assets/audio/` 放入 `ASSETS.audio` 列出的同名文件
  （如 `gunshot_rifle.wav`、`train_rumble.wav`、`station_chime.wav`…），
  存在则覆盖对应合成音，不存在则继续用 Web Audio 合成音。
- 广播：优先 `SpeechSynthesis` 日语语音；浏览器无日语语音时自动播放提示音 fallback。

## 如何调整

- **画质**：开始/暂停界面的 GRAPHICS QUALITY 下拉（LOW / MEDIUM / HIGH / ULTRA），
  对应 `js/config.js` → `QUALITY_PRESETS`（阴影尺寸、Bloom、像素比、粒子密度、clearcoat/transmission）。
- **战役关卡**：共 15 关，配置在 `js/config.js` → `MISSIONS`——
  前三关在站内（改札 / ホーム / 桜の庭園），MISSION 04–09 是六个按
  `moremaps.md` 规格在 `js/newAreas.js` 建造的主题世界：
  | 关卡 | 世界 | 特色机制 |
  |---|---|---|
  | 04 | 電脳九龍（cyber） | 垂直密集霓虹巷道 + 脚手架阶梯、全息广告（Shader）、**湿地面镜面反射**、可击碎的霓虹灯板、飞车光轨 |
  | 05 | 月面基地（moon） | **低重力**跳得更高等、可射击墙上的开关打开气闸门、巨型离心机、破碎舷窗（框上挂着碎玻璃）外是缓转的地球、飘浮尘埃、红色警报闪烁 |
  | 06 | 黄金の墓（tomb） | 象形文字壁浮雕、石柱迷宫回廊、火把频闪、金棺高台与金堆（金属 PBR）；**可射落的圣甲虫石板触发落石陷阱 + 流沙坑**（traps） |
  | 07 | 天空港（skyport） | 黄铜飞艇港：呼吸的帆布飞艇、齿轮群、蒸汽喷口把你吹起来；甲板下是 900 m 云海（fbm Shader），四周**隐形空气墙**（栏杆挡人不挡视野） |
  | 08 | 量子実験室（lab） | 白色极简大厅 + 镜面地板、悬浮 fresnel 量子核心与涟漪环、脉冲核心 **EMP 每 ~18 秒使 HUD 故障** |
  | 09 | 沈没大陸（atlantis） | **水下体验**：重力/移速下降、开火与命中冒气泡、希腊神殿柱廊/三角楣/方尖碑、动画水面焦散（Shader）、发光鱼群、**洋流通道会推着你走**（currents） |

  MISSION 10–15 是第二批六个全新世界（`moremaps2.md` 规格），分别建在
  `js/newAreas2.js`（ice / orbit / canopy）与 `js/newAreas3.js`（canyon /
  aquarium / clockwork）：

  | 关卡 | 世界 | 特色机制 |
  |---|---|---|
  | 10 | 永夜极光破冰船（ice） | 76 m 大 arena：中央 36 m 核动力破冰船——下层舱室内 CQB、登上层甲板与雷达桅杆狙击高地；南北冰川脊（实例化冰堆 + LOD 远峰）上挂着**可射落的冰锥**；雪/冰/岩 splat 冰面、极光天穹（fbm Shader）、风雪与扫动搜索灯光柱 |
  | 11 | 轨道电梯（orbit） | **真环形甲板**（内 r12 → 外 r30）镂空栏杆、中央真空深井里的缓转地球（r120、下方 160 m）；电梯光柱 + 对接臂；**每 ~16 秒一列货运滑车横穿甲板**——被撞飞并受 14 伤害；甲板下 100+ 实例化支柱、集装箱群、四角船坞吊臂；隐形空气墙 |
  | 12 | 世界樹树冠（canopy） | 主战层在 **y≈6.75 树冠栈道网**（木板栈道 + 3 座合金高台 + 贯通巨树的直线狙击通道）；**敌人锚点也在栈道上**——树冠上真刀真枪，地面另有蕨菇灯下层路线；地面**弹跳垫**（power 17.6）送你上栈道；GPU 顶点风动叶片（InstancedMesh + ShaderMaterial）+ 玻璃穹顶光柱 |
  | 13 | 錆の峡谷（canyon） | 72 m 红峡谷；**46 m 三段式星舰残骸**：断裂缺口可进入肋骨内舱（CQB 灯带）、货箱阶梯爬上榜顶狙击位、引擎钟形喷口与尾翼；船体漆带分段可辨;红砂岩壁（实例化 + LOD 远峰）、**沙暴周期来袭**（雾距骤缩 + 拉丝风沙） |
  | 14 | 無重力水槽（aquarium） | **零重力**：gravityScale 0.3 + 按住 SPACE 喷气上升;浮水球（fresnel rippling Shader,穿入减速 50%）+ 发光水母群 + 三层格栅观景台;**9 m 机械巨齿鲨**头顶巡逻——每 ~20 秒标记一颗水球、绕巡、俯冲**吞噬咬**(咬中 40 伤害 + 重生);四墙焦散辉光。本关光污染已调低——水球/霓虹/焦散的自发光减半,且 `atmo.bloom` 单独压低 Bloom,保证能看清敌人 |
  | 15 | 鐘楼机关城（clockwork） | 地面大齿轮**按真实传动比互相咬合旋转且可站立**（踩上会被带动）;**咬合点是 85 伤害陷阱**（火花 + 齿隙板）;两座体育场齿轮载着**缓慢公转的哥特小镇**;10 面地漏齿轮跳板;四面顶天立地 3D 厚齿墙齿轮封死天空;钟摆擒纵、黄铜尘埃;精英关（全员红袖标） |

  每关有独立出生点、氛围（雾/月光/程序化天空 THEME_BG / THEME_BG2 / THEME_BG3）
  与横幅;过关显示的「NEXT」过场窗口会在 `INTERMISSION.seconds`（默认 4 秒，
  窗口内有倒计时）后**自动消失并进入下一关**——不点也行，点击只是跳过倒计时；
  若浏览器拒绝免手势重新锁定鼠标，会自动落到暂停卡片，点一下即恢复。
  第 15 关结束才显示 CAMPAIGN COMPLETE（保持手动，方便看战绩 / 重开）。
  世界机制开关都在 `MISSIONS[].mods`（ice / bounce / sandstorm / zeroG /
  gapScale / gravityScale…）,在 `game.js._update` 里按关生效。
- **大地图、分块与封闭性**：MISSION 04–15 按 `moremaps1/2.md` 重建成 52–76 m 见方的
  主题世界（破冰船 / 环形轨道站 / 树冠栈道网 / 星舰残骸……），全部避开火车走廊
  （z 24–31）——列车不会从任何任务地图中间穿过；所有墙体/道具同时是碰撞体 +
  射线遮挡体（人和子弹都不能穿）。开放天空的世界（天空港 / 轨道电梯 / 树冠）
  用**隐形空气墙**封边界——挡人不挡视野。
  每个世界挂 17 m 的 `ChunkGrid`（`js/mapChunks.js`）：出生视距外的区块只关
  **渲染**（碰撞与射线遮挡恒在），远景装饰走 `lodNode`（按簇中心测距的 LOD 切换,
  贴地平替身）；地面用 splat Shader（雪/冰/岩、沙/锈、土壤多材质混合）。
  `newAreas.bounds` / `newAreas2.bounds` / `newAreas3.bounds` 导出每个世界的
  内接矩形，game.js 用它做玩家**围栏钳制**（走到缝隙也不会漏到别的世界），
  enemy.js 用它做**防卡死守护**：敌人若嵌进几何体或离开本方世界，会被传回
  空闲出生锚点并带落地烟尘——彻底杜绝「看不见打不到但一直在开枪、关卡
  永远打不完」的死锁（第 8 关旧 bug）。
- **世界互不穿帮**：每个主题世界的所有网格挂在各自的 `THREE.Group`
  （`newAreas*.setVisible(area)`）里，切关时只显示当前世界的几何体——极光
  天穹 / 地球 / 树冠外壳这些超尺寸装饰再也不会从隔壁世界墙头漏进来；
  常驻**灯光**留在场景根部不受 gating 影响（灯光数量恒定 52 点光 + 1 聚光）。
  另外每关按雾距设置相机 `camera.far`（`atmo.farClip`，缺省 fogFar+90），
  进一步裁掉远处世界的绘制。实测每关 draw call 稳定在 ~230–350。
  `atmo.bloom` 是该关的 Bloom 强度系数(画质预设值 × 系数,切画质不丢
  系数)——光污染重的世界用它压光晕,如第 14 关 `bloom: 0.5`。
- **地铁广播只在站内**：日语到站广播、铃、刹车声仅在 hall/platform/garden
  三张站内地图播放；主题世界的通勤列车直接停发（train timer 挂起），
  夜景城市天际线背景也只在站内与電脳九龍显示。
- **分批增援（波次）**：敌人不再一次全部登场。每关 `MISSIONS[].waves`
  给出批次规模（如 `[3,3,2]`），首批立即部署，后续批次每隔
  `WAVES.gap`（11–20 秒随机）从池中另选的随机锚点插入，屏幕中央弹出
  「⚠ REINFORCEMENTS · 増援確認」，HUD 右上显示 WAVE x/y；
  「剩余目标」= 存活敌人 + 尚未出场的增援。
  被击中的击退位移也走 `moveAndSlideSimple` 碰撞滑动——敌人不会再被
  子弹「打穿」进房子或墙里（旧版直接积分位移导致的穿墙观感来源）。
- **敌人种类**：`js/config.js` → `ENEMY.classes`（基础 130 HP × `hpMul`），
  每关 `roster` 决定搭配——十种：`rifle` 标准步兵、`rusher` 突袭兵（橙面罩、
  快而脆）、`heavy` 重装兵（蓝面罩、厚甲慢炮）、`marksman` 狙击兵（绿面罩、
  视野 52m、太近会拉开距离）、`stalker` 潜行者（紫面罩、无背包持短刃、
  被发现不出声、射速极快）、`breacher` 破门的霰弹兵（黄绿面罩、四连喷）、
  `bombardier` 重炮兵（背挂榴弹发射器、单发大口径、大伤害、会风筝距离）、
  `flamer` 火焰喷射兵（橙色头盔面罩发光、背负双罐 + 喷嘴带常明火苗,近距扇形
  5 连喷低单发高总量）、`phantom` 幻影侦察兵（半透明呼吸闪烁、斗篷、身形
  最小、视野 30m、射速最快 aimSpeed 最高）、`juggernaut` 堡垒重兵（1.35×
  体型、金色面罩、加特林弹鼓、3.4× HP、超远 19m 火力压制、会保持 6m 距离）。
  外形/装备/面罩颜色逐类不同；`elite` 关全员加红袖标 + 红外频闪并强化属性。
  命中头部有 2× 伤害并在敌人头顶浮出「HEADSHOT +2×」小字。
- **敌人更强了**：`ENEMY.damageMin/damageMax` 基线提高到 9–15，`hitChance`
  0.63，重/炮/堡垒类另有逐类伤害加成——站桩对枪必死，必须找掩体、绕侧、
  听声。
- **敌人动作（双手持枪）**：`js/enemy.js` 全身铰接骨架——髋→膝（大腿/小腿
  /靴）、肩→肘（上臂/小臂/手套）逐节摆动，走路时大腿摆幅 ±0.6、小腿随
  落地相位弯膝；**所有敌人都把枪真切握在双手里**：待机时低姿端枪巡逻，
  进入 ATTACK 在 `aimSpeed` 内 blend 到抵肩瞄准姿态（`aimAmt` 0→1）,开火
  与受击触发 `recoil` 枪身后坐 + 枪口上跳,手臂肘关节同步收紧——不再有
  「枪悬浮在肚子前面」的观感。
- **没有自动回血**：玩家 HP **不做任何被动恢复**（旧版脱战 5.5 秒后
  11 HP/s 的自动回血已移除）。战斗中掉的血,唯一的恢复来源就是下面的
  急救包掉落;战败(overrun)重生也只补到 `PLAYER.overrunHp`（默认 60）,
  不满血——想满血就得去捡医疗包。开局/换关满血是任务边界重置,不算恢复。
- **战利品掉落**（`js/pickups.js` + `js/config.js` → `DROPS`）：击杀敌人
  按概率掉**急救包**（`medkitChance` 0.32，拾取 +26 HP,**这是全游戏唯一的
  回血手段**）或**弹药箱**
  （`ammoChance` 0.55，拾取全武器备弹 +24）；heavy / bombardier /
  juggernaut / flamer 等重型单位另有 `bonus` 加成概率,精英怪 +10%。掉落在
  原地浮动旋转发光,16 秒后闪烁消失；拾取触发铜管音 / 上行和弦 + HUD 提示
  「✚ +26 HP · 応急処置」/「▮ +24 ROUNDS · 弾薬補給」。
- **敌人数量 / 出生位置**：每关 `MISSIONS[].enemyCount`；出生点从
  `SPAWN_POOLS`（15 个区域各 6–7 个锚点；station 三个在 `js/enemy.js`，
  主题世界分别在 `js/newAreas.js` / `newAreas2.js` / `newAreas3.js` 注册）
  随机抽取 + 抖动 + 碰撞校验，且避开
  已存活敌人占用的锚点——每次任务 / 重开 / 每一批增援，位置都不同。
  锚点可带 `y` 字段挂到**高架层**（如世界樹 y=6.75 栈道）：敌人在该高度出生并
  沿该层的 waypoints 巡逻，防卡死守护也按各自层高校验。
- **敌人精英参数**：`js/config.js` → `ENEMY.eliteHpMultiplier / eliteSpeedScale`。
- **武器伤害 / 射速 / 弹匣**：`js/config.js` → `WEAPONS`（rifle / pistol / shotgun：`damage`、`rpm`、`mag`、`reloadTime`、霰弹枪 `pellets`）。
- **CS 式压枪手感**（Counter-Strike 风格弹道爬升）：持续扫射时**视角逐发上跳、
  散布越打越大**——前几发几乎不跳，扫到 `sprayRamp` 发后每发爬升达到
  `climbMax`，同时弹道散布热度涨到 `spreadMax`；松扳机 `RECOIL.resetAfter`
  （0.3 s）后弹道模式快速冷却，**慢速点射每发都接近满精度、几乎不跳**。
  视角上跳是**永久**的（不像受击抖动会自动回落）——需要玩家像 CS 一样下拉
  压枪。调参在 `js/config.js` → `RECOIL`（resetAfter / coolRate）+
  `WEAPONS[].sprayRamp / climbMin / climbMax`；散布热度在扳机按住期间**不衰减**
  （ burst 中途不冷却），这是扫射变飘的关键。
- **玩家手感**：`js/config.js` → `PLAYER`（移速、跳跃、重力、视野、
  `overrunHp` 战败重生补血量;无回血相关参数——恢复只走 `DROPS`）。
- **慢动作击杀**：`js/config.js` → `SLOWMO`。

## 技术要点

- three@0.165（CDN import map）· WebGL2 · ACES Filmic + sRGB · PCFSoft 阴影
- EffectComposer：RenderPass → UnrealBloomPass → OutputPass（LOW 自动关闭 Bloom）
- HDR 环境（真实 .hdr 或程序化 float HDR）→ PMREM → PBR 环境光照与反射
- 粒子全部为池化 `THREE.Points + ShaderMaterial`（每类一个 draw call），弹痕/曳光用池化 Mesh
- **主题世界性能**（MISSIONS 04–15，稳定 60FPS）：几何体全部是程序化低多边形基元
  + 全局 `cachedBox` 尺寸缓存（零下载、零解析、GPU buffer 复用）；重复物批量走
  `InstancedMesh`（電脳九龍的电缆 / 水管、黄金の墓的金币堆各 1 个 draw call）；
  动画特效走自定义 `ShaderMaterial`（全息广告、水面焦散、量子核心脉冲、极光天穹、
  风动叶片、fresnel 水球各 1 个 draw call，GPU 端动，CPU 每帧只加 `uT`）；
  新世界的雾 / 天空（THEME_BG / THEME_BG2 / THEME_BG3 程序化等距柱状贴图）与
  常驻灯数恒定——切关不换灯光数量，杜绝着色器中途重编译；每关的世界 Group
  可见性门控 + `atmo.farClip` 视锥裁剪把 12 个主题世界的 draw call 稳定压到
  230–350（此前跨界穿帮时曾达 1200–2000）。
  （若要换成外部 GLB：`assetManager` 的 GLTFLoader 通道已预留，放入文件即生效。）
- 3D 空间音频：电车轰鸣、店内环境、站台广播喇叭、敌人枪声（`THREE.PositionalAudio`）
- 电车动态事件循环：车灯→驶入→刹车→停靠→开门（站台门联动）→发车，40~60 秒一班
- 击杀反馈：弹孔贴花 + 火花/烟/碎屑 + 命中音效 + HIT 标记 + 轻微震屏 + 爆头/终结慢动作（无血腥）
- 敌人开火反馈：枪口 Sprite 火焰（随机大小/旋转）+ 共享 PointLight 闪光池（3 盏常驻
  灯、强度 0 待机——灯光数量恒定,避免着色器中途重编译）+ 枪口烟/火花 + 曳光弹
- **防卡顿**（中途冻结数秒的根源与对策）：
  - 电车车灯/车内灯常驻场景根部（隐藏时强度 0）——列车到站不再改变灯光数量,
    不会触发全场材质着色器重编译;
  - 加载界面末尾把隐藏物体临时全显,`renderer.compile` + 完整渲染一次,
    把着色器编译与 GPU buffer 上传全部提前到 loading 阶段;
  - 敌人身上的几何体走全局缓存（同尺寸一个 BufferGeometry）——重开一局
    新刷一波敌人不再重新上传 GPU;
  - 一次性音效节点池化复用、`ColliderWorld.all()` 缓存、射击目标数组按脏标记
    重建——把每帧/每枪的垃圾分配降到最低,GC 不再抽风。
