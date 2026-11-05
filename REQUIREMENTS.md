# JAPANESE STATION — 原始需求汇总（合并版）

本文件按时间顺序合并三份原始需求文档，内容逐字保留、未做改写。
单个世界的验收契约见 `REBUILD.md`；玩法与实现说明见 `README.md`。

| 章节 | 来源文件 | 覆盖范围 |
|---|---|---|
| 一 | `prompt.txt` | 初代规格：桜見台駅 FPS 整体（车站/电车/樱花/渲染/音频/任务 1–3） |
| 二 | `moremaps1.md` | MISSION 04–09 六个主题世界设计（電脳九龍…沈没大陸） |
| 三 | `moremaps2.md` | 大地图 Chunk/LOD/InstancedMesh 技术要求 + MISSION 10–15 六个世界设计 |

---

## 一、初代规格

你是一名资深的 **Three.js / WebGL 游戏开发工程师、3D 游戏程序员、PBR 渲染工程师、FPS 游戏设计师和网页游戏优化专家**。 请你使用：
* HTML5
* CSS3
* JavaScript ES Modules
* Three.js
* WebGL 2
* GLTF / GLB
* PBR Materials
* HDR / HDRI
* EffectComposer
* UnrealBloomPass
* ACES Filmic Tone Mapping
* Web Audio API
* Pointer Lock API

制作一个**高质量、可以直接在浏览器运行的第一人称 FPS 游戏 Demo**。 游戏主题：
# JAPANESE STATION — TACTICAL FPS

