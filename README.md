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
| WASD | 移动 |
| SHIFT | 奔跑 |
| SPACE | 跳跃 |
| CTRL | 蹲下 |
| LMB | 射击（步枪全自动） |
| R | 换弹 |
| 1 / 2 / 3 | 主武器 / 副武器 / 霰弹枪 |
| F3 | 调试面板（FPS / Draw Calls / 三角面 / 粒子） |
| M | 静音 |
| ESC | 解锁鼠标 / 暂停 |

> MISSION 14（無重力水槽）里空中按住 SPACE = 喷气上升;MISSION 12 的巨型叶片
> 踩上去会把你弹上树冠栈道。

任务：15 个关区的战役——从地铁站打到電脳街 / 月面基地 / 古墓 / 天空港 /
量子实验室 / 沉没大陆,再推进到极光冰原 / 轨道电梯 / 世界樹树冠 / 錆之峡谷 /
無重力水槽 / 鐘楼机关城。敌人分批增援（WAVE x/y）,击杀会掉落**急救包 / 弹药**——
**生命值没有自动恢复**,掉血之后只能靠捡急救包补回来。
全歼后显示 KILLS / ACCURACY / TIME,第十五关后 CAMPAIGN COMPLETE。

## 项目结构

```
jstation/
├── index.html          # 入口 + import map（three@0.165 CDN）+ HUD/界面 DOM
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
│   ├── pickups.js      # 击杀战利品：急救包 / 弹药箱（浮动旋转、拾取回血/补弹、限时消失）
│   ├── newAreas.js     # MISSION 04–09 主题世界（cyber/moon/tomb/skyport/lab/atlantis）
│   ├── newAreas2.js    # MISSION 10–12（ice/orbit/canopy）+ 极光 fbm Shader + 通用点场 pointField
│   ├── newAreas3.js    # MISSION 13–15（canyon/aquarium/clockwork）+ fresnel 水球 + 沙暴/巨齿鲨/旋转齿轮
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
  | 04 | 電脳九龍（cyber） | 霓虹巷道、全息广告（Shader）、可击碎的霓虹灯板、飞车光轨 |
  | 05 | 月面基地（moon） | **低重力**跳得更高等、可射击墙上的开关打开气闸门、飘浮尘埃、红色警报闪烁 |
  | 06 | 黄金の墓（tomb） | 象形文字壁浮雕、石柱迷宫、火把频闪、金棺与金堆（金属 PBR） |
  | 07 | 天空港（skyport） | 栈桥平台四周是**隐形空气墙**（栏杆挡人不挡视野）；蒸汽喷口把你吹起来；呼吸的飞艇、转动的齿轮 |
  | 08 | 量子実験室（lab） | 白色极简大厅、脉冲量子核心、镜面墙；核心 **EMP 每 ~18 秒使 HUD 故障** |
  | 09 | 沈没大陸（atlantis） | **水下体验**：重力/移速下降、开火与命中冒气泡、动画水面焦散（Shader）、发光鱼群 |

  MISSION 10–15 是第二批六个全新世界（`moremaps2.md` 规格），分别建在
  `js/newAreas2.js`（ice / orbit / canopy）与 `js/newAreas3.js`（canyon /
  aquarium / clockwork）：

  | 关卡 | 世界 | 特色机制 |
  |---|---|---|
  | 10 | 极光冰原（ice） | 破碎的货轮残骸当高地；**头顶冰锥可被射落**,砸下来对敌我双方都造成 45 伤害并扬起尘爆;极光天穹（fbm Shader）、风雪粒子、搜索灯光柱 |
  | 11 | 轨道电梯（orbit） | 环形轨道站平台,**每 ~16 秒一列货运滑车横穿甲板**——被撞飞并受 14 伤害;脚下 300 m 半径的地球（自转云层）、电梯光柱与轨道环、隐形空气墙 |
  | 12 | 世界樹树冠（canopy） | 6 m 高树冠栈道作战;**巨型叶片是弹跳垫**,踩上去弹上栈桥（power 15.2）;GPU 顶点风动叶片（InstancedMesh + ShaderMaterial）、萤火光点 |
  | 13 | 錆の峡谷（canyon） | 红色岩壁间的星舰残骸;**沙暴周期来袭**（雾距从 26/160 压到 5/40,视野骤缩）,500 粒风沙贴脸飞过;引擎钟形舱、阶梯货箱 |
  | 14 | 無重力水槽（aquarium） | **零重力**：gravityScale 0.3 + 按住 SPACE 喷气上升;五颗**浮水球**（fresnel rippling Shader,穿入减速 50%）;巨齿鲨光眼在头顶盘旋、水波焦散地板。本关光污染已调低——水球/霓虹/焦散的自发光减半,且 `atmo.bloom: 0.5` 单独压低 Bloom,保证能看清敌人 |
  | 15 | 鐘楼机关城（clockwork） | 巨型齿轮**缓慢旋转且可站立**（踩上去会被带动）;哥特剪影天际线、黄铜尘埃、精英关卡（全员红袖标） |

  每关有独立出生点、氛围（雾/月光/程序化天空 THEME_BG / THEME_BG2 / THEME_BG3）
  与横幅;过关显示的「NEXT」过场窗口会在 `INTERMISSION.seconds`（默认 4 秒，
  窗口内有倒计时）后**自动消失并进入下一关**——不点也行，点击只是跳过倒计时；
  若浏览器拒绝免手势重新锁定鼠标，会自动落到暂停卡片，点一下即恢复。
  第 15 关结束才显示 CAMPAIGN COMPLETE（保持手动，方便看战绩 / 重开）。
  世界机制开关都在 `MISSIONS[].mods`（ice / bounce / sandstorm / zeroG /
  gapScale / gravityScale…）,在 `game.js._update` 里按关生效。
- **大地图与封闭性**：MISSION 04–15 的世界均为 44–52 m 见方的**封闭大厅**，
  全部避开火车走廊（z 24–31）——列车不会从任何任务地图中间穿过；所有
  墙体/道具同时是碰撞体 + 射线遮挡体（人和子弹都不能穿）。
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