玩家将在一个大型、现代、具有电影级视觉效果的日本铁路车站中进行第一人称射击战斗。 最终目标不是制作一个简单的 Three.js 技术 Demo，而是制作一个： **具有真实 3D 场景、真实枪械视觉、电影级光照、PBR 材质、HDR 环境光、Bloom、后期处理、粒子特效、枪械动画、敌人 AI、火车动态事件和完整声音系统的 Web FPS 游戏。**
---
# 一、最重要的开发原则
请按照以下优先级开发：
### 第一优先级
游戏必须真正可以运行。
### 第二优先级
FPS 操作必须流畅。
### 第三优先级
3D 场景和枪械必须具有较高视觉质量。
### 第四优先级
射击反馈必须具有强烈的视觉和听觉反馈。
### 第五优先级
后期处理和电影级光照。
### 第六优先级
动态事件和环境细节。 不要为了追求复杂效果导致游戏无法启动。 如果某个高级功能无法正常运行，请提供合理的 fallback，而不是让整个项目报错。
---
# 二、最终运行方式
优先制作：
```text
index.html
```
但由于现代 Three.js + GLTF + HDR + 本地资源可能涉及浏览器 CORS 和模块加载问题，可以使用：
```text
index.html assets/ models/ textures/ hdr/ audio/
```
目录结构。 如果需要 HTTP Server 才能加载 GLTF/HDR 文件，请明确说明：
```bash
python -m http.server 8080
```
然后访问：
```text
http://localhost:8080
```
不要要求 Node.js、Webpack、React、Vue。
---
# 三、Three.js 版本
使用现代 Three.js。 通过 CDN Import Map：
```html
```
使用：
```javascript
import * as THREE from 'three'; import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'; import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'; import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'; import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'; import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'; import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
```
如果某些模块在当前 Three.js 版本路径发生变化，请根据当前稳定版本正确调整。
---
# 四、GLTF / GLB 资产系统
这是本项目的重要部分。 必须设计一个完整的：
```text
AssetManager
```
负责加载：
* GLB
* GLTF
* HDR
* Texture
* Audio 例如：
```javascript
class AssetManager { constructor() { this.gltfLoader = new GLTFLoader(); this.textureLoader = new THREE.TextureLoader(); this.hdrLoader = new RGBELoader(); this.cache = new Map(); } async loadGLTF(url) {} async loadHDR(url) {} async loadTexture(url) {} }
```
---
# 五、真实 3D 资产优先
不要把整个游戏全部使用 BoxGeometry 拼出来。 必须设计成：
### GLTF / GLB 优先 例如：
```text
assets/ ├── models/ │ ├── station.glb │ ├── platform.glb │ ├── train.glb │ ├── vending_machine.glb │ ├── convenience_store.glb │ ├── enemy.glb │ ├── rifle.glb │ ├── props.glb │ └── sakura.glb │ ├── hdr/ │ └── station_night.hdr │ ├── textures/ │ ├── concrete/ │ ├── metal/ │ ├── glass/ │ ├── floor/ │ └── wood/ │ └── audio/
```
如果这些真实资产文件不存在，请建立清晰的 Asset URL 配置系统，并提供： **程序化 Geometry fallback。** 例如：
```javascript
const ASSETS = { station: './assets/models/station.glb', train: './assets/models/train.glb', rifle: './assets/models/rifle.glb', enemy: './assets/models/enemy.glb', hdr: './assets/hdr/station_night.hdr' };
```
如果 GLB 加载失败：
```text
GLB ↓ Load Failed ↓ Fallback Procedural Model
```
游戏仍然可以继续运行。
---
# 六、GLTF 模型处理
加载 GLTF / GLB 后必须：
* 自动遍历 Mesh
* 自动开启 castShadow
* 自动开启 receiveShadow
* 检查材质
* 检查动画
* 检查 Skeleton
* 支持 AnimationMixer
* 缓存模型 例如：
```javascript
gltf.scene.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; if (object.material) { object.material.needsUpdate = true; } } });
```
如果模型包含动画：
```javascript
const mixer = new THREE.AnimationMixer(model);
```
支持：
* Idle
* Walk
* Run
* Attack
* Hit
* Death
* Reload
---
# 七、HDR / HDRI 环境光
必须使用 HDR 环境贴图。 使用：
```javascript
new RGBELoader()
```
加载 HDR。 例如：
```javascript
new RGBELoader() .load('./assets/hdr/station_night.hdr', texture => { texture.mapping = THREE.EquirectangularReflectionMapping; scene.environment = texture; });
```
注意： **不要只把 HDR 设置为背景。** 重点是：
```text
scene.environment
```
用于 PBR 材质环境反射和全局环境照明。 如果 HDR 太亮，可以：
* 调整 renderer exposure
* 调整环境强度
* 使用 PMREMGenerator
---
# 八、PBR 材质
场景尽可能使用：
```javascript
THREE.MeshStandardMaterial
```
或者：
```javascript
THREE.MeshPhysicalMaterial
```
不要大量使用：
```javascript
MeshBasicMaterial
```
除非用于：
* UI
* 发光贴图
* 特殊粒子
* 非真实物体
---
# 九、PBR 纹理
支持：
```text
Base Color Normal Map Roughness Metalness AO Emissive
```
例如：
```javascript
const material = new THREE.MeshStandardMaterial({ map: baseColor, normalMap: normal, roughnessMap: roughness, metalnessMap: metalness, aoMap: ao });
```
日本车站不同材质需要有不同 PBR 属性。
---
# 十、车站材质
### 地面 使用：
* 石材
* 瓷砖
* 半高光
* Roughness 约 0.25~0.45 让地面具有轻微反射。
---
### 金属 使用：
```text
metalness ≈ 1.0 roughness ≈ 0.2~0.4
```
用于：
* 扶梯
* 栏杆
* 火车
* 站台门
* 柱子
* 售票机
---
### 玻璃 使用：
```text
MeshPhysicalMaterial transmission roughness ior
```
模拟：
* 商店玻璃
* 火车车窗
* 玻璃门
---
# 十一、ACES
色调映射 必须开启：
```javascript
renderer.toneMapping = THREE.ACESFilmicToneMapping;
```
并设置：
```javascript
renderer.toneMappingExposure = 1.0;
```
根据 HDR 和场景亮度自动调整。
---
# 十二、Color Space
现代 Three.js 必须正确处理颜色空间。 例如：
```javascript
renderer.outputColorSpace = THREE.SRGBColorSpace;
```
所有 Base Color / Albedo 纹理使用：
```javascript
texture.colorSpace = THREE.SRGBColorSpace;
```
Normal / Roughness / Metalness 不要错误设置为 sRGB。
---
# 十三、阴影
使用高质量阴影。 例如：
```javascript
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
```
主灯光：
```javascript
directionalLight.castShadow = true;
```
合理设置：
```text
shadow.mapSize shadow.camera bias normalBias
```
不要把所有 PointLight 都开启高质量阴影导致性能严重下降。
---
# 十四、电影级灯光
车站采用：
### 主环境光 HDRI。
### 顶部 LED 灯 大量：
```text
RectAreaLight / PointLight
```
根据性能合理使用。
### 商店 暖色灯光。
### 站台 冷白色灯光。
### 广告牌 Emissive Material。
### 火车 车头强光。
### 枪口 开枪瞬间：
```text
PointLight
```
产生强烈闪光。
---
# 十五、Bloom
必须加入：
```javascript
EffectComposer RenderPass UnrealBloomPass OutputPass
```
例如：
```javascript
const composer = new EffectComposer(renderer); const renderPass = new RenderPass(scene, camera); const bloomPass = new UnrealBloomPass( new THREE.Vector2(width, height), 0.7, 0.4, 0.85 ); composer.addPass(renderPass); composer.addPass(bloomPass); composer.addPass(new OutputPass());
```
Bloom 重点用于：
* LED
* 广告牌
* 荧光灯
* 火车车灯
* 枪口火焰
* 枪口闪光
* 电光火花 不要让整个画面过度 Bloom。
---
# 十六、后期处理
必须设计完整的后期处理 Pipeline：
```text
Scene ↓ RenderPass ↓ Bloom ↓ Color Processing ↓ Vignette ↓ OutputPass
```
如果方便，可以加入：
* Vignette
* Film Grain
* Chromatic Aberration
* Subtle Color Grading
* Screen Shake 但是必须克制。 最终效果应该是： **真实、电影感，而不是过度滤镜。**
---
# 十七、日本车站环境
建立一个大型日本现代铁路车站。 必须包含：
## 主大厅
* 大理石地面
* 高天花板
* 金属柱
* LED 灯
* 日文指示牌
* 电子屏
* 自动售票机
* 闸机
* 长椅
* 垃圾桶
* 行李箱
* 广告牌
* 公告栏
---
# 十八、日本便利店
车站中加入一个原创便利店。 不要直接使用现实品牌。 例如：
```text
駅コンビニ STATION MARKET
```
里面包含：
* 货架
* 饮料
* 零食
* 冰柜
* 收银台
* 商品灯光
* 玻璃门
* 自动门 商品可以使用低面数 GLB 模型。
---
# 十九、樱花
车站附近或连接大厅加入樱花区域。 包括：
* Sakura Tree GLB
* Sakura Branch
* Sakura Leaves
* Sakura Petals 大量樱花花瓣使用：
```text
THREE.Points BufferGeometry
```
制作。 花瓣：
* 随机旋转
* 缓慢下降
* 左右漂移
* 随机大小
* 生命周期
* 风力影响
---
# 二十、车站站台
必须包含：
* 铁轨
* 站台
* 黄色安全线
* 站台门
* 电子屏
* 日文站牌
* 广告牌
* 长椅
* 时刻表
* 灯光
---
# 二十一、火车
制作一列现代日本通勤电车。 优先加载：
```text
train.glb
```
如果不存在： 程序化生成。 火车必须拥有：
* 车身
* 车窗
* 车门
* 车轮
* 车灯
* LED 目的地显示
* 内部灯光
---
# 二十二、火车动态事件
游戏过程中自动触发：
```text
TRAIN ARRIVING
```
然后： 1. 远处出现车灯 2. 火车驶入 3. 火车减速 4. 刹车 5. 停车 6. 车门打开 7. 等待 8. 车门关闭 9. 火车离站 同时触发：
* 火车声音
* 轨道声音
* 刹车声音
* 广播
* 车门提示音
---
# 二十三、FPS 第一人称
使用：
```javascript
PointerLockControls
```
实现：
```text
WASD = 移动 SHIFT = 奔跑 SPACE = 跳跃 CTRL = 蹲下 鼠标 = 视角 LMB = 射击 R = 换弹 1 = 主武器 2 = 副武器 3 = 特殊武器 ESC = 解锁鼠标
```
---
# 二十四、真实枪械
GLB 枪械必须优先使用：
```text
rifle.glb
```
如果 GLB 不存在： 使用程序化模型。 枪械应该具有真实比例和细节。 包括：
* Receiver
* Barrel
* Magazine
* Stock
* Grip
* Trigger
* Sight
* Handguard
* Muzzle 枪械材质：
```text
Metal Polymer Rubber Glass
```
全部使用 PBR。
---
# 二十五、枪械第一人称位置
枪械放置在：
```text
Camera Space
```
而不是世界空间。 例如：
```javascript
camera.add(weaponModel);
```
位置：
```text
x = 0.35 y = -0.35 z = -0.65
```
根据模型大小动态调整。 枪械不要挡住中央准星。
---
# 二十六、枪械动画
至少实现：
### Idle 轻微呼吸。
### Walk 轻微上下移动。
### Sprint 明显晃动。
### Fire 后坐力。
### Reload 完整换弹动作。 如果 GLB 本身没有动画： 通过程序动画模拟。
---
# 二十七、射击系统
使用：
```javascript
THREE.Raycaster
```
射击方向：
```text
Camera ↓ Crosshair ↓ Raycaster ↓ Target
```
支持：
* 敌人
* 墙壁
* 地面
* 金属
* 木材
* 玻璃
---
# 二十八、枪口火焰
这是重点。 开枪瞬间必须同时出现：
```text
Muzzle Flash Smoke Sparks Point Light Recoil Camera Shake Gun Sound
```
枪口火焰不要只是一个黄色平面。 可以组合：
```text
Sprite PointLight Particles Additive Blending
```
制作。
---
# 二十九、射击命中效果
我要的是： **非常强烈、震撼、电影化的 FPS 射击反馈。** 但不要制作过度血腥的画面。
---
## 命中金属 产生：
```text
Bright Sparks Smoke Small Debris Bullet Decal Metal Impact Sound
```
---
## 命中水泥 产生：
```text
Dust Concrete Debris Smoke Bullet Hole Impact Sound
```
---
## 命中木材 产生：
```text
Wood Splinters Dust Impact Sound
```
---
## 命中玻璃 产生：
```text
Glass Shards Reflection Glass Breaking Sound
```
---
# 三十、敌人命中
敌人被击中时：
```text
Flash Particles Smoke Hit Marker Sound Knockback Animation
```
头部命中可以使用：
```text
强烈闪光 粒子 烟雾 屏幕震动 特殊音效 慢动作 0.05~0.1 秒
```
但： **不要出现真实血液喷射、肢解、断肢、器官等血腥内容。** 重点通过：
```text
Particles Smoke Sparks Lighting Screen Shake Sound
```
制造强烈反馈。
---
# 三十一、粒子系统
建立：
```javascript
ParticleManager
```
至少支持：
```text
MuzzleFlash Smoke Sparks Dust Debris BulletImpact SakuraPetals Glass
```
使用：
```text
THREE.Points BufferGeometry ShaderMaterial
```
尽量避免每个粒子创建独立 Mesh。 使用对象池。
---
# 三十二、音频系统
创建：
```javascript
class AudioManager {}
```
支持：
* HTML Audio
* Web Audio API
* AudioListener
* PositionalAudio 第一人称枪械使用：
```text
枪声 机械声 换弹 拉栓
```
环境使用：
```text
车站环境声 广播 火车 脚步 风 电流 商店环境
```
---
# 三十三、3D 空间音频
尽可能使用：
```javascript
THREE.PositionalAudio
```
例如： 火车越远： 声音越小。 火车靠近： 声音越来越大。 商店： 声音来自商店方向。 广播： 声音来自广播喇叭。 枪声： 具有方向感。
---
# 三十四、日本车站广播
加入：
```text
次の電車がまいります。 危険ですので、黄色い線の内側までお下がりください。
```
可以通过：
```javascript
SpeechSynthesis
```
调用日语声音作为 fallback。 如果浏览器没有日语语音： 播放普通环境广播音效。
---
# 三十五、敌人 AI
敌人至少支持：
```text
Idle Patrol Detect Chase Attack Hit Death
```
状态机：
```text
PATROL ↓ PLAYER DETECTED ↓ CHASE ↓ ATTACK ↓ HIT ↓ DEATH
```
敌人需要有：
* 视野范围
* 听觉范围
* 移动速度
* 攻击距离
* HP
---
# 三十六、游戏任务
开始：
```text
MISSION 01 SECURE THE STATION Eliminate all hostile targets.
```
HUD：
```text
TARGETS REMAINING: 5
```
全部消灭：
```text
MISSION COMPLETE STATION SECURED
```
显示：
```text
KILLS ACCURACY TIME
```
---
# 三十七、HUD
现代 FPS HUD。 中央：
```text
+
```
右下：
```text
30 / 120
```
左下：
```text
HP 100
```
右上：
```text
TARGETS 5
```
命中：
```text
HIT
```
击杀：
```text
ELIMINATED
```
---
# 三十八、游戏启动页面
：
```text
JAPANESE STATION TACTICAL FPS CLICK TO START WASD MOVE SHIFT SPRINT SPACE JUMP CTRL CROUCH LMB FIRE R RELOAD 1 / 2 / 3 WEAPON ESC UNLOCK
```
视觉风格：
* 黑色半透明背景
* 白色字体
* 红色小面积强调
* 极简
* 现代军事 UI
* 不要复杂花哨
---
# 三十九、动态天气 / 环境
如果性能允许，可以加入：
* 夜间
* 轻微雾气
* 空气粒子
* 樱花
* 车站灯光闪烁
* 地面湿润反射 整个场景建议设置为： **傍晚到夜间的日本车站。** 这样可以更好地展示：
* HDR
* Bloom
* PBR
* 火车车灯
* 枪口火焰
* 商店灯光
---
# 四十、后期视觉风格
整体画面应该类似：
```text
Modern Tactical FPS + Japanese Cinematic Environment + Night Station + PBR + HDR + Bloom + Realistic Lighting
```
颜色：
* 冷蓝色环境
* 暖黄色商店灯光
* 粉色樱花
* 白色 LED
* 红色警示灯 不要过度饱和。
---
# 四十一、性能优化
目标： **桌面 Chrome / Edge 尽可能稳定 60 FPS。** 必须：
* WebGL 2
* InstancedMesh
* BufferGeometry
* Geometry / Material 复用
* Texture 压缩思路
* 合理 shadow map
* 粒子对象池
* 动态对象池
* Frustum Culling
* GLTF 缓存
* HDR 只加载一次
* 音频缓存
* 不在 animation loop 中大量创建对象 提供 FPS：
```text
FPS: 60
```
以及：
```text
Draw Calls Triangles
```
可以放在开发者 Debug UI 中。
---
# 四十二、质量等级
提供：
```text
GRAPHICS QUALITY LOW MEDIUM HIGH ULTRA
```
### LOW 关闭：
* Bloom
* 高级阴影
* 部分粒子
### MEDIUM 普通阴影 + Bloom。
### HIGH 高质量阴影 + Bloom + HDR。
### ULTRA 开启：
* 高质量阴影
* Bloom
* SSR-like reflection（如果可以）
* 高质量粒子
* 高质量后期处理 如果某些功能实现成本太高，可以使用视觉近似。
---
# 四十三、响应式
支持：
```text
1920x1080 2560x1440 3840x2160
```
自动处理：
```javascript
window.addEventListener('resize', ...)
```
同时更新：
```text
camera.aspect camera.updateProjectionMatrix() renderer.setSize() composer.setSize()
```
---
# 四十四、碰撞
玩家不能穿过：
* 墙
* 柱子
* 商店柜台
* 售票机
* 火车
* 站台设施 使用：
```text
Box3 Sphere Capsule
```
进行简单碰撞。 不需要复杂物理引擎。
---
# 四十五、代码架构
即使是单 HTML，也必须模块化组织。 推荐：
```text
CONFIG ASSET MANAGER SCENE MANAGER LIGHTING ENVIRONMENT PLAYER WEAPON ENEMY AI PROJECTILE PARTICLE MANAGER AUDIO MANAGER TRAIN STATION SAKURA HUD INPUT COLLISION POST PROCESSING GAME STATE GAME LOOP
```
建议使用：
```javascript
class Game {} class Player {} class Weapon {} class Enemy {} class EnemyManager {} class ParticleManager {} class AudioManager {} class AssetManager {} class Train {} class Station {} class HUD {}
```
---
# 四十六、错误处理
所有外部资源都必须有：
```javascript
loader.load( url, onLoad, onProgress, onError );
```
加载失败时： 不要让游戏崩溃。 显示：
```text
Asset loading failed Using fallback asset
```
然后继续运行。
---
# 四十七、Loading Screen
启动时显示：
```text
LOADING STATION... [██████████████████] 85% Loading: Station Train Weapons Enemies Textures HDR Audio
```
所有资源加载完成：
```text
READY
```
然后：
```text
CLICK TO START
```
---
# 四十八、资源加载进度
使用：
```text
LoadingManager
```
显示：
```text
itemsLoaded / itemsTotal
```
并动态更新进度条。
---
# 四十九、代码完整性要求
非常重要： **不要只给我代码框架。** 不要出现：
```text
// TODO // implement later // add your own model // add your own sound // omitted for brevity
```
不要省略核心代码。 必须尽可能给出完整实现。
---
# 五十、最终文件
优先：
```text
index.html
```
如果需要资源：
```text
project/ │ ├── index.html │ └── assets/ ├── models/ │ ├── station.glb │ ├── train.glb │ ├── rifle.glb │ └── enemy.glb │ ├── hdr/ │ └── station.hdr │ ├── textures/ │ └── audio/
```
代码中集中管理：
```javascript
const ASSET_PATH = './assets/';
```
---
# 五十一、如果没有 GLB / HDR / 音频资源
这是非常重要的一点。 当前如果无法提供这些文件： 不要因此停止开发。 必须实现：
```text
Real Asset ↓ 如果存在 ↓ 加载 GLB / HDR / Audio 如果不存在 ↓ Procedural Fallback ↓ 继续游戏
```
也就是说： **整个游戏即使没有外部资源，也应该可以启动。** 但是代码结构必须已经支持未来直接替换成高质量 GLB / HDR / 音频。
---
# 五十二、GLTF 动画支持
如果 GLB 包含动画： 自动检测：
```javascript
gltf.animations
```
然后创建：
```javascript
AnimationMixer
```
支持：
```text
idle walk run attack hit death reload
```
如果动画不存在： 程序化生成简单动画。
---
# 五十三、真实枪械视觉要求
枪械必须是整个 FPS 画面中最重要的前景元素之一。 要求：
* 真实比例
* PBR 金属
* 粗糙度变化
* 金属反射
* 边缘高光
* 细节丰富
* 枪管
* 弹匣
* 瞄准具
* 枪托
* 握把
* 枪机 不要使用一个简单的 Box 当枪。
---
# 五十四、射击效果最终标准
玩家点击鼠标：
```text
LMB ↓ 枪械快速后坐 ↓ Muzzle Flash ↓ Smoke ↓ Point Light Flash ↓ Gunshot ↓ Camera Shake ↓ Raycast ↓ Target Hit ↓ Impact Particle ↓ Impact Sound ↓ Hit Marker ↓ Enemy Reaction
```
整个过程应该发生在极短时间内，让玩家感觉： **枪械具有真实重量和冲击力。**
---
# 五十五、摄像机震动
实现：
```javascript
cameraShake
```
每次射击产生：
```text
rotation.x rotation.y position
```
短时间随机扰动。 命中敌人时： 小震动。 强烈事件： 大震动。 但不能让玩家晕眩。
---
# 五十六、慢动作击杀效果
如果实现击杀： 头部命中 / 最后一名敌人死亡时： 可以短暂：
```text
timeScale = 0.1
```
持续：
```text
50~100ms
```
然后恢复正常。 配合：
* Bloom
* Screen Shake
* Hit Sound
* Particle 增强击杀反馈。 不要过度使用。
---
# 五十七、火车和环境必须成为视觉亮点
游戏中玩家应该能够看到：
```text
远处火车 + 站台 + 樱花 + 商店 + LED + HDR灯光 + 湿润地面 + 动态广告
```
形成一个完整的日本车站世界。
---
# 五十八、最终画面目标
最终打开游戏时，我希望看到： 一个现代日本车站。 夜晚。 地面微微湿润。 顶部 LED 灯照亮大厅。 商店散发暖黄色灯光。 樱花花瓣在空气中飘落。 远处火车缓缓进站。 广告牌发出 Bloom。 站台灯光反射在地面。 玩家手中是一把真实感较强的现代突击步枪。 鼠标点击。 枪口瞬间：
```text
FLASH SMOKE SPARK LIGHT RECOIL SOUND
```
子弹击中金属柱：
```text
SPARKS SMOKE DEBRIS BULLET MARK
```
击中敌人：
```text
HIT FLASH PARTICLES SMOKE HIT MARKER SOUND ENEMY REACTION
```
整个场景产生轻微光照变化。 这才是最终目标。
---
# 五十九、开发顺序
请按照以下顺序实现：
### Phase 1 Three.js 初始化。
### Phase 2 Renderer + Camera + WebGL2。
### Phase 3 HDR / PBR / Tone Mapping。
### Phase 4 EffectComposer + Bloom + Post Processing。
### Phase 5 GLTF / GLB Asset Manager。
### Phase 6 日本车站场景。
### Phase 7 火车。
### Phase 8 樱花。
### Phase 9 第一人称控制。
### Phase 10 枪械。
### Phase 11 Raycast 射击。
### Phase 12 粒子。
### Phase 13 敌人 AI。
### Phase 14 声音系统。
### Phase 15 HUD。
### Phase 16 任务系统。
### Phase 17 Loading Screen。
### Phase 18 性能优化。
### Phase 19 Fallback。
### Phase 20 最终自检。
---
# 六十、最终自检
输出代码前必须自己检查： [ ] Three.js 正常加载 [ ] WebGL2 正常 [ ] Renderer 正常 [ ] HDRLoader 正常 [ ] GLTFLoader 正常 [ ] HDR Environment 正常 [ ] PBR 正常 [ ] ACES Tone Mapping 正常 [ ] Bloom 正常 [ ] EffectComposer 正常 [ ] OutputPass 正常 [ ] LoadingManager 正常 [ ] GLTF 加载失败不会崩溃 [ ] HDR 加载失败不会崩溃 [ ] Pointer Lock 正常 [ ] WASD 正常 [ ] 鼠标视角正常 [ ] 跳跃正常 [ ] 奔跑正常 [ ] 蹲下正常 [ ] 枪械正常显示 [ ] 枪械 PBR 正常 [ ] 枪械后坐力正常 [ ] 枪口火焰正常 [ ] 枪口烟雾正常 [ ] PointLight 闪光正常 [ ] Camera Shake 正常 [ ] Raycast 正常 [ ] 敌人正常 [ ] 敌人 AI 正常 [ ] 敌人命中反馈正常 [ ] 墙壁弹着点正常 [ ] 金属火花正常 [ ] 木屑正常 [ ] 玻璃碎片正常 [ ] 樱花粒子正常 [ ] 火车正常 [ ] 火车动态移动正常 [ ] 商店正常 [ ] 日本车站正常 [ ] HUD 正常 [ ] 音频正常 [ ] Web Audio 正常 [ ] 3D Spatial Audio 正常 [ ] 日语广播正常 [ ] Loading Screen 正常 [ ] Mission 正常 [ ] Victory Screen 正常 [ ] FPS Counter 正常 [ ] 碰撞正常 [ ] Resize 正常 [ ] 游戏重新开始正常 [ ] 没有明显 Syntax Error [ ] 没有明显 ReferenceError [ ] 没有明显 CORS 依赖问题说明遗漏
---
# 六十一、最终输出格式
现在开始直接开发。 首先简短说明：
```text
项目结构 技术栈 运行方式
```
然后直接提供：
```text
index.html
```
的完整代码。 如果代码非常长，可以分成：
```text
PART 1 PART 2 PART 3 ...
```
但每一部分必须能够无缝拼接。 不要省略任何核心代码。 最后提供：
```text
操作说明 资源目录说明 如何替换 GLB 如何替换 HDR 如何替换枪械 如何替换音效 如何调整画质 如何修改敌人数量 如何修改武器伤害
```
再次强调： **我要的是一个真正可以玩的、高质量 Three.js Web FPS Demo，而不是一个简单的 Three.js 场景展示。** 视觉重点： **日本车站 + 樱花 + 商店 + 火车 + HDR + PBR + GLTF/GLB + Bloom + 真实枪械 + 强烈射击反馈 + 粒子 + 音效 + 后期处理。** 如果当前环境可以访问互联网，请优先选择可合法使用的免费 CC0 / 开源 GLB、HDRI 和音频资源，并在代码中使用稳定的 CDN 或明确的 assets 路径；如果无法获取资源，则自动使用程序化模型作为 fallback。不要因为缺少资源而删除功能。 现在开始。
---


## 二、MISSION 04–09


1. 赛博朋克霓虹九龙（Sci-Fi Cyberpunk Alley）

• 场景描述： 一个高密度、垂直感极强的赛博朋克风未来街区。狭窄的巷道两旁是直插云霄的摩天大楼，挂满了巨大的全息动态广告投影和闪烁的霓虹灯招牌。地面因刚下过雨而呈现湿滑的镜面效果，倒映着上方的霓虹色彩。天空中不时有反重力飞车穿梭。
• FPS 玩法元素： 错综复杂的脚手架和高空管道提供多层垂直射击位；可以被打破的霓虹灯箱（产生短路火花特效）。
• Three.js / 3D 技术要点：
	• PBR 材质与粗糙度贴图（Roughness Maps）： 重点处理地面和金属管道，实现雨后地面的高光反射。
	• 自定义片元着色器（Custom Fragment Shaders）： 编写高效率的仿全息投影流动效果（Hologram shader）和霓虹发光渐变。
	• 实例化网格（Instanced Mesh）： 对街区中大量的电缆、管道、路灯进行实例化，大幅减少 Draw Calls，保证浏览器帧率。

2. 废弃低重力月球基地（Abandoned Lunar Outpost）

• 场景描述： 一个死寂的白灰色月球穹顶基地。半破碎的强化玻璃天窗外能看到巨大的、缓慢自转的蓝色地球和璀璨星空。基地内部充满白色的模块化科幻舱室、巨大的精密离心机、四处漂浮的太空废料，以及由于断电而闪烁的红色应急警报灯。
• FPS 玩法元素： 场景设计配合低重力跳跃（玩家可跳得更高）；部分密封舱门需要射击开关才能开启。
• Three.js / 3D 技术要点：
	• 烘焙光照贴图（Lightmap Baking）： 基地内复杂的静态阴影和月光环境光直接在 Blender 中烘焙进贴图，降低 Three.js 实时光源计算压力。
	• 粒子系统（Particle System）： 模拟无重力状态下漂浮的微小尘埃、微粒以及警报闪烁的体积光效果。
	• 天空盒/全景球（Skybox/Equirectangular Projection）： 使用高质量的 8K 宇宙星空、地球全景图作为背景。

3. 古埃及法老黄金陵墓（Pharaoh's Golden Tomb）

• 场景描述： 一个神秘、宏伟且充满压迫感的地下陵墓。四周是刻满象形文字的巨大沙岩石柱，中央摆放着闪烁着黄金与青金石光泽的法老石棺。无数的财宝、黄金器皿堆积如山。墙壁上的火把提供摇曳的暖色火光，与金蝉、圣甲虫的图腾交相辉映。
• FPS 玩法元素： 迷宫般的走廊提供遭遇战；射击石柱上的机关可以触发滚石或流沙陷阱。
• Three.js / 3D 技术要点：
	• 法线贴图（Normal Maps）与高度贴图： 用于在低多边形（Low-Poly）的石墙上呈现极为逼真的象形文字浮雕深度。
	• 点光源与阴影映射（Point Light Shadows）： 模拟火把摇曳的动态阴影，增强恐怖与神秘的 FPS 氛围。
	• 金色各向异性材质（Anisotropic Metallic Material）： 精细调整金器和宝藏的金属度（Metalness）与粗糙度，使其在火光下呈现有质感的反光。

4. 浮空蒸汽朋克飞艇港（Steampunk Airship Harbor）

• 场景描述： 翱翔在万里高空云海之上的开放式巨型机械港口。多艘巨大的黄色帆布气囊飞艇锚定在青铜与黄铜打造的悬空甲板旁。场景中到处是轰鸣旋转的巨大齿轮、不断喷发白烟的蒸汽管道。阳光穿透翻滚的云层，形成美丽的丁达尔效应（舞台光）。
• FPS 玩法元素： 开放式甲板有坠落致死的风险；利用喷气阀门的上升气流可以让玩家实现滑翔或高跳。
• Three.js / 3D 技术要点：
	• 顶点着色器动画（Vertex Shader Animation）： 用于模拟飞艇气囊的轻微膨胀呼吸感，以及四周动态翻滚的云海。
	• 雾效（THREE.FogExp2）： 配合开放式高空场景，利用指数雾模拟云层深处以及远景机械建筑的隐现。
	• 骨骼动画（Skeleton Animation）： 针对港口巨大的机械臂和联动齿轮组，在 Blender 中做好动画后导出为 glTF 格式。

5. 极简主义近未来实验室（Minimalist Quantum Lab）

• 场景描述： 一个风格极简、充满科技感的纯白与浅灰色量子物理实验室。没有任何冗余的装饰，界面和墙体线条利落现代。房间中央是一个由悬浮透明能量体构成的量子核心，不断向外扩散微弱的淡蓝色涟漪。部分墙面采用单向高反光镜面玻璃。
• FPS 玩法元素： 极佳的视野适合对枪；中央能量体在特定时间段会产生电磁脉冲，短暂致盲玩家或干扰 HUD 界面。
• Three.js / 3D 技术要点：
	• 多重采样与抗锯齿（SMAA/FXAA Pass）： 极简场景极易暴露模型边缘的锯齿，必须引入后期抗锯齿通道。
	• 精细的镜面反射（Reflections/CubeCamera）： 实验室的钢化玻璃和高抛光地面需要用到局部环境反射或 SSR（屏幕空间反射）效果。
	• 次表面散射（Subsurface Scattering）： 让中央悬浮的量子能量体呈现出半透明、光线穿透的玉石/液体质感。

6. 末日沉没亚特兰蒂斯（Sunken Ruin of Atlantis）

• 场景描述： 沉没在深海之中的远古高度发达文明遗迹。巨大的希腊式大理石神庙已被珊瑚和海藻覆盖，成群的异星发光鱼类在断壁残垣间穿梭。古老的科技方尖碑依然在水下散发着幽蓝色的能量微光，光线透过波动的水面，在遗迹表面投射出流动的水波焦散（Caustics）光影。
• FPS 玩法元素： 全水下物理效果（子弹弹道带有气泡轨迹且受阻力下坠）；可以利用水流管道进行快速位移。
• Three.js / 3D 技术要点：
	• 水波焦散着色器（Caustics Shader）： 在所有静态物体的表面叠加上一层动态的水纹光影动画，这是营造水下氛围的核心。
	• 后期处理通道（Post-processing Shader Pass）： 引入深蓝色调滤镜、屏幕边缘模糊以及微弱的水流扭曲效果（Displacement Map 动画）。
	• 粒子广告牌（Points/Particle Bilboards）： 模拟枪口射击时光束激起的密集气泡流和水下漂浮的浮游生物。


---

## 三、Chunk/LOD 要求 + MISSION 10–15

我需要你（LLM）针对上述选定的场景，帮我设计一个基于 THREE.Group 的大地图管理类。请务必使用 模块化加载（Chunk-based loading） 的逻辑，并在代码中为远景物体实现基础的 LOD（Level of Detail） 切换逻辑。所有大范围重复的静态物件（如护栏、岩石、齿轮、树叶）必须提供 THREE.InstancedMesh 的实现方案，以保证 WebGL 的极佳性能。”

1. 永夜极地极光破冰船（Aurora Arctic Icebreaker）

• 场景概念： 这是一个占地数公里、被困在北极巨型冰川裂缝中的核动力破冰船及周边冰原。
• 详细场景描述：
地图分为三大区域：巨大的破冰船甲板与多层内部舱室（错综复杂的近战区）、两侧高耸入云的蓝色冰川峭壁（狙击点），以及被船体破开的冻结海面。天空中是铺满大半个屏幕、不断动态扭曲交织的翠绿色与紫色极光。强烈的暴风雪夹杂着冰晶在空气中横扫，破冰船巨大的探照灯在地表拉出几百米长的动态光柱。
• FPS 玩法元素：
冰面有滑行惯性；射击峭壁上的巨型冰锥可以使其坠落砸伤下方的敌人；破冰船顶部的雷达站是一个极难攻克的高地制高点。
• Three.js 大地图技术要点：
	• 视距优化（Far Clipping & FogExp2）： 使用大范围的浓重白色指数雾掩盖远处的模型加载，降低视锥体内的实时渲染压力。
	• 顶点着色器极光（Aurora Shader）： 极光不能用模型，必须用一个巨大的半透明圆顶（Dome），在 Vertex Shader 中用柏林噪声（Perlin Noise）驱动顶点变形和颜色渐变。
	• 多层纹理混合（Terrain Splatting）： 冰原地面通过着色器混合“积雪”、“冰面”和“裸露岩石”三种贴图，避免大地图纹理重复感。

2. 巨型轨道电梯终点站（Orbital Elevator Nexus）

• 场景概念： 位于平流层顶端、连接地球与太空的宏大中转枢纽，极具空间高度感和工业感。
• 详细场景描述：
一个直径达数百米的环形悬空平台，四周没有任何外墙，只有镂空的合金护栏。俯瞰下方，可以透过稀疏的云层看到微缩的地球大陆轮廓和海洋；仰望上方，巨大的轨道电梯缆绳如通天巨柱直插太空。平台中央是密集的自动化集装箱运输轨道，无数的无人机和货运悬浮车在四周穿梭。
• FPS 玩法元素：
地图中央有定时的货运列车高速驶过，会撞飞玩家；开放式边缘无掩体，极易被击落或失足坠落。
• Three.js 大地图技术要点：
	• 实例化网格巨量应用（InstancedMesh）： 环形平台的几千个机械支架、重复的集装箱、栏杆必须全部实例化，将 Draw Calls 控制在个位数。
	• 背景分层渲染（Layered Background）： 远景的地球和云层使用一个超大球体贴图，并让其以极低的速度自转，营造宏大的宇宙空间感。
	• 屏幕空间环境光遮蔽（SSAO Pass）： 这种机械线条密集的场景，开启 SSAO 后能极大地增强机械结构件之间的阴影层次感。

3. 巨树之冠：翡翠生态穹顶（Canopy of Yggdrasil: Eco-Dome）

• 场景概念： 一个直径数公里的巨型半球形温室穹顶，内部培育着变异的超级巨树。
• 详细场景描述：
玩家不是在地面战斗，而是战斗在距离地面上百米高的“树冠层”。无数人造的悬空木质栈道、合金观测平台通过粗壮的树枝连接。巨树的叶片大如汽车，散发着淡淡 regeneration 荧光。阳光穿透穹顶的三角玻璃窗格，在密林间投射下千丝万缕的体积光（光束）。林间飞舞着发光的机械昆虫。
• FPS 玩法元素：
利用粗壮的树干进行弧形走位；部分中空的树干可以作为狙击通道；叶片具有弹性，踩上去可以进行高跳。
• Three.js 大地图技术要点：
	• 层级细节（LOD - Level of Detail）： 针对数万片树叶和树枝，近处使用高模 PBR，远处自动切换为 Low-Poly 甚至 2D 广告牌（Billboard）精灵。
	• 植物风动 Shader（Wind Vertex Deformation）： 在顶点着色器中加入基准正弦波，让所有树叶和悬空藤蔓产生随风微微摇曳的动态效果。
	• 烘焙全局光（Baked GI Maps）： 森林内部的光影极其复杂，实时光会导致浏览器卡死，必须将整个温室的阳光和阴影全部烘焙好。

4. 荒漠遗迹：风蚀机械峡谷（The Rusting Canyon）

• 场景概念： 绵延数公里的红岩大峡谷中，半掩埋着一艘坠毁了几个世纪的千米级星际战舰。
• 详细场景描述：
两旁是风化严重的红色砂岩峭壁，峡谷中央横亘着战舰巨大的钢铁残骸。残骸已经严重生锈、断裂，部分舱体形成了解构主义的金属山洞。狂风吹过，漫天黄沙。夕阳将整个峡谷染成血红色，残骸那巨大的发动机喷口在夕阳下拉出长达一公里的阴影。
• FPS 玩法元素：
战舰内部是狭窄暗淡的遭遇战区，战舰顶部则是视野开阔的狙击圣地；突发的沙尘暴会周期性降低全图能见度。
• Three.js 大地图技术要点：
	• 无限地形切片（Terrain Chunking）： 地形网格按 64x64 的正方形切片，根据玩家坐标动态加载（Mergable Buffers）和卸载。
	• 金属生锈 Shader（Layered Rust Material）： 编写自定义材质，根据模型的 Y 轴高度或斜率，动态混合“原生涂装”与“生锈砂化”纹理。
	• 粒子沙尘暴（Custom Particle System）： 用一套高效率的 BufferGeometry 粒子系统模拟全图密集的沙尘流动，通过 GPU 更新粒子坐标以防 CPU 瓶颈。

5. 零重力霓虹水族馆（Neon Megalodon: Zero-G Aquarium）

• 场景概念： 赛博朋克都市地下的超级水族馆，内部发生了重力失效异常。
• 详细场景描述：
这是一个长方体结构的巨型封闭空间。原本应该在水槽里的巨大海水量、发光的水母、巨大的机械巨齿鲨，因为重力异常，现在变成了一个个漂浮在半空中的“无容器巨大水球”。霓虹灯光穿透这些悬空的水球，在空间的墙壁上折射出斑驳、扭曲的光晕。玩家利用喷气背包在这些漂浮的水球和观景平台之间穿梭。
• FPS 玩法元素：
玩家可以游进漂浮在半空中的水球，在水球内部移动速度变慢、子弹轨迹改变，出水球后恢复正常；机械巨齿鲨会定时吞噬接近特定水球的玩家。
• Three.js 大地图技术要点：
	• 折射与反射 Shader（Refraction/EnvMap）： 悬空水球的材质是核心，必须具备极高的折射率，让水球后方的场景产生高效率的动态扭曲。
	• 光线追踪/焦散贴图动画： 利用一个 Canvas 动画作为 Light.map，将流动的水纹焦散不断投影到整个建筑结构的内墙上。
	• 实时网格合并（BufferGeometryUtils）： 将水族馆复杂的观景走廊静态模型在初始化时合并为一个 Geometry，合并 Draw Calls。

6. 永恒黄昏的齿轮时空（The Clockwork Purgatory）

• 场景概念： 一个由无数精密铜质齿轮交织而成的超现实、无限延伸的宏大机械世界。
• 详细场景描述：
没有天空，极目远眺四面八方全都是大大小小、正在严丝合缝转动着的金色与青铜色齿轮。有些齿轮大如体育场，表面建有欧式古典哥特建筑；有些齿轮小如井盖，作为连接两地的跳板。整个世界沉浸在永恒黄昏的暖橘色调中。空气中漂浮着黄铜磨损产生的金色粉尘。
• FPS 玩法元素：
由于地板（齿轮）在不停旋转，站立在不同齿轮上会导致玩家的射击弹道和走位发生相对位移；大齿轮咬合处是致命的秒杀陷阱。
• Three.js 大地图技术要点：
	• 层次化矩阵旋转（Hierarchical Object3D Rotation）： 齿轮之间有严格的传动比。利用 Three.js 的父子节点（Object3D.add）嵌套，只需控制核心齿轮的 rotation.y，即可带动机关全图精确联动。
	• 镜面高光与各向异性（Specular Highlights）： 黄铜齿轮在黄昏光线下的边缘高光（Rim Light）是质感关键，需在 Shader 中对法线和视线夹角做特定模糊处理。
	• 远景雾化模糊（Depth-of-Field Pass）： 通过后期处理添加微弱的景深效果，让极远处数公里外转动的无数庞大齿轮虚化，既遮丑又省资源。
